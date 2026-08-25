/**
 * Send something — the DM attach sheet.
 *
 * From `design/nocturne/aux-nocturne.dc.html`: the shared sheet shell at L1163-
 * L1167 and the `sheetAttach` body at L1491-L1501. Four rows — Photo or video /
 * File / Voice note / A track — grouped inside ONE bordered card, each a glyph,
 * a title, one line under it and a chevron.
 *
 * THE SHEET FLOATS, which is the shape change from the previous direction. It
 * is inset from both sides, lifted clear of the bottom edge, rounded on all
 * four corners, blurred, and bordered the whole way around — an object resting
 * on the app rather than a panel welded to the frame. Two things follow and
 * both are load-bearing:
 *
 *   `sheetShadow()`, NOT `dropped()`. A sheet is lit by the page it covers, so
 *   its shadow falls UPWARD onto that page. `dropped()` throws it down past the
 *   bottom of the screen, where nobody can see it, and the sheet loses its edge
 *   against whatever it is covering.
 *
 *   EVERY SURFACE INSIDE IT IS OPAQUE. `surface` is 5.5% white; laid over a
 *   BlurView it has nothing solid to sit on and dissolves into the blur.
 *   `GlassCard solid` is the resolved composite of the same colour, so the card
 *   looks identical and survives the glass.
 *
 * The raised icon TILES are gone. The design draws a bare 20px glyph in the
 * gutter, and it is right: a raised tile inside a card inside a floating sheet
 * is three levels of lift in 40px, and the row stopped reading as a row.
 *
 * ## Missing dependencies, stated honestly
 *
 * `expo-image-picker`, `expo-document-picker` and `expo-audio` are NOT in this
 * project's package.json, and this task was not allowed to add them. A React
 * Native bundler resolves `require` at build time, so a capability probe is not
 * possible — an absent module is a build error, not a caught exception. The
 * availability table below is therefore static and deliberately conspicuous.
 *
 * An unavailable row still renders: greyed to `ink3`, not pressable, its
 * sub-line replaced by a one-line reason, and its chevron dropped so nothing
 * promises a next screen. It is not hidden, because a row that vanishes reads
 * as a feature that does not exist rather than one that is not wired up yet.
 *
 * To turn a row on: add the dependency, flip its flag in `ATTACH_AVAILABLE`,
 * and pass a handler — or, if the host wants to decide, pass `available` and
 * skip the table entirely. `onSelect` is the only wiring point either way.
 */

import { BlurView } from 'expo-blur';
import { ChevronRight, FileText, Image as ImageIcon, Mic, Play, X } from 'lucide-react-native';
import { useEffect } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CircleIconButton, GlassCard } from '@/components/ui';
import {
  Duration,
  Fonts,
  PointerEvents,
  Rule,
  Sheet as SheetMetrics,
  Space,
  Type,
  sheetShadow,
  tracking,
} from '@/lib/theme';
import { useColors, useTheme } from '@/lib/theme-context';

export type AttachOption = 'media' | 'file' | 'voice' | 'track';

/**
 * What this build can actually service. See the header — these are static
 * because the bundler cannot be asked at runtime.
 */
export const ATTACH_AVAILABLE: Record<AttachOption, boolean> = {
  media: false,
  file: false,
  voice: false,
  track: true,
};

/** Shown in place of the sub-line when an option is off. One line, no blame. */
export const ATTACH_UNAVAILABLE_REASON: Record<AttachOption, string> = {
  media: 'Unavailable — expo-image-picker is not installed',
  file: 'Unavailable — expo-document-picker is not installed',
  voice: 'Unavailable — expo-audio is not installed',
  track: 'Unavailable in this build',
};

/** L1496: `min-height:60px`. */
const ROW_HEIGHT = 60;
const ICON = 20;
const CHEVRON = 17;

type OptionSpec = {
  key: AttachOption;
  title: string;
  sub: string;
  Icon: typeof ImageIcon;
};

const OPTIONS: readonly OptionSpec[] = [
  { key: 'media', title: 'Photo or video', sub: 'From your camera roll', Icon: ImageIcon },
  { key: 'file', title: 'File', sub: 'Up to 25 MB', Icon: FileText },
  { key: 'voice', title: 'Voice note', sub: 'Hold to record, up to two minutes', Icon: Mic },
  { key: 'track', title: 'A track', sub: 'Source-agnostic — either provider', Icon: Play },
];

