import { Redirect, Stack, usePathname } from 'expo-router';
import { useEffect } from 'react';

import { useAuth } from '@/lib/auth';
import { useLocalProfile, type LocalProfileDraft } from '@/lib/providers';
import { useColors } from '@/lib/theme-context';

/**
 * The signed-out group, plus two exceptions.
 *
 * `claim-username` and `profile-setup` live here because they belong to the
 * signup flow, but both are signed-IN screens: they run right after signup and
 * again whenever the user edits their profile. Bouncing every session-holder to
 * the tabs would make them unreachable, so the guard is inverted for these.
 *
 * `profile-setup` in particular MUST be exempt. The tabs group redirects here
 * when the profile gate is unmet, so without this exemption the two layouts
 * redirect at each other forever.
 *
 * `create-account` is NOT in this list. It is a signed-out screen like
 * `sign-in`: it is where a session gets created, not somewhere a session
 * belongs afterwards.
 */
const SIGNED_IN_ROUTES = ['claim-username', 'profile-setup'];

export default function AuthLayout() {
  const { session, loading, pendingUsernameClaim, profile } = useAuth();
  const { profileDone, hydrating, update } = useLocalProfile();
  const C = useColors();
  const pathname = usePathname();

  const signedInScreen = SIGNED_IN_ROUTES.some((r) => pathname.endsWith(r));
  const onSignIn = pathname.endsWith('sign-in');

  /**
   * THE BUG THIS LAYOUT NOW FIXES: signing in walked people through profile
   * setup, for a profile they had built months earlier.
   *
   * Nothing was wrong with the gate's intent — a brand-new account genuinely
   * has to produce a photo and a line of bio before the Feed opens. What was
   * wrong is WHERE it is remembered. `useLocalProfile` keeps `profileDone` in
   * AsyncStorage keyed by user id, which makes the gate PER DEVICE: reinstall,
   * pick up a second phone, or clear a browser's storage, and an account with a
   * years-old profile reads as one that has never set one up. `(tabs)/_layout`
   * then does exactly what it was told and redirects to `profile-setup`.
   *
   * So the local flag is reconciled against the account's own `profiles` row
   * before anyone is allowed out of this group, on two triggers:
   *
   *   `profile.profile_done` — the server's own flag, and the right answer
   *   whenever it is set. It is server-owned (see the grant in
   *   20260823000100_profiles_and_dms.sql, which deliberately withholds UPDATE
   *   on it) and set only by the `mark_profile_done()` RPC.
   *
   *   `onSignIn` — the interim rule, and the one that actually fires today,
   *   because NOTHING IN THE APP CALLS `mark_profile_done()` YET;
   *   `profile-setup` marks the local draft and stops there, so every row's
   *   `profile_done` is still its default `false`. Until that is wired, the
   *   honest signal available is the one the user named: reaching this screen
   *   with a password means the account is not new, and an account that is not
   *   new has a profile. A row that exists is the proof.
   *
   * THE COST OF THE SECOND TRIGGER, stated rather than hidden: with email
   * confirmation ON, a genuinely new account signs up, confirms by email, and
   * then arrives here to SIGN IN — so it passes the gate having never seen
   * profile setup. That is the trade the split accepts, because "signing in
   * never sends you through setup" is the requirement and half-honouring it
   * would be worse than either alternative. It disappears the moment
   * `profile-setup` calls `mark_profile_done()`: the first trigger takes over
   * and `onSignIn` can be deleted from the line below.
   *
   * WHY HERE AND NOT IN THE SIGN-IN SCREEN. Two reasons, both fatal to the
   * obvious version. `update()` drops any write that arrives while the local
   * store is still keyed to the previous user, and immediately after
   * `signInWithPassword` resolves it is — so a write from the submit handler
   * lands on nothing. And even if it landed, the redirect out of this group is
   * a render away from the sign-in call; only the component that OWNS that
   * redirect can hold it while the flag is fixed. This one does, below.
   */
  const reconcileGate =
    Boolean(session) &&
    !hydrating &&
    !profileDone &&
    profile !== null &&
    (profile.profile_done || onSignIn);

  useEffect(() => {
    if (!reconcileGate || !profile) return;

    /*
      The row is the source of truth for everything it actually stores, so the
      draft is filled from it rather than merely unlocked — otherwise the user
      passes the gate and then finds an empty bio behind it.

      Empty and null columns are skipped instead of written: a local draft may
      hold a photo this device picked (`photoUri` is a file:// path with no
      column to live in yet) and clearing that with the row's null would throw
      away the only copy.
    */
    const patch: Partial<LocalProfileDraft> = {
      profileDone: true,
      showActivity: profile.show_activity,
    };
    if (profile.bio.trim().length > 0) patch.bio = profile.bio;
    if (profile.photo_url) {
      patch.hasPhoto = true;
      patch.photoUri = profile.photo_url;
    }
    if (profile.profile_video_url) {
      patch.hasVideo = true;
      patch.videoUri = profile.profile_video_url;
    }

    update(patch);
  }, [reconcileGate, profile, update]);

  // Render nothing rather than a spinner: the root layout is still holding the
  // splash on a cold start, so this frame is never actually seen.
  //
  // `hydrating` joins `loading` here, and only when there is a session: the
  // gate's value is unknown until AsyncStorage answers, and redirecting to the
  // tabs on an unknown gate is precisely how someone ends up in setup.
  if (loading || (session && hydrating)) return null;

  // One held frame while the effect above writes the flag. Without it the
  // redirect below fires first and `(tabs)/_layout` bounces to profile-setup
  // on a `profileDone` that is about to become true.
  if (reconcileGate) return null;

  if (session && !signedInScreen && !pendingUsernameClaim) return <Redirect href="/(tabs)" />;
  if (!session && signedInScreen) return <Redirect href="/(auth)/sign-in" />;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: C.bg },
        /*
          WAS `slide_from_right`. It is gone, and nothing lateral replaces it.

          The complaint was the slide into the login page, and the sharpest
          version of why it was wrong is the call that produced it: nothing
          PUSHES sign-in. `intro` gets there with `router.replace` on both of
          its paths — the seen-before redirect and `leave()` — and
          `create-account` does the same after a successful signup. A replace is
          not a step deeper into anything, since the screen you came from ceases
          to exist, so a push-from-the-right was narrating a hierarchy move that
          never happened. The returning-user path was the worst of it: `intro`
          renders one held frame while AsyncStorage answers, so what slid in
          from the right was a storage lookup finishing, dressed as navigation.

          `none` is the same decision the root Stack and the tab navigator
          already made, for the same reason: every screen in this group animates
          its own CONTENT in. Sign in, create account, claim username and
          profile setup all hold `useEnterStyle` (@/components/auth/onboarding)
          and intro runs `useEntrance` per section — both the design's `auxIn`,
          a 10px lift with a fade on the house curve. A navigator transition on
          top of that is a second move competing with the one that means
          something.

          Mount-driven arrival is CORRECT here in a way it is not under the
          tabs. `useEnterStyle` runs off an effect with no `focused` dependency,
          which is exactly right for a stack: push mounts the incoming screen,
          pop unmounts it, replace does both — so the entrance replays every
          time someone actually arrives. `useEntrance` needs its focus key only
          because a tab navigator never unmounts what it has shown once.

          VERIFIED AGAINST THE INSTALLED NAVIGATOR, because the tabs layout's
          "`none` is unsafe on web" finding is about a DIFFERENT view and does
          NOT carry over to this one:

            - Native. `NativeStackView.native.js` hands `options.animation`
              straight to `ScreenStackItem` as `stackAnimation`, and `'none'` is
              a member of react-native-screens' `StackAnimationTypes`. The one
              place the navigator second-guesses this option is the iOS
              `gestureDirection: 'vertical'` block, and it only substitutes
              `slide_from_bottom` when `animation` is `undefined` — an explicit
              value is never overridden. These screens are `card`, hence
              horizontal, so it does not apply regardless.
            - Web. The web build of `NativeStackView.js` NEVER READS
              `options.animation` — the string does not occur in the file. It
              lays every route out absolutely filled and toggles
              `display: 'flex' | 'none'` on the ones that are not focused. So
              the hazard that forced the tab navigator to keep `fade` — that
              under `none` its interpolated `sceneStyle` is skipped, leaving
              every visited screen stacked at full opacity — has no analogue
              here. This stack hides blurred screens with `display`,
              unconditionally, and has been swapping instantly on web all along
              no matter what this line said.

          So on web this changes nothing, and on native it removes the slide.
        */
        animation: 'none',
      }}
    />
  );
}
