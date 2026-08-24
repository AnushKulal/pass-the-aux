/**
 * Lounges — the communities I belong to. A top-level destination.
 *
 * design/v2 "Lounges": a masthead carrying the count and one raised + tile, then
 * raised rows — tag tile, name, one line of counts, and a recessed live pill on
 * the right for the lounges with a Session running. The pill is the only accent
 * on the screen, which is what keeps the red meaning "there is something to walk
 * into".
 *
 * This screen used to be reachable only from a left rail that no longer exists,
 * so it was built as a secondary list. It is the third cell in the bottom bar
 * now, which is why the masthead is fixed above the list rather than scrolling
 * with it, and why the empty state is the whole screen rather than a footnote:
 * a brand-new account lands here with nothing, and this is where it finds out
 * what to do about that.
 *
 * Redeeming a code lives on Explore, where the design puts it. It stays
 * reachable from the empty state, which is the one moment you have no lounges
 * and somebody has just sent you one.
 */

import { router } from 'expo-router';
import { Plus, Users, WifiOff, type LucideIcon } from 'lucide-react-native';
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

import { JoinCodeModal } from '@/components/lounge/join-code-modal';
import { LoungeCard, LoungeListSkeleton } from '@/components/lounge/lounge-card';
import { EmptyState, Screen, Skeleton, useToast } from '@/components/ui';
import { loungeErrorMessage, useMyLounges, type LoungeSummary } from '@/features/lounges/queries';
import {
  Duration,
  Radii,
  Space,
  TOUCH_TARGET,
  Type,
  raised,
  tracking,
} from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

const GUTTER = 24;
const ROW_GUTTER = 14;
const LIST_TAIL = 48;

/** Matches the row's tile, so the empty card stands where a row would. */

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

/**
 * The screen with no list on it: a raised card standing where the first row
 * would, saying what happened and what to do next.
 */
/**
 * This screen is where the two-action case earns its keep: a new account with
 * no lounges has two genuinely different routes out — make one, or join one
 * with a code — and neither is a rephrasing of the other.
 *
 * Drawn by `@/components/ui/empty-state`, shared with the Feed and Explore.
 */
function QuietCard({
  icon,
  title,
  line,
  primary,
  secondary,
}: {
  icon: LucideIcon;
  title: string;
  line?: string;
  primary: { label: string; onPress: () => void };
  secondary?: { label: string; onPress: () => void };
}) {
  return (
    <EmptyState
      icon={icon}
      title={title}
      description={line}
      primary={primary}
      secondary={secondary}
    />
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
    ({ item, index }: ListRenderItemInfo<LoungeSummary>) => (
      <LoungeCard
        name={item.lounge.name}
        iconUrl={item.lounge.icon_url}
        meta={`${item.memberCount} ${item.memberCount === 1 ? 'member' : 'members'}`}
        isLive={item.activeSessions > 0}
        listeners={item.listeners}
        index={index}
        accessibilityHint="Opens this lounge"
        onPress={() => router.push({ pathname: '/lounge/[id]', params: { id: item.lounge.id } })}
      />
    ),
    []
  );

  /** The masthead's second line is a readout, not a sentence. */
  const summary = useMemo(() => {
    if (isError) return 'Could not reach your lounges';
    const lounges = data ?? [];
    if (lounges.length === 0) return 'No lounges yet';
    const live = lounges.filter((item) => item.activeSessions > 0).length;
    return live > 0 ? `${lounges.length} joined · ${live} live` : `${lounges.length} joined`;
  }, [data, isError]);

  return (
    <Screen padded={false}>
      <Animated.View style={[styles.flex, moduleStyle]}>
        <View style={styles.masthead}>
          <View style={styles.mastheadText}>
            <Text style={[styles.title, { color: C.ink }]}>Lounges</Text>
            {/* A skeleton rather than the word "Loading": the line keeps its
                height, so the masthead does not reflow when the count lands. */}
            {isPending ? (
              <Skeleton width={132} height={13} style={styles.summarySkeleton} />
            ) : (
              <Text numberOfLines={1} style={[styles.summary, { color: C.ink2 }]}>
                {summary}
              </Text>
            )}
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
              icon={WifiOff}
              title="Could not load your lounges"
              line={loungeErrorMessage(error, 'Check your connection.')}
              primary={{ label: 'Try again', onPress: () => void refetch() }}
            />
          </View>
        ) : isPending ? (
          <View style={styles.list}>
            <LoungeListSkeleton count={4} />
          </View>
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
                icon={Users}
                title="No lounges yet"
                primary={{ label: 'Create a lounge', onPress: openCreate }}
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
  summarySkeleton: {
    marginTop: 7,
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

});
