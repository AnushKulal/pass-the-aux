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
 * That is also why loading and empty are drawn INSIDE the bands rather than as
 * a separate screen swapped in ahead of them: a skeleton that replaces the
 * whole column would unmount the player on its way out. The one exception is
 * the "you cannot open this Session" error, which can only happen before the
 * room row has ever landed — nothing is playing, so there is nothing to lose.
 *
 * The layout is one fixed column, no scroller:
 *
 *   top bar    close · IN SESSION / lounge · queue
 *   art        252 square, or the YouTube surface itself
 *   head       re-anchor · title / artist · lobby controls
 *   waveform   elapsed · rung + drift · duration
 *   transport  shuffle · back · play · skip · repeat
 *   prompt     only when nothing is queued: the one next move
 *   aux card   who has it, and the one button that changes that
 *   roster     who is here, and how many are in sync
 *
 * Everything else — the queue, the chat, the lobby controls, the listener
 * detail — is a sheet.
 */

import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import {
  ChevronDown,
  ChevronRight,
  Film,
  Gamepad2,
  HeadphoneOff,
  Headphones,
  ListMusic,
  LogOut,
  MessageCircle,
  Mic,
  MicOff,
  MonitorUp,
  Plus,
  Radio,
  RotateCw,
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
import { ParticipantStrip, SyncOrbit } from '@/components/room/participant-strip';
import { QueueList } from '@/components/room/queue-list';
import { AuxCard, TransportControls } from '@/components/room/transport-controls';
import { driftRung, formatClock, initialFor, readout } from '@/components/room/drift';
import { Avatar, EmptyState, SheetTabs, Skeleton, useToast } from '@/components/ui';
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
  dropped,
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
/** The ground's three stops, top to bottom. */
const GROUND_LOCATIONS = [0, 0.46, 1] as const;

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
  const [deafened, setDeafened] = useState(false);
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
  // Memoised because `toggleMemberMute` looks a name up in it: a fresh `[]`
  // every render would hand every roster row a new callback on every tick.
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
  const openPeople = useCallback(() => setSheet('people'), []);

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
  /**
   * Loaded, and there is genuinely nothing on the deck and nothing behind it.
   * Both loads have to have finished: showing "nothing queued" while the queue
   * is still in flight is a promise the next 200ms may break.
   */
  const nothingQueued =
    !isLoading && !queue.isLoading && Boolean(room) && !room?.track_id && queueLength === 0;

  if (error && !room) {
    return (
      <Shell>
        <TopBar name={loungeName} onClose={handleBack} onQueue={null} />
        <View style={styles.errorSlot}>
          <EmptyState
            icon={Radio}
            title="This Session is not open to you"
            description="It may have ended, or it lives in a lounge you have not joined."
            action={
              <View style={styles.errorActions}>
                <FilledAction icon={RotateCw} label="Try again" onPress={resync} />
                <QuietAction icon={LogOut} label="Back" onPress={handleBack} />
              </View>
            }
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

        {nothingQueued ? <QueuePrompt onPress={openAdd} /> : null}

        <View style={styles.auxSlot}>
          <AuxCard
            name={onAux?.displayName ?? null}
            avatarUrl={onAux?.avatarUrl ?? null}
            isHost={isHost}
            isLoading={isLoading && !room}
            requestSent={requestSent}
            onRequestAux={handleRequestAux}
          />
        </View>

        <RosterStrip
          people={roster}
          isLoading={participants.isLoading && !participants.data}
          lockedCount={lockedCount}
          listenerCount={listenerCount}
          bottomInset={insets.bottom}
          onPress={openPeople}
        />
      </ScrollView>

      <Sheet
        visible={sheet === 'queue'}
        title="Queue"
        subtitle={queueLength > 0 ? `${queueLength} up next · anyone can add` : 'Anyone can add'}
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
          <View style={styles.errorSlot}>
            <EmptyState
              icon={MessageCircle}
              title="Not in the Session yet"
              description="Chat opens once the Session has loaded."
              action={<FilledAction icon={RotateCw} label="Try again" onPress={resync} />}
            />
          </View>
        )}
      </Sheet>

      <Sheet
        visible={sheet === 'people'}
        title="Listening"
        subtitle={`${lockedCount} of ${listenerCount} in sync · tap anyone to mute`}
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
            mutedIds={mutedIds}
            onSelectPerson={toggleMemberMute}
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
            mutedIds={mutedIds}
            onSelectPerson={toggleMemberMute}
            contentBottomInset={Space.xl}
          />
        )}
      </Sheet>

      <Sheet visible={sheet === 'lobby'} title="Lobby" subtitle={loungeName} onClose={closeSheet}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.lobby}>
          <LobbyGroup label="Voice">
            <LobbyRow
              icon={micOn ? Mic : MicOff}
              label="Microphone"
              state={deafened ? 'Deafened' : micOn ? 'On' : 'Off'}
              on={micOn && !deafened}
              onPress={handleMic}
            />
            <LobbyRow
              icon={deafened ? HeadphoneOff : Headphones}
              label="Deafen"
              state={deafened ? 'On' : 'Off'}
              on={deafened}
              onPress={handleDeafen}
            />
          </LobbyGroup>

          <LobbyGroup label="Together">
            <LobbyRow icon={MessageCircle} label="Chat" onPress={openChat} />
            <LobbyRow
              icon={MonitorUp}
              label="Screen share"
              state="Soon"
              onPress={handleScreenShare}
            />
            <LobbyRow icon={Film} label="Movie night" state="Soon" onPress={handleMovie} />
            <LobbyRow icon={Gamepad2} label="Game table" state="Soon" onPress={handleGames} />
          </LobbyGroup>

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
 * Ground and safe area.
 *
 * The v2 ground is a three-stop vertical wash — light at the top, falling to
 * the darkest value at the bottom — not the corner-entering heat gradient the
 * abandoned Apex direction used. It sits BEHIND the safe area rather than
 * inside it, so the colour runs under the status bar instead of stopping at a
 * hard line below it.
 */
