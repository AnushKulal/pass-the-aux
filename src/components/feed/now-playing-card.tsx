/**
 * One Feed row — "who is listening to what, right now".
 *
 * Patchbay geometry, exact from README §6: a 78px band ruled into three cells.
 *
 *   [64px artwork well │] [ title · artist · LOUNGE · person chip + provider ] [│ 70px readout ]
 *   └────────────────────── 2px progress track pinned to the bottom edge ─────────────────────┘
 *
 * Two targets live in this one row and they mean different things: the person
 * chip opens that person, everything else walks into the Session. The chip
 * therefore stops propagation and carries its own 44px hit box.
 *
 * The bar is the point of the screen. It advances against the SERVER clock on a
 * 250ms tick, interpolated from the last presence beat, so three rows ticking
 * at once is the moment the product explains itself.
 */

import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type DimensionValue,
  type TextStyle,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { useToast } from '@/components/ui';
import { livePositionMs } from '@/features/presence/presence-client';
import type { FeedEntry } from '@/features/presence/use-lounge-presence';
import { serverNow } from '@/lib/clock';
import { Duration, Fonts, Rule, Space, Stagger, TOUCH_TARGET, Type } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

/** README §6: the row is 78, the well is 64, the readout column is 70. */
const ROW_HEIGHT = 78;
const WELL = 64;
const RAIL = 70;

/** The chip's avatar is a 16px square well; the chip itself reaches 44 by hit box. */
const CHIP_AVATAR = 16;
const CHIP_SLOP = Math.round((TOUCH_TARGET - CHIP_AVATAR) / 2);

/** README, "Live behaviour": playback position advances on a 250ms tick. */
const TICK_MS = 250;

/** `Type.readout` hands back a readonly tuple; TextStyle wants a mutable one. */
const readout = (size: number): TextStyle => ({
  ...Type.readout(size),
  fontVariant: ['tabular-nums'],
});

// ------------------------------------------------------------- the shared clock

/**
 * One timer for the entire Feed.
 *
 * Every row advances its own bar between presence beats, but N rows with N
 * intervals is N wakeups per tick on a phone. They all want the same answer to
 * the same question — what time is it on the server — so they share one timer,
 * and it stops completely when the last row unmounts.
 */
const tickListeners = new Set<(nowMs: number) => void>();
let ticker: ReturnType<typeof setInterval> | null = null;

function subscribeTick(listener: (nowMs: number) => void): () => void {
  tickListeners.add(listener);

  if (ticker === null) {
    ticker = setInterval(() => {
      const now = serverNow();
      for (const notify of tickListeners) notify(now);
    }, TICK_MS);
  }

  return () => {
    tickListeners.delete(listener);
    if (tickListeners.size === 0 && ticker !== null) {
      clearInterval(ticker);
      ticker = null;
    }
  };
}

function useServerNow(): number {
  const [now, setNow] = useState(serverNow);
  useEffect(() => subscribeTick(setNow), []);
  return now;
}

