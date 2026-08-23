/**
 * The Session. This is the party, and it is the screen the whole direction
 * exists for. Built from design/v2/aux-v2.dc.html, screen "Session".
 *
 * Structural rule that must not be broken: `<YouTubePlayerHost />` is mounted
 * exactly once, here, and stays mounted for as long as the Session is open —
 * even when the active provider is Spotify. A listener whose Spotify device
 * dies mid-Session falls back to YouTube by re-pointing the adapter, and a
 * remount at that moment would mean a black WebView booting from scratch
 * instead of audio resuming in the next second. It lives inside `<NowPlaying>`,
 * which is a FIXED band of this layout and never unmounts; every other view on
 * this screen is a Modal sheet layered over it, so nothing can take it down.
 *
 * The layout is one fixed column, no scroller:
 *
 *   top bar    close · IN SESSION / lounge · queue
 *   art        252 square, or the YouTube surface itself
 *   head       re-anchor · title / artist · lobby controls
 *   waveform   elapsed · rung + drift · duration
 *   transport  shuffle · back · play · skip · repeat
 *   aux card   who has it, and the one button that changes that
 *   roster     who is here, and how many are in sync
 *
 * Everything else — the queue, the chat, the lobby controls, the listener
 * detail — is a sheet.
 */

import { router, useLocalSearchParams } from 'expo-router';
import {
  ChevronDown,
  ChevronRight,
  Film,
  Gamepad2,
  ListMusic,
  MessageCircle,
  Mic,
  MicOff,
  MonitorUp,
  Radio,
  X,
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
import { NowPlaying } from '@/components/room/now-playing';
import { HeatBackdrop } from '@/components/shell/heat-backdrop';
import { ParticipantStrip, SyncOrbit } from '@/components/room/participant-strip';
import { QueueList } from '@/components/room/queue-list';
import { AuxCard, TransportControls } from '@/components/room/transport-controls';
import { driftRung, formatClock, initialFor, readout } from '@/components/room/drift';
import { Avatar, EmptyState, SheetTabs, useToast } from '@/components/ui';
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
  Radii,
  Rule,
  Sheet as SheetMetrics,
  Space,
  TOUCH_TARGET,
  Type,
  dropped,
  pressedSoft,
  raised,
  tracking,
} from '@/lib/theme';
import { useColors } from '@/lib/theme-context';
import { expectedPositionMs } from '@/playback/sync-controller';
import { usePlayback } from '@/playback/store';
import { YouTubePlayerHost } from '@/playback/youtube-player-host';

/** How long the "Requested" latch holds before a passenger may ask again. */
const REQUEST_COOLDOWN_MS = 60_000;
/** The back cell. */
const SEEK_BACK_MS = 15_000;

const GUTTER = Space.lg;
/** Avatars drawn in the roster strip before it stops and counts instead. */
const ROSTER_FACES = 5;

type SheetName = 'queue' | 'chat' | 'lobby' | 'people' | null;
type PeopleView = 'chart' | 'orbit';

