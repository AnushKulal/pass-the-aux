/**
 * A lounge row — Explore and the Lounges tab share it.
 *
 * Patchbay: a ruled band, never a card. A 56px tag well on the left, the name
 * and its description in the middle, and a JOIN / OPEN cell cut off by a
 * hairline on the right. The tag well is the same stand-in the artwork wells
 * use, so a lounge with an icon and one without sit on the same grid.
 *
 * Red appears once: on the live count, and only when somebody is actually
 * listening. `QUIET` is ink, `JOINED` is ink — neither is a live signal.
 */

import { Image } from 'expo-image';
import { memo, useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { Skeleton } from '@/components/ui';
import { Duration, Rule, Space, Stagger, Type } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

export type LoungeCardProps = {
  name: string;
  description?: string;
  iconUrl?: string | null;
  /** Omitted on Explore: RLS hides the roster of a lounge you have not joined. */
  memberCount?: number;
  /** People currently inside this lounge's Sessions. */
  listeners?: number;
  /** Drives the live treatment even when a Session is empty. */
  activeSessions?: number;
  isPublic?: boolean;
  /** Shows the "Joined" state — Explore only; the Lounges tab is all joined. */
  showJoined?: boolean;
  onPress: () => void;
  /**
   * Three-letter stand-in in the well. Derived from the name when absent, the
   * same way the artwork wells derive their letter from the track title.
   */
  tag?: string;
  /** Position in the list, for the 55ms entrance stagger. */
  index?: number;
  /** When given, the right cell becomes its own target and joins in place. */
  onJoin?: () => void;
  joining?: boolean;
};

const WELL = 56;
const CTA = 62;
const ROW_MIN_HEIGHT = 72;

/** `THE BASEMENT` → `TBA`; `Dub` → `DUB`. Never longer than three characters. */
function tagFor(name: string, explicit?: string): string {
  if (explicit && explicit.trim()) return explicit.trim().toUpperCase().slice(0, 3);

  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '···';
  if (words.length === 1) return words[0]!.slice(0, 3).toUpperCase();

  return words
    .slice(0, 3)
    .map((word) => word[0] ?? '')
    .join('')
    .toUpperCase();
}

function pluralize(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function LoungeCardBase({
  name,
  description,
  iconUrl,
  memberCount,
  listeners = 0,
  activeSessions = 0,
  isPublic = true,
  showJoined = false,
  onPress,
  tag,
  index = 0,
  onJoin,
  joining = false,
}: LoungeCardProps) {
  const C = useColors();
  const reduced = useReducedMotion();

  const isLive = activeSessions > 0;
  // An active Session with nobody in it yet is still worth surfacing — it is an
  // invitation. Only the wording changes.
  const liveLabel = listeners > 0 ? `${listeners} LISTENING` : 'LIVE NOW';

  const a11yParts = [
    name,
    isLive ? liveLabel.toLowerCase() : null,
    memberCount !== undefined ? pluralize(memberCount, 'member', 'members') : null,
    showJoined ? 'Joined' : null,
    isPublic ? null : 'Private',
  ].filter(Boolean);

  const cta = showJoined ? 'OPEN' : 'JOIN';

  const enter = useSharedValue(reduced ? 1 : 0);
  /** Read once at mount, so a refetch reordering the list does not replay it. */
  const delay = useRef(index * Stagger.feed);

  useEffect(() => {
    if (reduced) {
      enter.value = 1;
      return;
    }
    enter.value = withDelay(
      delay.current,
      withTiming(1, { duration: Duration.enter, easing: Easing.bezier(0.2, 0.8, 0.2, 1) })
    );
  }, [enter, reduced]);

  const entering = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * 8 }],
  }));

  return (
    <Animated.View style={entering}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={a11yParts.join(', ')}
        accessibilityHint="Opens this lounge"
        onPress={onPress}
        style={({ pressed }) => [
          styles.row,
          { borderBottomColor: C.rule, backgroundColor: pressed ? C.surface : 'transparent' },
        ]}>
        <View style={[styles.well, { borderRightColor: C.rule, backgroundColor: C.bgRecessed }]}>
          <Text style={[styles.tag, { color: C.ink3 }]}>{tagFor(name, tag)}</Text>

          {iconUrl ? (
            <Image
              source={{ uri: iconUrl }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              cachePolicy="memory-disk"
              recyclingKey={name}
              transition={Duration.press}
              accessible={false}
            />
          ) : null}
        </View>

        <View style={styles.body}>
          <Text numberOfLines={1} style={[styles.name, { color: C.ink }]}>
            {name}
          </Text>

          {description ? (
            <Text numberOfLines={2} style={[styles.description, { color: C.ink2 }]}>
              {description}
            </Text>
          ) : null}

          <View style={styles.meta}>
            {memberCount !== undefined ? (
              <Text style={[styles.metaLabel, { color: C.ink3 }]}>
                {pluralize(memberCount, 'MEMBER', 'MEMBERS')}
              </Text>
            ) : null}

            <Text style={[styles.metaLabel, { color: C.ink3 }]}>
              {isPublic ? 'PUBLIC' : 'PRIVATE'}
            </Text>

            {isLive ? (
              <Text style={[styles.live, { color: C.liveText }]}>{liveLabel}</Text>
            ) : (
              <Text style={[styles.metaLabel, { color: C.ink3 }]}>QUIET</Text>
            )}

            {showJoined ? (
              <Text style={[styles.metaLabel, { color: C.ink3 }]}>JOINED</Text>
            ) : null}
          </View>
        </View>

        {onJoin ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={showJoined ? `Open ${name}` : `Join ${name}`}
            disabled={joining}
            onPress={onJoin}
            style={({ pressed }) => [
              styles.cta,
              { borderLeftColor: C.rule, backgroundColor: pressed ? C.liveWash : 'transparent' },
              joining && styles.ctaBusy,
            ]}>
            <Text style={[styles.ctaLabel, { color: C.liveText }]}>{joining ? '···' : cta}</Text>
          </Pressable>
        ) : (
          <View style={[styles.cta, { borderLeftColor: C.rule }]}>
            <Text style={[styles.ctaLabel, { color: C.liveText }]}>{cta}</Text>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

/**
 * Memoized: these render inside FlatLists that re-render on every realtime
 * lounge update, and the whole row is pure props.
 */
export const LoungeCard = memo(LoungeCardBase);

/**
 * The row's loading twin. Lives here so its geometry cannot drift from the real
 * row's — a skeleton that resizes on load is worse than no skeleton.
 */
export function LoungeCardSkeleton() {
  const C = useColors();

  return (
    <View style={[styles.row, { borderBottomColor: C.rule }]}>
      <View style={[styles.well, { borderRightColor: C.rule, backgroundColor: C.bgRecessed }]} />
      <View style={styles.body}>
        <Skeleton width="52%" height={16} radius={0} />
        <Skeleton width="86%" height={12} radius={0} style={styles.skeletonGap} />
        <Skeleton width={110} height={10} radius={0} style={styles.skeletonGap} />
      </View>
      <View style={[styles.cta, { borderLeftColor: C.rule }]} />
    </View>
  );
}

export function LoungeListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <View>
      {Array.from({ length: count }, (_, index) => (
        <LoungeCardSkeleton key={index} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    minHeight: ROW_MIN_HEIGHT,
    borderBottomWidth: Rule.hair,
  },
  well: {
    width: WELL,
    borderRightWidth: Rule.hair,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  tag: {
    ...Type.heading(12),
    letterSpacing: 12 * 0.06,
  },

  body: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 11,
    paddingHorizontal: 10,
    justifyContent: 'center',
  },
  name: {
    ...Type.heading(14),
    letterSpacing: 14 * 0.01,
  },
  /*
    14px, not the prototype's 12: the handoff's own type scale puts Body at
    14–16px, and this is the one line of real prose on the row.
  */
  description: {
    ...Type.body(14),
    lineHeight: 20,
    marginTop: 2,
  },
  meta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Space.sm,
    marginTop: 7,
  },
  metaLabel: {
    ...Type.label(10),
    letterSpacing: 10 * 0.09,
  },
  live: {
    ...Type.label(10),
    letterSpacing: 10 * 0.09,
  },

  cta: {
    width: CTA,
    borderLeftWidth: Rule.hair,
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  ctaBusy: {
    opacity: 0.55,
  },
  ctaLabel: {
    ...Type.heading(11),
    letterSpacing: 11 * 0.08,
  },

  skeletonGap: {
    marginTop: Space.sm,
  },
});
