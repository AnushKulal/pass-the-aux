/**
 * The app shell.
 *
 * A row: the 58px lounge rail on the left, the screen column on the right, and
 * the 54px tab bar pinned to the bottom of that column — so the bar starts
 * where the rail's rule ends rather than running under it.
 *
 * The profile gate is enforced by REDIRECTING to profile-setup, not by hiding
 * the rail and bar in place. Hiding them alone left a signed-in user on an
 * empty Feed with no navigation and no route to the screen that would satisfy
 * the gate — unrecoverable without reinstalling. A gate has to lead somewhere.
 */

import { Redirect } from 'expo-router';
import { Tabs, type BottomTabBarProps } from 'expo-router/js-tabs';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LoungeRail } from '@/components/shell/lounge-rail';
import { UpdateBanner } from '@/components/shell/update-banner';
import { useAuth } from '@/lib/auth';
import { useLocalProfile } from '@/lib/providers';
import { Rule, Space, Type } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

/** Content height of the bar, above the device's bottom safe-area inset. */
const TAB_BAR_HEIGHT = 54;
/** The mark under the active cell's label. */
const ACTIVE_BAR_WIDTH = 22;

/**
 * The three cells, in order, keyed by route name.
 *
 * `lounges` is deliberately absent: lounges are the rail's job in this
 * direction. The route still exists and is still reachable — it just has no
 * cell competing with FEED / EXPLORE / YOU.
 */
const CELLS = [
  { name: 'index', label: 'FEED' },
  { name: 'explore', label: 'EXPLORE' },
  { name: 'profile', label: 'YOU' },
] as const;

function PatchbayTabBar({ state, navigation }: BottomTabBarProps) {
  const C = useColors();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.tabBar,
        {
          height: TAB_BAR_HEIGHT + insets.bottom,
          paddingBottom: insets.bottom,
          backgroundColor: C.bg,
          borderTopColor: C.rule,
        },
      ]}>
      {CELLS.map((cell, position) => {
        const index = state.routes.findIndex((route) => route.name === cell.name);
        if (index === -1) return null;

        const route = state.routes[index];
        const focused = state.index === index;

        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) {
            navigation.navigate(route.name, route.params);
          }
        };

        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={cell.label}
            style={[
              styles.cell,
              position > 0 && { borderLeftWidth: Rule.hair, borderLeftColor: C.rule },
            ]}>
            <Text style={[styles.cellLabel, { color: focused ? C.ink : C.ink2 }]}>
              {cell.label}
            </Text>
            {/*
              The one accent in the bar. It marks the cell you are actually on —
              which is a "you are here", not a decoration, so it earns the red.
            */}
            {focused ? <View style={[styles.activeBar, { backgroundColor: C.live }]} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const renderTabBar = (props: BottomTabBarProps) => <PatchbayTabBar {...props} />;

export default function TabsLayout() {
  const C = useColors();
  const { session, loading } = useAuth();
  const { profileDone, hydrating: gateHydrating } = useLocalProfile();

  /**
   * The inverse of the `(auth)` group's guard. `/` resolves into this group, so
   * a cold start with no stored session lands here first and has to be sent
   * back out. Rendering nothing while `loading` is what stops the intro from
   * flashing for one frame on every launch.
   *
   * `/(auth)/intro` rather than sign-in: intro persists its own "seen" flag and
   * forwards to sign-in the second time, so returning users pay one redirect
   * and see nothing.
   */
  if (loading || gateHydrating) return null;
  if (!session) return <Redirect href="/(auth)/intro" />;

  /**
   * Send the user to the gate rather than merely hiding the chrome behind it.
   *
   * Hiding the rail and tab bar without redirecting left a signed-in user on an
   * empty Feed with no navigation and no route to the screen that satisfies the
   * gate — a dead end with no way out but reinstalling. The gate only works if
   * something actually takes you to it.
   */
  if (!profileDone) return <Redirect href="/(auth)/profile-setup" />;

  return (
    <View style={[styles.shell, { backgroundColor: C.bg }]}>
      <LoungeRail />
      <View style={styles.column}>
        {/*
          Above the navigator, inside the column, so it sits beside the rail
          rather than across it — and so it survives every navigation instead of
          re-entering on each screen.
        */}
        <UpdateBanner />
        <Tabs
          tabBar={renderTabBar}
          screenOptions={{
            // Each tab screen renders its own header.
            headerShown: false,
            sceneStyle: { backgroundColor: C.bg },
            /*
              Every screen in this group animates the same way, and that
              includes the ones with no tab cell — lounge/[id], settings/*,
              messages/* and lounges are all siblings of FEED/EXPLORE/YOU here,
              because none of them declares a nested layout.

              Without this the navigator's default is an instant swap, which is
              why a screen only ever appeared to animate the FIRST time: what
              was moving was the content's own entrance stagger firing on mount.
              Come back to an already-mounted screen and there was no stagger
              and no transition, so it snapped. Naming the transition here makes
              arriving look the same every time, mounted or not.
            */
            animation: 'fade',
          }}>
          <Tabs.Screen
            name="index"
            options={{ title: 'The Feed', tabBarAccessibilityLabel: 'The Feed' }}
          />
          <Tabs.Screen
            name="explore"
            options={{ title: 'Explore', tabBarAccessibilityLabel: 'Explore lounges' }}
          />
          <Tabs.Screen
            name="profile"
            options={{ title: 'You', tabBarAccessibilityLabel: 'Your profile' }}
          />
        </Tabs>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    flexDirection: 'row',
  },
  column: {
    flex: 1,
    minWidth: 0,
  },
  tabBar: {
    flexDirection: 'row',
    /*
      2px, not a hairline: this is a boundary between major sections of the
      app, and in this direction that weight is what separation is made of.
      No elevation — Android's default would add a shadow competing with it.
    */
    borderTopWidth: Rule.major,
    elevation: 0,
  },
  cell: {
    flex: 1,
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingHorizontal: Space.md,
    gap: 3,
  },
  cellLabel: {
    ...Type.heading(11),
    // .1em, per the spec's tab label. Wider than Type.heading's default.
    letterSpacing: 1.1,
  },
  activeBar: {
    width: ACTIVE_BAR_WIDTH,
    height: Rule.major,
  },
});
