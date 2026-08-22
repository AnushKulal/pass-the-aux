/**
 * The sync engine.
 *
 * A Session's entire playback state is one database row: which track, and the
 * server instant at which position 0 of it played. Nothing is streamed through
 * the backend. Every client independently answers "where should I be right
 * now?" and steers its own player there.
 *
 *   expected = server_now   - started_at_ms     while playing
 *   expected = paused_at_ms - started_at_ms     while paused
 *
 * That makes a late joiner free: read the row, do the arithmetic, seek, play.
 * They land mid-song at the right second with no special-casing.
 */

import { serverNow } from '@/lib/clock';
import { Drift, PlaybackError, type PlaybackAdapter, type PlayableRef } from './types';

/** The subset of a room row that defines the playback timeline. */
export type RoomTimeline = {
  trackId: string | null;
  startedAtMs: number | null;
  pausedAtMs: number | null;
  isPlaying: boolean;
};

/** Where the Session should be, in ms into the current track. */
export function expectedPositionMs(timeline: RoomTimeline, nowMs = serverNow()): number {
  if (timeline.startedAtMs == null) return 0;

  const anchor = timeline.isPlaying ? nowMs : (timeline.pausedAtMs ?? nowMs);
  return Math.max(0, anchor - timeline.startedAtMs);
}

export type DriftAction = 'none' | 'nudge' | 'seek';

export type SyncControllerOptions = {
  /** Called on every drift measurement, for telemetry and the "in sync" badge. */
  onDrift?: (driftMs: number, action: DriftAction) => void;
  /** Called when the local track finishes; the host uses this to advance. */
  onEnded?: () => void;
  onError?: (error: PlaybackError) => void;
};

const sameTimeline = (a: RoomTimeline | null, b: RoomTimeline) =>
  a !== null &&
  a.trackId === b.trackId &&
  a.startedAtMs === b.startedAtMs &&
  a.pausedAtMs === b.pausedAtMs &&
  a.isPlaying === b.isPlaying;

export class SyncController {
  private timeline: RoomTimeline | null = null;
  private ref: PlayableRef | null = null;
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private nudgeTimer: ReturnType<typeof setTimeout> | null = null;
  private disposers: (() => void)[] = [];
  private destroyed = false;

  /**
   * Last position we actually read from the player, and when we read it.
   * For remote players (Spotify) reading position costs a rate-limited API
   * call, so between reads we extrapolate from this pair instead of polling.
   */
  private lastKnown: { positionMs: number; atMs: number } | null = null;
  private applying = false;

  constructor(
    private adapter: PlaybackAdapter,
    private options: SyncControllerOptions = {}
  ) {
    this.disposers.push(
      adapter.onEnded(() => this.options.onEnded?.()),
      adapter.onError((error) => this.options.onError?.(error))
    );
  }

  /**
   * Point the controller at a new timeline. Safe to call on every realtime
   * update — identical timelines are ignored, so a chatty channel does not
   * cause a seek storm.
   */
  async applyTimeline(next: RoomTimeline, ref: PlayableRef | null): Promise<void> {
    if (this.destroyed) return;

    const trackChanged = this.timeline?.trackId !== next.trackId || this.ref?.providerId !== ref?.providerId;

    if (!trackChanged && sameTimeline(this.timeline, next)) return;

    this.timeline = next;
    this.ref = ref;

    // Guard against overlapping applies: a track change awaits a network load,
    // and a second update arriving mid-load would otherwise interleave seeks.
    if (this.applying) return;
    this.applying = true;

    try {
      if (!ref || next.trackId == null) {
        await this.adapter.unload();
        this.stopDriftLoop();
        return;
      }

      const target = expectedPositionMs(next);

      if (trackChanged) {
        await this.adapter.load(ref, target, next.isPlaying);
      } else if (next.isPlaying) {
        // Resume or seek within the same track: put the player where the room
        // says it should be, then let it run.
        await this.adapter.seek(target);

        // Every await above is a chance for the user to have left the Session.
        // This guard is the important one: `destroy()` issues `unload()` (a
        // pause), and a `play()` landing after it would restart the track on a
        // room the user is no longer in. On Spotify that means their real
        // device keeps playing the party's music after they walked away.
        if (this.destroyed) return;
        await this.adapter.play();
      } else {
        await this.adapter.pause();
        await this.adapter.seek(target);
      }

      if (this.destroyed) return;

      this.lastKnown = { positionMs: target, atMs: serverNow() };

      if (next.isPlaying) this.startDriftLoop();
      else this.stopDriftLoop();
    } catch (error) {
      // A failure belonging to a room the user has already left must not
      // surface in the room they are in now — the error lands in a single
      // module-level store that the current room screen renders.
      if (this.destroyed) return;

      this.options.onError?.(
        error instanceof PlaybackError
          ? error
          : new PlaybackError('unknown', String(error))
      );
    } finally {
      this.applying = false;

      // A newer timeline may have landed while we were awaiting. Re-run so we
      // converge on the latest state rather than on whatever we started with.
      if (this.timeline && !sameTimeline(next, this.timeline)) {
        const pending = this.timeline;
        const pendingRef = this.ref;
        this.timeline = null;
        await this.applyTimeline(pending, pendingRef);
      }
    }
  }

