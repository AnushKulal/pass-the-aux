import * as Haptics from 'expo-haptics';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { useColors } from '@/lib/theme-context';
import { Radius, Rule, Space, TOUCH_TARGET, Type } from '@/lib/theme';

export type SheetTab = { key: string; label: string };

/**
 * Two presentations, both drawn in the prototype:
 *
 * - `segmented` — SIGN IN / CREATE ACCOUNT, PUBLIC / INVITE ONLY. One bordered
 *   box of 46px cells butted against each other, divided by a 1px rule, with the
 *   active cell painted in the accent. The cells are flush by design: this is a
 *   single control, and the 8px-between-targets rule is about neighbouring
 *   controls, not about the segments inside one.
 * - `underline` — SESSIONS / CHAT / MEMBERS on a lounge. 44px cells, the active
 *   one carrying a 2px accent underline.
 *
 * The accent is spent here on purpose: in this app the selected tab is what you
 * are currently *in*, which is the same claim the red makes everywhere else.
 */
export type SheetTabsVariant = 'underline' | 'segmented';

export type SheetTabsProps = {
  tabs: SheetTab[];
  active: string;
  onChange: (k: string) => void;
  variant?: SheetTabsVariant;
};

const SEGMENT_HEIGHT = 46;

export function SheetTabs({ tabs, active, onChange, variant = 'underline' }: SheetTabsProps) {
  const C = useColors();
  const segmented = variant === 'segmented';

  return (
    <View
      accessibilityRole="tablist"
      style={
        segmented
          ? [styles.segTrack, { borderColor: C.rule2 }]
          : [styles.underlineTrack, { borderBottomColor: C.rule }]
      }>
      {tabs.map((tab, i) => {
        const selected = tab.key === active;

        const press = () => {
          if (selected) return;
          if (Platform.OS !== 'web') {
            void Haptics.selectionAsync();
          }
          onChange(tab.key);
        };

        if (segmented) {
          return (
            <Pressable
              key={tab.key}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={tab.label}
              onPress={press}
              style={[
                styles.segTab,
                {
                  backgroundColor: selected ? C.live : 'transparent',
                  // The divider lives on every cell but the first, so the box
                  // reads as one control cut into parts rather than as a row of
                  // separate buttons.
                  borderLeftWidth: i === 0 ? 0 : Rule.hair,
                  borderLeftColor: C.rule3,
                },
              ]}>
              <Text
                numberOfLines={1}
                style={[styles.label, { color: selected ? C.onLive : C.ink2 }]}>
                {tab.label}
              </Text>
            </Pressable>
          );
        }

        return (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={tab.label}
            onPress={press}
            style={styles.underlineTab}>
            {/*
              The rule lives on a wrapper rather than on the Text: Android drops
              bottom borders applied directly to text nodes. Its width is held at
              2 on both states so selecting a tab never moves the baseline.
            */}
            <View
              style={[
                styles.underline,
                { borderBottomColor: selected ? C.live : 'transparent' },
              ]}>
              <Text numberOfLines={1} style={[styles.label, { color: selected ? C.ink : C.ink2 }]}>
                {tab.label}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    ...Type.heading(13),
    textTransform: 'uppercase',
  },

  segTrack: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderRadius: Radius,
    borderWidth: Rule.hair,
  },
  segTab: {
    flex: 1,
    minHeight: SEGMENT_HEIGHT,
    // Flush left, like every other label in this design.
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingHorizontal: Space.md,
  },

  underlineTrack: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: Space.xxl,
    borderBottomWidth: Rule.hair,
  },
  underlineTab: {
    minHeight: TOUCH_TARGET,
    justifyContent: 'center',
  },
  underline: {
    alignSelf: 'stretch',
    justifyContent: 'center',
    flex: 1,
    borderBottomWidth: Rule.major,
    // Pulled down so the 2px accent covers the track's hairline instead of
    // stacking on top of it and reading as a 3px line.
    marginBottom: -Rule.hair,
  },
});
