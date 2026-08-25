/**
 * The Session. This is the party, and it is the screen the whole direction
 * exists for.
 *
 * Built from design/nocturne/aux-nocturne.dc.html, screen `isSession`:
 * the header at L900-L908, the stage switch at L910-L913, the scrolling body
 * at L915, the orbit at L965-L1005, and the GLASS lobby bar welded to the
 * bottom edge at L1145-L1158. The sheets are L1163-L1180 (queue), L1245-L1284
 * (chat), L1286 (the drawer) and L1439-L1462 (sync diagnostics).
 *
 * STRUCTURAL RULE THAT MUST NOT BE BROKEN: `<YouTubePlayerHost />` is mounted
 * exactly once, here, and stays mounted for as long as the Session is open —
 * even when the active provider is Spotify. A listener whose Spotify device
 * dies mid-Session falls back to YouTube by re-pointing the adapter, and a
 * remount at that moment would mean a black WebView booting from scratch
 * instead of audio resuming in the next second. It lives inside `<NowPlaying>`,
 * which is why `<NowPlaying>` is a FIXED band of this layout and is the one
 * thing the stage switch below does NOT swap out — see deviation 1.
 *
 * That is also why loading and empty are drawn INSIDE the bands rather than as
 * a separate screen swapped in ahead of them: a skeleton that replaces the
 * whole column would unmount the player on its way out. The one exception is
 * the "you cannot open this Session" error, which can only happen before the
 * room row has ever landed — nothing is playing, so there is nothing to lose.
 *
 * ------------------------------------------------------------------ layout
 *
 *   header      back · session name / lounge · MODE · the N LOCKED pill
 *   stage       NowPlaying — artwork, title, scrubber, sync readout
 *   switch      Now playing | Listeners · N
 *   body        now      the transport, then who is on aux
 *               people   the sync orbit, the roster, your own mic and deafen
 *   lobby bar   the drawer handle · MIC · DEAFEN · QUEUE · CHAT · LEAVE
 *
 * ------------------------------------------- where the buried features went
 *
 * The five things the user named as missing or unreachable, and where each one
 * now is. None of them is more than one tap from a Session at rest:
 *
 *   MIC          a permanent cell in the lobby bar, plus the roster's own
 *                voice card, plus the drawer. It is the control people reach
 *                for most and it used to be two taps and a guess deep.
 *   DEAFEN       the cell beside it. The artboard spends this bar slot on
 *                SCREEN SHARE, which has no transport in this build; deafen
 *                is a real control and takes the slot rather than a stub.
 *   MUTE ONE     the Listeners TAB — a top-level destination now, not a
 *   PERSON       sheet. Tapping any row mutes that person, for you only.
 *   GAME         the drawer, one tap on the handle. `LobbySheetBody` carries
 *   CHANGE       the real catalogue, table and seat queue, and the real three
 *   LOBBY        lobby modes. The handle NAMES them rather than saying
 *                "swipe up for more", because a door nobody opens is the
 *                exact failure being fixed here.
 *
 * ----------------------------------------------------- deliberate deviations
 *
 * 1. THE STAGE SITS ABOVE THE SWITCH, not inside it. The artboard's segmented
 *    control swaps the hero card out for the orbit; doing that here would
 *    unmount the YouTube host every time somebody looked at the roster, which
 *    stops the music. `NowPlaying` is therefore a fixed band and the switch
 *    changes only the region beneath it. Hiding it with `display:'none'` was
 *    the other option and was rejected: an Android WebView laid out GONE may
 *    pause its media, and losing audio is not worth a tab animation.
 *
 * 2. THE EMPTY SESSION DRAWS NO TRANSPORT. A Session that had finished loading
 *    with nothing on the deck and nothing behind it used to render a full hero
 *    reading `Session · 0:00 / 0:00` over five dead circles — a screen that
 *    looked like it was playing silence. `NowPlaying` now owns an empty face
 *    with the CTA in it (which is what `onAddTrack` is for, and why the old
 *    `QueuePrompt` card in this file is gone), and the transport row is not
 *    drawn at all: five disabled controls under "nothing on the deck" is the
 *    same lie in miniature.
 *
 * 3. THE BAR'S HANDLE IS A TAP, NOT A DRAG. The artboard binds pointer-move to
 *    the grabber. A pan responder there competes with the scroller directly
 *    above it for the same vertical gesture, and the drawer it opens is
 *    reachable by pressing the same 40px strip. Kept as a press.
 *
 * Everything else — the queue, the chat, the drawer and the sync diagnostics —
 * is a floating glass sheet, per L1166.
 */

