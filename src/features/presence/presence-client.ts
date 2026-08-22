/**
 * Presence transport for the Feed.
 *
 * "Who is listening to what, right now" is ephemeral by nature, so it rides on
 * Supabase Realtime PRESENCE rather than Postgres. Rows would mean a write per
 * user every few seconds, a delete on a disconnect we usually never observe,
 * and a janitor job for the ones we miss. Presence lives on the socket, the
 * server drops it the instant the socket dies, and nothing touches the
 * database — which also leaves the free tier's row budget for the things that
 * genuinely have to persist.
 *
 * One channel per lounge, shared and ref-counted. The Feed watches N lounges
 * and the broadcaster publishes into the same N; opening a second socket per
 * lounge would double the heartbeat traffic to learn nothing.
 */

import { REALTIME_SUBSCRIBE_STATES, type RealtimeChannel } from '@supabase/supabase-js';

import type { MusicProvider } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';

/** How often a client re-publishes itself while foregrounded. */
export const PRESENCE_HEARTBEAT_MS = 8_000;

/** How often we ask Spotify what is playing outside of Aux. */
export const SPOTIFY_POLL_MS = 25_000;

/**
 * Anything older than this is a zombie: a client whose socket froze without a
 * clean close. Generous next to the heartbeat because a phone on a bad network
 * legitimately misses a few beats.
 */
export const PRESENCE_STALE_MS = 45_000;

/**
 * What one client publishes about itself.
 *
 * Deliberately self-contained — the Feed renders straight from this with no
 * follow-up queries, which is what lets "who is listening to what" land in one
 * frame instead of N round trips per lounge.
 */
export type PresencePayload = {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  /** Null when the person is online but not playing anything. */
  trackTitle: string | null;
  artist: string | null;
  artworkUrl: string | null;
  provider: MusicProvider | null;
  /** Position as of `updatedAt`. Receivers extrapolate forward from this pair. */
  positionMs: number;
  durationMs: number;
  /**
   * Not in the original payload sketch, and it earned its place: without it a
   * receiver cannot tell a paused peer from a playing one, so every paused
   * listener's progress bar would creep forward for eight seconds and then
   * snap backwards on the next beat.
   */
  isPlaying: boolean;
  /** Set when this person is in a live Session other people can join. */
  roomId: string | null;
  /**
   * Server clock (see @/lib/clock), never Date.now(). Device clocks are
   * routinely seconds apart; if the publisher stamped its own clock and the
   * receiver subtracted its own, every progress bar in the lounge would start
   * seconds ahead or behind for no visible reason.
   */
  updatedAt: number;
};

// ------------------------------------------------------------------ validation

const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';

const isProvider = (value: unknown): value is MusicProvider | null =>
  value === null || value === 'spotify' || value === 'youtube';

/**
 * Realtime Authorization now limits the channel to lounge members, but every
 * member still composes their own payload client-side, so this is untrusted
 * input either way. A malformed payload reaching a list row would take the
 * whole Feed down, so narrow here and drop whatever does not fit.
 */
export function isPresencePayload(value: unknown): value is PresencePayload {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Record<string, unknown>;

  return (
    typeof p.userId === 'string' &&
    p.userId.length > 0 &&
    typeof p.username === 'string' &&
    typeof p.displayName === 'string' &&
    isNullableString(p.avatarUrl) &&
    isNullableString(p.trackTitle) &&
    isNullableString(p.artist) &&
    isNullableString(p.artworkUrl) &&
    isProvider(p.provider) &&
    typeof p.positionMs === 'number' &&
    Number.isFinite(p.positionMs) &&
    typeof p.durationMs === 'number' &&
    Number.isFinite(p.durationMs) &&
    typeof p.isPlaying === 'boolean' &&
    isNullableString(p.roomId) &&
    typeof p.updatedAt === 'number' &&
    Number.isFinite(p.updatedAt)
  );
}

/**
 * Where a peer actually is now, interpolated from their last beat. Callers tick
 * this locally so a progress bar moves smoothly instead of jumping once every
 * PRESENCE_HEARTBEAT_MS.
 */
export function livePositionMs(payload: PresencePayload, nowMs: number): number {
  if (payload.durationMs <= 0) return 0;

  const base = Math.max(0, payload.positionMs);
  if (!payload.isPlaying) return Math.min(payload.durationMs, base);

  const elapsed = Math.max(0, nowMs - payload.updatedAt);
  return Math.min(payload.durationMs, base + elapsed);
}

// -------------------------------------------------------------- channel registry

type Listener = (members: PresencePayload[]) => void;

type LoungeEntry = {
  channel: RealtimeChannel;
  listeners: Set<Listener>;
  /** Watchers plus the publisher. The channel closes when this reaches zero. */
  refs: number;
  members: PresencePayload[];
  /** True once the server has sent at least one presence snapshot. */
  synced: boolean;
  /** Mirrors the subscribe status so we never track into a dead channel. */
  joined: boolean;
  /** Resolves when the first subscribe attempt settles, either way. */
  ready: Promise<void>;
};

