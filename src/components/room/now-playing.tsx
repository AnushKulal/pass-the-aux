/**
 * The Session stage: the art, the title, the waveform, the sync readout.
 *
 * Built from design/v2/aux-v2.dc.html, screen "Session".
 *
 * Three things are load-bearing:
 *
 *  - The `media` slot is rendered unconditionally, in a FIXED tree position, in
 *    every branch of this component. It holds the YouTube player host, and
 *    unmounting that mid-song stops the audio for this listener. When YouTube
 *    is the active provider the slot becomes the art tile itself; otherwise it
 *    parks at 1×1 and keeps playing.
 *  - The playhead is driven by a local 250ms ticker over
 *    `expectedPositionMs(timeline)`, never by asking the adapter. On Spotify,
 *    `getPosition()` is a rate-limited HTTP call.
 *  - The sync readout loses the red as drift grows; it never turns amber,
 *    because there is no amber.
 */

import { Image } from 'expo-image';
import { MoreHorizontal, RotateCw } from 'lucide-react-native';
import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type AccessibilityActionEvent,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';

import { BLURHASH_SURFACE } from '@/components/ui';
import {
  Duration,
  Fonts,
  GRID,
  PointerEvents,
  Space,
  TOUCH_TARGET,
  Type,
  tracking,
} from '@/lib/theme';
import { useColors } from '@/lib/theme-context';
import { expectedPositionMs, type RoomTimeline } from '@/playback/sync-controller';
import type { ResolvedTrack } from '@/playback/types';

import { RUNG_LABEL, driftRung, formatClock, formatDrift, initialFor, rungColor } from './drift';

/** 4Hz: smooth enough that the bar never visibly steps, cheap enough to ignore. */
const TICK_MS = 250;
/** Screen-reader adjust step on the scrubber. */
const NUDGE_MS = 10_000;

/** The art tile, exactly as the artboard: 252 square, 26 corner. */
const ART = 252;
const ART_RADIUS = 26;

/** Takes the 36px waveform the rest of the way to the 44px floor. */
const SCRUB_SLOP = { top: 6, bottom: 6, left: 0, right: 0 } as const;

/** The artboard's 32 bars. Fixed, not random — the shape is part of the screen. */
const WAVE = [
  28, 48, 34, 64, 40, 76, 52, 30, 58, 92, 44, 36, 68, 54, 32, 56, 100, 38, 66, 48, 26, 44, 72, 54,
  82, 34, 60, 46, 78, 30, 52, 68,
] as const;

export type NowPlayingProps = {
  /** The YouTube player host. Always mounted, never conditionally rendered. */
  media: ReactNode;
  /** True when the active provider is YouTube and the tile should show video. */
  showMedia: boolean;
  track: ResolvedTrack | null;
  timeline: RoomTimeline | null;
  isLoading: boolean;
  driftMs: number;
  /** Re-measures the clock offset and seeks back onto the room's position. */
  onResync: () => void;
  /** Opens the lobby controls. */
  onMore: () => void;
  /** Whoever is on aux. Absent for passengers, who get no scrubber at all. */
  onSeek?: (positionMs: number) => void;
  errorMessage?: string | null;
};

export function NowPlaying({
  media,
  showMedia,
  track,
  timeline,
  isLoading,
  driftMs,
  onResync,
  onMore,
  onSeek,
  errorMessage,
}: NowPlayingProps) {
  const C = useColors();

  const durationMs = track?.duration_ms ?? 0;
  const trackWidth = useRef(0);

  /*
    The playhead is a clock, so it is READ at render rather than mirrored into
    state: `expectedPositionMs` is pure arithmetic over the room row and the
    corrected server time, and the only thing the timer has to do is ask for
    another frame.
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

  const initial = initialFor(track?.title);
  const played = Math.round(progress * WAVE.length);

  const subtitle = track ? (track.album ? `${track.artist} · ${track.album}` : track.artist) : '—';

  return (
    <View>
      <View style={styles.stageWrap}>
        {/*
          ONE position in the tree, in every branch. Parking it (1×1,
          transparent) rather than unmounting keeps the WebView alive and the
          music playing.
        */}
        <View
          style={[
            showMedia ? [styles.stage, { backgroundColor: '#000000' }] : styles.stageParked,
            showMedia ? PointerEvents.auto : PointerEvents.none,
          ]}>
          {media}
        </View>

        {showMedia ? null : (
          <ArtTile initial={initial} artworkUrl={track?.artwork_url ?? null} title={track?.title ?? null} />
        )}
      </View>

      <View style={styles.head}>
        <GlyphButton icon={RotateCw} label="Re-anchor to the Session clock" onPress={onResync} />

        <View style={styles.headMeta}>
          <Text numberOfLines={1} style={[styles.title, { color: C.ink }]}>
            {track?.title ?? 'Nothing playing'}
          </Text>
          <Text numberOfLines={1} style={[styles.artist, { color: C.ink2 }]}>
            {subtitle}
          </Text>
        </View>

        <GlyphButton icon={MoreHorizontal} label="Session controls" onPress={onMore} />
      </View>

      <View style={styles.progress}>
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
          accessibilityActions={onSeek ? [{ name: 'increment' }, { name: 'decrement' }] : undefined}
          onAccessibilityAction={handleAccessibilityAction}
          hitSlop={SCRUB_SLOP}
          style={styles.wave}>
          {WAVE.map((height, index) => (
            <View
              key={index}
              style={[
                styles.bar,
                { height: `${height}%`, backgroundColor: index < played ? C.ink : C.ink3 },
              ]}
            />
          ))}
        </Pressable>

        <View style={styles.times}>
          <Text style={[styles.time, { color: C.ink2 }]}>{formatClock(positionMs)}</Text>
          <Text style={[styles.sync, { color: rungTint }]}>
            {isLoading && !track ? '—' : `${RUNG_LABEL[rung]} · ${formatDrift(driftMs)}`}
          </Text>
          <Text style={[styles.time, { color: C.ink2 }]}>{formatClock(durationMs)}</Text>
        </View>
      </View>

      {errorMessage ? (
        <Text accessibilityLiveRegion="polite" style={[styles.error, { color: C.liveText }]}>
          {errorMessage}
        </Text>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------- art tile

/**
 * A letter on a bright tile, with real artwork dropping straight over it.
 * `artwork` INVERTS between themes, so anything drawn on it must use `artInk`.
 */
const ArtTile = memo(function ArtTile({
  initial,
  artworkUrl,
  title,
}: {
  initial: string;
  artworkUrl: string | null;
  title: string | null;
}) {
  const C = useColors();

  return (
    <View
      style={[
        styles.art,
        { backgroundColor: C.artwork },
        // A wide, soft bloom: the art is meant to look lit, not pasted on.
        { boxShadow: [{ offsetX: 0, offsetY: 26, blurRadius: 70, color: C.glow }] },
      ]}>
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
        <Text style={[styles.artInitial, { color: C.artInk }]}>{initial}</Text>
      )}
    </View>
  );
});

