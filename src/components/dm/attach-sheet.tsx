/**
 * Send something — the DM attach sheet.
 *
 * A rounded sheet with a grabber, and four rows inside it: Photo or video /
 * File / Voice note / A track. Each row is a raised icon tile, a title and one
 * line under it. The sheet floats on `dropped()`, which is what a surface
 * genuinely above the page gets — not the raised pair, which is for things
 * sitting ON the ground.
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
 * sub-line replaced by a one-line reason. It is not hidden, because a row that
 * vanishes reads as a feature that does not exist rather than one that is not
 * wired up yet.
 *
 * To turn a row on: add the dependency, flip its flag in `ATTACH_AVAILABLE`,
 * and pass a handler — or, if the host wants to decide, pass `available` and
 * skip the table entirely. `onSelect` is the only wiring point either way.
 */

import { FileText, Image as ImageIcon, Mic, Play } from 'lucide-react-native';
import { useEffect } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Duration,
  Fonts,
  PointerEvents,
  Radii,
  Sheet as SheetMetrics,
  Space,
  TOUCH_TARGET,
  Type,
  dropped,
  raised,
  tracking,
} from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

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

const ROW_HEIGHT = 58;
const ROW_TILE = 40;
const ICON = 19;

type OptionSpec = {
  key: AttachOption;
  title: string;
  sub: string;
  Icon: typeof ImageIcon;
};

const OPTIONS: readonly OptionSpec[] = [
  { key: 'media', title: 'Photo or video', sub: 'From your camera roll', Icon: ImageIcon },
  { key: 'file', title: 'File', sub: 'Up to 25 MB', Icon: FileText },
  { key: 'voice', title: 'Voice note', sub: 'Up to two minutes', Icon: Mic },
  { key: 'track', title: 'A track', sub: 'They can queue it anywhere', Icon: Play },
];

export type DmAttachSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** Fired for an enabled option. The thread screen owns what happens next. */
  onSelect: (option: AttachOption) => void;
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
  available,
  unavailableReason,
}: DmAttachSheetProps) {
  const C = useColors();
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
        <Animated.View
          style={[
            styles.sheet,
            { backgroundColor: C.bg, paddingBottom: insets.bottom + Space.md },
            dropped(C, 'lg'),
            sheetStyle,
          ]}>
          <View style={styles.grabberSlot}>
            <View style={[styles.grabber, { backgroundColor: C.rule3 }]} />
          </View>

          <View style={styles.head}>
            <Text style={[styles.title, { color: C.ink }]}>Send something</Text>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onClose}
              style={({ pressed }) => [
                styles.close,
                { backgroundColor: pressed ? C.surface2 : C.surface },
                raised(C),
              ]}>
              <Text style={[styles.closeLabel, { color: C.ink2 }]}>Close</Text>
            </Pressable>
          </View>

          <View style={styles.body}>
            {OPTIONS.map((option) => {
              const enabled = available?.[option.key] ?? ATTACH_AVAILABLE[option.key];
              const reason =
                unavailableReason?.[option.key] ?? ATTACH_UNAVAILABLE_REASON[option.key];
              const iconColor = enabled ? C.ink2 : C.ink3;

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
                    { backgroundColor: pressed && enabled ? C.surface : 'transparent' },
                    !enabled && styles.dim,
                  ]}>
                  <View
                    style={[styles.rowTile, { backgroundColor: C.surface }, enabled ? raised(C) : null]}>
                    <option.Icon size={ICON} strokeWidth={2} color={iconColor} />
                  </View>

                  <View style={styles.rowText}>
                    <Text style={[styles.rowTitle, { color: enabled ? C.ink : C.ink3 }]}>
                      {option.title}
                    </Text>
                    <Text style={[styles.rowSub, { color: C.ink3 }]}>
                      {enabled ? option.sub : reason}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
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
    borderTopLeftRadius: SheetMetrics.radius,
    borderTopRightRadius: SheetMetrics.radius,
  },
  grabberSlot: {
    paddingTop: Space.md + 2,
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
    paddingTop: Space.lg,
    paddingBottom: Space.md,
  },
  title: {
    ...Type.display(20),
    letterSpacing: tracking(20, -0.025),
    flex: 1,
    minWidth: 0,
  },
  close: {
    minHeight: TOUCH_TARGET,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Space.lg,
    borderRadius: Radii.md,
  },
  closeLabel: {
    fontFamily: Fonts.semibold,
    fontSize: 12.5,
    lineHeight: 16,
  },
  dim: {
    opacity: 0.55,
  },
  body: {
    paddingHorizontal: Space.md + 2,
    paddingBottom: Space.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingHorizontal: Space.md,
    minHeight: ROW_HEIGHT,
    borderRadius: Radii.lg,
  },
  rowTile: {
    width: ROW_TILE,
    height: ROW_TILE,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.sm,
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
  },
});
