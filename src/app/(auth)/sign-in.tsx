/**
 * Sign in.
 *
 * Built from design/nocturne/aux-nocturne.dc.html, screen `isSignin` (L107-144):
 * the 54px wordmark over a two-tone rule, the Sign in / Create account
 * segmented switch, two field cards, the gradient CTA, an OR divider, and the
 * provider buttons under it.
 *
 * TWO STRUCTURAL CHANGES FROM THE VERSION THIS REPLACES, both the design's:
 *
 * 1. THE BRAND HEADER IS BACK. The previous pass cut the wordmark and the pitch
 *    line on the grounds that "the lede carries the one fact that changes what
 *    someone does here". Nocturne puts them back, and they earn it now that
 *    Intro is one screen instead of four — this is the first place the mark is
 *    ever seen at size, and the one line under it is the only pitch left in the
 *    signed-out flow.
 * 2. THE MODE IS A SWITCH, NOT A LINK. Creating an account used to hide behind
 *    a text link below the button, which made the second of the two things
 *    people come here to do the quietest thing on the screen. The segmented
 *    control states both up front and keeps the title honest without one.
 *
 * DELIBERATE DEVIATION: the design draws three provider buttons — Google,
 * Spotify and Apple Music. Only Google is wired (`signInWithOAuth`); Spotify
 * exists in this app as an account LINK from Settings, not as an identity
 * provider, and there is no Apple Music auth at all. Painting three buttons
 * where one works would be a worse screen than painting one. The design's own
 * footnote already explains the absence, so it is kept verbatim.
 */

import { makeRedirectUri } from 'expo-auth-session';
import { Redirect } from 'expo-router';
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
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  BrandRule,
  OnboardingField,
  OnboardingSwitch,
  PrimaryCta,
  useEnterStyle,
} from '@/components/auth/onboarding';
import { Wordmark } from '@/components/shell/wordmark';
import { useToast } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { Fonts, Radii, Rule, Space, Type, tracking } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

// Hands the redirect URL back to `openAuthSessionAsync` and closes the popup.
// No-op on native, required on web.
WebBrowser.maybeCompleteAuthSession();

type Mode = 'signin' | 'signup';

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
/** The brand rule under it — 52 wide here, 64 on Intro (L112). */
const RULE_W = 52;
/** The provider button and its leading glyph chip (L136). */
const PROVIDER_HEIGHT = 54;
const PROVIDER_CHIP = 26;

/**
 * The two modes, as the switch reads them. Declared at module scope so the
 * array identity is stable across renders — the switch maps over it.
 */
const MODES = [
  { value: 'signin', label: 'Sign in' },
  { value: 'signup', label: 'Create account' },
] as const satisfies readonly { value: Mode; label: string }[];

/** Deliberately loose. The confirmation email is the real validator. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Supabase's own floor is 6; 8 is the cheapest security win available here. */
const MIN_PASSWORD = 8;

