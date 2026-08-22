/**
 * The room's playback state, as one store.
 *
 * This is the seam between the database row (what the Session *should* be
 * playing) and the audio device (what this phone *is* playing). It owns exactly
 * one `SyncController` and exactly one adapter at a time, and its whole job is
 * to keep those two facts pointed at the same track.
 *
 * Why a store rather than a hook: the NowPlaying header, the transport row, the
 * queue and the mini player all need the same timeline, and the controller must
 * survive a re-render of any of them. Component state would tear the controller
 * down every time a sibling updated.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import type { MusicProvider, RoomRow } from '@/lib/database.types';

import { spotifyAdapter } from './spotify-adapter';
import { SyncController, type DriftAction, type RoomTimeline } from './sync-controller';
import { Drift, PlaybackError, type PlaybackAdapter, type PlayableRef, type ResolvedTrack } from './types';
import { youtubeAdapter } from './youtube-adapter';

/**
 * 'auto' lets a Premium listener with a live device hear the Spotify master.
 * 'youtube' is the escape hatch for people who would rather not have this app
 * hijack the Spotify session they are already using elsewhere.
 */
export type SourcePreference = 'auto' | 'youtube';

const SOURCE_PREFERENCE_KEY = 'aux:source-preference';

/** Callbacks the room screen wires in; kept out of state so they never re-render. */
export type RoomHooks = {
  /** The local track finished. Only the host acts on this. */
  onEnded?: () => void;
  /** Every drift measurement, for telemetry sampling. */
  onDrift?: (driftMs: number, action: DriftAction, provider: MusicProvider) => void;
  onError?: (error: PlaybackError) => void;
};

export type PlaybackStore = {
  roomId: string | null;
  adapter: PlaybackAdapter | null;
  controller: SyncController | null;
  timeline: RoomTimeline | null;
  track: ResolvedTrack | null;
  /**
   * Last *measured* position, refreshed on every apply and every drift check.
   * Deliberately not ticked here — a 4Hz ticker in global state would re-render
   * the queue and the chat too. Screens that show a moving bar run their own
   * local ticker over `expectedPositionMs(timeline)`.
   */
  positionMs: number;
  driftMs: number;
  isSynced: boolean;
  error: PlaybackError | null;
  sourcePreference: SourcePreference;

  attachRoom: (roomId: string, adapter?: PlaybackAdapter, hooks?: RoomHooks) => void;
  applyRoomRow: (row: RoomRow, resolvedTrack: ResolvedTrack | null) => Promise<void>;
  detach: () => void;
  resync: () => Promise<void>;
  setSourcePreference: (preference: SourcePreference) => void;
  clearError: () => void;
};

// Module-level rather than in state: these change without anything needing to
// re-render, and putting them in the store would invalidate every selector.
let currentHooks: RoomHooks = {};
/**
 * Monotonic token for `applyRoomRow`. Choosing an adapter awaits a network
 * probe, and a realtime burst can start a second apply mid-probe; the stale one
 * bails instead of overwriting the newer decision.
 */
let applyToken = 0;
let preferenceHydrated = false;

// ------------------------------------------------------------------ helpers

/**
 * Postgres `bigint` reaches us as a JSON number over PostgREST but can arrive
 * as a string through the realtime WAL decoder. Coercing here means the sync
 * arithmetic never silently concatenates instead of subtracting.
 */
