/**
 * Sign in.
 *
 * Built from design/nocturne/aux-nocturne.dc.html, screen `isSignin` (L107-144):
 * the 54px wordmark over a two-tone rule, two field cards, the gradient CTA, an
 * OR divider, and the provider buttons under it.
 *
 * THIS SCREEN SIGNS PEOPLE IN. IT DOES NOT CREATE ACCOUNTS, and that is the
 * correction this pass exists for.
 *
 * 1. THE SEGMENTED SWITCH IS GONE. A Sign in / Create account control flipped
 *    ONE form between two jobs, and this file used to argue that stating both
 *    modes up front was the honest thing. It is not, because the two are not
 *    variants of each other: one hands a password to an account that already
 *    exists, the other builds an account and a profile from nothing. Sharing a
 *    form made them look interchangeable, and the bug that fell out of it is
 *    the whole reason for this rewrite — signing in walked people through
 *    profile setup, for a profile they made months ago. Creating an account
 *    now has its own screen: `(auth)/create-account`.
 * 2. SIGNING IN NEVER RUNS PROFILE SETUP. The gate that was sending them there
 *    lives in `useLocalProfile` (AsyncStorage, per-device), and the fix is in
 *    `(auth)/_layout` — it reconciles that local flag against the account's own
 *    `profiles` row before letting anyone out of this group. Read the comment
 *    there; it is the substance of the fix and it is deliberately NOT here,
 *    because the layout is the only place that can hold the redirect while it
 *    happens.
 * 3. THE PITCH LINE IS GONE. It sat under the wordmark and said what Aux is.
 *    Nobody arrives at a SIGN IN screen needing to be sold the app — they have
 *    an account. `(auth)/intro` is the pitch, and it is what a first-time
 *    visitor sees. The line under the title now says what to do instead.
 *
 * PROVIDERS: Google and Spotify are both real (`signInWithOAuth`). Apple Music
 * is rendered DISABLED rather than omitted, because the user asked for it and
 * a missing button is indistinguishable from an oversight. There is no honest
 * way to wire it: Apple's MusicKit is an iOS and web SDK with no Android
 * implementation, this app has no Apple Music playback path at all, and Apple
 * is not a Supabase auth provider configured for this project. The button says
 * so on its face rather than failing after a tap.
 */

import { makeRedirectUri } from 'expo-auth-session';
import { Redirect, router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { ArrowLeft } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  OnboardingField,
  PrimaryCta,
  SecondaryCta,
  useEnterStyle,
} from '@/components/auth/onboarding';
import { Wordmark } from '@/components/shell/wordmark';
import { useToast } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { Fonts, Radii, Rule, Space, Type, raised, tracking } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

// Hands the redirect URL back to `openAuthSessionAsync` and closes the popup.
// No-op on native, required on web.
WebBrowser.maybeCompleteAuthSession();

/**
 * The identity providers this screen can actually complete a round trip with.
 *
 * Apple Music is deliberately not in here — see the file header. Keeping the
 * type to what works is what stops a disabled button from ever being handed to
 * `signInWithOAuth`.
 */
type Provider = 'google' | 'spotify';

const PROVIDER_NAME: Record<Provider, string> = {
  google: 'Google',
  spotify: 'Spotify',
};

/**
 * The screen gutter — 18, the house value (`src/components/ui/screen.tsx` and
 * all eleven tab screens).
 *
 * This said 24, straight off the artboard, while Intro said 30 and Claim handle
 * said 22. Those are three screens walked back to back on a first launch, and
 * the content column stepped inward at every tap. Each artboard's own number
 * loses to a column that holds still across the flow.
 */
const GUTTER = 18;
/** The wordmark at its sign-in size — design L111. */
const LOGO = 54;
/** The provider button and its leading glyph chip (L136). */
const PROVIDER_HEIGHT = 54;
const PROVIDER_CHIP = 26;
/** The screen title, sized to sit under a 54px wordmark rather than fight it. */
const TITLE = 26;

