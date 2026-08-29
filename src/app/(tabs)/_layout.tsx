/**
 * The app shell.
 *
 * One column with the navigation bar along the bottom. There is no left rail:
 * the design does not have one, and Lounges — the only thing the rail carried —
 * is a navigation destination in its own right now.
 *
 * THE BOTTOM CHROME FLOATS, AND THERE ARE TWO PIECES OF IT. This header used to
 * read "the bar occupies real layout space rather than floating over the
 * content, so no screen has to reserve room for it", which stopped being true
 * the day the full-width bar became a floating capsule — `useDockReserve()` in
 * '@/lib/dock' exists precisely because every screen DOES have to reserve room.
 * The second piece is `MiniSession`, the return bar for a Session someone
 * minimised; it takes no layout space either, and the same hook accounts for it.
 *
 * The profile gate is enforced by REDIRECTING to profile-setup, not by hiding
 * the chrome in place. Hiding it alone left a signed-in user on an empty Feed
 * with no navigation and no route to the screen that would satisfy the gate —
 * unrecoverable without reinstalling. A gate has to lead somewhere.
 */

import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { StyleSheet, View } from 'react-native';

import { AmbientGround } from '@/components/shell/ambient-ground';
import { MiniSession } from '@/components/shell/mini-session';
import { NavBar } from '@/components/shell/nav-bar';
import { UpdateBanner } from '@/components/shell/update-banner';
import { useAuth } from '@/lib/auth';
import { useLocalProfile } from '@/lib/providers';
import { useColors } from '@/lib/theme-context';



/*
 * ─── THERE IS NO `BlurTargetView` HERE ANY MORE, AND THAT IS THE FIX ────────
 *
 * This shell used to be one, with a ref handed to `NavBar` so expo-blur 57's
 * Android path had something to blur, and later to `MiniSession` as well so the
 * two pieces of bottom chrome would be one material. A comment stood here in
 * capitals calling that "ONE TARGET, TWO PIECES OF GLASS". Both halves of that
 * idea turned out to be wrong, and the device said so:
 *
 * 1. THE SECOND CONSUMER KILLED THE PROCESS. Minimising a Session crashed the
 *    app every time — not a JavaScript error, a native fault:
 *
 *      pid …, tid …, name: RenderThread  >>> com.anushkulal.aux <<<
 *      signal 11 (SIGSEGV), code 2 (SEGV_ACCERR)
 *      Cause: stack pointer is close to top of stack; likely stack overflow.
 *      512 total frames, every one of them:
 *        libhwui.so  android::uirenderer::computeTransformImpl(DirtyStack*, Matrix4*)
 *
 *    `computeTransformImpl` walks hwui's damage stack by recursing on `prev`
 *    until it reaches the sentinel, and it never got there because the stack
 *    kept growing. Both BlurViews lived INSIDE the target and redrew FROM it,
 *    so each one's repaint dirtied the target and the dirtied target repainted
 *    the other, roughly 58 times a second, until the recursive walk ran out of
 *    RenderThread stack. It took about six seconds, which is why it presented
 *    as "it crashes when I minimise" and not as anything to do with drawing.
 *
 * 2. IT WAS NEVER BLURRING ANYWAY. Measured on the device after the crash was
 *    fixed: a screenshot with the Feed's body text crossing the capsule's top
 *    edge shows the letterforms equally sharp inside and outside it. A 16px
 *    radius would have smeared them. So the target bought a crash and nothing
 *    else, and "the nav bar is very clear, the background is visible through
 *    it" was an accurate report of what the glass had always been.
 *
 * So the Android blur is gone on purpose and the frost is built out of opacity,
 * which this platform does render — `C.dock` at full strength, see 'nav-bar.tsx'
 * and 'mini-session.tsx'. iOS and web still blur for real; they never used a
 * target, which is also why neither could form the loop.
 *
 * IF IT IS EVER REVIVED: exactly ONE BlurView may point at a BlurTargetView.
 * The second one is not a degraded blur, it is a crash.
 */
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
        tabBar={(props) => <NavBar {...props} />}
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

      {/*
        THE MINIMISED SESSION, and it is a sibling of the navigator rather than
        a child of any screen — which is the whole point of it. Pressing Back
        out of a Session no longer ends it (`@/lib/session` owns the membership
        row now), so something has to say the room is still there and offer the
        way in. A component living inside a screen could not: it would come and
        go with the tab you happen to be on.

        AFTER `<Tabs>` so it paints over the scenes, and carrying the nav's own
        `ZIndex.tabBar` so the two sit on one plane. They cannot fight for it —
        the bar rests `MiniDock.gap` clear of the capsule and never travels far
        enough to touch it. Every overlay in this group that must cover the
        chrome is a real `<Modal>` (the lounge menu, the join code,
        `ConfirmDialog`), which renders in its own window above all of this.

        It renders itself only when a Session is minimised; mounting it
        unconditionally is what keeps the arrival animation and the reserve
        arithmetic in one place instead of spread across a conditional here.

        NO `blurTarget`, AND THAT IS LOAD-BEARING RATHER THAN AN OMISSION. It
        took one, it crashed the process, and the argument is at the top of this
        file. `MiniSession` does not accept the prop any more, so this cannot be
        re-introduced by someone tidying up.
      */}
      <MiniSession />
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
  },
});
