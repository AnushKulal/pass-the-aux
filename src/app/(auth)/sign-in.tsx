import { makeRedirectUri } from 'expo-auth-session';
import { Redirect } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Globe, Music } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { AuxButton, GlassCard, SheetTabs, TextField, useToast } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { Bloom, Colors, PointerEvents, Space, Type } from '@/lib/theme';

// Hands the redirect URL back to `openAuthSessionAsync` and closes the popup.
// No-op on native, required on web.
WebBrowser.maybeCompleteAuthSession();

type Mode = 'signin' | 'signup';

const MODES = [
  { key: 'signin', label: 'Sign in' },
  { key: 'signup', label: 'Create account' },
];

/** Deliberately loose. The confirmation email is the real validator. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Supabase's own floor is 6; 8 is the cheapest security win available here. */
const MIN_PASSWORD = 8;

export default function SignInScreen() {
  const toast = useToast();
  const { session, pendingUsernameClaim, beginUsernameClaim, finishUsernameClaim } = useAuth();

  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState<'email' | 'google' | null>(null);

  const emailProblem = EMAIL_PATTERN.test(email.trim()) ? undefined : 'Enter a valid email address.';
  const passwordProblem =
    mode === 'signup'
      ? password.length >= MIN_PASSWORD
        ? undefined
        : `Use at least ${MIN_PASSWORD} characters.`
      : password.length > 0
        ? undefined
        : 'Enter your password.';

  const changeMode = useCallback((next: string) => {
    setMode(next === 'signup' ? 'signup' : 'signin');
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
    <SafeAreaView style={styles.root} edges={['top', 'bottom', 'left', 'right']}>
      {/*
        Signature 1, dialled right down. No artwork has been loaded this early
        in the app, so the bloom only has to keep the ground from reading as
        flat black behind the wordmark.
      */}
      <View style={[styles.bloom, PointerEvents.none]}>
        <Svg width="100%" height="100%">
          <Defs>
            <RadialGradient id="signInBloom" cx="50%" cy="14%" rx="62%" ry="86%">
              <Stop offset="0" stopColor={Bloom.a} stopOpacity={0.22} />
              <Stop offset="0.45" stopColor={Bloom.b} stopOpacity={0.13} />
              <Stop offset="0.78" stopColor={Colors.bg} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#signInBloom)" />
        </Svg>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={styles.brand}>
            <Text style={styles.wordmark}>aux</Text>
            <Text style={styles.tagline}>Pass the aux.</Text>
          </View>

          {/* Elastic rather than a centred column: the wordmark holds the top
              and the credentials rise to meet the keyboard. */}
          <View style={styles.gap} />

          <View style={styles.block}>
            {/*
              Segmented, per the artboard: a pill track with 44px word-label
              segments. The underline variant would set "Create account" as an
              11.5px mono readout and underline it in accent, and neither is
              right — this is readable copy, and picking a form mode is not live.
            */}
            <SheetTabs tabs={MODES} active={mode} onChange={changeMode} variant="segmented" />

            <View style={styles.form}>
              <TextField
                label="Email"
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                error={submitted ? emailProblem : undefined}
              />

              <TextField
                label="Password"
                value={password}
                onChangeText={setPassword}
                placeholder={mode === 'signup' ? `At least ${MIN_PASSWORD} characters` : 'Your password'}
                secureTextEntry
                autoCapitalize="none"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                error={submitted ? passwordProblem : undefined}
              />
            </View>

            {/* Deliberately the primary fill and never the accent: signing in
                is not a live state. */}
            <AuxButton
              label={mode === 'signup' ? 'Create account' : 'Sign in'}
              onPress={() => {
                void submit();
              }}
              fullWidth
              loading={busy === 'email'}
              disabled={busy !== null && busy !== 'email'}
            />
          </View>

          <View style={styles.block}>
            <View style={styles.divider}>
              <View style={styles.rule} />
              <Text style={styles.dividerLabel}>or</Text>
              <View style={styles.rule} />
            </View>

            <AuxButton
              label="Continue with Google"
              icon={Globe}
              variant="ghost"
              fullWidth
              onPress={() => {
                void continueWithGoogle();
              }}
              loading={busy === 'google'}
              disabled={busy !== null && busy !== 'google'}
            />
          </View>

          <View style={styles.gap} />

          <GlassCard>
            <View style={styles.noteHead}>
              <Music size={18} color={Colors.muted} strokeWidth={1.6} />
              <Text style={styles.noteTitle}>Spotify is not a sign-in method</Text>
            </View>
            <Text style={styles.noteText}>
              Aux plays through YouTube out of the box, so you never need a Spotify account. If you
              have Premium, you can link it later from Settings, Connections to play in Spotify
              instead.
            </Text>
          </GlassCard>
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
    backgroundColor: Colors.bg,
  },
  flex: {
    flex: 1,
  },
  bloom: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 366,
  },
  content: {
    flexGrow: 1,
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    paddingHorizontal: Space.xl,
    paddingTop: Space.xxl,
    paddingBottom: Space.xl,
    gap: Space.lg,
  },
  brand: {
    alignItems: 'center',
    gap: Space.sm,
  },
  wordmark: {
    ...Type.hero,
    color: Colors.text,
    letterSpacing: 0.4,
  },
  tagline: {
    ...Type.body,
    color: Colors.muted,
  },
  /** Collapses first when the keyboard takes the bottom half of the screen. */
  gap: {
    flexGrow: 1,
    flexShrink: 1,
    minHeight: Space.sm,
  },
  block: {
    gap: Space.md,
  },
  form: {
    gap: Space.md,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
  },
  rule: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.border,
  },
  dividerLabel: {
    ...Type.label,
    color: Colors.muted,
  },
  noteHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  noteTitle: {
    ...Type.bodyStrong,
    color: Colors.text,
    flex: 1,
  },
  noteText: {
    ...Type.body,
    color: Colors.muted,
    marginTop: Space.xs,
  },
});
