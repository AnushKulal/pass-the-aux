/**
 * The Feed — live "who is listening to what" across every lounge I am in.
 *
 * This is the screen that has to make the product legible in one glance, so
 * everything here is push-driven: the rows arrive over Realtime presence, and
 * the only queries are the two slow-moving lists behind them (my lounges, my
 * Sessions).
 *
 * Visually it is the direction's thesis statement: the bloom is tinted by the
 * artwork at the top of the list, the 25px grid runs under everything, every
 * number that measures is mono, and Colors.accent appears only where there is
 * a Session to walk into.
 */

import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Radio, Users, WifiOff } from 'lucide-react-native';
import { memo, useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
} from 'react-native';

import { BloomBackdrop, GridOverlay } from '@/components/atmosphere';
import { NowPlayingCard } from '@/components/feed/now-playing-card';
import { AuxButton, EmptyState, LivePulse, Screen, Skeleton } from '@/components/ui';
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
import { Colors, Radius, Space, TOUCH_TARGET, Type } from '@/lib/theme';
import { usePlayback } from '@/playback/store';
import type { RoomTimeline } from '@/playback/sync-controller';

const MY_SESSIONS_KEY = 'my-sessions';
const SKELETON_ROWS = [0, 1, 2, 3];

/** Matches the card: 38pt avatar, 54pt artwork. A skeleton that resizes on load is worse than none. */
const SKELETON_AVATAR = 38;
const SKELETON_ART = 54;

const SESSION_CHIP_WIDTH = 156;
const HEAD_DOT = 6;

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
      const trackIds = rows
        .map((row) => row.track_id)
        .filter((id): id is string => id !== null);

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

// ------------------------------------------------------------------- list parts

const keyExtractor = (entry: FeedEntry) => entry.userId;

const renderItem = ({ item }: ListRenderItemInfo<FeedEntry>) => <NowPlayingCard entry={item} />;

const Separator = () => <View style={styles.separator} />;

/**
 * The header readout. A count is a measurement, so it is mono — and the dot
 * beside it is `muted`, not `accent`: this counts everyone listening, including
 * the people nobody can join.
 */
const HeadCount = memo(function HeadCount({ count }: { count: number }) {
  return (
    <View style={styles.headCount}>
      <View style={styles.headDot} />
      <Text style={styles.headLabel}>{`${count} listening`}</Text>
    </View>
  );
});

function FeedSkeleton() {
  return (
    <View style={styles.skeletonList}>
      {SKELETON_ROWS.map((row) => (
        <View key={row} style={styles.skeletonRow}>
          <Skeleton width={SKELETON_AVATAR} height={SKELETON_AVATAR} radius={Radius.pill} />
          <Skeleton width={SKELETON_ART} height={SKELETON_ART} radius={Radius.md} />
          <View style={styles.skeletonText}>
            <Skeleton width="75%" height={16} />
            <Skeleton width="50%" height={12} />
          </View>
        </View>
      ))}
    </View>
  );
}

