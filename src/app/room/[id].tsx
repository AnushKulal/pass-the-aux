/**
 * The Session. This is the party, and it is the screen the whole direction
 * exists for.
 *
 * Structural rule that must not be broken: `<YouTubePlayerHost />` is mounted
 * exactly once, here, and stays mounted for as long as the Session is open —
 * even when the active provider is Spotify. A listener whose Spotify device
 * dies mid-Session falls back to YouTube by re-pointing the adapter, and a
 * remount at that moment would mean a black WebView booting from scratch
 * instead of audio resuming in the next second.
 *
 * The layout is four fixed bands and one scroller:
 *
 *   44px  top bar        back · name + lounge · a tappable N/M LOCKED readout
 *   44px  view toggle    NOW PLAYING / SYNC ORBIT
 *   flex  the scroller   owned by ParticipantStrip or SyncOrbit — ONE list on
 *                        this screen, with the player as its header, so the
 *                        roster stays virtualised and nothing nests
 *   44px  grabber        <MODE> · SWIPE UP FOR MORE
 *   58px  dock           MIC · QUEUE/N · CHAT · SHARE · LEAVE
 *
 * Separation between those bands is a 2px rule and a ground step. There is no
 * bloom, no blur, no shadow and no rounded corner anywhere in here.
 *
 * SCOPE OF THIS PASS: music mode only. The mode switcher is real and the other
 * three modes render a labelled "not built yet" state rather than a broken
 * screen — movie needs a media source on the room timeline, screen share needs
 * peer-to-peer signalling, and games need three tables that do not exist. All
 * four are listed under Schema gaps in the handoff.
 */

import { router, useLocalSearchParams } from 'expo-router';
import {
  ArrowLeft,
  Film,
  Gamepad2,
  List,
  LogOut,
  MessageCircle,
  Mic,
  MicOff,
  MonitorUp,
  Music,
  Radio,
  type LucideIcon,
} from 'lucide-react-native';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  BackHandler,
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
import { ModularGrid, NowPlaying } from '@/components/room/now-playing';
import { HeatBackdrop } from '@/components/shell/heat-backdrop';
import { ParticipantStrip, SyncOrbit } from '@/components/room/participant-strip';
import { QueueList } from '@/components/room/queue-list';
import { TransportControls } from '@/components/room/transport-controls';
import { driftRung, formatClock, initialFor, readout } from '@/components/room/drift';
import { EmptyState, useToast } from '@/components/ui';
import { RoomChat } from '@/features/chat';
import {
  useLounge,
  useQueue,
  useRequestAux,
  useRoomParticipants,
  useTransport,
} from '@/features/rooms/queries';
import { useRoomSync } from '@/features/rooms/use-room-sync';
import { PointerEvents, Rule, Space, TOUCH_TARGET, Type, tracking } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';
import { expectedPositionMs } from '@/playback/sync-controller';
import { usePlayback } from '@/playback/store';
import { YouTubePlayerHost } from '@/playback/youtube-player-host';

/** How long the "Requested" latch holds before a passenger may ask again. */
const REQUEST_COOLDOWN_MS = 60_000;
/** The −15 cell. */
const SEEK_BACK_MS = 15_000;

const GUTTER = Space.md;
const DOCK_HEIGHT = 58;

type SessionMode = 'music' | 'movie' | 'screen' | 'game';
type SessionView = 'now' | 'orbit';
type SheetName = 'queue' | 'chat' | 'drawer' | null;

const MODE_LABEL: Record<SessionMode, string> = {
  music: 'Music',
  movie: 'Movie night',
  screen: 'Screen share',
  game: 'Game table',
};

