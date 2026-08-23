/**
 * VOICE NOTE — the recording sheet.
 *
 * A pulsing accent square, a 12-bar live waveform, a tabular timer, and one
 * full-width SEND VOICE NOTE cell. The 12 bars are not a decoration: they are
 * the same twelve values that get written to `attachments.waveform` and drawn
 * again by the voice-note bubble, so what you watch while recording is what the
 * other person sees afterwards.
 *
 * ## expo-audio is not installed
 *
 * It is not in package.json and this task was not allowed to add it, so nothing
 * here captures audio. A bundler resolves `require` at build time, so there is
 * no runtime probe to write — an absent module is a build error, not a caught
 * exception. `RECORDING_AVAILABLE` is therefore a static flag and the sheet
 * renders a truthful disabled state by default: the reason on one line, the
 * transport greyed, SEND VOICE NOTE out of the accent and not pressable.
 *
 * Everything the recorder needs is already here and pure:
 *
 *   - `meterToLevel(db)`  turns expo-audio's dBFS metering into 0..100
 *   - `downsampleWaveform(levels)` reduces the whole meter history to the 12
 *     values 0..100 that `UploadAttachmentInput.waveform` wants
 *
 * So wiring it up is: add expo-audio, set `RECORDING_AVAILABLE` (or pass
 * `unavailableReason={null}`), drive `meters` / `elapsedMs` / `recording` from
 * the recorder, and `onSend` already hands back a finished `VoiceNoteDraft`.
 *
 * Controlled throughout — the sheet holds no recorder state and never touches
 * the data layer.
 */

import { useEffect } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Duration, PointerEvents, Rule, Space, TOUCH_TARGET, Type, tracking } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

/** The bar count is fixed by the schema and by the bubble that redraws it. */
export const WAVEFORM_BARS = 12;
/** "Hold to record, up to two minutes." */
export const MAX_DURATION_MS = 120_000;

/** See the header. Static because the bundler cannot be asked at runtime. */
export const RECORDING_AVAILABLE: boolean = false;
export const RECORDING_UNAVAILABLE_REASON = 'Recording unavailable — expo-audio is not installed';

const DOT = 12;
const WAVE_HEIGHT = 44;
const BAR_GAP = 3;
/** A silent bar still has to be visible, or the row reads as broken. */
const BAR_MIN = 2;
/** At or above this the mic is genuinely hot — the one accent in the waveform. */
const BAR_LOUD = 78;
/** The prototype's pulse: full to .28 and back, once a second. */
const PULSE_MIN = 0.28;
const PULSE_MS = 500;

const clamp01to100 = (n: number) =>
  Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;

/**
 * expo-audio reports metering in dBFS — roughly -160 (silence) to 0 (clipping),
 * though in practice anything under about -60 is room tone. Mapping that floor
 * to 0 rather than -160 keeps a normal speaking voice in the top half of the
 * bar instead of pinned to the bottom.
 */
export function meterToLevel(db: number, floorDb = -60): number {
  if (!Number.isFinite(db)) return 0;
  if (db <= floorDb) return 0;
  if (db >= 0) return 100;
  return clamp01to100(((db - floorDb) / -floorDb) * 100);
}

/**
 * Reduces a meter history of any length to exactly `bars` values, 0..100.
 *
 * Averages within each bucket rather than sampling one value from it, so a
 * single spike cannot stand in for a whole second of audio. Short histories are
 * padded from the front, which is what makes the live waveform fill in from the
 * right as the recording grows instead of stretching.
 */
export function downsampleWaveform(
  samples: readonly number[],
  bars: number = WAVEFORM_BARS,
): number[] {
  const width = Math.max(1, Math.floor(bars));
  if (samples.length === 0) return new Array<number>(width).fill(0);

  if (samples.length <= width) {
    const padded = new Array<number>(width - samples.length).fill(0);
    return [...padded, ...samples.map(clamp01to100)];
  }

  const out: number[] = [];
  for (let i = 0; i < width; i += 1) {
    const from = Math.floor((i * samples.length) / width);
    const to = Math.max(from + 1, Math.floor(((i + 1) * samples.length) / width));

    let sum = 0;
    for (let j = from; j < to; j += 1) sum += samples[j] ?? 0;
    out.push(clamp01to100(sum / (to - from)));
  }
  return out;
}

