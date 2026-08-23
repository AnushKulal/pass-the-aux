/**
 * The app shell.
 *
 * A row: the 58px lounge rail on the left and the screen column on the right,
 * with the navigation dock FLOATING over the bottom of that column rather than
 * being pinned to it. The dock takes no layout space, so the column gives that
 * space back as `sceneStyle` padding — see DOCK_CLEARANCE.
 *
 * The profile gate is enforced by REDIRECTING to profile-setup, not by hiding
 * the rail and bar in place. Hiding them alone left a signed-in user on an
 * empty Feed with no navigation and no route to the screen that would satisfy
 * the gate — unrecoverable without reinstalling. A gate has to lead somewhere.
 */

import { Redirect } from 'expo-router';
import { Tabs, type BottomTabBarProps } from 'expo-router/js-tabs';
import { StyleSheet, View } from 'react-native';

import { LoungeRail } from '@/components/shell/lounge-rail';
import { NavDock } from '@/components/shell/nav-dock';
import { UpdateBanner } from '@/components/shell/update-banner';
import { useAuth } from '@/lib/auth';
import { useLocalProfile } from '@/lib/providers';
import { Dock } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

const renderTabBar = (props: BottomTabBarProps) => <NavDock {...props} />;

/**
 * Clearance under every screen so content can scroll clear of the floating
 * dock instead of ending behind it. The dock takes no layout space of its own —
 * that is what makes it float — so the space has to be given back here.
 */
const DOCK_CLEARANCE = Dock.cell + Dock.padding * 2 + Dock.lift;

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
            sceneStyle: { backgroundColor: C.bg, paddingBottom: DOCK_CLEARANCE },
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
});