// ------------------------------------------------------------ glyph button

/** A bare glyph on the title row. 44px target, no fill — the artboard's ♡ and ···. */
const GlyphButton = memo(function GlyphButton({
  icon: Icon,
  label,
  onPress,
}: {
  icon: typeof RotateCw;
  label: string;
  onPress: () => void;
}) {
  const C = useColors();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.glyph, pressed ? styles.dim : null]}>
      <Icon size={19} strokeWidth={2} color={C.ink2} />
    </Pressable>
  );
});

// ------------------------------------------------------------ modular grid

/**
 * The 25px modular grid, kept here because the sync orbit's dial draws it too.
 * It only ever appears inside a well, never across a whole screen.
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

  const columns = size.width > 0 ? Math.ceil(size.width / step) : 0;
  const rows = size.height > 0 ? Math.ceil(size.height / step) : 0;

  return (
    <View
      onLayout={onLayout}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, PointerEvents.none]}>
      {Array.from({ length: columns }, (_, index) => index * step).map((left) => (
        <View key={`c${left}`} style={[styles.gridColumn, { left, backgroundColor: C.grid }]} />
      ))}
      {Array.from({ length: rows }, (_, index) => index * step).map((top) => (
        <View key={`r${top}`} style={[styles.gridRow, { top, backgroundColor: C.grid }]} />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  // -------------------------------------------------------------- the art
  stageWrap: {
    alignItems: 'center',
    paddingTop: Space.xxl + 2,
  },
  stage: {
    width: '100%',
    maxWidth: ART,
    aspectRatio: 1,
    borderRadius: ART_RADIUS,
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
  art: {
    width: '100%',
    maxWidth: ART,
    aspectRatio: 1,
    borderRadius: ART_RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  artInitial: {
    fontFamily: Fonts.extrabold,
    fontSize: 96,
    letterSpacing: tracking(96, -0.06),
  },

  // -------------------------------------------------------------- the head
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: Space.xxl + 4,
    paddingHorizontal: Space.lg,
  },
  headMeta: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    paddingHorizontal: Space.md,
  },
  title: {
    ...Type.display(27),
    lineHeight: 29,
    letterSpacing: tracking(27, -0.03),
    textAlign: 'center',
  },
  artist: {
    ...Type.body(14),
    marginTop: 4,
    textAlign: 'center',
  },
  glyph: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dim: {
    opacity: 0.5,
  },

  // ---------------------------------------------------------- the waveform
  progress: {
    paddingTop: Space.xxl + 2,
    paddingHorizontal: Space.xxl + 4,
  },
  wave: {
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5.5,
  },
  bar: {
    flex: 1,
    minWidth: 0,
    borderRadius: 1,
  },
  times: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.sm,
    marginTop: Space.sm + 2,
  },
  time: {
    fontFamily: Fonts.semibold,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  sync: {
    fontFamily: Fonts.extrabold,
    fontSize: 12,
    letterSpacing: tracking(12, 0.04),
    fontVariant: ['tabular-nums'],
    flexShrink: 1,
  },
  error: {
    ...Type.body(13),
    marginTop: Space.md,
    paddingHorizontal: Space.xxl + 4,
    textAlign: 'center',
  },

  // --------------------------------------------------------- modular grid
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
});
