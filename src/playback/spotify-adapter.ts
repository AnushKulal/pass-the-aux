/**
 * Spotify implementation of `PlaybackAdapter`.
 *
 * Spotify is the awkward provider of the two. It plays on a *remote* device
 * that this app only steers over a rate-limited HTTP API — there is no local
 * audio element to read a timestamp off, no rate control, and no end-of-track
 * event. Everything in here exists to hide those three gaps behind the same
 * interface the YouTube adapter satisfies, so `SyncController` never branches
 * on the provider.
 */

import * as Spotify from '@/features/spotify/api';
import type { MusicProvider } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';

import {
  PlaybackError,
  type AdapterCapabilities,
  type PlaybackAdapter,
  type PlayableRef,
} from './types';

/**
 * How long a device/profile snapshot is trusted. `isAvailable()` can be called
 * on every routing decision; without this it would be two network round-trips
 * each time, and Spotify rate-limits per user.
 */
const AVAILABILITY_TTL_MS = 30_000;

/**
 * Why Spotify can or cannot drive playback right now.
 *
 *   not-linked   no Spotify account attached
 *   not-premium  attached, but `/me/player/play` is Premium-only and 403s
 *   no-device    Premium, but nothing is open for Aux to steer
 *   ready        Spotify will play this
 */
export type SpotifyAvailability = 'not-linked' | 'not-premium' | 'no-device' | 'ready';

/** Slow on purpose: this poll exists only to notice a track ending. */
const END_POLL_INTERVAL_MS = 5_000;

/** Treat the last 1.5s as "ended" — closer than the poll can resolve anyway. */
const END_THRESHOLD_MS = 1_500;

/**
 * If playback stops within one poll interval of the end, the track finished
 * and Spotify simply had nothing queued behind it.
 */
const STOPPED_NEAR_END_MS = END_POLL_INTERVAL_MS + END_THRESHOLD_MS;

type Snapshot = {
  at: number;
  linked: boolean;
  premium: boolean;
  devices: Spotify.SpotifyDevice[];
};

const EMPTY_SNAPSHOT: Snapshot = { at: 0, linked: false, premium: false, devices: [] };

export class SpotifyAdapter implements PlaybackAdapter {
  readonly provider: MusicProvider = 'spotify';

  /**
   * `canSetRate` is false because the Web API has no playback-rate control at
   * all, so the controller has to correct drift by seeking. `hasLocalPosition`
   * is false because `getPosition()` is a network call — the controller polls
   * it on the slow `REMOTE_POLL_INTERVAL_MS` and extrapolates in between.
   */
  readonly capabilities: AdapterCapabilities = {
    canSetRate: false,
    hasLocalPosition: false,
    canSetVolume: true,
  };

  private currentRef: PlayableRef | null = null;

  /** Debounce key for `onEnded` — the providerId we have already reported. */
  private endedFiredFor: string | null = null;

  /**
   * Guards against reading a stale `me/player` right after `load()` and
   * mistaking the *previous* track for Spotify having advanced past ours.
   */
  private sawCurrentTrack = false;

  private endPollTimer: ReturnType<typeof setInterval> | null = null;

  private snapshot: Snapshot = EMPTY_SNAPSHOT;
  private snapshotInFlight: Promise<Snapshot> | null = null;

  private readonly endedListeners = new Set<() => void>();
  private readonly errorListeners = new Set<(error: PlaybackError) => void>();

  // ------------------------------------------------------------- availability

