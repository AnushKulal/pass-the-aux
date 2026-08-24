/**
 * The bottom navigation.
 *
 * Four destinations across a full-width bar, each a 34px tile above a 9.5px
 * label. The ACTIVE one is a raised tile — the selection indicator is the
 * design's own depth rather than a colour or an underline, which is what ties
 * the bar to every other surface in the app.
 *
 * Built from design/v2/aux-v2.dc.html: `height:88px; background:var(--nav);
 * padding-bottom:12px; border-top:1px solid var(--hair)`.
 *
 * REPLACES two things at once: the floating capsule dock, and the 58px lounge
 * rail down the left edge. The design has no rail — Lounges is the third cell
 * here instead, which is why this bar has four destinations where the dock had
 * three. One less piece of chrome, and lounges stop being reachable only from
 * an edge strip that no other screen acknowledged.
 */

import { Compass, Radio, User, Users, type LucideIcon } from 'lucide-react-native';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from 'expo-router/js-tabs';

import { Dock, Fonts, Rule, TOUCH_TARGET, ZIndex, raised } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

const CELLS: { name: string; icon: LucideIcon; label: string }[] = [
  { name: 'index', icon: Radio, label: 'Feed' },
  { name: 'explore', icon: Compass, label: 'Explore' },
  { name: 'lounges', icon: Users, label: 'Lounges' },
  { name: 'profile', icon: User, label: 'You' },
];

export function NavBar({ state, navigation }: BottomTabBarProps) {
  const C = useColors();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: C.nav,
          borderTopColor: C.rule,
          // The design's 12px sits above the home indicator, not instead of it.
          paddingBottom: Dock.bottomPad + insets.bottom,
          height: Dock.height + insets.bottom,
        },
      ]}>
      {CELLS.map((cell) => {
        const index = state.routes.findIndex((route) => route.name === cell.name);
        if (index === -1) return null;

        const route = state.routes[index];

        return (
          <NavCell
            key={route.key}
            icon={cell.icon}
            label={cell.label}
            focused={state.index === index}
            onPress={() => {
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });
              if (state.index !== index && !event.defaultPrevented) {
                navigation.navigate(route.name, route.params);
              }
            }}
          />
        );
      })}
    </View>
  );
}

type CellProps = {
  icon: LucideIcon;
  label: string;
  focused: boolean;
  onPress: () => void;
};

const NavCell = memo(function NavCell({ icon: Icon, label, focused, onPress }: CellProps) {
  const C = useColors();

  /*
    No press animation here, deliberately. The tile already changes on selection,
    and a scale on top of that reads as two different things happening for one
    tap. The dock this replaces animated because it had nothing else to say.
  */
  const ink = focused ? C.ink : C.ink3;

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.cell}>
      <View
        style={[
          styles.tile,
          focused ? [{ backgroundColor: C.surface }, raised(C)] : null,
        ]}>
        <Icon size={19} strokeWidth={focused ? 2.4 : 2} color={ink} />
      </View>
      <Text style={[styles.label, { color: ink }]}>{label}</Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: Rule.hair,
    zIndex: ZIndex.tabBar,
  },
  cell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    // The tile is 34px, so the cell carries the rest of the 44px target.
    minHeight: TOUCH_TARGET,
  },
  tile: {
    width: Dock.cell,
    height: Dock.cell,
    borderRadius: Dock.tileRadius,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontFamily: Fonts.semibold,
    fontSize: Dock.labelSize,
  },
});