export default function RoomScreen() {
  const C = useColors();

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

  const [mode, setMode] = useState<SessionMode>('music');
  const [view, setView] = useState<SessionView>('now');
  const [sheet, setSheet] = useState<SheetName>(null);
  const [addVisible, setAddVisible] = useState(false);
  const [micOn, setMicOn] = useState(false);
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
  const roster = participants.data ?? [];
  const listenerCount = roster.length;
  const hostName = roster.find((person) => person.userId === room?.host_id)?.displayName ?? null;

  /**
   * `N/M LOCKED`. The viewer's own row is the only real measurement, so it is
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

  /** The −15 cell, computed off the room's own arithmetic rather than the player. */
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

  const showNow = useCallback(() => setView('now'), []);
  const showOrbit = useCallback(() => setView('orbit'), []);

  const handleMic = useCallback(() => {
    setMicOn((on) => {
      if (!on) toast.show('Voice is not live yet — nothing is being transmitted.', 'info');
      return !on;
    });
  }, [toast]);

  const handleShare = useCallback(() => {
    toast.show('Screen share needs peer-to-peer signalling, which is not built yet.', 'info');
  }, [toast]);

  const handleMode = useCallback((next: SessionMode) => {
    setMode(next);
    setSheet(null);
    setView('now');
  }, []);

  const handleBackToMusic = useCallback(() => handleMode('music'), [handleMode]);

  /**
   * Created once per render but always at the same position in the tree, in
   * every view and every mode, so React reconciles rather than remounts it. See
   * the file header — remounting this stops the music.
   *
   * `visible` false does not unmount it: the host parks itself at 1×1 with zero
   * opacity and keeps playing. That is what makes it safe to leave the artwork
   * surface for the sync orbit, or for a mode that has no artwork at all.
   */
  const stageVisible = provider === 'youtube' && mode === 'music' && view === 'now';
  const media = useMemo(
    () => <YouTubePlayerHost visible={stageVisible} />,
    [stageVisible]
  );

  if (error && !room) {
    return (
      <Shell>
        <TopBar
          name="Session"
          lounge={lounge.data?.name ?? null}
          lockedCount={0}
          listenerCount={0}
          onBack={handleBack}
          onOpenDiagnostics={showOrbit}
          showReadout={false}
        />
        <View style={styles.gutter}>
          <EmptyState
            icon={Radio}
            title="This Session is not open to you"
            description="It may have ended, or it lives in a lounge you have not joined."
          />
        </View>
      </Shell>
    );
  }

  const player = (
    <>
      <NowPlaying
        media={media}
        showMedia={stageVisible}
        compact={false}
        track={track}
        timeline={timeline}
        isLoading={isLoading}
        driftMs={driftMs}
        onResync={resync}
        onSeek={isHost ? handleSeek : undefined}
        errorMessage={playbackError?.message ?? null}
        onAuxName={hostName}
        providerLabel={provider === 'spotify' ? 'Spotify' : provider === 'youtube' ? 'YouTube' : null}
        rttMs={null}
      />

      <TransportControls
        isHost={isHost}
        isPlaying={room?.is_playing === true}
        canPlay={Boolean(room?.track_id) || queueLength > 0}
        canSkip={Boolean(room?.track_id) || queueLength > 0}
        isBusy={transport.isBusy}
        onPlayPause={handlePlayPause}
        onSkip={handleSkip}
        onRequestAux={handleRequestAux}
        requestSent={requestSent}
        hostName={hostName}
        onSeekBack={isHost ? handleSeekBack : undefined}
      />
    </>
  );

  return (
    <Shell>
      <TopBar
        name={room?.name ?? 'Session'}
        lounge={lounge.data?.name ?? null}
        lockedCount={lockedCount}
        listenerCount={listenerCount}
        onBack={handleBack}
        onOpenDiagnostics={showOrbit}
        showReadout
      />

      {mode === 'music' ? (
        <View style={[styles.toggle, { borderBottomColor: C.rule }]}>
          <ToggleCell label="Now playing" active={view === 'now'} onPress={showNow} first />
          <ToggleCell label="Sync orbit" active={view === 'orbit'} onPress={showOrbit} />
        </View>
      ) : null}

      <View style={styles.body}>
        {/*
          BOTH views stay mounted. The player — and with it the YouTube WebView
          that is actually making the sound — lives in the drift chart's list
          header, so unmounting this layer to show the orbit would stop the
          music mid-song for this listener. The inactive layer goes offstage at
          1×1 with zero opacity instead, which is the same trick the player host
          uses on itself, and the orbit's ticker is starved by handing it a null
          timeline so a hidden view costs nothing per frame.
        */}
        <Layer active={mode === 'music' && view === 'now'}>
          <ParticipantStrip
            roomId={roomId}
            hostId={room?.host_id ?? null}
            currentUserId={userId}
            header={player}
            contentBottomInset={Space.md}
          />
        </Layer>

        <Layer active={mode === 'music' && view === 'orbit'}>
          <SyncOrbit
            roomId={roomId}
            hostId={room?.host_id ?? null}
            currentUserId={userId}
            track={track}
            timeline={mode === 'music' && view === 'orbit' ? timeline : null}
            contentBottomInset={Space.md}
          />
        </Layer>

        {mode === 'music' ? null : (
          <ScrollView showsVerticalScrollIndicator={false}>
            <NotBuiltYet mode={mode} onBackToMusic={handleBackToMusic} />
          </ScrollView>
        )}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${MODE_LABEL[mode]}. Open Session controls`}
        onPress={() => setSheet('drawer')}
        style={({ pressed }) => [
          styles.grabber,
          { borderTopColor: C.live },
          pressed ? { backgroundColor: C.surface } : null,
        ]}>
        <View style={[styles.grabberBar, { backgroundColor: C.ink3 }]} />
        <Text style={[styles.grabberLabel, { color: C.ink3 }]}>
          {`${MODE_LABEL[mode]} · Swipe up for more`}
        </Text>
      </Pressable>

      <View
        style={[
          styles.dock,
          { borderTopColor: C.rule, backgroundColor: C.surface, paddingBottom: insets.bottom },
        ]}>
        <DockCell
          icon={micOn ? Mic : MicOff}
          label={micOn ? 'Mic on' : 'Mic off'}
          tint={micOn ? C.liveText : C.ink2}
          onPress={handleMic}
          first
        />
        <DockCell
          icon={List}
          label={`Queue/${queueLength}`}
          tint={C.ink2}
          onPress={() => setSheet('queue')}
        />
        <DockCell
          icon={MessageCircle}
          label="Chat"
          tint={C.ink2}
          onPress={() => setSheet('chat')}
        />
        <DockCell icon={MonitorUp} label="Share" tint={C.ink2} onPress={handleShare} />
        <DockCell icon={LogOut} label="Leave" tint={C.danger} onPress={handleBack} />
      </View>

      <Sheet
        visible={sheet === 'queue'}
        title="The queue"
        subtitle="Anyone in the Session can add"
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
        subtitle="Separate from the lounge — ends with the Session"
        onClose={closeSheet}>
        {room ? (
          <RoomChat roomId={room.id} loungeId={room.lounge_id} bottomInset={0} />
        ) : (
          <View style={styles.gutter}>
            <EmptyState icon={MessageCircle} title="Not in the Session yet" />
          </View>
        )}
      </Sheet>

      <Sheet
        visible={sheet === 'drawer'}
        title="Change the lobby"
        subtitle="Everyone comes with you. The queue is kept."
        onClose={closeSheet}>
        <View>
          <ModeOption
            icon={Music}
            name="Music"
            description="A shared queue, synced to the fraction of a second."
            current={mode === 'music'}
            onPress={() => handleMode('music')}
          />
          <ModeOption
            icon={Film}
            name="Movie night"
            description="Same sync engine, longer timeline. Subtitles and audio tracks stay per-person."
            current={mode === 'movie'}
            onPress={() => handleMode('movie')}
          />
          <ModeOption
            icon={MonitorUp}
            name="Screen share"
            description="One person shares, everyone else gets a View screen button."
            current={mode === 'screen'}
            onPress={() => handleMode('screen')}
          />
          <ModeOption
            icon={Gamepad2}
            name="Game table"
            description="Board games with seats and spectators. The music keeps going."
            current={mode === 'game'}
            onPress={() => handleMode('game')}
          />
          <Text style={[styles.sheetNote, { color: C.ink3 }]}>
            Only the person on aux can change the lobby. Everyone else follows the switch and keeps
            their place. Music is the only mode this build can run — the other three need tables
            that do not exist yet.
          </Text>
        </View>
      </Sheet>

      <AddTrackSheet roomId={roomId} visible={addVisible} onClose={closeAdd} />
    </Shell>
  );
}

// -------------------------------------------------------------------- layers

/**
 * One of the mutually exclusive views. The inactive one is not unmounted — see
 * the body comment — it is pushed to 1×1 with zero opacity, taken out of the
 * layout, and hidden from assistive tech and from touches.
 */
function Layer({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <View
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}
      style={[
        active ? styles.layerActive : styles.layerOffstage,
        active ? PointerEvents.auto : PointerEvents.none,
      ]}>
      {children}
    </View>
  );
}

// -------------------------------------------------------------------- shell

/**
 * Ground, atmosphere and safe area.
 *
 * The Session is the screen the app exists for, so it gets the heat at full
 * strength — this is the one place the gradient is allowed to be the loudest
 * thing before the artwork loads. It sits BEHIND the safe area rather than
 * inside it, so the colour runs under the status bar instead of stopping at a
 * hard line below it.
 */
function Shell({ children }: { children: ReactNode }) {
  const C = useColors();

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <HeatBackdrop extent={0.5} />
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.safe}>
        {/*
          react-native-web has no phone to constrain it, so an unbounded column
          stretches to the full window width and the line length is unreadable.
        */}
        <View style={styles.constrain}>{children}</View>
      </SafeAreaView>
    </View>
  );
}

// ------------------------------------------------------------------ top bar

type TopBarProps = {
  name: string;
  lounge: string | null;
  lockedCount: number;
  listenerCount: number;
  onBack: () => void;
  onOpenDiagnostics: () => void;
  showReadout: boolean;
};

const TopBar = memo(function TopBar({
  name,
  lounge,
  lockedCount,
  listenerCount,
  onBack,
  onOpenDiagnostics,
  showReadout,
}: TopBarProps) {
  const C = useColors();

  return (
    <View style={[styles.topBar, { borderBottomColor: C.rule }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Go back"
        onPress={onBack}
        style={({ pressed }) => [
          styles.back,
          { borderRightColor: C.rule },
          pressed ? { backgroundColor: C.surface } : null,
        ]}>
        <ArrowLeft size={20} strokeWidth={2} color={C.ink2} />
      </Pressable>

      <View style={styles.topMeta}>
        <Text numberOfLines={1} style={[styles.sessionName, { color: C.ink }]}>
          {name}
        </Text>
        <Text numberOfLines={1} style={[styles.loungeName, { color: C.ink3 }]}>
          {lounge ?? 'Aux'}
        </Text>
      </View>

      {showReadout ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${lockedCount} of ${listenerCount} locked, ${listenerCount} listening. Open the sync orbit.`}
          onPress={onOpenDiagnostics}
          style={({ pressed }) => [
            styles.readout,
            { borderLeftColor: C.rule },
            pressed ? { backgroundColor: C.surface } : null,
          ]}>
          <Text style={[styles.readoutTop, { color: C.liveText }]}>
            {`${lockedCount}/${listenerCount} locked`}
          </Text>
          <Text style={[styles.readoutBottom, { color: C.ink3 }]}>
            {`${listenerCount} listening`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
});

