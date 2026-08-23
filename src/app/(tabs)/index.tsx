/**
 * The Feed — live "who is listening to what" across every lounge I am in.
 *
 * design/v2 "Feed": a masthead with the live mark, one raised hero card for the
 * Session you can walk into (artwork, waveform, timecode, Join), then the
 * LISTENING NOW list — raised cards for the people in a Session, flat rows for
 * the people who are merely online.
 *
 * Everything here is push-driven: the rows arrive over Realtime presence, and
 * the only queries are the two slow-moving lists behind them (my lounges, my
 * Sessions). Rows are filtered to lounges I am actually a member of, which
 * falls out of `useMyLounges` driving both the subscription and the list.
 */

import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Mail, Play } from 'lucide-react-native';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type ListRenderItemInfo,
  type TextStyle,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { LiveDot } from '@/components/feed/live-dot';
import {
  NowPlayingCard,
  glyphFor,
  timecode,
  useFeedClock,
} from '@/components/feed/now-playing-card';
import { AuxButton, Screen, Skeleton } from '@/components/ui';
import { useTotalUnread } from '@/features/dm/queries';
import { livePositionMs } from '@/features/presence/presence-client';
import {
  useBroadcastPresence,
  type LocalNowPlaying,
  type PresenceIdentity,
} from '@/features/presence/use-broadcast-presence';
import {
  MY_LOUNGES_KEY,
  useLoungePresence,
  useMyLounges,
  type FeedEntry,
  type LoungeRef,
} from '@/features/presence/use-lounge-presence';
import { useAuth } from '@/lib/auth';
import { syncClock } from '@/lib/clock';
import { supabase } from '@/lib/supabase';
import {
  Duration,
  Fonts,
  Radii,
  Space,
  TOUCH_TARGET,
  Type,
  dropped,
  glowShadow,
  raised,
  raisedLarge,
  tracking,
} from '@/lib/theme';
import { useColors } from '@/lib/theme-context';
import { usePlayback } from '@/playback/store';
import { expectedPositionMs, type RoomTimeline } from '@/playback/sync-controller';

const MY_SESSIONS_KEY = 'my-sessions';
const SKELETON_ROWS = [0, 1, 2];

/** design/v2: 24 at the masthead, 20 around the hero card, 14 around the rows. */
const GUTTER = 24;
const CARD_GUTTER = 20;
const ROW_GUTTER = 14;

/** Clears the floating dock without leaving a hole under the last row. */
const LIST_TAIL = 48;

const ART = 78;
const TILE = 52;

/** The 32-bar waveform, exact from the design. Percentages of the 30px band. */
const BARS = [
  28, 48, 34, 64, 40, 76, 52, 30, 58, 92, 44, 36, 68, 54, 32, 56, 100, 38, 66, 48, 26, 44, 72, 54,
  82, 34, 60, 46, 78, 30, 52, 68,
];

/** `Type.readout` hands back a readonly tuple; TextStyle wants a mutable one. */
const readout = (size: number): TextStyle => ({
  ...Type.readout(size),
  fontVariant: ['tabular-nums'],
});

/** A live Session I am already a participant in. */
type ActiveSession = {
  roomId: string;
  name: string;
  loungeId: string;
  timeline: RoomTimeline;
  track: { title: string; artist: string; artworkUrl: string | null; durationMs: number } | null;
};

/**
 * The Sessions I am in, with enough of the room row to reconstruct its
 * playback timeline.
 *
 * Three queries rather than one embedded select, for the same reason as
 * `useMyLounges`: the hand-authored `Database` type declares no relationships,
 * so PostgREST embeds will not typecheck against it.
 */
