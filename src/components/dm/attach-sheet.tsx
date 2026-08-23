/**
 * SEND SOMETHING — the DM attach sheet.
 *
 * Four rows under a 2px head rule: Photo or video / File / Voice note / A
 * track, each a 58px cell divided by hairlines. No radius, no shadow; the one
 * 2px accent rule along the sheet's top edge is the whole elevation cue.
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
  Rule,
  Space,
  TOUCH_TARGET,
  Type,
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
const ICON = 20;

type OptionSpec = {
  key: AttachOption;
  title: string;
  sub: string;
  Icon: typeof ImageIcon;
  /** The accent is spent on the play glyph only: that row is about playback. */
  accent?: boolean;
};

const OPTIONS: readonly OptionSpec[] = [
  { key: 'media', title: 'Photo or video', sub: 'From your camera roll', Icon: ImageIcon },
  { key: 'file', title: 'File', sub: 'Up to 25 MB', Icon: FileText },
  { key: 'voice', title: 'Voice note', sub: 'Hold to record, up to two minutes', Icon: Mic },
  {
    key: 'track',
    title: 'A track',
    sub: 'Source-agnostic — they can play it on either provider',
    Icon: Play,
    accent: true,
  },
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
            { backgroundColor: C.bg, borderTopColor: C.rule3, paddingBottom: insets.bottom },
            sheetStyle,
          ]}>
          <View style={[styles.head, { borderBottomColor: C.rule }]}>
            <Text style={[styles.title, { color: C.ink }]}>SEND SOMETHING</Text>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onClose}
              style={({ pressed }) => [styles.close, pressed && styles.dim]}>
              <Text style={[styles.closeLabel, { color: C.ink2 }]}>CLOSE</Text>
            </Pressable>
          </View>

          <View style={styles.body}>
            {OPTIONS.map((option, index) => {
              const enabled = available?.[option.key] ?? ATTACH_AVAILABLE[option.key];
              const reason =
                unavailableReason?.[option.key] ?? ATTACH_UNAVAILABLE_REASON[option.key];
              const last = index === OPTIONS.length - 1;

              const iconColor = !enabled ? C.ink3 : option.accent ? C.liveText : C.ink2;

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
                    !last && { borderBottomWidth: Rule.hair, borderBottomColor: C.ruleSoft },
                    { backgroundColor: pressed ? C.surface : 'transparent' },
                  ]}>
                  <option.Icon size={ICON} strokeWidth={2} color={iconColor} />

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
    // A 2px rule at the strongest hairline: it says the surface arrived, and
    // it is the only elevation cue in a design with no shadows. Not accent —
    // a sheet having appeared is not a live state.
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
  title: {
    ...Type.heading(15),
    letterSpacing: tracking(15, 0.03),
    flex: 1,
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
    paddingTop: Space.xs,
    paddingBottom: 18,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingHorizontal: Space.md,
    minHeight: ROW_HEIGHT,
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