import { BlurView } from 'expo-blur';
import { router, useLocalSearchParams } from 'expo-router';
import {
  ArrowLeft,
  HeadphoneOff,
  Headphones,
  ListMusic,
  LogOut,
  MessageCircle,
  Mic,
  MicOff,
  Radio,
  RotateCw,
  X,
  type LucideIcon,
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
import { LobbySheetBody } from '@/components/room/lobby-sheet';
import { NowPlaying } from '@/components/room/now-playing';
import { ParticipantStrip, SyncOrbit } from '@/components/room/participant-strip';
import { QueueList } from '@/components/room/queue-list';
import { AuxCard, TransportControls } from '@/components/room/transport-controls';
import { AmbientGround } from '@/components/shell/ambient-ground';
import {
  AuxButton,
  CircleIconButton,
  EmptyState,
  GlassCard,
  SheetTabs,
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
  floating,
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

/**
 * The lobby bar's own height, and it is a CONSTANT rather than a measurement.
 *
 * The bar is absolutely positioned — it has to be, or the glass would have
 * nothing scrolling behind it to blur and would read as a welded-on footer —
 * so nothing reserves room for it and the last row of either stage would sit
 * underneath it. Measuring with `onLayout` would mean one frame of wrong
 * padding on every mount, so the arithmetic is written down instead:
 *
 *   handle row   12 top + 5 grabber + 5 gap + 12 label + 8 bottom = 42
 *   cell row     60 cell + 8 bottom                               = 68
 *
 * Change either style below and change this with it.
 */
const BAR_HEIGHT = 110;
/** L1145: `border-radius:26px 26px 0 0`. `Radii` has no 26. */
const BAR_RADIUS = 26;
/** L1147-L1157: `min-height:60px` per cell. */
const BAR_CELL = 60;

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

  const insets = useSafeAreaInsets();
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
  const stageVisible = provider === 'youtube';
  const media = useMemo(() => <YouTubePlayerHost visible={stageVisible} />, [stageVisible]);

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
  const barReserve = BAR_HEIGHT + insets.bottom + Space.xxl;

  const stageTabs = useMemo<SheetTab[]>(
    () => [
      { key: 'now', label: 'Now playing' },
      { key: 'people', label: listenerCount > 0 ? `Listeners · ${listenerCount}` : 'Listeners' },
    ],
    [listenerCount]
  );

  /**
   * The roster's own copy of mic and deafen, drawn above the people it applies
   * to. Memoised because `VoiceControls` sits inside a FlatList header — a
   * fresh object each render would re-render the whole list on every drift tick.
   */
  const voice = useMemo(
    () => ({
      micOn,
      deafened,
      onToggleMic: handleMic,
      onToggleDeafen: handleDeafen,
      onOpenMore: openLobby,
      moreLabel: 'Lobby controls',
      moreHint: 'Change the lobby, lobby games, camera, voice settings',
    }),
    [micOn, deafened, handleMic, handleDeafen, openLobby]
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

      {/*
        FIXED BAND, and deliberately outside the stage switch — it holds the
        YouTube host. See deviation 1 in the file header.
      */}
      <View style={styles.stage}>
        <NowPlaying
          media={media}
          showMedia={stageVisible}
          track={track}
          timeline={timeline}
          isLoading={isLoading}
          driftMs={driftMs}
          onResync={resync}
          onMore={openLobby}
          onSeek={isHost ? handleSeek : undefined}
          onAddTrack={openAdd}
          errorMessage={playbackError?.message ?? null}
        />
      </View>

      <View style={styles.switch}>
        <SheetTabs tabs={stageTabs} active={stage} onChange={handleStage} variant="segmented" />
      </View>

      <View style={styles.body}>
        {stage === 'now' ? (
          <ScrollView
            style={styles.fill}
            contentContainerStyle={[styles.nowContent, { paddingBottom: barReserve }]}
            showsVerticalScrollIndicator={false}>
            {/*
              Nothing on the deck and nothing behind it: no transport at all.
              Five disabled circles under an empty hero tell the same "something
              is playing" lie the hero itself used to tell — the hero's own CTA
              is the one move left. See deviation 2.
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

            <AuxCard
              name={onAux?.displayName ?? null}
              avatarUrl={onAux?.avatarUrl ?? null}
              isHost={isHost}
              isLoading={isLoading && !room}
              requestSent={requestSent}
              onRequestAux={handleRequestAux}
            />
          </ScrollView>
        ) : (
          /*
            The orbit AND the roster under it, which is exactly what the
            artboard's members tab is (L965-L1005). Tapping any row mutes that
            person for this listener only — the per-person mute the user could
            not find, now one tap from a Session at rest.
          */
          <SyncOrbit
            roomId={roomId}
            hostId={room?.host_id ?? null}
            currentUserId={userId}
            track={track}
            timeline={timeline}
            mutedIds={mutedIds}
            onSelectPerson={toggleMemberMute}
            voice={voice}
            contentBottomInset={barReserve}
          />
        )}
      </View>

      <LobbyBar
        modeLabel={modeLabel}
        playing={room?.is_playing === true}
        micLive={micOn && !deafened}
        deafened={deafened}
        queueCount={queueLength}
        bottomInset={insets.bottom}
        onDrawer={openLobby}
        onMic={handleMic}
        onDeafen={handleDeafen}
        onQueue={openQueue}
        onChat={openChat}
        onLeave={handleBack}
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

/** L900-L908. Back, what this is, and how many people are actually together. */
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
 * L903: the sync readout — a coral BADGE that is also a button, and it used to
 * refuse to answer which of those it was.
 *
 * THE READING STAYS CORAL. How many people are actually together is a state of
 * the world, not something anyone does, so the resting pill is `liveWash`
 * behind a `liveMid` edge with a `liveText` count. That half was always right.
 *
 * THE PRESS MOVED TO THE ACTION ACCENT. The whole pill is a Pressable that
 * opens the sync diagnostics, and it used to press by DEEPENING the coral
 * (`liveWash` → `liveMid`): one element painted in the state accent at rest and
 * in a louder state accent while you were operating it, with nothing anywhere
 * on it saying "this is a thing you can do". Pressed now goes to `pill` with
 * `pillInk` on it. At rest the pill is coral and only coral; under a finger it
 * is blue and only blue. There is no instant at which it carries both accents,
 * which is the rule — and the transition itself is the affordance the coral-on-
 * coral version never had.
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
            {locked} locked
          </Text>
          <Text style={[styles.syncTotal, { color: pressed ? C.onCream2 : C.ink3 }]}>
            {total === 1 ? '1 listening' : `${total} listening`}
          </Text>
        </>
      )}
    </Pressable>
  );
});

