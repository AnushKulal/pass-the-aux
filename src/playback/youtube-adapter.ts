/**
 * YouTube playback adapter — the universal fallback path.
 *
 * Structural problem this file solves: a `PlaybackAdapter` is a plain object
 * with async methods, but YouTube playback needs a *mounted React component*
 * (a WebView on native, an iframe on web). The two cannot be the same thing.
 *
 * So the adapter owns a module-level registry instead. `<YouTubePlayerHost />`
 * calls `registerYouTubeControls(controls)` once its player reports ready, and
 * every adapter method awaits `whenReady()` before touching it. A `play()` that
 * arrives while the WebView is still booting therefore queues — it resolves the
 * moment the host registers — rather than throwing or being silently dropped.
 * That matters because the SyncController starts driving the adapter as soon as
 * the room row loads, which is routinely before the WebView is up.
 *
 * Unit boundary: the rest of the app is milliseconds-only. Seconds exist inside
 * this file and below it, nowhere above.
 */

import type { MusicProvider } from '@/lib/database.types';
import {
  PlaybackError,
  type AdapterCapabilities,
  type PlaybackAdapter,
  type PlayableRef,
} from './types';

// --------------------------------------------------------------- host bridge

/**
 * The imperative surface a mounted player host exposes. Deliberately expressed
 * in YouTube's own units (seconds, 0-100 volume) so each host stays a thin pass
 * through to its player and all conversion lives in one place: the adapter.
 */
export type YouTubeControls = {
  /** Cue `videoId` at `startSeconds`. `autoplay: false` prepares without sounding. */
  load(videoId: string, startSeconds: number, autoplay: boolean): void | Promise<void>;
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  /** Position in seconds. Must resolve, never hang, even if the player stalls. */
  getCurrentTime(): Promise<number>;
  /** 0-100, YouTube's own scale. */
  setVolume(volume: number): void;
  /** YouTube accepts 0.25 - 2. */
  setPlaybackRate(rate: number): void;
  /** Optional: stop and clear the loaded video. */
  unload?(): void;
};

/** Raw error from the player: a numeric YouTube code on web, a string on native. */
export type YouTubeRawError = number | string;

/** What a host gets back from registering — its only channel back to the adapter. */
export type YouTubeHostBridge = {
  /** The track reached its natural end. */
  emitEnded(): void;
  /** The player failed. Pass the raw code through untouched; mapping is our job. */
  emitError(raw: YouTubeRawError): void;
  /** Call from the host's unmount cleanup. */
  unregister(): void;
};

/**
 * If no host registers within this window something is structurally wrong — the
 * host was never mounted near the room root — so we fail loudly instead of
 * leaving the caller awaiting forever.
 */
const HOST_READY_TIMEOUT_MS = 15_000;

let controls: YouTubeControls | null = null;

type Waiter = {
  resolve: (value: YouTubeControls) => void;
  reject: (reason: PlaybackError) => void;
  timer: ReturnType<typeof setTimeout>;
};

let waiters: Waiter[] = [];

const endedListeners = new Set<() => void>();
const errorListeners = new Set<(error: PlaybackError) => void>();

/** True once a host is mounted and its player is ready. For UI gating only. */
export function isYouTubeHostReady(): boolean {
  return controls !== null;
}

/**
 * Called by the player host when its player reports ready. Any adapter calls
 * that queued while we were booting are flushed here, in the order made.
 */
export function registerYouTubeControls(next: YouTubeControls): YouTubeHostBridge {
  controls = next;

  const pending = waiters;
  waiters = [];
  pending.forEach((waiter) => {
    clearTimeout(waiter.timer);
    waiter.resolve(next);
  });

  return {
    emitEnded() {
      endedListeners.forEach((listener) => listener());
    },
    emitError(raw) {
      const error = mapYouTubeError(raw);
      errorListeners.forEach((listener) => listener(error));
    },
    unregister() {
      // Guard against a remount racing an unmount: a newer host may already
      // have claimed the slot, and clearing it would strand every caller.
      if (controls === next) controls = null;
    },
  };
}

