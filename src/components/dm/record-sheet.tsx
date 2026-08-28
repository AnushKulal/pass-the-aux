/**
 * Voice note — the recording sheet.
 *
 * From `design/nocturne/aux-nocturne.dc.html`: the shared sheet shell at L1163-
 * L1167 and the `sheetRec` body at L1506-L1520. A pulsing coral dot, a 12-bar
 * live waveform and a tabular timer in one card, then the blue send cell and a
 * quiet cancel under it.
 *
 * The 12 bars are not a decoration: they are the same twelve values that get
 * written to `attachments.waveform` and drawn again by the voice-note bubble,
 * so what you watch while recording is what the other person sees afterwards.
 *
 * THE ACCENTS SPLIT CLEANLY HERE, WHICH IS WHY THIS SCREEN IS WORTH READING AS
 * AN EXAMPLE. The dot, the "Recording" kicker and the bars that are genuinely
 * hot are CORAL — recording is a state of the world. Send is BLUE — it is the
 * action. No element carries both, and cancelling is not destruction (nothing
 * has been sent), so `danger` appears nowhere on this sheet.
 *
 * The sheet FLOATS and takes `sheetShadow()`, not `dropped()`: a sheet is lit
 * by the page it covers, so its shadow falls upward onto that page. `dropped()`
 * would throw it off the bottom of the screen. Everything inside is opaque —
 * a 5.5%-white surface laid over the BlurView has nothing to sit on and
 * dissolves into it, so the transport card is `GlassCard solid`.
 *
 * ## expo-audio is not installed
 *
 * It is not in package.json and this task was not allowed to add it, so nothing
 * here captures audio. A bundler resolves `require` at build time, so there is
 * no runtime probe to write — an absent module is a build error, not a caught
 * exception. `RECORDING_AVAILABLE` is therefore a static flag and the sheet
 * renders a truthful disabled state by default: the kicker reads Unavailable,
 * the dot stops pulsing, the bars go to `track`, the reason sits on one line
 * and the send cell is inert.
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
 * the data layer. There is deliberately no start/stop transport in it: the host
 * starts the recorder when it opens the sheet and stops it on send or cancel,
 * and a button here that the host had no handler for would be a lie.
 */

import { BlurView } from 'expo-blur';
import { Send, X } from 'lucide-react-native';
import { useEffect } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AuxButton, CircleIconButton, GlassCard, LivePulse, PillButton } from '@/components/ui';
import {
  Duration,
  PointerEvents,
  Radii,
  Rule,
  Sheet as SheetMetrics,
  Space,
  Type,
  sheetShadow,
  tracking,
} from '@/lib/theme';
import { useColors, useTheme } from '@/lib/theme-context';

/** The bar count is fixed by the schema and by the bubble that redraws it. */
export const WAVEFORM_BARS = 12;
/** "Hold to record, up to two minutes." */
export const MAX_DURATION_MS = 120_000;

/** See the header. Static because the bundler cannot be asked at runtime. */
export const RECORDING_AVAILABLE: boolean = false;
export const RECORDING_UNAVAILABLE_REASON = 'Recording unavailable — expo-audio is not installed';

