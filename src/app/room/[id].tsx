/**
 * The Session. This is the party, and it is the screen the whole direction
 * exists for.
 *
 * Built from design/nocturne/aux-nocturne.dc.html, screen `isSession`:
 * the header at L900-L908, the stage switch at L910-L913, the scrolling body
 * at L915, the track card at L918-L950, the sync line at L952-L961, the orbit
 * at L965-L1005, and the GLASS lobby bar welded to the bottom edge at
 * L1145-L1158. The sheets are L1163-L1180 (queue), L1245-L1284 (chat), L1286
 * (the drawer) and L1439-L1462 (sync diagnostics).
 *
 * ------------------------------------------------------------------ layout
 *
 *   header      back · session name / LOUNGE · MODE · the N/N LOCKED pill
 *   switch      Now playing | Members · N            <- top of the module
 *   video       the 16:9 player module, when YouTube is the live provider
 *   body        now      the track card, the transport, the aux hand-off,
 *                        the sync line, and the way to add a track
 *               people   the sync orbit and the roster. PEOPLE ONLY.
 *   lobby bar   the drawer handle · MIC · DEAFEN · QUEUE · CHAT · LEAVE
 *
 * ------------------------------------------- THE SWITCH MOVED TO THE TOP, AND
 * ------------------------------------------- THAT REVERSES THIS FILE'S OWN
 * ------------------------------------------- LOUDEST PREVIOUS RULING
 *
 * This file used to carry a deviation reading "THE STAGE SITS ABOVE THE SWITCH,
 * not inside it", justified because `<NowPlaying>` mounted the YouTube player
 * host and unmounting that mid-song stops the audio. The consequence was a
 * Session where the toggle sat halfway down the screen under a player you could
 * not get rid of, and where picking "Listeners" still left "Nothing on the deck"
 * pinned above the roster. The user's own screenshot puts the toggle directly
 * under the header, and their instruction was explicit: the toggle belongs at
 * the top of the MODULE, and switching to the people tab must show people and
 * nothing else.
 *
 * The constraint was real; the layout it forced was not the only way to satisfy
 * it. What actually has to survive a tab switch is the PLAYER HOST, not the
 * card wrapped around it. So the host has been lifted out of `<NowPlaying>` and
 * given a permanent address of its own — `<VideoStage>` below, the first child
 * of the body, rendered in both stages and at the same tree position in both,
 * so React reconciles it instead of remounting. When the people tab is up, or
 * when the provider is not YouTube, it parks at 1x1 and zero opacity and keeps
 * playing. Parked, NOT `display:'none'` and NOT unmounted: an Android WebView
 * laid out GONE may pause its media, and losing the audio is exactly the
 * failure the old arrangement was avoiding.
 *
 * With the host safe, `<NowPlaying>` is ordinary tab content. It mounts with the
 * now-playing tab and unmounts with it, which is what makes "I do not need to
 * see the nothing on deck when I switch to the listeners" true rather than
 * approximately true.
 *
 * --------------------------------------------------------- the now tab, in order
 *
 * The order below is the screenshot's, top to bottom, and each item is a
 * SIBLING in one scroller so the sequence is readable in one place:
 *
 *   NowPlaying        artwork tile, title, artist, the source chip, the coral
 *                     scrubber and the two clocks
 *   TransportControls back 15 · the blue play circle · skip
 *   PassTheAux        the coral-outlined full-width row with the trailing arrow
 *   SessionSyncRow    the coral dot, "You are LOCKED +26ms", the (?), Hard seek
 *   add a track       the way into the search sheet from the player itself
 *
 * ------------------------------------------- where the buried features went
 *
 *   MIC          a permanent cell in the lobby bar, plus the drawer. THE VOICE
 *                CARD IS GONE FROM THE ROSTER — the user asked for it to go
 *                ("i dont need your voice card here") and the bar is where the
 *                mic belongs. The HANDLERS did not move: `handleMic` and
 *                `handleDeafen` still drive the bar and the drawer.
 *   DEAFEN       the cell beside it. The artboard spends this bar slot on
 *                SCREEN SHARE, which has no transport in this build; deafen
 *                is a real control and takes the slot rather than a stub.
 *   MUTE ONE     the Members TAB — a top-level destination, not a sheet.
 *   PERSON       Tapping any row mutes that person, for you only.
 *   GAME         the drawer, one tap on the handle. `LobbySheetBody` carries
 *   CHANGE       the real catalogue, table and seat queue, and the real three
 *   LOBBY        lobby modes. The handle NAMES them rather than saying
 *                "swipe up for more", because a door nobody opens is the
 *                exact failure being fixed here.
 *   ADD A TRACK  the empty card's CTA, the queue sheet, the drawer — and now a
 *                row on the now-playing tab, because the user asked for it to
 *                be reachable from the player.
 *
 * ----------------------------------------------------- deliberate deviations
 *
 * 1. THE EMPTY SESSION DRAWS NO TRANSPORT AND NO SYNC LINE. A Session that had
 *    finished loading with nothing on the deck used to render a full hero
 *    reading `Session · 0:00 / 0:00` over five dead circles. `NowPlaying` owns
 *    an empty face with the CTA in it, and the rows that only make sense
 *    against a playing track are not drawn at all: disabled controls under
 *    "nothing on the deck" tell the same lie in miniature. The AUX HAND-OFF is
 *    the exception and stays — see the comment on it below; who holds the aux
 *    is not a claim about a track.
 *
 * 2. THE AUX HAND-OFF ROW IS INERT FOR A HOST, and it looks it. There is no
 *    `rooms.host_id` transfer RPC in this build, so "Pass the aux" cannot
 *    actually pass anything. It is drawn dimmed and marked disabled to
 *    assistive tech rather than drawn bright and lying, which is what
 *    `AuxCard`'s `blocked` rule already did — this row inherits that rule
 *    unchanged. A passenger's half of it is live and calls `useRequestAux`.
 *
 * 3. THE BAR'S HANDLE IS A TAP, NOT A DRAG. The artboard binds pointer-move to
 *    the grabber. A pan responder there competes with the scroller directly
 *    above it for the same vertical gesture, and the drawer it opens is
 *    reachable by pressing the same 40px strip. Kept as a press.
 *
 * 4. THE TRANSPORT ROW STILL DRAWS FIVE CELLS where the artboard draws three.
 *    `onShuffle` and `onRepeat` are wired here and 'transport-controls.tsx' is
 *    not this pass's file to edit; dropping the props would leave two inert
 *    ghost circles rather than removing them, which is worse than either.
 *
 * Everything else — the queue, the chat, the drawer and the sync diagnostics —
 * is a floating glass sheet, per L1166.
 */

