/**
 * Lounges — the communities I belong to.
 *
 * design/v2 "Lounges": a masthead with one raised + tile, then raised rows —
 * tag tile, name, one line of counts, and a recessed live pill on the right for
 * the lounges with a Session running. The pill is the only accent on the
 * screen, which is what keeps the red meaning "there is something to walk into".
 *
 * Redeeming a code lives on Explore, where the design puts it. It stays
 * reachable from here through the empty state, which is the one moment you have
 * no lounges and somebody has just sent you one.
 */

import { router } from 'expo-router';
import { Plus } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
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
import { JoinCodeModal } from '@/components/lounge/join-code-modal';
import { AuxButton, Screen, Skeleton, useToast } from '@/components/ui';
import { loungeErrorMessage, useMyLounges, type LoungeSummary } from '@/features/lounges/queries';
import {
  Duration,
  Fonts,
  Radii,
  Space,
  TOUCH_TARGET,
  Type,
  pressedSoft,
  raised,
  tracking,
} from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

const GUTTER = 24;
const ROW_GUTTER = 14;
const LIST_TAIL = 48;
const TILE = 56;

const SKELETON_ROWS = [0, 1, 2, 3];

/** `Type.readout` hands back a readonly tuple; TextStyle wants a mutable one. */
const readout = (size: number): TextStyle => ({
  ...Type.readout(size),
  fontVariant: ['tabular-nums'],
});

/** The tag on a lounge's tile: initials for a phrase, the first letters if not. */
function tagFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    return words
      .slice(0, 4)
      .map((word) => word[0] ?? '')
      .join('')
      .toUpperCase();
  }
  return (words[0] ?? '').slice(0, 4).toUpperCase() || '·';
}

function useModuleEnter() {
  const reduced = useReducedMotion();
  const t = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (reduced) {
      t.value = 1;
      return;
    }
    t.value = withTiming(1, { duration: Duration.enter, easing: Easing.bezier(0.2, 0.8, 0.2, 1) });
  }, [reduced, t]);

  return useAnimatedStyle(() => ({
    opacity: t.value,
    transform: [{ translateY: (1 - t.value) * 8 }],
  }));
}

/** A raised card carrying one line and up to two actions. Every non-happy path. */
function QuietCard({
  line,
  primary,
  secondary,
}: {
  line: string;
  primary: { label: string; onPress: () => void };
  secondary?: { label: string; onPress: () => void };
}) {
  const C = useColors();

  return (
    <View style={[styles.quiet, { backgroundColor: C.surface }, raised(C)]}>
      <Text style={[styles.quietLine, { color: C.ink2 }]}>{line}</Text>
      <View style={styles.quietActions}>
        <AuxButton
          label={primary.label}
          onPress={primary.onPress}
          variant="cream"
          size="sm"
          align="center"
        />
        {secondary ? (
          <AuxButton
            label={secondary.label}
            onPress={secondary.onPress}
            variant="ghost"
            size="sm"
            align="center"
          />
        ) : null}
      </View>
    </View>
  );
}

