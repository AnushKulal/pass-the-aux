/**
 * What the Session is playing, and whether this phone agrees.
 *
 * Two things here are load-bearing:
 *
 *  - The progress bar is driven by a local 250ms ticker over
 *    `expectedPositionMs(timeline)`, never by asking the adapter. On Spotify,
 *    `getPosition()` is a rate-limited HTTP call; polling it for a progress bar
 *    would burn the quota and still be less accurate than the arithmetic.
 *  - The `media` slot is rendered unconditionally, in a fixed tree position, in
 *    both compact and full layouts. It holds the YouTube player host, and
 *    unmounting that mid-song stops the audio for this listener.
 */

import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { RefreshCw, TriangleAlert } from 'lucide-react-native';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type AccessibilityActionEvent,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { BLURHASH_SURFACE, AuxButton, ProgressBar, Skeleton } from '@/components/ui';
import { Colors, Duration, PointerEvents, Radius, Space, TOUCH_TARGET, Type } from '@/lib/theme';
import { expectedPositionMs, type RoomTimeline } from '@/playback/sync-controller';
import { Drift, type ResolvedTrack } from '@/playback/types';

/** 4Hz: smooth enough that the bar never visibly steps, cheap enough to ignore. */
const TICK_MS = 250;
/** Screen-reader adjust step on the scrubber. */
const NUDGE_MS = 10_000;

export type NowPlayingProps = {
  /** The YouTube player host. Always mounted, never conditionally rendered. */
  media: ReactNode;
  /** True when the active provider is YouTube and the stage is expanded. */
  showMedia: boolean;
  /** Collapsed to a single row so the queue/chat sheet can take the screen. */
  compact: boolean;
  track: ResolvedTrack | null;
  timeline: RoomTimeline | null;
  isLoading: boolean;
  driftMs: number;
  onResync: () => void;
  /** Host only. Absent for guests, who get no scrubber at all. */
  onSeek?: (positionMs: number) => void;
  errorMessage?: string | null;
};