export type DmAttachSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** Fired for an enabled option. The thread screen owns what happens next. */
  onSelect: (option: AttachOption) => void;
  /**
   * The handle this is being sent to, without the `@` — printed as the kicker
   * (L1493, `TO {{ dmHandle }}`). Omit and the title stands alone.
   */
  recipient?: string | null;
  /**
   * Overrides `ATTACH_AVAILABLE` per option. A row is enabled only when it is
   * available AND `onSelect` can service it.
   */
  available?: Partial<Record<AttachOption, boolean>>;
  /** Overrides the greyed one-line reason. */
  unavailableReason?: Partial<Record<AttachOption, string>>;
};

export function DmAttachSheet({
  visible,
  onClose,
  onSelect,
  recipient,
  available,
  unavailableReason,
}: DmAttachSheetProps) {
  const C = useColors();
  const { scheme } = useTheme();
  const insets = useSafeAreaInsets();

  const reduced = useReducedMotion();
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
      onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close attach sheet"
        onPress={onClose}
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
              safety net — a Modal is its own window, so if a platform declines
              to blur what is behind it, this layer is still a near-opaque `nav`
              fill and the sheet stays a legible panel.
            */}
            <View style={[StyleSheet.absoluteFill, { backgroundColor: C.nav }]} />

            <View style={styles.grabberSlot}>
              <View style={[styles.grabber, { backgroundColor: C.rule3 }]} />
            </View>

            <View style={styles.head}>
              <View style={styles.headMeta}>
                <Text style={[styles.title, { color: C.ink }]}>Send something</Text>
                {recipient ? (
                  <Text numberOfLines={1} style={[styles.kicker, { color: C.ink3 }]}>
                    To @{recipient}
                  </Text>
                ) : null}
              </View>

              {/*
                `chip` rather than `surface`: the design's close circle is the
                9%-white fill (L1494), which is what this tone paints, and the
                kit has no tone pairing that fill with a hairline. The missing
                1px reads as nothing on glass — the fill alone is twice the
                contrast a `surface` circle would have here.
              */}
              <CircleIconButton
                icon={X}
                tone="chip"
                accessibilityLabel="Close"
                onPress={onClose}
              />
            </View>

            <View style={styles.body}>
              <GlassCard variant="row" solid padded={false} style={styles.group}>
                {OPTIONS.map((option, index) => {
                  const enabled = available?.[option.key] ?? ATTACH_AVAILABLE[option.key];
                  const reason =
                    unavailableReason?.[option.key] ?? ATTACH_UNAVAILABLE_REASON[option.key];

                  return (
                    <Pressable
                      key={option.key}
                      accessibilityRole="button"
                      accessibilityLabel={option.title}
                      accessibilityHint={enabled ? option.sub : reason}
                      accessibilityState={{ disabled: !enabled }}
                      disabled={!enabled}
                      onPress={() => onSelect(option.key)}
                      style={({ pressed }) => [
                        styles.row,
                        // Skipped on the first row: the card's own edge is
                        // already there, and two hairlines 1px apart read as a
                        // 2px border rather than as a separator.
                        index > 0 && { borderTopWidth: Rule.hair, borderTopColor: C.ruleSoft },
                        { backgroundColor: pressed && enabled ? C.surface2 : 'transparent' },
                        !enabled && styles.dim,
                      ]}>
                      <option.Icon
                        size={ICON}
                        strokeWidth={2}
                        color={enabled ? C.ink2 : C.ink3}
                      />

                      <View style={styles.rowText}>
                        <Text style={[styles.rowTitle, { color: enabled ? C.ink : C.ink3 }]}>
                          {option.title}
                        </Text>
                        <Text style={[styles.rowSub, { color: C.ink3 }]}>
                          {enabled ? option.sub : reason}
                        </Text>
                      </View>

                      {/* A chevron promises a next step. An unavailable row has none. */}
                      {enabled ? (
                        <ChevronRight size={CHEVRON} strokeWidth={2} color={C.ink3} />
                      ) : null}
                    </Pressable>
                  );
                })}
              </GlassCard>
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
    paddingBottom: Space.xl,
  },
  /** One card holding all four rows, so the group reads as a single choice. */
  group: {
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingHorizontal: Space.lg,
    minHeight: ROW_HEIGHT,
  },
  dim: {
    opacity: 0.55,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    /*
      15/600, per the prototype. The >=16px body floor governs prose — message
      bodies, the composer field — not a control's own label; every list row in
      this handoff is drawn at 13-15 in the semibold weight.
    */
    fontFamily: Fonts.semibold,
    fontSize: 15,
    lineHeight: 20,
  },
  rowSub: {
    ...Type.body(11),
    marginTop: 2,
  },
});
