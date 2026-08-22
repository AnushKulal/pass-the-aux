import * as Haptics from 'expo-haptics';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Radius, Space, TOUCH_TARGET, Type } from '@/lib/theme';

export type SheetTab = { key: string; label: string };

/**
 * Two presentations, both drawn in the artboards:
 *
 * - `underline` — the lounge's SESSIONS/n · CHAT/48 rule. Mono readout,
 *   uppercased, 1px ink underline on the active tab. Labels here must be
 *   measurements (a section plus its count), which is the only reason 11.5px is
 *   allowed; pass word labels and you have put readable copy under the floor.
 * - `segmented` — the pill control SignIn and CreateLounge use for word labels
 *   ("Sign in" / "Create account", "Public" / "Private"). Readable copy must not
 *   be rendered at mono size, so word-label call sites need this one.
 */
export type SheetTabsVariant = 'underline' | 'segmented';

export type SheetTabsProps = {
  tabs: SheetTab[];
  active: string;
  onChange: (k: string) => void;
  variant?: SheetTabsVariant;
};

/** Tab strip for the room sheet (Queue / Chat) and the auth / visibility pickers. */
export function SheetTabs({ tabs, active, onChange, variant = 'underline' }: SheetTabsProps) {
  const segmented = variant === 'segmented';

  return (
    <View
      accessibilityRole="tablist"
      style={segmented ? styles.segTrack : styles.underlineTrack}>
      {tabs.map((tab) => {
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
              style={[styles.segTab, selected && styles.segTabActive]}>
              <Text
                numberOfLines={1}
                style={[styles.segLabel, selected ? styles.inkLabel : styles.mutedLabel]}>
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
              bottom borders applied directly to text nodes.
            */}
            <View style={[styles.rule, selected && styles.ruleActive]}>
              <Text
                numberOfLines={1}
                style={[styles.monoLabel, selected ? styles.inkLabel : styles.mutedLabel]}>
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
  underlineTrack: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: Space.xxl,
    paddingTop: Space.lg,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  underlineTab: {
    minHeight: TOUCH_TARGET,
    justifyContent: 'center',
  },
  rule: {
    alignSelf: 'flex-start',
    paddingBottom: Space.sm,
    borderBottomWidth: 1,
    // Held at 1 on both states so selecting a tab never moves the baseline.
    borderBottomColor: 'transparent',
  },
  ruleActive: {
    /*
      Ink, not accent. LoungeDetail.dc.html sets this underline to INK
      (`chatUnderline: tab === 'chat' ? INK : 'transparent'`) precisely because
      a selected tab is a passive state. The Session screen draws its own rule
      in accent because there the line is the playhead continuing under the
      list — that one is in room/[id].tsx and is not this component.
    */
    borderBottomColor: Colors.text,
  },
  monoLabel: {
    ...Type.mono,
    textTransform: 'uppercase',
  },

  segTrack: {
    flexDirection: 'row',
    alignItems: 'stretch',
    // 8px between adjacent hit areas, per the touch-target spacing rule — the
    // segments are not allowed to butt up against each other.
    gap: Space.sm,
    padding: Space.xs,
    backgroundColor: Colors.glass,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  segTab: {
    flex: 1,
    minHeight: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Space.md,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  segTabActive: {
    // Glass, not accent: a selected tab is a passive state, not a live one.
    backgroundColor: Colors.glassStrong,
    borderColor: Colors.borderBright,
  },
  segLabel: {
    ...Type.bodyStrong,
  },

  inkLabel: {
    color: Colors.text,
  },
  mutedLabel: {
    color: Colors.muted,
  },
});
