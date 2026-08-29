/**
 * WHICH Session this device is in — the one fact that has to outlive every
 * screen in the app.
 *
 * THIS USED TO BE A SIDE EFFECT OF THE SESSION SCREEN BEING MOUNTED, AND THAT
 * WAS THE BUG. `use-room-sync` upserted a `room_participants` row in an effect
 * and deleted it in the cleanup, so unmounting the screen left the Session.
 * Back and Leave were therefore genuinely the same operation — not because the
 * UI said so, but because membership ended when the screen went away, and no
 * amount of chrome could have separated them. Minimising a Session is only
 * possible once membership lives somewhere that survives navigation. This is
 * that somewhere: mounted in `@/lib/providers`, above the navigator, so it is
 * torn down by `leave()` and by nothing else.
 *
 * ─── What outlives the screen, and why ──────────────────────────────────────
 *
 * 1. THE MEMBERSHIP ROW. The point of the exercise. A minimised listener is
 *    still in the room, so the roster everyone else is looking at has to say so.
 *
 * 2. THE REALTIME SUBSCRIPTION on the `rooms` row. Without it a minimised
 *    listener is deaf to every play, pause and skip the host makes and comes
 *    back to a Session that moved on without them. It also carries the
 *    reconnect path (re-read, re-measure, re-anchor), which matters *more* now
 *    than it did: minimised is a state the app can sit in for hours.
 *
 * 3. THE PLAYBACK ATTACHMENT — the surprising one, and the one that would have
 *    been quietly wrong. `detach()` destroys the SyncController, which
 *    `unload()`s the adapter. On Spotify the adapter drives a REAL DEVICE
 *    somewhere else in the room, so detaching on screen unmount would pause the
 *    listener's actual speakers the moment they pressed Back. A minimised
 *    listener also has to keep following the host's track changes, or their
 *    device plays the previous song for the rest of the party.
 *
 * 4. THE HOST'S `onEnded` → `room_advance`. Only the host advances the queue. A
 *    host who minimises and still owns the aux must keep advancing it, or the
 *    Session stalls at the end of the current song for everybody in it.
 *
 * 5. THE FOREGROUND RE-ANCHOR. iOS throttles JS timers in the background and a
 *    returning phone is reliably behind. Same listener as before, moved here so
 *    it keeps working while nothing is rendering the Session.
 *
 * 6. THE CLOCK. One measurement per *entered room* rather than per mount.
 *
 * ─── What stops, and the one that does not ──────────────────────────────────
 *
 * The brief's suggested split had the drift loop idling while nothing renders
 * the Session and re-arming on return. IT DOES NOT IDLE HERE, and the reason is
 * worth stating rather than leaving as a silent deviation:
 *
 *   - The loop lives inside `SyncController`, and the only lever on it from out
 *     here is `destroy()` — which unloads the adapter, i.e. exactly the Spotify
 *     case in (3). Anything finer means adding an arm/disarm to the sync engine
 *     itself, and the engine is the thing this pass must not break.
 *   - It costs approximately nothing to leave running. With no player behind
 *     it, `correctDrift` fails its position poll and already swallows that by
 *     design (`catch { return; }`) — a no-op timer every 3 s. With a *remote*
 *     player behind it, the measurements are real and the listener stays
 *     corrected, which is precisely the case where audio genuinely continues
 *     while minimised.
 *
 * What actually stops is the AUDIO SURFACE, and that is not this file's to
 * hold. `<YouTubePlayerHost/>` is a WebView mounted by the Session screen —
 * it is also the screen's artwork, and YouTube's terms expect it to be visible
 * — so a YouTube listener's sound stops when the screen goes. Spotify's does
 * not, because the sound is on another device entirely. This layer is
 * deliberately agnostic about that: it never stops the music itself, and it
 * re-anchors whenever a surface appears. If the host is ever hoisted above the
 * navigator, a minimised YouTube Session keeps playing with no change in here.
 * That decision belongs with the screen, because mounting a second host would
 * put two WebViews on one song.
 *
 * RE-ANCHORING ON RETURN IS NOT A NICETY, IT IS REQUIRED. A returning screen
 * brings a NEW, empty player while the controller still believes its timeline
 * is applied, so `applyTimeline` would short-circuit on `sameTimeline` and the
 * fresh WebView would sit silent forever. Gaining a renderer therefore clears
 * any error raised while nobody was looking and forces a full `resync()`.
 */

