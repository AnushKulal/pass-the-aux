/**
 * A voice note: play control, waveform, duration.
 *
 * Source: `design/nocturne/aux-nocturne.dc.html` L751–L757 — the voice bubble in
 * the DM thread: a play glyph, twelve bars, a tabular duration, 56px tall.
 *
 * ## THE TWO ACCENTS SPLIT THIS COMPONENT DOWN THE MIDDLE
 *
 * Pressing play is something YOU DO, so the control is BLUE. Progress through
 * the note is something that IS HAPPENING, so the played bars are CORAL. That is
 * the whole accent rule expressed in one 200px bubble, and it is why the two
 * halves may never be painted the same colour "for consistency".
 *
 * The disc INVERTS on your own side, and this is the part that breaks silently
 * if it is dropped. Nocturne moved the own-side bubble from coral to blue
 * (`bubble-kit`, `tone: 'fill'` → `C.pill`), so a blue disc drawn on it is a
 * blue circle on a blue field — invisible, with the layout, the label and the
 * contrast report all still correct. On the fill the disc is therefore white
 * with a blue glyph; on glass it is the blue disc with a white glyph. Same
 * control, same reading, both grounds.
 *
 * The bars are the attachment's own `waveform` column — 12 smallints, 0..100,
 * precomputed by the recorder — so two people looking at the same note see the
 * same shape. A null waveform is a normal state, not a failure: an attachment
 * uploaded before the recorder computed one still has to render, so it draws 12
 * flat bars and keeps its duration rather than crashing the whole log.
 *
 * ## Playback is still not wired, and `progress` is the seam for when it is
 *
 * Neither `expo-audio` nor `expo-av` is a dependency of this app (see
 * package.json), and adding one is a native-module change that needs a rebuild —
 * out of scope for a component. So the control says so when pressed rather than
 * doing nothing, which is the same honesty the rest of the thread's unbuilt
 * affordances use (`record-sheet.tsx`, `attach-sheet.tsx`).
 *
 * `progress` is a PROP rather than internal state on purpose: exactly one note
 * in the app may be playing at a time, and that is a fact about the screen, not
 * about a bubble. When `expo-audio` lands, the thread holds "which attachment is
 * playing, and how far" and feeds it down here; nothing in this file changes but
 * `onPlay`. Until then it defaults to 0 and no bar is coral — an idle note is
 * honestly reporting that nothing is playing.
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
 * Twelve. Not "about twelve" — the figure is part of the drawing (L753 draws
 * twelve `<div>`s), and it is the same twelve the recorder downsamples to before
 * writing the column.
 *
 * Deliberately not exported: `record-sheet.tsx` exports a constant of the same
 * name, and a barrel over this directory would make the pair ambiguous.
 */
const WAVEFORM_BARS = 12;

/** L753: `width:3px`, `gap:3px`, tallest bar 24. */
const BAR_WIDTH = 3;
const BAR_GAP = 3;
const BAR_MAX = 24;
/** A zero-amplitude sample is still a bar; it must not vanish to nothing. */
const BAR_MIN = 4;
/** The height every bar takes when there is no waveform to draw. */
const BAR_FLAT = 5;

/** 32 + the bubble's 12px band = the artboard's 56px voice bubble. */
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
   * Own messages are the blue fill, so every mark inside has to invert. Passed
   * rather than inferred: the bubble owns the fill and this owns what sits on
   * it, and the two must not each decide separately.
   */
  mine: boolean;
  /**
   * How far playback has got, 0..1. Paints that many bars CORAL — the state
   * accent, because a note that is playing is a thing happening right now.
   *
   * Optional and defaulting to 0 so every existing call site keeps compiling
   * unchanged; see the header for why it is a prop and not internal state.
   */
  progress?: number;
};

function VoiceNoteBase({ attachment, mine, progress = 0 }: VoiceNoteProps) {
  const C = useColors();
  const toast = useToast();

  const tone = mine ? 'fill' : 'surface';
  const ink = bubbleInk(C, tone);
  const bars = useMemo(() => barHeights(attachment?.waveform), [attachment?.waveform]);
  const duration = clock(attachment?.duration_ms);
  const hasShape = Boolean(attachment?.waveform && attachment.waveform.length > 0);

  /*
    Floor, not round: a bar only goes coral once the playhead has actually
    entered it, so the coral edge never runs ahead of the audio. Clamped because
    a caller feeding `elapsed / duration` will overshoot by a frame at the end.
  */
  const played = Math.floor(Math.min(1, Math.max(0, progress)) * WAVEFORM_BARS);

  /*
    Coral on the dark glass, the LIGHTER coral on the blue fill. `live` (#ff4a2e)
    and `pill` (#4a7dff) sit at almost the same luminance, so played bars drawn
    in it on your own bubble separate by hue alone and vibrate at 3px wide;
    `liveText` is the same hue lifted, and reads as a clean playhead.
  */
  const playedInk = mine ? C.liveText : C.live;

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
        {/*
          THE ACTION, so it is blue — inverted on the blue bubble. See the
          header: the un-inverted version compiles, measures and lays out
          perfectly and cannot be seen.
        */}
        <View style={[styles.disc, { backgroundColor: mine ? C.pillInk : C.pill }]}>
          <Play
            size={14}
            strokeWidth={2}
            color={mine ? C.pill : C.pillInk}
            fill={mine ? C.pill : C.pillInk}
          />
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
                  // THE STATE, so it is coral — and only for the part that has
                  // actually been heard.
                  backgroundColor: index < played ? playedInk : ink.meta,
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
    borderRadius: Radii.pill,
  },
  duration: {
    ...readout(11.5),
    flexShrink: 0,
  },
});
