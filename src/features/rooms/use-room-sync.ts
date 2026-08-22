/**
 * The wiring between one `rooms` row and this phone's speaker.
 *
 * Read this order — it is the whole design, and getting it wrong is the class
 * of bug the sync engine exists to prevent:
 *
 *   1. Measure the clock offset. Applying a timeline before `syncClock()` has
 *      landed anchors playback to `Date.now()`, which on a real phone is
 *      routinely seconds wrong — i.e. seconds of audible desync, on every
 *      listener, silently.
 *   2. Fetch the room row and resolve its track's provider links.
 *   3. Apply. Every subsequent realtime UPDATE re-applies the same way.
 *   4. Re-anchor on foreground and on realtime reconnect. iOS throttles JS
 *      timers in the background, so a returning phone is reliably behind.
 */

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';

import { ensureFreshClock, syncClock } from '@/lib/clock';
import type { MusicProvider, RoomRow } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';
import { usePlayback } from '@/playback/store';
import type { DriftAction } from '@/playback/sync-controller';
import type { PlaybackError, ResolvedTrack } from '@/playback/types';

import {
  normalizeRoomRow,
  roomKeys,
  useCurrentUserId,
  useResolvedTrack,
  useRoom,
} from './queries';

/**
 * Fraction of drift measurements written to `sync_metrics`. The controller
 * samples every 3s, so an unsampled two-hour Session would be ~2,400 rows per
 * listener — enough to matter on the free tier, and 1-in-10 is plenty to prove
 * the distribution.
 */
const DRIFT_SAMPLE_RATE = 0.1;

/**
 * The Spotify adapter can fire `onEnded` from more than one signal at once, and
 * a double `room_advance` would eat two tracks off the queue.
 */
const ADVANCE_COOLDOWN_MS = 4_000;

