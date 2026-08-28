/**
 * Create your account — step 1 of signup.
 *
 * WHY THIS FILE EXISTS. Until now signing in and creating an account were one
 * screen and one form, switched by a segmented control on `(auth)/sign-in`.
 * That looked economical and was actively harmful: the two flows do opposite
 * things on the other side of the button. Signing in resumes an account that
 * already has a handle, a display name and a profile; creating one has none of
 * those and must go and get them. Sharing a form is what let the signup
 * follow-up — claim a handle, then build a profile — leak onto people who were
 * only signing back in, which is the bug this split fixes.
 *
 * So this screen owns the second half of that switch, and it owns the whole
 * signup sequence with it: create the account, then `(auth)/claim-username`
 * (step 2), then the profile gate in `(auth)/profile-setup`.
 *
 * Visually it is the same kit as its neighbours — design/nocturne's field cards
 * (L122-125), the gradient CTA (L127) and the claim screen's back tile (L147).
 * It has no wordmark: Sign in is the front door and wears the brand, this is
 * one step behind it, and repeating a 54px mark on the second screen of a
 * two-screen flow just pushes the fields under the fold.
 */

import { Redirect, router } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import {
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
import { Radii, Rule, Space, Type, raised } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

/** 18, the house gutter — see the note in `(auth)/sign-in`. */
const GUTTER = 18;
/** The chrome back tile, matching `(auth)/claim-username`. */
const BACK_TILE = 40;
/** A longer title than the claim screen's, so it is set smaller. */
const TITLE = 30;

/** Deliberately loose. The confirmation email is the real validator. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Supabase's own floor is 6; 8 is the cheapest security win available here. */
const MIN_PASSWORD = 8;

export default function CreateAccountScreen() {
  const C = useColors();
  const toast = useToast();
  const enterStyle = useEnterStyle();
  const { session, pendingUsernameClaim, beginUsernameClaim, finishUsernameClaim } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);

  const emailProblem = EMAIL_PATTERN.test(email.trim()) ? undefined : 'Enter a valid email address.';
  const passwordProblem =
    password.length >= MIN_PASSWORD ? undefined : `Use at least ${MIN_PASSWORD} characters.`;

  const leave = useCallback(() => {
    // `replace` when there is nothing behind us: this screen is reachable
    // directly by URL on web, where `back()` would leave the app.
    if (router.canGoBack()) router.back();
    else router.replace('/(auth)/sign-in');
  }, []);

  const submit = useCallback(async () => {
    setSubmitted(true);
    if (emailProblem || passwordProblem) return;

    setBusy(true);
    try {
      // Flagged before the request so the (auth) layout is already holding the
      // door open by the time the new session arrives — otherwise it would send
      // a brand-new account straight to the tabs, past the handle it has not
      // picked yet.
      beginUsernameClaim();
      const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
      if (error) throw error;

      if (!data.session) {
        // Email confirmation is on for this project — there is nothing to
        // claim until they come back through the link.
        finishUsernameClaim();
        toast.show('Check your email to confirm your account, then sign in.', 'info');
        router.replace('/(auth)/sign-in');
      }
      // With a session, `pendingUsernameClaim` is what routes on: the redirect
      // below fires on the next render and hands over to step 2.
    } catch (caught) {
      finishUsernameClaim();
      toast.show(authMessage(caught), 'error');
    } finally {
      setBusy(false);
    }
  }, [beginUsernameClaim, email, emailProblem, finishUsernameClaim, password, passwordProblem, toast]);

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
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back to sign in"
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              onPress={leave}
              // The tile is 40 per the artboard's chrome buttons; the target is
              // not — hitSlop takes it past 44 without moving the layout.
              hitSlop={4}
              style={({ pressed }) => [
                styles.back,
                { backgroundColor: pressed ? C.surface2 : C.surface, borderColor: C.rule },
                raised(C),
              ]}>
              <ArrowLeft size={17} strokeWidth={2.2} color={C.ink} />
            </Pressable>

            <OnboardingHeader
              kicker="Step 1 of 2"
              title="Create your account"
              lede="Email and a password. You pick your handle next."
              size={TITLE}
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
              {/* The eye toggle comes with `secureTextEntry` — see
                  `OnboardingField`. It matters most here, where the password
                  is being INVENTED and there is no second chance to check it
                  against something already stored. */}
              <OnboardingField
                label="Password"
                value={password}
                onChangeText={setPassword}
                placeholder={`At least ${MIN_PASSWORD} characters`}
                secureTextEntry
                autoCapitalize="none"
                autoComplete="new-password"
                error={submitted ? passwordProblem : undefined}
              />
            </View>

            <View style={styles.spacer} />

            <PrimaryCta
              label="Create account"
              loading={busy}
              disabled={busy}
              onPress={() => {
                void submit();
              }}
            />

            <SecondaryLink label="I already have an account" disabled={busy} onPress={leave} />

            <Text style={[styles.terms, { color: C.ink3 }]}>
              By creating an account you agree to the terms. We never post anything.
            </Text>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function authMessage(caught: unknown): string {
  if (caught instanceof Error && caught.message) {
    // Supabase's own copy is already user-facing for the case that matters
    // most here: "User already registered".
    return caught.message;
  }
  return 'Something went wrong. Check your connection and try again.';
}

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
    paddingTop: Space.xxxl,
    paddingBottom: 30,
  },

  back: {
    width: BACK_TILE,
    height: BACK_TILE,
    alignSelf: 'flex-start',
    borderRadius: Radii.pill,
    borderWidth: Rule.hair,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },

  fields: {
    marginTop: Space.xxl,
    gap: 10,
  },

  /** Collapses first when the keyboard takes the bottom half of the screen. */
  spacer: {
    flexGrow: 1,
    flexShrink: 1,
    minHeight: Space.xxl,
  },

  terms: {
    ...Type.body(11.5),
    lineHeight: 17,
    textAlign: 'center',
    marginTop: Space.md,
    opacity: 0.8,
  },
});
