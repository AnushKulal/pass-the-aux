import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { Compass, House, User, Users, type LucideIcon } from 'lucide-react-native';
import { StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/lib/auth';
import { Colors, Fonts, Space } from '@/lib/theme';

/**
 * Content height of the bar, above the device's bottom safe-area inset.
 * 60 keeps every tab item comfortably past the 44pt minimum target once the
 * icon and label are stacked.
 */
const TAB_BAR_CONTENT_HEIGHT = 60;
const ICON_SIZE = 24;

/**
 * Builds a `tabBarIcon` renderer.
 *
 * We pick the tint from `focused` instead of using the `color` react-navigation
 * passes in: that argument is typed `ColorValue`, which may be an opaque
 * platform handle, while lucide forwards `color` straight into an SVG prop that
 * needs a real string. Reading our own tokens keeps this strictly typed.
 */
function tabIcon(Icon: LucideIcon) {
  return function TabIcon({ focused }: { focused: boolean }) {
    return (
      <Icon
        size={ICON_SIZE}
        color={focused ? Colors.text : Colors.muted}
        // A slightly heavier stroke reads as "selected" even for users who
        // cannot separate the two tints.
        strokeWidth={focused ? 2.4 : 2}
      />
    );
  };
}

const HomeIcon = tabIcon(House);
const ExploreIcon = tabIcon(Compass);
const LoungesIcon = tabIcon(Users);
const ProfileIcon = tabIcon(User);

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const { session, loading } = useAuth();

  /**
   * The inverse of the `(auth)` group's guard. `/` resolves into this group, so
   * a cold start with no stored session lands here first and has to be sent
   * back out. Rendering nothing while `loading` is what stops the sign-in
   * screen from flashing for one frame on every launch.
   */
  if (loading) return null;
  if (!session) return <Redirect href="/(auth)/sign-in" />;

  return (
    <Tabs
      screenOptions={{
        // Each tab screen renders its own header via the `Screen` component.
        headerShown: false,
        // Not the accent: green is the Feed's "live" signal, and repeating it
        // one row below on the selected tab drains that signal of meaning.
        // Inactive is `muted`, not `faint` — the tint colours the labels too,
        // and faint sits under 4.5:1 on the bar.
        tabBarActiveTintColor: Colors.text,
        tabBarInactiveTintColor: Colors.muted,
        // Pinned rather than left to the automatic breakpoint: `below-icon`
        // keeps the bar's height math valid on tablets and in landscape.
        tabBarLabelPosition: 'below-icon',
        tabBarLabelStyle: styles.label,
        tabBarItemStyle: styles.item,
        tabBarHideOnKeyboard: true,
        sceneStyle: styles.scene,
        /**
         * A numeric `height` here overrides react-navigation's own inset math,
         * so we add the inset back explicitly. The bar's default
         * `paddingBottom: insets.bottom` still applies underneath, which is
         * what keeps the 60pt of content clear of the home indicator.
         */
        tabBarStyle: [styles.tabBar, { height: TAB_BAR_CONTENT_HEIGHT + insets.bottom }],
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarAccessibilityLabel: 'Home',
          tabBarIcon: HomeIcon,
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: 'Explore',
          tabBarAccessibilityLabel: 'Explore lounges and Sessions',
          tabBarIcon: ExploreIcon,
        }}
      />
      <Tabs.Screen
        name="lounges"
        options={{
          title: 'Lounges',
          tabBarAccessibilityLabel: 'Your lounges',
          tabBarIcon: LoungesIcon,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarAccessibilityLabel: 'Your profile',
          tabBarIcon: ProfileIcon,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: Colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
    paddingTop: Space.sm,
    // The hairline is the only separator we want; Android's default elevation
    // would add a competing shadow on top of it.
    elevation: 0,
  },
  label: {
    fontFamily: Fonts.bodyMedium,
    fontSize: 13,
    lineHeight: 18,
  },
  item: {
    paddingVertical: Space.xs,
  },
  scene: {
    backgroundColor: Colors.bg,
  },
});
