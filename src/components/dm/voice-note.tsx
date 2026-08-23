/**
 * A voice note, as §13 draws it: play glyph + 12-bar waveform + duration.
 *
 * The bars are the attachment's own `waveform` column — 12 smallints, 0..100,
 * precomputed by the recorder — so two people looking at the same note see the
 * same shape. A null waveform is a normal state, not a failure: an attachment
 * uploaded before the recorder computed one still has to render, so it draws 12
 * flat bars and keeps its duration rather than crashing the whole log.
 *
 * **Playback is not wired.** Neither `expo-audio` nor `expo-av` is a dependency
 * of this app (see package.json), and adding one is a native-module change that
 * needs a rebuild — out of scope for a component. The control therefore renders
 * in its disabled treatment and *says so* when pressed, which is the same
 * honesty the call and video buttons in the thread header use. The moment
 * `expo-audio` lands, only `onPlay` below changes.
 */

import { Play } from 'lucide-react-native';
import { memo, useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View, type TextStyle } from 'react-native';

import { useToast } from '@/components/ui';
import type { DmAttachment } from '@/features/dm';
import { Rule, Space, TOUCH_TARGET, Type } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

/**
 * §13 says twelve. Not "about twelve" — the figure is part of the drawing, and
 * it is the same twelve the recorder downsamples to before writing the column.
 *
 * Deliberately not exported: `record-sheet.tsx` exports a constant of the same
 * name, and a barrel over this directory would make the pair ambiguous.
 */
const WAVEFORM_BARS = 12;

const BAR_WIDTH = 2;
const BAR_GAP = 2;
const BAR_MAX = 22;
/** A zero-amplitude sample is still a bar; it must not vanish to nothing. */
const BAR_MIN = 3;
/** The height every bar takes when there is no waveform to draw. */
const BAR_FLAT = 4;

const GLYPH = 18;

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
   * Own messages are an accent fill (§13), so every mark inside inherits
   * `onLive` instead of ink. Passed rather than inferred: the bubble owns the
   * fill and this owns what sits on it.
   */
  mine: boolean;
};

function VoiceNoteBase({ attachment, mine }: VoiceNoteProps) {
  const C = useColors();
  const toast = useToast();

  const ink = mine ? C.onLive : C.ink;
  const bars = useMemo(() => barHeights(attachment?.waveform), [attachment?.waveform]);
  const duration = clock(attachment?.duration_ms);
  const hasShape = Boolean(attachment?.waveform && attachment.waveform.length > 0);

  const onPlay = useCallback(() => {
    toast.show('Voice note playback is not built yet.', 'info');
  }, [toast]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Voice note, ${duration}`}
      // Announced as unavailable, but still pressable so the tap explains
      // itself. A control that does nothing at all reads as a broken app.
      accessibilityState={{ disabled: true }}
      accessibilityHint="Playback is not available in this build"
      onPress={onPlay}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: mine ? C.live : C.surface,
          borderColor: mine ? 'transparent' : C.rule,
        },
        pressed && styles.pressed,
      ]}>
      {/* Dimmed against the bars beside it: the glyph is the part that does not
          work yet, and the waveform is still real information. */}
      <Play size={GLYPH} strokeWidth={2} color={ink} style={styles.glyph} />

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
                backgroundColor: ink,
                // Flat bars are a stand-in, not a reading. Holding them back
                // stops a note with no waveform from looking like silence.
                opacity: hasShape ? 1 : 0.45,
              },
            ]}
          />
        ))}
      </View>

      <Text style={[styles.duration, { color: ink }]}>{duration}</Text>
    </Pressable>
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
    gap: Space.sm + 2,
    paddingHorizontal: Space.md,
    // 52px in the artboard, and comfortably over the 44px floor.
    minHeight: 52,
    minWidth: TOUCH_TARGET,
    borderWidth: Rule.hair,
  },
  pressed: {
    opacity: 0.75,
  },
  glyph: {
    flexShrink: 0,
    opacity: 0.55,
  },
  waveform: {
    flexDirection: 'row',
    // Bars grow up from a common baseline, which is what makes twelve
    // unconnected rectangles read as one waveform.
    alignItems: 'flex-end',
    gap: BAR_GAP,
    height: BAR_MAX,
  },
  bar: {
    width: BAR_WIDTH,
  },
  duration: {
    ...readout(11),
    flexShrink: 0,
  },
});
