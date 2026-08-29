/**
 * The Session screen's view of the Session it is showing.
 *
 * THIS FILE USED TO BE THE SESSION ITSELF, AND THAT WAS THE PROBLEM. It owned
 * the clock, the realtime subscription, the playback attachment and — the one
 * that decided everything — a `room_participants` upsert in an effect with a
 * DELETE in the cleanup. Membership was therefore a side effect of this hook
 * being mounted: unmounting the screen left the Session, which is why the
 * screen could only ever wire Back to Leave. All of that now lives in
 * `SessionProvider` (@/lib/session), above the navigator, where it survives
 * navigation and is torn down by `leave()` alone. Read that file's header for
 * the argument about what has to outlive a screen and what does not.
 *
 * What is left here is what genuinely belongs to a screen:
 *
 *   1. ENTERING. Opening a Session screen enters that Session. That was already
 *      true — it was just spelled as a participant-row effect — and it is what
 *      makes opening a *different* Session leave the first one, because the
 *      provider keys its row on the entered id.
 *   2. PRESENTING. Telling the provider something is rendering the Session, so
 *      it is not minimised and so playback re-anchors onto the fresh player the
 *      screen brings with it.
 *   3. READING. The row, its resolved track and the derived flags the screen
 *      draws. These are React Query reads on the same keys the provider uses,
 *      so they are one fetch, not two.
 *
 * The order the provider runs in — measure the clock, fetch the row, apply,
 * re-anchor on foreground and on reconnect — is unchanged and is still the
 * whole design. Nothing in this hook may apply a timeline.
 */

import { useCallback, useEffect } from 'react';

import { syncClock } from '@/lib/clock';
import type { RoomRow } from '@/lib/database.types';
import { useSession, useSessionPresentation } from '@/lib/session';
import { usePlayback } from '@/playback/store';
import type { ResolvedTrack } from '@/playback/types';

import { useCurrentUserId, useResolvedTrack, useRoom } from './queries';

export type RoomSyncState = {
  room: RoomRow | null;
  track: ResolvedTrack | null;
  userId: string | null;
  isHost: boolean;
  /** True until the room row, its track, and the clock offset have all landed. */
  isLoading: boolean;
  /** True once `syncClock()` has resolved — before that, positions are meaningless. */
  clockReady: boolean;
  error: Error | null;
  resync: () => void;
};

export function useRoomSync(roomId: string | null): RoomSyncState {
  const userId = useCurrentUserId();
  const { enter, roomId: activeRoomId, clockReady: sessionClockReady } = useSession();

  /*
    Entering is the screen's one act of authority over the lifecycle, and it is
    deliberately not conditional on what is already active: `enter()` on the
    room we are in returns the same state object, and `enter()` on a different
    one runs the provider's teardown for the first. Two participant rows for one
    person is a lie the roster would happily display, and this is where it is
    prevented.
  */
  useEffect(() => {
    if (!roomId) return;
    enter({ roomId });
  }, [roomId, enter]);

  useSessionPresentation();

  const roomQuery = useRoom(roomId);
  const room = roomQuery.data ?? null;

  const trackQuery = useResolvedTrack(room?.track_id ?? null);
  const track = trackQuery.data ?? null;

  const isHost = Boolean(room && userId && room.host_id === userId);

  /*
    The provider measures the offset once per entered room, so readiness is its
    answer rather than this hook's. Comparing the ids matters for the frame
    between this screen mounting and its `enter()` landing: during it the
    provider is still ready for the room we are LEAVING, and treating that as
    ready here would anchor the new Session against the old measurement.
  */
  const clockReady = activeRoomId === roomId && sessionClockReady;

  const resync = useCallback(() => {
    void (async () => {
      await syncClock();
      await usePlayback.getState().resync();
    })();
  }, []);

  return {
    room,
    track,
    userId,
    isHost,
    isLoading: roomQuery.isLoading || (Boolean(room?.track_id) && trackQuery.isLoading),
    clockReady,
    error: roomQuery.error ?? trackQuery.error ?? null,
    resync,
  };
}
