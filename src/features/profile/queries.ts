/**
 * Profile reads and writes.
 *
 * This module is deliberately a leaf: it imports `@/lib/supabase` and nothing
 * from `@/lib/auth`, because AuthProvider imports `fetchProfile` from here to
 * fill its context. Anything that needs the signed-in id takes it as an
 * argument rather than reaching for the auth context.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import type { LoungeRow, MemberRole, ProfileRow } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';

/** Mirrors the CHECK constraint on profiles.username — keep the two in step. */
export const USERNAME_PATTERN = /^[a-z0-9_]+$/;
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;

/**
 * Long enough that typing a whole handle costs one availability request rather
 * than one per keystroke, short enough that the verdict lands before the thumb
 * reaches the save button.
 */
export const AVAILABILITY_DEBOUNCE_MS = 400;

export const profileKeys = {
  /**
   * `useSpotifyLink` invalidates exactly `['profile']` after linking, and every
   * key below is a child of it so one invalidation refreshes all of them.
   * Do not rename this root.
   */
  all: ['profile'] as const,
  detail: (userId: string) => ['profile', userId] as const,
  username: (username: string) => ['profile', 'username', username] as const,
};

/**
 * The lounges a user belongs to.
 *
 * Keyed under the `lounges` root, not `profile`: what makes this list wrong is
 * joining or leaving a lounge, and every lounge mutation invalidates
 * `['lounges']` (see `loungeKeys.all`). Under `profile` it was refreshed only
 * by profile edits, which never change it — so the Profile tab kept showing a
 * lounge the user had already left. Written out rather than imported to keep
 * this module a leaf.
 */
export const memberLoungesKey = (userId: string) =>
  ['lounges', 'profile', userId] as const;

/* ------------------------------------------------------------------ profile */

export async function fetchProfile(userId: string): Promise<ProfileRow | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  // `maybeSingle` rather than `single`: the row is created by a trigger on
  // auth.users, and a missing row is a state the UI can explain ("finishing
  // setup") far better than a thrown PGRST116.
  return data;
}

export function useProfile(userId: string | undefined) {
  return useQuery({
    queryKey: profileKeys.detail(userId ?? 'anonymous'),
    queryFn: () => fetchProfile(userId as string),
    enabled: Boolean(userId),
    staleTime: 60_000,
  });
}

export type ProfilePatch = {
  username?: string;
  display_name?: string;
  avatar_url?: string | null;
};

/** Postgres SQLSTATEs the profile form can actually provoke. */
const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';

export async function updateProfile(userId: string, patch: ProfilePatch): Promise<ProfileRow> {
  const { data, error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', userId)
    .select()
    .single();

  if (error) {
    // The availability check is advisory — two people can pass it in the same
    // second. The unique index is the real arbiter, so translate it rather than
    // letting a raw Postgres string reach a toast.
    if (error.code === UNIQUE_VIOLATION) {
      throw new Error('That username was just taken. Try another one.');
    }
    if (error.code === CHECK_VIOLATION) {
      throw new Error('That username has characters the server will not accept.');
    }
    throw new Error(error.message);
  }

  return data;
}

export function useUpdateProfile(userId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (patch: ProfilePatch) => updateProfile(userId as string, patch),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: profileKeys.all });
    },
  });
}

/* ----------------------------------------------------------------- username */

/** Human-readable reason this handle is not usable, or null if it is fine. */
export function usernameProblem(value: string): string | null {
  if (value.length === 0) return 'Pick a username.';
  if (value.length < USERNAME_MIN) return `At least ${USERNAME_MIN} characters.`;
  if (value.length > USERNAME_MAX) return `At most ${USERNAME_MAX} characters.`;
  if (!USERNAME_PATTERN.test(value)) {
    return 'Lowercase letters, numbers and underscores only.';
  }
  return null;
}

/**
 * Canonicalises as the user types: lowercase, no whitespace, capped at the
 * constraint's length. Characters the constraint rejects are left in place on
 * purpose — silently deleting them looks like a broken keyboard, whereas
 * `usernameProblem` can say what is wrong.
 */
