/**
 * The Session. This is the party.
 *
 * Structural rule that must not be broken: `<YouTubePlayerHost />` is mounted
 * exactly once, here, and stays mounted for as long as the room is open — even
 * when the active provider is Spotify. A listener whose Spotify device dies
 * mid-Session falls back to YouTube by re-pointing the adapter, and a remount
 * at that moment would mean a black WebView booting from scratch instead of
 * audio resuming in the next second.
 *
 * This screen owns the two screen-wide signature layers of the direction — the
 * bloom bleeding off the top edge, and the 25px hairline grid — so that every
 * panel below them sits *over* the atmosphere and tints against it. It draws
 * its own shell rather than using `Screen`, because both layers have to run
 * behind the header and out to the physical edges, and because the Session
 * header is a mono lounge name and a live count, not a serif screen title.
 */

import { router, useLocalSearchParams } from 'expo-router';
import { ChevronDown, ChevronLeft, ChevronUp, Plus, Radio } from 'lucide-react-native';
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  BackHandler,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AddTrackSheet } from '@/components/room/add-track-sheet';
import { NowPlaying } from '@/components/room/now-playing';
import { ParticipantStrip } from '@/components/room/participant-strip';
import { QueueList } from '@/components/room/queue-list';
import { TransportControls } from '@/components/room/transport-controls';
import { EmptyState, LivePulse, Skeleton, useToast } from '@/components/ui';
import { RoomChat, useMessages } from '@/features/chat';
import {
  useLounge,
  useQueue,
  useRequestAux,
  useRoomParticipants,
  useTransport,
} from '@/features/rooms/queries';
import { useRoomSync } from '@/features/rooms/use-room-sync';
import {
  Bloom,
  Colors,
  PointerEvents,
  Radius,
  Space,
  TOUCH_TARGET,
  Type,
} from '@/lib/theme';
import { usePlayback } from '@/playback/store';
import { YouTubePlayerHost } from '@/playback/youtube-player-host';

/** How long the "Requested" latch holds before the guest may ask again. */
const REQUEST_COOLDOWN_MS = 60_000;

/** The artboard's gutter. Wider than the app default — the Session breathes. */
const GUTTER = Space.xl;

// ------------------------------------------------------------------ the grid

/** Signature element 3: a 25px hairline grid, on Session and Feed only. */
const GRID_STEP = 25;

// ----------------------------------------------------------------- the bloom

/**
 * Signature element 1. React Native has no blur filter and no radial gradient,
 * so the soft falloff is faked with concentric translucent circles — siblings,
 * not children, because nested opacity multiplies and would extinguish the
 * stack. Accumulated alpha at the centre lands at ~0.41, which is the artboard's
 * `rgba(199,127,168,.40)` core.
 *
 * Bloom colours are decorative by contract. They never carry meaning; they are
 * why every Session looks slightly different.
 */
const BLOOM_HEIGHT = 420;

const BLOOM_STOPS: readonly { size: number; color: string; opacity: number }[] = [
  { size: 460, color: Bloom.c, opacity: 0.05 },
  { size: 400, color: Bloom.c, opacity: 0.06 },
  { size: 344, color: Bloom.b, opacity: 0.07 },
  { size: 288, color: Bloom.b, opacity: 0.08 },
  { size: 232, color: Bloom.a, opacity: 0.08 },
  { size: 176, color: Bloom.a, opacity: 0.09 },
  { size: 120, color: Bloom.a, opacity: 0.1 },
];

