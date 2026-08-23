/**
 * A voice note: play glyph, waveform, duration — the design's "Thread" bubble.
 *
 * A voice note IS a body, not an attachment card, so it takes the same fill the
 * words would: the accent on your own side, `surface` on theirs. The play disc
 * is the inverted pill in both directions, which is the only mark on it that
 * has to stay legible against a red field.
 *
 * The bars are the attachment's own `waveform` column — 12 smallints, 0..100,
 * precomputed by the recorder — so two people looking at the same note see the
 * same shape. A null waveform is a normal state, not a failure: an attachment
 * uploaded before the recorder computed one still has to render, so it draws 12
 * flat bars and keeps its duration rather than crashing the whole log.
 *
 * **Playback is not wired.** Neither `expo-audio` nor `expo-av` is a dependency
 * of this app (see package.json), and adding one is a native-module change that
 * needs a rebuild — out of scope for a component. The control therefore says so
 * when pressed rather than doing nothing, which is the same honesty the rest of
 * the thread's unbuilt affordances use. The moment `expo-audio` lands, only
 * `onPlay` below changes.
 */

import { Play } from 'lucide-react-native';
import { memo, useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View, type TextStyle } from 'react-native';

import { Bubble, bubbleInk } from '@/components/chat/bubble-kit';
import { useToast } from '@/components/ui';
import type { DmAttachment } from '@/features/dm';
import { Radii, Space, TOUCH_TARGET, Type } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

/**
 * Twelve. Not "about twelve" — the figure is part of the drawing, and it is the
 * same twelve the recorder downsamples to before writing the column.
 *
 * Deliberately not exported: `record-sheet.tsx` exports a constant of the same
 * name, and a barrel over this directory would make the pair ambiguous.
 */
const WAVEFORM_BARS = 12;

const BAR_WIDTH = 2.5;
const BAR_GAP = 2;
const BAR_MAX = 20;
/** A zero-amplitude sample is still a bar; it must not vanish to nothing. */
const BAR_MIN = 3;
/** The height every bar takes when there is no waveform to draw. */
const BAR_FLAT = 4;

const DISC = 32;

/** `Type.readout` hands back a readonly fontVariant tuple; TextStyle wants a mutable one. */
const readout = (size: number): TextStyle => ({
  ...Type.readout(size),
  fontVariant: ['tabular-nums'],
});

/**
 * Exactly twelve bar heights in px, whatever the column actually holds.
 *
 * The schema constrains `waveform` to 0..100, but a client that trusts a
 * database constraint to be the only writer is a client that renders a negative
 * height the first time a backfill script gets it wrong — so the values are
 * clamped here as well, and a short or long array is padded or cut rather than
 * producing a waveform with a different number of bars than the design has.
 */
function barHeights(waveform: number[] | null | undefined): number[] {
  if (!waveform || waveform.length === 0) {
    return Array.from({ length: WAVEFORM_BARS }, () => BAR_FLAT);
  }

  return Array.from({ length: WAVEFORM_BARS }, (_, index) => {
    const raw = waveform[index];
    if (typeof raw !== 'number' || Number.isNaN(raw)) return BAR_FLAT;
    const amplitude = Math.min(100, Math.max(0, raw)) / 100;
    return Math.round(BAR_MIN + amplitude * (BAR_MAX - BAR_MIN));
  });
}

/** `0:14`. Duration measures, so it is a readout, not a label. */
function clock(ms: number | null | undefined): string {
  const seconds = Math.max(0, Math.round((ms ?? 0) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export type VoiceNoteProps = {
  /** Null while an optimistic send has not resolved its attachment row yet. */
  attachment: DmAttachment | null;
  /**
   * Own messages are an accent fill, so every mark inside inherits `onLive`
   * instead of ink. Passed rather than inferred: the bubble owns the fill and
   * this owns what sits on it.
   */
  mine: boolean;
};

function VoiceNoteBase({ attachment, mine }: VoiceNoteProps) {
  const C = useColors();
  const toast = useToast();

  const tone = mine ? 'fill' : 'surface';
  const ink = bubbleInk(C, tone);
  const bars = useMemo(() => barHeights(attachment?.waveform), [attachment?.waveform]);
  const duration = clock(attachment?.duration_ms);
  const hasShape = Boolean(attachment?.waveform && attachment.waveform.length > 0);

  const onPlay = useCallback(() => {
    toast.show('Voice note playback is not built yet.', 'info');
  }, [toast]);

  return (
    <Bubble mine={mine} tone={tone}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Voice note, ${duration}`}
        // Announced as unavailable, but still pressable so the tap explains
        // itself. A control that does nothing at all reads as a broken app.
        accessibilityState={{ disabled: true }}
        accessibilityHint="Playback is not available in this build"
        onPress={onPlay}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
        <View style={[styles.disc, { backgroundColor: C.pill }]}>
          <Play size={14} strokeWidth={2} color={C.pillInk} fill={C.pillInk} />
        </View>

        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.waveform}>
          {bars.map((height, index) => (
            <View
              key={index}
              style={[
                styles.bar,
                {
                  height,
                  backgroundColor: ink.meta,
                  // Flat bars are a stand-in, not a reading. Holding them back
                  // stops a note with no waveform from looking like silence.
                  opacity: hasShape ? 1 : 0.45,
                },
              ]}
            />
          ))}
        </View>

        <Text style={[styles.duration, { color: ink.meta }]}>{duration}</Text>
      </Pressable>
    </Bubble>
  );
}

/**
 * Re-renders only when its own attachment changes — a thread that receives a
 * message must not repaint every waveform above it.
 */
export const VoiceNote = memo(VoiceNoteBase);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    // The bubble already pads; this only has to clear the touch floor.
    minHeight: TOUCH_TARGET - Space.md * 2,
    minWidth: TOUCH_TARGET,
  },
  pressed: {
    opacity: 0.75,
  },
  disc: {
    width: DISC,
    height: DISC,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.pill,
  },
  waveform: {
    flexDirection: 'row',
    // Bars grow from a common baseline, which is what makes twelve unconnected
    // rectangles read as one waveform.
    alignItems: 'flex-end',
    gap: BAR_GAP,
    height: BAR_MAX,
  },
  bar: {
    width: BAR_WIDTH,
    borderRadius: 1,
  },
  duration: {
    ...readout(11.5),
    flexShrink: 0,
  },
});