function useMySessions(userId: string | null | undefined): UseQueryResult<ActiveSession[]> {
  return useQuery({
    queryKey: [MY_SESSIONS_KEY, userId ?? null],
    enabled: Boolean(userId),
    queryFn: async (): Promise<ActiveSession[]> => {
      if (!userId) return [];

      const participation = await supabase
        .from('room_participants')
        .select('room_id')
        .eq('user_id', userId);
      if (participation.error) throw participation.error;

      const roomIds = (participation.data ?? []).map((row) => row.room_id);
      if (roomIds.length === 0) return [];

      const rooms = await supabase
        .from('rooms')
        .select('id, name, lounge_id, track_id, started_at_ms, paused_at_ms, is_playing')
        .in('id', roomIds)
        .eq('is_active', true);
      if (rooms.error) throw rooms.error;

      const rows = rooms.data ?? [];
      const trackIds = rows.map((row) => row.track_id).filter((id): id is string => id !== null);

      const tracks = trackIds.length
        ? await supabase
            .from('tracks')
            .select('id, title, artist, artwork_url, duration_ms')
            .in('id', trackIds)
        : null;
      if (tracks?.error) throw tracks.error;

      const trackById = new Map((tracks?.data ?? []).map((track) => [track.id, track]));

      return rows.map((row) => {
        const track = row.track_id === null ? undefined : trackById.get(row.track_id);
        return {
          roomId: row.id,
          name: row.name,
          loungeId: row.lounge_id,
          timeline: {
            trackId: row.track_id,
            startedAtMs: row.started_at_ms,
            pausedAtMs: row.paused_at_ms,
            isPlaying: row.is_playing,
          },
          track: track
            ? {
                title: track.title,
                artist: track.artist,
                artworkUrl: track.artwork_url,
                durationMs: track.duration_ms,
              }
            : null,
        };
      });
    },
  });
}

// ------------------------------------------------------------------- the hero

/**
 * What the hero card is showing.
 *
 * `mine` is a Session I am already inside — the card becomes the way back into
 * it, and the readout reports my own sync rather than a head count. `join` is
 * somebody else's, reconstructed entirely from their presence beat.
 */
type Hero =
  | {
      kind: 'mine';
      roomId: string;
      loungeId: string;
      loungeName: string;
      who: string;
      title: string;
      artist: string;
      artworkUrl: string | null;
      durationMs: number;
      timeline: RoomTimeline;
    }
  | {
      kind: 'join';
      roomId: string;
      loungeId: string;
      loungeName: string;
      who: string;
      title: string;
      artist: string;
      artworkUrl: string | null;
      durationMs: number;
      entry: FeedEntry;
    };

/**
 * The 32-bar waveform, drawn twice: once in `track` for the whole band and once
 * in `ink` inside a clip that is as wide as the progress. That is the design's
 * `clip-path` — React Native has none, so the clip is a measured box with
 * `overflow: hidden` and a full-width row inside it.
 *
 * Memoised on colour alone, so the 64 bars are laid out once and only the clip
 * box moves on each 250ms tick.
 */
const Bars = memo(function Bars({ color }: { color: string }) {
  return (
    <>
      {BARS.map((height, i) => (
        <View
          key={`${i}-${height}`}
          style={[styles.bar, { height: `${height}%`, backgroundColor: color }]}
        />
      ))}
    </>
  );
});

function Waveform({ progress }: { progress: number }) {
  const C = useColors();
  const [width, setWidth] = useState(0);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const next = e.nativeEvent.layout.width;
    setWidth((prev) => (prev === next ? prev : next));
  }, []);

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.wave}
      onLayout={onLayout}>
      <Bars color={C.track} />

      <View style={[styles.waveClip, { width: width * progress }]}>
        <View style={[styles.waveInner, { width }]}>
          <Bars color={C.ink} />
        </View>
      </View>
    </View>
  );
}

