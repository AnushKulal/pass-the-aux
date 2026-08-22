import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { Compass, House, User, Users, type LucideIcon } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/lib/auth';
import { Colors, Fonts, Radius, Space, Type } from '@/lib/theme';

/**
 * Content height of the bar, above the device's bottom safe-area inset.
 * The artboard's 60pt band plus the 1pt hairline: an icon plate, a 4pt gap and
 * a label, with every item comfortably past the 44pt minimum target.
 */
const TAB_BAR_CONTENT_HEIGHT = 62;
const ICON_SIZE = 24;

/** The plate behind the selected icon. Wider than the glyph, so it reads as a key. */
const PLATE_WIDTH = 44;
const PLATE_HEIGHT = 30;

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
      <View style={[styles.plate, focused && styles.plateActive]}>
        <Icon
          size={ICON_SIZE}
          color={focused ? Colors.text : Colors.muted}
          /*
            1.6 is the system's stroke. Selection is carried by weight and by a
            glass plate rather than by a tint, because the one tint that would
            read loudest here — Colors.accent — means "live", and the bar sits
            directly under Feed rows that use it for exactly that.
          */
          strokeWidth={focused ? 2.2 : 1.6}
        />
      </View>
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
         * what keeps the content band clear of the home indicator.
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
    /*
      Solid surface, not glass. The bar is the one element that must never take
      colour from the bloom behind it: it is the app's fixed frame of reference,
      and a translucent bar over a Feed row's artwork glow changes tint as the
      list scrolls under it.
    */
    backgroundColor: Colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
    paddingTop: Space.sm,
    // The hairline is the only separator we want; Android's default elevation
    // would add a competing shadow on top of it.
    elevation: 0,
  },
  plate: {
    width: PLATE_WIDTH,
    height: PLATE_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.md,
  },
  plateActive: {
    backgroundColor: Colors.glassStrong,
  },
  label: {
    fontFamily: Fonts.bodyMedium,
    fontSize: Type.caption.fontSize,
    // Tighter than Type.caption's 18: the bar's height budget is fixed, and the
    // label sits directly under the plate with nothing to lead into.
    lineHeight: 15,
  },
  item: {
    paddingVertical: Space.xs,
  },
  scene: {
    backgroundColor: Colors.bg,
  },
});
