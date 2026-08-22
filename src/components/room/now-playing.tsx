/**
 * What the Session is playing, where the playhead is, and how far off you are.
 *
 * Four things here are load-bearing:
 *
 *  - The progress bar is driven by a local 250ms ticker over
 *    `expectedPositionMs(timeline)`, never by asking the adapter. On Spotify,
 *    `getPosition()` is a rate-limited HTTP call; polling it for a progress bar
 *    would burn the quota and still be less accurate than the arithmetic.
 *  - The `media` slot is rendered unconditionally, in a fixed tree position, in
 *    every layout. It holds the YouTube player host, and unmounting that
 *    mid-song stops the audio for this listener. When YouTube is the active
 *    provider it becomes the artwork well itself, which is what YouTube's terms
 *    expect.
 *  - The artwork well carries the two signature marks of the direction: the
 *    25px modular grid, and one horizontal accent rule straight through the
 *    middle. Everything else in the well is a typographic placeholder that real
 *    artwork drops over without moving anything.
 *  - The sync block is the only place on the screen that states a rung in
 *    words. It loses the red as drift grows; it never turns amber, because
 *    there is no amber.
 */

import { Image } from 'expo-image';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type AccessibilityActionEvent,
  type DimensionValue,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { BLURHASH_SURFACE } from '@/components/ui';
import { getClockOffset } from '@/lib/clock';
import {
  Duration,
  GRID,
  PointerEvents,
  Rule,
  Space,
  TOUCH_TARGET,
  Type,
  tracking,
} from '@/lib/theme';
import { useColors } from '@/lib/theme-context';
import { expectedPositionMs, type RoomTimeline } from '@/playback/sync-controller';
import type { ResolvedTrack } from '@/playback/types';

import {
  RUNG_LABEL,
  driftRung,
  formatClock,
  formatDrift,
  formatOffset,
  formatRemaining,
  initialFor,
  readout,
  rungColor,
} from './drift';

/** 4Hz: smooth enough that the bar never visibly steps, cheap enough to ignore. */
const TICK_MS = 250;
/** Screen-reader adjust step on the scrubber. */
const NUDGE_MS = 10_000;

/** The artwork well, exactly as the artboard. */
const WELL_HEIGHT = 250;
/** How far the 2px playhead overhangs the 6px progress track, top and bottom. */
const PLAYHEAD_BLEED = 5;
const TRACK_HEIGHT = 6;
const COMPACT_TILE = 34;

/** The gutter every block on this screen shares. */
const GUTTER = Space.md;

/** Takes the 26px scrub box the rest of the way to the 44px floor. */
const SCRUB_SLOP = { top: 9, bottom: 9, left: 0, right: 0 } as const;

export type NowPlayingProps = {
  /** The YouTube player host. Always mounted, never conditionally rendered. */
  media: ReactNode;
  /** True when the active provider is YouTube and the well should show video. */
  showMedia: boolean;
  /** Collapsed to a single row, for the docked/parked layout. */
  compact: boolean;
  track: ResolvedTrack | null;
  timeline: RoomTimeline | null;
  isLoading: boolean;
  driftMs: number;
  onResync: () => void;
  /** Whoever is on aux. Absent for passengers, who get no scrubber at all. */
  onSeek?: (positionMs: number) => void;
  errorMessage?: string | null;
  /** Whoever currently holds the aux, for the passenger line below. Optional. */
  onAuxName?: string | null;
  /** SPOTIFY / YOUTUBE, for the well's corner chip. */
  providerLabel?: string | null;
  /**
   * Best round-trip from the last clock measurement. `src/lib/clock.ts` keeps
   * this internally but does not export it, so the cell renders an honest dash
   * until it does — see the handoff note.
   */
  rttMs?: number | null;
};