// ---------------------------------------------------------------- lobby bar

type LobbyBarProps = {
  modeLabel: string;
  /** Something is actually playing — the one thing that turns the edge coral. */
  playing: boolean;
  micLive: boolean;
  deafened: boolean;
  queueCount: number;
  bottomInset: number;
  onDrawer: () => void;
  onMic: () => void;
  onDeafen: () => void;
  onQueue: () => void;
  onChat: () => void;
  onLeave: () => void;
};

/**
 * L1145-L1158. The Session's permanent controls, and the reason nothing on this
 * screen is buried any more.
 *
 * IT IS GLASS, which means `C.nav` and not `C.dock`. The two chrome fills do
 * different jobs and are not interchangeable: `dock` is near-opaque because the
 * mini player sits directly ON album art with no blur under it, while this bar
 * has a real `BlurView` beneath it and wants the translucent value — handing it
 * `dock` would blur the wall and then paint over the result.
 *
 * The edge goes CORAL while something is playing, per the artboard's own dock
 * (L891, `border:1px solid var(--aux-live-m)`), and back to `chromeBorder` when
 * it is not. Coral is a state, and "there is music happening in here" is the
 * closest thing this bar has to one.
 *
 * THE SHADOW LIVES ON AN OUTER VIEW. The glass clips its children to the top
 * corners, and Android throws a view's own `boxShadow` away along with whatever
 * `overflow:'hidden'` clips — the bar would silently lose its lift on one
 * platform only. Same fix as 'add-track-sheet.tsx'.
 *
 * The edge is on the TOP only, deliberately against `floating()`'s usual advice
 * to border a floating object all the way round: this one is welded to the
 * bottom of the frame, so a bottom edge would be drawn under the home indicator
 * and the side edges would end in mid-air.
 */
