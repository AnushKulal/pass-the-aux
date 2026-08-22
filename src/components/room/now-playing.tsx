/**
 * What the Session is playing, and where the playhead is.
 *
 * Three things here are load-bearing:
 *
 *  - The progress bar is driven by a local 250ms ticker over
 *    `expectedPositionMs(timeline)`, never by asking the adapter. On Spotify,
 *    `getPosition()` is a rate-limited HTTP call; polling it for a progress bar
 *    would burn the quota and still be less accurate than the arithmetic.
 *  - The `media` slot is rendered unconditionally, in a fixed tree position, in
 *    both compact and full layouts. It holds the YouTube player host, and
 *    unmounting that mid-song stops the audio for this listener. When YouTube
 *    is the active provider the stage is the visible artwork surface, which is
 *    what YouTube's terms expect.
 *  - The waveform is the scrubber. Bar HEIGHTS are decorative (there is no
 *    audio analysis in this app) and are hashed from the track id so every
 *    track looks like itself; the only thing they encode is the split at the
 *    playhead, which is the real position.
 */

import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { TriangleAlert } from 'lucide-react-native';
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

import { BLURHASH_SURFACE, AuxButton, Skeleton } from '@/components/ui';
import { Bloom, Colors, Duration, PointerEvents, Radius, Space, Type, shadow } from '@/lib/theme';
import { expectedPositionMs, type RoomTimeline } from '@/playback/sync-controller';
import { Drift, type ResolvedTrack } from '@/playback/types';

/** 4Hz: smooth enough that the bar never visibly steps, cheap enough to ignore. */
const TICK_MS = 250;
/** Screen-reader adjust step on the scrubber. */
const NUDGE_MS = 10_000;

/** Matches the artboard: 24 bars across the gutter width. */
const BAR_COUNT = 24;
const WAVE_HEIGHT = 54;
/** How far the playhead overshoots the waveform, top and bottom. */
const PLAYHEAD_BLEED = 8;

const ART_SIZE = 96;
const ART_SIZE_COMPACT = 44;

/** Decorative fallback when a track has no artwork — bloom colours, never semantic. */
const ART_FALLBACK = [Bloom.a, Bloom.b, Colors.primaryDim] as const;

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
  /** Whoever currently holds the aux, for the eyebrow line. Optional. */
  onAuxName?: string | null;
};

function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** Signed, mono-friendly drift. Under a second stays in ms; past that, seconds. */
function formatDrift(ms: number): string {
  const sign = ms < 0 ? '-' : '+';
  const magnitude = Math.abs(ms);
  if (magnitude < 1000) return `${sign}${Math.round(magnitude)}ms`;
  return `${sign}${(magnitude / 1000).toFixed(1)}s`;
}

/**
 * Deterministic bar heights, 0..1, from a seed string (the track id).
 *
 * xorshift32 rather than Math.random: the waveform must not re-roll on every
 * render, and hashing the id means the same song draws the same shape for every
 * listener in the Session.
 */