export function normalizeUsername(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, '').slice(0, USERNAME_MAX);
}

export async function isUsernameTaken(username: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('username', username)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data !== null;
}

export type UsernameStatus = 'idle' | 'invalid' | 'checking' | 'available' | 'taken';

export type UsernameAvailability = {
  status: UsernameStatus;
  /** Why it is invalid or taken. Null while idle/checking/available. */
  message: string | null;
};

/**
 * Live availability for a handle the user is still typing.
 *
 * `currentUsername` short-circuits the request: your own handle always reads as
 * available, otherwise reopening this screen shows your name as "taken".
 */
export function useUsernameAvailability(
  raw: string,
  currentUsername?: string | null
): UsernameAvailability {
  const value = normalizeUsername(raw);
  const problem = usernameProblem(value);
  const debounced = useDebounced(value, AVAILABILITY_DEBOUNCE_MS);

  const isOwn = Boolean(currentUsername) && value === currentUsername;
  const settled = debounced === value;
  const enabled = !problem && !isOwn && settled;

  const query = useQuery({
    queryKey: profileKeys.username(debounced),
    queryFn: () => isUsernameTaken(debounced),
    enabled,
    // A handle freed up seconds ago is vanishingly rare; the write path catches
    // the race anyway, so caching the verdict keeps backspacing free.
    staleTime: 30_000,
    retry: false,
  });

  if (value.length === 0) return { status: 'idle', message: null };
  if (problem) return { status: 'invalid', message: problem };
  if (isOwn) return { status: 'available', message: null };
  // Checked before the `data === undefined` guard below: a failed request also
  // has undefined data, and reporting it as "checking" would spin forever.
  if (query.error) {
    return { status: 'invalid', message: 'Could not check that name. Try again.' };
  }
  if (!settled || query.isFetching || query.data === undefined) {
    return { status: 'checking', message: null };
  }
  return query.data
    ? { status: 'taken', message: 'That username is already taken.' }
    : { status: 'available', message: null };
}

/* ------------------------------------------------------------------ lounges */

export type MyLounge = {
  lounge: LoungeRow;
  role: MemberRole;
  joinedAt: string;
};

/**
 * The lounges this user belongs to, most recently joined first.
 *
 * Two round trips rather than one embedded select: the hand-authored
 * `Database` type declares no `Relationships`, so PostgREST embedding
 * (`lounges (*)`) resolves to an error type at compile time. Two typed queries
 * cost one extra hop and keep the result honestly typed.
 */
export async function fetchMyLounges(userId: string): Promise<MyLounge[]> {
  const { data: memberships, error: membershipError } = await supabase
    .from('lounge_members')
    .select('lounge_id, role, joined_at')
    .eq('user_id', userId)
    .order('joined_at', { ascending: false });

  if (membershipError) throw new Error(membershipError.message);
  if (!memberships || memberships.length === 0) return [];

  const { data: lounges, error: loungeError } = await supabase
    .from('lounges')
    .select('*')
    .in(
      'id',
      memberships.map((m) => m.lounge_id)
    );

  if (loungeError) throw new Error(loungeError.message);

  const byId = new Map((lounges ?? []).map((lounge) => [lounge.id, lounge]));

  return memberships.flatMap((membership) => {
    const lounge = byId.get(membership.lounge_id);
    // A private lounge the user was removed from can leave a membership row
    // that RLS no longer lets us read. Drop it rather than render a ghost.
    if (!lounge) return [];
    return [{ lounge, role: membership.role, joinedAt: membership.joined_at }];
  });
}

export function useMyLounges(userId: string | undefined) {
  return useQuery({
    queryKey: memberLoungesKey(userId ?? 'anonymous'),
    queryFn: () => fetchMyLounges(userId as string),
    enabled: Boolean(userId),
  });
}

/* -------------------------------------------------------------------- utils */

function useDebounced<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return settled;
}
