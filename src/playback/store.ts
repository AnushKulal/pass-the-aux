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
 *
 * STILL TWO VALUES, AND THAT IS A DECISION RATHER THAN AN OVERSIGHT. Account
 * creation now asks which music service is yours (`MusicService` below), which
 * looks like a third routing value wanting to be born — 'spotify'. It is not
 * one, for two reasons:
 *
 *   1. Routing genuinely has two outcomes. A preference cannot conjure a
 *      Premium plan or a live device, so "Spotify when it can actually be
 *      driven, YouTube when it cannot" is not a new behaviour — it is the
 *      definition of 'auto'. A 'spotify' value would be a synonym.
 *   2. `(tabs)/settings/connections` renders this union as a hand-built
 *      two-segment control with a caption looked up by value. A third value
 *      would leave that control with nothing selected and an empty caption
 *      under it — a screen breaking silently because a type grew somewhere
 *      else.
 *
 * `sourcePreferenceForService` below is the seam instead: the account's answer
 * and the audio routing are allowed to be different vocabularies, and neither
 * has to lie to keep the other honest.
 */
export type SourcePreference = 'auto' | 'youtube';

const SOURCE_PREFERENCE_KEY = 'aux:source-preference';

/* ---------------------------------------------------------- music services */

/**
 * The music service an account calls its own — asked once during account
 * creation, and the ONE thing profile setup insists on.
 *
 * Not the same type as `MusicProvider`, and the difference is the whole point.
 * `MusicProvider` is the database enum naming a playback backend this app HAS,
 * so it is exactly 'spotify' | 'youtube'. This names what the listener told us
 * they use, which has to be able to hold an answer Aux cannot act on yet.
 *
 * BE CLEAR ABOUT WHAT EACH ONE ACTUALLY COSTS:
 *
 *   'youtube'      No account, no OAuth, nothing to link — YouTube playback in
 *                  this app is the IFrame player, which never asks anyone to
 *                  sign in. So "signing in with Google links YouTube" is a UI
 *                  truth, NOT an auth one: no YouTube link exists in this app to
 *                  make. What a Google sign-in does is SETTLE THE QUESTION —
 *                  that user already has a working source, so there is nothing
 *                  left to ask them.
 *   'spotify'      A real account, and a real sign-in provider. But signing in
 *                  with Spotify does NOT by itself give Aux what it needs to
 *                  drive playback: that comes from the PKCE link in
 *                  `features/spotify/use-spotify-link`, which asks for playback
 *                  scopes and has the Edge Function store a refresh token
 *                  server-side. Supabase's `provider_token` is neither persisted
 *                  nor refreshed, so it is not a substitute. Until that link is
 *                  made, a Spotify-signed-in listener hears the same YouTube
 *                  audio as everyone else — which is exactly what 'auto' does,
 *                  and why 'auto' is the honest routing answer for them.
 *   'apple-music'  MODELLED, NOT BUILT. See `MUSIC_SERVICE_SUPPORTED`.
 */
export type MusicService = 'youtube' | 'spotify' | 'apple-music';

/**
 * Whether Aux can actually play from a service today.
 *
 * APPLE MUSIC IS FALSE, AND ON ANDROID IT STAYS FALSE. MusicKit ships for iOS
 * and the web only, there is no Expo module wrapping it, and Supabase has no
 * apple-music auth provider — so there is neither a sign-in to offer nor an
 * adapter to write. It is in the union anyway so the picker can show it as a
 * known, unavailable answer instead of pretending the option does not exist,
 * and so that the day an adapter appears the type does not have to change
 * underneath every consumer.
 *
 * Anything that lets a person choose a service MUST refuse a false entry.
 */
export const MUSIC_SERVICE_SUPPORTED: Record<MusicService, boolean> = {
  youtube: true,
  spotify: true,
  'apple-music': false,
};

/**
 * A `Record` rather than a `switch`, so adding a service is a compile error
 * here until someone decides how its audio is routed.
 */
const SERVICE_SOURCE: Record<MusicService, SourcePreference> = {
  youtube: 'youtube',
  // Not a placeholder. 'auto' already means "Spotify when this device can be
  // driven by it, YouTube when it cannot", which is the only promise worth
  // making to someone who has said Spotify is theirs but may be on a free plan.
  spotify: 'auto',
  // An Apple Music listener has no Spotify to control, so 'auto' resolves to
  // YouTube for them today — and stays correct if they ever link Spotify too.
  'apple-music': 'auto',
};

/** The service a listener claims, translated into how this store routes audio. */
export function sourcePreferenceForService(service: MusicService): SourcePreference {
  return SERVICE_SOURCE[service];
}

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
  /**
   * Apply the routing a music service implies — but only if nobody has answered
   * this question already.
   *
   * Called after a sign-in, where the service is DERIVED from the identity
   * provider rather than chosen. A derived answer must never stamp on a stored
   * one: that one was made by a person in Settings -> Connections, and undoing
   * it silently on the next cold start is the sort of bug nobody reports because
   * nobody can reproduce it. An explicit pick goes through
   * `setSourcePreference`, which does overwrite, because there the person IS
   * answering.
   *
   * Idempotent, and a no-op once anything else has settled the preference this
   * session — safe to call from an effect on every launch.
   */
  adoptServiceDefault: (service: MusicService) => Promise<void>;
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

    async adoptServiceDefault(service) {
      /*
        Somebody has already answered this session — `hydratePreference` read a
        value off disk, or `setSourcePreference` took an explicit choice — so
        what is in memory is authoritative and this call has nothing to add.

        THE GUARD IS NOT AN OPTIMISATION, IT CLOSES A RACE. The write in
        `setSourcePreference` is fire-and-forget, so re-reading the key here can
        return the value BEFORE that write lands and then apply it over the top:
        pick Spotify, change your mind to YouTube, and the derived default would
        quietly put you back on 'auto'. Setting the flag before the first await
        also makes two concurrent adoptions idempotent.
      */
      if (preferenceHydrated) return;
      preferenceHydrated = true;

      let stored: string | null = null;
      try {
        stored = await AsyncStorage.getItem(SOURCE_PREFERENCE_KEY);
      } catch {
        // A read failure is indistinguishable from "never answered", and
        // treating it as answered would leave the derived default unset.
        stored = null;
      }

      // Something is on disk: that is the answer, whoever gave it. Adopt it so a
      // cold start that lands here before any room still routes correctly.
      if (stored === 'auto' || stored === 'youtube') {
        set({ sourcePreference: stored });
        return;
      }

      const preference = sourcePreferenceForService(service);
      set({ sourcePreference: preference });
      void AsyncStorage.setItem(SOURCE_PREFERENCE_KEY, preference).catch(() => undefined);
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
