/**
 * Lounge data access — the read/write surface for communities.
 *
 * Two schema facts shape everything here:
 *
 * 1. `database.types.ts` declares `Relationships: []` on every table, so the
 *    typed client cannot resolve PostgREST embedded selects (`lounges(*)`).
 *    Every join below is therefore an explicit second round trip stitched
 *    together in JS. It is a few more requests, not a few more `any`s.
 *
 * 2. RLS is the source of truth for visibility, not a `where` clause we write.
 *    A non-member reading a private lounge gets zero rows rather than an
 *    error, so "empty" and "forbidden" look identical on the wire — callers
 *    must treat a missing lounge as "you cannot see this yet", never as a bug.
 */

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useEffect, useState } from 'react';

import type { LoungeRow, MemberRole, ProfileRow, RoomRow } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';

// ---------------------------------------------------------------- shapes

export type LoungeSummary = {
  lounge: LoungeRow;
  /** The signed-in user's role in this lounge. */
  role: MemberRole;
  memberCount: number;
  activeSessions: number;
  /** Distinct people currently inside this lounge's active Sessions. */
  listeners: number;
};

export type PublicLoungeSummary = {
  lounge: LoungeRow;
  isMember: boolean;
};

export type LoungeDetail = {
  /** Null when the lounge is private and the viewer is not a member. */
  lounge: LoungeRow | null;
  role: MemberRole | null;
  isMember: boolean;
};

export type LoungeMemberEntry = {
  userId: string;
  role: MemberRole;
  joinedAt: string;
  /** Null only if a profile row vanished mid-flight; render a placeholder. */
  profile: ProfileRow | null;
};

export type LoungeSessionSummary = {
  room: RoomRow;
  listeners: number;
  hostName: string;
  nowPlaying: { title: string; artist: string } | null;
};

export type CreateLoungeInput = {
  name: string;
  description: string;
  isPublic: boolean;
};

// ---------------------------------------------------------------- keys

/**
 * Every key starts with 'lounges' so a single
 * `invalidateQueries({ queryKey: loungeKeys.all })` after a mutation refreshes
 * the tab list, explore, and any open detail screen in one call.
 */
export const loungeKeys = {
  all: ['lounges'] as const,
  mine: (userId: string | null) => ['lounges', 'mine', userId] as const,
  public: (query: string, userId: string | null) =>
    ['lounges', 'public', query, userId] as const,
  detail: (loungeId: string, userId: string | null) =>
    ['lounges', 'detail', loungeId, userId] as const,
  members: (loungeId: string) => ['lounges', 'members', loungeId] as const,
  sessions: (loungeId: string) => ['lounges', 'sessions', loungeId] as const,
};

/** Public lounge browsing is not personal — a slightly stale list is fine. */
const EXPLORE_STALE_MS = 60_000;
const EXPLORE_LIMIT = 50;

const ROLE_RANK: Record<MemberRole, number> = { owner: 0, mod: 1, member: 2 };

// ---------------------------------------------------------------- helpers

/**
 * The signed-in user's id, read straight from the Supabase client.
 *
 * `@/lib/auth` owns session state for the app at large; this feature reads the
 * id directly so it carries no compile-time dependency on that module's shape.
 * The auth client is a singleton, so both observers see the same session.
 */
export function useCurrentUserId(): string | null {
  return useCurrentUser().userId;
}

export type CurrentUser = {
  userId: string | null;
  /** False until the session lookup answers: a null id means "not known yet". */
  resolved: boolean;
};

/**
 * The same id, plus whether the session lookup has actually settled.
 *
 * `getSession()` reads AsyncStorage, so the id is null for the first few ticks
 * of every mount even when someone is signed in. A query whose *result* turns
 * on the id — "am I a member of this lounge?" — has to wait for `resolved`,
 * or it answers as an anonymous visitor and caches that answer.
 */
export function useCurrentUser(): CurrentUser {
  const [user, setUser] = useState<CurrentUser>({ userId: null, resolved: false });

  useEffect(() => {
    let alive = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (alive) setUser({ userId: data.session?.user.id ?? null, resolved: true });
    });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser({ userId: session?.user.id ?? null, resolved: true });
    });

    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, []);

  return user;
}

/**
 * A slug is a URL-safe handle, not an identity: two lounges may legitimately
 * be called "Late Night", and `lounges.slug` is UNIQUE. The random suffix is
 * what keeps the second one from failing to insert.
 */