// ------------------------------------------------------------------ toggle

type ToggleCellProps = { label: string; active: boolean; onPress: () => void; first?: boolean };

const ToggleCell = memo(function ToggleCell({ label, active, onPress, first }: ToggleCellProps) {
  const C = useColors();

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      onPress={onPress}
      style={[
        styles.toggleCell,
        first ? null : { borderLeftWidth: Rule.hair, borderLeftColor: C.rule },
        active ? { backgroundColor: C.live } : null,
      ]}>
      <Text style={[styles.toggleLabel, { color: active ? C.onLive : C.ink2 }]}>{label}</Text>
    </Pressable>
  );
});

// -------------------------------------------------------------------- dock

type DockCellProps = {
  icon: LucideIcon;
  label: string;
  tint: string;
  onPress: () => void;
  first?: boolean;
};

const DockCell = memo(function DockCell({ icon: Icon, label, tint, onPress, first }: DockCellProps) {
  const C = useColors();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.dockCell,
        first ? null : { borderLeftWidth: Rule.hair, borderLeftColor: C.rule },
        pressed ? { backgroundColor: C.surface2 } : null,
      ]}>
      <Icon size={19} strokeWidth={2} color={tint} />
      <Text numberOfLines={1} style={[styles.dockLabel, { color: tint }]}>
        {label}
      </Text>
    </Pressable>
  );
});