const LobbyBar = memo(function LobbyBar({
  modeLabel,
  playing,
  micLive,
  deafened,
  queueCount,
  bottomInset,
  onDrawer,
  onMic,
  onDeafen,
  onQueue,
  onChat,
  onLeave,
}: LobbyBarProps) {
  const C = useColors();
  const { scheme } = useTheme();

  return (
    <View
      // Load-bearing: this layer spans the full width and sits over the body,
      // so without `box-none` the transparent margin either side of a
      // maxWidth-clamped bar would swallow taps along the bottom of the
      // scroller. A full-bleed overlay has already eaten every tap in this app
      // once.
      style={[styles.barLayer, PointerEvents.boxNone]}>
      <View style={[styles.barShell, floating(C)]}>
        <BlurView
          intensity={scheme === 'dark' ? 40 : 60}
          tint={scheme === 'dark' ? 'dark' : 'light'}
          // Android does not blur at all without this; the tint alone would
          // leave a flat translucent slab with nothing happening behind it.
          experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
          style={[styles.barGlass, { borderTopColor: playing ? C.liveMid : C.chromeBorder }]}>
          {/*
            The tint rides ON TOP of the blur rather than being handed to
            BlurView as a background: underneath, it becomes the thing being
            blurred and the whole bar reads as fog.
          */}
          <View style={[StyleSheet.absoluteFill, { backgroundColor: C.nav }]} />

          {/*
            The drawer handle, and it NAMES what is behind it. The artboard says
            "SWIPE UP FOR MORE"; a door labelled "more" is exactly how the game
            and change-lobby went missing, so this one lists them instead.
          */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open the lobby controls"
            accessibilityHint="Change the lobby, lobby games, camera, voice settings"
            onPress={onDrawer}
            style={({ pressed }) => [styles.barHandle, pressed ? styles.dim : null]}>
            <View style={[styles.barGrabber, { backgroundColor: C.rule3 }]} />
            <Text numberOfLines={1} style={[styles.barHandleLabel, { color: C.ink3 }]}>
              {modeLabel} · GAMES · CHANGE LOBBY
            </Text>
          </Pressable>

          <View style={[styles.barCells, { paddingBottom: bottomInset }]}>
            <BarCell
              icon={micLive ? Mic : MicOff}
              label={micLive ? 'MIC ON' : deafened ? 'DEAFENED' : 'MIC OFF'}
              // Coral: an open mic is audio flowing, which is a state.
              tone={micLive ? 'live' : 'quiet'}
              hint={micLive ? 'Mute your microphone' : 'Unmute your microphone'}
              onPress={onMic}
            />
            <BarCell
              icon={deafened ? HeadphoneOff : Headphones}
              label={deafened ? 'UNDEAFEN' : 'DEAFEN'}
              // `danger`, never coral: deafened is the room cut off, the exact
              // opposite of the thing coral means — and coral here would read
              // identically to the open mic standing next to it.
              tone={deafened ? 'danger' : 'quiet'}
              hint={deafened ? 'Start hearing the Session again' : 'Stop hearing the Session'}
              onPress={onDeafen}
            />
            <BarCell
              icon={ListMusic}
              label={queueCount > 0 ? `QUEUE ${queueCount}` : 'QUEUE'}
              hint="Open the queue"
              onPress={onQueue}
            />
            <BarCell
              icon={MessageCircle}
              label="CHAT"
              hint="Open the Session chat"
              onPress={onChat}
            />
            <BarCell
              icon={LogOut}
              label="LEAVE"
              tone="danger"
              hint="Leave the Session"
              onPress={onLeave}
            />
          </View>
        </BlurView>
      </View>
    </View>
  );
});

/** `quiet` is every cell that is only a door; the other two report a state. */
type CellTone = 'quiet' | 'live' | 'danger';

const BarCell = memo(function BarCell({
  icon: Icon,
  label,
  tone = 'quiet',
  hint,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  tone?: CellTone;
  /** The spoken name. The 9px label is a caption, not a sentence. */
  hint: string;
  onPress: () => void;
}) {
  const C = useColors();
  const color = tone === 'live' ? C.liveText : tone === 'danger' ? C.danger : C.ink2;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={hint}
      onPress={onPress}
      style={({ pressed }) => [styles.barCell, pressed ? { backgroundColor: C.surface2 } : null]}>
      <Icon size={20} strokeWidth={2} color={color} />
      <Text numberOfLines={1} style={[styles.barCellLabel, { color }]}>
        {label}
      </Text>
    </Pressable>
  );
});

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
 * The one action in a sheet full of readings, so it is BLUE.
 *
 * `NowPlaying`'s sync row carries the same re-measure; this is the copy for the
 * person who came here to find out why their number is bad, which is why it is
 * the last thing under the readings rather than the first thing above them.
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
  headSub: {
    ...Type.body(10),
    letterSpacing: tracking(10, 0.07),
    marginTop: 1,
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
    ...Type.body(9),
    letterSpacing: tracking(9, 0.07),
  },

  // ---------------------------------------------------------------- stage
  stage: {
    flexShrink: 0,
    paddingHorizontal: GUTTER,
  },
  /** L910: the switch sits `0 16px 12px` under whatever is above it. */
  switch: {
    flexShrink: 0,
    paddingHorizontal: GUTTER,
    paddingTop: Space.md,
    paddingBottom: Space.md,
  },
  body: {
    flex: 1,
    minHeight: 0,
  },
  nowContent: {
    flexGrow: 1,
    paddingHorizontal: GUTTER,
    gap: Space.md,
  },
  errorSlot: {
    paddingHorizontal: GUTTER,
    paddingTop: Space.xxl,
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