function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);

  const suffix = Crypto.randomUUID().replace(/-/g, '').slice(0, 6);
  return `${base || 'lounge'}-${suffix}`;
}

/**
 * PostgREST's `or()` filter is a comma-separated, parenthesised mini-grammar.
 * A user typing `hip-hop, r&b (2010s)` would otherwise produce a syntactically
 * broken filter and a 400 — so strip the characters that carry meaning there.
 */
function sanitizeSearch(query: string): string {
  return query.replace(/[,()%*\\"']/g, ' ').trim();
}

/** Human-readable text for anything thrown by a mutation below. */
export function loungeErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function countBy<T>(rows: T[], key: (row: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const k = key(row);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

function profilesById(rows: ProfileRow[]): Map<string, ProfileRow> {
  return new Map(rows.map((row) => [row.id, row]));
}

// ---------------------------------------------------------------- reads

async function fetchMyLounges(userId: string): Promise<LoungeSummary[]> {
  const { data: memberships, error: membershipError } = await supabase
    .from('lounge_members')
    .select('lounge_id, role')
    .eq('user_id', userId);

  if (membershipError) throw membershipError;

  const loungeIds = memberships.map((row) => row.lounge_id);
  if (loungeIds.length === 0) return [];

  const [loungesRes, rosterRes, roomsRes] = await Promise.all([
    supabase.from('lounges').select('*').in('id', loungeIds),
    // Readable because RLS grants the roster of any lounge we belong to.
    supabase.from('lounge_members').select('lounge_id, user_id').in('lounge_id', loungeIds),
    supabase.from('rooms').select('id, lounge_id').in('lounge_id', loungeIds).eq('is_active', true),
  ]);

  if (loungesRes.error) throw loungesRes.error;
  if (rosterRes.error) throw rosterRes.error;
  if (roomsRes.error) throw roomsRes.error;

  const rooms = roomsRes.data;
  const roomToLounge = new Map(rooms.map((room) => [room.id, room.lounge_id]));

  // Distinct people, not participant rows: someone in two Sessions of the same
  // lounge is still one person listening.
  const listeners = new Map<string, Set<string>>();
  if (rooms.length > 0) {
    const { data: participants, error } = await supabase
      .from('room_participants')
      .select('room_id, user_id')
      .in(
        'room_id',
        rooms.map((room) => room.id),
      );
    if (error) throw error;

    for (const participant of participants) {
      const loungeId = roomToLounge.get(participant.room_id);
      if (!loungeId) continue;
      const seen = listeners.get(loungeId) ?? new Set<string>();
      seen.add(participant.user_id);
      listeners.set(loungeId, seen);
    }
  }

  const memberCounts = countBy(rosterRes.data, (row) => row.lounge_id);
  const sessionCounts = countBy(rooms, (room) => room.lounge_id);
  const roles = new Map(memberships.map((row) => [row.lounge_id, row.role]));

  return loungesRes.data
    .map((lounge) => ({
      lounge,
      role: roles.get(lounge.id) ?? ('member' as MemberRole),
      memberCount: memberCounts.get(lounge.id) ?? 1,
      activeSessions: sessionCounts.get(lounge.id) ?? 0,
      listeners: listeners.get(lounge.id)?.size ?? 0,
    }))
    // Live lounges float to the top — that is the whole reason to open this tab.
    .sort((a, b) => {
      if (a.activeSessions !== b.activeSessions) return b.activeSessions - a.activeSessions;
      return a.lounge.name.localeCompare(b.lounge.name);
    });
}

export function useMyLounges() {
  const userId = useCurrentUserId();

  return useQuery({
    queryKey: loungeKeys.mine(userId),
    enabled: userId !== null,
    queryFn: () => {
      // Unreachable while `enabled` is false; narrows the type without a cast.
      if (!userId) throw new Error('Not signed in.');
      return fetchMyLounges(userId);
    },
  });
}

async function fetchPublicLounges(
  search: string,
  userId: string | null,
): Promise<PublicLoungeSummary[]> {
  const base = supabase.from('lounges').select('*').eq('is_public', true);
  const term = sanitizeSearch(search);

  // `or()` lives on the filter builder, which `order()`/`limit()` trade away —
  // so the search filter has to be applied before those, not after.
  const filtered =
    term.length > 0 ? base.or(`name.ilike.%${term}%,description.ilike.%${term}%`) : base;

  const { data, error } = await filtered
    .order('created_at', { ascending: false })
    .limit(EXPLORE_LIMIT);

  if (error) throw error;

  if (!userId || data.length === 0) {
    return data.map((lounge) => ({ lounge, isMember: false }));
  }

  const { data: mine, error: mineError } = await supabase
    .from('lounge_members')
    .select('lounge_id')
    .eq('user_id', userId);

  if (mineError) throw mineError;

  const joined = new Set(mine.map((row) => row.lounge_id));
  return data.map((lounge) => ({ lounge, isMember: joined.has(lounge.id) }));
}

export function usePublicLounges(search: string) {
  const userId = useCurrentUserId();

  return useQuery({
    queryKey: loungeKeys.public(search, userId),
    queryFn: () => fetchPublicLounges(search, userId),
    staleTime: EXPLORE_STALE_MS,
    // Keeps the previous result on screen while a new search term resolves, so
    // typing does not flash the list back to skeletons on every keystroke.
    placeholderData: keepPreviousData,
  });
}

async function fetchLounge(loungeId: string, userId: string | null): Promise<LoungeDetail> {
  const [loungeRes, membershipRes] = await Promise.all([
    supabase.from('lounges').select('*').eq('id', loungeId).maybeSingle(),
    userId
      ? supabase
          .from('lounge_members')
          .select('role')
          .eq('lounge_id', loungeId)
          .eq('user_id', userId)
          .maybeSingle()
      : Promise.resolve(null),
  ]);

  if (loungeRes.error) throw loungeRes.error;
  if (membershipRes?.error) throw membershipRes.error;

  const role = membershipRes?.data?.role ?? null;
  return { lounge: loungeRes.data, role, isMember: role !== null };
}

export function useLounge(loungeId: string) {
  const { userId, resolved } = useCurrentUser();

  return useQuery({
    queryKey: loungeKeys.detail(loungeId, userId),
    // Waiting for the session matters here: fetching with a not-yet-known id
    // skips the membership lookup and caches `isMember: false` under the
    // anonymous key, which a returning member then reads on their next visit
    // as a full-screen "Join this lounge" for a lounge they are already in.
    enabled: loungeId.length > 0 && resolved,
    queryFn: () => fetchLounge(loungeId, userId),
  });
}

async function fetchLoungeMembers(loungeId: string): Promise<LoungeMemberEntry[]> {
  const { data: rows, error } = await supabase
    .from('lounge_members')
    .select('user_id, role, joined_at')
    .eq('lounge_id', loungeId);

  if (error) throw error;
  if (rows.length === 0) return [];

  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .in(
      'id',
      rows.map((row) => row.user_id),
    );

  if (profileError) throw profileError;

  const byId = profilesById(profiles);

  return rows
    .map((row) => ({
      userId: row.user_id,
      role: row.role,
      joinedAt: row.joined_at,
      profile: byId.get(row.user_id) ?? null,
    }))
    .sort((a, b) => {
      const rank = ROLE_RANK[a.role] - ROLE_RANK[b.role];
      return rank !== 0 ? rank : a.joinedAt.localeCompare(b.joinedAt);
    });
}

export function useLoungeMembers(loungeId: string) {
  return useQuery({
    queryKey: loungeKeys.members(loungeId),
    enabled: loungeId.length > 0,
    queryFn: () => fetchLoungeMembers(loungeId),
  });
}

/**
 * Active Sessions in a lounge, with enough context to decide whether to join:
 * who is on aux, how many people are already there, and what is playing.
 */
async function fetchLoungeSessions(loungeId: string): Promise<LoungeSessionSummary[]> {
  const { data: rooms, error } = await supabase
    .from('rooms')
    .select('*')
    .eq('lounge_id', loungeId)
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  if (error) throw error;
  if (rooms.length === 0) return [];

  const roomIds = rooms.map((room) => room.id);
  const hostIds = Array.from(new Set(rooms.map((room) => room.host_id)));
  const trackIds = Array.from(
    new Set(rooms.map((room) => room.track_id).filter((id): id is string => id !== null)),
  );

  const [participantsRes, hostsRes, tracksRes] = await Promise.all([
    supabase.from('room_participants').select('room_id, user_id').in('room_id', roomIds),
    supabase.from('profiles').select('*').in('id', hostIds),
    // A brand-new Session has no track yet; skip the round trip entirely.
    trackIds.length > 0
      ? supabase.from('tracks').select('id, title, artist').in('id', trackIds)
      : Promise.resolve(null),
  ]);

  if (participantsRes.error) throw participantsRes.error;
  if (hostsRes.error) throw hostsRes.error;
  if (tracksRes?.error) throw tracksRes.error;

  const listeners = countBy(participantsRes.data, (row) => row.room_id);
  const hosts = profilesById(hostsRes.data);
  const tracks = new Map((tracksRes?.data ?? []).map((track) => [track.id, track]));

  return rooms.map((room) => {
    const track = room.track_id ? tracks.get(room.track_id) : undefined;
    return {
      room,
      listeners: listeners.get(room.id) ?? 0,
      hostName: hosts.get(room.host_id)?.display_name || 'Someone',
      nowPlaying: track ? { title: track.title, artist: track.artist } : null,
    };
  });
}

export function useLoungeSessions(loungeId: string) {
  return useQuery({
    queryKey: loungeKeys.sessions(loungeId),
    enabled: loungeId.length > 0,
    queryFn: () => fetchLoungeSessions(loungeId),
  });
}

// ---------------------------------------------------------------- writes

export function useCreateLounge() {
  const queryClient = useQueryClient();
  const userId = useCurrentUserId();

  return useMutation({
    mutationFn: async (input: CreateLoungeInput): Promise<LoungeRow> => {
      if (!userId) throw new Error('Sign in before creating a lounge.');

      /*
        Insert the lounge and nothing else. `on_lounge_created` adds the owner
        to `lounge_members` in the same transaction; inserting the membership
        here as well would race that trigger and violate the composite PK.
      */
      const { data, error } = await supabase
        .from('lounges')
        .insert({
          name: input.name.trim(),
          slug: slugify(input.name),
          description: input.description.trim(),
          is_public: input.isPublic,
          owner_id: userId,
        })
        .select('*')
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: loungeKeys.all });
    },
  });
}

export function useJoinByCode() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (code: string): Promise<string> => {
      const { data, error } = await supabase.rpc('join_lounge_by_code', {
        // Codes are stored uppercase; a lowercase paste would silently miss.
        p_code: code.trim().toUpperCase(),
      });

      if (error) {
        if (error.message.includes('invalid_invite_code')) {
          throw new Error('That code does not match any lounge. Check it and try again.');
        }
        throw error;
      }

      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: loungeKeys.all });
    },
  });
}