  /**
   * Refreshes the linked/premium/device snapshot. Concurrent callers share one
   * in-flight refresh so a burst of `isAvailable()` calls costs one round-trip.
   */
  private async refreshSnapshot(): Promise<Snapshot> {
    if (this.snapshotInFlight) return this.snapshotInFlight;

    const inFlight = (async (): Promise<Snapshot> => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const userId = auth.user?.id;
        if (!userId) return { ...EMPTY_SNAPSHOT, at: Date.now() };

        const { data: profile } = await supabase
          .from('profiles')
          .select('spotify_linked, is_premium')
          .eq('id', userId)
          .maybeSingle();

        const linked = profile?.spotify_linked === true;
        const premium = profile?.is_premium === true;

        // Skip the device call entirely when the account cannot drive playback
        // anyway — it would only ever come back 403 PREMIUM_REQUIRED.
        const devices = linked && premium ? await Spotify.getDevices() : [];

        return { at: Date.now(), linked, premium, devices };
      } catch {
        // A failed probe is "not available right now", never a thrown error:
        // callers use this to *choose* an adapter.
        return { ...EMPTY_SNAPSHOT, at: Date.now() };
      } finally {
        this.snapshotInFlight = null;
      }
    })();

    this.snapshotInFlight = inFlight;
    this.snapshot = await inFlight;
    return this.snapshot;
  }

  private async getSnapshot(): Promise<Snapshot> {
    if (Date.now() - this.snapshot.at < AVAILABILITY_TTL_MS) return this.snapshot;
    return this.refreshSnapshot();
  }

  async isAvailable(): Promise<boolean> {
    const snapshot = await this.getSnapshot();
    return snapshot.linked && snapshot.premium && snapshot.devices.some((d) => d.is_active);
  }

  /**
   * WHY `isAvailable()` answered the way it did.
   *
   * The routing decision is invisible in the running app: audio comes out of
   * Spotify or it does not, and when it does not there is nothing saying
   * whether the account is unlinked, not Premium, or simply has no Spotify open
   * to steer. The whole cross-provider design ends up looking unimplemented
   * because its most common outcome is a silent fallback.
   *
   * This exists so the UI can say which. It reads the SAME snapshot
   * `isAvailable()` does rather than re-querying, because two functions
   * computing "can Spotify play" from separate reads is how they come to
   * disagree — and a source indicator that contradicts what is actually
   * happening would be worse than no indicator.
   */
  async describeAvailability(): Promise<SpotifyAvailability> {
    const snapshot = await this.getSnapshot();
    if (!snapshot.linked) return 'not-linked';
    if (!snapshot.premium) return 'not-premium';
    if (!snapshot.devices.some((d) => d.is_active)) return 'no-device';
    return 'ready';
  }

  /** The device commands should target, if we know of one. */
  private activeDeviceId(): string | null {
    return this.snapshot.devices.find((d) => d.is_active)?.id ?? null;
  }

  // ---------------------------------------------------------------- transport

  async load(ref: PlayableRef, positionMs: number, autoplay: boolean): Promise<void> {
    if (ref.provider !== 'spotify') {
      throw new PlaybackError('unknown', `SpotifyAdapter cannot play ${ref.provider}.`, false);
    }

    this.currentRef = ref;
    this.endedFiredFor = null;
    this.sawCurrentTrack = false;

    // Make sure the device list is warm before we aim a command at it.
    await this.getSnapshot();

    await Spotify.play({
      trackUri: `spotify:track:${ref.providerId}`,
      positionMs,
      deviceId: this.activeDeviceId(),
    });

    if (autoplay) {
      this.startEndPoll();
      return;
    }

    // There is no "cue without sounding" on the Web API — `play` is the only
    // way to put a track on the device. Pausing immediately after is the
    // closest equivalent; it costs a brief blip of audio at worst.
    this.stopEndPoll();
    await Spotify.pause();
  }

  async play(): Promise<void> {
    await Spotify.play({ deviceId: this.activeDeviceId() });
    this.startEndPoll();
  }

  async pause(): Promise<void> {
    this.stopEndPoll();
    await Spotify.pause();
  }

  async seek(positionMs: number): Promise<void> {
    await Spotify.seek(positionMs);
  }

  async getPosition(): Promise<number> {
    const state = await Spotify.getPlaybackState();
    return state?.progress_ms ?? 0;
  }

  async setVolume(volume: number): Promise<void> {
    await Spotify.setVolume(volume);
  }

  /**
   * Spotify exposes no playback-rate control. This resolves silently rather
   * than throwing because `SyncController` calls it unconditionally when it
   * settles drift back to 1.0 — throwing here would turn a successful
   * correction into a playback error.
   */
  async setRate(_rate: number): Promise<void> {
    // Intentionally empty; see `capabilities.canSetRate`.
  }

  async unload(): Promise<void> {
    this.stopEndPoll();
    const wasLoaded = this.currentRef != null;
    this.currentRef = null;
    this.endedFiredFor = null;
    this.sawCurrentTrack = false;

    if (!wasLoaded) return;

    // Best effort: the user may have already closed Spotify, and a failure to
    // pause something that is no longer playing is not worth surfacing.
    try {
      await Spotify.pause();
    } catch {
      // ignored
    }
  }

  // ------------------------------------------------------------------- events

  onEnded(listener: () => void): () => void {
    this.endedListeners.add(listener);
    return () => this.endedListeners.delete(listener);
  }

  onError(listener: (error: PlaybackError) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  private emitError(error: unknown): void {
    if (!(error instanceof PlaybackError)) return;

    // Background polling on a phone hits transient network failures constantly.
    // Only surface errors the user can actually do something about.
    if (error.code === 'network') return;

    for (const listener of this.errorListeners) listener(error);
  }

  private fireEnded(providerId: string): void {
    if (this.endedFiredFor === providerId) return;
    this.endedFiredFor = providerId;
    this.stopEndPoll();
    for (const listener of this.endedListeners) listener();
  }

  // -------------------------------------------------------------- end polling

  private startEndPoll(): void {
    if (this.endPollTimer != null) return;
    this.endPollTimer = setInterval(() => {
      void this.checkForEnd();
    }, END_POLL_INTERVAL_MS);
  }

  private stopEndPoll(): void {
    if (this.endPollTimer == null) return;
    clearInterval(this.endPollTimer);
    this.endPollTimer = null;
  }

  /**
   * Spotify never tells us a track finished, so we ask. Three signals count as
   * the end, and the debounce in `fireEnded` means whichever lands first wins:
   *
   *  - the position is inside the last `END_THRESHOLD_MS`;
   *  - Spotify moved on to a different track by itself;
   *  - playback stopped while already near the end.
   */
  private async checkForEnd(): Promise<void> {
    const ref = this.currentRef;
    if (!ref || this.endedFiredFor === ref.providerId) return;

    let state: Spotify.SpotifyPlaybackState | null;
    try {
      state = await Spotify.getPlaybackState();
    } catch (error) {
      this.emitError(error);
      return;
    }

    // 204 from Spotify: playback session gone. Could be a device sleeping
    // rather than a finished track, so do not call it an end.
    if (!state) return;

    const isCurrentTrack = state.item?.id === ref.providerId;

    if (isCurrentTrack) {
      this.sawCurrentTrack = true;
    } else if (this.sawCurrentTrack && state.item != null) {
      this.fireEnded(ref.providerId);
      return;
    }

    // `me/player` reports whatever the device is playing, which after an
    // external track change is not ours. Measuring that stranger's progress
    // against OUR duration would end the room's track on the host's behalf.
    if (!isCurrentTrack) return;

    const remainingMs = ref.durationMs - (state.progress_ms ?? 0);
    const reachedEnd = remainingMs <= END_THRESHOLD_MS;
    const stoppedNearEnd = !state.is_playing && remainingMs <= STOPPED_NEAR_END_MS;

    if (reachedEnd || stoppedNearEnd) this.fireEnded(ref.providerId);
  }
}

/**
 * One adapter per app, matching the single remote Spotify device it drives.
 * A second instance would fight the first over the same playback session.
 */
export const spotifyAdapter = new SpotifyAdapter();
