/**
 * One Feed row — who is listening, and to what.
 *
 * design/v2 "Feed", the `liveFeed` / `idleFeed` loops. Two skins of one row:
 *
 *   live — a raised card: 52px avatar tile with a pulsing badge, handle, line,
 *          and a tabular timecode on the right.
 *   idle — the identical geometry with the card taken away and every value
 *          stepped down one ink. Nothing to join, so nothing lifts off the page.
 *
 * The timecode is the point of the screen. It advances against the SERVER clock
 * on a 250ms tick, interpolated from the last presence beat, so several rows
 * ticking at once is the moment the product explains itself.
 */

import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
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
import { useToast } from '@/components/ui';
import { livePositionMs } from '@/features/presence/presence-client';
import type { FeedEntry } from '@/features/presence/use-lounge-presence';
import { serverNow } from '@/lib/clock';
import { Duration, Fonts, Radii, Space, Stagger, Type, raised } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

/** The avatar tile, and the badge sitting on its corner. */
const TILE = 52;
const BADGE = 13;

/** Playback position advances on a 250ms tick. */
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
 * Every row advances its own timecode between presence beats, but N rows with N
 * intervals is N wakeups per tick on a phone. They all want the same answer to
 * the same question — what time is it on the server — so they share one timer,
 * and it stops completely when the last subscriber unmounts.
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

/**
 * The server clock, ticking. Exported so the Feed's hero card rides the same
 * timer as the rows underneath it instead of starting a second one.
 */
export function useFeedClock(): number {
  const [now, setNow] = useState(serverNow);
  useEffect(() => subscribeTick(setNow), []);
  return now;
}

/** `1:47`. A number that measures, so it sets with tabular figures. */
export function timecode(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1_000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

export function glyphFor(value: string | null | undefined): string {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed[0]!.toUpperCase() : '·';
}

// -------------------------------------------------------------------- the row

export type NowPlayingCardProps = {
  entry: FeedEntry;
  /**
   * Position in the list. Rows stagger in at 55ms steps, which needs to know
   * where in the run this one sits.
   */
  index?: number;
};

function NowPlayingCardBase({ entry, index = 0 }: NowPlayingCardProps) {
  const C = useColors();
  const router = useRouter();
  const toast = useToast();
  const nowMs = useFeedClock();
  const reduced = useReducedMotion();

  /*
    `isLive` is not "this person has a track loaded", it is "there is a Session
    here you can walk into" — and it is the only thing on the row allowed to
    reach for the accent or the card. Somebody listening alone gets the
    identical layout flattened onto the ground.
  */
  const isLive = entry.roomId !== null;
  const positionMs = livePositionMs(entry, nowMs);

  /*
    A Session with nothing queued yet is live — you can still walk in — but it
    has no clock to report. A timecode counting up from 0:00 over silence is
    the one number on this screen that would be untrue.
  */
  const hasTrack = entry.trackTitle !== null;

  const line = entry.trackTitle
    ? [entry.trackTitle, entry.artist].filter(Boolean).join(' — ')
    : entry.loungeName;

  const summary = [
    entry.trackTitle
      ? `${entry.displayName} is playing ${entry.trackTitle}`
      : `${entry.displayName} is in ${entry.loungeName}`,
    entry.artist ? `by ${entry.artist}` : null,
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

  const open = useCallback(() => {
    if (entry.roomId === null) {
      toast.show(`@${entry.username} is not in a Session`, 'info');
      return;
    }
    // Object form rather than a template literal: it stays valid under typed
    // routes regardless of whether the route types have been generated yet.
    router.push({ pathname: '/room/[id]', params: { id: entry.roomId } });
  }, [entry.roomId, entry.username, router, toast]);

  return (
    <Animated.View style={entering}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={summary}
        accessibilityHint={isLive ? 'Joins this Session' : undefined}
        onPress={open}
        style={({ pressed }) => [
          styles.row,
          isLive
            ? [styles.card, { backgroundColor: C.surface }, raised(C)]
            : styles.flat,
          pressed && styles.pressed,
        ]}>
        <View style={styles.tileWrap}>
          <View style={[styles.tile, { backgroundColor: C.avatar }]}>
            <Text style={[styles.initial, { color: isLive ? C.ink2 : C.ink3 }]}>
              {glyphFor(entry.displayName)}
            </Text>

            {entry.avatarUrl ? (
              <Image
                source={{ uri: entry.avatarUrl }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                cachePolicy="memory-disk"
                // FlatList recycles rows; without this the previous listener's
                // photo stays on screen until the new one has decoded.
                recyclingKey={entry.userId}
                transition={Duration.press}
                accessible={false}
              />
            ) : null}
          </View>

          {isLive ? (
            <View style={styles.badge}>
              <LiveDot size={BADGE} ringColor={C.surface} />
            </View>
          ) : null}
        </View>

        <View style={styles.info}>
          <Text numberOfLines={1} style={[styles.handle, { color: isLive ? C.ink : C.ink2 }]}>
            {entry.username}
          </Text>
          <Text numberOfLines={1} style={[styles.line, { color: isLive ? C.ink2 : C.ink3 }]}>
            {line}
          </Text>
        </View>

        {isLive && hasTrack ? (
          <Text style={[styles.elapsed, { color: C.ink2 }]}>{timecode(positionMs)}</Text>
        ) : null}
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 10,
  },
  card: {
    borderRadius: Radii.lg,
    marginBottom: 9,
  },
  /*
    The design draws 2px here. Every row is a tap target, and two targets 2px
    apart mis-fire — 8 is the floor, and on a flat row it still reads as a list
    rather than a stack of cards.
  */
  flat: {
    marginBottom: Space.sm,
  },
  pressed: {
    opacity: 0.7,
  },

  tileWrap: {
    width: TILE,
    height: TILE,
  },
  tile: {
    width: TILE,
    height: TILE,
    borderRadius: Radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  initial: {
    fontFamily: Fonts.extrabold,
    fontSize: 17,
    lineHeight: 20,
  },
  /*
    A sibling of the tile, not a child: the tile clips its photo, and the badge
    has to overhang that clip by 2px on both edges.
  */
  badge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
  },

  info: {
    flex: 1,
    minWidth: 0,
  },
  handle: {
    fontFamily: Fonts.semibold,
    fontSize: 14.5,
    lineHeight: 18,
  },
  line: {
    ...Type.body(12.5),
    lineHeight: 16,
    marginTop: 2,
  },
  elapsed: {
    ...readout(11),
    marginRight: Space.xs,
  },
});
