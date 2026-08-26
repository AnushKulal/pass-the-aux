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

import { BlurTargetView } from 'expo-blur';
import { useRef } from 'react';
import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
// `Easing` here is React Native's Animated easing, which is what a bottom-tab
// `transitionSpec` is fed. It is NOT `Easing` from @/lib/theme — that one is a
// CSS cubic-bezier string for a different consumer entirely.
import { Easing, StyleSheet, View } from 'react-native';

import { AmbientGround } from '@/components/shell/ambient-ground';
import { NavBar } from '@/components/shell/nav-bar';
import { UpdateBanner } from '@/components/shell/update-banner';
import { useAuth } from '@/lib/auth';
import { useLocalProfile } from '@/lib/providers';
import { Duration } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';



export default function TabsLayout() {
  const C = useColors();
  /**
   * What Android blurs behind the navigation capsule.
   *
   * `expo-blur`'s Android path does not sample the window the way iOS does — it
   * blurs a `BlurTargetView` handed to it by ref, and given none it silently
   * renders a flat translucent slab over sharp content. That is not a subtle
   * degradation: it is exactly the "the nav bar is clearly using glass ui, i
   * want a little blurring effect" complaint, and the capsule was shipping it.
   *
   * The ref has to live HERE rather than in `nav-bar.tsx`, because the target
   * must WRAP the content being blurred — the ambient ground and the navigator
   * — and the capsule is a sibling of both, not their parent.
   */
  const blurTarget = useRef<View | null>(null);
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
    <BlurTargetView ref={blurTarget} style={[styles.shell, { backgroundColor: C.bg }]}>
      {/*
        Behind everything, drawn once for the whole shell rather than per
        screen, so the blobs stay put across navigation instead of restarting
        their drift on every transition.
      */}
      <AmbientGround />
      {/* Above the navigator so it survives every navigation rather than
          re-entering on each screen. */}
      <UpdateBanner />
      <Tabs
        tabBar={(props) => <NavBar {...props} blurTarget={blurTarget} />}
        screenOptions={{
          // Each screen renders its own header.
          headerShown: false,
          /*
            TRANSPARENT, not `C.bg`. The ambient ground is painted once behind
            this navigator, and an opaque scene would cover it on every screen —
            leaving the blobs visible only in the gaps, which is nowhere.
            The ground colour is on the shell View above instead.
          */
          sceneStyle: { backgroundColor: 'transparent' },
          /*
            Every screen in this group animates the same way, and that includes
            the ones with no cell in the bar — lounge/[id], settings/*, messages/*
            and room/create are all siblings of the four destinations here,
            because none of them declares a nested layout.

            Without this the navigator's default is an instant swap, which is why
            a screen only ever appeared to animate the FIRST time: what was
            moving was the content's own entrance, firing on mount.

            VERIFIED, not assumed: `BottomTabView` reads `animation` off the
            merged descriptor options, so setting it here reaches every screen
            in the group, and `fade` resolves to a real opacity cross-fade of
            the two scenes. Because `sceneStyle` above is transparent, both
            scenes dissolve through the ambient ground rather than through a
            slab of `C.bg`.
          */
          animation: 'fade',
          /*
            The `fade` preset's own spec is 150ms of straight linear, which is
            below the 200-320ms floor `Duration` is documented as holding and
            fast enough to register as a jump-cut rather than a transition.
            This is the same curve and very nearly the same length as the theme
            dissolve in @/lib/theme-context, so changing tab and changing
            appearance now move at one tempo.

            Only the timing is overridden — `sceneStyleInterpolator` still comes
            from the `fade` preset, so this stays a cross-fade.
          */
          transitionSpec: {
            animation: 'timing',
            config: { duration: Duration.scrim, easing: Easing.out(Easing.quad) },
          },
        }}>
        <Tabs.Screen name="index" options={{ title: 'The Feed' }} />
        <Tabs.Screen name="explore" options={{ title: 'Explore' }} />
        <Tabs.Screen name="lounges" options={{ title: 'Lounges' }} />
        <Tabs.Screen name="profile" options={{ title: 'You' }} />
      </Tabs>
    </BlurTargetView>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
  },
});
