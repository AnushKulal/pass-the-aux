/**
 * Server clock synchronisation.
 *
 * Every listener in a Session derives its playback position from a single
 * server timestamp (`rooms.started_at_ms`). That only works if everyone agrees
 * on what time it is now — and device clocks are routinely seconds off, which
 * would be seconds of audible desync.
 *
 * So we never trust `Date.now()` directly. We measure how wrong it is against
 * the database clock and correct for it, NTP-style: take several samples, keep
 * the one with the lowest round-trip (least network noise, most accurate
 * midpoint estimate), and use its offset.
 */

import { supabase } from './supabase';

type Sample = { offsetMs: number; rttMs: number };

let offsetMs = 0;
let lastSyncedAt = 0;
let inFlight: Promise<number> | null = null;

const SAMPLE_COUNT = 5;
const STALE_AFTER_MS = 60_000;

async function takeSample(): Promise<Sample | null> {
  const t0 = Date.now();
  const { data, error } = await supabase.rpc('server_time_ms');
  const t1 = Date.now();

  if (error || data == null) return null;

  const rttMs = t1 - t0;
  // Assume the request and response legs are symmetric, so the server's
  // timestamp corresponds to the midpoint of our round trip.
  const midpoint = t0 + rttMs / 2;

  return { offsetMs: Number(data) - midpoint, rttMs };
}

/**
 * Re-measure the offset. Concurrent callers share one in-flight measurement so
 * a room join, an app foreground and the periodic timer cannot stack up.
 */
export async function syncClock(): Promise<number> {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const samples: Sample[] = [];

    for (let i = 0; i < SAMPLE_COUNT; i++) {
      const sample = await takeSample();
      if (sample) samples.push(sample);
    }

    if (samples.length > 0) {
      // Lowest RTT wins outright rather than averaging: a single clean sample
      // beats a mean polluted by one slow request on a mobile network.
      const best = samples.reduce((a, b) => (b.rttMs < a.rttMs ? b : a));
      offsetMs = best.offsetMs;
      lastSyncedAt = Date.now();
    }

    inFlight = null;
    return offsetMs;
  })();

  return inFlight;
}

/** Current server time in epoch ms, corrected for this device's clock error. */
export function serverNow(): number {
  return Date.now() + offsetMs;
}

export function getClockOffset(): number {
  return offsetMs;
}

/** True when the offset is old enough that it should be re-measured. */
export function isClockStale(): boolean {
  return Date.now() - lastSyncedAt > STALE_AFTER_MS;
}

/** Re-measure only if the current offset has gone stale. */
export async function ensureFreshClock(): Promise<number> {
  return isClockStale() ? syncClock() : offsetMs;
}
