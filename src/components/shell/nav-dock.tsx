/**
 * The floating navigation dock.
 *
 * A blurred capsule hovering over the content, with one circular cell per
 * destination and the active one filled in the accent. It replaces the
 * full-width ruled tab bar.
 *
 * Two things make it read as a floating control rather than a screen border:
 * the ground stays visible on either side and beneath it, and it is blurred so
 * content passes UNDER it rather than stopping at it. Both are load-bearing —
 * a solid, full-width version of this is just a tab bar with round corners.
 *
 * ICONS ONLY, no labels. The labels were three more words on a screen that is
 * already carrying a feed, and a dock of three destinations does not need them.
 * The accessibility label carries the name for anyone who needs it spoken.
 */

import { BlurView } from 'expo-blur';
import { Compass, Radio, User, type LucideIcon } from 'lucide-react-native';
import { memo, useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from 'expo-router/js-tabs';

import { Dock, Duration, Radii, ZIndex } from '@/lib/theme';
import { useColors, useTheme } from '@/lib/theme-context';

/**
 * The three destinations, in order, keyed by route name.
 *
 * `lounges` is deliberately absent: lounges belong to the rail in this app, and
 * a fourth cell here would compete with it.
 */
const CELLS: { name: string; icon: LucideIcon; label: string }[] = [
  { name: 'index', icon: Radio, label: 'The Feed' },
  { name: 'explore', icon: Compass, label: 'Explore lounges' },
  { name: 'profile', icon: User, label: 'Your profile' },
];

export function NavDock({ state, navigation }: BottomTabBarProps) {
  const C = useColors();
  const { scheme } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[styles.layer, { paddingBottom: insets.bottom + Dock.lift }]}
      pointerEvents="box-none">
      <View style={[styles.capsule, { backgroundColor: C.dock }]}>
        {/*
          The blur sits INSIDE the capsule's clip so it takes the pill shape.
          Android's blur is more expensive and less convincing than iOS's, so it
          gets a higher-opacity capsule colour behind it instead of a heavier
          blur — the tint does the work the blur cannot.
        */}
        <BlurView
          intensity={Platform.OS === 'android' ? 24 : 48}
          tint={scheme === 'dark' ? 'dark' : 'light'}
          style={StyleSheet.absoluteFill}
        />

        {CELLS.map((cell) => {
          const index = state.routes.findIndex((route) => route.name === cell.name);
          if (index === -1) return null;

          const route = state.routes[index];

          return (
            <DockCell
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
    </View>
  );
}

type CellProps = {
  icon: LucideIcon;
  label: string;
  focused: boolean;
  onPress: () => void;
};

const DockCell = memo(function DockCell({ icon: Icon, label, focused, onPress }: CellProps) {
  const C = useColors();
  const reduced = useReducedMotion();
  const [held, setHeld] = useState(false);
  const press = useSharedValue(1);

  /**
   * The shared value is driven from an effect rather than written straight out
   * of the press handler.
   *
   * The React Compiler is enabled on this project, and `react-hooks/immutability`
   * treats a handler body as render-phase — so mutating `press.value` there is a
   * lint error, not merely a style preference. `AuxButton` and
   * `CircleIconButton` both resolve it this way; matching them keeps one press
   * pattern across the app.
   */
  useEffect(() => {
    press.value = withTiming(held && !reduced ? 0.9 : 1, { duration: Duration.press });
  }, [held, reduced, press]);

  const animated = useAnimatedStyle(() => ({ transform: [{ scale: press.value }] }));

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={label}
      onPress={onPress}
      onPressIn={() => setHeld(true)}
      onPressOut={() => setHeld(false)}>
      <Animated.View
        style={[
          styles.cell,
          animated,
          { backgroundColor: focused ? C.live : 'transparent' },
        ]}>
        <Icon
          size={22}
          strokeWidth={focused ? 2.4 : 2}
          color={focused ? C.onLive : C.ink2}
        />
      </Animated.View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    zIndex: ZIndex.tabBar,
    ...Platform.select({ android: { elevation: ZIndex.tabBar }, default: {} }),
  },
  capsule: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Dock.gap,
    padding: Dock.padding,
    borderRadius: Radii.pill,
    // Clips the blur to the pill. Without it the blur renders as a rectangle
    // behind rounded corners, which is visible on any busy background.
    overflow: 'hidden',
  },
  cell: {
    width: Dock.cell,
    height: Dock.cell,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