function barHeights(seed: string): number[] {
  let h = 2166136261 >>> 0;

  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  // A zero state is a fixed point of xorshift and would draw a flat line.
  if (h === 0) h = 0x9e3779b9;

  const out: number[] = [];
  for (let i = 0; i < BAR_COUNT; i += 1) {
    h ^= (h << 13) >>> 0;
    h >>>= 0;
    h ^= h >>> 17;
    h ^= (h << 5) >>> 0;
    h >>>= 0;
    out.push(0.2 + (h % 1000) / 1000 * 0.75);
  }
  return out;
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
  onAuxName,
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

  const progress = durationMs > 0 ? Math.min(1, Math.max(0, positionMs / durationMs)) : 0;

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
  const needsResync = Math.abs(driftMs) > Drift.SEEK;

  return (
    <View style={styles.root}>
      {/*
        Fixed tree position across compact/full. Parking it (1x1, transparent)
        rather than unmounting keeps the WebView alive and the music playing.
      */}
      <View
        style={[
          stageVisible ? styles.stage : styles.stageParked,
          stageVisible ? PointerEvents.auto : PointerEvents.none,
        ]}>
        {media}
      </View>

      {compact ? (
        <View style={styles.compactRow}>
          <Artwork url={artworkUrl} size={ART_SIZE_COMPACT} radius={Radius.sm} title={track?.title} />

          <View style={styles.compactMeta}>
            {isLoading && !track ? (
              <>
                <Skeleton width="70%" height={18} />
                <Skeleton width="45%" height={13} />
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

          <DriftReadout driftMs={driftMs} />
        </View>
      ) : (
        <>
          <View style={styles.metaRow}>
            {stageVisible ? null : (
              <Artwork url={artworkUrl} size={ART_SIZE} radius={Radius.md} title={track?.title} />
            )}

            <View style={styles.metaColumn}>
              {isLoading && !track ? (
                <>
                  <Skeleton width="86%" height={30} radius={Radius.sm} />
                  <Skeleton width="54%" height={16} radius={Radius.sm} />
                </>
              ) : (
                <>
                  <Text numberOfLines={2} style={styles.title}>
                    {track?.title ?? 'Nothing playing'}
                  </Text>
                  <Text numberOfLines={1} style={styles.artist}>
                    {track?.artist ?? 'Add a track and the Session starts'}
                  </Text>
                  <Text numberOfLines={1} style={styles.eyebrow}>
                    {onAuxName ? `on aux · ${onAuxName}` : 'on aux'}
                  </Text>
                </>
              )}
            </View>
          </View>

          <View>
            <Pressable
              disabled={!onSeek}
              onLayout={handleLayout}
              onPress={handleScrub}
              accessible
              accessibilityRole={onSeek ? 'adjustable' : 'progressbar'}
              accessibilityLabel="Playback position"
              accessibilityHint={onSeek ? 'Tap anywhere on the waveform to seek' : undefined}
              accessibilityValue={{
                min: 0,
                max: Math.max(1, Math.round(durationMs / 1000)),
                now: Math.round(positionMs / 1000),
                text: `${formatClock(positionMs)} of ${formatClock(durationMs)}`,
              }}
              accessibilityActions={onSeek ? [{ name: 'increment' }, { name: 'decrement' }] : undefined}
              onAccessibilityAction={handleAccessibilityAction}
              style={styles.scrubber}>
              <Waveform seed={track?.id ?? null} progress={progress} />
            </Pressable>

            <View style={styles.times}>
              <Text style={styles.timeNow}>{formatClock(positionMs)}</Text>
              <Text style={styles.timeTotal}>{formatClock(durationMs)}</Text>
            </View>
          </View>
        </>
      )}

      {errorMessage ? (
        // Icon carries the severity, not the text colour: Colors.danger as body
        // text lands at ~4.5:1 on bg and lower over glass, and a warning nobody
        // can read is worse than no warning.
        <View accessibilityLiveRegion="polite" style={styles.error}>
          <TriangleAlert size={18} strokeWidth={1.6} color={Colors.danger} />
          <Text style={styles.errorText}>{errorMessage}</Text>
        </View>
      ) : null}

      {needsResync ? (
        <View style={styles.resyncRow}>
          <Text style={styles.resyncLabel}>{`out of sync · ${formatDrift(driftMs)}`}</Text>
          <AuxButton label="Resync" onPress={onResync} variant="ghost" size="sm" />
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------- waveform

type WaveformProps = { seed: string | null; progress: number };

/**
 * The signature element. Bars before the playhead carry `Colors.accent` at 55%;
 * bars after it recede to ink at 13%. The 1px line sits at the real position,
 * with the glow faked by two wider, fainter siblings — there is no box-shadow
 * that renders reliably across iOS, Android and web.
 */
const Waveform = memo(function Waveform({ seed, progress }: WaveformProps) {
  const heights = useMemo(() => barHeights(seed ?? 'aux'), [seed]);
  // Asserted rather than inferred: TS widens a template expression to `string`,
  // which ViewStyle's DimensionValue will not accept.
  const left = `${Math.min(100, Math.max(0, progress * 100))}%` as DimensionValue;

  return (
    <View style={styles.wave}>
      <View style={styles.waveBars}>
        {heights.map((height, index) => {
          const played = (index + 0.5) / BAR_COUNT <= progress;
          return (
            <View
              key={index}
              style={[
                styles.bar,
                played ? styles.barPlayed : styles.barPending,
                { height: `${Math.round(height * 100)}%` as DimensionValue },
              ]}
            />
          );
        })}
      </View>

      <View style={[styles.playheadGlowWide, { left }, PointerEvents.none]} />
      <View style={[styles.playheadGlow, { left }, PointerEvents.none]} />
      <View style={[styles.playhead, { left }, PointerEvents.none]} />
    </View>
  );
});

// ----------------------------------------------------------------- artwork

type ArtworkProps = { url: string | null; size: number; radius: number; title?: string };

const Artwork = memo(function Artwork({ url, size, radius, title }: ArtworkProps) {
  const box = { width: size, height: size, borderRadius: radius };

  return (
    <View style={[styles.art, box, shadow('md')]}>
      <LinearGradient
        colors={ART_FALLBACK}
        start={{ x: 0.15, y: 0 }}
        end={{ x: 0.85, y: 1 }}
        style={[StyleSheet.absoluteFill, PointerEvents.none]}
      />

      {url ? (
        <Image
          source={{ uri: url }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="memory-disk"
          placeholder={{ blurhash: BLURHASH_SURFACE }}
          transition={Duration.base}
          accessibilityIgnoresInvertColors
          accessibilityLabel={title ? `Artwork for ${title}` : undefined}
        />
      ) : null}
    </View>
  );
});

// ------------------------------------------------------------ drift readout

/**
 * The compact-layout stand-in for the participant list, which is hidden while
 * the sheet is expanded. Thresholds mirror `Drift` exactly so it never claims a
 * state the controller is not in.
 */
const DriftReadout = memo(function DriftReadout({ driftMs }: { driftMs: number }) {
  const magnitude = Math.abs(driftMs);
  const inSync = magnitude <= Drift.IGNORE;
  const color = inSync ? Colors.accent : magnitude <= Drift.SEEK ? Colors.warn : Colors.danger;

  return (
    <Text
      accessible
      accessibilityLabel={inSync ? 'In sync' : `Off by ${formatDrift(driftMs)}`}
      style={[styles.driftReadout, { color }]}>
      {inSync ? 'in sync' : formatDrift(driftMs)}
    </Text>
  );
});

const styles = StyleSheet.create({
  root: {
    gap: Space.lg,
  },
  /** YouTube only: the player is the artwork surface, per its terms of service. */
  stage: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
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
  metaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Space.lg,
  },
  metaColumn: {
    flex: 1,
    minWidth: 0,
    gap: Space.xs,
    paddingTop: 2,
  },
  art: {
    overflow: 'hidden',
    backgroundColor: Colors.surfaceRaised,
  },
  title: {
    ...Type.display,
    color: Colors.text,
  },
  artist: {
    ...Type.label,
    color: Colors.muted,
  },
  eyebrow: {
    ...Type.monoLabel,
    color: Colors.muted,
    marginTop: Space.xs,
  },

  // ------------------------------------------------------------- waveform
  scrubber: {
    // The playhead bleeds PLAYHEAD_BLEED past the bars; the padding is exactly
    // that, so the touch target stays generous without wasting vertical budget.
    paddingVertical: PLAYHEAD_BLEED,
  },
  wave: {
    height: WAVE_HEIGHT,
    justifyContent: 'center',
  },
  waveBars: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    height: '100%',
  },
  bar: {
    flex: 1,
    borderRadius: 1,
  },
  barPlayed: {
    backgroundColor: Colors.accent,
    opacity: 0.55,
  },
  barPending: {
    backgroundColor: Colors.text,
    opacity: 0.13,
  },
  playhead: {
    position: 'absolute',
    top: -PLAYHEAD_BLEED,
    bottom: -PLAYHEAD_BLEED,
    width: 1,
    backgroundColor: Colors.accent,
  },
  /** Stacked translucent siblings stand in for a CSS glow. */
  playheadGlow: {
    position: 'absolute',
    top: -PLAYHEAD_BLEED,
    bottom: -PLAYHEAD_BLEED,
    width: 5,
    marginLeft: -2,
    backgroundColor: Colors.accent,
    opacity: 0.22,
  },
  playheadGlowWide: {
    position: 'absolute',
    top: -PLAYHEAD_BLEED - 4,
    bottom: -PLAYHEAD_BLEED - 4,
    width: 13,
    marginLeft: -6,
    borderRadius: Radius.pill,
    backgroundColor: Colors.accent,
    opacity: 0.08,
  },
  times: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: Space.sm,
  },
  timeNow: {
    ...Type.mono,
    color: Colors.text,
  },
  timeTotal: {
    ...Type.mono,
    // Not Colors.faint: a timecode is something you read, not a placeholder.
    color: Colors.muted,
  },

  // -------------------------------------------------------------- compact
  compactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
  },
  compactMeta: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  compactTitle: {
    ...Type.bodyStrong,
    color: Colors.text,
  },
  driftReadout: {
    ...Type.mono,
    textAlign: 'right',
  },

  // ---------------------------------------------------------------- state
  error: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Space.md,
    padding: Space.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.glass,
  },
  errorText: {
    ...Type.body,
    color: Colors.text,
    flex: 1,
  },
  resyncRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.md,
  },
  resyncLabel: {
    ...Type.mono,
    color: Colors.danger,
    flexShrink: 1,
  },
});