function whenReady(): Promise<YouTubeControls> {
  if (controls) return Promise.resolve(controls);

  return new Promise<YouTubeControls>((resolve, reject) => {
    const waiter: Waiter = {
      resolve,
      reject,
      timer: setTimeout(() => {
        waiters = waiters.filter((entry) => entry !== waiter);
        reject(
          new PlaybackError(
            'unknown',
            'The YouTube player never became ready. Is YouTubePlayerHost mounted in the room?',
            false
          )
        );
      }, HOST_READY_TIMEOUT_MS),
    };

    waiters.push(waiter);
  });
}

// -------------------------------------------------------------- error mapping

/**
 * YouTube's iframe error codes, normalised. Every one of them means "this
 * particular video will not play here" and none are worth retrying, so they all
 * land on `not_playable` with `recoverable: false` — the room's only way
 * forward is to skip the track.
 *
 * 101/150 (embedding disabled by the uploader) is by far the most common in
 * practice: a large share of official music videos refuse embedding. The queue
 * UI MUST offer a skip affordance for it rather than looking stuck.
 */
export function mapYouTubeError(raw: YouTubeRawError): PlaybackError {
  switch (raw) {
    case 2:
    case 'invalid_parameter':
      return new PlaybackError('not_playable', 'That YouTube video id is not valid.', false);

    case 5:
    case 'HTML5_error':
      return new PlaybackError(
        'not_playable',
        'The YouTube player could not play this video on this device.',
        false
      );

    case 100:
    case 'video_not_found':
      return new PlaybackError(
        'not_playable',
        'This video was removed from YouTube or made private.',
        false
      );

    case 101:
    case 150:
    case 'embed_not_allowed':
      return new PlaybackError(
        'not_playable',
        'The uploader disabled playback outside YouTube. Skip to the next track.',
        false
      );

    default:
      return new PlaybackError('unknown', `YouTube player error (${String(raw)}).`, true);
  }
}

/** True when the failure can only be resolved by skipping the track. */
export function requiresSkip(error: PlaybackError): boolean {
  return error.code === 'not_playable';
}

// ------------------------------------------------------------------- adapter

/** YouTube rejects rates outside this range outright. */
const RATE_MIN = 0.25;
const RATE_MAX = 2;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Rounded to ms precision: the native host interpolates this into injected JS. */
/**
 * Milliseconds to the seconds the IFrame API wants, WITH A FINITE GUARD.
 *
 * `Math.max(0, NaN)` is `NaN` and `Math.round(NaN)` is `NaN`, so this used to
 * pass a non-finite position straight through to `player.seekTo(NaN, true)` —
 * and the API answers that with error 2, `invalid_parameter`, which this file
 * maps to "That YouTube video id is not valid." A bad CLOCK therefore reported
 * itself as a bad TRACK, which is about as misleading as an error message gets.
 *
 * Zero is the right fallback: a position nobody can compute is the start of the
 * song, and the drift loop corrects from there within one tick. The upstream
 * arithmetic producing a non-finite number is still a bug, but the player is
 * not the place to discover it.
 */
const toSeconds = (ms: number) => (Number.isFinite(ms) ? Math.round(Math.max(0, ms)) / 1000 : 0);

/**
 * Does this look like a YouTube video id at all?
 *
 * Deliberately loose. Ids are conventionally 11 characters of
 * `[A-Za-z0-9_-]`, but that is a convention rather than a guarantee, and
 * rejecting a valid id would be worse than accepting a doubtful one. What this
 * catches is the failure that actually happens: an empty string, or a full
 * watch URL stored where an id belongs — both of which reach YouTube as error
 * 2 and come back wearing the same message as a genuine bad id.
 */
const looksLikeVideoId = (id: string) => /^[A-Za-z0-9_-]{5,20}$/.test(id);

export class YouTubeAdapter implements PlaybackAdapter {
  readonly provider: MusicProvider = 'youtube';