/**
 * Join a lounge you can already see — i.e. a public one found via Explore.
 * Private lounges never reach this path: RLS hides them until an invite code
 * has been redeemed through `join_lounge_by_code`.
 */
export function useJoinLounge() {
  const queryClient = useQueryClient();
  const userId = useCurrentUserId();

  return useMutation({
    mutationFn: async (loungeId: string): Promise<void> => {
      if (!userId) throw new Error('Sign in before joining a lounge.');

      const { error } = await supabase
        .from('lounge_members')
        .insert({ lounge_id: loungeId, user_id: userId, role: 'member' });

      // 23505 = unique violation: already a member. That is the desired end
      // state, so treat a double-tap as success rather than an error.
      if (error && error.code !== '23505') throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: loungeKeys.all });
    },
  });
}

export function useLeaveLounge() {
  const queryClient = useQueryClient();
  const userId = useCurrentUserId();

  return useMutation({
    mutationFn: async (loungeId: string): Promise<void> => {
      if (!userId) throw new Error('Sign in first.');

      const { error } = await supabase
        .from('lounge_members')
        .delete()
        .eq('lounge_id', loungeId)
        .eq('user_id', userId);

      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: loungeKeys.all });
    },
  });
}

/**
 * Open a Session in a lounge and become the host — "on aux".
 *
 * Playback state stays null: `rooms_playing_needs_track` forbids `is_playing`
 * without a track, so the room is created idle and the first `room_play` call
 * establishes the timeline.
 */
export function useStartSession() {
  const queryClient = useQueryClient();
  const userId = useCurrentUserId();

  return useMutation({
    mutationFn: async (loungeId: string): Promise<RoomRow> => {
      if (!userId) throw new Error('Sign in before starting a Session.');

      const { data, error } = await supabase
        .from('rooms')
        .insert({ lounge_id: loungeId, host_id: userId, name: 'Session' })
        .select('*')
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: loungeKeys.all });
    },
  });
}