import { BlurView } from 'expo-blur';
import { router, useLocalSearchParams } from 'expo-router';
import {
  ArrowLeft,
  ArrowRight,
  MessageCircle,
  Plus,
  Radio,
  RotateCw,
  X,
} from 'lucide-react-native';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  BackHandler,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AddTrackSheet } from '@/components/room/add-track-sheet';
import { lobbyModeLabel, type LobbyMode } from '@/components/room/change-lobby';
import {
  DRIFT_LOCKED_MS,
  DRIFT_SEEK_MS,
  driftRung,
  formatClock,
  initialFor,
  readout,
  rungColor,
  type DriftRung,
} from '@/components/room/drift';
import { LobbySheetBody, SessionDock, useSessionDockReserve } from '@/components/room/lobby-sheet';
import { NowPlaying, SessionSyncRow } from '@/components/room/now-playing';
import { ParticipantStrip, SyncOrbit } from '@/components/room/participant-strip';
import { QueueList } from '@/components/room/queue-list';
import { TransportControls } from '@/components/room/transport-controls';
import { AmbientGround } from '@/components/shell/ambient-ground';
import {
  AuxButton,
  CircleIconButton,
  EmptyState,
  GlassCard,
  SheetTabs,
  Skeleton,
  useToast,
  type SheetTab,
} from '@/components/ui';
import { RoomChat } from '@/features/chat';
import {
  useLounge,
  useQueue,
  useRequestAux,
  useRoomParticipants,
  useTransport,
} from '@/features/rooms/queries';
import { useRoomSync } from '@/features/rooms/use-room-sync';
import {
  Fonts,
  PointerEvents,
  Radii,
  Rule,
  Sheet as SheetMetrics,
  Space,
  TOUCH_TARGET,
  Type,
  ZIndex,
  sheetShadow,
  tracking,
} from '@/lib/theme';
import { useColors, useTheme } from '@/lib/theme-context';
import { expectedPositionMs } from '@/playback/sync-controller';
import { usePlayback } from '@/playback/store';
import { YouTubePlayerHost } from '@/playback/youtube-player-host';

/** How long the "Requested" latch holds before a passenger may ask again. */
const REQUEST_COOLDOWN_MS = 60_000;
/** The back cell. */
const SEEK_BACK_MS = 15_000;

/** L915: the Session body runs on a 16px gutter, not the 18px screen gutter. */
const GUTTER = Space.lg;

/** L1145: `border-radius:26px 26px 0 0`. `Radii` has no 26. */
const BAR_RADIUS = 26;
/** L1147-L1157: `min-height:60px` per cell. */
const BAR_CELL = 60;

/** L946-L949: the aux hand-off row is a 50px pill, not a 44px button. */
const PASS_HEIGHT = 50;

/** Which floating sheet is up. */
type SheetName = 'queue' | 'chat' | 'lobby' | 'sync' | null;
/** Which half of the Session the body is showing. */
type Stage = 'now' | 'people';

