/**
 * The app shell.
 *
 * One column with the navigation bar along the bottom. There is no left rail:
 * the design does not have one, and Lounges — the only thing the rail carried —
 * is a navigation destination in its own right now.
 *
 * The bar occupies real layout space rather than floating over the content, so
 * no screen has to reserve room for it.
 *
 * The profile gate is enforced by REDIRECTING to profile-setup, not by hiding
 * the chrome in place. Hiding it alone left a signed-in user on an empty Feed
 * with no navigation and no route to the screen that would satisfy the gate —
 * unrecoverable without reinstalling. A gate has to lead somewhere.
 */

import { Redirect } from 'expo-router';
import { Tabs, type BottomTabBarProps } from 'expo-router/js-tabs';
import { StyleSheet, View } from 'react-native';

import { NavBar } from '@/components/shell/nav-bar';
import { UpdateBanner } from '@/components/shell/update-banner';
import { useAuth } from '@/lib/auth';
import { useLocalProfile } from '@/lib/providers';
import { useColors } from '@/lib/theme-context';

const renderTabBar = (props: BottomTabBarProps) => <NavBar {...props} />;

export default function TabsLayout() {
  const C = useColors();
  const { session, loading } = useAuth();
  const { profileDone, hydrating: gateHydrating } = useLocalProfile();

  /**
   * The inverse of the `(auth)` group's guard. `/` resolves into this group, so
   * a cold start with no stored session lands here first and has to be sent
   * back out. Rendering nothing while `loading` is what stops the intro from
   * flashing for one frame on every launch.
   */
  if (loading || gateHydrating) return null;
  if (!session) return <Redirect href="/(auth)/intro" />;
  if (!profileDone) return <Redirect href="/(auth)/profile-setup" />;

  return (
    <View style={[styles.shell, { backgroundColor: C.bg }]}>
      {/* Above the navigator so it survives every navigation rather than
          re-entering on each screen. */}
      <UpdateBanner />
      <Tabs
        tabBar={renderTabBar}
        screenOptions={{
          // Each screen renders its own header.
          headerShown: false,
          sceneStyle: { backgroundColor: C.bg },
          /*
            Every screen in this group animates the same way, and that includes
            the ones with no cell in the bar — lounge/[id], settings/*, messages/*
            and room/create are all siblings of the four destinations here,
            because none of them declares a nested layout.

            Without this the navigator's default is an instant swap, which is why
            a screen only ever appeared to animate the FIRST time: what was
            moving was the content's own entrance, firing on mount.
          */
          animation: 'fade',
        }}>
        <Tabs.Screen name="index" options={{ title: 'The Feed' }} />
        <Tabs.Screen name="explore" options={{ title: 'Explore' }} />
        <Tabs.Screen name="lounges" options={{ title: 'Lounges' }} />
        <Tabs.Screen name="profile" options={{ title: 'You' }} />
      </Tabs>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
  },
});