// ------------------------------------------------------------------ sheets

type SheetProps = {
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
};

/**
 * Bottom-anchored, 80% tall, 2px accent top rule. Zero radius: a sheet in this
 * direction is a panel that slid up, not a card that floated in.
 */
function Sheet({ visible, title, subtitle, onClose, children }: SheetProps) {
  const C = useColors();
  const insets = useSafeAreaInsets();

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

        <View
          style={[
            styles.sheet,
            { backgroundColor: C.bg, borderTopColor: C.live, marginBottom: insets.bottom },
          ]}>
          <View style={[styles.sheetHead, { borderBottomColor: C.rule }]}>
            <View style={styles.sheetHeadMeta}>
              <Text numberOfLines={1} style={[styles.sheetTitle, { color: C.ink }]}>
                {title}
              </Text>
              {subtitle ? (
                <Text numberOfLines={2} style={[styles.sheetSubtitle, { color: C.ink3 }]}>
                  {subtitle}
                </Text>
              ) : null}
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onClose}
              style={styles.sheetClose}>
              <Text style={[styles.sheetCloseLabel, { color: C.ink2 }]}>Close</Text>
            </Pressable>
          </View>

          <View style={styles.sheetBody}>{children}</View>
        </View>
      </View>
    </Modal>
  );
}