  readonly capabilities: AdapterCapabilities = {
    // The iframe API exposes setPlaybackRate, so drift can be absorbed by
    // running 2% fast or slow instead of taking an audible seek.
    canSetRate: true,
    // getCurrentTime is answered by the player itself, no rate-limited API call.
    hasLocalPosition: true,
    canSetVolume: true,
  };

  private currentVideoId: string | null = null;
  /** Last position actually read, so a stalled player degrades instead of throwing. */
  private lastPositionMs = 0;

  /** Always true — YouTube needs no account, no Premium, no active device. */
  async isAvailable(): Promise<boolean> {
    return true;
  }

  async load(ref: PlayableRef, positionMs: number, autoplay: boolean): Promise<void> {
    if (ref.provider !== 'youtube') {
      throw new PlaybackError(
        'not_playable',
        `The YouTube adapter was handed a ${ref.provider} track.`,
        false
      );
    }

    /*
      SAY WHICH THING IS WRONG. YouTube reports a malformed id and a malformed
      position with the same error 2, so without this check the queue row and
      the clock are indistinguishable from the Session screen — and the message
      the user gets blames the track either way.
    */
    if (!looksLikeVideoId(ref.providerId)) {
      throw new PlaybackError(
        'not_playable',
        `The stored YouTube id for this track is not usable: "${ref.providerId}".`,
        false
      );
    }

    const player = await whenReady();
    this.currentVideoId = ref.providerId;
    this.lastPositionMs = Math.max(0, positionMs);

    await player.load(ref.providerId, toSeconds(positionMs), autoplay);
  }

  async play(): Promise<void> {
    (await whenReady()).play();
  }

  async pause(): Promise<void> {
    (await whenReady()).pause();
  }

  async seek(positionMs: number): Promise<void> {
    this.lastPositionMs = Math.max(0, positionMs);
    (await whenReady()).seek(toSeconds(positionMs));
  }

  async getPosition(): Promise<number> {
    const player = await whenReady();
    const seconds = await player.getCurrentTime();

    // A player that is buffering or between videos can report NaN or a
    // negative. Reusing the last good reading keeps the drift loop from
    // "correcting" to zero and restarting the song under everyone.
    if (!Number.isFinite(seconds) || seconds < 0) return this.lastPositionMs;

    this.lastPositionMs = Math.round(seconds * 1000);
    return this.lastPositionMs;
  }

  /** Takes 0..1; YouTube wants 0-100. */
  async setVolume(volume: number): Promise<void> {
    (await whenReady()).setVolume(Math.round(clamp(volume, 0, 1) * 100));
  }

  async setRate(rate: number): Promise<void> {
    (await whenReady()).setPlaybackRate(clamp(rate, RATE_MIN, RATE_MAX));
  }

  async unload(): Promise<void> {
    this.currentVideoId = null;
    this.lastPositionMs = 0;

    // Deliberately does not await whenReady(): unload runs on room teardown,
    // where the host is usually unmounting in the same frame. Waiting 15s for a
    // player that is already gone would keep the controller alive past destroy.
    if (!controls) return;

    controls.pause();
    controls.unload?.();
  }

  /** The video id currently loaded, for "playing from YouTube" attribution. */
  getCurrentVideoId(): string | null {
    return this.currentVideoId;
  }

  onEnded(listener: () => void): () => void {
    endedListeners.add(listener);
    return () => {
      endedListeners.delete(listener);
    };
  }

  onError(listener: (error: PlaybackError) => void): () => void {
    errorListeners.add(listener);
    return () => {
      errorListeners.delete(listener);
    };
  }
}

/**
 * There is exactly one player host in the tree, so there is exactly one
 * adapter. `createYouTubeAdapter()` exists for tests that want a fresh position
 * cache; every instance shares the same registry.
 */
export const youtubeAdapter = new YouTubeAdapter();

export function createYouTubeAdapter(): YouTubeAdapter {
  return new YouTubeAdapter();
}