/** `1:47`. A number that measures, so it sets as a readout with tabular figures. */
function timecode(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1_000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

function glyphFor(value: string | null | undefined): string {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed[0]!.toUpperCase() : '·';
}

// -------------------------------------------------------------------- the row

export type NowPlayingCardProps = {
  entry: FeedEntry;
  /**
   * Position in the list. Rows stagger in at 55ms steps (README, "Module
   * transitions"), which needs to know where in the run this one sits.
   */
  index?: number;
  /** People from your lounges inside the same Session. Renders as `N IN`. */
  listeners?: number;
};

function NowPlayingCardBase({ entry, index = 0, listeners }: NowPlayingCardProps) {
  const C = useColors();
  const router = useRouter();
  const toast = useToast();
  const nowMs = useServerNow();
  const reduced = useReducedMotion();

  /*
    `isLive` is not "this person has a track loaded", it is "there is a Session
    here you can walk into" — and it is the only thing on the row allowed to
    reach for the accent. Somebody listening alone gets the identical layout in
    ink2, which is what keeps the red meaning anything at all.
  */
  const isLive = entry.roomId !== null;
  const title = entry.trackTitle ?? 'Getting the aux ready';
  const subtitle = [entry.artist, entry.loungeName.toUpperCase()].filter(Boolean).join(' · ');

  // Interpolated locally against the server clock, so the bar and the timecode
  // keep moving between presence beats instead of stepping once a heartbeat.
  const positionMs = livePositionMs(entry, nowMs);
  const progress = entry.durationMs > 0 ? Math.min(1, Math.max(0, positionMs / entry.durationMs)) : 0;

  const providerName = entry.provider === 'youtube' ? 'YOUTUBE' : entry.provider === 'spotify' ? 'SPOTIFY' : null;

  const summary = [
    entry.trackTitle
      ? `${entry.displayName} is playing ${entry.trackTitle}`
      : `${entry.displayName} is in a Session`,
    entry.artist ? `by ${entry.artist}` : null,
    `in ${entry.loungeName}`,
    providerName ? `on ${providerName.toLowerCase()}` : null,
    isLive ? 'live now' : 'listening alone',
  ]
    .filter(Boolean)
    .join(', ');

  // ---- entrance: translateY(8) → 0 + fade, 55ms per row, off under reduce-motion
  const enter = useSharedValue(reduced ? 1 : 0);
  /*
    The stagger is read once, at mount. Presence reorders the Feed the moment
    somebody starts playing, and reading `index` live would re-run the entrance
    on rows that never left the screen.
  */
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

  const openRoom = useCallback(() => {
    if (entry.roomId === null) {
      toast.show(`@${entry.username} is listening alone — nothing to join`, 'info');
      return;
    }
    // Object form rather than a template literal: it stays valid under typed
    // routes regardless of whether the route types have been generated yet.
    router.push({ pathname: '/room/[id]', params: { id: entry.roomId } });
  }, [entry.roomId, entry.username, router, toast]);

  /*
    There is no route for another person's profile yet (see the handoff's Schema
    gaps: `profiles.bio`, presence and photo columns are all still missing), so
    the chip keeps its own target and says so plainly rather than pushing into a
    404. The moment that screen lands this becomes a router.push and nothing
    else on the row changes.
  */
  const openProfile = useCallback(() => {
    toast.show(`@${entry.username} has no profile page yet`, 'info');
  }, [entry.username, toast]);

  return (
    <Animated.View style={entering}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={summary}
        accessibilityHint={isLive ? 'Joins this Session' : undefined}
        onPress={openRoom}
        style={({ pressed }) => [
          styles.row,
          { borderBottomColor: C.rule, backgroundColor: pressed ? C.surface : 'transparent' },
        ]}>
        {/* Artwork well. A ruled box with a letter glyph that real art drops
            straight into — the geometry never moves, however bright the art. */}
        <View style={[styles.well, { borderRightColor: C.rule, backgroundColor: C.bgRecessed }]}>
          <Text style={[styles.wellGlyph, { color: C.artwork }]}>{glyphFor(entry.trackTitle)}</Text>

          {entry.artworkUrl ? (
            <Image
              source={{ uri: entry.artworkUrl }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              cachePolicy="memory-disk"
              // FlatList recycles rows; without this the previous listener's
              // artwork stays on screen until the new one has decoded.
              recyclingKey={entry.userId}
              transition={Duration.press}
              accessible={false}
            />
          ) : null}
        </View>

        <View style={styles.info}>
          <Text numberOfLines={1} style={[styles.title, { color: C.ink }]}>
            {title}
          </Text>
          <Text numberOfLines={1} style={[styles.subtitle, { color: C.ink2 }]}>
            {subtitle}
          </Text>

          <View style={styles.chipRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open @${entry.username}'s profile`}
              onPress={openProfile}
              hitSlop={{ top: CHIP_SLOP, bottom: CHIP_SLOP, left: Space.sm, right: Space.sm }}
              style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}>
              <View style={[styles.chipAvatar, { backgroundColor: C.avatar }]}>
                <Text style={[styles.chipInitial, { color: C.ink2 }]}>
                  {glyphFor(entry.displayName)}
                </Text>
              </View>
              <Text numberOfLines={1} style={[styles.chipHandle, { color: C.ink2 }]}>
                {`@${entry.username}`}
              </Text>
            </Pressable>

            {providerName ? (
              <Text style={[styles.provider, { color: C.ink2, borderColor: C.rule2 }]}>
                {providerName}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={[styles.rail, { borderLeftColor: C.rule }]}>
          <Text style={[styles.cta, { color: isLive ? C.liveText : C.ink2 }]}>
            {isLive ? 'JOIN' : 'SOLO'}
          </Text>
          <Text style={[styles.railMeta, { color: C.ink2 }]}>
            {isLive ? `${listeners ?? 1} IN` : 'ALONE'}
          </Text>
          <Text style={[styles.elapsed, { color: C.ink3 }]}>{timecode(positionMs)}</Text>
        </View>

        {/* Pinned to the row's bottom edge, starting where the well ends. */}
        <View style={[styles.track, { backgroundColor: C.track }]}>
          <View
            style={[
              styles.trackFill,
              {
                backgroundColor: C.live,
                width: `${(progress * 100).toFixed(2)}%` as DimensionValue,
              },
            ]}
          />
        </View>
      </Pressable>
    </Animated.View>
  );
}

/**
 * Memoised because presence re-emits the whole lounge roster on every sync:
 * one person changing song must not re-render every other row in the Feed.
 */
export const NowPlayingCard = memo(NowPlayingCardBase);

const styles = StyleSheet.create({
  row: {
    height: ROW_HEIGHT,
    flexDirection: 'row',
    borderBottomWidth: Rule.hair,
  },

  well: {
    width: WELL,
    height: '100%',
    borderRightWidth: Rule.hair,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  wellGlyph: {
    ...Type.display(26),
    // The glyph is a stand-in, not a title: centre it in the box rather than on
    // a baseline the box does not have.
    lineHeight: 30,
  },

  /*
    The column's height budget is exact. RN is border-box, so the 1px bottom
    rule eats into the 78: 10 + 18 (title) + 1 + 15 (sub) + 7 + 16 (chip) + 10
    lands on 77 and nothing clips.
  */
  info: {
    flex: 1,
    minWidth: 0,
    paddingLeft: 10,
    paddingRight: 10,
    paddingTop: 10,
    paddingBottom: 10,
  },
  /** README §6 spells this one out: 15px at 600, sentence case, not a label. */
  title: {
    fontFamily: Fonts.semibold,
    fontSize: 15,
    lineHeight: 18,
  },
  subtitle: {
    ...Type.body(12),
    lineHeight: 15,
    marginTop: 1,
  },

  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    marginTop: 7,
  },
  /*
    16px tall so the row stays 78, but a 44x44 target via hitSlop. The gap to
    the provider badge is Space.sm — the badge is not a target, so the 8px
    between-targets floor is satisfied by the row's own Pressable being the
    parent rather than a sibling.
  */
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: CHIP_AVATAR,
    maxWidth: 150,
  },
  chipPressed: {
    opacity: 0.6,
  },
  chipAvatar: {
    width: CHIP_AVATAR,
    height: CHIP_AVATAR,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipInitial: {
    ...Type.heading(10),
    lineHeight: 12,
    letterSpacing: 0,
  },
  chipHandle: {
    ...Type.body(11),
    lineHeight: 14,
    flexShrink: 1,
  },
  provider: {
    ...Type.label(10),
    lineHeight: 12,
    borderWidth: Rule.hair,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },

  rail: {
    width: RAIL,
    borderLeftWidth: Rule.hair,
    justifyContent: 'center',
    alignItems: 'flex-start',
    paddingHorizontal: 10,
    gap: 5,
  },
  cta: {
    ...Type.heading(11),
    lineHeight: 13,
    letterSpacing: 11 * 0.09,
  },
  railMeta: {
    ...Type.body(10),
    lineHeight: 12,
    letterSpacing: 10 * 0.06,
  },
  elapsed: {
    ...readout(11),
    lineHeight: 13,
  },

  track: {
    position: 'absolute',
    left: WELL,
    right: 0,
    bottom: 0,
    height: Rule.major,
  },
  trackFill: {
    height: Rule.major,
  },
});