export default function RoomScreen() {
  // Required-property shape, not optional: expo-router constrains the generic to
  // Record<string, string | string[]>, which an optional field does not satisfy.
  // The runtime guard still stands — a malformed deep link has no id.
  const params = useLocalSearchParams<{ id: string }>();
  const roomId = typeof params.id === 'string' && params.id.length > 0 ? params.id : null;

  const toast = useToast();
  const { room, track, userId, isHost, isLoading, error, resync } = useRoomSync(roomId);

  const lounge = useLounge(room?.lounge_id ?? null);
  const queue = useQueue(roomId);
  const participants = useRoomParticipants(roomId);
  const transport = useTransport(roomId);
  const requestAux = useRequestAux(roomId, room?.lounge_id ?? null);

  const timeline = usePlayback((state) => state.timeline);
  const driftMs = usePlayback((state) => state.driftMs);
  const playbackError = usePlayback((state) => state.error);
  const provider = usePlayback((state) => state.adapter?.provider ?? null);

  const [sheet, setSheet] = useState<SheetName>(null);
  const [stage, setStage] = useState<Stage>('now');
  const [addVisible, setAddVisible] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [deafened, setDeafened] = useState(false);
  /**
   * What the lobby is doing. Held HERE rather than inside the drawer because
   * the header and the bar's handle both report it, and a mode the user
   * switched inside a sheet has to survive that sheet closing. There is no
   * `rooms.mode` column yet — see the header of 'change-lobby.tsx' — so this is
   * local state under exactly the contract mic and deafen already ship under.
   */
  const [mode, setMode] = useState<LobbyMode>('music');
  /**
   * Whether the bottom dock is grown into its lobby panel.
   *
   * Lifted out of the dock so the hardware back button can collapse it — see
   * the note at the render site.
   */
  const [dockOpen, setDockOpen] = useState(false);
  /** Muted for this listener only. Never published, never announced. */
  const [mutedIds, setMutedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [requestSent, setRequestSent] = useState(false);
  const requestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (requestTimer.current) clearTimeout(requestTimer.current);
    },
    []
  );

  /**
   * Android hardware back. A sheet is a layer the user opened, so it is what
   * back should close — falling straight out of the Session would be a
   * surprise, and it would stop the music for them.
   */
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      // The add-track modal owns its own back handling via onRequestClose.
      if (addVisible) return false;
      if (sheet) {
        setSheet(null);
        return true;
      }
      return false;
    });

    return () => subscription.remove();
  }, [addVisible, sheet]);

  const queueLength = queue.data?.length ?? 0;
  // Memoised because `toggleMemberMute` looks a name up in it, and because the
  // drawer's game table takes it as a prop: a fresh `[]` every render would
  // reseed that table's `people` on every drift tick.
  const roster = useMemo(() => participants.data ?? [], [participants.data]);
  const listenerCount = roster.length;
  const onAux = roster.find((person) => person.userId === room?.host_id) ?? null;

  /**
   * `N in sync`. The viewer's own row is the only real measurement, so it is
   * counted from the drift ladder; everyone else is counted from the
   * `is_synced` boolean the backend actually publishes. Two sources, one
   * number, and neither of them invented.
   */
  const lockedCount = roster.filter((person) =>
    person.userId === userId ? driftRung(driftMs) === 'locked' : person.isSynced
  ).length;

  const handlePlayPause = useCallback(() => {
    if (!room) return;

    if (room.is_playing) {
      transport.pause.mutate();
      return;
    }
    // Paused mid-track: resume slides `started_at_ms` forward by the pause
    // duration, so everyone lands back on the same second.
    if (room.track_id && room.paused_at_ms != null) {
      transport.resume.mutate();
      return;
    }
    // Nothing loaded yet — pull the head of the queue.
    transport.advance.mutate();
  }, [room, transport]);

  const handleSkip = useCallback(() => {
    transport.advance.mutate();
  }, [transport]);

  const handleSeek = useCallback(
    (positionMs: number) => {
      transport.seek.mutate(positionMs);
    },
    [transport]
  );

  /** The back cell, computed off the room's own arithmetic rather than the player. */
  const handleSeekBack = useCallback(() => {
    if (!timeline) return;
    transport.seek.mutate(Math.max(0, expectedPositionMs(timeline) - SEEK_BACK_MS));
  }, [timeline, transport]);

  const handleRequestAux = useCallback(() => {
    requestAux.mutate(undefined, {
      onSuccess: () => {
        setRequestSent(true);
        toast.show('Asked for the aux in the Session chat', 'success');
        requestTimer.current = setTimeout(() => setRequestSent(false), REQUEST_COOLDOWN_MS);
      },
      onError: (mutationError) => {
        toast.show(
          mutationError instanceof Error ? mutationError.message : 'Could not send that.',
          'error'
        );
      },
    });
  }, [requestAux, toast]);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, []);

  const openAdd = useCallback(() => {
    setSheet(null);
    setAddVisible(true);
  }, []);
  const closeAdd = useCallback(() => setAddVisible(false), []);
  const closeSheet = useCallback(() => setSheet(null), []);

  const openQueue = useCallback(() => setSheet('queue'), []);
  const openLobby = useCallback(() => setSheet('lobby'), []);
  const openChat = useCallback(() => setSheet('chat'), []);
  const openSync = useCallback(() => setSheet('sync'), []);

  const handleStage = useCallback((key: string) => setStage(key as Stage), []);

  /** Everything in the drawer announces itself; this is the one channel it has. */
  const notice = useCallback((message: string) => toast.show(message, 'info'), [toast]);

  /*
    Mic, deafen and per-person mute are UI state only — there is no voice
    transport in this build. They are here because the controls have to exist
    and behave correctly before the audio layer arrives, and because their
    RELATIONSHIPS are the part worth getting right now: deafening mutes you,
    and un-deafening does not un-mute you.

    THE ROSTER'S VOICE CARD IS GONE and these two are what is left of it. The
    handlers did not move with it — the lobby bar and the drawer have always
    driven the same state, and they are now the only two places that do.
  */
  const handleMic = useCallback(() => {
    setMicOn((on) => {
      if (!on) toast.show('Voice is not live yet', 'info');
      return !on;
    });
  }, [toast]);

  /**
   * Deafen: stop hearing the room, and stop the room hearing you.
   *
   * Deafening forces the mic off — talking to people you cannot hear is not a
   * state anyone wants to be in by accident. Un-deafening deliberately does NOT
   * restore the mic: coming back should be a decision, not a surprise.
   */
  const handleDeafen = useCallback(() => {
    setDeafened((on) => {
      const next = !on;
      if (next) setMicOn(false);
      else toast.show('Voice is not live yet', 'info');
      return next;
    });
  }, [toast]);

  /**
   * Mute one person, for you only.
   *
   * A local decision that never leaves the device — nobody is told they have
   * been muted, because that would make a private preference into a social act.
   */
  const toggleMemberMute = useCallback(
    (personId: string) => {
      setMutedIds((current) => {
        const next = new Set(current);
        if (next.has(personId)) next.delete(personId);
        else next.add(personId);
        return next;
      });
      const person = roster.find((candidate) => candidate.userId === personId);
      const name = person ? person.displayName : 'They';
      toast.show(
        mutedIds.has(personId) ? `${name} is audible again` : `${name} is muted, for you only`,
        'info'
      );
    },
    [mutedIds, roster, toast]
  );

  const handleShuffle = useCallback(() => toast.show('Shuffle is off', 'info'), [toast]);
  const handleRepeat = useCallback(() => toast.show('Repeat is off', 'info'), [toast]);

  /**
   * Created once per render but always at the same position in the tree, so
   * React reconciles rather than remounts it. See the file header — remounting
   * this stops the music.
   *
   * `visible` false does not unmount it: the host parks itself at 1×1 with zero
   * opacity and keeps playing.
   */
  const videoOnStage = provider === 'youtube' && stage === 'now';
  const media = useMemo(() => <YouTubePlayerHost visible={videoOnStage} />, [videoOnStage]);

  const sessionName = room?.name ?? 'Session';
  const loungeName = lounge.data?.name ?? 'Lounge';
  const modeLabel = lobbyModeLabel(mode);

  /**
   * Loaded, and there is genuinely nothing on the deck and nothing behind it.
   * Both loads have to have finished: showing "nothing queued" while the queue
   * is still in flight is a promise the next 200ms may break.
   */
  const nothingQueued =
    !isLoading && !queue.isLoading && Boolean(room) && !room?.track_id && queueLength === 0;

  /**
   * `NowPlaying` is showing its EMPTY face — loaded, and nothing resolved onto
   * the deck. Derived with exactly that component's own rule so the two can
   * never disagree, because everything gated on it is a row that would be
   * lying next to an empty card: the aux readout, the sync line, and a second
   * "Add a track" standing beside the one already inside the card.
   */
  const deckEmpty = !isLoading && !track;

  /**
   * What every scroller in the body has to leave clear of the floating bar.
   *
   * THE NAV CAPSULE IS NOT IN THIS SUM, AND THAT WAS CHECKED RATHER THAN
   * ASSUMED. `room/[id]` is registered on the ROOT stack in 'src/app/_layout.tsx'
   * as a sibling of `(tabs)`, and the capsule is the `tabBar` of the `(tabs)`
   * navigator in 'src/app/(tabs)/_layout.tsx' — no tab layout is mounted above
   * this route, so nothing renders over the Session except its own `LobbyBar`.
   * `useDockReserve()` therefore has no business here and adding it would leave
   * 126px of dead air under the roster. Anything that DID need the capsule's
   * clearance would have to ask that hook rather than a constant.
   */
  /*
    Asked of the dock rather than recomputed here. `BAR_HEIGHT` described the
    old bar, and a reservation derived from a component's real height is the
    only kind that cannot drift away from it.
  */
  const barReserve = useSessionDockReserve();

  const stageTabs = useMemo<SheetTab[]>(
    () => [
      { key: 'now', label: 'Now playing' },
      { key: 'people', label: listenerCount > 0 ? `Members · ${listenerCount}` : 'Members' },
    ],
    [listenerCount]
  );

  if (error && !room) {
    return (
      <Shell>
        <Head
          name={sessionName}
          meta={loungeName}
          locked={0}
          total={0}
          onBack={handleBack}
          onSync={null}
        />
        <View style={styles.errorSlot}>
          <EmptyState
            icon={Radio}
            size="hero"
            title="This Session is not open to you"
            description="It may have ended, or it lives in a lounge you have not joined."
            primary={{ label: 'Try again', onPress: resync }}
            secondary={{ label: 'Back', onPress: handleBack }}
          />
        </View>
      </Shell>
    );
  }

  return (
    <Shell>
      <Head
        name={sessionName}
        meta={`${loungeName} · ${modeLabel}`}
        locked={lockedCount}
        total={listenerCount}
        onBack={handleBack}
        onSync={openSync}
      />

      {/* L910-L913. Directly under the header, at the top of the module. */}
      <View style={styles.switch}>
        <SheetTabs tabs={stageTabs} active={stage} onChange={handleStage} variant="segmented" />
      </View>

      <View style={styles.body}>
        {/*
          THE PLAYER HOST'S PERMANENT ADDRESS. One position in this tree for the
          whole life of the route, in both stages, so switching tabs reconciles
          the WebView instead of remounting it. See the file header.
        */}
        <VideoStage visible={videoOnStage}>{media}</VideoStage>

        {stage === 'now' ? (
          <ScrollView
            style={styles.fill}
            contentContainerStyle={[styles.nowContent, { paddingBottom: barReserve }]}
            showsVerticalScrollIndicator={false}>
            <NowPlaying
              videoOnStage={videoOnStage}
              track={track}
              timeline={timeline}
              isLoading={isLoading}
              onResync={resync}
              onMore={openLobby}
              onSeek={isHost ? handleSeek : undefined}
              onAddTrack={openAdd}
              errorMessage={playbackError?.message ?? null}
            />

            {/*
              Nothing on the deck and nothing behind it: no transport at all.
              Five disabled circles under an empty card tell the same "something
              is playing" lie the card itself used to tell. See deviation 1.
            */}
            {nothingQueued ? null : (
              <TransportControls
                isHost={isHost}
                isPlaying={room?.is_playing === true}
                canPlay={Boolean(room?.track_id) || queueLength > 0}
                canSkip={Boolean(room?.track_id) || queueLength > 0}
                isBusy={transport.isBusy}
                auxName={onAux?.displayName ?? null}
                onPlayPause={handlePlayPause}
                onSkip={handleSkip}
                onSeekBack={isHost ? handleSeekBack : undefined}
                onShuffle={handleShuffle}
                onRepeat={handleRepeat}
              />
            )}

            {/*
              ALWAYS DRAWN, INCLUDING ON THE EMPTY FACE, and that is deliberate
              — it is the one row here that is not a claim about a track. Who
              holds the aux is true of the Session whether or not anything is
              playing, and an empty Session is exactly when a passenger wants to
              take it. Gating this on a track would have hidden the app's
              namesake control at the only moment it is obviously useful.
            */}
            <PassTheAux
              isHost={isHost}
              isLoading={isLoading && !room}
              requestSent={requestSent}
              onRequest={handleRequestAux}
            />

            {/*
              L952-L961. Below the hand-off, not welded under the scrubber: the
              reading is the last word on this tab, not an annotation on the
              bar. `onExplain` is the (?) and it opens the real ladder.

              Withheld on the empty face: "You are LOCKED +0ms" measured against
              nothing is the same lie the 0:00 scrubber used to tell.
            */}
            {deckEmpty ? null : (
              <SessionSyncRow
                waiting={isLoading && !track}
                driftMs={driftMs}
                onResync={resync}
                onExplain={openSync}
              />
            )}

            {/*
              The user asked for add-a-track to be reachable from the now
              playing tab. `bordered`, not `pri`: the blue on this tab belongs
              to the play circle, and a second filled blue control below it
              would argue about which one is the point of the screen. Withheld
              on the empty face, where `NowPlaying`'s own CTA is already the
              loudest thing on the screen and a second one would just be it
              again, quieter.
            */}
            {deckEmpty ? null : (
              <AuxButton
                label={queueLength > 0 ? `Add a track · ${queueLength} queued` : 'Add a track'}
                variant="bordered"
                size="md"
                icon={Plus}
                align="center"
                onPress={openAdd}
                fullWidth
              />
            )}
          </ScrollView>
        ) : (
          /*
            PEOPLE ONLY, and that is the whole point of this branch. The orbit
            and the roster under it, which is exactly what the artboard's
            members tab is (L965-L1005) — no track card, no "nothing on the
            deck", and no voice card: `voice` is deliberately not passed, so
            `SyncOrbit` draws its header without one. Tapping any row mutes
            that person for this listener only.
          */
          <SyncOrbit
            roomId={roomId}
            hostId={room?.host_id ?? null}
            currentUserId={userId}
            track={track}
            timeline={timeline}
            mutedIds={mutedIds}
            onSelectPerson={toggleMemberMute}
            contentBottomInset={barReserve}
          />
        )}
      </View>

      {/*
        `SessionDock`, not the `LobbyBar` that was here.

        The bar this replaces had the handle and the five controls but no way to
        open anything with them: the lobby was reachable only by tapping a
        drawer icon that opened a separate sheet. What was asked for was the
        thing the artboard draws — a handle you can SWIPE UP, which grows the
        bar itself into the lobby panel, with change-lobby and the games inside
        it. `SessionDock` is that, and it was written in `lobby-sheet.tsx` and
        then never imported, so none of it shipped.

        It is also a correction: `LobbyBar` used `floating()`, whose shadow
        falls downward, off the bottom of the screen where nobody could see it.
        A dock is lit by the page it covers, so `SessionDock` uses
        `sheetShadow()` and the lift finally reads.

        `expanded` is held here rather than inside the dock so Android's
        hardware back can collapse it — an expanded dock is a layer the user
        opened, and back must close that layer instead of dropping them out of
        the Session and stopping the music.
      */}
      <SessionDock
        playing={room?.is_playing === true}
        isHost={isHost}
        micOn={micOn && !deafened}
        deafened={deafened}
        queueCount={queueLength}
        onMic={handleMic}
        onDeafen={handleDeafen}
        onQueue={openQueue}
        onChat={openChat}
        onAddTrack={openAdd}
        onLeave={handleBack}
        people={roster}
        currentUserId={userId}
        onNotice={notice}
        mode={mode}
        onModeChange={setMode}
        expanded={dockOpen}
        onExpandedChange={setDockOpen}
      />

      <Sheet
        visible={sheet === 'queue'}
        title="The queue"
        kicker={
          queueLength > 0 ? `${queueLength} UP NEXT · ANYONE CAN ADD` : 'ANYONE IN THE SESSION CAN ADD'
        }
        onClose={closeSheet}>
        <QueueList
          roomId={roomId}
          isHost={isHost}
          currentUserId={userId}
          onAddTrack={openAdd}
          header={
            <NowPlayingStrip
              title={track?.title ?? null}
              positionMs={timeline ? expectedPositionMs(timeline) : 0}
              durationMs={track?.duration_ms ?? 0}
            />
          }
        />
      </Sheet>

      <Sheet
        visible={sheet === 'chat'}
        title="Session chat"
        kicker="SEPARATE FROM THE LOUNGE — ENDS WITH THE SESSION"
        onClose={closeSheet}>
        {room ? (
          <RoomChat roomId={room.id} loungeId={room.lounge_id} bottomInset={0} />
        ) : (
          <View style={styles.errorSlot}>
            <EmptyState
              icon={MessageCircle}
              title="Not in the Session yet"
              description="Chat opens once the Session has loaded."
              primary={{ label: 'Try again', onPress: resync }}
            />
          </View>
        )}
      </Sheet>

      {/*
        The drawer, and it is the whole of L1286-L1356 rather than the flat run
        of rows this file used to draw: change the lobby, lobby games, camera,
        deafen, voice settings, chat, add a track, leave.
      */}
      <Sheet
        visible={sheet === 'lobby'}
        title="Lobby controls"
        kicker={`${modeLabel} · ${listenerCount} LISTENING`}
        onClose={closeSheet}>
        <LobbySheetBody
          visible={sheet === 'lobby'}
          // The drawer's leave button reads `Leave {name}` and it leaves the
          // SESSION, not the lounge — so it is handed the Session's name.
          loungeName={sessionName}
          isHost={isHost}
          micOn={micOn}
          deafened={deafened}
          onMic={handleMic}
          onDeafen={handleDeafen}
          onChat={openChat}
          onAddTrack={openAdd}
          onLeave={handleBack}
          people={roster}
          currentUserId={userId}
          onNotice={notice}
          mode={mode}
          onModeChange={setMode}
        />
      </Sheet>

      {/* L1439-L1462: the ladder that decides what happens, then the readings. */}
      <Sheet
        visible={sheet === 'sync'}
        title="Sync diagnostics"
        kicker="EVERY READING HERE WAS WRITTEN TO SYNC_METRICS"
        onClose={closeSheet}>
        <ParticipantStrip
          roomId={roomId}
          hostId={room?.host_id ?? null}
          currentUserId={userId}
          mutedIds={mutedIds}
          onSelectPerson={toggleMemberMute}
          header={<DriftLadder />}
          footer={<ResyncFooter onResync={resync} />}
          contentBottomInset={Space.xl}
        />
      </Sheet>

      <AddTrackSheet roomId={roomId} visible={addVisible} onClose={closeAdd} />
    </Shell>
  );
}