  /**
   * Current position without necessarily touching the player. Local players
   * are cheap to ask; remote ones are extrapolated from the last real reading.
   */
  estimatePositionMs(): number {
    if (!this.lastKnown) return 0;
    if (!this.timeline?.isPlaying) return this.lastKnown.positionMs;

    return this.lastKnown.positionMs + (serverNow() - this.lastKnown.atMs);
  }

  /** Force a full re-anchor. Call on app foreground and network reconnect. */
  async resync(): Promise<void> {
    if (!this.timeline) return;

    const timeline = this.timeline;
    this.timeline = null; // defeat the identical-timeline short circuit
    await this.applyTimeline(timeline, this.ref);
  }

  destroy(): void {
    this.destroyed = true;
    this.stopDriftLoop();
    this.disposers.forEach((dispose) => dispose());
    this.disposers = [];
    void this.adapter.unload();
  }

  // ------------------------------------------------------------- drift loop

  private startDriftLoop(): void {
    // `destroy()` clears the handle and then has no further chance to clear a
    // new one, so an interval created after it would tick forever with nothing
    // holding a reference to cancel it.
    if (this.destroyed || this.checkTimer) return;

    this.checkTimer = setInterval(() => {
      void this.correctDrift();
    }, Drift.CHECK_INTERVAL_MS);
  }

  private stopDriftLoop(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
    if (this.nudgeTimer) {
      // The timer we are cancelling owed the player a `setRate(1)`; without it a
      // pause landing mid-nudge leaves playback pinned at 0.98x/1.02x forever.
      // `destroy()` is already unloading the adapter, so skip it there.
      if (!this.destroyed) void this.adapter.setRate(1);

      clearTimeout(this.nudgeTimer);
      this.nudgeTimer = null;
    }
  }

  private async correctDrift(): Promise<void> {
    if (this.destroyed || this.applying) return;
    if (!this.timeline?.isPlaying || !this.ref) return;

    const shouldPoll =
      this.adapter.capabilities.hasLocalPosition ||
      !this.lastKnown ||
      serverNow() - this.lastKnown.atMs > Drift.REMOTE_POLL_INTERVAL_MS;

    let actual: number;
    try {
      if (shouldPoll) {
        actual = await this.adapter.getPosition();
        this.lastKnown = { positionMs: actual, atMs: serverNow() };
      } else {
        actual = this.estimatePositionMs();
      }
    } catch {
      return; // a failed poll is not worth surfacing; the next tick retries
    }

    const expected = expectedPositionMs(this.timeline);
    const drift = actual - expected; // positive = we are ahead
    const magnitude = Math.abs(drift);

    let action: DriftAction = 'none';

    if (magnitude > Drift.SEEK) {
      // Too far gone to hide — take the audible hit and land exactly.
      action = 'seek';
      await this.adapter.seek(expected);
      this.lastKnown = { positionMs: expected, atMs: serverNow() };
    } else if (magnitude > Drift.IGNORE && this.adapter.capabilities.canSetRate) {
      // Absorb it by running slightly fast or slow. At 2% the pitch shift is
      // below the threshold of perception, so this is inaudible where a seek
      // would be a jarring skip.
      action = 'nudge';
      await this.adapter.setRate(1 + (drift > 0 ? -Drift.RATE_NUDGE : Drift.RATE_NUDGE));

      // Run the nudge just long enough to erase the gap, then snap back to 1.0.
      const correctionMs = Math.min((magnitude / Drift.RATE_NUDGE) * 1.2, Drift.CHECK_INTERVAL_MS);
      if (this.nudgeTimer) clearTimeout(this.nudgeTimer);
      this.nudgeTimer = setTimeout(() => {
        void this.adapter.setRate(1);
        this.nudgeTimer = null;
      }, correctionMs);
    }

    this.options.onDrift?.(drift, action);
  }
}