/** Deliberately loose. The account either exists or it does not. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SignInScreen() {
  /*
    Whether this screen was pushed (from the intro's fork) or replaced onto
    (a returning launch). Decides whether a back control can exist at all.
  */
  const canLeave = router.canGoBack();
  const C = useColors();
  const toast = useToast();
  const enterStyle = useEnterStyle();
  const { session, pendingUsernameClaim } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState<'email' | Provider | null>(null);

  const emailProblem = EMAIL_PATTERN.test(email.trim()) ? undefined : 'Enter a valid email address.';
  /*
    No length rule here, and that is part of the point of splitting the screens.
    A minimum belongs on the screen that SETS a password; on the screen that
    checks one, "use at least 8 characters" is the app second-guessing a
    password the server accepted long ago.
  */
  const passwordProblem = password.length > 0 ? undefined : 'Enter your password.';

  const submit = useCallback(async () => {
    setSubmitted(true);
    if (emailProblem || passwordProblem) return;

    setBusy('email');
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;
      // The session lands via onAuthStateChange, `(auth)/_layout` reconciles
      // the profile gate against the account's row, and the redirect follows.
      // Navigating from here would race that and land on the very gate the
      // layout is busy satisfying.
    } catch (caught) {
      toast.show(authMessage(caught), 'error');
    } finally {
      setBusy(null);
    }
  }, [email, emailProblem, password, passwordProblem, toast]);

  /**
   * One handler for both real providers.
   *
   * This was `continueWithGoogle`, hardcoded end to end. The provider is now an
   * argument because Spotify takes exactly the same round trip, and two copies
   * of a PKCE-or-implicit callback parser is two chances to fix only one.
   *
   * NOTE FOR THE PROVIDER PLUMBING IN `@/lib/auth`: this calls Supabase
   * directly because there is nothing else to call yet. When that module
   * exposes a shared sign-in — and the source-preference inheritance that
   * should follow a Spotify identity into playback — replace the body of this
   * callback with it. The buttons below need no changes.
   */
  const continueWith = useCallback(
    async (provider: Provider) => {
      setBusy(provider);
      try {
        const redirectTo = oauthRedirectUri();

        const { data, error } = await supabase.auth.signInWithOAuth({
          provider,
          options: {
            redirectTo,
            // Native has no page to navigate away from; we open the browser
            // ourselves so we can read the callback URL back out of it.
            skipBrowserRedirect: Platform.OS !== 'web',
          },
        });
        if (error) throw error;

        // On web the tab is already navigating away; `detectSessionInUrl`
        // picks the session up when it comes back.
        if (Platform.OS === 'web') return;
        if (!data?.url) {
          throw new Error(`${PROVIDER_NAME[provider]} sign-in could not be started.`);
        }

        const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
        // Anything but 'success' means the user backed out. That is a choice,
        // not a failure — return to idle without an error toast.
        if (result.type !== 'success') return;

        await completeOAuthCallback(result.url, PROVIDER_NAME[provider]);
      } catch (caught) {
        toast.show(authMessage(caught), 'error');
      } finally {
        setBusy(null);
      }
    },
    [toast]
  );

  /*
    A self-heal, not the signup path — that moved to `(auth)/create-account`
    along with the `beginUsernameClaim` call that raises this flag. It stays
    here because the flag is held in memory: if a signup is interrupted and the
    user ends up back on this screen with a live session, the (auth) layout will
    not send them to the tabs, and without this they would sit on a sign-in form
    for an account they are already signed in to.
  */
  if (session && pendingUsernameClaim) return <Redirect href="/(auth)/claim-username" />;

  const blocked = busy !== null;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: C.bg }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <Animated.View style={[styles.column, enterStyle]}>
            {/*
              ONLY WHEN THERE IS SOMEWHERE TO GO, which is why it is conditional
              rather than always drawn.

              This screen is reached two ways. From the intro's fork it is
              PUSHED, so the fork is behind it and someone who picked "Already a
              member" can change their mind — which they could not before, and
              is the whole reason this exists. On a returning launch the intro
              REPLACES itself with this screen, so there is nothing behind it and
              a back control would either do nothing or drop the user out of the
              app entirely.

              `canGoBack()` is the honest test for which of the two happened.
            */}
            {canLeave ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Back"
                onPress={() => router.back()}
                // 40px tile, 44px target — hitSlop rather than a bigger box, so
                // the chrome matches `create-account` exactly.
                hitSlop={4}
                style={({ pressed }) => [
                  styles.back,
                  { backgroundColor: pressed ? C.surface2 : C.surface, borderColor: C.rule },
                  raised(C),
                ]}>
                <ArrowLeft size={17} strokeWidth={2.2} color={C.ink} />
              </Pressable>
            ) : null}

            <View style={styles.brand}>
              <Wordmark size={LOGO} />

              {/*
                NO BRAND RULE AND NO KICKER HERE, and they were both here until
                the column stopped fitting.

                Sign in carried a wordmark, a gradient rule, a tracked kicker, a
                title AND a lede before the first field — five pieces of
                masthead on a screen whose entire job is two inputs and a
                button. The cost was not aesthetic: it pushed "Create account"
                off the bottom, so the second of the two reasons anyone opens
                this screen was reachable only by scrolling to find it, which is
                exactly what was reported.

                Intro keeps the full mark, kicker and rule — it is the screen
                that introduces the app, and it has room. This one keeps the
                wordmark for continuity and drops the rest.
              */}

              {/* The screen's heading, standing where the segmented switch was.
                  A title that names ONE job is what a screen reader lands on
                  now, instead of a two-option control that named two. */}
              <Text
                accessibilityRole="header"
                style={[
                  Type.display(TITLE),
                  styles.title,
                  { color: C.ink, lineHeight: Math.round(TITLE * 1.1) },
                ]}>
                Welcome back
              </Text>
              <Text style={[styles.lede, { color: C.ink2 }]}>
                Sign in with your email and password. Your profile already exists — there is nothing
                to set up again.
              </Text>
            </View>

            <View style={styles.fields}>
              <OnboardingField
                label="Email"
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                error={submitted ? emailProblem : undefined}
              />
              {/* `secureTextEntry` is what puts the eye toggle in the field —
                  see `OnboardingField`. There is no second prop to forget. */}
              <OnboardingField
                label="Password"
                value={password}
                onChangeText={setPassword}
                placeholder="Your password"
                secureTextEntry
                autoCapitalize="none"
                autoComplete="current-password"
                error={submitted ? passwordProblem : undefined}
              />
            </View>

            <View style={styles.ctaGap}>
              <PrimaryCta
                label="Sign in"
                loading={busy === 'email'}
                disabled={blocked}
                onPress={() => {
                  void submit();
                }}
              />
            </View>

            <View style={styles.orRow}>
              <View style={[styles.hair, { backgroundColor: C.rule }]} />
              <Text style={[styles.or, { color: C.ink3 }]}>or</Text>
              <View style={[styles.hair, { backgroundColor: C.rule }]} />
            </View>

            <View style={styles.providers}>
              <ProviderButton
                glyph="G"
                label="Continue with Google"
                busy={busy === 'google'}
                blocked={blocked}
                onPress={() => {
                  void continueWith('google');
                }}
              />
              <ProviderButton
                glyph="S"
                label="Continue with Spotify"
                busy={busy === 'spotify'}
                blocked={blocked}
                onPress={() => {
                  void continueWith('spotify');
                }}
              />
              {/*
                DISABLED, BUT NOT FOR THE REASON THIS USED TO GIVE.

                It said "iOS only", and that is wrong: MusicKit JS runs in any
                modern browser, an Android WebView included, so Apple Music
                sign-in on Android is genuinely possible. Two things stop it
                being useful here, and neither is the platform:

                  - minting the developer token MusicKit needs requires a paid
                    Apple Developer Program membership and a MusicKit key
                  - even with a signed-in user, Apple publishes no way for a
                    third-party Android app to PLAY Apple Music audio. Sign-in
                    would buy an identity and a library, not a playback source,
                    and a playback source is what a Session needs.

                So the honest state is "not wired", with the real blocker named,
                rather than a platform claim that is not true.
              */}
              <ProviderButton
                glyph="A"
                label="Continue with Apple Music"
                tag="Not wired"
                disabled
              />
            </View>

            <View style={[styles.divide, { backgroundColor: C.rule }]} />

            {/*
              Create account, given its own block below a rule rather than a
              text link under the button. It is the second of the two things
              people come to this screen for, and both previous versions buried
              it — first as a link, then as half of a switch that dragged
              profile setup into the sign-in path.
            */}
            <Text style={[styles.newHere, { color: C.ink3 }]}>New to Aux?</Text>
            <SecondaryCta
              label="Create account"
              disabled={blocked}
              onPress={() => {
                router.push('/(auth)/create-account');
              }}
            />

            <Text style={[styles.footnote, { color: C.ink3 }]}>
              No Spotify needed — Aux plays through YouTube by default.
            </Text>
            <Text style={[styles.terms, { color: C.ink3 }]}>
              By continuing you agree to the terms. We never post anything.
            </Text>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/* --------------------------------------------------------------- provider */

