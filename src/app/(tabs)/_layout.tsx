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
import { StyleSheet, View } from 'react-native';

import { AmbientGround } from '@/components/shell/ambient-ground';
import { NavBar } from '@/components/shell/nav-bar';
import { UpdateBanner } from '@/components/shell/update-banner';
import { useAuth } from '@/lib/auth';
import { useLocalProfile } from '@/lib/providers';
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
            THE NAVIGATOR NO LONGER ANIMATES. THE CONTENT DOES.

            The spec below used to run 200ms, and what it ran was a cross-fade:
            the "some easy fade" the user asked to be rid of. A cross-fade
            dissolves the whole outgoing screen into the whole incoming one, so
            every card on the new module arrives at the same instant with the
            same treatment — the exact opposite of the design, where a module
            lifts in and the rows inside it follow one after another
            (`auxIn`/`auxRow`, aux-nocturne.dc.html L17-18).

            It is worse than merely redundant now. Every screen in this group
            carries its own `useEntrance` (@/lib/entrance), which fades AND
            lifts. Run a scene cross-fade underneath that and the two opacity
            ramps multiply — the stagger survives, but it reads through a
            dissolve, which is precisely the mush being complained about. One
            animation per arrival, and it is the one that carries meaning.

            SO WHY IS `animation` STILL 'fade' RATHER THAN 'none'? Because
            `none` does not mean "swap instantly", it means "apply no scene
            style at all", and the two are only the same thing on native.
            VERIFIED against the installed BottomTabView rather than assumed:

              - `animation` is read off the merged descriptor options
                (BottomTabView.js L175), so whatever is set here reaches every
                screen in the group — including the ones with no cell in the
                bar. lounge/[id], settings/*, messages/* and room/create are
                all siblings of the four destinations below, because none of
                them declares a nested layout.
              - `hasAnimation()` short-circuits on `animation !== 'none'`
                (L67), so under `none` the interpolated `sceneStyle` is never
                applied to ANY scene. On native that is harmless — the blurred
                screen's `activityState` drops to STATE_INACTIVE and
                react-native-screens detaches it. But `screensEnabled()` is
                false on web, where `MaybeScreen` degrades to a plain absolutely
                positioned View at `zIndex: -1`. Under `none` that View keeps
                full opacity, and since `sceneStyle` above is transparent, every
                screen you have visited would sit stacked behind the one you are
                looking at, relying on CSS stacking-context rules to stay
                hidden. Every screen in this group paints an opaque `C.bg` at
                its own root, so the failure mode is not subtle: the Feed's
                ambient ground would disappear behind whichever tab you came
                from.
              - `fade`'s interpolator (`forFade`) maps progress -1/0/1 to
                opacity 0/1/0. Keeping it means the blurred scene is explicitly
                zeroed on every platform, with no appeal to how a browser
                resolves a negative z-index.

            So the preset stays for its interpolator and the DURATION goes to
            zero, which is the honest length of a transition that no longer
            exists. The value snaps rather than ramps, and the content entrance
            is left as the only thing moving.

            `transitionSpec` could not simply be deleted: BottomTabView reads it
            from options INDEPENDENTLY of `animation` (L112) and falls back to
            the preset's own 150ms, so removing it would have restored a shorter
            cross-fade rather than removing one. `easing` is gone with the
            duration — there is no curve to shape across no time.
          */
          animation: 'fade',
          transitionSpec: {
            animation: 'timing',
            config: { duration: 0 },
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
