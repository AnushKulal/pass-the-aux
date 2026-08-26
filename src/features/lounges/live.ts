/**
 * WHAT "LIVE" MEANS. One definition, one file, every caller.
 *
 * THIS EXISTS BECAUSE THE BADGE WAS ON WHEN NOTHING WAS HAPPENING. A lounge
 * header read "1 member · Public · 1 live" while the only Session under it said
 * "Nothing playing yet" and had nobody in it. The badge was already conditional
 * — the lounge screen gated on `liveSessions.length > 0` — so the gate was not
 * the bug. The PREDICATE was: every screen derived liveness for itself, and
 * every one of them derived it from the wrong column.
 *
 *   the lounge header  `liveSessions.length`      a room ROW EXISTS
 *   the Lounges tab    `activeSessions > 0`       a room ROW EXISTS
 *   the Session card   `isPlaying` for the dot, but the name stayed coral
 *                      unconditionally, so an idle empty room named itself in
 *                      the state colour
 *
 * `rooms.is_active` is not a liveness flag. It is a tombstone flag: it is
 * `true` from the moment `useStartSession` inserts the row and stays `true`
 * until somebody ends the Session. Press "Start a Session", back out
 * immediately, and that row sits there `is_active` and idle forever, counting
 * as live on three screens. That is exactly what the screenshot caught.
 *
 * ------------------------------------------------------------------ the rule
 *
 * A Session is LIVE when it is PLAYING, or when somebody is actually sitting
 * in it. A room that exists with no track and no occupants is not live, it is
 * EMPTY, and the UI says so.
 *
 * Both halves are load-bearing and neither one alone is enough:
 *
 *   `rooms.is_playing`  — real playback state, and the DB will not let it lie:
 *     `rooms_playing_needs_track` forbids `is_playing` without a `track_id` and
 *     a `started_at_ms`. It survives everyone closing the app, which is the
 *     case `listeners` alone would call dead — the timeline is still running
 *     and whoever walks in next lands mid-track.
 *
 *   `room_participants`  — who is in the room RIGHT NOW. `use-room-sync` upserts
 *     your row on entering the Session screen and deletes it on the way out, so
 *     the count is presence, not history. It is what makes a room where three
 *     people are sitting between tracks read as live rather than as dead.
 *
 * ------------------------------------------------- what the aggregate can prove
 *
 * `useLoungeSessions` returns a room row per Session, so `isSessionLive` gets
 * both halves and is exact. `useMyLounges` does not: it selects `id, lounge_id`
 * off `rooms` and counts distinct participants per LOUNGE, so there is no
 * per-room `is_playing` to read. `isLoungeLive` is therefore the same rule
 * collapsed onto the half that query can actually prove — see the note on it.
 */

import type { LoungeSessionSummary, LoungeSummary } from './queries';

/**
 * The two facts liveness is made of, named rather than passed positionally so a
 * caller cannot swap them by accident.
 */
export type SessionLiveness = {
  /** `rooms.is_playing` — a track is on the decks and the timeline is running. */
  isPlaying: boolean;
  /** Rows in `room_participants` — people in the room this second. */
  listeners: number;
};

/**
 * THE PREDICATE. Nothing in the app is allowed to answer this question its own
 * way; if a screen needs "is this live", it calls this.
 */
export function isSessionLive({ isPlaying, listeners }: SessionLiveness): boolean {
  return isPlaying || listeners > 0;
}

/** The same rule applied to what `useLoungeSessions` hands back. */
export function isLoungeSessionLive(entry: LoungeSessionSummary): boolean {
  return isSessionLive({ isPlaying: entry.room.is_playing, listeners: entry.listeners });
}

/**
 * How many of a lounge's Sessions are live — the number behind "· 3 live" in
 * the lounge header. NOT `sessions.length`, which is how many rooms exist.
 */
export function countLiveSessions(sessions: readonly LoungeSessionSummary[]): number {
  let live = 0;
  for (const entry of sessions) {
    if (isLoungeSessionLive(entry)) live += 1;
  }
  return live;
}

/**
 * Is anything live in this lounge, from the LIST-level summary?
 *
 * `LoungeSummary.listeners` is distinct people across the lounge's active
 * rooms, so `listeners > 0` is the occupancy half of `isSessionLive` folded up
 * one level: somebody is sitting in one of these rooms.
 *
 * IT IS DELIBERATELY NOT `activeSessions > 0`, WHICH IS WHAT IT USED TO BE.
 * That counted rooms that merely exist — the whole bug this file was written
 * for. It reports one lounge as live where the exact predicate would report
 * two: `fetchMyLounges` never selects `rooms.is_playing`, so a room still
 * playing to an empty house is invisible from here. Under-claiming is the right
 * direction to be wrong in — a badge that is silent about a room nobody is in
 * costs the user nothing, and a badge that lies about an empty room is the
 * complaint that started this. Closing the gap is a one-line change in
 * `fetchMyLounges`: select `is_playing` alongside `id, lounge_id` and count the
 * rooms satisfying `isSessionLive` per lounge, then read that here.
 */
export function isLoungeLive(summary: Pick<LoungeSummary, 'listeners'>): boolean {
  return summary.listeners > 0;
}
