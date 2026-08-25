/**
 * Lounges — the communities I belong to.
 *
 * NOCTURNE HAS NO LOUNGES ARTBOARD, AND THAT IS THE FIRST THING TO KNOW ABOUT
 * THIS FILE. The direction surfaces lounges as a horizontal strip inside the
 * Feed (`aux-nocturne.dc.html` L262-274) with a "See all" link, and the bottom
 * nav spends its fourth cell on Messages instead. This screen keeps its route —
 * the Feed's link lands here, and so do deep links — it simply lost its slot in
 * the navigation.
 *
 * So the row is borrowed rather than transcribed, and it is `LoungeCard`: the
 * shared component whose own header cites the two places the design DOES draw a
 * lounge (L268 Explore, L399 the profile's list). It used to be hand-rolled
 * here, under a comment asserting that `LoungeCard` "still draws the previous
 * direction's row (radius 22, no border)". That was false — the component had
 * already been rebuilt for nocturne — and the fork it licensed is why the app
 * shipped three lounge rows with three different tile radii.
 *
 * WHAT THE FORK'S FOOTER RAIL BECAME. The local row carried a bottom rail with
 * the member count on the left and the coral live state on the right, lifted
 * from the Feed's lounge tile (L269-272). `LoungeCard` states the same two
 * facts in its own grammar: the count is the `meta` line under the name in
 * `ink3`, and the live state is the coral pill in the trailing slot (a number
 * when there is one to report, a bare dot when a Session is up but empty). No
 * information was dropped — only a second layout for it.
 *
 * WHY THE LIVE STATE IS THE ONLY ACCENT. These are lounges you are already in,
 * so there is no action to offer per row — the card IS the action. That leaves
 * coral free to do the one job it has here: say which lounges have something
 * happening in them right now. No blue appears in the list at all, which is
 * correct; the only blue on the screen is the empty state's CTA.
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
import { useDockReserve } from '@/lib/dock';
import { Duration, Radii, Rule, Space, TOUCH_TARGET, Type, tracking } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

/** 18 in every nocturne artboard. See the note on the same constant in `explore.tsx`. */
const GUTTER = 18;