// -------------------------------------------------------------------- shell

/**
 * Ground and safe area.
 *
 * The three-stop `LinearGradient` this used to paint is GONE. Nocturne resolves
 * `bgTop`, `bg` and `bgBot` to the same value, so the wash was a flat opaque
 * slab — and it sat on top of the ambient blobs, which are the only thing a
 * 5.5%-white card in this direction has to show through it. `AmbientGround` is
 * mounted here rather than inherited because it lives in the `(tabs)` layout
 * and the Session is a root-stack route with no tab layout above it.
 */
function Shell({ children }: { children: ReactNode }) {
  const C = useColors();

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <AmbientGround />
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.fill}>
        {/*
          react-native-web has no phone to constrain it, so an unbounded column
          stretches to the full window width and the line length is unreadable.
        */}
        <View style={styles.constrain}>{children}</View>
      </SafeAreaView>
    </View>
  );
}

// -------------------------------------------------------------- video stage

/**
 * L1010: the design's video surface, 16:9 inside the card's own corner — and
 * the reason this screen can have a tab switch at the top at all.
 *
 * It holds the YouTube player host, which must stay mounted for as long as the
 * Session is open. A listener whose Spotify device dies mid-Session falls back
 * to YouTube by re-pointing the adapter, and a remount at that moment would
 * mean a black WebView booting from scratch instead of audio resuming in the
 * next second. So this component is rendered in BOTH stages at the same tree
 * position, and `visible` only changes its geometry:
 *
 *   visible   a 16:9 module above the tab content
 *   parked    1x1, zero opacity, out of the layout — and STILL LAID OUT, which
 *             is the point. `display:'none'` would be the obvious way to hide
 *             it and it is the one way that must not be used: an Android
 *             WebView laid out GONE may pause its media.
 *
 * The fill stays a literal black rather than a token — this is a letterbox
 * behind a WebView, and a theme-aware "surface" behind video reads as a
 * rendering fault the instant the frame is narrower than the box.
 *
 * NO SHADOW ON PURPOSE, matching the artboard: Android drops a view's own
 * boxShadow when that view also clips, so a `raised()` here would lift on iOS
 * and web and silently do nothing on Android — a divergence for a decoration.
 */
