/**
 * Data access for a live Session.
 *
 * Two rules shape everything in here:
 *
 * 1. No PostgREST embeds. `database.types.ts` is hand-authored with
 *    `Relationships: []`, so an embedded select (`select('*, profiles(*)')`)
 *    types as `never` and silently loses the join at compile time. Every join
 *    below is two indexed queries stitched in JS instead.
 * 2. Realtime owns freshness. Queries are effectively `staleTime: Infinity`
 *    and are invalidated by the channel subscriptions, so a chatty Session does
 *    not also poll.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useEffect } from 'react';

import { loadResolvedTrack } from '@/features/tracks/resolve';
import type {
  LoungeRow,
  ProfileRow,
  RoomRow,
  TrackRow,
} from '@/lib/database.types';
import { supabase } from '@/lib/supabase';
import type { ResolvedTrack } from '@/playback/types';

// ------------------------------------------------------------------- keys

export const roomKeys = {
  all: ['rooms'] as const,
  me: ['auth', 'user-id'] as const,
  detail: (roomId: string) => ['rooms', 'detail', roomId] as const,
  participants: (roomId: string) => ['rooms', 'participants', roomId] as const,
  queue: (roomId: string) => ['rooms', 'queue', roomId] as const,
  lounge: (loungeId: string) => ['lounges', 'detail', loungeId] as const,
  myLounges: ['lounges', 'mine'] as const,
  resolvedTrack: (trackId: string) => ['tracks', 'resolved', trackId] as const,
};

// -------------------------------------------------------------- view models

export type ParticipantView = {
  userId: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  isSynced: boolean;
  joinedAt: string;
};

export type QueueEntry = {
  id: string;
  trackId: string;
  position: number;
  track: TrackRow;
  addedById: string;
  addedByName: string;
  addedByAvatar: string | null;
};

// ------------------------------------------------------------------ helpers

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asOptionalNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Realtime hands us the raw WAL row, where `bigint` columns can arrive as
 * strings. Normalising at the door means nothing downstream has to defend
 * against `"1750000000000" - 0`.
 */
export function normalizeRoomRow(value: unknown): RoomRow | null {
  if (!isRecord(value) || typeof value.id !== 'string') return null;

  return {
    id: value.id,
    lounge_id: typeof value.lounge_id === 'string' ? value.lounge_id : '',
    name: typeof value.name === 'string' ? value.name : 'Session',
    host_id: typeof value.host_id === 'string' ? value.host_id : '',
    track_id: typeof value.track_id === 'string' ? value.track_id : null,
    started_at_ms: asOptionalNumber(value.started_at_ms),
    paused_at_ms: asOptionalNumber(value.paused_at_ms),
    is_playing: value.is_playing === true,
    is_active: value.is_active !== false,
    created_at: typeof value.created_at === 'string' ? value.created_at : '',
  };
}

/** `id -> profile` for the handful of people in one Session. */
async function loadProfiles(ids: string[]): Promise<Map<string, ProfileRow>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();

  const { data, error } = await supabase.from('profiles').select('*').in('id', unique);
  if (error) throw error;

  return new Map((data ?? []).map((profile) => [profile.id, profile]));
}

/**
 * Ref-counted realtime channels, keyed by topic.
 *
 * `useQueue` is mounted by both the room screen (for the queue length) and the
 * queue list itself. Two `supabase.channel()` calls with the same topic open two
 * server-side subscriptions delivering identical payloads, so the first mount
 * opens the channel and the last unmount closes it.
 */
/**
 * `@supabase/supabase-js` does not re-export `RealtimeChannel`, and
 * `@supabase/realtime-js` is a transitive dependency we should not import
 * directly. Deriving it from the client keeps the type exact and the dependency
 * list honest.
 */
type RealtimeChannel = ReturnType<typeof supabase.channel>;

const sharedChannels = new Map<string, { channel: RealtimeChannel; refs: number }>();