export function NowPlaying({
  media,
  showMedia,
  compact,
  track,
  timeline,
  isLoading,
  driftMs,
  onResync,
  onSeek,
  errorMessage,
  onAuxName,
  providerLabel,
  rttMs,
}: NowPlayingProps) {
  const C = useColors();

  const durationMs = track?.duration_ms ?? 0;
  const trackWidth = useRef(0);

  /*
    The playhead is a clock, so it is READ at render rather than mirrored into
    state: `expectedPositionMs` is pure arithmetic over the room row and the
    corrected server time, and the only thing the timer has to do is ask for
    another frame. Copying it into state instead would mean a setState in the
    effect body on every timeline change, and a stale first frame every time a
    paused Session resumes.
  */
  const [, requestFrame] = useState(0);

  useEffect(() => {
    // A paused Session's position is a constant; there is nothing to animate.
    if (!timeline?.isPlaying) return;

    const timer = setInterval(() => requestFrame((frame) => frame + 1), TICK_MS);
    return () => clearInterval(timer);
  }, [timeline]);

  const rawPosition = timeline ? expectedPositionMs(timeline) : 0;
  const positionMs = durationMs > 0 ? Math.min(rawPosition, durationMs) : rawPosition;
  const clockOffsetMs = Math.round(getClockOffset());

  const progress = durationMs > 0 ? Math.min(1, Math.max(0, positionMs / durationMs)) : 0;
  const rung = driftRung(driftMs);
  const rungTint = rungColor(rung, C);

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    trackWidth.current = event.nativeEvent.layout.width;
  }, []);

  const handleScrub = useCallback(
    (event: GestureResponderEvent) => {
      if (!onSeek || durationMs <= 0 || trackWidth.current <= 0) return;
      const ratio = Math.min(1, Math.max(0, event.nativeEvent.locationX / trackWidth.current));
      onSeek(ratio * durationMs);
    },
    [onSeek, durationMs]
  );

  const handleAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      if (!onSeek || durationMs <= 0) return;
      const delta = event.nativeEvent.actionName === 'increment' ? NUDGE_MS : -NUDGE_MS;
      onSeek(Math.min(durationMs, Math.max(0, positionMs + delta)));
    },
    [onSeek, durationMs, positionMs]
  );

  const artworkUrl = track?.artwork_url ?? null;
  const stageVisible = showMedia && !compact;
  const initial = initialFor(track?.title);
  const barWidth = `${(progress * 100).toFixed(2)}%` as DimensionValue;

  const subtitle = track
    ? track.album
      ? `${track.artist} · ${track.album}`
      : track.artist
    : 'Add a track and the Session starts';

  if (compact) {
    return (
      <View style={[styles.compactRow, { borderColor: C.rule, backgroundColor: C.surface }]}>
        {/* Fixed tree position: parked, not unmounted. See the file header. */}
        <View style={[styles.stageParked, PointerEvents.none]}>{media}</View>

        <View style={[styles.compactTile, { backgroundColor: C.bgRecessed, borderColor: C.rule2 }]}>
          <Text style={[styles.compactInitial, { color: C.ink3 }]}>{initial}</Text>
        </View>

        <View style={styles.compactMeta}>
          <Text numberOfLines={1} style={[styles.compactTitle, { color: C.ink }]}>
            {track?.title ?? 'Nothing playing'}
          </Text>
          <Text numberOfLines={1} style={[styles.compactSub, { color: C.ink2 }]}>
            {subtitle}
          </Text>
        </View>

        <Text style={[styles.compactDrift, { color: rungTint }]}>
          {isLoading && !track ? '—' : formatDrift(driftMs)}
        </Text>
      </View>
    );
  }

  return (
    <View>
      {/*
        The media wrapper keeps ONE position in the tree in every branch of this
        component. Parking it (1×1, transparent) rather than unmounting keeps
        the WebView alive and the music playing.
      */}
      <View
        style={[
          stageVisible
            ? [styles.stage, { borderBottomColor: C.rule, backgroundColor: '#000000' }]
            : styles.stageParked,
          stageVisible ? PointerEvents.auto : PointerEvents.none,
        ]}>
        {media}
      </View>

      {stageVisible ? null : (
        <ArtworkWell
          initial={initial}
          artworkUrl={artworkUrl}
          title={track?.title ?? null}
          providerLabel={providerLabel ?? null}
        />
      )}

      <View style={styles.block}>
        <Text numberOfLines={3} style={[styles.title, { color: C.ink }]}>
          {track?.title ?? 'Nothing playing'}
        </Text>
        <Text numberOfLines={2} style={[styles.subtitle, { color: C.ink2 }]}>
          {subtitle}
        </Text>
      </View>

      <View style={styles.block}>
        <Pressable
          disabled={!onSeek}
          onLayout={handleLayout}
          onPress={handleScrub}
          accessible
          accessibilityRole={onSeek ? 'adjustable' : 'progressbar'}
          accessibilityLabel="Playback position"
          accessibilityHint={onSeek ? 'Tap anywhere on the bar to seek' : undefined}
          accessibilityValue={{
            min: 0,
            max: Math.max(1, Math.round(durationMs / 1000)),
            now: Math.round(positionMs / 1000),
            text: `${formatClock(positionMs)} of ${formatClock(durationMs)}`,
          }}
          accessibilityActions={
            onSeek ? [{ name: 'increment' }, { name: 'decrement' }] : undefined
          }
          onAccessibilityAction={handleAccessibilityAction}
          hitSlop={SCRUB_SLOP}
          style={styles.scrubber}>
          <View style={[styles.track, { backgroundColor: C.track }]}>
            <View style={[styles.trackFill, { width: barWidth, backgroundColor: C.live }]} />
            {/* Overhangs ±5px so the playhead reads as a cut through the bar,
                not as a segment of it. */}
            <View style={[styles.playhead, { left: barWidth, backgroundColor: C.liveText }]} />
          </View>
        </Pressable>

        <View style={styles.times}>
          <Text style={[styles.time, { color: C.ink2 }]}>{formatClock(positionMs)}</Text>
          <Text style={[styles.time, { color: C.ink2 }]}>
            {formatRemaining(Math.max(0, durationMs - positionMs))}
          </Text>
        </View>
      </View>

      <View style={[styles.lyrics, { borderTopColor: C.rule }]}>
        <View style={styles.lyricsHead}>
          <Text style={[styles.kicker, { color: C.ink3 }]}>Lyrics</Text>
          <Text style={[styles.kickerRight, { color: C.ink3 }]}>In time with the room</Text>
        </View>
        {/*
          There is no timed-lyrics source wired to this app. The documented
          fallback says so plainly rather than showing an empty four-line window
          that looks like a loading failure.
        */}
        <Text style={[styles.lyricsFallback, { color: C.ink3 }]}>
          No timed lyrics for this one. Aux only shows lines it can line up to the second.
        </Text>
      </View>

      <View style={[styles.syncBlock, { borderColor: C.rule2 }]}>
        <View style={[styles.syncHead, { borderBottomColor: C.rule }]}>
          <RungDot color={rungTint} live={rung === 'locked'} />
          <Text style={[styles.syncRung, { color: C.ink }]}>{`You are ${RUNG_LABEL[rung]}`}</Text>
          <Text style={[styles.syncDrift, { color: rungTint }]}>{formatDrift(driftMs)}</Text>
        </View>

        <View style={styles.syncCells}>
          <View style={[styles.syncCell, { borderRightColor: C.rule }]}>
            <Text style={[styles.cellLabel, { color: C.ink3 }]}>Clock offset</Text>
            <Text style={[styles.cellValue, { color: C.ink }]}>{formatOffset(clockOffsetMs)}</Text>
          </View>

          <View style={[styles.syncCell, { borderRightColor: C.rule }]}>
            <Text style={[styles.cellLabel, { color: C.ink3 }]}>Best RTT</Text>
            <Text style={[styles.cellValue, { color: C.ink }]}>
              {rttMs == null ? '—' : `${Math.round(rttMs)}ms`}
            </Text>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Re-anchor to the Session clock"
            accessibilityHint="Re-measures the clock offset and seeks back onto the room's position"
            onPress={onResync}
            style={({ pressed }) => [
              styles.reanchor,
              pressed ? { backgroundColor: C.liveWash } : null,
            ]}>
            <Text style={[styles.reanchorLabel, { color: C.liveText }]}>Re-anchor</Text>
          </Pressable>
        </View>
      </View>

      {errorMessage ? (
        <View
          accessibilityLiveRegion="polite"
          style={[styles.error, { borderColor: C.dangerBorder, backgroundColor: C.dangerWash }]}>
          <Text style={[styles.errorText, { color: C.ink }]}>{errorMessage}</Text>
        </View>
      ) : null}
    </View>
  );
}