function useModuleEnter() {
  const reduced = useReducedMotion();
  const t = useSharedValue(reduced ? 1 : 0);

  /*
    An effect, never `entering={FadeIn}`. Reanimated marks an entering view
    `visibility: hidden` until its animation runs, and on react-native-web that
    animation never fires — leaving a screen that reports the correct colour,
    size and layout while being completely invisible.
  */
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
 * The screen with no list on it. This is where the two-action case earns its
 * keep: a new account with no lounges has two genuinely different routes out —
 * make one, or join one with a code — and neither is a rephrasing of the other.
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
  const dockReserve = useDockReserve();

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

  const renderItem = useCallback(({ item, index }: ListRenderItemInfo<LoungeSummary>) => {
    const { lounge, memberCount, activeSessions, listeners } = item;

    return (
      <LoungeCard
        name={lounge.name}
        description={lounge.description.trim()}
        /*
          The quiet fact goes in `meta`, in `ink3` at 11px. It is deliberately
          the softest line in the row: the member count is context, and the
          coral pill beside it — the thing you actually came to look for — has
          to win that contest.
        */
        meta={`${memberCount} ${memberCount === 1 ? 'member' : 'members'}`}
        iconUrl={lounge.icon_url}
        isLive={activeSessions > 0}
        listeners={listeners}
        index={index}
        onPress={() => router.push({ pathname: '/lounge/[id]', params: { id: lounge.id } })}
        accessibilityHint="Opens this lounge"
      />
    );
  }, []);

  /** The masthead's second line is a readout, not a sentence. */
  const summary = useMemo(() => {
    if (isError) return 'Could not reach your lounges';
    const lounges = data ?? [];
    if (lounges.length === 0) return 'No lounges yet';
    const live = lounges.filter((item) => item.activeSessions > 0).length;
    return live > 0 ? `${lounges.length} joined · ${live} live` : `${lounges.length} joined`;
  }, [data, isError]);

  return (
    /*
      `ground={false}`, and it is not cosmetic. The ambient blobs are mounted
      ONCE behind the tab navigator; every card here is 5.5% white and has
      nothing to show through it unless that ground is visible.
    */
    <Screen padded={false} ground={false}>
      <Animated.View style={[styles.flex, moduleStyle]}>
        <View style={styles.masthead}>
          <View style={styles.mastheadText}>
            <Text accessibilityRole="header" style={[styles.title, { color: C.ink }]}>
              Lounges
            </Text>
            {/* A skeleton rather than the word "Loading": the line keeps its
                height, so the masthead does not reflow when the count lands. */}
            {isPending ? (
              <Skeleton width={132} height={13} radius={Radii.sm} style={styles.summarySkeleton} />
            ) : (
              <Text numberOfLines={1} style={[styles.summary, { color: C.ink2 }]}>
                {summary}
              </Text>
            )}
          </View>

          {/*
            The house chrome button: a 44px CIRCLE of `surface` behind a `rule`
            hairline, pressing to `surface2` — the same object as the header's
            back control and the Feed's settings cell (design L234, L429). It
            was a raised rounded square with no border, which in this direction
            reads as a flat patch: 5.5% white has no edge of its own, so the
            border is what makes it a button.
          */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Create a lounge"
            onPress={openCreate}
            style={({ pressed }) => [
              styles.chromeButton,
              { backgroundColor: pressed ? C.surface2 : C.surface, borderColor: C.rule },
            ]}>
            <Plus size={20} strokeWidth={2} color={C.ink} />
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
            {/* `wide` because the real row carries a description line. The
                skeleton ships beside the row it stands in for, so the two
                cannot drift apart. */}
            <LoungeListSkeleton count={4} wide />
          </View>
        ) : (
          <FlatList
            data={data}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            style={styles.flex}
            /*
              The dock reservation is applied INLINE because it depends on the
              device's bottom inset, which a StyleSheet object cannot carry.
              This was `Dock.reserve`, a static number that left the last card
              under the floating nav capsule on every device with a home
              indicator; `useDockReserve()` does the addition itself.
            */
            contentContainerStyle={[styles.listContent, { paddingBottom: dockReserve }]}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={isRefetching}
                onRefresh={() => void refetch()}
                tintColor={C.ink2}
                colors={[C.live]}
                /*
                  `surfaceSolid`, not `surface`. Android paints this disc behind
                  the spinner and it sits over whatever is scrolling underneath;
                  a 5.5%-white fill would let the content read straight through
                  it. Same hazard as a chip laid over artwork.
                */
                progressBackgroundColor={C.surfaceSolid}
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

  /* ------------------------------------------------------------- masthead */

  masthead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.md,
    paddingTop: 14,
    paddingBottom: Space.md,
    paddingHorizontal: GUTTER,
  },
  mastheadText: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    ...Type.display(26),
    // The artboard's `-.025em`, which sits between `display`'s own steps.
    letterSpacing: tracking(26, -0.025),
  },
  summary: {
    ...Type.body(13),
    marginTop: 4,
  },
  summarySkeleton: {
    marginTop: 7,
  },
  chromeButton: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    borderRadius: Radii.pill,
    borderWidth: Rule.hair,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* ------------------------------------------------------------ the list */

  list: {
    paddingHorizontal: GUTTER,
    paddingTop: Space.sm,
  },
  /*
    No `gap`. The 12px down the column is `LoungeCard`'s own bottom margin —
    adding a gap here as well would sum to 24 and pull the list apart.
    `paddingBottom` is applied at the call site; see the note at the FlatList.
  */
  listContent: {
    flexGrow: 1,
    paddingHorizontal: GUTTER,
    paddingTop: Space.sm,
  },
});