/** Built once at module scope so a re-render never reallocates 7 style objects. */
const BLOOM_LAYER_STYLES: ViewStyle[] = BLOOM_STOPS.map((stop) => ({
  position: 'absolute',
  top: (BLOOM_HEIGHT - stop.size) / 2,
  left: '50%',
  marginLeft: -stop.size / 2,
  width: stop.size,
  height: stop.size,
  borderRadius: stop.size / 2,
  backgroundColor: stop.color,
  opacity: stop.opacity,
}));

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

  const [tab, setTab] = useState<'queue' | 'chat'>('queue');
  const [expanded, setExpanded] = useState(false);
  const [addVisible, setAddVisible] = useState(false);
  const [requestSent, setRequestSent] = useState(false);
  const requestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (requestTimer.current) clearTimeout(requestTimer.current);
    },
    []
  );

  /**
   * Android hardware back. The expanded list is a layer the user opened, so it
   * is what back should close — falling straight out of the Session would be a
   * surprise, and it would stop the music for them.
   */
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      // The add-track modal owns its own back handling via onRequestClose.
      if (addVisible) return false;
      if (expanded) {
        setExpanded(false);
        return true;
      }
      return false;
    });

    return () => subscription.remove();
  }, [addVisible, expanded]);

  const queueLength = queue.data?.length ?? 0;
  const participantCount = participants.data?.length ?? 0;
  const hostName =
    participants.data?.find((person) => person.userId === room?.host_id)?.displayName ?? null;

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

  /** There is no previous track in a forward-only queue; this restarts this one. */
  const handleRestart = useCallback(() => {
    transport.seek.mutate(0);
  }, [transport]);

  const handleRequestAux = useCallback(() => {
    requestAux.mutate(undefined, {
      onSuccess: () => {
        setRequestSent(true);
        toast.show('Asked for the aux in chat', 'success');
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

  const openAdd = useCallback(() => setAddVisible(true), []);
  const closeAdd = useCallback(() => setAddVisible(false), []);

  /**
   * Chat gets the screen when you switch to it — a message log in the ~140px the
   * fixed layout leaves over is not a chat, it is a peephole. The chevron still
   * overrides in both directions.
   */
  const showQueue = useCallback(() => {
    setTab('queue');
    setExpanded(false);
  }, []);

  const showChat = useCallback(() => {
    setTab('chat');
    setExpanded(true);
  }, []);

  const toggleExpanded = useCallback(() => setExpanded((value) => !value), []);

  /**
   * Created once per render but always at the same position in the tree, in
   * both the expanded and compact layouts, so React reconciles rather than
   * remounts it. See the file header.
   */
  const media = useMemo(
    () => <YouTubePlayerHost visible={provider === 'youtube' && !expanded} />,
    [provider, expanded]
  );

  if (error && !room) {
    return (
      <Shell>
        <Header
          name={lounge.data?.name ?? 'Session'}
          count={0}
          onBack={handleBack}
          showCount={false}
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

  return (
    <Shell>
      <Header
        name={lounge.data?.name ?? room?.name ?? 'Session'}
        count={participantCount}
        onBack={handleBack}
        showCount
      />

      <View style={styles.body}>
        <View style={styles.stageSlot}>
          <NowPlaying
            media={media}
            showMedia={provider === 'youtube' && !expanded}
            compact={expanded}
            track={track}
            timeline={timeline}
            isLoading={isLoading}
            driftMs={driftMs}
            onResync={resync}
            onSeek={isHost ? handleSeek : undefined}
            errorMessage={playbackError?.message ?? null}
            onAuxName={hostName}
          />
        </View>

        <View style={styles.transportSlot}>
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
            onRestart={isHost ? handleRestart : undefined}
          />
        </View>

        {expanded ? null : (
          <View style={styles.peopleSlot}>
            <ParticipantStrip
              roomId={roomId}
              hostId={room?.host_id ?? null}
              currentUserId={userId}
            />
          </View>
        )}

        <View style={styles.tabsRow}>
          <MonoTab label={`Queue/${queueLength}`} active={tab === 'queue'} onPress={showQueue} />
          <ChatTab
            loungeId={room?.lounge_id ?? null}
            roomId={room?.id ?? null}
            active={tab === 'chat'}
            onPress={showChat}
          />

          <View style={styles.tabsSpacer} />

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={expanded ? 'Show the player' : 'Give this list the screen'}
            accessibilityState={{ expanded }}
            onPress={toggleExpanded}
            style={({ pressed }) => [styles.expandButton, pressed && styles.pressed]}>
            {expanded ? (
              <ChevronDown size={20} strokeWidth={1.6} color={Colors.muted} />
            ) : (
              <ChevronUp size={20} strokeWidth={1.6} color={Colors.muted} />
            )}
          </Pressable>
        </View>

        <View style={styles.listSlot}>
          {tab === 'queue' ? (
            <QueueList roomId={roomId} isHost={isHost} currentUserId={userId} onAddTrack={openAdd} />
          ) : room ? (
            <RoomChat roomId={room.id} loungeId={room.lounge_id} bottomInset={insets.bottom} />
          ) : (
            <View style={styles.chatSkeleton}>
              <Skeleton width="80%" height={44} radius={Radius.md} />
              <Skeleton width="60%" height={44} radius={Radius.md} />
              <Skeleton width="72%" height={44} radius={Radius.md} />
            </View>
          )}
        </View>

        {tab === 'queue' ? (
          <View style={[styles.addSlot, { paddingBottom: insets.bottom + Space.lg }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add a track to the queue"
              onPress={openAdd}
              style={({ pressed }) => [styles.addPill, pressed && styles.pressed]}>
              <Plus size={17} strokeWidth={1.8} color={Colors.accent} />
              <Text style={styles.addLabel}>Add to queue</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      <AddTrackSheet roomId={roomId} visible={addVisible} onClose={closeAdd} />
    </Shell>
  );
}

// ------------------------------------------------------------------- shell

/** Ground, bloom, grid, safe area. Everything else sits on top of these four. */
function Shell({ children }: { children: ReactNode }) {
  return (
    <View style={styles.root}>
      <BloomLayer />
      <GridLayer />
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.safe}>
        <View style={styles.constrain}>{children}</View>
      </SafeAreaView>
    </View>
  );
}

const BloomLayer = memo(function BloomLayer() {
  const reduced = useReducedMotion();
  const breath = useSharedValue(0);

  useEffect(() => {
    if (reduced) {
      breath.value = 0;
      return;
    }
    // 3.6s: ambient, like a room light, not a micro-interaction.
    breath.value = withRepeat(
      withTiming(1, { duration: 3600, easing: Easing.inOut(Easing.quad) }),
      -1,
      true
    );
    return () => cancelAnimation(breath);
  }, [reduced, breath]);

  const style = useAnimatedStyle(() => ({ opacity: 0.82 + breath.value * 0.18 }));

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.bloom, style, PointerEvents.none]}>
      {BLOOM_LAYER_STYLES.map((layer, index) => (
        <View key={index} style={layer} />
      ))}
    </Animated.View>
  );
});

const GridLayer = memo(function GridLayer() {
  const { width, height } = useWindowDimensions();

  const lines = useMemo(() => {
    const columns = Math.ceil(width / GRID_STEP);
    const rows = Math.ceil(height / GRID_STEP);
    return {
      columns: Array.from({ length: columns }, (_, index) => index * GRID_STEP),
      rows: Array.from({ length: rows }, (_, index) => index * GRID_STEP),
    };
  }, [width, height]);

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, PointerEvents.none]}>
      {lines.columns.map((left) => (
        <View key={`c${left}`} style={[styles.gridColumn, { left }]} />
      ))}
      {lines.rows.map((top) => (
        <View key={`r${top}`} style={[styles.gridRow, { top }]} />
      ))}
    </View>
  );
});

// ------------------------------------------------------------------ header

type HeaderProps = {
  name: string;
  count: number;
  onBack: () => void;
  showCount: boolean;
};

const Header = memo(function Header({ name, count, onBack, showCount }: HeaderProps) {
  return (
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Go back"
        onPress={onBack}
        style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
        <ChevronLeft size={20} strokeWidth={1.6} color={Colors.muted} />
      </Pressable>

      <Text numberOfLines={1} style={styles.loungeName}>
        {name}
      </Text>

      <View style={styles.tabsSpacer} />

      {showCount ? <ListeningPill count={count} /> : null}
    </View>
  );
});

/**
 * `Colors.accent` earns its place here: the pill says this room is live and
 * joinable, which is the only thing the colour is allowed to mean.
 */
const ListeningPill = memo(function ListeningPill({ count }: { count: number }) {
  return (
    <View
      accessible
      accessibilityLabel={`${count} ${count === 1 ? 'person' : 'people'} listening`}
      style={styles.pill}>
      <View style={[StyleSheet.absoluteFill, styles.pillFill, PointerEvents.none]} />
      <LivePulse size={6} />
      <Text style={styles.pillText}>{`${count} listening`}</Text>
    </View>
  );
});

// -------------------------------------------------------------------- tabs

type MonoTabProps = { label: string; active: boolean; onPress: () => void };

/**
 * Signature element 4 as an affordance: the tab label *is* the count, in mono,
 * and the active rule is the playhead line continued underneath it.
 */
const MonoTab = memo(function MonoTab({ label, active, onPress }: MonoTabProps) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.tab, pressed && styles.pressed]}>
      <Text style={[styles.tabLabel, active ? styles.tabLabelActive : null]}>{label}</Text>
      <View style={[styles.tabRule, active ? styles.tabRuleActive : null]} />
    </Pressable>
  );
});

