import * as Haptics from 'expo-haptics';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Radius, Space, TOUCH_TARGET, Type } from '@/lib/theme';

export type SheetTab = { key: string; label: string };

export type SheetTabsProps = {
  tabs: SheetTab[];
  active: string;
  onChange: (k: string) => void;
};

/** Segmented control for the room sheet (Queue / Chat / People). */
export function SheetTabs({ tabs, active, onChange }: SheetTabsProps) {
  return (
    <View accessibilityRole="tablist" style={styles.track}>
      {tabs.map((tab) => {
        const selected = tab.key === active;
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={tab.label}
            onPress={() => {
              if (selected) return;
              if (Platform.OS !== 'web') {
                void Haptics.selectionAsync();
              }
              onChange(tab.key);
            }}
            style={[styles.tab, selected && styles.tabActive]}>
            <Text
              numberOfLines={1}
              style={[styles.label, selected ? styles.labelActive : styles.labelIdle]}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    alignItems: 'stretch',
    // 8px between adjacent hit areas, per the touch-target spacing rule — the
    // segments are not allowed to butt up against each other.
    gap: Space.sm,
    padding: Space.xs,
    backgroundColor: Colors.surface,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tab: {
    flex: 1,
    minHeight: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Space.md,
    borderRadius: Radius.pill,
  },
  tabActive: {
    backgroundColor: Colors.primary,
  },
  label: {
    ...Type.label,
    fontSize: 15,
  },
  labelActive: {
    color: Colors.text,
  },
  labelIdle: {
    color: Colors.muted,
  },
});