import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState, Platform } from 'react-native';

import { normalizeRoomRow, roomKeys, useResolvedTrack, useRoom } from '@/features/rooms/queries';
import { useAuth } from '@/lib/auth';
import { ensureFreshClock, syncClock } from '@/lib/clock';
import type { MusicProvider } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';
import { usePlayback } from '@/playback/store';
import type { DriftAction } from '@/playback/sync-controller';
import type { PlaybackError } from '@/playback/types';

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

/**
 * Sentinel for "the clock has never been synced".
 *
 * A room id is a uuid, so no real key can collide with this, and it has to be
 * distinct from `null` — which would read as ready the moment the provider
 * mounts with no Session entered.
 */
const CLOCK_NEVER_SYNCED = 'never-synced';

/**
 * Writes to this device's single `room_participants` row, serialized.
 *
 * Module-level because it is genuinely one row per device, not per component.
 * Switching Sessions fires a delete for the old room and an upsert for the new
 * one from two different effect runs; bouncing A → B → A fast enough would
 * otherwise let A's stale delete land on top of A's fresh upsert and drop the
 * user out of a Session they are looking at. The rejection handler is the same
 * function so one failed link cannot stall the chain.
 */
let membershipWrites: Promise<unknown> = Promise.resolve();

function queueMembershipWrite(run: () => PromiseLike<unknown>): void {
  membershipWrites = membershipWrites.then(run, run);
}

/** Where a caller wants to be. Only `roomId` is knowable from a deep link. */
export type SessionTarget = {
  roomId: string;
  /** Known by whatever launched the Session; reconciled from the row when it lands. */
  loungeId?: string | null;
  name?: string | null;
};

export type SessionValue = {
  roomId: string | null;
  loungeId: string | null;
  name: string | null;
  /** A Session is entered: the membership row is live and playback is attached. */
  active: boolean;
  /**
   * Entered, and nothing on screen is rendering it. THIS is what a return bar
   * shows on — not `active`, which is still true while the Session screen is up.
   */
  minimized: boolean;
  /** True once the clock offset has been measured for the entered room. */
  clockReady: boolean;
  /**
   * Enter `target`, leaving whatever Session was active first. Navigates
   * nowhere — routing is the caller's business, and entering without navigating
   * is a legitimate thing to want.
   */
  enter: (target: SessionTarget) => void;
  /**
   * The ONLY thing that ends a Session: drops the membership row, detaches
   * playback, closes the subscription. Navigates nowhere.
   */
  leave: () => void;
  /**
   * Declares that the caller is rendering the Session; returns the release.
   * `useSessionPresentation()` is the hook form and the only intended caller.
   */
  retainPresentation: () => () => void;
};

