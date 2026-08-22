/**
 * The playback contract.
 *
 * This is the seam that lets one Session contain both a Spotify Premium
 * listener and a free YouTube listener hearing the same song at the same
 * second. The SyncController only ever talks to this interface — it does not
 * know or care which provider is behind it, which is also how a future
 * SoundCloud or self-hosted source drops in without touching sync code.
 */

import type { MusicProvider, TrackRow } from '@/lib/database.types';

/** A track plus the provider-specific id needed to actually play it. */
export type PlayableRef = {
  provider: MusicProvider;
  /** Spotify track id, or YouTube video id. */
  providerId: string;
  durationMs: number;
};

export type ResolvedTrack = TrackRow & {
  links: Partial<Record<MusicProvider, string>>;
};

export type PlaybackErrorCode =
  /** Spotify is linked but the account is free — playback control is Premium-only. */
  | 'premium_required'
  /** Spotify has no device currently active to send playback to. */
  | 'no_active_device'
  /** The provider refused this specific track (region lock, takedown, embed disabled). */
  | 'not_playable'
  /** Token expired or revoked; the user has to re-link. */
  | 'auth_expired'
  | 'network'
  | 'unknown';

export class PlaybackError extends Error {
  constructor(
    readonly code: PlaybackErrorCode,
    message: string,
    readonly recoverable = true
  ) {
    super(message);
    this.name = 'PlaybackError';
  }
}

/**
 * What a given adapter can actually do. The SyncController branches on these
 * rather than on the provider name, so adding a provider never means editing
 * the sync logic.
 */
export type AdapterCapabilities = {
  /**
   * Can nudge playback speed slightly to absorb small drift without an audible
   * seek. YouTube can; Spotify cannot.
   */
  canSetRate: boolean;
  /**
   * Reports position from local state without a network round-trip. False for
   * Spotify, where `getPosition` hits the Web API and is rate-limited — the
   * controller then polls it far less often and extrapolates in between.
   */
  hasLocalPosition: boolean;
  /** Can set output volume (used to duck music under push-to-talk in Phase 6). */
  canSetVolume: boolean;
};

export type PlaybackState = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error';

export interface PlaybackAdapter {
  readonly provider: MusicProvider;
  readonly capabilities: AdapterCapabilities;

  /**
   * Whether this adapter can be used right now — Spotify checks for a linked
   * Premium account with an active device; YouTube is effectively always true.
   * Called before routing a user to this adapter.
   */
  isAvailable(): Promise<boolean>;

  /** Cue a track at a position. `autoplay: false` prepares without sounding. */
  load(ref: PlayableRef, positionMs: number, autoplay: boolean): Promise<void>;

  play(): Promise<void>;
  pause(): Promise<void>;
  seek(positionMs: number): Promise<void>;

  /** Best-effort current position in ms. */
  getPosition(): Promise<number>;

  /** 0..1. No-op when `capabilities.canSetVolume` is false. */
  setVolume(volume: number): Promise<void>;

  /**
   * 1.0 is normal. Used for sub-second drift correction.
   * No-op when `capabilities.canSetRate` is false.
   */
  setRate(rate: number): Promise<void>;

  /** Stop and release. Safe to call when already idle. */
  unload(): Promise<void>;

  /** Fired when the track reaches its natural end. Returns an unsubscribe fn. */
  onEnded(listener: () => void): () => void;

  /** Fired on any playback failure. Returns an unsubscribe fn. */
  onError(listener: (error: PlaybackError) => void): () => void;
}

/** Drift thresholds, in ms. Tuned so corrections stay inaudible where possible. */
export const Drift = {
  /** Below this, do nothing — correcting would be more disruptive than the error. */
  IGNORE: 250,
  /** Between IGNORE and SEEK, absorb it by nudging playback rate if we can. */
  SEEK: 1_500,
  /** How far off 1.0 the rate nudge goes. 2% is below the pitch-perception floor. */
  RATE_NUDGE: 0.02,
  /** How often the controller compares expected vs actual. */
  CHECK_INTERVAL_MS: 3_000,
  /** Spotify's position endpoint is rate-limited, so poll it much more slowly. */
  REMOTE_POLL_INTERVAL_MS: 10_000,
} as const;