type ProviderButtonProps = {
  /**
   * One letter in the leading chip. Lucide carries no brand marks, and a
   * near-miss logo is worse than an initial.
   */
  glyph: string;
  label: string;
  onPress?: () => void;
  /** This provider's own round trip is running. */
  busy?: boolean;
  /** Something else on the screen is running — dim, but do not explain. */
  blocked?: boolean;
  /** Permanently unavailable. `tag` is where the reason goes. */
  disabled?: boolean;
  /** A short muted reason, right-aligned inside the button. */
  tag?: string;
};

/**
 * A surface pill, not a second gradient: one filled thing per screen, and on
 * this one it is the button that gets you in.
 *
 * Extracted from the single hardcoded Google button this screen used to carry,
 * because there are three of them now and one is permanently off.
 */
function ProviderButton({
  glyph,
  label,
  onPress,
  busy = false,
  blocked = false,
  disabled = false,
  tag,
}: ProviderButtonProps) {
  const C = useColors();
  const off = disabled || blocked;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={tag ? `${label} — ${tag}` : label}
      accessibilityState={{ busy, disabled: off }}
      disabled={off || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.provider,
        { backgroundColor: pressed && !off ? C.surface2 : C.surface, borderColor: C.rule },
        off && !busy ? styles.blocked : null,
      ]}>
      {busy ? (
        <ActivityIndicator size="small" color={C.ink} />
      ) : (
        <>
          {/*
            `surface2` on `surface`, which is the one place in this screen that
            stacking two translucent fills is the point: the chip has to read as
            a disc set INTO the button rather than as a second object on the
            ground.
          */}
          <View style={[styles.providerChip, { backgroundColor: C.surface2, borderColor: C.rule }]}>
            <Text style={[styles.providerGlyph, { color: C.ink2 }]}>{glyph}</Text>
          </View>
          <Text style={[styles.providerLabel, { color: disabled ? C.ink3 : C.ink }]}>{label}</Text>
          {tag ? <Text style={[styles.providerTag, { color: C.ink3 }]}>{tag}</Text> : null}
        </>
      )}
    </Pressable>
  );
}