const PEOPLE_TABS = [
  { key: 'chart', label: 'LISTENERS' },
  { key: 'orbit', label: 'ORBIT' },
];

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

  const [sheet, setSheet] = useState<SheetName>(null);
  const [peopleView, setPeopleView] = useState<PeopleView>('chart');
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
  const openPeople = useCallback(() => setSheet('people'), []);

  const handleMic = useCallback(() => {
    setMicOn((on) => {
      if (!on) toast.show('Voice is not live yet', 'info');
      return !on;
    });
  }, [toast]);

  const handleShuffle = useCallback(() => toast.show('Shuffle is off', 'info'), [toast]);
  const handleRepeat = useCallback(() => toast.show('Repeat is off', 'info'), [toast]);

  const handleScreenShare = useCallback(() => {
    setSheet(null);
    toast.show('Screen share is not built yet', 'info');
  }, [toast]);
  const handleMovie = useCallback(() => {
    setSheet(null);
    toast.show('Movie night is not built yet', 'info');
  }, [toast]);
  const handleGames = useCallback(() => {
    setSheet(null);
    toast.show('The game table is not built yet', 'info');
  }, [toast]);

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

  const loungeName = lounge.data?.name ?? room?.name ?? 'Session';

  if (error && !room) {
    return (
      <Shell>
        <TopBar name={loungeName} onClose={handleBack} onQueue={null} />
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

  return (
    <Shell>
      <TopBar name={loungeName} onClose={handleBack} onQueue={openQueue} />

      {/*
        Fixed bands on a phone, scrollable on a short one. `flexGrow: 1` keeps
        the content container at least a screen tall so the spacer below the
        transport still pushes the aux card to the bottom, and the player —
        with the YouTube WebView inside it — is never unmounted either way.
      */}
      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        showsVerticalScrollIndicator={false}>
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
          errorMessage={playbackError?.message ?? null}
        />

        <TransportControls
          isHost={isHost}
          isPlaying={room?.is_playing === true}
          canPlay={Boolean(room?.track_id) || queueLength > 0}
          canSkip={Boolean(room?.track_id) || queueLength > 0}
          isBusy={transport.isBusy}
          onPlayPause={handlePlayPause}
          onSkip={handleSkip}
          onSeekBack={isHost ? handleSeekBack : undefined}
          onShuffle={handleShuffle}
          onRepeat={handleRepeat}
        />

        <View style={styles.spacer} />

        <View style={styles.auxSlot}>
          <AuxCard
            name={onAux?.displayName ?? null}
            avatarUrl={onAux?.avatarUrl ?? null}
            isHost={isHost}
            requestSent={requestSent}
            onRequestAux={handleRequestAux}
          />
        </View>

        <RosterStrip
          people={roster}
          lockedCount={lockedCount}
          listenerCount={listenerCount}
          bottomInset={insets.bottom}
          onPress={openPeople}
        />
      </ScrollView>

      <Sheet
        visible={sheet === 'queue'}
        title="Queue"
        subtitle={`${queueLength} up next · anyone can add`}
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

      <Sheet visible={sheet === 'chat'} title="Chat" onClose={closeSheet}>
        {room ? (
          <RoomChat roomId={room.id} loungeId={room.lounge_id} bottomInset={0} />
        ) : (
          <View style={styles.gutter}>
            <EmptyState icon={MessageCircle} title="Not in the Session yet" />
          </View>
        )}
      </Sheet>

      <Sheet
        visible={sheet === 'people'}
        title="Listening"
        subtitle={`${lockedCount} of ${listenerCount} in sync`}
        onClose={closeSheet}>
        <View style={styles.peopleTabs}>
          <SheetTabs
            tabs={PEOPLE_TABS}
            active={peopleView}
            onChange={(key) => setPeopleView(key as PeopleView)}
            variant="segmented"
          />
        </View>

        {peopleView === 'chart' ? (
          <ParticipantStrip
            roomId={roomId}
            hostId={room?.host_id ?? null}
            currentUserId={userId}
            contentBottomInset={Space.xl}
          />
        ) : (
          <SyncOrbit
            roomId={roomId}
            hostId={room?.host_id ?? null}
            currentUserId={userId}
            track={track}
            timeline={sheet === 'people' ? timeline : null}
            contentBottomInset={Space.xl}
          />
        )}
      </Sheet>

      <Sheet visible={sheet === 'lobby'} title="Lobby" onClose={closeSheet}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.lobby}>
          <LobbyRow
            icon={micOn ? Mic : MicOff}
            label="Microphone"
            value={micOn ? 'On' : 'Off'}
            onPress={handleMic}
          />
          <LobbyRow icon={MessageCircle} label="Chat" onPress={openChat} />
          <LobbyRow
            icon={MonitorUp}
            label="Screen share"
            value="Not built yet"
            onPress={handleScreenShare}
          />
          <LobbyRow icon={Film} label="Movie night" value="Not built yet" onPress={handleMovie} />
          <LobbyRow icon={Gamepad2} label="Game table" value="Not built yet" onPress={handleGames} />

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Leave the Session"
            onPress={handleBack}
            style={({ pressed }) => [
              styles.leave,
              { borderColor: C.live, backgroundColor: pressed ? C.liveWash : 'transparent' },
            ]}>
            <Text style={[styles.leaveLabel, { color: C.liveText }]}>Leave session</Text>
          </Pressable>
        </ScrollView>
      </Sheet>

      <AddTrackSheet roomId={roomId} visible={addVisible} onClose={closeAdd} />
    </Shell>
  );
}

// -------------------------------------------------------------------- shell

/**
 * Ground, atmosphere and safe area.
 *
 * The Session gets the heat at full strength — this is the one place the
 * gradient is allowed to be the loudest thing before the artwork loads. It sits
 * BEHIND the safe area rather than inside it, so the colour runs under the
 * status bar instead of stopping at a hard line below it.
 */
function Shell({ children }: { children: ReactNode }) {
  const C = useColors();

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <HeatBackdrop extent={0.5} direction="vertical" />
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

// ---------------------------------------------------------------- the tile

/** The 40px raised card square the artboard puts every piece of chrome in. */
const Tile = memo(function Tile({
  icon: Icon,
  label,
  onPress,
  size = 40,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  size?: number;
}) {
  const C = useColors();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={Math.max(0, (TOUCH_TARGET - size) / 2)}
      style={({ pressed }) => [
        styles.tile,
        { width: size, height: size, backgroundColor: C.surface },
        raised(C),
        pressed ? styles.dim : null,
      ]}>
      <Icon size={19} strokeWidth={2.2} color={C.ink} />
    </Pressable>
  );
});