function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

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
}: NowPlayingProps) {
  const durationMs = track?.duration_ms ?? 0;
  const [positionMs, setPositionMs] = useState(0);
  const trackWidth = useRef(0);

  useEffect(() => {
    if (!timeline) {
      setPositionMs(0);
      return;
    }

    const tick = () => {
      const next = expectedPositionMs(timeline);
      setPositionMs(durationMs > 0 ? Math.min(next, durationMs) : next);
    };

    tick();
    // A paused Session's position is a constant; there is nothing to animate.
    if (!timeline.isPlaying) return;

    const timer = setInterval(tick, TICK_MS);
    return () => clearInterval(timer);
  }, [timeline, durationMs]);

  const progress = durationMs > 0 ? positionMs / durationMs : 0;

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

  return (
    <View style={styles.root}>
      {/*
        Fixed tree position across compact/full. Parking it (1x1, transparent)
        rather than unmounting keeps the WebView alive and the music playing.
      */}
      <View
        style={[
          compact ? styles.stageParked : styles.stage,
          compact ? PointerEvents.none : PointerEvents.auto,
        ]}>
        <AmbientGlow active={timeline?.isPlaying === true && !compact} />
        {media}

        {showMedia ? null : (
          <View style={StyleSheet.absoluteFill}>
            {artworkUrl ? (
              <Image
                source={{ uri: artworkUrl }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                cachePolicy="memory-disk"
                placeholder={{ blurhash: BLURHASH_SURFACE }}
                transition={Duration.base}
                accessibilityIgnoresInvertColors
                accessibilityLabel={track ? `Artwork for ${track.title}` : undefined}
              />
            ) : (
              <View style={styles.artFallback} />
            )}
          </View>
        )}
      </View>

      {compact ? (
        <View style={styles.compactRow}>
          {artworkUrl ? (
            <Image
              source={{ uri: artworkUrl }}
              style={styles.compactArt}
              contentFit="cover"
              cachePolicy="memory-disk"
              placeholder={{ blurhash: BLURHASH_SURFACE }}
              transition={Duration.fast}
              accessibilityIgnoresInvertColors
            />
          ) : (
            <View style={[styles.compactArt, styles.artFallback]} />
          )}

          <View style={styles.compactMeta}>
            {isLoading && !track ? (
              <>
                <Skeleton width="70%" height={18} />
                <Skeleton width="45%" height={14} />
              </>
            ) : (
              <>
                <Text numberOfLines={1} style={styles.compactTitle}>
                  {track?.title ?? 'Nothing playing'}
                </Text>
                <Text numberOfLines={1} style={styles.artist}>
                  {track?.artist ?? 'Queue something to get started'}
                </Text>
              </>
            )}
          </View>

          <SyncBadge driftMs={driftMs} onResync={onResync} compact />
        </View>
      ) : (
        <View style={styles.meta}>
          {isLoading && !track ? (
            <>
              <Skeleton width="80%" height={28} radius={Radius.sm} />
              <Skeleton width="50%" height={18} radius={Radius.sm} />
            </>
          ) : (
            <>
              <Text numberOfLines={2} style={styles.title}>
                {track?.title ?? 'Nothing playing'}
              </Text>
              <Text numberOfLines={1} style={styles.artist}>
                {track?.artist ?? 'Add a track and the Session starts'}
              </Text>
            </>
          )}

          <SyncBadge driftMs={driftMs} onResync={onResync} compact={false} />
        </View>
      )}

      {errorMessage ? (
        // Icon carries the severity, not the text colour: Colors.danger as body
        // text lands at ~4.5:1 on bg and lower over glass, and a warning nobody
        // can read is worse than no warning.
        <View accessibilityLiveRegion="polite" style={styles.error}>
          <TriangleAlert size={18} color={Colors.danger} />
          <Text style={styles.errorText}>{errorMessage}</Text>
        </View>
      ) : null}

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
        // The bar itself is 6px; the Pressable pads it out to a real target.
        style={styles.scrubber}>
        <ProgressBar progress={progress} height={6} />
      </Pressable>

      <View style={styles.times}>
        <Text style={styles.time}>{formatClock(positionMs)}</Text>
        <Text style={styles.time}>{formatClock(durationMs)}</Text>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- sync badge

type SyncBadgeProps = { driftMs: number; onResync: () => void; compact: boolean };

/**
 * The honest answer to "are we actually listening together?".
 *
 * Thresholds mirror `Drift` exactly so the badge never claims a state the
 * controller is not in: under IGNORE it is doing nothing (in sync), between
 * IGNORE and SEEK it is nudging (adjusting), past SEEK the correction is an
 * audible skip and the listener deserves both the truth and a manual fix.
 */
const SyncBadge = memo(function SyncBadge({ driftMs, onResync, compact }: SyncBadgeProps) {
  const magnitude = Math.abs(driftMs);

  const { label, color } = useMemo(() => {
    if (magnitude <= Drift.IGNORE) return { label: 'In sync', color: Colors.accent };
    if (magnitude <= Drift.SEEK) return { label: 'Adjusting', color: Colors.muted };
    return { label: 'Out of sync', color: Colors.danger };
  }, [magnitude]);

  const needsHelp = magnitude > Drift.SEEK;

  return (
    <View style={styles.syncRow}>
      <View accessible accessibilityLabel={`Playback ${label}`} style={styles.syncBadge}>
        <View style={[styles.syncDot, { backgroundColor: color }]} />
        <Text style={[styles.syncLabel, { color }]}>{label}</Text>
      </View>

      {needsHelp && !compact ? (
        <AuxButton label="Resync" onPress={onResync} variant="ghost" size="sm" icon={RefreshCw} />
      ) : null}
    </View>
  );
});

// -------------------------------------------------------------------- glow

/**
 * Ambient light bleeding out of the artwork. Purely decorative, so it is hidden
 * from assistive tech and stops entirely under reduced motion.
 */
function AmbientGlow({ active }: { active: boolean }) {
  const reduced = useReducedMotion();
  const breath = useSharedValue(0);

  useEffect(() => {
    if (!active || reduced) {
      breath.value = 0;
      return;
    }
    // 3.2s: ambient, like a room light, not a micro-interaction.
    breath.value = withRepeat(
      withTiming(1, { duration: 3200, easing: Easing.inOut(Easing.quad) }),
      -1,
      true
    );
    return () => cancelAnimation(breath);
  }, [active, reduced, breath]);

  const style = useAnimatedStyle(() => ({ opacity: 0.45 + breath.value * 0.3 }));

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.glowBox, style, PointerEvents.none]}>
      <LinearGradient
        colors={[Colors.primary, 'rgba(67, 56, 202, 0.45)', 'rgba(15, 15, 35, 0)'] as const}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: Space.md,
  },
  stage: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    backgroundColor: '#000000',
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
  glowBox: {
    position: 'absolute',
    top: -Space.xl,
    right: -Space.xl,
    bottom: -Space.xl,
    left: -Space.xl,
    borderRadius: Radius.xl,
  },
  artFallback: {
    flex: 1,
    backgroundColor: Colors.surfaceRaised,
  },
  meta: {
    gap: Space.xs,
  },
  title: {
    ...Type.title,
    color: Colors.text,
  },
  artist: {
    ...Type.body,
    color: Colors.muted,
  },
  compactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
  },
  compactArt: {
    width: 52,
    height: 52,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surfaceRaised,
  },
  compactMeta: {
    flex: 1,
    gap: Space.xs,
  },
  compactTitle: {
    ...Type.bodyStrong,
    color: Colors.text,
  },
  syncRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    marginTop: Space.xs,
  },
  syncBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  syncDot: {
    width: 8,
    height: 8,
    borderRadius: Radius.pill,
  },
  syncLabel: {
    ...Type.label,
  },
  error: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Space.sm,
  },
  errorText: {
    ...Type.body,
    color: Colors.text,
    flex: 1,
  },
  scrubber: {
    minHeight: TOUCH_TARGET,
    justifyContent: 'center',
  },
  times: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: -Space.sm,
  },
  time: {
    ...Type.caption,
    // Not Colors.faint: 13px metadata still has to clear 4.5:1, and faint does not.
    color: Colors.muted,
    fontVariant: ['tabular-nums'],
  },
});