const VideoStage = memo(function VideoStage({
  visible,
  children,
}: {
  visible: boolean;
  children: ReactNode;
}) {
  const C = useColors();

  return (
    <View
      style={[
        visible ? styles.video : styles.videoParked,
        visible ? { borderColor: C.rule } : null,
        visible ? PointerEvents.auto : PointerEvents.none,
      ]}>
      {children}
    </View>
  );
});

// ------------------------------------------------------------------- header

type HeadProps = {
  name: string;
  /** `lounge · MODE`, or just the lounge before the room row lands. */
  meta: string;
  locked: number;
  total: number;
  onBack: () => void;
  /** Null before there is a Session to measure. The slot keeps its width. */
  onSync: (() => void) | null;
};

/**
 * L900-L908. Back, what this is, and how many people are actually together.
 *
 * The second line is a TRACKED UPPERCASE KICKER rather than sentence-case
 * prose. It carries `NIGHT SHIFT · MUSIC` — a lounge name and a mode, which are
 * labels and not a sentence — and at 9px the uppercase setting is what stops it
 * competing with the 16px session name directly above it.
 */
const Head = memo(function Head({ name, meta, locked, total, onBack, onSync }: HeadProps) {
  const C = useColors();

  return (
    <View style={styles.head}>
      <CircleIconButton
        icon={ArrowLeft}
        onPress={onBack}
        accessibilityLabel="Leave the Session"
        size={44}
      />

      <View style={styles.headMeta}>
        <Text numberOfLines={1} style={[styles.headName, { color: C.ink }]}>
          {name}
        </Text>
        <Text numberOfLines={1} style={[styles.headSub, { color: C.ink3 }]}>
          {meta}
        </Text>
      </View>

      {onSync ? (
        <SyncPill locked={locked} total={total} onPress={onSync} />
      ) : (
        <View style={styles.headSpacer} />
      )}
    </View>
  );
});

/**
 * L903: the sync readout — a coral BADGE that is also a button.
 *
 * THE READING STAYS CORAL. How many people are actually together is a state of
 * the world, not something anyone does, so the resting pill is `liveWash`
 * behind a `liveMid` edge with a `liveText` count.
 *
 * IT READS `3/5 locked` NOW, NOT `3 locked`. A bare numerator is not a
 * measurement: three people in sync is excellent in a Session of three and bad
 * in a Session of nine, and the denominator was sitting right underneath it in
 * the listening line the whole time. The second line keeps the head-count and
 * is set uppercase to match the header kicker beside it.
 *
 * THE PRESS GOES TO THE ACTION ACCENT. The whole pill is a Pressable that opens
 * the sync diagnostics, and it used to press by DEEPENING the coral
 * (`liveWash` → `liveMid`): one element painted in the state accent at rest and
 * in a louder state accent while you were operating it. Pressed now goes to
 * `pill` with `pillInk` on it. At rest the pill is coral and only coral; under
 * a finger it is blue and only blue. There is no instant at which it carries
 * both accents, and the transition itself is the affordance the coral-on-coral
 * version never had.
 *
 * Flat `pill` rather than the `glow` blue: `glow` is 28% alpha in the light
 * palette, and white ink on a 28% blue over a near-white ground is unreadable.
 * `pill`/`pillInk` is the one blue surface documented to take white.
 *
 * The children are a render function so the label can follow the press. RN's
 * `Pressable` supports that natively; threading `pressed` down by hand would
 * mean lifting it into state, which React Compiler rejects from a press
 * handler anyway.
 */