/* ------------------------------------------------------------------ oauth */

function oauthRedirectUri(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    // The origin itself, not a dedicated callback route: the web client has
    // `detectSessionInUrl` on, so whatever route renders at `/` completes the
    // handshake. Add this origin to Supabase Auth's redirect allow-list.
    return window.location.origin;
  }
  return makeRedirectUri({ scheme: 'aux', path: 'auth-callback' });
}

/**
 * Finishes the native leg of the OAuth round trip.
 *
 * Handles both flows on purpose: the Supabase client's `flowType` is not pinned
 * in `@/lib/supabase`, so the callback may carry a PKCE `code` in the query or
 * implicit tokens in the fragment depending on the client default in play.
 */
async function completeOAuthCallback(url: string, provider: string): Promise<void> {
  const [beforeHash = '', hash = ''] = url.split('#');
  const query = new URLSearchParams(beforeHash.split('?')[1] ?? '');
  const fragment = new URLSearchParams(hash);

  const code = query.get('code');
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    return;
  }

  const accessToken = fragment.get('access_token');
  const refreshToken = fragment.get('refresh_token');
  if (accessToken && refreshToken) {
    const { error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) throw error;
    return;
  }

  const returned =
    query.get('error_description') ??
    fragment.get('error_description') ??
    query.get('error') ??
    fragment.get('error');

  throw new Error(returned ?? `${provider} did not return a session. Please try again.`);
}