/** `M:SS`, the readout the prototype draws. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = total % 60;
  return `${Math.floor(total / 60)}:${seconds < 10 ? '0' : ''}${seconds}`;
}

/** What `onSend` hands back — ready for `useUploadAttachment`. */
export type VoiceNoteDraft = {
  durationMs: number;
  /** Exactly `WAVEFORM_BARS` values, 0..100. */
  waveform: number[];
};

export type DmRecordSheetProps = {
  visible: boolean;
  /** CANCEL — discard the take. */
  onCancel: () => void;
  /** SEND VOICE NOTE. The waveform is already downsampled to 12 values. */
  onSend: (draft: VoiceNoteDraft) => void;

  /** Live meter levels 0..100, oldest first, any length. Downsampled here. */
  meters?: readonly number[];
  elapsedMs?: number;
  /** The recorder is actually running — drives the pulse and the kicker. */
  recording?: boolean;

  /**
   * One line explaining why recording cannot happen, or null when it can.
   * Defaults to the honest state of this build; a host with a working recorder
   * passes `null` explicitly.
   */
  unavailableReason?: string | null;
  maxDurationMs?: number;
};

export function DmRecordSheet({
  visible,
  onCancel,
  onSend,
  meters,
  elapsedMs = 0,
  recording = false,
  unavailableReason = RECORDING_AVAILABLE ? null : RECORDING_UNAVAILABLE_REASON,
  maxDurationMs = MAX_DURATION_MS,
}: DmRecordSheetProps) {
  const C = useColors();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();

  const blocked = unavailableReason !== null && unavailableReason !== undefined;
  const elapsed = Math.min(Math.max(0, elapsedMs), maxDurationMs);
  const bars = downsampleWaveform(meters ?? []);
  // A zero-length take is not a voice note; the schema would take it, the
  // recipient would not thank you for it.
  const canSend = !blocked && elapsed >= 1000;
  const live = recording && !blocked;

  const rise = useSharedValue(0);
  const pulse = useSharedValue(1);

  useEffect(() => {
    if (reduced) {
      rise.value = visible ? 1 : 0;
      return;
    }
    rise.value = withTiming(visible ? 1 : 0, {
      duration: visible ? Duration.sheet : Duration.scrim,
    });
  }, [visible, reduced, rise]);

  useEffect(() => {
    // Under reduced motion the dot holds solid: it still says RECORDING, it
    // just stops moving.
    if (reduced || !live || !visible) {
      cancelAnimation(pulse);
      pulse.value = 1;
      return;
    }
    pulse.value = withRepeat(withTiming(PULSE_MIN, { duration: PULSE_MS }), -1, true);
    return () => cancelAnimation(pulse);
  }, [reduced, live, visible, pulse]);

  const sheetStyle = useAnimatedStyle(() => ({
    opacity: rise.value,
    transform: [{ translateY: (1 - rise.value) * 16 }],
  }));

  const dotStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onCancel}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Cancel voice note"
        onPress={onCancel}
        style={[styles.scrim, { backgroundColor: C.scrim }]}
      />

      <View style={[styles.dock, PointerEvents.boxNone]}>
        <Animated.View
          style={[
            styles.sheet,
            { backgroundColor: C.bg, borderTopColor: C.rule3, paddingBottom: insets.bottom },
            sheetStyle,
          ]}>
          <View style={[styles.head, { borderBottomColor: C.rule }]}>
            <View style={styles.headText}>
              <Text style={[styles.title, { color: C.ink }]}>VOICE NOTE</Text>
              <Text
                accessibilityLiveRegion="polite"
                style={[styles.kicker, { color: live ? C.liveText : C.ink3 }]}>
                {blocked ? 'UNAVAILABLE' : live ? 'RECORDING' : 'READY'}
              </Text>
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              onPress={onCancel}
              style={({ pressed }) => [styles.close, pressed && styles.dim]}>
              <Text style={[styles.closeLabel, { color: C.ink2 }]}>CANCEL</Text>
            </Pressable>
          </View>

          <View style={styles.body}>
            <View style={styles.transport}>
              <Animated.View
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={[styles.dot, { backgroundColor: live ? C.live : C.ink3 }, dotStyle]}
              />

              <View
                accessible
                accessibilityRole="progressbar"
                accessibilityLabel="Recording level"
                style={styles.wave}>
                {bars.map((value, index) => (
                  <View
                    key={index}
                    style={[
                      styles.bar,
                      {
                        height: Math.max(BAR_MIN, (value / 100) * WAVE_HEIGHT),
                        backgroundColor: blocked
                          ? C.track
                          : value >= BAR_LOUD
                            ? C.live
                            : C.ink2,
                      },
                    ]}
                  />
                ))}
              </View>

              <Text
                accessibilityLabel={`${formatDuration(elapsed)} recorded`}
                style={[styles.timer, { color: C.ink }]}>
                {formatDuration(elapsed)}
              </Text>
            </View>

            {blocked ? (
              <Text style={[styles.reason, { color: C.ink3 }]}>{unavailableReason}</Text>
            ) : null}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send voice note"
              accessibilityHint={blocked ? (unavailableReason ?? undefined) : undefined}
              accessibilityState={{ disabled: !canSend }}
              disabled={!canSend}
              onPress={() => onSend({ durationMs: elapsed, waveform: bars })}
              style={({ pressed }) => [
                styles.send,
                canSend
                  ? { backgroundColor: pressed ? C.liveText : C.live }
                  : { backgroundColor: C.surface, borderWidth: Rule.hair, borderColor: C.rule2 },
              ]}>
              <Text style={[styles.sendLabel, { color: canSend ? C.onLive : C.ink3 }]}>
                SEND VOICE NOTE
              </Text>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  dock: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    borderTopWidth: Rule.major,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingLeft: Space.md,
    paddingRight: Space.xs,
    paddingTop: Space.md,
    paddingBottom: Space.sm + 2,
    borderBottomWidth: Rule.major,
  },
  headText: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    ...Type.heading(15),
    letterSpacing: tracking(15, 0.03),
  },
  kicker: {
    ...Type.label(10),
    marginTop: 2,
  },
  close: {
    minHeight: TOUCH_TARGET,
    minWidth: TOUCH_TARGET,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingHorizontal: Space.xs,
  },
  closeLabel: {
    ...Type.heading(10),
    letterSpacing: tracking(10, 0.1),
  },
  dim: {
    opacity: 0.6,
  },
  body: {
    paddingHorizontal: Space.md,
    paddingTop: 22,
    paddingBottom: 22,
    gap: Space.lg,
  },
  transport: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
  },
  dot: {
    width: DOT,
    height: DOT,
    flexShrink: 0,
  },
  wave: {
    flex: 1,
    flexDirection: 'row',
    // Bars grow up from a shared baseline, the way a level meter reads.
    alignItems: 'flex-end',
    gap: BAR_GAP,
    height: WAVE_HEIGHT,
  },
  bar: {
    flex: 1,
  },
  timer: {
    // A duration measures. Tabular figures, so the row does not shift on 1:09
    // becoming 1:10.
    ...Type.readout(15),
    fontVariant: ['tabular-nums'],
    flexShrink: 0,
  },
  reason: {
    ...Type.body(13),
    marginTop: -Space.sm,
  },
  send: {
    minHeight: 52,
    // Left-aligned, like every other full-width action cell in this design —
    // the label starts on the same 16px margin as the text above it.
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Space.lg,
  },
  sendLabel: {
    ...Type.heading(12),
    letterSpacing: tracking(12, 0.1),
  },
});