/** L1509: a 13px dot with its own coral bloom. */
const DOT = 13;
/** L1510: `height:46px` of bars. */
const WAVE_HEIGHT = 46;
const BAR_GAP = 3;
/** A silent bar still has to be visible, or the row reads as broken. */
const BAR_MIN = 2;
/** At or above this the mic is genuinely hot — the one accent in the waveform. */
const BAR_LOUD = 78;
/** L1508: `padding:18px` inside the transport card, above the house row step. */
const TRANSPORT_PAD = 18;

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
  const { scheme } = useTheme();
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

  useEffect(() => {
    if (reduced) {
      rise.value = visible ? 1 : 0;
      return;
    }
    rise.value = withTiming(visible ? 1 : 0, {
      duration: visible ? Duration.sheet : Duration.scrim,
    });
  }, [visible, reduced, rise]);

  const sheetStyle = useAnimatedStyle(() => ({
    opacity: rise.value,
    transform: [{ translateY: (1 - rise.value) * 16 }],
  }));

  /** The float: clear of the home indicator, and never flush on a device without one. */
  const lift = Math.max(insets.bottom, Space.md) + Space.md;

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
        {/*
          The shadow rides on this view, the blur clips inside it. Android
          throws away a view's own boxShadow along with whatever
          `overflow: 'hidden'` clips, so a single view would lose its lift on
          one platform only.
        */}
        <Animated.View
          style={[styles.shell, { marginBottom: lift }, sheetShadow(C), sheetStyle]}>
          <BlurView
            intensity={scheme === 'dark' ? 40 : 60}
            tint={scheme === 'dark' ? 'dark' : 'light'}
            // Android does not blur at all without this; the tint alone would
            // leave a flat translucent slab with nothing happening behind it.
            experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
            style={[styles.glass, { borderColor: C.chromeBorder }]}>
            {/*
              The tint rides ON TOP of the blur rather than being handed to
              BlurView as a background: underneath, the tint becomes the thing
              being blurred and the whole sheet reads as fog. It is also the
              safety net if a platform declines to blur behind a Modal window.
            */}
            <View style={[StyleSheet.absoluteFill, { backgroundColor: C.nav }]} />

            <View style={styles.grabberSlot}>
              <View style={[styles.grabber, { backgroundColor: C.rule3 }]} />
            </View>

            <View style={styles.head}>
              <View style={styles.headMeta}>
                <Text style={[styles.title, { color: C.ink }]}>Voice note</Text>
                <Text
                  accessibilityLiveRegion="polite"
                  style={[styles.kicker, { color: live ? C.liveText : C.ink3 }]}>
                  {blocked ? 'Unavailable' : live ? 'Recording' : 'Ready'}
                </Text>
              </View>

              {/*
                The X dismisses; the Cancel cell below it discards the take.
                Both land on `onCancel` — nothing has been recorded that could
                survive one and not the other — and the design draws both
                (L1507, L1520) because the sheet is tall enough that reaching
                the top of it one-handed is the awkward option, not the obvious
                one.
              */}
              <CircleIconButton
                icon={X}
                tone="chip"
                accessibilityLabel="Close"
                onPress={onCancel}
              />
            </View>

            <View style={styles.body}>
              <GlassCard variant="row" solid padded={false} style={styles.transport}>
                {/*
                  Coral, pulsing at the artboard's own 1s — `LivePulse` carries
                  the bloom and the reduced-motion hold. When the recorder is
                  not running there is no state to announce, so the mark goes
                  quiet and grey rather than pulsing a lie.
                */}
                {live ? (
                  <LivePulse size={DOT} tempo="recording" />
                ) : (
                  <View
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    style={[styles.dot, { backgroundColor: C.ink3 }]}
                  />
                )}

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
              </GlassCard>

              {blocked ? (
                <Text style={[styles.reason, { color: C.ink3 }]}>{unavailableReason}</Text>
              ) : null}

              <View style={styles.actions}>
                <PillButton
                  label="Send voice note"
                  icon={Send}
                  disabled={!canSend}
                  onPress={() => onSend({ durationMs: elapsed, waveform: bars })}
                />
                <AuxButton
                  label="Cancel"
                  variant="bordered"
                  size="lg"
                  align="center"
                  fullWidth
                  onPress={onCancel}
                />
              </View>
            </View>
          </BlurView>
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
    /* L1166's `margin:0 10px`. It lives on the PARENT rather than as a margin
       on the sheet, because the sheet is `width:'100%'` and a margin would put
       it 20px wider than the screen. */
    paddingHorizontal: Space.sm + 2,
  },
  /** Carries the shadow and the placement. The glass below carries the skin. */
  shell: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    borderRadius: SheetMetrics.radius,
  },
  glass: {
    overflow: 'hidden',
    borderRadius: SheetMetrics.radius,
    borderWidth: Rule.hair,
  },
  grabberSlot: {
    paddingTop: Space.md - 2,
    paddingBottom: Space.sm,
    alignItems: 'center',
  },
  grabber: {
    width: SheetMetrics.grabberW,
    height: SheetMetrics.grabberH,
    borderRadius: SheetMetrics.grabberH / 2,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingHorizontal: Space.xl,
    paddingTop: Space.xs,
    paddingBottom: Space.md,
  },
  headMeta: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    ...Type.display(18),
    letterSpacing: tracking(18, -0.015),
  },
  /** Matches the kicker under every other sheet title in the app. */
  kicker: {
    ...Type.label(10),
    letterSpacing: tracking(10, 0.08),
    marginTop: 3,
  },
  body: {
    paddingHorizontal: Space.lg,
    paddingBottom: Space.xxl,
    gap: Space.md + 2,
  },
  transport: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md + 1,
    padding: TRANSPORT_PAD,
  },
  dot: {
    width: DOT,
    height: DOT,
    flexShrink: 0,
    borderRadius: Radii.pill,
  },
  wave: {
    flex: 1,
    flexDirection: 'row',
    // Bars grow up from a shared baseline, the way a level meter reads.
    alignItems: 'flex-end',
    gap: BAR_GAP,
    height: WAVE_HEIGHT,
  },
  /*
    Fully rounded, per L1510. At 3px wide the pill radius shows only as softened
    ends, which is what keeps a wall of twelve bars from reading as a barcode.
  */
  bar: {
    flex: 1,
    borderRadius: Radii.pill,
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
    // Pulls up against the card above it: the reason belongs to the transport,
    // not to the buttons under it.
    marginTop: -Space.sm,
  },
  /** L1519-L1520: the two cells sit 10px apart, tighter than the body gap. */
  actions: {
    gap: Space.sm + 2,
  },
});