// ------------------------------------------------------------ artwork well

type ArtworkWellProps = {
  initial: string;
  artworkUrl: string | null;
  title: string | null;
  providerLabel: string | null;
};

/**
 * A letter in a ruled box, with real artwork dropping straight over it. The
 * layout has to survive any artwork including bright and ugly, which is why
 * nothing is measured off the image — the chip and the caption sit on the well,
 * not on the art.
 */
const ArtworkWell = memo(function ArtworkWell({
  initial,
  artworkUrl,
  title,
  providerLabel,
}: ArtworkWellProps) {
  const C = useColors();

  return (
    <View style={[styles.well, { backgroundColor: C.bgRecessed, borderBottomColor: C.rule }]}>
      <ModularGrid />

      {artworkUrl ? (
        <Image
          source={{ uri: artworkUrl }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="memory-disk"
          placeholder={{ blurhash: BLURHASH_SURFACE }}
          transition={Duration.press}
          accessibilityIgnoresInvertColors
          accessibilityLabel={title ? `Artwork for ${title}` : undefined}
        />
      ) : (
        <>
          <Text style={[styles.wellInitial, { color: C.surface3 }]}>{initial}</Text>
          <Text style={[styles.wellCaption, { color: C.ink3 }]}>Artwork — drop in real art</Text>
        </>
      )}

      {/* The one accent mark on the well: a rule straight through the middle. */}
      <View style={[styles.wellRule, { backgroundColor: C.liveMid }, PointerEvents.none]} />

      {providerLabel ? (
        <View style={[styles.wellChip, { backgroundColor: C.live }]}>
          <Text style={[styles.wellChipLabel, { color: C.onLive }]}>{providerLabel}</Text>
        </View>
      ) : null}
    </View>
  );
});

/**
 * The 25px modular grid. Shared with the sync orbit's dial — it is the one
 * texture in this direction, and it only ever appears inside a well, never
 * across a whole screen.
 */
export const ModularGrid = memo(function ModularGrid({ step = GRID }: { step?: number }) {
  const C = useColors();
  const [size, setSize] = useState({ width: 0, height: 0 });

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize((current) =>
      current.width === width && current.height === height ? current : { width, height }
    );
  }, []);

  const lines = useMemo(() => {
    const columns = size.width > 0 ? Math.ceil(size.width / step) : 0;
    const rows = size.height > 0 ? Math.ceil(size.height / step) : 0;
    return {
      columns: Array.from({ length: columns }, (_, index) => index * step),
      rows: Array.from({ length: rows }, (_, index) => index * step),
    };
  }, [size, step]);

  return (
    <View
      onLayout={onLayout}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, PointerEvents.none]}>
      {lines.columns.map((left) => (
        <View key={`c${left}`} style={[styles.gridColumn, { left, backgroundColor: C.grid }]} />
      ))}
      {lines.rows.map((top) => (
        <View key={`r${top}`} style={[styles.gridRow, { top, backgroundColor: C.grid }]} />
      ))}
    </View>
  );
});