function SessionStrip({
  sessions,
  loungeNames,
  onOpen,
}: {
  sessions: ActiveSession[];
  loungeNames: Map<string, string>;
  onOpen: (roomId: string) => void;
}) {
  return (
    <View style={styles.strip}>
      <Text style={styles.eyebrow}>Your Sessions</Text>

      <FlatList
        horizontal
        data={sessions}
        keyExtractor={(session) => session.roomId}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.stripRow}
        renderItem={({ item }) => {
          const loungeName = loungeNames.get(item.loungeId) ?? 'Lounge';
          return (
            <Pressable
              onPress={() => onOpen(item.roomId)}
              accessibilityRole="button"
              accessibilityLabel={`Back to ${item.name} in ${loungeName}`}
              style={({ pressed }) => [styles.session, pressed && styles.sessionPressed]}>
              <View style={styles.sessionTop}>
                {item.timeline.isPlaying ? <LivePulse size={7} /> : null}
                <Text numberOfLines={1} style={styles.sessionName}>
                  {item.track?.title ?? item.name}
                </Text>
              </View>
              <Text numberOfLines={1} style={styles.sessionLounge}>
                {loungeName}
              </Text>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

/**
 * The rule above the list. The joinable count on the right is the only place
 * the screen explains its own colour: that number is green because those rows
 * are green, and both mean the same thing.
 */
const SectionRule = memo(function SectionRule({ joinable }: { joinable: number }) {
  return (
    <View style={styles.rule}>
      <Text style={styles.eyebrow}>Listening now</Text>
      {joinable > 0 ? (
        <Text style={styles.joinable}>{`${joinable} joinable`}</Text>
      ) : null}
    </View>
  );
});

// ------------------------------------------------------------------ the screen

export default function FeedScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { profile } = useAuth();

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
      // Spotify glyph over YouTube audio is a lie the Feed cannot back up.
      provider: playbackProvider ?? 'youtube',
      durationMs: playbackTrack.duration_ms,
      roomId: playbackRoomId,
      timeline: playbackTimeline,
    };
  }, [playbackTrack, playbackTimeline, playbackProvider, playbackRoomId]);

  useBroadcastPresence(identity, loungeIds, localNowPlaying);

  // My own row is redundant: the Sessions strip already says where I am, and a
  // Feed that leads with yourself is a mirror, not a party.
  const { entries, ready } = useLoungePresence(loungeList, profile?.id);

  const openRoom = useCallback(
    (roomId: string) => router.push({ pathname: '/room/[id]', params: { id: roomId } }),
    [router]
  );

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
  const hasRows = !showSkeleton && entries.length > 0;

  const joinable = useMemo(
    () => entries.reduce((total, entry) => total + (entry.roomId === null ? 0 : 1), 0),
    [entries]
  );

  /**
   * The bloom takes its hue from the row at the top of the list, so the screen
   * is lit by whatever is playing loudest right now. Keyed on the artwork URL
   * rather than the pixels: sampling a remote image would put a decode on the
   * Feed's critical path for a decorative gradient.
   */
  const bloomSeed = entries[0]?.artworkUrl ?? entries[0]?.userId ?? null;

  const header = useMemo(
    () => (
      <>
        {sessionList.length > 0 ? (
          <SessionStrip sessions={sessionList} loungeNames={loungeNames} onOpen={openRoom} />
        ) : null}
        {hasRows ? <SectionRule joinable={joinable} /> : null}
      </>
    ),
    [sessionList, loungeNames, openRoom, hasRows, joinable]
  );

  const empty = useMemo(() => {
    // Skeletons stand in for rows, so they start at the top where the rows
    // would be. A genuine empty state has nothing to stand in for and centres.
    if (showSkeleton) return <FeedSkeleton />;

    if (lounges.isError) {
      return (
        <View style={styles.emptyWrap}>
          <EmptyState
            icon={WifiOff}
            title="Could not load your lounges"
            description="Check your connection and pull down to try again."
            action={<AuxButton label="Try again" onPress={onRefresh} variant="ghost" size="sm" />}
          />
        </View>
      );
    }

    if (loungeList.length === 0) {
      return (
        <View style={styles.emptyWrap}>
          <EmptyState
            icon={Users}
            title="You are not in a lounge yet"
            description="Lounges are where the music happens. Join one and this feed fills itself."
            action={
              <AuxButton
                label="Find a lounge"
                onPress={() => router.push('/lounges')}
                variant="primary"
                size="sm"
              />
            }
          />
        </View>
      );
    }

    return (
      <View style={styles.emptyWrap}>
        <EmptyState
          icon={Radio}
          title="Nobody is listening yet"
          description="Start a Session and someone will join."
        />
      </View>
    );
  }, [showSkeleton, lounges.isError, loungeList.length, onRefresh, router]);

  return (
    <Screen title="Now playing" right={<HeadCount count={hasRows ? entries.length : 0} />}>
      {/* Atmosphere first, so every row paints over it. Both layers are
          non-interactive and bleed past the gutters on purpose; the grid sits
          on top of the bloom so the lattice stays legible through the glow. */}
      <BloomBackdrop seed={bloomSeed} intensity={hasRows ? 0.4 : 0.18} />
      <GridOverlay />

      <FlatList
        data={showSkeleton ? [] : entries}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ItemSeparatorComponent={Separator}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.muted}
            colors={[Colors.primary]}
            progressBackgroundColor={Colors.surface}
          />
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    // Horizontal gutter comes from Screen. flexGrow lets the empty state and
    // the skeleton list fill the viewport instead of hugging the header.
    paddingBottom: Space.xxl,
    flexGrow: 1,
  },
  separator: {
    height: Space.md,
  },
  emptyWrap: {
    flexGrow: 1,
    justifyContent: 'center',
  },

  headCount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    paddingHorizontal: Space.md,
    paddingVertical: Space.xs,
    borderRadius: Radius.pill,
    backgroundColor: Colors.glass,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  headDot: {
    width: HEAD_DOT,
    height: HEAD_DOT,
    borderRadius: Radius.pill,
    backgroundColor: Colors.muted,
  },
  headLabel: {
    ...Type.monoLabel,
    color: Colors.muted,
  },

  /*
    Colors.muted, not Colors.faint. The artboards set these eyebrows in the
    faint ink, but faint is a divider colour here and these are words people
    have to read; muted is the nearest tone that clears 4.5:1.
  */
  eyebrow: {
    ...Type.monoLabel,
    color: Colors.muted,
  },
  rule: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: Space.md,
  },
  joinable: {
    ...Type.monoLabel,
    color: Colors.accent,
  },

  strip: {
    gap: Space.md,
    paddingBottom: Space.xl,
  },
  stripRow: {
    gap: Space.md,
    paddingRight: Space.xs,
  },
  session: {
    width: SESSION_CHIP_WIDTH,
    minHeight: TOUCH_TARGET + Space.lg,
    justifyContent: 'center',
    gap: 3,
    paddingVertical: Space.sm,
    paddingHorizontal: Space.md,
    borderRadius: Radius.md,
    // Glass rather than a solid block: these chips sit inside the bloom and
    // should pick its colour up.
    backgroundColor: Colors.glass,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  sessionPressed: {
    opacity: 0.72,
  },
  sessionTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
  },
  sessionName: {
    ...Type.bodyStrong,
    color: Colors.text,
    flexShrink: 1,
  },
  sessionLounge: {
    ...Type.caption,
    color: Colors.muted,
  },

  skeletonList: {
    gap: Space.md,
  },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    padding: Space.md,
    borderRadius: Radius.lg,
    backgroundColor: Colors.glass,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  skeletonText: {
    flex: 1,
    gap: Space.sm,
  },
});
