/**
 * Claim your handle.
 *
 * Built from design/v2/aux-v2.dc.html, screen "Claim handle": one 40px field
 * under an `@`, a hairline, and a one-word verdict. The display-name field, the
 * avatar block, the avatar-URL field, the STEP 2 OF 2 kicker and the three-line
 * format hint are all gone — the verdict line says the only thing a person has
 * to act on, and it says it in two words.
 *
 * The back control and SKIP survive because they are the only ways off this
 * screen, but both are text-quiet: the design has exactly one button here.
 */

import { router } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  Done,
  OnboardingHeader,
  PrimaryCta,
  SecondaryLink,
  useEnterStyle,
} from '@/components/auth/onboarding';
import { useToast } from '@/components/ui';
import {
  USERNAME_MAX,
  normalizeUsername,
  useUpdateProfile,
  useUsernameAvailability,
  type ProfilePatch,
} from '@/features/profile/queries';
import { useAuth } from '@/lib/auth';
import { Fonts, Radii, Rule, Space, Type, raised, tracking } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

const GUTTER = 26;
/** The handle field. 40px type, so the row needs its own height. */
const HANDLE_HEIGHT = 52;
const BACK_BLOCK = 38;
const VERDICT_TICK = 18;

export default function ClaimUsernameScreen() {
  const C = useColors();
  const toast = useToast();
  const enterStyle = useEnterStyle();
  const { user, profile, pendingUsernameClaim, finishUsernameClaim } = useAuth();
  const update = useUpdateProfile(user?.id);

  const [username, setUsername] = useState('');

  // The profile row can arrive a beat after this screen mounts (the signup
  // trigger writes it server-side). Seed once, then never stomp on typing.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !profile) return;
    seeded.current = true;
    setUsername(profile.username);
  }, [profile]);

  const availability = useUsernameAvailability(username, profile?.username);
  const normalized = normalizeUsername(username);
  const free = availability.status === 'available' && normalized.length > 0;

  const leave = useCallback(() => {
    finishUsernameClaim();
    // `replace`, not `back`: during the first run there is nothing behind this
    // screen but the sign-in form the user has already left behind.
    if (pendingUsernameClaim || !router.canGoBack()) {
      router.replace('/(tabs)');
      return;
    }
    router.back();
  }, [finishUsernameClaim, pendingUsernameClaim]);

  // Android's hardware back would otherwise pop back to the sign-in screen
  // with a live session behind it, which the (auth) layout cannot make sense of.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      leave();
      return true;
    });
    return () => subscription.remove();
  }, [leave]);

  const save = useCallback(async () => {
    if (!user) return;
    if (availability.status === 'checking') {
      toast.show('Still checking that handle.', 'info');
      return;
    }
    // Covers 'idle' (empty field) as well as 'invalid' and 'taken'.
    if (availability.status !== 'available') return;

    const patch: ProfilePatch = {};
    // Sending an unchanged username would still hit the unique index; only
    // include it when it is actually a change.
    if (normalized !== profile?.username) patch.username = normalized;
    // Nothing in this flow asks for a display name any more, so an account that
    // arrived without one gets the handle as its name.
    if (!profile?.display_name?.trim()) patch.display_name = normalized;

    try {
      if (Object.keys(patch).length > 0) await update.mutateAsync(patch);
      leave();
    } catch (caught) {
      toast.show(caught instanceof Error ? caught.message : 'Could not save your handle.', 'error');
    }
  }, [
    availability.status,
    leave,
    normalized,
    profile?.display_name,
    profile?.username,
    toast,
    update,
    user,
  ]);

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
            {/* Only when this screen was reached from a profile that already
                has a handle — during signup there is nothing behind it. */}
            {pendingUsernameClaim ? null : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Go back"
                onPress={leave}
                // The block is 38 per the artboard; the target is not.
                hitSlop={4}
                style={({ pressed }) => [
                  styles.back,
                  { backgroundColor: C.surface },
                  raised(C),
                  pressed ? styles.held : null,
                ]}>
                <ArrowLeft size={16} strokeWidth={2.2} color={C.ink} />
              </Pressable>
            )}

            <OnboardingHeader
              title="Claim your handle"
              lede="This is how you appear in the Feed."
            />

            <View style={styles.handleRow}>
              <Text style={[styles.at, { color: C.ink3 }]}>@</Text>
              <TextInput
                value={username}
                // Canonicalised on the way in so the field, the button and the
                // verdict can never disagree about what was typed.
                onChangeText={(next) => setUsername(normalizeUsername(next))}
                accessibilityLabel="Handle"
                placeholder="handle"
                placeholderTextColor={C.ink3}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="username"
                maxLength={USERNAME_MAX}
                selectionColor={C.live}
                style={[styles.handleInput, { color: C.ink }]}
              />
            </View>
            <View style={[styles.hair, { backgroundColor: C.rule }]} />

            {/* One live region, one verdict. Height is reserved so nothing
                below moves as it changes. */}
            <View accessibilityLiveRegion="polite" style={styles.verdict}>
              {free ? (
                <>
                  <Done size={VERDICT_TICK} />
                  <Text style={[styles.verdictLabel, { color: C.ink }]}>Available</Text>
                </>
              ) : availability.status === 'taken' ? (
                <Text style={[styles.verdictLabel, { color: C.liveText }]}>Taken. Try another.</Text>
              ) : availability.status === 'checking' ? (
                <Text style={[styles.verdictLabel, { color: C.ink3 }]}>Checking…</Text>
              ) : availability.message ? (
                <Text style={[styles.verdictLabel, { color: C.ink3 }]}>{availability.message}</Text>
              ) : null}
            </View>

            <View style={styles.spacer} />

            <PrimaryCta
              label={pendingUsernameClaim ? 'Continue' : 'Save'}
              accessibilityLabel={
                pendingUsernameClaim && normalized ? `Continue as @${normalized}` : undefined
              }
              disabled={!free}
              loading={update.isPending}
              onPress={() => {
                void save();
              }}
            />

            {pendingUsernameClaim ? (
              <SecondaryLink label="Skip for now" disabled={update.isPending} onPress={leave} />
            ) : null}
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
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
    paddingBottom: Space.huge,
  },

  back: {
    width: BACK_BLOCK,
    height: BACK_BLOCK,
    alignSelf: 'flex-start',
    borderRadius: Radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },

  handleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 44,
  },
  at: {
    fontFamily: Fonts.extrabold,
    fontSize: 40,
    letterSpacing: tracking(40, -0.04),
  },
  handleInput: {
    flex: 1,
    minWidth: 0,
    height: HANDLE_HEIGHT,
    paddingVertical: 0,
    paddingHorizontal: 0,
    fontFamily: Fonts.extrabold,
    fontSize: 40,
    letterSpacing: tracking(40, -0.04),
  },
  hair: {
    height: Rule.hair,
    marginTop: 14,
  },

  verdict: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginTop: Space.lg,
    minHeight: Space.xl,
  },
  verdictLabel: {
    ...Type.body(13.5),
    fontFamily: Fonts.semibold,
  },

  spacer: {
    flexGrow: 1,
    flexShrink: 1,
    minHeight: Space.xxl,
  },
  held: {
    opacity: 0.9,
  },
});