function Shell({ children }: { children: ReactNode }) {
  const C = useColors();

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <LinearGradient
        colors={[C.bgTop, C.bg, C.bgBot]}
        locations={GROUND_LOCATIONS}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={[StyleSheet.absoluteFill, PointerEvents.none]}
      />
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

// ---------------------------------------------------------------- actions

/** The one filled button in a notice. Same device as the aux card's action. */
const FilledAction = memo(function FilledAction({
  icon: Icon,
  label,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
}) {
  const C = useColors();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.filledAction,
        { backgroundColor: C.pill },
        pressed ? styles.dim : null,
      ]}>
      <Icon size={15} strokeWidth={2.4} color={C.pillInk} />
      <Text style={[styles.filledActionLabel, { color: C.pillInk }]}>{label}</Text>
    </Pressable>
  );
});

/** The second choice beside it. Never two filled buttons in one notice. */
const QuietAction = memo(function QuietAction({
  icon: Icon,
  label,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
}) {
  const C = useColors();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.quietAction,
        { backgroundColor: C.bgRecessed, borderColor: pressed ? C.rule3 : C.rule },
      ]}>
      <Icon size={15} strokeWidth={2.4} color={C.ink2} />
      <Text style={[styles.quietActionLabel, { color: C.ink2 }]}>{label}</Text>
    </Pressable>
  );
});

// ---------------------------------------------------------- nothing queued

/**
 * The Session's empty state. It sits where the music would be talked about, it
 * says the one thing left to do, and it carries the one button that does it.
 */
const QueuePrompt = memo(function QueuePrompt({ onPress }: { onPress: () => void }) {
  const C = useColors();

  return (
    <View style={[styles.prompt, { backgroundColor: C.surface }, raised(C)]}>
      <View style={styles.promptMeta}>
        <Text style={[styles.promptKicker, { color: C.ink3 }]}>Nothing queued</Text>
        <Text style={[styles.promptTitle, { color: C.ink }]}>Start the Session</Text>
      </View>

      <FilledAction icon={Plus} label="Add a track" onPress={onPress} />
    </View>
  );
});

// ----------------------------------------------------------------- roster

type RosterStripProps = {
  people: { userId: string; displayName: string; avatarUrl: string | null }[];
  isLoading: boolean;
  lockedCount: number;
  listenerCount: number;
  bottomInset: number;
  onPress: () => void;
};

/** Faces, then the count. Tapping it opens the per-person drift detail. */
const RosterStrip = memo(function RosterStrip({
  people,
  isLoading,
  lockedCount,
  listenerCount,
  bottomInset,
  onPress,
}: RosterStripProps) {
  const C = useColors();
  const behind = Math.max(0, listenerCount - lockedCount);

  const line = isLoading
    ? 'Counting\nlisteners'
    : listenerCount === 0
      ? 'Nobody yet\nTap to check'
      : `${lockedCount} in sync\n${behind} catching up`;

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
      {isLoading
        ? Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} width={34} height={34} style={styles.faceSkeleton} />
          ))
        : people
            .slice(0, ROSTER_FACES)
            .map((person, index) => (
              <View key={person.userId} style={index > 2 ? styles.faceBack : null}>
                <Avatar name={person.displayName} uri={person.avatarUrl} size={34} />
              </View>
            ))}

      <Text style={[styles.rosterLine, { color: C.ink3 }]}>{line}</Text>
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

// ------------------------------------------------------------------ lobby

/** A titled run of lobby rows. Voice above, everything social below it. */
const LobbyGroup = memo(function LobbyGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const C = useColors();

  return (
    <View style={styles.lobbyGroup}>
      <Text style={[styles.lobbyGroupLabel, { color: C.ink3 }]}>{label}</Text>
      <View style={styles.lobbyGroupRows}>{children}</View>
    </View>
  );
});

/**
 * A raised row inside the lobby sheet.
 *
 * The icon sits in a RECESSED FILL with a hairline, not an inset shadow pair.
 * The artboard draws the pair, but at 38px only the dark half of it survives on
 * a dark ground — the light half is 3.2% alpha — and the well reads as a smudge
 * rather than as a recess. Same rule as the auth fields.
 */
