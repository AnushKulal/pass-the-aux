/**
 * The Feed — live "who is listening to what" across every lounge I am in.
 *
 * This is the screen that has to make the product legible in one glance, so
 * everything here is push-driven: the rows arrive over Realtime presence, and
 * the only queries are the two slow-moving lists behind them (my lounges, my
 * Sessions).
 *
 * Patchbay: no card, no glass, no gutter. The rows run edge to edge and are
 * separated by 1px hairlines; the header is cut off from them by a 2px rule.
 * The accent appears in exactly three places — the live count, a JOIN cell, and
 * the progress fill — because all three mean the same thing.
 *
 * Rows are filtered to lounges I am actually a member of, which falls out of
 * `useMyLounges` driving both the presence subscription and the list.
 */

import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { NowPlayingCard } from '@/components/feed/now-playing-card';
import { Screen, Skeleton } from '@/components/ui';
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
import { Duration, Rule, Space, Type } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';
import { usePlayback } from '@/playback/store';
import type { RoomTimeline } from '@/playback/sync-controller';

const MY_SESSIONS_KEY = 'my-sessions';
const SKELETON_ROWS = [0, 1, 2, 3];

/** Matches the row exactly: a resizing skeleton is worse than no skeleton. */
const ROW_HEIGHT = 78;
const WELL = 64;
const RAIL = 70;

/** The screen gutter inside header and prose blocks. Rows themselves bleed. */
const GUTTER = 12;

/** Clears the tab bar without leaving a hole under the last row. */
const LIST_TAIL = 32;

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

/** The one accent-outlined action shape used across the Feed's prose blocks. */
function AccentAction({ label, onPress }: { label: string; onPress: () => void }) {
  const C = useColors();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        { borderColor: C.live, backgroundColor: pressed ? C.liveWash : 'transparent' },
      ]}>
      <Text style={[styles.actionLabel, { color: C.liveText }]}>{label}</Text>
    </Pressable>
  );
}

/** A ruled prose block: kicker, sentence, optional action. */
function Notice({
  kicker,
  body,
  action,
}: {
  kicker: string;
  body: string;
  action?: { label: string; onPress: () => void };
}) {
  const C = useColors();

  return (
    <View style={[styles.notice, { borderBottomColor: C.rule }]}>
      <Text style={[styles.noticeKicker, { color: C.ink3 }]}>{kicker}</Text>
      <Text style={[styles.noticeBody, { color: C.ink2 }]}>{body}</Text>
      {action ? (
        <View style={styles.noticeAction}>
          <AccentAction label={action.label} onPress={action.onPress} />
        </View>
      ) : null}
    </View>
  );
}

