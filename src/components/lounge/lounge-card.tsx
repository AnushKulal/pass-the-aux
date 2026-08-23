/**
 * One lounge row — Explore and the Lounges tab share it.
 *
 * design/v2 "Lounges" and "Explore" draw the same row twice: a raised card, an
 * artwork tile carrying the lounge's tag, the name, and one or two lines under
 * it. The two artboards differ only in what the row can know — Explore has a
 * description and no roster (RLS hides it), Lounges has counts and a live pill.
 *
 * The live treatment is the only accent the row is allowed, and it comes in two
 * registers: a pill when there is a NUMBER to report, a bare dot when a Session
 * is up but empty. Both mean the same thing — there is something to walk into.
 *
 * REPLACES the Patchbay row this file used to hold: a ruled band with a JOIN
 * cell cut off by a hairline. Nothing imported it any more, and both screens
 * had grown a private copy of the v2 row instead.
 */

import { Image } from 'expo-image';
import { memo, useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View, type TextStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { LiveDot } from '@/components/feed/live-dot';
import { Skeleton } from '@/components/ui';
import {
  Duration,
  Fonts,
  Radii,
  Rule,
  Space,
  Stagger,
  Type,
  raised,
  tracking,
} from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

/** design/v2: a 56px tile inside 13px of padding, so the row clears 44 twice over. */
const TILE = 56;

/** `Type.readout` hands back a readonly tuple; TextStyle wants a mutable one. */
const readout = (size: number): TextStyle => ({
  ...Type.readout(size),
  fontVariant: ['tabular-nums'],
});

export type LoungeCardProps = {
  name: string;
  /** Prose under the name. Explore only — the Lounges tab carries counts here. */
  description?: string | null;
  /** One line of state: the counts, or what a tap is about to do. */
  meta?: string;
  iconUrl?: string | null;
  /** Stand-in in the tile. Derived from the name when absent. */
  tag?: string;
  /** A Session is running in this lounge. */
  isLive?: boolean;
  /** People inside those Sessions. Above zero, the pill reports the number. */
  listeners?: number;
  /** A join is in flight: the row stops taking taps and steps back. */
  busy?: boolean;
  /** Position in the list, for the 55ms entrance stagger. */
  index?: number;
  onPress: () => void;
  accessibilityHint?: string;
};

/** `Bass Face` → `BF`; `Dub` → `DUB`. Never longer than four characters. */
export function tagFor(name: string, explicit?: string): string {
  if (explicit && explicit.trim()) return explicit.trim().toUpperCase().slice(0, 4);

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

function LoungeCardBase({
  name,
  description,
  meta,
  iconUrl,
  tag,
  isLive = false,
  listeners = 0,
  busy = false,
  index = 0,
  onPress,
  accessibilityHint,
}: LoungeCardProps) {
  const C = useColors();
  const reduced = useReducedMotion();

  const count = Math.max(0, listeners);
  /*
    The pill carries a number; the dot carries none. An active Session with
    nobody in it yet is still worth surfacing — it is an invitation — but a pill
    reading "0" would look like a bug rather than an opening.
  */
  const showPill = isLive && count > 0;
  const showDot = isLive && count === 0;

  const label = [
    name,
    showPill ? `${count} listening` : showDot ? 'live now' : null,
    busy ? 'joining' : meta,
  ]
    .filter(Boolean)
    .join(', ');

  // ---- entrance: translateY(8) → 0 + fade, 55ms per row, off under reduce-motion
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
        accessibilityLabel={label}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ busy }}
        disabled={busy}
        onPress={onPress}
        style={({ pressed }) => [
          styles.row,
          { backgroundColor: C.surface },
          raised(C),
          (pressed || busy) && styles.pressed,
        ]}>
        <View style={[styles.tile, { backgroundColor: C.artwork }]}>
          <Text numberOfLines={1} style={[styles.tag, { color: C.artInk }]}>
            {tagFor(name, tag)}
          </Text>

          {/* Over the tag, so the letters double as the error fallback. */}
          {iconUrl ? (
            <Image
              source={{ uri: iconUrl }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              cachePolicy="memory-disk"
              // FlatList recycles rows; without this the previous lounge's icon
              // stays on screen until the new one has decoded.
              recyclingKey={name}
              transition={Duration.press}
              accessible={false}
            />
          ) : null}
        </View>

        <View style={styles.info}>
          <View style={styles.nameRow}>
            <Text numberOfLines={1} style={[styles.name, { color: C.ink }]}>
              {name}
            </Text>
            {showDot ? <LiveDot size={6} /> : null}
          </View>

          {description ? (
            <Text numberOfLines={2} style={[styles.description, { color: C.ink2 }]}>
              {description}
            </Text>
          ) : null}

          {meta ? (
            <Text numberOfLines={1} style={[styles.meta, { color: C.ink2 }]}>
              {meta}
            </Text>
          ) : null}
        </View>

        {/*
          The design draws this pill with an inset pair. At ~29px tall only the
          dark half of that pair survives on a dark ground, so it reads as dirt
          rather than depth — a recessed fill and a hairline say the same thing
          and hold up at this size.
        */}
        {showPill ? (
          <View style={[styles.livePill, { backgroundColor: C.bgRecessed, borderColor: C.rule }]}>
            <LiveDot size={6} />
            <Text style={[styles.liveCount, { color: C.liveText }]}>{count}</Text>
          </View>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

/**
 * Memoised: these render inside FlatLists that re-render on every realtime
 * lounge update, and the whole row is pure props.
 */
export const LoungeCard = memo(LoungeCardBase);

/**
 * The row's loading twin. Lives here so its geometry cannot drift from the real
 * row's — a skeleton that resizes on load is worse than no skeleton.
 */
export function LoungeCardSkeleton({ wide = false }: { wide?: boolean }) {
  const C = useColors();

  return (
    <View style={[styles.row, { backgroundColor: C.surface }, raised(C)]}>
      <Skeleton width={TILE} height={TILE} />
      <View style={styles.skeletonInfo}>
        <Skeleton width="54%" height={14} />
        {wide ? <Skeleton width="86%" height={11} /> : null}
        <Skeleton width="32%" height={11} />
      </View>
    </View>
  );
}

/** `wide` adds the description line Explore's rows carry and Lounges' do not. */
export function LoungeListSkeleton({ count = 4, wide = false }: { count?: number; wide?: boolean }) {
  return (
    <View>
      {Array.from({ length: count }, (_, index) => (
        <LoungeCardSkeleton key={index} wide={wide} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 13,
    borderRadius: Radii.xl,
    marginBottom: 10,
  },
  pressed: {
    opacity: 0.7,
  },

  tile: {
    width: TILE,
    height: TILE,
    borderRadius: Radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Space.xs,
    overflow: 'hidden',
  },
  tag: {
    fontFamily: Fonts.extrabold,
    fontSize: 14,
    lineHeight: 17,
    letterSpacing: tracking(14, -0.02),
  },

  info: {
    flex: 1,
    minWidth: 0,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  name: {
    flexShrink: 1,
    fontFamily: Fonts.semibold,
    fontSize: 15.5,
    lineHeight: 20,
    letterSpacing: tracking(15.5, -0.015),
  },
  description: {
    ...Type.body(12.5),
    lineHeight: 17,
    marginTop: 3,
  },
  meta: {
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
    borderWidth: Rule.hair,
  },
  liveCount: {
    ...readout(11),
    fontFamily: Fonts.semibold,
  },

  skeletonInfo: {
    flex: 1,
    gap: Space.sm,
  },
});