/** One lounge I belong to. */
function LoungeRow({ item, onPress }: { item: LoungeSummary; onPress: () => void }) {
  const C = useColors();
  const isLive = item.activeSessions > 0;
  const liveCount = item.listeners > 0 ? item.listeners : item.activeSessions;

  const meta = `${item.memberCount} ${item.memberCount === 1 ? 'member' : 'members'}`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        isLive ? `${item.lounge.name}, ${liveCount} live, ${meta}` : `${item.lounge.name}, ${meta}`
      }
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: C.surface },
        raised(C),
        pressed && styles.pressed,
      ]}>
      <View style={[styles.tile, { backgroundColor: C.artwork }]}>
        <Text numberOfLines={1} style={[styles.tag, { color: C.artInk }]}>
          {tagFor(item.lounge.name)}
        </Text>
      </View>

      <View style={styles.rowInfo}>
        <Text numberOfLines={1} style={[styles.rowName, { color: C.ink }]}>
          {item.lounge.name}
        </Text>
        <Text numberOfLines={1} style={[styles.rowMeta, { color: C.ink2 }]}>
          {meta}
        </Text>
      </View>

      {isLive ? (
        <View style={[styles.livePill, { backgroundColor: C.bgRecessed }, pressedSoft(C)]}>
          <LiveDot size={6} />
          <Text style={[styles.liveCount, { color: C.liveText }]}>{liveCount}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function LoungesSkeleton() {
  const C = useColors();

  return (
    <View style={styles.list}>
      {SKELETON_ROWS.map((row) => (
        <View key={row} style={[styles.row, { backgroundColor: C.surface }, raised(C)]}>
          <Skeleton width={TILE} height={TILE} />
          <View style={styles.skeletonInfo}>
            <Skeleton width="56%" height={14} />
            <Skeleton width="34%" height={11} />
          </View>
        </View>
      ))}
    </View>
  );
}

export default function LoungesScreen() {
  const C = useColors();
  const toast = useToast();
  const moduleStyle = useModuleEnter();

  const [joinOpen, setJoinOpen] = useState(false);
  const { data, isPending, isError, error, refetch, isRefetching } = useMyLounges();

  const openCreate = useCallback(() => router.push('/lounge/create'), []);
  const openJoin = useCallback(() => setJoinOpen(true), []);
  const closeJoin = useCallback(() => setJoinOpen(false), []);

  const handleJoined = useCallback(
    (loungeId: string) => {
      setJoinOpen(false);
      toast.show('Joined the lounge', 'success');
      router.push({ pathname: '/lounge/[id]', params: { id: loungeId } });
    },
    [toast]
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<LoungeSummary>) => (
      <LoungeRow
        item={item}
        onPress={() => router.push({ pathname: '/lounge/[id]', params: { id: item.lounge.id } })}
      />
    ),
    []
  );

  const summary = useMemo(() => {
    if (isError) return 'Could not reach your lounges';
    if (isPending) return 'Loading';
    const lounges = data ?? [];
    if (lounges.length === 0) return 'Nothing here yet';
    const live = lounges.filter((item) => item.activeSessions > 0).length;
    return live > 0 ? `${lounges.length} joined · ${live} live` : `${lounges.length} joined`;
  }, [data, isError, isPending]);

  return (
    <Screen padded={false}>
      <Animated.View style={[styles.flex, moduleStyle]}>
        <View style={styles.masthead}>
          <View style={styles.mastheadText}>
            <Text style={[styles.title, { color: C.ink }]}>Lounges</Text>
            <Text numberOfLines={1} style={[styles.summary, { color: C.ink2 }]}>
              {summary}
            </Text>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Create a lounge"
            onPress={openCreate}
            style={({ pressed }) => [
              styles.iconTile,
              { backgroundColor: C.surface },
              raised(C),
              pressed && styles.pressed,
            ]}>
            <Plus size={18} strokeWidth={2.5} color={C.ink} />
          </Pressable>
        </View>

        {isError ? (
          <View style={styles.list}>
            <QuietCard
              line={loungeErrorMessage(error, 'Could not load your lounges.')}
              primary={{ label: 'Try again', onPress: () => void refetch() }}
            />
          </View>
        ) : isPending ? (
          <LoungesSkeleton />
        ) : (
          <FlatList
            data={data}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            style={styles.flex}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={isRefetching}
                onRefresh={() => void refetch()}
                tintColor={C.ink2}
                colors={[C.live]}
                progressBackgroundColor={C.surface}
              />
            }
            ListEmptyComponent={
              <QuietCard
                line="No lounges yet."
                primary={{ label: 'Create one', onPress: openCreate }}
                secondary={{ label: 'I have a code', onPress: openJoin }}
              />
            }
          />
        )}
      </Animated.View>

      <JoinCodeModal visible={joinOpen} onClose={closeJoin} onJoined={handleJoined} />
    </Screen>
  );
}

function keyExtractor(item: LoungeSummary): string {
  return item.lounge.id;
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  pressed: {
    opacity: 0.7,
  },

  masthead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.md,
    paddingTop: 14,
    paddingHorizontal: GUTTER,
  },
  mastheadText: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    ...Type.display(30),
    letterSpacing: tracking(30, -0.03),
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

  list: {
    paddingHorizontal: ROW_GUTTER,
    paddingTop: 24,
  },
  listContent: {
    flexGrow: 1,
    paddingHorizontal: ROW_GUTTER,
    paddingTop: 24,
    paddingBottom: LIST_TAIL,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ROW_GUTTER,
    padding: 13,
    borderRadius: Radii.xl,
    marginBottom: 10,
  },
  tile: {
    width: TILE,
    height: TILE,
    borderRadius: Radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Space.xs,
  },
  tag: {
    fontFamily: Fonts.extrabold,
    fontSize: 14,
    lineHeight: 17,
    letterSpacing: tracking(14, -0.02),
  },
  rowInfo: {
    flex: 1,
    minWidth: 0,
  },
  rowName: {
    fontFamily: Fonts.semibold,
    fontSize: 15.5,
    lineHeight: 20,
    letterSpacing: tracking(15.5, -0.015),
  },
  rowMeta: {
    ...Type.body(12.5),
    lineHeight: 17,
    marginTop: 3,
  },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: Space.sm,
    paddingHorizontal: Space.md,
    borderRadius: Radii.pill,
  },
  liveCount: {
    ...readout(11),
    fontFamily: Fonts.semibold,
  },
  skeletonInfo: {
    flex: 1,
    gap: Space.sm,
  },

  quiet: {
    marginTop: Space.sm,
    padding: Space.xl,
    borderRadius: Radii.xl,
    alignItems: 'flex-start',
    gap: Space.lg,
  },
  quietLine: {
    ...Type.body(14),
  },
  quietActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
});