function authMessage(caught: unknown): string {
  if (caught instanceof Error && caught.message) {
    // Supabase's own copy is already user-facing for the cases that matter
    // ("Invalid login credentials", "Email not confirmed").
    return caught.message;
  }
  return 'Something went wrong. Check your connection and try again.';
}

/* ----------------------------------------------------------------- styles */

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
  },
  back: {
    width: 40,
    height: 40,
    alignSelf: 'flex-start',
    borderRadius: Radii.pill,
    borderWidth: Rule.hair,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  column: {
    flex: 1,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    paddingHorizontal: GUTTER,
    paddingTop: 44,
    paddingBottom: 30,
  },

  brand: {
    alignItems: 'center',
  },
  /** Spacing only — `BrandRule` carries the width, height and radius. */
  title: {
    textAlign: 'center',
    letterSpacing: tracking(TITLE, -0.03),
    marginTop: 14,
  },
  lede: {
    ...Type.body(14),
    lineHeight: 22,
    textAlign: 'center',
    marginTop: Space.sm,
    // The artboard's own 280. Caps the measure at roughly two even lines
    // instead of one long ragged one.
    maxWidth: 280,
  },

  fields: {
    marginTop: 30,
    gap: 10,
  },
  ctaGap: {
    marginTop: 22,
  },

  orRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    marginVertical: Space.xl,
  },
  hair: {
    flex: 1,
    height: Rule.hair,
  },
  or: {
    ...Type.label(10),
    fontFamily: Fonts.extrabold,
    letterSpacing: tracking(10, 0.14),
  },

  providers: {
    gap: 10,
  },
  provider: {
    minHeight: PROVIDER_HEIGHT,
    borderRadius: Radii.pill,
    borderWidth: Rule.hair,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.md,
    paddingHorizontal: 18,
  },
  providerChip: {
    width: PROVIDER_CHIP,
    height: PROVIDER_CHIP,
    flexShrink: 0,
    borderRadius: Radii.pill,
    borderWidth: Rule.hair,
    alignItems: 'center',
    justifyContent: 'center',
  },
  providerGlyph: {
    fontFamily: Fonts.extrabold,
    fontSize: 12,
  },
  providerLabel: {
    // Left-aligned inside a flexed slot, per the artboard: the labels of a
    // provider stack have to start on one x or the glyphs stop reading as a
    // column.
    flex: 1,
    minWidth: 0,
    textAlign: 'left',
    fontFamily: Fonts.semibold,
    fontSize: 14,
  },
  providerTag: {
    ...Type.label(10),
    fontFamily: Fonts.extrabold,
    flexShrink: 0,
    letterSpacing: tracking(10, 0.08),
  },

  /** Collapses first when the keyboard takes the bottom half of the screen. */
  /**
   * The rule above the create-account block. Its own style rather than `hair`,
   * which is `flex: 1` because it lives inside the horizontal OR row — reused
   * here it would collapse to nothing in a column.
   */
  divide: {
    height: Rule.hair,
    alignSelf: 'stretch',
    marginBottom: Space.lg,
  },
  newHere: {
    ...Type.label(10),
    fontFamily: Fonts.extrabold,
    letterSpacing: tracking(10, 0.14),
    textAlign: 'center',
    marginBottom: Space.md,
  },

  footnote: {
    ...Type.body(12.5),
    lineHeight: 20,
    textAlign: 'center',
    marginTop: Space.xl,
  },
  terms: {
    ...Type.body(11.5),
    lineHeight: 17,
    textAlign: 'center',
    marginTop: Space.md,
    // The least important text on the screen, and set to say so. Kept because
    // it is the only place the terms are stated, not because anyone reads it.
    opacity: 0.8,
  },

  blocked: {
    opacity: 0.55,
  },
});
