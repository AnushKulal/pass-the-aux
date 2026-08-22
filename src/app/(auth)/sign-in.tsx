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
  TextInput,
  View,
  type KeyboardTypeOptions,
  type TextInputProps,
} from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useToast } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { Duration, Fonts, Rule, Space, Type, tracking } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

// Hands the redirect URL back to `openAuthSessionAsync` and closes the popup.
// No-op on native, required on web.
WebBrowser.maybeCompleteAuthSession();

type Mode = 'signin' | 'signup';

/** The screen gutter. Everything full-bleed measures out from this. */
const GUTTER = 26;
/** Control heights, straight off the artboard. */
const CELL = 46;
const BUTTON = 52;

/** Deliberately loose. The confirmation email is the real validator. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Supabase's own floor is 6; 8 is the cheapest security win available here. */
const MIN_PASSWORD = 8;

export default function SignInScreen() {
  const C = useColors();
  const reduced = useReducedMotion();
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

  const primaryLabel = mode === 'signup' ? 'CREATE ACCOUNT' : 'SIGN IN';

  return (
    <SafeAreaView
      edges={['top', 'bottom', 'left', 'right']}
      style={[styles.root, { backgroundColor: C.bg }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <Animated.View
            style={styles.column}
            entering={
              reduced
                ? undefined
                : FadeInDown.duration(Duration.enter).withInitialValues({
                    opacity: 0,
                    transform: [{ translateY: 8 }],
                  })
            }>
            {/*
              The wordmark and the rule that goes through it. The rule is
              absolutely positioned on this full-width block rather than on the
              padded text, which is how it bleeds off both edges without
              relying on overflow behaviour that differs across platforms.
            */}
            <View style={styles.brand}>
              <View style={styles.brandInner}>
                <Text style={[styles.wordmark, { color: C.ink }]}>AUX</Text>
                <Text style={[styles.tagline, { color: C.ink2 }]}>PASS THE AUX.</Text>
                <Text style={[styles.pitch, { color: C.ink2 }]}>
                  Everyone plays the song on their own account. The server only says{' '}
                  <Text style={{ color: C.ink }}>this track, starting now.</Text>
                </Text>
              </View>
              {/* Last, so it paints over the glyphs rather than behind them. */}
              <View style={[styles.strike, { backgroundColor: C.live }]} />
            </View>

            <View style={styles.gap} />

            {/* Segmented, per the artboard: 46px cells, active cell an accent
                fill. The two modes are the only thing this screen branches on,
                so the control states it flatly. */}
            <View
              accessibilityRole="tablist"
              style={[styles.segment, { borderColor: C.rule3 }]}>
              <SegmentCell
                label="SIGN IN"
                selected={mode === 'signin'}
                onPress={() => changeMode('signin')}
              />
              <SegmentCell
                label="CREATE ACCOUNT"
                selected={mode === 'signup'}
                onPress={() => changeMode('signup')}
                divided
              />
            </View>

            <View style={styles.fields}>
              <Field
                label="EMAIL"
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                error={submitted ? emailProblem : undefined}
              />
              <Field
                label="PASSWORD"
                value={password}
                onChangeText={setPassword}
                placeholder={
                  mode === 'signup' ? `At least ${MIN_PASSWORD} characters` : 'Your password'
                }
                secureTextEntry
                autoCapitalize="none"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                error={submitted ? passwordProblem : undefined}
              />
            </View>

            {/* The one accent fill on this screen. Getting in is the live act. */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={mode === 'signup' ? 'Create account' : 'Sign in'}
              accessibilityState={{ busy: busy === 'email', disabled: busy !== null }}
              disabled={busy !== null}
              onPress={() => {
                void submit();
              }}
              style={({ pressed }) => [
                styles.primary,
                {
                  backgroundColor: pressed ? C.liveText : C.live,
                  opacity: busy !== null && busy !== 'email' ? 0.55 : 1,
                },
              ]}>
              {busy === 'email' ? (
                <ActivityIndicator size="small" color={C.onLive} />
              ) : (
                <Text style={[styles.primaryLabel, { color: C.onLive }]}>{primaryLabel}</Text>
              )}
            </Pressable>

            {/* Bordered, not filled: there is no second brand colour in this
                direction, so non-accent actions are outlines. */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Continue with Google"
              accessibilityState={{ busy: busy === 'google', disabled: busy !== null }}
              disabled={busy !== null}
              onPress={() => {
                void continueWithGoogle();
              }}
              style={({ pressed }) => [
                styles.secondary,
                {
                  borderColor: C.rule3,
                  backgroundColor: pressed ? C.surface : 'transparent',
                  opacity: busy !== null && busy !== 'google' ? 0.55 : 1,
                },
              ]}>
              {busy === 'google' ? (
                <ActivityIndicator size="small" color={C.ink} />
              ) : (
                <Text style={[styles.secondaryLabel, { color: C.ink }]}>Continue with Google</Text>
              )}
            </Pressable>

            {/* Below a 2px rule, the honest note. */}
            <View style={[styles.noteRule, { backgroundColor: C.rule }]} />
            <Text style={[styles.note, { color: C.ink2 }]}>
              No Spotify needed. Aux plays through YouTube by default — link Premium later from
              Settings if you have it.
            </Text>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/* ------------------------------------------------------------------- parts */

function SegmentCell({
  label,
  selected,
  onPress,
  divided = false,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  divided?: boolean;
}) {
  const C = useColors();

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.segmentCell,
        divided && { borderLeftWidth: Rule.hair, borderLeftColor: C.rule3 },
        {
          backgroundColor: selected
            ? C.live
            : pressed
              ? C.surface
              : 'transparent',
        },
      ]}>
      <Text
        numberOfLines={1}
        style={[
          selected ? styles.segmentLabelOn : styles.segmentLabelOff,
          { color: selected ? C.onLive : C.ink2 },
        ]}>
        {label}
      </Text>
    </Pressable>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  error,
  secureTextEntry = false,
  autoCapitalize = 'sentences',
  autoComplete,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  error?: string;
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences';
  autoComplete?: string;
  keyboardType?: KeyboardTypeOptions;
}) {
  const C = useColors();
  const [focused, setFocused] = useState(false);

  return (
    <View>
      <Text style={[styles.fieldLabel, { color: C.ink3 }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        placeholderTextColor={C.ink3}
        secureTextEntry={secureTextEntry}
        autoCapitalize={autoCapitalize}
        autoCorrect={!secureTextEntry}
        keyboardType={keyboardType}
        // The public prop is a plain string; RN wants its own union. Narrowed
        // here so callers are not forced to import RN types.
        autoComplete={autoComplete as TextInputProps['autoComplete']}
        accessibilityLabel={label}
        selectionColor={C.live}
        style={[
          styles.input,
          {
            backgroundColor: C.surface,
            color: C.ink,
            // Border width never changes, only its colour — a thicker focus
            // ring would shift the text by a pixel on every focus. Error
            // outranks focus so the reason is never hidden.
            borderColor: error ? C.danger : focused ? C.ink : C.rule2,
          },
        ]}
      />
      {error ? (
        <Text accessibilityLiveRegion="polite" style={[styles.fieldError, { color: C.danger }]}>
          {error}
        </Text>
      ) : null}
    </View>
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
    maxWidth: 720,
    alignSelf: 'center',
    paddingTop: Space.xxl,
    paddingBottom: Space.huge,
  },
  /**
   * Deliberately unpadded: an absolutely positioned child takes its insets from
   * the parent's PADDING edge, so the strike rule can only bleed to the screen
   * edges if the gutter lives on an inner view instead.
   */
  brand: {
    position: 'relative',
  },
  brandInner: {
    paddingHorizontal: GUTTER,
  },
  wordmark: {
    ...Type.display(88),
    // 0.82 rather than the ramp's 1.06 — a three-letter wordmark wants to sit
    // on its own cap height, not in a line box.
    lineHeight: 72,
    letterSpacing: tracking(88, -0.045),
  },
  /** 2px accent, struck through the wordmark and off both edges. */
  strike: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 52,
    height: Rule.major,
  },
  tagline: {
    ...Type.label(12),
    letterSpacing: tracking(12, 0.22),
    paddingTop: 10,
  },
  pitch: {
    ...Type.body(16),
    maxWidth: 300,
    marginTop: Space.xl,
  },
  /** Collapses first when the keyboard takes the bottom half of the screen. */
  gap: {
    flexGrow: 1,
    flexShrink: 1,
    minHeight: Space.xl,
  },
  segment: {
    flexDirection: 'row',
    marginHorizontal: GUTTER,
    marginBottom: 18,
    borderWidth: Rule.hair,
  },
  segmentCell: {
    flex: 1,
    minHeight: CELL,
    justifyContent: 'center',
    paddingHorizontal: Space.md,
  },
  segmentLabelOn: {
    ...Type.heading(11),
    letterSpacing: tracking(11, 0.1),
  },
  segmentLabelOff: {
    ...Type.label(11),
    letterSpacing: tracking(11, 0.1),
  },
  fields: {
    paddingHorizontal: GUTTER,
    gap: Space.md,
  },
  fieldLabel: {
    ...Type.label(11),
    letterSpacing: tracking(11, 0.12),
    marginBottom: 6,
  },
  input: {
    height: CELL,
    paddingHorizontal: Space.md,
    paddingVertical: 0,
    borderWidth: Rule.hair,
    fontFamily: Fonts.regular,
    fontSize: 16,
  },
  fieldError: {
    ...Type.label(11),
    letterSpacing: tracking(11, 0.09),
    marginTop: 6,
  },
  primary: {
    marginTop: Space.xl,
    marginHorizontal: GUTTER,
    height: BUTTON,
    justifyContent: 'center',
    alignItems: 'flex-start',
    paddingHorizontal: Space.lg,
  },
  primaryLabel: {
    ...Type.heading(13),
    letterSpacing: tracking(13, 0.1),
  },
  secondary: {
    marginTop: 10,
    marginHorizontal: GUTTER,
    height: BUTTON,
    justifyContent: 'center',
    alignItems: 'flex-start',
    paddingHorizontal: Space.lg,
    borderWidth: Rule.hair,
  },
  secondaryLabel: {
    fontFamily: Fonts.semibold,
    fontSize: 13,
    letterSpacing: tracking(13, 0.06),
  },
  noteRule: {
    height: Rule.major,
    marginTop: 22,
    marginHorizontal: GUTTER,
  },
  note: {
    ...Type.body(16),
    marginTop: 14,
    marginHorizontal: GUTTER,
  },
});
