/**
 * The write side of presence: publishing what I am hearing into every lounge
 * I belong to.
 */

import { useEffect, useMemo, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import {
  clearPresence,
  publishPresence,
  PRESENCE_HEARTBEAT_MS,
  SPOTIFY_POLL_MS,
  type PresencePayload,
} from '@/features/presence/presence-client';
import {
  getCurrentlyPlaying,
  normalizeTrack,
  type SpotifyPlaybackState,
} from '@/features/spotify/api';
import { ensureFreshClock, serverNow } from '@/lib/clock';
import type { MusicProvider } from '@/lib/database.types';
import { expectedPositionMs, type RoomTimeline } from '@/playback/sync-controller';

/** Who I am, as my lounges should see me. */
export type PresenceIdentity = {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  /** Gates the Spotify fallback poll entirely. */
  spotifyLinked: boolean;
};

/**
 * What Aux itself is playing. Carries the Session's timeline rather than a
 * position snapshot on purpose: a number captured at render time would be
 * stale by the time the next heartbeat stamps it, so the beat derives the
 * position from the timeline at the instant it publishes.
 */
export type LocalNowPlaying = {
  trackTitle: string;
  artist: string;
  artworkUrl: string | null;
  provider: MusicProvider;
  durationMs: number;
  roomId: string | null;
  timeline: RoomTimeline;
};

/** A resolved position, ready to be stamped into a payload. */
type Snapshot = {
  trackTitle: string;
  artist: string;
  artworkUrl: string | null;
  provider: MusicProvider;
  positionMs: number;
  durationMs: number;
  isPlaying: boolean;
  roomId: string | null;
};

/**
 * Unlinked, revoked, or rate-limited all look the same from here. Three
 * strikes and we stop asking until the app is foregrounded again.
 */
const SPOTIFY_MAX_FAILURES = 3;

function snapshotFromLocal(local: LocalNowPlaying): Snapshot {
  const raw = expectedPositionMs(local.timeline);

  return {
    trackTitle: local.trackTitle,
    artist: local.artist,
    artworkUrl: local.artworkUrl,
    provider: local.provider,
    positionMs: local.durationMs > 0 ? Math.min(raw, local.durationMs) : raw,
    durationMs: local.durationMs,
    isPlaying: local.timeline.isPlaying,
    roomId: local.roomId,
  };
}

function snapshotFromSpotify(state: SpotifyPlaybackState | null): Snapshot | null {
  const item = state?.item;
  if (!state || !item) return null;

  const track = normalizeTrack(item);
  return {
    trackTitle: track.title,
    artist: track.artist,
    artworkUrl: track.artworkUrl,
    provider: 'spotify',
    positionMs: state.progress_ms ?? 0,
    durationMs: track.durationMs,
    isPlaying: state.is_playing,
    // Listening in the Spotify app is not a Session, so there is nothing to
    // join — that is exactly what makes these rows a prompt to start one.
    roomId: null,
  };
}

/**
 * Publish my state to every lounge I belong to, on a heartbeat.
 *
 * Sources, in priority order:
 *   1. Aux itself, when a Session is driving playback.
 *   2. Spotify, polled through the Edge Function proxy, so that listening in
 *      the real Spotify app still shows up in my friends' Feeds.
 *
 * Everything stops when the app backgrounds. Polling Spotify from the
 * background would burn battery and rate limit to publish a presence nobody
 * can act on, and iOS suspends the timers mid-flight anyway.
 *
 * @param identity  Null while signed out; nothing is published.
 * @param local     What Aux is playing, if anything.
 */
export function useBroadcastPresence(
  identity: PresenceIdentity | null,
  loungeIds: string[],
  local?: LocalNowPlaying | null
): void {
  // The heartbeat must not restart every time a prop identity changes, so the
  // timers read the newest values through a ref instead of closing over them.
  const latest = useRef<{ identity: PresenceIdentity | null; local: LocalNowPlaying | null }>({
    identity: null,
    local: null,
  });
  const spotify = useRef<{ snapshot: Snapshot; sampledAt: number } | null>(null);

  // Declared first so it has already run by the time the effect below fires.
  useEffect(() => {
    latest.current = { identity, local: local ?? null };
  }, [identity, local]);

  // Collapse the id array to a primitive: `loungeIds` is a fresh array identity
  // on every render of the screen that owns this hook, and depending on it
  // directly would tear the heartbeat down and rebuild it each time.
  const loungeKey = useMemo(() => [...loungeIds].sort().join(','), [loungeIds]);
  const enabled = identity !== null && loungeKey !== '';
  // A dependency, not just a ref read: `start()` decides once whether to create
  // the poll interval, so linking Spotify mid-run has to rebuild the effect or
  // that user's real-Spotify listening never reaches the Feed until a restart.
  const spotifyLinked = identity?.spotifyLinked === true;

  useEffect(() => {
    if (!enabled) return;

    const ids = loungeKey.split(',');
    let beat: ReturnType<typeof setInterval> | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let failures = 0;
    let cancelled = false;
    let active = AppState.currentState === 'active';

    const currentSnapshot = (): Snapshot | null => {
      const { local: localNow } = latest.current;
      if (localNow) return snapshotFromLocal(localNow);

      const sample = spotify.current;
      if (!sample) return null;
      if (!sample.snapshot.isPlaying) return sample.snapshot;

      // The sample can be a full poll interval old. Shipping a 25s-stale
      // position would make every receiver's progress bar jump backwards.
      const elapsed = Math.max(0, serverNow() - sample.sampledAt);
      const { positionMs, durationMs } = sample.snapshot;
      return {
        ...sample.snapshot,
        positionMs: durationMs > 0 ? Math.min(durationMs, positionMs + elapsed) : positionMs,
      };
    };

    const beatOnce = async () => {
      const me = latest.current.identity;
      if (cancelled || !me) return;

      const snapshot = currentSnapshot();
      const payload: PresencePayload = {
        userId: me.userId,
        username: me.username,
        displayName: me.displayName,
        avatarUrl: me.avatarUrl,
        trackTitle: snapshot?.trackTitle ?? null,
        artist: snapshot?.artist ?? null,
        artworkUrl: snapshot?.artworkUrl ?? null,
        provider: snapshot?.provider ?? null,
        positionMs: snapshot?.positionMs ?? 0,
        durationMs: snapshot?.durationMs ?? 0,
        isPlaying: snapshot?.isPlaying ?? false,
        roomId: snapshot?.roomId ?? null,
        updatedAt: serverNow(),
      };

      try {
        // We publish even while idle. Presence is also how peers learn we
        // left, and being already tracked means pressing play shows up on the
        // next beat instead of after a channel round trip.
        await publishPresence(ids, payload);
      } catch {
        // A beat that misses is a non-event: the next one is eight seconds
        // away, and letting it reject would surface as an unhandled rejection.
      }
    };

    const stopPolling = () => {
      if (poll !== null) {
        clearInterval(poll);
        poll = null;
      }
    };

    const pollSpotify = async () => {
      const me = latest.current.identity;
      if (cancelled || !me?.spotifyLinked) return;
      // A Session already tells us exactly what is playing; asking Spotify on
      // top of that spends rate limit to learn nothing.
      if (latest.current.local) return;

      try {
        const state = await getCurrentlyPlaying();
        failures = 0;
        const snapshot = snapshotFromSpotify(state);
        spotify.current = snapshot ? { snapshot, sampledAt: serverNow() } : null;
      } catch {
        failures += 1;
        if (failures >= SPOTIFY_MAX_FAILURES) stopPolling();
      }
    };

    const start = () => {
      if (beat !== null) return;

      beat = setInterval(() => void beatOnce(), PRESENCE_HEARTBEAT_MS);
      // Sync the clock before the first beat: updatedAt is what every receiver
      // extrapolates from, and stamping it with an unsynced device clock puts
      // the whole lounge's progress bars seconds out.
      void ensureFreshClock().then(() => {
        if (!cancelled) void beatOnce();
      });

      if (spotifyLinked) {
        failures = 0;
        void pollSpotify();
        poll = setInterval(() => void pollSpotify(), SPOTIFY_POLL_MS);
      }
    };

    const stop = () => {
      if (beat !== null) {
        clearInterval(beat);
        beat = null;
      }
      stopPolling();
      // A sample taken before a long background is a lie by the time we wake.
      spotify.current = null;
      // Failing to untrack is survivable — receivers age presence out — but an
      // unhandled rejection during teardown is not worth the noise.
      void clearPresence().catch(() => undefined);
    };

    const onAppStateChange = (next: AppStateStatus) => {
      const nextActive = next === 'active';
      // Android fires 'change' for 'inactive' transitions we do not care about.
      if (nextActive === active) return;

      active = nextActive;
      if (nextActive) start();
      else stop();
    };

    const subscription = AppState.addEventListener('change', onAppStateChange);
    if (active) start();

    return () => {
      cancelled = true;
      subscription.remove();
      stop();
    };
  }, [enabled, loungeKey, spotifyLinked]);
}