/** Minimum gap between `is_synced` writes, so a flapping connection is not a write storm. */
const SYNC_FLAG_INTERVAL_MS = 15_000;

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
  const queryClient = useQueryClient();
  const userId = useCurrentUserId();

  const [clockReady, setClockReady] = useState(false);

  const roomQuery = useRoom(roomId);
  const room = roomQuery.data ?? null;

  const trackQuery = useResolvedTrack(room?.track_id ?? null);
  const track = trackQuery.data ?? null;

  const isHost = Boolean(room && userId && room.host_id === userId);

  // Latest-value refs: the store's callbacks are registered once per room, so
  // they must not close over a stale `isHost` or a stale user id. Synced in an
  // effect rather than during render — the React Compiler is enabled on this
  // project and a render-phase ref write is not safe under it.
  const isHostRef = useRef(isHost);
  const userIdRef = useRef(userId);

  useEffect(() => {
    isHostRef.current = isHost;
    userIdRef.current = userId;
  }, [isHost, userId]);

  const lastAdvanceRef = useRef(0);
  const lastSyncFlagRef = useRef<{ value: boolean | null; at: number }>({ value: null, at: 0 });

  // --------------------------------------------------------------- 1. clock

  useEffect(() => {
    let cancelled = false;
    setClockReady(false);

    // Measuring runs in parallel with the row fetch; only *applying* waits.
    void syncClock().finally(() => {
      if (!cancelled) setClockReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, [roomId]);

  // ------------------------------------------------- 2. attach + store hooks

  const reportDrift = useCallback(
    (driftMs: number, _action: DriftAction, provider: MusicProvider) => {
      const uid = userIdRef.current;
      if (!roomId || !uid) return;
      if (Math.random() > DRIFT_SAMPLE_RATE) return;

      void supabase
        .from('sync_metrics')
        .insert({
          room_id: roomId,
          user_id: uid,
          provider,
          // The column is a plain integer; a drift measurement in the minutes
          // means the clock is broken, not that we should overflow the column.
          drift_ms: Math.max(-2_000_000, Math.min(2_000_000, Math.round(driftMs))),
          platform: Platform.OS,
        })
        .then(() => undefined);
    },
    [roomId]
  );

  /**
   * Only the host advances. If every client called `room_advance` on its own
   * `onEnded`, an eight-person Session would skip eight tracks the moment one
   * song finished.
   */
  const handleEnded = useCallback(() => {
    if (!roomId || !isHostRef.current) return;

    const now = Date.now();
    if (now - lastAdvanceRef.current < ADVANCE_COOLDOWN_MS) return;
    lastAdvanceRef.current = now;

    void supabase.rpc('room_advance', { p_room_id: roomId }).then(({ data }) => {
      const next = normalizeRoomRow(data);
      if (next) queryClient.setQueryData(roomKeys.detail(roomId), next);
      void queryClient.invalidateQueries({ queryKey: roomKeys.queue(roomId) });
    });
  }, [roomId, queryClient]);

  const handleError = useCallback((_error: PlaybackError) => {
    // The store already holds the error for the UI; nothing extra to do here.
    // Kept as an explicit no-op so the hook shape stays obvious to the next reader.
  }, []);

  useEffect(() => {
    if (!roomId) return;

    const { attachRoom, detach } = usePlayback.getState();
    attachRoom(roomId, undefined, {
      onEnded: handleEnded,
      onDrift: reportDrift,
      onError: handleError,
    });

    return () => {
      detach();
    };
  }, [roomId, handleEnded, reportDrift, handleError]);

  // ------------------------------------------------------- 3. apply timeline

  useEffect(() => {
    if (!clockReady || !room) return;

    // The resolved track lags the row by one fetch whenever the Session moves to
    // a new song. Applying the new timeline with the OLD track's provider ref
    // would play the previous song at the new song's position, so hold the
    // current audio for the extra tick instead.
    const trackReady = room.track_id == null || track?.id === room.track_id;
    if (!trackReady) return;

    void usePlayback.getState().applyRoomRow(room, track);
  }, [clockReady, room, track]);

  // ------------------------------------------------ 4. realtime on the row

  useEffect(() => {
    if (!roomId) return;

    // Set on any non-subscribed status so the *next* SUBSCRIBED is recognised as
    // a reconnect rather than the first connect.
    let wasDropped = false;

    const channel = supabase
      .channel(`room-row:${roomId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` },
        (payload) => {
          const next = normalizeRoomRow(payload.new);
          if (next) queryClient.setQueryData(roomKeys.detail(roomId), next);
        }
      )
      .subscribe((status) => {
        // `status` is a string enum from realtime-js, and TypeScript refuses to
        // compare a string enum against a bare literal. supabase-js does not
        // re-export the enum, so widen to string rather than reach into a
        // transitive package for it.
        if (String(status) !== 'SUBSCRIBED') {
          wasDropped = true;
          return;
        }
        if (!wasDropped) return;

        // We were deaf for a while: the row may have changed and our position
        // has been free-running. Re-read, re-measure, re-anchor.
        wasDropped = false;
        void queryClient.invalidateQueries({ queryKey: roomKeys.detail(roomId) });
        void ensureFreshClock().then(() => usePlayback.getState().resync());
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [roomId, queryClient]);

  // ----------------------------------------------------- 5. participant row

  useEffect(() => {
    if (!roomId || !userId) return;

    // Upsert, not insert: a previous Session that was killed rather than exited
    // can leave the row behind, and a plain insert would 409 on rejoin.
    void supabase
      .from('room_participants')
      .upsert({ room_id: roomId, user_id: userId, is_synced: true }, { onConflict: 'room_id,user_id' })
      .then(() => {
        void queryClient.invalidateQueries({ queryKey: roomKeys.participants(roomId) });
      });

    return () => {
      void supabase
        .from('room_participants')
        .delete()
        .eq('room_id', roomId)
        .eq('user_id', userId)
        .then(() => undefined);
    };
  }, [roomId, userId, queryClient]);

  // --------------------------------------------------- 6. foreground resync

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;

      void (async () => {
        await ensureFreshClock();
        await usePlayback.getState().resync();
      })();
    });

    return () => subscription.remove();
  }, []);

  // ------------------------------------------------- publish the sync flag

  const isSynced = usePlayback((state) => state.isSynced);

  useEffect(() => {
    if (!roomId || !userId) return;

    const last = lastSyncFlagRef.current;
    if (last.value === isSynced) return;

    const write = () => {
      lastSyncFlagRef.current = { value: isSynced, at: Date.now() };

      void supabase
        .from('room_participants')
        .update({ is_synced: isSynced })
        .eq('room_id', roomId)
        .eq('user_id', userId)
        .then(() => undefined);
    };

    // Defer rather than drop: these deps only change on an actual flag flip, so
    // a transition swallowed by the rate limit would never be retried and the
    // room would keep showing a recovered listener as out of sync.
    const waitMs = last.value === null ? 0 : SYNC_FLAG_INTERVAL_MS - (Date.now() - last.at);
    if (waitMs <= 0) {
      write();
      return;
    }

    const timer = setTimeout(write, waitMs);
    return () => clearTimeout(timer);
  }, [isSynced, roomId, userId]);

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