/** The one filled action on the screen. Reserved for walking into a Session. */
function HeroActions({
  primary,
  onPrimary,
  secondary,
  onSecondary,
}: {
  primary: string;
  onPrimary: () => void;
  secondary: string;
  onSecondary: () => void;
}) {
  const C = useColors();

  return (
    <View style={styles.actions}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={primary}
        onPress={onPrimary}
        style={({ pressed }) => [
          styles.primary,
          { backgroundColor: C.pill },
          dropped(C, 'md'),
          pressed && styles.pressed,
        ]}>
        <Play size={16} strokeWidth={2.5} color={C.pillInk} fill={C.pillInk} />
        <Text numberOfLines={1} style={[styles.primaryLabel, { color: C.pillInk }]}>
          {primary}
        </Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${secondary}`}
        onPress={onSecondary}
        style={({ pressed }) => [
          styles.secondary,
          { backgroundColor: C.surface2 },
          raised(C),
          pressed && styles.pressed,
        ]}>
        <Text numberOfLines={1} style={[styles.secondaryLabel, { color: C.ink2 }]}>
          {secondary}
        </Text>
      </Pressable>
    </View>
  );
}

function HeroCard({
  hero,
  listeners,
  onOpenRoom,
  onOpenLounge,
}: {
  hero: Hero;
  listeners: number;
  onOpenRoom: (roomId: string) => void;
  onOpenLounge: (loungeId: string) => void;
}) {
  const C = useColors();
  const nowMs = useFeedClock();
  const driftMs = usePlayback((state) => state.driftMs);
  const isSynced = usePlayback((state) => state.isSynced);

  /*
    `expectedPositionMs` measures from the room's start stamp and keeps counting
    past the end of the track — the room row simply has not been advanced yet —
    so the readout is clamped to the duration rather than reporting 9:31 of a
    3:12 song. `livePositionMs` already clamps itself.
  */
  const raw =
    hero.kind === 'mine'
      ? expectedPositionMs(hero.timeline, nowMs)
      : livePositionMs(hero.entry, nowMs);

  const positionMs = hero.durationMs > 0 ? Math.min(hero.durationMs, Math.max(0, raw)) : 0;
  const progress = hero.durationMs > 0 ? positionMs / hero.durationMs : 0;

  /*
    The centre readout is the only place the two kinds diverge in meaning: my
    own Session can report the sync the controller is actually measuring, while
    somebody else's can only honestly report how many of my lounge-mates are in
    it.
  */
  const centre =
    hero.kind === 'mine'
      ? isSynced
        ? 'IN SYNC'
        : `${driftMs > 0 ? '+' : ''}${Math.round(driftMs)}MS`
      : `${listeners} LISTENING`;

  return (
    <View style={[styles.hero, { backgroundColor: C.surface }, raisedLarge(C)]}>
      <View style={styles.heroTop}>
        <View style={[styles.art, { backgroundColor: C.artwork }, glowShadow(C.glow, 30)]}>
          <Text style={[styles.artGlyph, { color: C.artInk }]}>{glyphFor(hero.title)}</Text>

          {/* Over the glyph, so the letter doubles as the error fallback. */}
          {hero.artworkUrl ? (
            <Image
              source={{ uri: hero.artworkUrl }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              cachePolicy="memory-disk"
              transition={Duration.press}
              accessible={false}
            />
          ) : null}
        </View>

        <View style={styles.heroInfo}>
          <Text numberOfLines={1} style={[styles.heroKicker, { color: C.ink3 }]}>
            {`${hero.loungeName} · on aux · ${hero.who}`}
          </Text>
          <Text numberOfLines={1} style={[styles.heroTitle, { color: C.ink }]}>
            {hero.title}
          </Text>
          <Text numberOfLines={1} style={[styles.heroArtist, { color: C.ink2 }]}>
            {hero.artist}
          </Text>
        </View>
      </View>

      <Waveform progress={progress} />

      <View style={styles.readout}>
        <Text style={[styles.readoutSide, { color: C.ink2 }]}>{timecode(positionMs)}</Text>
        <Text style={[styles.readoutCentre, { color: C.ink }]}>{centre}</Text>
        <Text style={[styles.readoutSide, { color: C.ink2 }]}>{timecode(hero.durationMs)}</Text>
      </View>

      <HeroActions
        primary={hero.kind === 'mine' ? 'Back to session' : 'Join session'}
        onPrimary={() => onOpenRoom(hero.roomId)}
        secondary={hero.loungeName}
        onSecondary={() => onOpenLounge(hero.loungeId)}
      />
    </View>
  );
}

// ------------------------------------------------------------------ list parts

const keyExtractor = (entry: FeedEntry) => entry.userId;

/**
 * Every module enters the same way: translateY(8) → 0 over 280ms on the
 * design's curve, and nothing at all when the OS asks for reduced motion.
 */
function useModuleEnter() {
  const reduced = useReducedMotion();
  const t = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (reduced) {
      t.value = 1;
      return;
    }
    t.value = withTiming(1, {
      duration: Duration.enter,
      easing: Easing.bezier(0.2, 0.8, 0.2, 1),
    });
  }, [reduced, t]);

  return useAnimatedStyle(() => ({
    opacity: t.value,
    transform: [{ translateY: (1 - t.value) * 8 }],
  }));
}

/** A raised card carrying one line and one action. Every non-happy path. */
function QuietCard({
  line,
  action,
}: {
  line: string;
  action: { label: string; onPress: () => void };
}) {
  const C = useColors();

  return (
    <View style={[styles.quiet, { backgroundColor: C.surface }, raised(C)]}>
      <Text style={[styles.quietLine, { color: C.ink2 }]}>{line}</Text>
      <AuxButton
        label={action.label}
        onPress={action.onPress}
        variant="cream"
        size="sm"
        align="center"
      />
    </View>
  );
}

/** Three rows of the real geometry, so nothing shifts when the data lands. */
function FeedSkeleton() {
  const C = useColors();

  return (
    <View style={styles.rows}>
      {SKELETON_ROWS.map((row) => (
        <View
          key={row}
          style={[styles.skeletonRow, { backgroundColor: C.surface }, raised(C)]}>
          <Skeleton width={TILE} height={TILE} />
          <View style={styles.skeletonInfo}>
            <Skeleton width="58%" height={13} />
            <Skeleton width="80%" height={11} />
          </View>
        </View>
      ))}
    </View>
  );
}

// ------------------------------------------------------------------ the screen

export default function FeedScreen() {
  const C = useColors();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const moduleStyle = useModuleEnter();
  const unread = useTotalUnread();

  const [refreshing, setRefreshing] = useState(false);

  const identity = useMemo<PresenceIdentity | null>(
    () =>
      profile
        ? {
            userId: profile.id,
            username: profile.username,
            displayName: profile.display_name,
            avatarUrl: profile.avatar_url,
            spotifyLinked: profile.spotify_linked,
          }
        : null,
    [profile]
  );

  const lounges = useMyLounges(profile?.id);
  const sessions = useMySessions(profile?.id);

  const loungeList = useMemo<LoungeRef[]>(() => lounges.data ?? [], [lounges.data]);
  const sessionList = useMemo<ActiveSession[]>(() => sessions.data ?? [], [sessions.data]);
  const loungeIds = useMemo(() => loungeList.map((lounge) => lounge.id), [loungeList]);
  const loungeNames = useMemo(
    () => new Map(loungeList.map((lounge) => [lounge.id, lounge.name])),
    [loungeList]
  );

  /**
   * What Aux is playing for me, read from the live playback store rather than
   * the Sessions query.
   *
   * The query is a snapshot taken when this screen mounted; the store is the
   * thing actually driving the speaker, so it flips the instant I join or leave
   * a Session instead of leaving my friends looking at a room I walked out of.
   */
  const playbackRoomId = usePlayback((state) => state.roomId);
  const playbackTrack = usePlayback((state) => state.track);
  const playbackTimeline = usePlayback((state) => state.timeline);
  const playbackProvider = usePlayback((state) => state.adapter?.provider ?? null);

  const localNowPlaying = useMemo<LocalNowPlaying | null>(() => {
    if (!playbackTrack || !playbackTimeline) return null;

    return {
      trackTitle: playbackTrack.title,
      artist: playbackTrack.artist,
      artworkUrl: playbackTrack.artwork_url,
      // The adapter that is actually producing sound, not what the profile says
      // it could be: a linked *free* account still routes to YouTube, and a
      // Spotify badge over YouTube audio is a lie the Feed cannot back up.
      provider: playbackProvider ?? 'youtube',
      durationMs: playbackTrack.duration_ms,
      roomId: playbackRoomId,
      timeline: playbackTimeline,
    };
  }, [playbackTrack, playbackTimeline, playbackProvider, playbackRoomId]);

  useBroadcastPresence(identity, loungeIds, localNowPlaying);

  // My own row is redundant: the hero card already says where I am, and a Feed
  // that leads with yourself is a mirror, not a party.
  const { entries, ready } = useLoungePresence(loungeList, profile?.id);

  const openRoom = useCallback(
    (roomId: string) => router.push({ pathname: '/room/[id]', params: { id: roomId } }),
    [router]
  );

  const openLounge = useCallback(
    (loungeId: string) => router.push({ pathname: '/lounge/[id]', params: { id: loungeId } }),
    [router]
  );

  const openMessages = useCallback(() => router.push('/messages'), [router]);
  const startSession = useCallback(() => router.push('/room/create'), [router]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      // The Feed itself is pushed over the socket and needs nothing. What can
      // go stale is the lounge and Session lists behind it, and the clock
      // offset every progress bar is measured against.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: MY_LOUNGES_KEY }),
        queryClient.invalidateQueries({ queryKey: [MY_SESSIONS_KEY] }),
        syncClock(),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [queryClient]);

  const showSkeleton = lounges.isPending || (!ready && !lounges.isError);

  /**
   * The head count on the hero is "people from your lounges who are in that
   * Session", which is the only one presence can honestly produce — the room's
   * own participant list is not on the socket.
   */
  const listenersByRoom = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of entries) {
      if (entry.roomId === null) continue;
      counts.set(entry.roomId, (counts.get(entry.roomId) ?? 0) + 1);
    }
    return counts;
  }, [entries]);

  const hero = useMemo<Hero | null>(() => {
    // A Session I am already inside wins the card: it becomes the way back in.
    const mine =
      (playbackRoomId ? sessionList.find((s) => s.roomId === playbackRoomId) : undefined) ??
      sessionList.find((s) => s.timeline.isPlaying) ??
      sessionList[0];

    if (mine) {
      const attached = playbackRoomId === mine.roomId;
      const track =
        attached && playbackTrack
          ? {
              title: playbackTrack.title,
              artist: playbackTrack.artist,
              artworkUrl: playbackTrack.artwork_url,
              durationMs: playbackTrack.duration_ms,
            }
          : mine.track;

      return {
        kind: 'mine',
        roomId: mine.roomId,
        loungeId: mine.loungeId,
        loungeName: loungeNames.get(mine.loungeId) ?? mine.name,
        who: 'you',
        title: track?.title ?? mine.name,
        artist: track?.artist ?? '',
        artworkUrl: track?.artworkUrl ?? null,
        durationMs: track?.durationMs ?? 0,
        timeline: attached && playbackTimeline ? playbackTimeline : mine.timeline,
      };
    }

    const joinable = entries.find((e) => e.roomId !== null && e.trackTitle !== null);
    if (!joinable || joinable.roomId === null) return null;

    return {
      kind: 'join',
      roomId: joinable.roomId,
      loungeId: joinable.loungeId,
      loungeName: joinable.loungeName,
      who: joinable.username,
      title: joinable.trackTitle ?? joinable.loungeName,
      artist: joinable.artist ?? '',
      artworkUrl: joinable.artworkUrl,
      durationMs: joinable.durationMs,
      entry: joinable,
    };
  }, [entries, loungeNames, playbackRoomId, playbackTimeline, playbackTrack, sessionList]);

  /**
   * Live cards first, then the flat rows — the design's two loops. The hero's
   * own person is dropped so the same beat is not drawn twice.
   */
  const rows = useMemo(() => {
    const heroUser = hero && hero.kind === 'join' ? hero.entry.userId : null;
    const visible = entries.filter((entry) => entry.userId !== heroUser);
    return [
      ...visible.filter((entry) => entry.roomId !== null),
      ...visible.filter((entry) => entry.roomId === null),
    ];
  }, [entries, hero]);

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<FeedEntry>) => (
      <NowPlayingCard entry={item} index={index} />
    ),
    []
  );

  const summary = useMemo(() => {
    if (lounges.isError) return 'Could not reach your lounges';
    if (showSkeleton) return 'Tuning in';
    if (loungeList.length === 0) return 'Join a lounge to fill this up';
    if (entries.length === 0) return 'Quiet right now';
    const live = entries.filter((entry) => entry.roomId !== null).length;
    return `${entries.length} online · ${live} on aux`;
  }, [entries, lounges.isError, loungeList.length, showSkeleton]);

  const header = useMemo(
    () => (
      <View>
        <View style={styles.masthead}>
          <View style={styles.mastheadText}>
            <View style={styles.liveRow}>
              <LiveDot size={7} />
              <Text style={[styles.liveLabel, { color: C.liveText }]}>Live now</Text>
            </View>
            <Text style={[styles.title, { color: C.ink }]}>The Feed</Text>
            <Text numberOfLines={1} style={[styles.summary, { color: C.ink2 }]}>
              {summary}
            </Text>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={unread > 0 ? `Messages, ${unread} unread` : 'Messages'}
            onPress={openMessages}
            style={({ pressed }) => [
              styles.iconTile,
              { backgroundColor: C.surface },
              raised(C),
              pressed && styles.pressed,
            ]}>
            <Mail size={18} strokeWidth={2} color={C.ink} />
            {unread > 0 ? (
              <View style={[styles.badge, { backgroundColor: C.live }]}>
                <Text style={[styles.badgeCount, { color: C.onLive }]}>
                  {unread > 99 ? '99+' : unread}
                </Text>
              </View>
            ) : null}
          </Pressable>
        </View>

        {hero ? (
          <HeroCard
            hero={hero}
            listeners={listenersByRoom.get(hero.roomId) ?? 1}
            onOpenRoom={openRoom}
            onOpenLounge={openLounge}
          />
        ) : null}

        {showSkeleton || rows.length > 0 ? (
          <Text style={[styles.sectionKicker, { color: C.ink3 }]}>Listening now</Text>
        ) : null}
      </View>
    ),
    [
      C,
      hero,
      listenersByRoom,
      openLounge,
      openMessages,
      openRoom,
      rows.length,
      showSkeleton,
      summary,
      unread,
    ]
  );

  /**
   * One card closes the list, and it only changes its words: there is no
   * separate "nothing here" screen to design.
   */
  const footer = useMemo(() => {
    if (showSkeleton) return null;

    if (lounges.isError) {
      return (
        <QuietCard
          line="Could not load your lounges."
          action={{ label: 'Try again', onPress: () => void onRefresh() }}
        />
      );
    }

    if (loungeList.length === 0) {
      return (
        <QuietCard
          line="You are not in a lounge yet."
          action={{ label: 'Find a lounge', onPress: () => router.push('/lounges') }}
        />
      );
    }

    if (hero || rows.length > 0) return null;

    return (
      <QuietCard
        line="Nobody is on right now."
        action={{ label: 'Start a session', onPress: startSession }}
      />
    );
  }, [hero, lounges.isError, loungeList.length, onRefresh, router, rows.length, showSkeleton, startSession]);

  return (
    <Screen padded={false}>
      <Animated.View style={[styles.flex, moduleStyle]}>
        <FlatList
          data={showSkeleton ? [] : rows}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          ListHeaderComponent={header}
          ListEmptyComponent={showSkeleton ? <FeedSkeleton /> : null}
          ListFooterComponent={footer}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void onRefresh()}
              tintColor={C.ink2}
              colors={[C.live]}
              progressBackgroundColor={C.surface}
            />
          }
        />
      </Animated.View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    paddingTop: 14,
    paddingBottom: LIST_TAIL,
    paddingHorizontal: ROW_GUTTER,
    flexGrow: 1,
  },
  pressed: {
    opacity: 0.7,
  },

  /* ------------------------------------------------------------- masthead */

  masthead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Space.md,
    paddingHorizontal: GUTTER - ROW_GUTTER,
  },
  mastheadText: {
    flex: 1,
    minWidth: 0,
  },
  liveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  liveLabel: {
    ...Type.label(10.5),
    letterSpacing: tracking(10.5, 0.15),
  },
  title: {
    ...Type.display(30),
    letterSpacing: tracking(30, -0.03),
    marginTop: 9,
  },
  summary: {
    ...Type.body(13.5),
    marginTop: 5,
  },
  iconTile: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    borderRadius: Radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 18,
    height: 18,
    borderRadius: Radii.pill,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeCount: {
    ...readout(10),
    lineHeight: 12,
  },

  /* ----------------------------------------------------------- hero card */

  hero: {
    marginTop: 22,
    marginHorizontal: CARD_GUTTER - ROW_GUTTER,
    padding: Space.lg,
    borderRadius: Radii.xl,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 15,
  },
  art: {
    width: ART,
    height: ART,
    borderRadius: Radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  artGlyph: {
    fontFamily: Fonts.extrabold,
    fontSize: 30,
    lineHeight: 34,
  },
  heroInfo: {
    flex: 1,
    minWidth: 0,
  },
  heroKicker: {
    ...Type.label(10.5),
    letterSpacing: tracking(10.5, 0.14),
  },
  heroTitle: {
    ...Type.display(21),
    letterSpacing: tracking(21, -0.025),
    marginTop: 5,
  },
  heroArtist: {
    ...Type.body(13),
    marginTop: 2,
  },

  wave: {
    height: 30,
    marginTop: Space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5.5,
    overflow: 'hidden',
  },
  waveClip: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    overflow: 'hidden',
  },
  waveInner: {
    height: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5.5,
  },
  bar: {
    flex: 1,
    minWidth: 0,
    borderRadius: 1,
  },

  readout: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 9,
  },
  readoutSide: {
    ...readout(11.5),
    fontFamily: Fonts.semibold,
  },
  readoutCentre: {
    ...readout(11.5),
  },

  actions: {
    flexDirection: 'row',
    gap: 11,
    marginTop: Space.lg,
  },
  primary: {
    flex: 1,
    height: 50,
    borderRadius: Radii.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  primaryLabel: {
    fontFamily: Fonts.semibold,
    fontSize: 14,
    lineHeight: 18,
  },
  secondary: {
    width: 118,
    height: 50,
    borderRadius: Radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Space.md,
  },
  secondaryLabel: {
    fontFamily: Fonts.regular,
    fontSize: 14,
    lineHeight: 18,
  },

  /* ---------------------------------------------------------- list parts */

  sectionKicker: {
    ...Type.label(10.5),
    letterSpacing: tracking(10.5, 0.15),
    paddingHorizontal: GUTTER - ROW_GUTTER,
    paddingTop: 26,
    paddingBottom: 10,
  },
  rows: {
    paddingTop: 26,
  },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ROW_GUTTER,
    padding: 10,
    borderRadius: Radii.lg,
    marginBottom: 9,
  },
  skeletonInfo: {
    flex: 1,
    gap: Space.sm,
  },

  quiet: {
    marginTop: 22,
    marginHorizontal: CARD_GUTTER - ROW_GUTTER,
    padding: Space.xl,
    borderRadius: Radii.xl,
    alignItems: 'flex-start',
    gap: Space.lg,
  },
  quietLine: {
    ...Type.body(14),
  },
});