export default function SignInScreen() {
  const C = useColors();
  const toast = useToast();
  const enterStyle = useEnterStyle();
  const { session, pendingUsernameClaim, beginUsernameClaim, finishUsernameClaim } = useAuth();

  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState<'email' | 'google' | null>(null);

  const signup = mode === 'signup';

  const emailProblem = EMAIL_PATTERN.test(email.trim()) ? undefined : 'Enter a valid email address.';
  const passwordProblem = signup
    ? password.length >= MIN_PASSWORD
      ? undefined
      : `Use at least ${MIN_PASSWORD} characters.`
    : password.length > 0
      ? undefined
      : 'Enter your password.';

  const changeMode = useCallback((next: Mode) => {
    setMode(next);
    // Rules differ between the two modes, so a message written for the other
    // one is worse than no message.
    setSubmitted(false);
  }, []);

  const submit = useCallback(async () => {
    setSubmitted(true);
    if (emailProblem || passwordProblem) return;

    setBusy('email');
    try {
      const credentials = { email: email.trim(), password };

      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword(credentials);
        if (error) throw error;
        // The session lands via onAuthStateChange and the (auth) layout
        // redirects; navigating here as well would race it.
        return;
      }

      // Flagged before the request so the layout is already holding the door
      // open by the time the new session arrives.
      beginUsernameClaim();
      const { data, error } = await supabase.auth.signUp(credentials);
      if (error) throw error;

      if (!data.session) {
        // Email confirmation is on for this project — there is nothing to
        // claim until they come back through the link.
        finishUsernameClaim();
        toast.show('Check your email to confirm your account, then sign in.', 'info');
        setMode('signin');
        setPassword('');
      }
    } catch (caught) {
      finishUsernameClaim();
      toast.show(authMessage(caught), 'error');
    } finally {
      setBusy(null);
    }
  }, [
    beginUsernameClaim,
    email,
    emailProblem,
    finishUsernameClaim,
    mode,
    password,
    passwordProblem,
    toast,
  ]);

  const continueWithGoogle = useCallback(async () => {
    setBusy('google');
    try {
      const redirectTo = googleRedirectUri();

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          // Native has no page to navigate away from; we open the browser
          // ourselves so we can read the callback URL back out of it.
          skipBrowserRedirect: Platform.OS !== 'web',
        },
      });
      if (error) throw error;

      // On web the tab is already navigating to Google; `detectSessionInUrl`
      // picks the session up when it comes back.
      if (Platform.OS === 'web') return;
      if (!data?.url) throw new Error('Google sign-in could not be started.');

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      // Anything but 'success' means the user backed out. That is a choice,
      // not a failure — return to idle without an error toast.
      if (result.type !== 'success') return;

      await completeOAuthCallback(result.url);
    } catch (caught) {
      toast.show(authMessage(caught), 'error');
    } finally {
      setBusy(null);
    }
  }, [toast]);

  // Declarative rather than an imperative push after signUp: this survives a
  // re-render race with the layout's own redirect, and self-heals if the user
  // somehow lands back here mid-claim.
  if (session && pendingUsernameClaim) return <Redirect href="/(auth)/claim-username" />;

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
            <View style={styles.brand}>
              <Wordmark size={LOGO} />

              {/*
                Was an inline `LinearGradient` here, claiming to be the one
                element in the app that paints both accents — while Intro drew
                the same object 12px wider and made the same claim. `BrandRule`
                now owns the gradient and the reasoning, once.
              */}
              <BrandRule width={RULE_W} style={styles.accentRule} />

              {/* The screen's heading. The title moved into the switch below,
                  so this is what a screen reader lands on first. */}
              <Text accessibilityRole="header" style={[styles.kicker, { color: C.ink3 }]}>
                PASS THE AUX
              </Text>
              <Text style={[styles.pitch, { color: C.ink2 }]}>
                Join a Lounge and hear the same chorus at the same moment.
              </Text>
            </View>

            <View style={styles.switchGap}>
              <OnboardingSwitch
                accessibilityLabel="Sign in or create an account"
                value={mode}
                options={MODES}
                onChange={changeMode}
                disabled={busy !== null}
              />
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
              <OnboardingField
                label="Password"
                value={password}
                onChangeText={setPassword}
                placeholder={signup ? `At least ${MIN_PASSWORD} characters` : 'Your password'}
                secureTextEntry
                autoCapitalize="none"
                autoComplete={signup ? 'new-password' : 'current-password'}
                error={submitted ? passwordProblem : undefined}
              />
            </View>

            <View style={styles.ctaGap}>
              <PrimaryCta
                label={signup ? 'Create account' : 'Sign in'}
                loading={busy === 'email'}
                disabled={busy !== null}
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

            {/* A surface pill, not a second gradient: one filled thing per
                screen, and on this one it is the button that gets you in. */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Continue with Google"
              accessibilityState={{ busy: busy === 'google', disabled: busy !== null }}
              disabled={busy !== null}
              onPress={() => {
                void continueWithGoogle();
              }}
              style={({ pressed }) => [
                styles.provider,
                { backgroundColor: pressed ? C.surface2 : C.surface, borderColor: C.rule },
                busy !== null && busy !== 'google' ? styles.blocked : null,
              ]}>
              {busy === 'google' ? (
                <ActivityIndicator size="small" color={C.ink} />
              ) : (
                <>
                  {/*
                    `surface2` on `surface`, which is the one place in this
                    screen that stacking two translucent fills is the point: the
                    chip has to read as a disc set INTO the button rather than
                    as a second object on the ground.
                  */}
                  <View
                    style={[
                      styles.providerChip,
                      { backgroundColor: C.surface2, borderColor: C.rule },
                    ]}>
                    <Text style={[styles.providerGlyph, { color: C.ink2 }]}>G</Text>
                  </View>
                  <Text style={[styles.providerLabel, { color: C.ink }]}>Continue with Google</Text>
                </>
              )}
            </Pressable>

            <View style={styles.spacer} />

            <Text style={[styles.footnote, { color: C.ink3 }]}>
              No Spotify needed. Aux plays through YouTube by default — link Premium later from
              Settings if you have it.
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

/* ------------------------------------------------------------------ oauth */

function googleRedirectUri(): string {
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
async function completeOAuthCallback(url: string): Promise<void> {
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

  throw new Error(returned ?? 'Google did not return a session. Please try again.');
}

function authMessage(caught: unknown): string {
  if (caught instanceof Error && caught.message) {
    // Supabase's own copy is already user-facing for the cases that matter
    // ("Invalid login credentials", "User already registered").
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
  accentRule: {
    marginTop: Space.xxl,
    marginBottom: Space.md,
  },
  kicker: {
    fontFamily: Fonts.extrabold,
    fontSize: 10,
    letterSpacing: tracking(10, 0.2),
  },
  pitch: {
    ...Type.body(14),
    lineHeight: 22,
    textAlign: 'center',
    marginTop: 14,
    // The artboard's own 280. Caps the measure at roughly two even lines
    // instead of one long ragged one.
    maxWidth: 280,
  },

  switchGap: {
    marginTop: 34,
  },
  fields: {
    marginTop: Space.lg,
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
    textAlign: 'left',
    fontFamily: Fonts.semibold,
    fontSize: 14,
  },

  /** Collapses first when the keyboard takes the bottom half of the screen. */
  spacer: {
    flexGrow: 1,
    flexShrink: 1,
    minHeight: Space.xxl,
  },
  footnote: {
    ...Type.body(13),
    lineHeight: 21,
    textAlign: 'center',
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