// ------------------------------------------------------------------ top bar

const TopBar = memo(function TopBar({
  name,
  onClose,
  onQueue,
}: {
  name: string;
  onClose: () => void;
  onQueue: (() => void) | null;
}) {
  const C = useColors();

  return (
    <View style={styles.topBar}>
      <Tile icon={ChevronDown} label="Close the Session" onPress={onClose} />

      <View style={styles.topMeta}>
        <Text style={[styles.topKicker, { color: C.ink3 }]}>In session</Text>
        <Text numberOfLines={1} style={[styles.topName, { color: C.ink }]}>
          {name}
        </Text>
      </View>

      {onQueue ? (
        <Tile icon={ListMusic} label="Open the queue" onPress={onQueue} />
      ) : (
        <View style={styles.topSpacer} />
      )}
    </View>
  );
});

// ----------------------------------------------------------------- roster

type RosterStripProps = {
  people: { userId: string; displayName: string; avatarUrl: string | null }[];
  lockedCount: number;
  listenerCount: number;
  bottomInset: number;
  onPress: () => void;
};

/** Faces, then the count. Tapping it opens the per-person drift detail. */
const RosterStrip = memo(function RosterStrip({
  people,
  lockedCount,
  listenerCount,
  bottomInset,
  onPress,
}: RosterStripProps) {
  const C = useColors();
  const behind = Math.max(0, listenerCount - lockedCount);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${listenerCount} listening, ${lockedCount} in sync. Open listener detail.`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.roster,
        { paddingBottom: bottomInset + Space.lg },
        pressed ? styles.dim : null,
      ]}>
      {people.slice(0, ROSTER_FACES).map((person, index) => (
        <View key={person.userId} style={index > 2 ? styles.faceBack : null}>
          <Avatar name={person.displayName} uri={person.avatarUrl} size={34} />
        </View>
      ))}

      <Text style={[styles.rosterLine, { color: C.ink3 }]}>
        {`${lockedCount} in sync\n${behind} catching up`}
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

/** Bottom-anchored, 74% tall, 28px top corners, a grabber and a close tile. */
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
            { backgroundColor: C.bg, paddingBottom: insets.bottom },
            dropped(C, 'lg'),
          ]}>
          <View style={styles.grabberSlot}>
            <View style={[styles.grabber, { backgroundColor: C.ink3 }]} />
          </View>

          <View style={styles.sheetHead}>
            <View style={styles.sheetHeadMeta}>
              <Text numberOfLines={1} style={[styles.sheetTitle, { color: C.ink }]}>
                {title}
              </Text>
              {subtitle ? (
                <Text numberOfLines={1} style={[styles.sheetSubtitle, { color: C.ink2 }]}>
                  {subtitle}
                </Text>
              ) : null}
            </View>

            <Tile icon={X} label="Close" onPress={onClose} size={36} />
          </View>

          <View style={styles.sheetBody}>{children}</View>
        </View>
      </View>
    </Modal>
  );
}

/** A raised row inside the lobby sheet: recessed icon well, label, value, chevron. */
const LobbyRow = memo(function LobbyRow({
  icon: Icon,
  label,
  value,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  value?: string;
  onPress: () => void;
}) {
  const C = useColors();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}. ${value}` : label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.lobbyRow,
        { backgroundColor: C.surface },
        raised(C),
        pressed ? styles.dim : null,
      ]}>
      <View style={[styles.lobbyWell, { backgroundColor: C.bgRecessed }, pressedSoft(C)]}>
        <Icon size={17} strokeWidth={2} color={C.ink2} />
      </View>

      <View style={styles.lobbyMeta}>
        <Text style={[styles.lobbyLabel, { color: C.ink }]}>{label}</Text>
        {value ? <Text style={[styles.lobbyValue, { color: C.ink2 }]}>{value}</Text> : null}
      </View>

      <ChevronRight size={17} strokeWidth={2} color={C.ink3} />
    </Pressable>
  );
});

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
  // loses the accent entirely rather than sitting there red over "0:00 / 0:00".
  const playing = title !== null;

  return (
    <View style={[styles.strip, { backgroundColor: C.surface }, raised(C)]}>
      <View style={[styles.stripTile, { backgroundColor: playing ? C.live : C.bgRecessed }]}>
        <Text style={[styles.stripInitial, { color: playing ? C.onLive : C.ink3 }]}>
          {initialFor(title)}
        </Text>
      </View>
      <View style={styles.stripMeta}>
        <Text numberOfLines={1} style={[styles.stripTitle, { color: C.ink }]}>
          {title ?? 'Nothing playing'}
        </Text>
        <Text numberOfLines={1} style={[styles.stripStatus, { color: playing ? C.liveText : C.ink3 }]}>
          {playing ? `${formatClock(positionMs)} / ${formatClock(durationMs)}` : 'Add a track'}
        </Text>
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
    maxWidth: 480,
    alignSelf: 'center',
  },
  gutter: {
    paddingHorizontal: GUTTER,
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    flexGrow: 1,
  },
  spacer: {
    flex: 1,
    minHeight: Space.lg,
  },
  dim: {
    opacity: 0.6,
  },

  // ------------------------------------------------------------- top bar
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingTop: Space.md,
    paddingHorizontal: Space.xl,
  },
  topMeta: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
  },
  topKicker: {
    ...Type.label(10),
    letterSpacing: tracking(10, 0.16),
  },
  topName: {
    fontFamily: Fonts.extrabold,
    fontSize: 14.5,
    letterSpacing: tracking(14.5, -0.01),
    marginTop: 2,
  },
  topSpacer: {
    width: 40,
    height: 40,
  },
  tile: {
    borderRadius: Radii.sm + 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // -------------------------------------------------------------- aux card
  auxSlot: {
    paddingHorizontal: Space.lg + 2,
    paddingBottom: Space.md + 2,
  },

  // --------------------------------------------------------------- roster
  roster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm + 1,
    minHeight: TOUCH_TARGET,
    paddingHorizontal: Space.xl,
  },
  /** The tail of the strip sits back, exactly as the artboard draws it. */
  faceBack: {
    opacity: 0.42,
  },
  rosterLine: {
    ...Type.label(10),
    letterSpacing: tracking(10, 0.09),
    lineHeight: 14,
    marginLeft: Space.xs + 1,
  },

  // --------------------------------------------------------------- sheets
  scrim: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    /** `Sheet.maxHeight` is 0.74; RN wants the literal percentage. */
    maxHeight: '74%',
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    borderTopLeftRadius: SheetMetrics.radius,
    borderTopRightRadius: SheetMetrics.radius,
  },
  grabberSlot: {
    paddingTop: Space.md + 2,
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
    paddingHorizontal: Space.xxl,
    paddingTop: Space.lg + 2,
    paddingBottom: Space.md + 2,
  },
  sheetHeadMeta: {
    flex: 1,
    minWidth: 0,
  },
  sheetTitle: {
    ...Type.display(20),
    letterSpacing: tracking(20, -0.025),
  },
  sheetSubtitle: {
    ...Type.body(12.5),
    marginTop: 3,
  },
  sheetBody: {
    flexShrink: 1,
    minHeight: 0,
  },
  peopleTabs: {
    paddingHorizontal: Space.lg,
    paddingBottom: Space.md,
  },

  // ---------------------------------------------------------------- lobby
  lobby: {
    paddingHorizontal: Space.xl,
    paddingBottom: Space.xxl,
    gap: Space.sm + 2,
  },
  lobbyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md + 2,
    minHeight: TOUCH_TARGET + 24,
    padding: Space.md + 3,
    borderRadius: Radii.lg,
  },
  lobbyWell: {
    width: 38,
    height: 38,
    borderRadius: Radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lobbyMeta: {
    flex: 1,
    minWidth: 0,
  },
  lobbyLabel: {
    fontFamily: Fonts.extrabold,
    fontSize: 14.5,
    letterSpacing: tracking(14.5, -0.005),
  },
  lobbyValue: {
    ...Type.body(12.5),
    marginTop: 2,
  },
  leave: {
    marginTop: Space.sm,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.button,
    borderWidth: Rule.thick,
  },
  leaveLabel: {
    ...Type.heading(13),
    letterSpacing: tracking(13, 0.04),
  },

  // ------------------------------------------------------- now-playing strip
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    marginHorizontal: Space.lg,
    marginBottom: Space.md,
    padding: Space.md,
    borderRadius: Radii.md + 2,
  },
  stripTile: {
    width: 40,
    height: 40,
    flexGrow: 0,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.sm + 1,
  },
  stripInitial: {
    ...readout(16),
  },
  stripMeta: {
    flex: 1,
    minWidth: 0,
  },
  stripTitle: {
    ...Type.heading(14),
    letterSpacing: tracking(14, -0.01),
  },
  stripStatus: {
    ...readout(11),
    letterSpacing: tracking(11, 0.04),
    marginTop: 2,
  },
});