function toEpochMs(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function toTimeline(row: RoomRow): RoomTimeline {
  return {
    trackId: row.track_id,
    startedAtMs: toEpochMs(row.started_at_ms),
    pausedAtMs: toEpochMs(row.paused_at_ms),
    isPlaying: row.is_playing === true,
  };
}

function toPlayableRef(track: ResolvedTrack, provider: MusicProvider): PlayableRef | null {
  const providerId = track.links[provider];
  if (!providerId) return null;
  return { provider, providerId, durationMs: track.duration_ms };
}

/**
 * Which adapter can play *this* track for *this* user, right now.
 *
 * Re-run on every track change rather than once per Session: a Spotify device
 * goes away the moment someone closes the desktop app, and the fallback has to
 * happen mid-Session without a reload. `isAvailable()` is snapshot-cached inside
 * the Spotify adapter, so asking repeatedly is nearly free.
 */
async function pickAdapter(
  track: ResolvedTrack,
  preference: SourcePreference
): Promise<PlaybackAdapter> {
  const hasSpotify = Boolean(track.links.spotify);
  const hasYouTube = Boolean(track.links.youtube);

  if (preference === 'youtube' && hasYouTube) return youtubeAdapter;

  if (hasSpotify && (await spotifyAdapter.isAvailable())) return spotifyAdapter;
  if (hasYouTube) return youtubeAdapter;

  // Only a Spotify link exists and Spotify is not usable. Hand it over anyway so
  // the adapter raises a typed `premium_required` / `no_active_device` the UI
  // can explain, instead of failing here with a generic error.
  return hasSpotify ? spotifyAdapter : youtubeAdapter;
}

async function hydratePreference(apply: (preference: SourcePreference) => void): Promise<void> {
  if (preferenceHydrated) return;
  preferenceHydrated = true;

  try {
    const raw = await AsyncStorage.getItem(SOURCE_PREFERENCE_KEY);
    if (raw === 'youtube' || raw === 'auto') apply(raw);
  } catch {
    // A storage read failure just means the default ('auto') stands.
  }
}

// -------------------------------------------------------------------- store

export const usePlayback = create<PlaybackStore>((set, get) => {
  /** Wires a fresh controller to the store. Every adapter swap goes through here. */
  const makeController = (adapter: PlaybackAdapter): SyncController =>
    new SyncController(adapter, {
      onDrift: (driftMs, action) => {
        set({
          driftMs,
          isSynced: Math.abs(driftMs) <= Drift.IGNORE,
          positionMs: get().controller?.estimatePositionMs() ?? get().positionMs,
        });
        currentHooks.onDrift?.(driftMs, action, adapter.provider);
      },
      onEnded: () => currentHooks.onEnded?.(),
      onError: (error) => {
        set({ error });
        currentHooks.onError?.(error);
      },
    });

  /** Tear down the old controller (which unloads its adapter) and stand up a new one. */
  const swapAdapter = (adapter: PlaybackAdapter): SyncController => {
    get().controller?.destroy();
    const controller = makeController(adapter);
    set({ adapter, controller, driftMs: 0, isSynced: true, error: null });
    return controller;
  };

  return {
    roomId: null,
    adapter: null,
    controller: null,
    timeline: null,
    track: null,
    positionMs: 0,
    driftMs: 0,
    isSynced: true,
    error: null,
    sourcePreference: 'auto',

    /**
     * Start driving `roomId`. Idempotent for the same room so a re-render or a
     * Fast Refresh does not restart playback under the listener.
     */
    attachRoom(roomId, adapter = youtubeAdapter, hooks = {}) {
      currentHooks = hooks;

      if (get().roomId === roomId && get().controller) return;

      get().controller?.destroy();
      applyToken += 1;

      set({
        roomId,
        adapter,
        controller: makeController(adapter),
        timeline: null,
        track: null,
        positionMs: 0,
        driftMs: 0,
        isSynced: true,
        error: null,
      });

      void hydratePreference((preference) => set({ sourcePreference: preference }));
    },

    async applyRoomRow(row, resolvedTrack) {
      if (get().roomId !== row.id) return;

      const token = (applyToken += 1);
      const timeline = toTimeline(row);
      const previousTrackId = get().timeline?.trackId ?? null;

      set({
        timeline,
        track: resolvedTrack,
        positionMs: timeline.startedAtMs == null ? 0 : get().positionMs,
      });

      let controller = get().controller;
      if (!controller) return;

      // Nothing queued, or the track has not resolved yet: unload rather than
      // leave the previous song playing under a Session that moved on.
      if (timeline.trackId == null || !resolvedTrack) {
        await controller.applyTimeline(timeline, null);
        return;
      }

      let adapter = get().adapter;
      const trackChanged = previousTrackId !== timeline.trackId;

      if (!adapter || trackChanged) {
        const chosen = await pickAdapter(resolvedTrack, get().sourcePreference);
        if (token !== applyToken) return; // a newer row landed while we probed

        // Swapping tears down the old controller, which unloads the old adapter —
        // that is what stops Spotify when we fall back to YouTube mid-Session.
        if (chosen !== adapter) controller = swapAdapter(chosen);
        adapter = chosen;
      }

      const ref = toPlayableRef(resolvedTrack, adapter.provider);

      if (!ref) {
        set({
          error: new PlaybackError(
            'not_playable',
            `"${resolvedTrack.title}" has no ${adapter.provider} link. Skip it to keep the Session moving.`,
            false
          ),
        });
        await controller.applyTimeline({ ...timeline, trackId: null }, null);
        return;
      }

      const errorBefore = get().error;
      await controller.applyTimeline(timeline, ref);

      // Nothing else clears a stale banner: `swapAdapter` does, but it does not
      // run when `pickAdapter` returns the same singleton, so one transient
      // `no_active_device` would sit there for the rest of the Session. Compare
      // by identity so an error raised *by this apply* survives.
      const errorAfter = get().error;
      set({
        positionMs: controller.estimatePositionMs(),
        error: errorAfter === errorBefore ? null : errorAfter,
      });
    },

    detach() {
      applyToken += 1;
      get().controller?.destroy();
      currentHooks = {};

      set({
        roomId: null,
        adapter: null,
        controller: null,
        timeline: null,
        track: null,
        positionMs: 0,
        driftMs: 0,
        isSynced: true,
        error: null,
      });
    },

    /**
     * Full re-anchor. Also re-picks the adapter, because the two things that
     * trigger a resync — coming back from the background, and a realtime
     * reconnect — are exactly when a Spotify device tends to have disappeared.
     */
    async resync() {
      const { controller, track, timeline, sourcePreference } = get();
      if (!controller) return;

      if (track && timeline?.trackId === track.id) {
        const chosen = await pickAdapter(track, sourcePreference);

        if (chosen !== get().adapter) {
          const swapped = swapAdapter(chosen);
          const ref = toPlayableRef(track, chosen.provider);
          await swapped.applyTimeline(timeline, ref);
          return;
        }
      }

      await controller.resync();
      set({ positionMs: controller.estimatePositionMs() });
    },

    setSourcePreference(preference) {
      if (get().sourcePreference === preference) return;

      preferenceHydrated = true;
      set({ sourcePreference: preference });
      void AsyncStorage.setItem(SOURCE_PREFERENCE_KEY, preference).catch(() => undefined);

      // Apply immediately: changing this mid-Session should move the audio, not
      // wait for the next track.
      void get().resync();
    },

    clearError() {
      set({ error: null });
    },
  };
});

// ------------------------------------------------------- selector shorthands
// Each returns one primitive/reference so a consumer only re-renders for the
// slice it actually reads.

export const usePlaybackTimeline = () => usePlayback((s) => s.timeline);
export const usePlaybackTrack = () => usePlayback((s) => s.track);
export const usePlaybackDrift = () => usePlayback((s) => s.driftMs);
export const usePlaybackError = () => usePlayback((s) => s.error);
export const usePlaybackProviderName = () => usePlayback((s) => s.adapter?.provider ?? null);