const SyncPill = memo(function SyncPill({
  locked,
  total,
  onPress,
}: {
  locked: number;
  total: number;
  onPress: () => void;
}) {
  const C = useColors();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${locked} of ${total} in sync. Open sync diagnostics.`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.syncPill,
        pressed
          ? { backgroundColor: C.pill, borderColor: C.pill }
          : { backgroundColor: C.liveWash, borderColor: C.liveMid },
      ]}>
      {({ pressed }) => (
        <>
          <Text style={[styles.syncCount, { color: pressed ? C.pillInk : C.liveText }]}>
            {locked}/{total} locked
          </Text>
          <Text style={[styles.syncTotal, { color: pressed ? C.onCream2 : C.ink3 }]}>
            {total === 1 ? '1 LISTENING' : `${total} LISTENING`}
          </Text>
        </>
      )}
    </Pressable>
  );
});

// ------------------------------------------------------------ aux hand-off

type PassTheAuxProps = {
  isHost: boolean;
  /** True until the room row has landed — draws the row's own skeleton. */
  isLoading: boolean;
  /** Latches after a request so the button cannot be spammed into the chat. */
  requestSent: boolean;
  onRequest: () => void;
};

/**
 * L946-L949: the aux hand-off, and it is CORAL.
 *
 * This row replaces `AuxCard` on this screen, which drew the same decision as
 * an avatar plus a small blue pill inside a glass card. The user's screenshot
 * draws it the way the artboard always did — one coral-outlined pill the full
 * width of the column with an arrow at the end — and a wide row with a
 * destination arrow reads as "this hands something over" in a way a 90px
 * button beside a face does not. Who is currently on aux has not been dropped:
 * a passenger still reads it in the transport notice directly above, which
 * names them ("X is on aux. Controls are theirs.").
 *
 * IT IS CORAL AND NOT BLUE, WHICH REVERSES THE RULING IN 'transport-controls.tsx'
 * — that file's `AuxCard` comment argues the hand-off buttons are ACTIONS and
 * so must be blue, with the coral spent on the state beside them. Blue is
 * CREATE and TRANSPORT; coral is STATE and LIVE-ENTRY, and taking the aux is
 * the purest live-entry this app has. Same correction that put JOIN and SOLO
 * back in coral on the home feed.
 *
 * A HOST'S ROW IS INERT, AND IT LOOKS IT. There is no `rooms.host_id` transfer
 * RPC in this build, so "Pass the aux" has nothing to call. It is dimmed and
 * marked disabled to assistive tech rather than drawn bright and lying — the
 * same rule `AuxCard` shipped (`blocked = isHost ? !onPassAux : requestSent`),
 * carried over unchanged. The moment a transfer RPC exists this becomes a live
 * control and nothing else about the row has to change.
 */
const PassTheAux = memo(function PassTheAux({
  isHost,
  isLoading,
  requestSent,
  onRequest,
}: PassTheAuxProps) {
  const C = useColors();

  if (isLoading) {
    return <Skeleton width="100%" height={PASS_HEIGHT} radius={Radii.pill} />;
  }

  const label = isHost ? 'Pass the aux' : requestSent ? 'Requested' : 'Take the aux';
  const blocked = isHost || requestSent;
  const hint = isHost
    ? 'Handing the aux to someone else is not available yet'
    : requestSent
      ? 'You have already asked. Ask again in a minute.'
      : 'Asks for the aux in the Session chat';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: blocked }}
      disabled={blocked}
      onPress={onRequest}
      style={({ pressed }) => [
        styles.pass,
        { backgroundColor: pressed ? C.liveMid : C.liveWash, borderColor: C.liveMid },
        blocked ? styles.inert : null,
      ]}>
      <Text numberOfLines={1} style={[styles.passLabel, { color: C.liveText }]}>
        {label}
      </Text>
      <ArrowRight size={17} strokeWidth={2} color={C.liveText} />
    </Pressable>
  );
});

// ---------------------------------------------------------------- lobby bar

/*
  `LobbyBar` and its `BarCell` stood here, and they are gone rather than kept
  beside their replacement.

  `SessionDock` (src/components/room/lobby-sheet.tsx) does everything this did
  and the thing it could not: the handle SWIPES UP and grows the bar into the
  lobby panel, instead of a drawer icon opening a separate sheet. Both were
  built in the same pass and only the old one was wired, which is why none of
  the new behaviour shipped.

  Deleted, not deprecated: this file having two docks one import apart is
  exactly how the wrong one stayed on screen, and a second copy is an
  invitation to fix the one nobody can see.
*/


// ------------------------------------------------------------------- sheets

type SheetProps = {
  visible: boolean;
  title: string;
  /** L1170: the line under a sheet title is an uppercase kicker, not a sentence. */
  kicker?: string;
  onClose: () => void;
  children: ReactNode;
};

/**
 * The floating glass sheet — L1166.
 *
 * It is inset from both sides, lifted clear of the bottom edge, rounded on all
 * four corners, blurred and bordered the whole way around: an object resting on
 * the Session rather than a panel welded to the frame. Identical recipe to
 * 'add-track-sheet.tsx', which is the other sheet this screen opens, and the
 * two must not be allowed to drift apart.
 *
 * `sheetShadow()`, NOT `dropped()`. A sheet is lit by the page it covers, so
 * its shadow falls upward onto that page; `dropped()` would throw it down past
 * the bottom of the screen and the sheet would lose its edge entirely.
 */
function Sheet({ visible, title, kicker, onClose, children }: SheetProps) {
  const C = useColors();
  const { scheme } = useTheme();
  const insets = useSafeAreaInsets();

  /** L1166's `margin-bottom:40px`, floored so a device with no inset still floats. */
  const lift = Math.max(insets.bottom, Space.md) + Space.md;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      statusBarTranslucent
      onRequestClose={onClose}>
      <View style={[styles.scrim, { backgroundColor: C.scrim }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />

        {/* The chat sheet has a composer in it; the other three are unaffected. */}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.sheetSlot}>
          {/* The shadow has to live outside the clip — see `LobbyBar`. */}
          <View style={[styles.sheetShell, { marginBottom: lift }, sheetShadow(C)]}>
            <BlurView
              intensity={scheme === 'dark' ? 40 : 60}
              tint={scheme === 'dark' ? 'dark' : 'light'}
              experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
              style={[styles.sheetGlass, { borderColor: C.chromeBorder }]}>
              {/*
                Also the sheet's safety net: a Modal is its own window, so if a
                platform declines to blur what is behind it, this layer is still
                a near-opaque `nav` fill and the sheet stays a legible panel.
              */}
              <View style={[StyleSheet.absoluteFill, { backgroundColor: C.nav }]} />

              <View style={styles.grabberSlot}>
                <View style={[styles.grabber, { backgroundColor: C.rule3 }]} />
              </View>

              <View style={styles.sheetHead}>
                <View style={styles.sheetHeadMeta}>
                  <Text numberOfLines={1} style={[styles.sheetTitle, { color: C.ink }]}>
                    {title}
                  </Text>
                  {kicker ? (
                    <Text numberOfLines={1} style={[styles.sheetKicker, { color: C.ink3 }]}>
                      {kicker}
                    </Text>
                  ) : null}
                </View>

                <CircleIconButton
                  icon={X}
                  onPress={onClose}
                  accessibilityLabel="Close"
                  size={44}
                  tone="chip"
                />
              </View>

              <View style={styles.sheetBody}>{children}</View>
            </BlurView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// --------------------------------------------------------- sync diagnostics

const LADDER: readonly { rung: DriftRung; head: string; body: string }[] = [
  {
    rung: 'locked',
    head: `0 — ${DRIFT_LOCKED_MS}ms · ignore`,
    body: 'Below hearing. Do nothing.',
  },
  {
    rung: 'nudging',
    head: `${DRIFT_LOCKED_MS} — ${DRIFT_SEEK_MS}ms · nudge`,
    body: 'Playback rate ±2%. The pitch shift is below perception.',
  },
  {
    rung: 'seeking',
    head: `${DRIFT_SEEK_MS}ms+ · hard seek`,
    body: 'Audible, and worth it. Lands exactly.',
  },
];

/**
 * L1443-L1448: what the sync controller will actually DO at each distance.
 *
 * The thresholds are read from './drift' rather than typed in, so the words
 * here cannot drift away from the arithmetic the controller runs. `solid`
 * because this card sits inside a `BlurView`, where a 5.5%-white fill has
 * nothing to sit on and dissolves into the glass.
 *
 * This is also what the (?) on the now-playing tab opens, which is why the
 * sheet has to answer the question that glyph asks rather than only listing
 * numbers.
 */
const DriftLadder = memo(function DriftLadder() {
  const C = useColors();

  return (
    <GlassCard variant="row" solid style={styles.ladder}>
      <Text style={[styles.ladderKicker, { color: C.ink3 }]}>The drift ladder</Text>

      {LADDER.map((step, index) => (
        <View
          key={step.rung}
          style={[
            styles.ladderRow,
            index > 0 ? { borderTopWidth: Rule.hair, borderTopColor: C.ruleSoft } : null,
          ]}>
          <View style={[styles.ladderSpine, { backgroundColor: rungColor(step.rung, C) }]} />
          <View style={styles.ladderMeta}>
            <Text style={[styles.ladderHead, { color: C.ink }]}>{step.head}</Text>
            <Text style={[styles.ladderBody, { color: C.ink2 }]}>{step.body}</Text>
          </View>
        </View>
      ))}
    </GlassCard>
  );
});

/**
 * The one action in a sheet full of readings.
 *
 * BLUE, WHERE THE `Hard seek` PILL ON THE NOW-PLAYING TAB IS CORAL, and the two
 * are not in disagreement even though they call the same `resync`. Out there
 * the control sits inside a live readout and is the way back INTO the position
 * everyone else is at, which is what coral owns. In here it is the recovery
 * button at the bottom of a diagnostics panel, framed by a paragraph explaining
 * what went wrong — the same register as `Retry`, and the register blue owns.
 */
const ResyncFooter = memo(function ResyncFooter({ onResync }: { onResync: () => void }) {
  const C = useColors();

  return (
    <View style={styles.resync}>
      <Text style={[styles.resyncNote, { color: C.ink3 }]}>
        &quot;It feels synced&quot; is a measurement. Re-measuring costs one round trip and lands
        you back on the room&apos;s position exactly.
      </Text>
      <AuxButton
        label="Re-measure and hard seek"
        onPress={onResync}
        variant="pri"
        icon={RotateCw}
        fullWidth
      />
    </View>
  );
});

// -------------------------------------------------------- now-playing strip

type NowPlayingStripProps = {
  title: string | null;
  positionMs: number;
  durationMs: number;
};

/**
 * L1172-L1175: the queue sheet's header — what is playing right now, above what
 * is next.
 *
 * CORAL MEANS PLAYING, so with no track the strip loses the accent entirely
 * rather than sitting there in coral over `0:00 / 0:00`. `solid`, and the
 * border override, because it lives inside the sheet's `BlurView`: the
 * translucent card fill has nothing under it there and the strip would dissolve
 * into the glass.
 */
const NowPlayingStrip = memo(function NowPlayingStrip({
  title,
  positionMs,
  durationMs,
}: NowPlayingStripProps) {
  const C = useColors();

  const playing = title !== null;

  return (
    <GlassCard variant="row" solid style={[styles.strip, playing ? { borderColor: C.liveMid } : null]}>
      <View
        style={[
          styles.stripTile,
          playing
            ? { backgroundColor: C.live, borderColor: C.live }
            : { backgroundColor: C.artwork, borderColor: C.rule },
        ]}>
        <Text style={[styles.stripInitial, { color: playing ? C.onLive : C.artInk }]}>
          {initialFor(title)}
        </Text>
      </View>

      <View style={styles.stripMeta}>
        <Text numberOfLines={1} style={[styles.stripTitle, { color: C.ink }]}>
          {title ?? 'Nothing playing'}
        </Text>
        <Text
          numberOfLines={1}
          style={[styles.stripStatus, { color: playing ? C.liveText : C.ink3 }]}>
          {playing
            ? `PLAYING · ${formatClock(positionMs)} / ${formatClock(durationMs)}`
            : 'ADD A TRACK TO START'}
        </Text>
      </View>
    </GlassCard>
  );
});

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  fill: {
    flex: 1,
  },
  constrain: {
    flex: 1,
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
  },
  dim: {
    opacity: 0.6,
  },
  inert: {
    opacity: 0.45,
  },

  // --------------------------------------------------------------- header
  /** L900: `padding:12px 16px 10px`, `gap:11px`. */
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md - 1,
    paddingTop: Space.md,
    paddingBottom: Space.sm + 2,
    paddingHorizontal: GUTTER,
  },
  headMeta: {
    flex: 1,
    minWidth: 0,
  },
  headName: {
    fontFamily: Fonts.extrabold,
    fontSize: 16,
    letterSpacing: tracking(16, -0.015),
  },
  /** L901's second line, set as the kicker it actually is. */
  headSub: {
    ...Type.label(9),
    letterSpacing: tracking(9, 0.12),
    textTransform: 'uppercase',
    marginTop: 2,
  },
  headSpacer: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
  },
  /** L903: two stacked readouts inside one coral wash pill. */
  syncPill: {
    flexShrink: 0,
    alignItems: 'flex-end',
    justifyContent: 'center',
    minHeight: TOUCH_TARGET,
    paddingHorizontal: Space.md + 2,
    borderRadius: Radii.pill,
    borderWidth: Rule.hair,
  },
  syncCount: {
    ...readout(11),
    letterSpacing: tracking(11, 0.05),
  },
  syncTotal: {
    ...Type.label(9),
    letterSpacing: tracking(9, 0.07),
  },

  // ---------------------------------------------------------------- module
  /**
   * L910: the switch sits `0 16px 12px`. NO TOP PADDING — the header above it
   * already ends on its own 10px, and this control is the top of the module.
   */
  switch: {
    flexShrink: 0,
    paddingHorizontal: GUTTER,
    paddingBottom: Space.md,
  },
  body: {
    flex: 1,
    minHeight: 0,
  },
  /**
   * L1010: 16:9 on the card's own corner, inside the body gutter.
   *
   * No `width`: the body is a flex column, so this stretches to the column
   * minus its own margins on its own. Writing `width:'100%'` here would be 100%
   * of the column and the margins would push it 32px past the right edge.
   */
  video: {
    aspectRatio: 16 / 9,
    marginHorizontal: GUTTER,
    marginBottom: Space.md,
    borderRadius: 24,
    borderWidth: Rule.hair,
    backgroundColor: '#000000',
    overflow: 'hidden',
  },
  /** Mounted and audible, out of the layout, effectively invisible. */
  videoParked: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 1,
    height: 1,
    opacity: 0,
  },
  nowContent: {
    flexGrow: 1,
    paddingHorizontal: GUTTER,
    gap: Space.md + 2,
  },
  errorSlot: {
    paddingHorizontal: GUTTER,
    paddingTop: Space.xxl,
  },

  // ----------------------------------------------------------- aux hand-off
  /** L947: `min-height:50px;padding:0 16px;border-radius:999px`. */
  pass: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.sm + 2,
    minHeight: PASS_HEIGHT,
    paddingHorizontal: GUTTER,
    borderRadius: Radii.pill,
    borderWidth: Rule.hair,
  },
  /** L947: `font:800 12px;letter-spacing:.03em`, and NOT uppercased. */
  passLabel: {
    flexShrink: 1,
    fontFamily: Fonts.extrabold,
    fontSize: 12,
    letterSpacing: tracking(12, 0.03),
  },

  // ------------------------------------------------------------ lobby bar
  barLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: ZIndex.dock,
  },
  barShell: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    borderTopLeftRadius: BAR_RADIUS,
    borderTopRightRadius: BAR_RADIUS,
  },
  barGlass: {
    overflow: 'hidden',
    borderTopLeftRadius: BAR_RADIUS,
    borderTopRightRadius: BAR_RADIUS,
    borderTopWidth: Rule.hair,
  },
  /** L1146: `padding:11px 0 7px`, `gap:5px`. */
  barHandle: {
    alignItems: 'center',
    gap: Space.xs + 1,
    paddingTop: Space.md,
    paddingBottom: Space.sm,
  },
  barGrabber: {
    width: 44,
    height: 5,
    borderRadius: Radii.pill,
  },
  barHandleLabel: {
    ...Type.label(9),
    letterSpacing: tracking(9, 0.12),
  },
  /** L1147: `gap:4px;padding:0 8px 8px`. */
  barCells: {
    flexDirection: 'row',
    gap: Space.xs,
    paddingHorizontal: Space.sm,
  },
  barCell: {
    flex: 1,
    minHeight: BAR_CELL,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.xs + 1,
    borderRadius: Radii.button,
  },
  barCellLabel: {
    ...Type.label(9),
    letterSpacing: tracking(9, 0.04),
  },

  // ---------------------------------------------------------------- sheets
  scrim: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheetSlot: {
    /*
      82% rather than full height: the strip of scrim above it is the
      affordance that says "this is a sheet you can dismiss". L1166's
      `margin:0 10px` lives on this PARENT rather than on the sheet, because
      the sheet is `width:'100%'` and a margin would put it 20px wider than the
      screen.
    */
    maxHeight: '82%',
    paddingHorizontal: Space.sm + 2,
  },
  sheetShell: {
    flex: 1,
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    borderRadius: SheetMetrics.radius,
  },
  sheetGlass: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
    borderRadius: SheetMetrics.radius,
    borderWidth: Rule.hair,
  },
  grabberSlot: {
    paddingTop: Space.md - 2,
    paddingBottom: Space.sm,
    alignItems: 'center',
  },
  grabber: {
    width: SheetMetrics.grabberW,
    height: SheetMetrics.grabberH,
    borderRadius: SheetMetrics.grabberH / 2,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingHorizontal: Space.xl,
    paddingTop: Space.xs,
    paddingBottom: Space.md,
  },
  sheetHeadMeta: {
    flex: 1,
    minWidth: 0,
  },
  sheetTitle: {
    ...Type.display(18),
    letterSpacing: tracking(18, -0.015),
  },
  sheetKicker: {
    ...Type.label(10),
    letterSpacing: tracking(10, 0.08),
    marginTop: 3,
  },
  sheetBody: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: GUTTER,
  },

  // ---------------------------------------------------------- drift ladder
  ladder: {
    gap: Space.xs,
  },
  ladderKicker: {
    ...Type.label(9),
    letterSpacing: tracking(9, 0.12),
    paddingBottom: Space.xs,
  },
  ladderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingVertical: Space.md - 1,
  },
  ladderSpine: {
    width: 5,
    height: 30,
    flexShrink: 0,
    borderRadius: Radii.pill,
  },
  ladderMeta: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  ladderHead: {
    ...Type.heading(12),
    letterSpacing: tracking(12, 0.03),
  },
  ladderBody: {
    ...Type.body(12),
  },
  resync: {
    gap: Space.md,
    paddingTop: Space.lg,
  },
  resyncNote: {
    ...Type.body(11.5),
  },

  // ----------------------------------------------------- now-playing strip
  /**
   * No outer margin: this is the queue list's header, and that list already
   * carries the gutter and the 9px gap between its cards.
   */
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
  },
  stripTile: {
    width: 42,
    height: 42,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.md,
    borderWidth: Rule.hair,
  },
  stripInitial: {
    ...readout(17),
  },
  stripMeta: {
    flex: 1,
    minWidth: 0,
  },
  stripTitle: {
    fontFamily: Fonts.semibold,
    fontSize: 14,
    letterSpacing: tracking(14, -0.01),
  },
  stripStatus: {
    ...readout(10),
    letterSpacing: tracking(10, 0.06),
    marginTop: 2,
  },
});