type ChatTabProps = {
  loungeId: string | null;
  roomId: string | null;
  active: boolean;
  onPress: () => void;
};

/**
 * The chat log is paginated, so the honest count is "how many we hold" — a `+`
 * marks the pages we have not fetched rather than quietly under-reporting.
 */
const ChatTab = memo(function ChatTab({ loungeId, roomId, active, onPress }: ChatTabProps) {
  const { messages, hasNextPage } = useMessages({ loungeId: loungeId ?? '', roomId });
  const count = messages.length;
  const label = count === 0 ? 'Chat' : `Chat/${count}${hasNextPage ? '+' : ''}`;

  return <MonoTab label={label} active={active} onPress={onPress} />;
});

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  safe: {
    flex: 1,
  },
  /**
   * react-native-web has no phone to constrain it, so an unbounded column
   * stretches to the full window width and the line length becomes unreadable.
   */
  constrain: {
    flex: 1,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
  },
  gutter: {
    paddingHorizontal: GUTTER,
  },

  // ------------------------------------------------------------ atmosphere
  bloom: {
    position: 'absolute',
    // Bleeds up off the top of the screen, as the artboard.
    top: -110,
    left: 0,
    right: 0,
    height: BLOOM_HEIGHT,
  },
  gridColumn: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: Colors.grid,
  },
  gridRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: Colors.grid,
  },

  // ---------------------------------------------------------------- header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm + 2,
    minHeight: TOUCH_TARGET,
    paddingTop: GUTTER,
    paddingHorizontal: GUTTER,
  },
  back: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    // Pulls the optical centre of the chevron back onto the gutter line.
    marginLeft: -Space.md,
    marginRight: -Space.md,
  },
  loungeName: {
    ...Type.mono,
    color: Colors.muted,
    flexShrink: 1,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    paddingLeft: Space.xs,
    paddingRight: Space.md - 2,
    paddingVertical: Space.xs + 1,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.accentDim,
    overflow: 'hidden',
  },
  /** Accent at 14%, painted as its own layer so the label stays full strength. */
  pillFill: {
    backgroundColor: Colors.accent,
    opacity: 0.14,
  },
  pillText: {
    ...Type.monoLabel,
    color: Colors.accent,
  },

  // ------------------------------------------------------------------ body
  body: {
    flex: 1,
  },
  /*
    Vertical rhythm is the artboard's, pulled in one step at each seam: the
    artboard is an 812px frame that reserves nothing for the status bar or the
    home indicator, and on a real phone those two cost ~60px. Trimming the gaps
    is cheaper than trimming the waveform or the participant list, which are the
    two things this screen exists to show.
  */
  stageSlot: {
    paddingHorizontal: GUTTER,
    paddingTop: Space.lg,
  },
  transportSlot: {
    paddingHorizontal: GUTTER,
    paddingTop: Space.md,
  },
  peopleSlot: {
    paddingHorizontal: GUTTER,
    paddingTop: Space.xl,
  },

  // ------------------------------------------------------------------ tabs
  tabsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: Space.xxl - 2,
    marginTop: Space.lg,
    paddingHorizontal: GUTTER,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  tabsSpacer: {
    flex: 1,
  },
  tab: {
    minHeight: TOUCH_TARGET,
    justifyContent: 'center',
    paddingTop: Space.md + 2,
  },
  tabLabel: {
    ...Type.mono,
    // Not Colors.faint: an inactive tab is still a control someone has to read.
    color: Colors.muted,
    textTransform: 'uppercase',
    paddingBottom: Space.sm,
  },
  tabLabelActive: {
    color: Colors.text,
  },
  tabRule: {
    height: 1,
    backgroundColor: 'transparent',
  },
  /** The playhead, continued under whichever list you are looking at. */
  tabRuleActive: {
    backgroundColor: Colors.accent,
  },
  expandButton: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -Space.md,
  },

  // ------------------------------------------------------------------ list
  /*
    Basis 0 and grow 1: the list takes whatever the fixed blocks above it leave
    over and scrolls inside that, so nothing on this screen can ever be pushed
    off the bottom edge. The chevron in the tab row hands it the whole screen.
  */
  listSlot: {
    flex: 1,
    paddingHorizontal: GUTTER,
  },
  chatSkeleton: {
    gap: Space.md,
    paddingTop: Space.lg,
  },
  addSlot: {
    paddingHorizontal: GUTTER,
    paddingTop: Space.md,
  },
  addPill: {
    minHeight: TOUCH_TARGET + 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.sm + 1,
    borderRadius: Radius.pill,
    backgroundColor: Colors.glass,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  addLabel: {
    ...Type.label,
    color: Colors.text,
  },
  pressed: {
    opacity: 0.6,
  },
});