/** Four rows of the real geometry, so nothing shifts when the data lands. */
function FeedSkeleton() {
  const C = useColors();

  return (
    <View>
      {SKELETON_ROWS.map((row) => (
        <View key={row} style={[styles.skeletonRow, { borderBottomColor: C.rule }]}>
          <View
            style={[styles.skeletonWell, { borderRightColor: C.rule, backgroundColor: C.bgRecessed }]}
          />
          <View style={styles.skeletonInfo}>
            <Skeleton width="72%" height={14} radius={0} />
            <Skeleton width="48%" height={11} radius={0} />
            <Skeleton width={96} height={12} radius={0} />
          </View>
          <View style={[styles.skeletonRail, { borderLeftColor: C.rule }]}>
            <Skeleton width={34} height={11} radius={0} />
            <Skeleton width={26} height={9} radius={0} />
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * The Sessions I am already inside. Not in the handoff's Feed — that design
 * reaches them through the lounge rail, which this build does not have — so it
 * keeps the same ruled idiom and stays out of the rows' way.
 */
function SessionStrip({
  sessions,
  loungeNames,
  onOpen,
}: {
  sessions: ActiveSession[];
  loungeNames: Map<string, string>;
  onOpen: (roomId: string) => void;
}) {
  const C = useColors();

  return (
    <View style={[styles.strip, { borderBottomColor: C.rule }]}>
      <Text style={[styles.stripKicker, { color: C.ink3 }]}>YOUR SESSIONS</Text>

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
              style={({ pressed }) => [
                styles.session,
                { borderColor: C.rule2, backgroundColor: pressed ? C.surface : 'transparent' },
              ]}>
              <View style={styles.sessionTop}>
                {item.timeline.isPlaying ? (
                  <View style={[styles.sessionDot, { backgroundColor: C.live }]} />
                ) : null}
                <Text numberOfLines={1} style={[styles.sessionName, { color: C.ink }]}>
                  {item.track?.title ?? item.name}
                </Text>
              </View>
              <Text numberOfLines={1} style={[styles.sessionLounge, { color: C.ink3 }]}>
                {loungeName}
              </Text>
            </Pressable>
          );
        }}
      />
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

  // My own row is redundant: the Sessions strip already says where I am, and a
  // Feed that leads with yourself is a mirror, not a party.
  const { entries, ready } = useLoungePresence(loungeList, profile?.id);

  const openRoom = useCallback(
    (roomId: string) => router.push({ pathname: '/room/[id]', params: { id: roomId } }),
    [router]
  );

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
  const hasRows = !showSkeleton && entries.length > 0;

  /**
   * `N IN` on a row is "people from your lounges who are in that Session",
   * which is the only head count presence can honestly produce — the room's own
   * participant list is not on the socket.
   */
  const listenersByRoom = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of entries) {
      if (entry.roomId === null) continue;
      counts.set(entry.roomId, (counts.get(entry.roomId) ?? 0) + 1);
    }
    return counts;
  }, [entries]);

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<FeedEntry>) => (
      <NowPlayingCard
        entry={item}
        index={index}
        listeners={item.roomId === null ? undefined : listenersByRoom.get(item.roomId)}
      />
    ),
    [listenersByRoom]
  );

  const header = useMemo(
    () =>
      sessionList.length > 0 ? (
        <SessionStrip sessions={sessionList} loungeNames={loungeNames} onOpen={openRoom} />
      ) : null,
    [sessionList, loungeNames, openRoom]
  );

  /**
   * The handoff folds the Feed's empty state into the block that always closes
   * the list, so there is no separate "nothing here" screen to design — the
   * same block just changes its words.
   */
  const footer = useMemo(() => {
    if (showSkeleton) return null;

    if (lounges.isError) {
      return (
        <Notice
          kicker="COULD NOT LOAD YOUR LOUNGES"
          body="Check your connection and pull down to try again."
          action={{ label: 'TRY AGAIN', onPress: () => void onRefresh() }}
        />
      );
    }

    if (loungeList.length === 0) {
      return (
        <Notice
          kicker="YOU ARE NOT IN A LOUNGE YET"
          body="Lounges are where the music happens. Join one and this feed fills itself."
          action={{ label: 'FIND A LOUNGE', onPress: () => router.push('/lounges') }}
        />
      );
    }

    return (
      <Notice
        kicker={hasRows ? 'THAT IS EVERYONE' : 'YOUR FEED IS QUIET'}
        body={
          hasRows
            ? 'Nobody else is on right now. Start a Session and the Feed fills up.'
            : 'Nobody is listening yet — join a lounge, or start a Session and someone will join.'
        }
        action={{ label: 'START A SESSION', onPress: startSession }}
      />
    );
  }, [showSkeleton, lounges.isError, loungeList.length, hasRows, onRefresh, router, startSession]);

  const countLabel = hasRows
    ? `${entries.length} ${entries.length === 1 ? 'PERSON' : 'PEOPLE'} LISTENING RIGHT NOW`
    : 'NOBODY IS LISTENING YET';

  return (
    <Screen padded={false}>
      <Animated.View style={[styles.flex, moduleStyle]}>
        {/* Header, cut off from the rows by the 2px major rule. */}
        <View style={[styles.head, { borderBottomColor: C.rule }]}>
          <Text style={[styles.headTitle, { color: C.ink }]}>The Feed</Text>
          {/* The count only takes the accent when there is something live in
              it; "nobody is listening" is not a live signal. */}
          <Text style={[styles.headCount, { color: hasRows ? C.liveText : C.ink3 }]}>
            {countLabel}
          </Text>
        </View>

        <FlatList
          data={showSkeleton ? [] : entries}
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
    paddingBottom: LIST_TAIL,
    flexGrow: 1,
  },

  head: {
    paddingHorizontal: GUTTER,
    paddingTop: 14,
    paddingBottom: 10,
    borderBottomWidth: Rule.major,
  },
  headTitle: {
    ...Type.display(22),
  },
  headCount: {
    ...Type.label(10),
    marginTop: 3,
  },

  strip: {
    paddingTop: 12,
    paddingBottom: 12,
    borderBottomWidth: Rule.hair,
  },
  stripKicker: {
    ...Type.label(10),
    paddingHorizontal: GUTTER,
    marginBottom: 8,
  },
  stripRow: {
    gap: Space.sm,
    paddingHorizontal: GUTTER,
  },
  session: {
    minWidth: 150,
    minHeight: 46,
    justifyContent: 'center',
    gap: 3,
    paddingVertical: Space.sm,
    paddingHorizontal: 10,
    borderWidth: Rule.hair,
  },
  sessionTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sessionDot: {
    width: 6,
    height: 6,
  },
  sessionName: {
    ...Type.heading(12),
    flexShrink: 1,
  },
  sessionLounge: {
    ...Type.label(10),
  },

  notice: {
    paddingVertical: 26,
    paddingHorizontal: 14,
    borderBottomWidth: Rule.hair,
  },
  noticeKicker: {
    ...Type.label(10),
    marginBottom: 8,
  },
  noticeBody: {
    ...Type.body(14),
    lineHeight: 21,
  },
  noticeAction: {
    marginTop: 14,
    alignItems: 'flex-start',
  },
  action: {
    minHeight: 46,
    justifyContent: 'center',
    paddingHorizontal: Space.lg,
    borderWidth: Rule.hair,
  },
  actionLabel: {
    ...Type.heading(11),
    letterSpacing: 11 * 0.1,
  },

  skeletonRow: {
    height: ROW_HEIGHT,
    flexDirection: 'row',
    borderBottomWidth: Rule.hair,
  },
  skeletonWell: {
    width: WELL,
    height: '100%',
    borderRightWidth: Rule.hair,
  },
  skeletonInfo: {
    flex: 1,
    justifyContent: 'center',
    gap: Space.sm,
    paddingHorizontal: 10,
  },
  skeletonRail: {
    width: RAIL,
    borderLeftWidth: Rule.hair,
    justifyContent: 'center',
    gap: Space.sm,
    paddingHorizontal: 10,
  },
});