type NowPlayingStripProps = {
  title: string | null;
  positionMs: number;
  durationMs: number;
};

/** The queue sheet's header: what is playing right now, above what is next. */
const NowPlayingStrip = memo(function NowPlayingStrip({
  title,
  positionMs,
  durationMs,
}: NowPlayingStripProps) {
  const C = useColors();

  // Red means playing. With no track there is nothing playing, so the strip
  // loses the accent entirely rather than sitting there red over "0:00 / 0:00"
  // — and the status line stops claiming it is playing.
  const playing = title !== null;

  return (
    <View style={[styles.strip, { backgroundColor: C.surface, borderBottomColor: C.rule }]}>
      <View style={[styles.stripTile, { backgroundColor: playing ? C.live : C.surface3 }]}>
        <Text style={[styles.stripInitial, { color: playing ? C.onLive : C.ink3 }]}>
          {initialFor(title)}
        </Text>
      </View>
      <View style={styles.stripMeta}>
        <Text numberOfLines={1} style={[styles.stripTitle, { color: C.ink }]}>
          {title ?? 'Nothing playing'}
        </Text>
        <Text numberOfLines={1} style={[styles.stripStatus, { color: playing ? C.liveText : C.ink3 }]}>
          {playing
            ? `Playing · ${formatClock(positionMs)} / ${formatClock(durationMs)}`
            : 'Add a track to start the Session'}
        </Text>
      </View>
    </View>
  );
});

type ModeOptionProps = {
  icon: LucideIcon;
  name: string;
  description: string;
  current: boolean;
  onPress: () => void;
};

const ModeOption = memo(function ModeOption({
  icon: Icon,
  name,
  description,
  current,
  onPress,
}: ModeOptionProps) {
  const C = useColors();

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: current }}
      accessibilityLabel={name}
      accessibilityHint={description}
      onPress={onPress}
      style={({ pressed }) => [
        styles.modeOption,
        { borderBottomColor: C.rule },
        pressed ? { backgroundColor: C.surface } : null,
      ]}>
      <Icon size={22} strokeWidth={2} color={C.ink2} />
      <View style={styles.modeMeta}>
        <Text style={[styles.modeName, { color: C.ink }]}>{name}</Text>
        <Text style={[styles.modeDescription, { color: C.ink2 }]}>{description}</Text>
      </View>
      {current ? (
        <View style={[styles.currentChip, { backgroundColor: C.live }]}>
          <Text style={[styles.currentChipLabel, { color: C.onLive }]}>Current</Text>
        </View>
      ) : null}
    </Pressable>
  );
});

// ----------------------------------------------------------- other modes

const NOT_BUILT: Record<Exclude<SessionMode, 'music'>, string> = {
  movie:
    'Movie night needs a media source on the room timeline — there is no table for a film, and no subtitle or audio-track state to keep per person. The sync engine itself would carry it unchanged.',
  screen:
    'Screen share needs peer-to-peer signalling. Nothing about it goes through the backend by design, and none of that handshake exists yet.',
  game:
    'The game table needs three tables that are not in the schema: games, game seats and the seat-request queue. Seating people without them would be a screen full of guesses.',
};