function acquireChannel(topic: string, build: () => RealtimeChannel): () => void {
  const existing = sharedChannels.get(topic);

  if (existing) {
    existing.refs += 1;
  } else {
    sharedChannels.set(topic, { channel: build().subscribe(), refs: 1 });
  }

  return () => {
    const entry = sharedChannels.get(topic);
    if (!entry) return;

    entry.refs -= 1;
    if (entry.refs > 0) return;

    sharedChannels.delete(topic);
    void supabase.removeChannel(entry.channel);
  };
}

/**
 * Subscribes to one table's changes and invalidates a query key on any of them.
 *
 * Invalidate rather than patch the cache: queue and participant rows are joined
 * to profiles and tracks in JS, so a raw INSERT payload cannot be spliced in
 * without a second fetch anyway.
 */
function useTableInvalidation(
  roomId: string | null,
  table: 'queue_items' | 'room_participants'
): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!roomId) return;

    const queryKey =
      table === 'queue_items' ? roomKeys.queue(roomId) : roomKeys.participants(roomId);

    return acquireChannel(`${table}:${roomId}`, () =>
      supabase
        .channel(`${table}:${roomId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table, filter: `room_id=eq.${roomId}` },
          () => {
            void queryClient.invalidateQueries({ queryKey });
          }
        )
    );
  }, [roomId, table, queryClient]);
}

// ------------------------------------------------------------------ queries

/** The signed-in user's id, or null while auth is still resolving. */
export function useCurrentUserId(): string | null {
  const { data } = useQuery({
    queryKey: roomKeys.me,
    queryFn: async (): Promise<string | null> => {
      const { data: auth } = await supabase.auth.getUser();
      return auth.user?.id ?? null;
    },
    staleTime: Infinity,
  });

  return data ?? null;
}

export function useRoom(roomId: string | null) {
  return useQuery({
    queryKey: roomKeys.detail(roomId ?? 'none'),
    enabled: Boolean(roomId),
    // The realtime channel in use-room-sync is the only writer after the first
    // fetch; refetching on top of it would just race the socket.
    staleTime: Infinity,
    queryFn: async (): Promise<RoomRow> => {
      if (!roomId) throw new Error('No Session id.');

      const { data, error } = await supabase.from('rooms').select('*').eq('id', roomId).single();
      if (error) throw error;

      return normalizeRoomRow(data) ?? data;
    },
  });
}

export function useLounge(loungeId: string | null) {
  return useQuery({
    queryKey: roomKeys.lounge(loungeId ?? 'none'),
    enabled: Boolean(loungeId),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<LoungeRow> => {
      if (!loungeId) throw new Error('No lounge id.');

      const { data, error } = await supabase
        .from('lounges')
        .select('*')
        .eq('id', loungeId)
        .single();
      if (error) throw error;
      return data;
    },
  });
}

/** Every lounge this user belongs to — the picker on the create-Session screen. */
export function useMyLounges() {
  const userId = useCurrentUserId();

  return useQuery({
    queryKey: roomKeys.myLounges,
    enabled: Boolean(userId),
    staleTime: 60_000,
    queryFn: async (): Promise<LoungeRow[]> => {
      if (!userId) return [];

      const { data: memberships, error: memberError } = await supabase
        .from('lounge_members')
        .select('lounge_id')
        .eq('user_id', userId);
      if (memberError) throw memberError;

      const ids = (memberships ?? []).map((row) => row.lounge_id);
      if (ids.length === 0) return [];

      const { data, error } = await supabase
        .from('lounges')
        .select('*')
        .in('id', ids)
        .order('name');
      if (error) throw error;

      return data ?? [];
    },
  });
}

/**
 * The catalog track plus its provider links.
 *
 * Cached hard and never garbage-collected quickly: the same track comes back
 * every time the room row echoes, and re-fetching links on each realtime UPDATE
 * would put two queries in front of every play/pause.
 */
export function useResolvedTrack(trackId: string | null) {
  return useQuery({
    queryKey: roomKeys.resolvedTrack(trackId ?? 'none'),
    enabled: Boolean(trackId),
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    queryFn: async (): Promise<ResolvedTrack> => {
      if (!trackId) throw new Error('No track id.');
      return loadResolvedTrack(trackId);
    },
  });
}

export function useRoomParticipants(roomId: string | null) {
  useTableInvalidation(roomId, 'room_participants');

  return useQuery({
    queryKey: roomKeys.participants(roomId ?? 'none'),
    enabled: Boolean(roomId),
    staleTime: Infinity,
    queryFn: async (): Promise<ParticipantView[]> => {
      if (!roomId) return [];

      const { data, error } = await supabase
        .from('room_participants')
        .select('*')
        .eq('room_id', roomId)
        .order('joined_at');
      if (error) throw error;

      const rows = data ?? [];
      const profiles = await loadProfiles(rows.map((row) => row.user_id));

      return rows.map((row) => {
        const profile = profiles.get(row.user_id);
        return {
          userId: row.user_id,
          displayName: profile?.display_name || profile?.username || 'Someone',
          username: profile?.username ?? '',
          avatarUrl: profile?.avatar_url ?? null,
          isSynced: row.is_synced,
          joinedAt: row.joined_at,
        };
      });
    },
  });
}

/** Upcoming queue only — `played_at` is stamped by `room_advance`. */
export function useQueue(roomId: string | null) {
  useTableInvalidation(roomId, 'queue_items');

  return useQuery({
    queryKey: roomKeys.queue(roomId ?? 'none'),
    enabled: Boolean(roomId),
    staleTime: Infinity,
    queryFn: async (): Promise<QueueEntry[]> => {
      if (!roomId) return [];

      const { data, error } = await supabase
        .from('queue_items')
        .select('*')
        .eq('room_id', roomId)
        .is('played_at', null)
        .order('position');
      if (error) throw error;

      const rows = data ?? [];
      if (rows.length === 0) return [];

      const [{ data: tracks, error: trackError }, profiles] = await Promise.all([
        supabase.from('tracks').select('*').in('id', [...new Set(rows.map((r) => r.track_id))]),
        loadProfiles(rows.map((row) => row.added_by)),
      ]);
      if (trackError) throw trackError;

      const trackById = new Map((tracks ?? []).map((track) => [track.id, track]));

      const entries: QueueEntry[] = [];
      for (const row of rows) {
        const track = trackById.get(row.track_id);
        // A track deleted out from under the queue would render as a blank row;
        // dropping it is honest, and `room_advance` skips it server-side anyway.
        if (!track) continue;

        const profile = profiles.get(row.added_by);
        entries.push({
          id: row.id,
          trackId: row.track_id,
          position: row.position,
          track,
          addedById: row.added_by,
          addedByName: profile?.display_name || profile?.username || 'Someone',
          addedByAvatar: profile?.avatar_url ?? null,
        });
      }
      return entries;
    },
  });
}

// ---------------------------------------------------------------- mutations

/**
 * The host's transport. Every call is an RPC because the *server* clock stamps
 * the timeline — a client-computed `started_at_ms` would desync everyone by
 * exactly this device's clock error.
 */
export function useTransport(roomId: string | null) {
  const queryClient = useQueryClient();

  const applyRoom = (row: unknown) => {
    if (!roomId) return;
    const next = normalizeRoomRow(row);
    // Optimistically seed the cache from the RPC's returned row so the host's
    // own UI does not wait for the realtime echo of its own action.
    if (next) queryClient.setQueryData(roomKeys.detail(roomId), next);
  };

  const play = useMutation({
    mutationFn: async ({ trackId, positionMs = 0 }: { trackId: string; positionMs?: number }) => {
      if (!roomId) throw new Error('No Session id.');
      const { data, error } = await supabase.rpc('room_play', {
        p_room_id: roomId,
        p_track_id: trackId,
        p_position_ms: Math.round(positionMs),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: applyRoom,
  });

  const pause = useMutation({
    mutationFn: async () => {
      if (!roomId) throw new Error('No Session id.');
      const { data, error } = await supabase.rpc('room_pause', { p_room_id: roomId });
      if (error) throw error;
      return data;
    },
    onSuccess: applyRoom,
  });

  const resume = useMutation({
    mutationFn: async () => {
      if (!roomId) throw new Error('No Session id.');
      const { data, error } = await supabase.rpc('room_resume', { p_room_id: roomId });
      if (error) throw error;
      return data;
    },
    onSuccess: applyRoom,
  });

  const seek = useMutation({
    mutationFn: async (positionMs: number) => {
      if (!roomId) throw new Error('No Session id.');
      const { data, error } = await supabase.rpc('room_seek', {
        p_room_id: roomId,
        p_position_ms: Math.max(0, Math.round(positionMs)),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: applyRoom,
  });

  const advance = useMutation({
    mutationFn: async () => {
      if (!roomId) throw new Error('No Session id.');
      const { data, error } = await supabase.rpc('room_advance', { p_room_id: roomId });
      if (error) throw error;
      return data;
    },
    onSuccess: (row) => {
      applyRoom(row);
      if (roomId) void queryClient.invalidateQueries({ queryKey: roomKeys.queue(roomId) });
    },
  });

  return {
    play,
    pause,
    resume,
    seek,
    advance,
    isBusy:
      play.isPending ||
      pause.isPending ||
      resume.isPending ||
      seek.isPending ||
      advance.isPending,
  };
}

/** Anyone in the Session can queue. That is the whole point of the app. */
export function useAddToQueue(roomId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (trackId: string) => {
      if (!roomId) throw new Error('No Session id.');
      const { data, error } = await supabase.rpc('queue_append', {
        p_room_id: roomId,
        p_track_id: trackId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      if (roomId) void queryClient.invalidateQueries({ queryKey: roomKeys.queue(roomId) });
    },
  });
}

/** RLS allows the adder or the host; the UI hides the control for everyone else. */
export function useRemoveQueueItem(roomId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (queueItemId: string) => {
      const { error } = await supabase.from('queue_items').delete().eq('id', queueItemId);
      if (error) throw error;
    },
    onSuccess: () => {
      if (roomId) void queryClient.invalidateQueries({ queryKey: roomKeys.queue(roomId) });
    },
  });
}

/**
 * The non-host "request the aux" action. It is a real chat message rather than
 * a bespoke notification table: the host is already looking at the chat, and a
 * request everyone can see is the social pressure that actually gets the aux
 * handed over.
 */
export function useRequestAux(roomId: string | null, loungeId: string | null) {
  const userId = useCurrentUserId();

  return useMutation({
    mutationFn: async () => {
      if (!roomId || !loungeId || !userId) throw new Error('Not in a Session.');

      const { error } = await supabase.from('messages').insert({
        lounge_id: loungeId,
        room_id: roomId,
        user_id: userId,
        body: 'Can I get the aux?',
      });
      if (error) throw error;
    },
  });
}

export function useCreateRoom() {
  const queryClient = useQueryClient();
  const userId = useCurrentUserId();

  return useMutation({
    mutationFn: async ({ loungeId, name }: { loungeId: string; name: string }): Promise<RoomRow> => {
      if (!userId) throw new Error('You need to be signed in to start a Session.');

      const { data, error } = await supabase
        .from('rooms')
        .insert({ lounge_id: loungeId, host_id: userId, name: name.trim() || 'Session' })
        .select('*')
        .single();
      if (error) throw error;

      return normalizeRoomRow(data) ?? data;
    },
    onSuccess: (room) => {
      queryClient.setQueryData(roomKeys.detail(room.id), room);
      void queryClient.invalidateQueries({ queryKey: roomKeys.all });
    },
  });
}

/** Imperative cache seed, for callers outside the React tree. */
export function seedRoom(queryClient: QueryClient, room: RoomRow): void {
  queryClient.setQueryData(roomKeys.detail(room.id), room);
}