// --------------------------------------------------------------- rung dot

/**
 * The 8px square that pulses while you are locked. It stops pulsing — and stops
 * being red — the moment you are not, so the motion itself is a sync signal
 * rather than decoration.
 */
const RungDot = memo(function RungDot({ color, live }: { color: string; live: boolean }) {
  const reduced = useReducedMotion();
  const pulse = useSharedValue(1);

  useEffect(() => {
    if (reduced || !live) {
      cancelAnimation(pulse);
      pulse.value = 1;
      return;
    }
    pulse.value = withRepeat(withTiming(0.35, { duration: 700 }), -1, true);
    return () => cancelAnimation(pulse);
  }, [reduced, live, pulse]);

  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.rungDot, { backgroundColor: color }, style]}
    />
  );
});

const styles = StyleSheet.create({
  // ------------------------------------------------------------------ well
  stage: {
    width: '100%',
    height: WELL_HEIGHT,
    borderBottomWidth: Rule.major,
    overflow: 'hidden',
  },
  /** Mounted and audible, out of the layout, effectively invisible. */
  stageParked: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 1,
    height: 1,
    opacity: 0,
  },
  well: {
    position: 'relative',
    height: WELL_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderBottomWidth: Rule.major,
  },
  wellInitial: {
    ...Type.display(118),
    lineHeight: 96,
    letterSpacing: tracking(118, -0.06),
  },
  wellCaption: {
    ...Type.label(10),
    position: 'absolute',
    left: GUTTER,
    bottom: GUTTER,
  },
  wellRule: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    height: Rule.major,
  },
  wellChip: {
    position: 'absolute',
    right: GUTTER,
    top: GUTTER,
    paddingHorizontal: 7,
    paddingVertical: Space.xs,
  },
  wellChipLabel: {
    ...Type.heading(10),
    letterSpacing: tracking(10, 0.1),
    textTransform: 'uppercase',
  },
  gridColumn: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
  },
  gridRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
  },

  // ----------------------------------------------------------------- title
  block: {
    paddingHorizontal: GUTTER,
    paddingTop: Space.lg - 2,
  },
  title: {
    ...Type.display(26),
    lineHeight: 27,
    letterSpacing: tracking(26, -0.03),
  },
  subtitle: {
    ...Type.body(16),
    marginTop: 3,
  },

  // -------------------------------------------------------------- progress
  /*
    The playhead bleeds ±5px past the track, so the padding starts there. The
    rest of the 44px target comes from hitSlop rather than more padding —
    Android clips touches that fall outside the parent's own bounds, so growing
    the box is the only way to grow the target, and this block only has 16px of
    vertical budget to give.
  */
  scrubber: {
    paddingVertical: PLAYHEAD_BLEED + 5,
  },
  track: {
    height: TRACK_HEIGHT,
    position: 'relative',
  },
  trackFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
  },
  playhead: {
    position: 'absolute',
    top: -PLAYHEAD_BLEED,
    bottom: -PLAYHEAD_BLEED,
    width: 2,
    marginLeft: -1,
  },
  times: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: Space.sm - 2,
  },
  time: {
    ...readout(11),
    letterSpacing: tracking(11, 0.06),
  },

  // ---------------------------------------------------------------- lyrics
  lyrics: {
    marginTop: Space.lg,
    borderTopWidth: Rule.major,
  },
  lyricsHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: Space.md,
    paddingHorizontal: GUTTER,
    paddingTop: Space.md - 2,
    paddingBottom: Space.sm - 2,
  },
  kicker: {
    ...Type.label(10),
  },
  kickerRight: {
    ...Type.label(10),
    letterSpacing: tracking(10, 0.09),
    flexShrink: 1,
    textAlign: 'right',
  },
  lyricsFallback: {
    ...Type.body(16),
    paddingHorizontal: GUTTER,
    paddingBottom: Space.lg - 2,
  },

  // ------------------------------------------------------------ sync block
  syncBlock: {
    marginTop: Space.lg - 2,
    marginHorizontal: GUTTER,
    borderWidth: Rule.hair,
  },
  syncHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    paddingHorizontal: 11,
    paddingVertical: Space.md - 2,
    borderBottomWidth: Rule.hair,
  },
  rungDot: {
    width: 8,
    height: 8,
    flexGrow: 0,
    flexShrink: 0,
  },
  syncRung: {
    ...Type.heading(11),
    letterSpacing: tracking(11, 0.09),
    textTransform: 'uppercase',
    flex: 1,
  },
  syncDrift: {
    ...readout(12),
  },
  syncCells: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  syncCell: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 11,
    paddingVertical: Space.sm,
    justifyContent: 'center',
    borderRightWidth: Rule.hair,
  },
  cellLabel: {
    ...Type.label(10),
    letterSpacing: tracking(10, 0.11),
  },
  cellValue: {
    ...readout(13),
    marginTop: 2,
  },
  reanchor: {
    minHeight: TOUCH_TARGET,
    flexGrow: 0,
    flexShrink: 0,
    paddingHorizontal: GUTTER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reanchorLabel: {
    ...Type.heading(10),
    letterSpacing: tracking(10, 0.09),
    textTransform: 'uppercase',
  },

  // ----------------------------------------------------------------- error
  error: {
    marginTop: Space.md,
    marginHorizontal: GUTTER,
    padding: Space.md,
    borderWidth: Rule.hair,
  },
  errorText: {
    ...Type.body(16),
  },

  // --------------------------------------------------------------- compact
  compactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm + 2,
    paddingHorizontal: GUTTER,
    paddingVertical: Space.sm,
    minHeight: 56,
    borderTopWidth: Rule.major,
  },
  compactTile: {
    width: COMPACT_TILE,
    height: COMPACT_TILE,
    flexGrow: 0,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: Rule.hair,
  },
  compactInitial: {
    ...readout(15),
  },
  compactMeta: {
    flex: 1,
    minWidth: 0,
  },
  compactTitle: {
    ...Type.heading(13),
    letterSpacing: tracking(13, 0.03),
  },
  compactSub: {
    ...Type.body(12),
  },
  compactDrift: {
    ...readout(12),
    flexGrow: 0,
    flexShrink: 0,
    textAlign: 'right',
  },
});