/**
 * A mode that is designed but not backed. It says which mode, that it is not
 * built, and what it is waiting on — the same honesty the rest of this app
 * applies to Spotify free accounts and missing lyrics.
 */
const NotBuiltYet = memo(function NotBuiltYet({
  mode,
  onBackToMusic,
}: {
  mode: Exclude<SessionMode, 'music'> | SessionMode;
  onBackToMusic: () => void;
}) {
  const C = useColors();
  if (mode === 'music') return null;

  return (
    <View>
      <View style={[styles.modeWell, { backgroundColor: C.bgRecessed, borderBottomColor: C.rule }]}>
        <ModularGrid />
        <Text style={[styles.modeWellGlyph, { color: C.artwork }]}>{MODE_LABEL[mode][0]}</Text>
        <View style={[styles.modeWellRule, { backgroundColor: C.liveMid }, PointerEvents.none]} />
        <View style={[styles.modeWellChip, { backgroundColor: C.live }]}>
          <Text style={[styles.modeWellChipLabel, { color: C.onLive }]}>{MODE_LABEL[mode]}</Text>
        </View>
      </View>

      <View style={styles.modeBody}>
        <Text style={[styles.modeHeadline, { color: C.ink }]}>Not built yet</Text>
        <Text style={[styles.modeCopy, { color: C.ink2 }]}>{NOT_BUILT[mode]}</Text>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to music"
          onPress={onBackToMusic}
          style={({ pressed }) => [
            styles.backToMusic,
            { borderColor: C.rule2 },
            pressed ? { borderColor: C.live } : null,
          ]}>
          <Text style={[styles.backToMusicLabel, { color: C.ink }]}>Back to music</Text>
        </Pressable>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  safe: {
    flex: 1,
  },
  constrain: {
    flex: 1,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
  },
  gutter: {
    paddingHorizontal: GUTTER,
  },
  body: {
    flex: 1,
    minHeight: 0,
  },
  layerActive: {
    flex: 1,
    minHeight: 0,
  },
  /** Mounted, running, effectively invisible, and out of the layout flow. */
  layerOffstage: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 1,
    height: 1,
    opacity: 0,
    overflow: 'hidden',
  },

  // ------------------------------------------------------------- top bar
  topBar: {
    flexDirection: 'row',
    alignItems: 'stretch',
    minHeight: TOUCH_TARGET,
    borderBottomWidth: Rule.major,
  },
  back: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    flexGrow: 0,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRightWidth: Rule.hair,
  },
  topMeta: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
    paddingHorizontal: Space.md - 2,
  },
  sessionName: {
    ...Type.heading(12),
    letterSpacing: tracking(12, 0.06),
    textTransform: 'uppercase',
  },
  loungeName: {
    ...Type.label(10),
  },
  readout: {
    flexGrow: 0,
    flexShrink: 0,
    minHeight: TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: Space.md - 2,
    borderLeftWidth: Rule.hair,
  },
  readoutTop: {
    ...readout(10),
    letterSpacing: tracking(10, 0.09),
    textTransform: 'uppercase',
  },
  readoutBottom: {
    ...Type.label(10),
    letterSpacing: tracking(10, 0.09),
  },

  // -------------------------------------------------------------- toggle
  toggle: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderBottomWidth: Rule.hair,
  },
  toggleCell: {
    flex: 1,
    minHeight: TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: Space.md,
  },
  toggleLabel: {
    ...Type.heading(10),
    letterSpacing: tracking(10, 0.1),
    textTransform: 'uppercase',
  },

  // ------------------------------------------------------------- grabber
  grabber: {
    flexGrow: 0,
    flexShrink: 0,
    minHeight: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.xs,
    borderTopWidth: Rule.major,
  },
  grabberBar: {
    width: 40,
    height: 3,
  },
  grabberLabel: {
    ...Type.heading(10),
    letterSpacing: tracking(10, 0.13),
    textTransform: 'uppercase',
  },

  // ---------------------------------------------------------------- dock
  dock: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderTopWidth: Rule.hair,
  },
  dockCell: {
    flex: 1,
    minHeight: DOCK_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: Space.sm,
  },
  dockLabel: {
    ...Type.heading(10),
    letterSpacing: tracking(10, 0.07),
    textTransform: 'uppercase',
  },

  // -------------------------------------------------------------- sheets
  scrim: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '80%',
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    borderTopWidth: Rule.major,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingHorizontal: GUTTER,
    paddingTop: Space.md,
    paddingBottom: Space.md - 2,
    borderBottomWidth: Rule.major,
  },
  sheetHeadMeta: {
    flex: 1,
    minWidth: 0,
  },
  sheetTitle: {
    ...Type.heading(15),
    letterSpacing: tracking(15, 0.03),
    textTransform: 'uppercase',
  },
  sheetSubtitle: {
    ...Type.label(10),
    letterSpacing: tracking(10, 0.09),
    marginTop: 2,
  },
  sheetClose: {
    minHeight: TOUCH_TARGET,
    minWidth: TOUCH_TARGET,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingHorizontal: Space.xs,
  },
  sheetCloseLabel: {
    ...Type.heading(10),
    letterSpacing: tracking(10, 0.1),
    textTransform: 'uppercase',
  },
  sheetBody: {
    flexShrink: 1,
    minHeight: 0,
  },
  sheetNote: {
    ...Type.body(16),
    padding: GUTTER,
    paddingBottom: Space.xl,
  },

  // ------------------------------------------------------- now-playing strip
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm + 2,
    paddingHorizontal: GUTTER,
    paddingVertical: Space.md - 2,
    borderBottomWidth: Rule.hair,
  },
  stripTile: {
    width: 34,
    height: 34,
    flexGrow: 0,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stripInitial: {
    ...readout(15),
  },
  stripMeta: {
    flex: 1,
    minWidth: 0,
  },
  stripTitle: {
    ...Type.heading(13),
    letterSpacing: tracking(13, 0.02),
  },
  stripStatus: {
    ...readout(10),
    letterSpacing: tracking(10, 0.08),
    textTransform: 'uppercase',
  },

  // ---------------------------------------------------------- mode picker
  modeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    minHeight: 76,
    paddingHorizontal: GUTTER,
    paddingVertical: Space.md,
    borderBottomWidth: Rule.hair,
  },
  modeMeta: {
    flex: 1,
    minWidth: 0,
  },
  modeName: {
    ...Type.heading(15),
    letterSpacing: tracking(15, 0.01),
  },
  modeDescription: {
    ...Type.body(13),
    marginTop: 2,
  },
  currentChip: {
    flexGrow: 0,
    flexShrink: 0,
    paddingHorizontal: 7,
    paddingVertical: Space.xs,
  },
  currentChipLabel: {
    ...Type.heading(10),
    letterSpacing: tracking(10, 0.09),
    textTransform: 'uppercase',
  },

  // ----------------------------------------------------------- not built
  modeWell: {
    position: 'relative',
    width: '100%',
    aspectRatio: 16 / 9,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderBottomWidth: Rule.major,
  },
  modeWellGlyph: {
    ...Type.display(72),
  },
  modeWellRule: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    height: Rule.major,
  },
  modeWellChip: {
    position: 'absolute',
    right: Space.md - 2,
    top: Space.md - 2,
    paddingHorizontal: 7,
    paddingVertical: Space.xs,
  },
  modeWellChipLabel: {
    ...Type.heading(10),
    letterSpacing: tracking(10, 0.09),
    textTransform: 'uppercase',
  },
  modeBody: {
    paddingHorizontal: GUTTER,
    paddingTop: Space.lg - 2,
  },
  modeHeadline: {
    ...Type.display(26),
    lineHeight: 27,
    letterSpacing: tracking(26, -0.03),
  },
  modeCopy: {
    ...Type.body(16),
    marginTop: Space.sm,
  },
  backToMusic: {
    marginTop: Space.lg,
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: Space.lg - 2,
    borderWidth: Rule.hair,
  },
  backToMusicLabel: {
    ...Type.heading(11),
    letterSpacing: tracking(11, 0.1),
    textTransform: 'uppercase',
  },
});