type EnteredSession = { roomId: string; loungeId: string | null; name: string | null };

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  /*
    The account, from context rather than from `useCurrentUserId()`.

    Signing out calls `queryClient.clear()`, so the cached user-id query is a
    value that disappears rather than one that changes — and this provider needs
    to *notice the change* to drop the Session with it. The auth session is the
    live fact and it is one render away.
  */
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [entered, setEntered] = useState<EnteredSession | null>(null);
  const roomId = entered?.roomId ?? null;

  /**
   * How many mounted things are rendering the Session. A count rather than a
   * boolean so that a screen replacing itself (or a Fast Refresh remount)
   * cannot leave the Session looking minimised for a frame while it is not.
   */
  const [presentCount, setPresentCount] = useState(0);
  const presented = presentCount > 0;

  /**
   * WHICH room the clock has been synced for, not whether it has.
   *
   * Storing the key rather than a boolean is what lets `clockReady` be derived:
   * a plain flag has to be reset to `false` when the room changes, and a
   * synchronous setState in an effect body cascades renders. It also means
   * there is no render in which the flag still reads `true` for the room we
   * just left.
   */
  const [clockFor, setClockFor] = useState<string>(CLOCK_NEVER_SYNCED);
  const clockReady = roomId !== null && clockFor === roomId;

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
  /**
   * Whether the ROOM says it is playing, for `handleEnded` to check.
   *
   * An ENDED event on a paused room is a bug report, not a cue to advance —
   * see the argument in `handleEnded`.
   */
  const isPlayingRef = useRef(false);

  useEffect(() => {
    isHostRef.current = isHost;
    userIdRef.current = userId;
    isPlayingRef.current = room?.is_playing === true;
  }, [isHost, userId, room?.is_playing]);

  const lastAdvanceRef = useRef(0);
  const lastSyncFlagRef = useRef<{ value: boolean | null; at: number }>({ value: null, at: 0 });

  // ------------------------------------------------------------ the switch

  const enter = useCallback((target: SessionTarget) => {
    setEntered((current) => {
      if (current?.roomId === target.roomId) {
        // Already here. Adopt any better labels the caller brought — a lounge
        // knows the Session's name, a deep link does not — but return the SAME
        // object when nothing improved, or a screen that calls `enter()` from an
        // effect re-enters itself forever.
        const name = target.name ?? current.name;
        const loungeId = target.loungeId ?? current.loungeId;
        if (name === current.name && loungeId === current.loungeId) return current;
        return { roomId: current.roomId, loungeId, name };
      }

      // A different room. Everything below is keyed on the entered room id, so
      // the effect cleanups do the leaving: one delete for the old row, one
      // upsert for the new one, in that order. Two participant rows for one
      // person cannot exist, which is the only way the roster stays honest.
      return {
        roomId: target.roomId,
        loungeId: target.loungeId ?? null,
        name: target.name ?? null,
      };
    });
  }, []);

  const leave = useCallback(() => setEntered(null), []);

  const retainPresentation = useCallback(() => {
    setPresentCount((count) => count + 1);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      setPresentCount((count) => count - 1);
    };
  }, []);

  /*
    A change of account is a change of who is in the room, so the Session goes
    with it. The row delete below is best-effort in the sign-out direction: by
    the time `user` reads null the token is already revoked, so RLS refuses the
    delete and the row is orphaned exactly as it would be if the app were
    killed — which `upsert` on the next join already handles. A sign-out that
    wants to be tidy should call `leave()` BEFORE `signOut()`.
  */
  const previousUserRef = useRef(userId);
  useEffect(() => {
    const previous = previousUserRef.current;
    previousUserRef.current = userId;
    // Only a real change: null -> id is a cold start finishing, not a sign-out.
    if (previous !== null && previous !== userId) setEntered(null);
  }, [userId]);

  // --------------------------------------------------------------- 1. clock

  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;

    // Measuring runs in parallel with the row fetch; only *applying* waits.
    // Nothing is written synchronously here, because `clockReady` reads false
    // for this room until it lands.
    void syncClock().finally(() => {
      if (!cancelled) setClockFor(roomId);
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
   *
   * This is one of the reasons the attachment lives up here: a host who
   * minimised the Session still owns the aux, and a queue that only advances
   * while the host is looking at the screen stalls the party for everyone.
   */
  const handleEnded = useCallback(() => {
    if (!roomId || !isHostRef.current) return;

    /*
      NOT WHILE THE ROOM IS PAUSED, and this guard is not theoretical.

      `room_advance` sets `is_playing = true`. Ordinarily a paused track cannot
      reach its end, so the check looks redundant — but a player that ignored a
      pause carries on to the end of the song while the room row says paused,
      and this handler would then turn the room back on underneath the person
      who had just stopped it. Their pause would come undone by the very track
      they paused, which reads as the button not working at all.

      The host-side repair for that state is in `youtube-player-host.tsx`; this
      is the half that stops the damage spreading to everyone else in the room.
    */
    if (!isPlayingRef.current) return;

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
    // Kept as an explicit no-op so the shape stays obvious to the next reader.
  }, []);

  useEffect(() => {
    if (!roomId) return;

    const { attachRoom, detach } = usePlayback.getState();
    attachRoom(roomId, undefined, {
      onEnded: handleEnded,
      onDrift: reportDrift,
      onError: handleError,
    });

    // Runs on `leave()` and on entering a different Session — NOT on the screen
    // unmounting, which is the entire change. `detach()` unloads the adapter,
    // and on Spotify that adapter is a real device in the room.
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

  // ------------------------------------------------- 4. realtime on the row

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
    queueMembershipWrite(() =>
      supabase
        .from('room_participants')
        .upsert(
          { room_id: roomId, user_id: userId, is_synced: true },
          { onConflict: 'room_id,user_id' }
        )
        .then(() => {
          void queryClient.invalidateQueries({ queryKey: roomKeys.participants(roomId) });
        })
    );

    return () => {
      queueMembershipWrite(() =>
        supabase
          .from('room_participants')
          .delete()
          .eq('room_id', roomId)
          .eq('user_id', userId)
          .then(() => {
            void queryClient.invalidateQueries({ queryKey: roomKeys.participants(roomId) });
          })
      );
    };
  }, [roomId, userId, queryClient]);

  // --------------------------------------------------- 6. foreground resync

  useEffect(() => {
    // Gated on being in a Session, where it used to be unconditional. That is
    // not a narrowing: this listener is now the thing that catches up a Session
    // the user minimised hours ago and an OS that froze its timers the whole
    // time, which is a longer and much more likely gap than the old one.
    //
    // Foregrounding a MINIMISED Session on a local player re-anchors into a
    // player that is not mounted, so the adapter call queues on the host and
    // times out into an error nobody is looking at — cleared by the re-anchor
    // below when the user comes back. Hoisting the player host above the
    // navigator removes that too; see the header.
    if (!roomId) return;

    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;

      void (async () => {
        await ensureFreshClock();
        await usePlayback.getState().resync();
      })();
    });

    return () => subscription.remove();
  }, [roomId]);

  // ------------------------------------------- 7. re-anchor on gaining a view

  useEffect(() => {
    if (!roomId || !presented) return;

    /*
      Something is rendering the Session again, which means a NEW audio surface
      (the screen remounts its player host) while the controller still believes
      its timeline is applied. `applyTimeline` would short-circuit on
      `sameTimeline` and leave that fresh player silent, so force the full
      re-anchor rather than waiting for the room row to change.

      The error is cleared first because anything raised while nobody was
      looking was never read, and the resync immediately re-tests the assertion
      — if the condition still holds it comes straight back.
    */
    void (async () => {
      usePlayback.getState().clearError();
      await ensureFreshClock();
      await usePlayback.getState().resync();
    })();
  }, [roomId, presented]);

  // -------------------------------------------------- publish the sync flag

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

  /*
    The row is the better answer once it lands; the caller's hint is what fills
    the return bar in the meantime. `||` rather than `??` on the lounge id
    because `normalizeRoomRow` falls back to '' for a malformed row, and an
    empty string is not an id.
  */
  const loungeId = room?.lounge_id || entered?.loungeId || null;
  const name = room?.name ?? entered?.name ?? null;

  const value = useMemo<SessionValue>(
    () => ({
      roomId,
      loungeId,
      name,
      active: roomId !== null,
      minimized: roomId !== null && !presented,
      clockReady,
      enter,
      leave,
      retainPresentation,
    }),
    [roomId, loungeId, name, presented, clockReady, enter, leave, retainPresentation]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/**
 * The Session this device is in, if any.
 *
 * Safe to call from anywhere below `<Providers>` — including the tab bar, which
 * is the point. Reading it does NOT make you a participant; `enter()` does.
 */
export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) {
    throw new Error('useSession() requires <SessionProvider> above it — see @/lib/providers.');
  }
  return value;
}

/**
 * Declare that this component is RENDERING the active Session, which is what
 * makes it not-minimised and what re-anchors playback on the way back in.
 *
 * `useRoomSync` already calls this, so the Session screen gets it for free.
 * Nothing else should: a return bar showing what is playing is not rendering
 * the Session, it is advertising it.
 */
export function useSessionPresentation(): void {
  const { retainPresentation } = useSession();
  useEffect(() => retainPresentation(), [retainPresentation]);
}
