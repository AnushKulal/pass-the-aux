/**
 * Sign in.
 *
 * Built from design/v2/aux-v2.dc.html, screen "Sign in": title, two recessed
 * fields, the filled Continue, a rule with OR through it, and Google outlined
 * beside it. The wordmark, the pitch paragraph and the Spotify note the previous
 * version opened with are gone — the lede carries the one fact that changes
 * what someone does here.
 *
 * The artboard shows a single mode. Creating an account is still wired, so it
 * lives on the quiet link under the button rather than in a segmented control
 * the design does not have; the title and the a11y label follow the mode.
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
  OnboardingField,
  OnboardingHeader,
  PrimaryCta,
  SecondaryLink,
  useEnterStyle,
} from '@/components/auth/onboarding';
import { useToast } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { Fonts, Radii, Rule, Space, Type, tracking } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

// Hands the redirect URL back to `openAuthSessionAsync` and closes the popup.
// No-op on native, required on web.
WebBrowser.maybeCompleteAuthSession();

type Mode = 'signin' | 'signup';

/** Straight off the artboard. */
const GUTTER = 26;
const GOOGLE_HEIGHT = 56;
const GOOGLE_MARK = 19;

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
            <OnboardingHeader
              title={signup ? 'Create account' : 'Sign in'}
              lede="Spotify links later, from Settings."
            />

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
                label="Continue"
                accessibilityLabel={signup ? 'Create account' : 'Sign in'}
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

            {/* Raised rather than filled: the one fill on this screen is the
                action that gets you in. */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Continue with Google"
              accessibilityState={{ busy: busy === 'google', disabled: busy !== null }}
              disabled={busy !== null}
              onPress={() => {
                void continueWithGoogle();
              }}
              /*
                Outlined, not raised. With the fields drawn as hairlines now, a
                heavy lift here made the SECONDARY action the loudest object on
                the page. One filled thing — Continue — and everything else
                outlined: that is the whole hierarchy of this screen.
              */
              style={({ pressed }) => [
                styles.google,
                { backgroundColor: C.surface, borderColor: C.rule },
                busy !== null && busy !== 'google' ? styles.blocked : null,
                pressed ? styles.held : null,
              ]}>
              {busy === 'google' ? (
                <ActivityIndicator size="small" color={C.ink} />
              ) : (
                <>
                  <View style={[styles.googleMark, { borderColor: C.ink2 }]} />
                  <Text style={[styles.googleLabel, { color: C.ink }]}>Continue with Google</Text>
                </>
              )}
            </Pressable>

            <View style={styles.spacer} />

            <SecondaryLink
              label={signup ? 'I already have an account' : 'Create an account'}
              disabled={busy !== null}
              onPress={() => changeMode(signup ? 'signin' : 'signup')}
            />

            <Text style={[styles.terms, { color: C.ink3 }]}>
              {'By continuing you agree to the terms.\nWe never post anything.'}
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
    paddingBottom: Space.huge,
  },

  fields: {
    marginTop: 34,
    gap: Space.lg,
  },
  ctaGap: {
    marginTop: 26,
  },

  orRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginVertical: 26,
  },
  hair: {
    flex: 1,
    height: Rule.hair,
  },
  or: {
    ...Type.label(11),
    letterSpacing: tracking(11, 0.12),
  },

  google: {
    height: GOOGLE_HEIGHT,
    borderRadius: Radii.button,
    borderWidth: Rule.hair,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 11,
  },
  googleMark: {
    width: GOOGLE_MARK,
    height: GOOGLE_MARK,
    borderRadius: Radii.pill,
    borderWidth: Rule.major,
  },
  googleLabel: {
    fontFamily: Fonts.semibold,
    fontSize: 15,
  },

  /** Collapses first when the keyboard takes the bottom half of the screen. */
  spacer: {
    flexGrow: 1,
    flexShrink: 1,
    minHeight: Space.xxl,
  },
  terms: {
    ...Type.body(12.5),
    lineHeight: 19,
    textAlign: 'center',
    marginTop: Space.sm,
  },

  blocked: {
    opacity: 0.55,
  },
  held: {
    opacity: 0.9,
  },
});