const entries = new Map<string, LoungeEntry>();

/** Lounges this client is currently tracked in. */
const published = new Set<string>();

const topicFor = (loungeId: string) => `lounge:${loungeId}`;

function acquire(loungeId: string): LoungeEntry {
  const existing = entries.get(loungeId);
  if (existing) {
    existing.refs += 1;
    return existing;
  }

  const channel = supabase.channel(topicFor(loungeId), {
    config: {
      // Without `enabled` this client would publish but never receive: the
      // presence state machine buffers incoming updates until it has asked for
      // an initial snapshot, and it only asks when this flag is set.
      presence: { enabled: true },
      // Realtime runs NO authorization on a public topic, so without this the
      // Realtime Authorization policies in
      // supabase/migrations/20260821000400_realtime_authorization.sql are
      // inert: anyone with the bundled anon key could join `lounge:<uuid>` for
      // a lounge they are not in. Private makes the join go through them.
      private: true,
    },
  });

  let settle: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    settle = resolve;
  });

  const entry: LoungeEntry = {
    channel,
    listeners: new Set(),
    refs: 1,
    members: [],
    synced: false,
    joined: false,
    ready,
  };
  entries.set(loungeId, entry);

  const readState = () => {
    const next: PresencePayload[] = [];
    for (const group of Object.values(channel.presenceState())) {
      for (const candidate of group as unknown[]) {
        if (isPresencePayload(candidate)) next.push(candidate);
      }
    }

    entry.members = next;
    entry.synced = true;
    for (const listener of entry.listeners) listener(next);
  };

  channel
    // `sync` alone is enough: the presence state machine applies every join and
    // leave diff and then fires sync, so binding all three would re-read the
    // same state three times per change.
    .on('presence', { event: 'sync' }, readState)
    .subscribe((status) => {
      entry.joined = status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED;
      // Release waiters on any terminal status. `trackIn` re-checks `joined`
      // before publishing, and the next heartbeat heals a reconnect anyway.
      settle();
    });

  return entry;
}

function release(loungeId: string): void {
  const entry = entries.get(loungeId);
  if (!entry) return;

  entry.refs -= 1;
  if (entry.refs > 0) return;

  entries.delete(loungeId);
  // removeChannel rather than unsubscribe, so the client forgets the topic too;
  // otherwise a later channel(topic) hands back the half-torn-down instance.
  void supabase.removeChannel(entry.channel).catch(() => undefined);
}

/**
 * Watch one lounge. Returns an unsubscribe function; the underlying channel
 * survives until every watcher and the publisher have let go of it.
 */
export function watchLoungePresence(loungeId: string, onChange: Listener): () => void {
  const entry = acquire(loungeId);
  entry.listeners.add(onChange);

  // A lounge mounted later must not sit blank waiting for the next diff on a
  // channel that already synced.
  if (entry.synced) onChange(entry.members);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    entry.listeners.delete(onChange);
    release(loungeId);
  };
}

async function trackIn(loungeId: string, payload: PresencePayload): Promise<void> {
  let entry = entries.get(loungeId);
  if (!published.has(loungeId) || !entry) {
    entry = acquire(loungeId);
    published.add(loungeId);
  }

  await entry.ready;
  // A dropped socket leaves the channel errored. Skipping costs one beat, and
  // the next one lands as soon as it has rejoined.
  if (!entry.joined) return;

  await entry.channel.track(payload);
}

async function stopPublishing(loungeId: string): Promise<void> {
  if (!published.delete(loungeId)) return;

  const entry = entries.get(loungeId);
  if (!entry) return;

  // Untrack before releasing: releasing may tear the channel down, and while a
  // watcher still holds it open we would otherwise stay visible forever.
  if (entry.joined) await entry.channel.untrack();
  release(loungeId);
}

/**
 * Publish my state into exactly `loungeIds`. Lounges I was in but no longer am
 * get untracked, so leaving a lounge drops me out of its Feed immediately.
 *
 * track() is a one-shot message — supabase does not replay it after a
 * reconnect — which is the second reason callers re-publish on a heartbeat
 * rather than only when the track changes.
 */
export async function publishPresence(
  loungeIds: string[],
  payload: PresencePayload
): Promise<void> {
  const next = new Set(loungeIds);

  for (const loungeId of [...published]) {
    if (!next.has(loungeId)) await stopPublishing(loungeId);
  }

  await Promise.all([...next].map((loungeId) => trackIn(loungeId, payload)));
}

/** Go invisible everywhere. Called when the app backgrounds or signs out. */
export async function clearPresence(): Promise<void> {
  await Promise.all([...published].map(stopPublishing));
}