const LobbyRow = memo(function LobbyRow({
  icon: Icon,
  label,
  state,
  on = false,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  /** The right-hand chip. Absent means this row navigates instead of toggling. */
  state?: string;
  /** Accent the chip: this control is live right now. */
  on?: boolean;
  onPress: () => void;
}) {
  const C = useColors();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={state ? `${label}. ${state}` : label}
      accessibilityState={state ? { checked: on } : undefined}
      onPress={onPress}
      style={({ pressed }) => [
        styles.lobbyRow,
        { backgroundColor: pressed ? C.surface2 : C.surface },
        raised(C),
      ]}>
      <View style={[styles.lobbyWell, { backgroundColor: C.bgRecessed, borderColor: C.rule }]}>
        <Icon size={17} strokeWidth={2} color={on ? C.liveText : C.ink2} />
      </View>

      <Text numberOfLines={1} style={[styles.lobbyLabel, { color: C.ink }]}>
        {label}
      </Text>

      {state ? (
        <View
          style={[
            styles.lobbyChip,
            on
              ? { backgroundColor: C.live, borderColor: C.live }
              : { backgroundColor: C.chip, borderColor: C.rule },
          ]}>
          <Text style={[styles.lobbyChipLabel, { color: on ? C.onLive : C.ink3 }]}>{state}</Text>
        </View>
      ) : (
        <ChevronRight size={17} strokeWidth={2} color={C.ink3} />
      )}
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
      <View
        style={[
          styles.stripTile,
          playing
            ? { backgroundColor: C.live, borderColor: C.live }
            : { backgroundColor: C.bgRecessed, borderColor: C.rule },
        ]}>
        <Text style={[styles.stripInitial, { color: playing ? C.onLive : C.ink3 }]}>
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

  // -------------------------------------------------------------- actions
  filledAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm - 2,
    minHeight: TOUCH_TARGET,
    paddingHorizontal: Space.lg,
    borderRadius: Radii.sm,
  },
  filledActionLabel: {
    fontFamily: Fonts.semibold,
    fontSize: 13,
    letterSpacing: tracking(13, 0.02),
  },
  quietAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm - 2,
    minHeight: TOUCH_TARGET,
    paddingHorizontal: Space.lg,
    borderRadius: Radii.sm,
    borderWidth: Rule.hair,
  },
  quietActionLabel: {
    fontFamily: Fonts.semibold,
    fontSize: 13,
    letterSpacing: tracking(13, 0.02),
  },
  errorSlot: {
    paddingHorizontal: GUTTER,
    paddingTop: Space.xxl,
  },
  errorActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm + 2,
  },

  // --------------------------------------------------------- queue prompt
  prompt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    marginHorizontal: Space.lg + 2,
    marginBottom: Space.md,
    padding: Space.md + 1,
    borderRadius: Radii.lg,
  },
  promptMeta: {
    flex: 1,
    minWidth: 0,
  },
  promptKicker: {
    ...Type.label(10),
    letterSpacing: tracking(10, 0.14),
  },
  promptTitle: {
    fontFamily: Fonts.extrabold,
    fontSize: 14.5,
    letterSpacing: tracking(14.5, -0.01),
    marginTop: 2,
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
  faceSkeleton: {
    borderRadius: Radii.xs,
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
    paddingHorizontal: Space.lg + 2,
    paddingBottom: Space.xxl,
    gap: Space.lg,
  },
  lobbyGroup: {
    gap: Space.sm,
  },
  lobbyGroupLabel: {
    ...Type.label(10),
    letterSpacing: tracking(10, 0.14),
    paddingLeft: Space.xs,
  },
  lobbyGroupRows: {
    gap: Space.sm + 1,
  },
  lobbyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md + 2,
    minHeight: TOUCH_TARGET + Space.md,
    padding: Space.md,
    borderRadius: Radii.lg,
  },
  lobbyWell: {
    width: 38,
    height: 38,
    flexGrow: 0,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.sm,
    borderWidth: Rule.hair,
  },
  lobbyLabel: {
    flex: 1,
    minWidth: 0,
    fontFamily: Fonts.extrabold,
    fontSize: 14.5,
    letterSpacing: tracking(14.5, -0.005),
  },
  lobbyChip: {
    flexGrow: 0,
    flexShrink: 0,
    minWidth: 52,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Space.sm + 2,
    paddingVertical: Space.xs + 2,
    borderRadius: Radii.sm,
    borderWidth: Rule.hair,
  },
  lobbyChipLabel: {
    ...Type.label(9.5),
    letterSpacing: tracking(9.5, 0.1),
  },
  leave: {
    marginTop: Space.xs,
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
  /**
   * No outer margin: this is the queue list's header, and that list already
   * carries the gutter and the 9px gap between its cards.
   */
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    padding: Space.md - 1,
    borderRadius: Radii.button,
  },
  stripTile: {
    width: 44,
    height: 44,
    flexGrow: 0,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    borderWidth: Rule.hair,
  },
  stripInitial: {
    ...readout(16),
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
    ...readout(11),
    letterSpacing: tracking(11, 0.04),
    marginTop: 2,
  },
});
