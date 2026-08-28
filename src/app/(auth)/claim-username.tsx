/**
 * Claim your handle.
 *
 * Built from design/nocturne/aux-nocturne.dc.html, screen `isClaim` (L145-168):
 * a step kicker, a 36px headline broken over two lines, the handle typed at
 * 21px inside a coral-tinted pill with its verdict chip on the right, and the
 * identity tile beside a display-name card.
 *
 * WHAT CAME BACK, AND WHY. The previous pass stripped this to one 40px field
 * and a one-word verdict, dropping the display name, the avatar and the step
 * counter. Nocturne restores all three and they are worth restoring: the
 * display name is the only other column `profiles` has that a new account
 * arrives without, and asking for it here is what stops every new user showing
 * up in the Feed as their own handle.
 *
 * THE COLOUR ON THIS SCREEN IS STATE, NOT ACTION. The pill goes coral only when
 * the handle is AVAILABLE — that is the accent rule exactly: coral reports what
 * is true right now, blue is the button underneath that acts on it. A taken or
 * unchecked handle leaves the pill neutral, so the tint itself is the verdict
 * before anyone reads the chip.
 *
 * With one exception, and it is the third hue rather than a shade of the first:
 * FAILURE IS `danger`. A taken handle and one that breaks the rules are errors,
 * not states of the world worth reporting, and this screen used to paint both
 * of them coral — which put success and failure in one colour on the step whose
 * whole job is telling them apart. See the verdict chip below.
 *
 * DELIBERATE DEVIATION: the artboard's hint reads "Tap the tile to change your
 * avatar", but the tile has no handler even in the design (its own notes place
 * the picker on the next screen) and this app has no image picker yet. The tile
 * is decorative here and the hint says what is actually true.
 *
 * THE STEP COUNTER NOW SAYS THREE, AND IT USED TO SAY TWO. This is step two of
 * an email signup — sign in, claim a handle, set up the profile — and that
 * third screen is not decoration any more. It asks the one question Aux cannot
 * start without, which music service the audio comes from, so it is a genuine
 * third step and a counter that stopped at two promised a door that was not the
 * last one. Nothing else on this screen changes: an account that reaches here
 * from Settings still shows "Your handle" and no counter at all, because there
 * is no flow to count.
 */

import { router } from 'expo-router';
import { ArrowLeft, Check } from 'lucide-react-native';
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
  OnboardingField,
  OnboardingHeader,
  PrimaryCta,
  SecondaryLink,
  useEnterStyle,
} from '@/components/auth/onboarding';
import { Avatar, useToast } from '@/components/ui';
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

/**
 * The screen gutter — 18, the house value (`src/components/ui/screen.tsx` and
 * all eleven tab screens).
 *
 * The artboard says 22 and this file used to say it, while Intro said 30, Sign
 * in said 24 and Profile setup said 18. Signup walks all four in order, so the
 * content column jumped inward at every tap. A gutter that holds still across
 * the flow beats four screens each honouring their own artboard.
 */
const GUTTER = 18;
/** The headline, at the artboard's own 36px. */
const TITLE = 36;

/** The handle field. 21px extrabold type, so the row needs its own height. */
const HANDLE_HEIGHT = 34;
/** The identity tile — design L158: 78px at radius 26. */
const TILE = 78;
const TILE_RADIUS = 26;
const BACK_TILE = 40;
const VERDICT_TICK = 13;

export default function ClaimUsernameScreen() {
  const C = useColors();
  const toast = useToast();
  const enterStyle = useEnterStyle();
  const { user, profile, pendingUsernameClaim, finishUsernameClaim } = useAuth();
  const update = useUpdateProfile(user?.id);

  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [focused, setFocused] = useState(false);

  // The profile row can arrive a beat after this screen mounts (the signup
  // trigger writes it server-side). Seed once, then never stomp on typing.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !profile) return;
    seeded.current = true;
    setUsername(profile.username);
    setDisplayName(profile.display_name ?? '');
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

    // An emptied name field falls back to the handle rather than writing an
    // empty string: a nameless profile renders as a blank row in the Feed, in
    // every member list and on every message.
    const nextName = displayName.trim() || normalized;
    if (nextName !== profile?.display_name) patch.display_name = nextName;

    try {
      if (Object.keys(patch).length > 0) await update.mutateAsync(patch);
      leave();
    } catch (caught) {
      toast.show(caught instanceof Error ? caught.message : 'Could not save your handle.', 'error');
    }
  }, [
    availability.status,
    displayName,
    leave,
    normalized,
    profile?.display_name,
    profile?.username,
    toast,
    update,
    user,
  ]);

  /**
   * The verdict chip — design L154, which only ever draws the AVAILABLE state.
   * The other three are built by analogy, and one of them was built wrong.
   *
   * FREE stays solid coral, because a handle nobody has taken is a fact about
   * the world right now, and that is exactly what coral is reserved for.
   *
   * TAKEN IS `danger`, AND THAT IS A CORRECTION. It was `liveWash` / `liveMid`
   * / `liveText`, on a doctrine written into this very comment: "solid coral is
   * the fact, the coral wash is the same fact negated". That reasoning is wrong
   * and it was doing real damage — it painted SUCCESS AND FAILURE IN ONE HUE on
   * the screen whose only question is which of the two you got, so the reader
   * had to parse a five-letter word to find out, with the colour actively
   * arguing the wrong way. A negated fact is a failure. Failure is pink-red
   * here as it is in `TextField`, in the toast and in `OnboardingField`.
   *
   * CHECKING stays neutral: the app has no verdict yet, and neither accent is
   * an honest thing to spend before it does.
   */
  const verdict = free
    ? { label: 'Free', fg: C.onLive, bg: C.live, border: C.live, tick: true }
    : availability.status === 'taken'
      ? { label: 'Taken', fg: C.danger, bg: C.dangerWash, border: C.dangerBorder, tick: false }
      : availability.status === 'checking'
        ? { label: 'Checking', fg: C.ink3, bg: C.surface2, border: C.rule, tick: false }
        : null;

  /** What the CTA says while it cannot be pressed — the unmet condition, named. */
  const blockedLabel =
    availability.status === 'checking'
      ? 'Checking that handle'
      : availability.status === 'taken'
        ? 'That handle is taken'
        : 'Pick a handle';

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
                // The tile is 40 per the artboard's chrome buttons; the target
                // is not — hitSlop takes it past 44 without moving the layout.
                hitSlop={4}
                style={({ pressed }) => [
                  styles.back,
                  { backgroundColor: pressed ? C.surface2 : C.surface, borderColor: C.rule },
                  raised(C),
                ]}>
                <ArrowLeft size={17} strokeWidth={2.2} color={C.ink} />
              </Pressable>
            )}

            <OnboardingHeader
              // Honest rather than hardcoded: this screen is step 2 during
              // signup and a plain edit screen when opened from Settings, and
              // any step counter is a lie in the second case. Three, not two:
              // profile setup after this one asks for a music service, which is
              // required, so it counts.
              kicker={pendingUsernameClaim ? 'Step 2 of 3' : 'Your handle'}
              title="Claim your handle"
              lede="This is how people find you in a Lounge. 3–20 characters, lowercase, numbers and underscores."
              size={TITLE}
            />

            {/*
              One live region around the pill, so the verdict is announced once
              as the handle's state rather than as a separate message arriving
              from somewhere else on the screen.
            */}
            <View accessibilityLiveRegion="polite" style={styles.handleBlock}>
              <View
                style={[
                  styles.handlePill,
                  free
                    ? { backgroundColor: C.liveWash, borderColor: C.liveMid }
                    : { backgroundColor: C.surface, borderColor: focused ? C.rule3 : C.rule },
                ]}>
                <Text style={[styles.at, { color: free ? C.liveText : C.ink3 }]}>@</Text>

                <TextInput
                  value={username}
                  // Canonicalised on the way in so the field, the button and the
                  // verdict can never disagree about what was typed.
                  onChangeText={(next) => setUsername(normalizeUsername(next))}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  accessibilityLabel="Handle"
                  placeholder="handle"
                  placeholderTextColor={C.ink3}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="username"
                  maxLength={USERNAME_MAX}
                  // Blue: dragging a selection is something you DO. This was
                  // `live`, which is the hue this screen uses two elements away
                  // to mean "the handle is yours" — so the caret was quietly
                  // reporting a verdict it knows nothing about.
                  selectionColor={C.pill}
                  style={[styles.handleInput, { color: C.ink }]}
                />

                {verdict ? (
                  <View
                    style={[
                      styles.verdict,
                      { backgroundColor: verdict.bg, borderColor: verdict.border },
                    ]}>
                    {verdict.tick ? (
                      <Check size={VERDICT_TICK} strokeWidth={2.4} color={verdict.fg} />
                    ) : null}
                    <Text style={[styles.verdictLabel, { color: verdict.fg }]}>{verdict.label}</Text>
                  </View>
                ) : null}
              </View>

              {/* Only the rule violations get a sentence. "Taken" and
                  "Checking" already said everything they have to say inside the
                  chip, and repeating them under it reads as two problems.

                  `danger`, not `liveText`: a handle that breaks the rules is a
                  validation failure, and failure does not borrow the hue that
                  means live. Same token the chip beside it now uses for Taken. */}
              {availability.status === 'invalid' && availability.message ? (
                <Text style={[styles.problem, { color: C.danger }]}>{availability.message}</Text>
              ) : null}
            </View>

            <View style={styles.identity}>
              {/*
                Decorative: the Pressable-free tile is the honest one until there
                is a picker behind it. Hidden from the reader because the initial
                it shows is derived from the name field two inches to the right,
                and announcing it repeats that field for no gain.
              */}
              <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                <Avatar
                  identity
                  size={TILE}
                  radius={TILE_RADIUS}
                  name={displayName.trim() || normalized || '?'}
                />
              </View>

              <View style={styles.identityCopy}>
                <OnboardingField
                  label="Display name"
                  value={displayName}
                  onChangeText={setDisplayName}
                  placeholder="Your name"
                  autoCapitalize="sentences"
                  autoComplete="name"
                  maxLength={40}
                />
                <Text style={[styles.hint, { color: C.ink3 }]}>
                  Leave it blank and your handle stands in.
                </Text>
              </View>
            </View>

            <View style={styles.spacer} />

            <PrimaryCta
              label={
                pendingUsernameClaim && normalized
                  ? `Continue as @${normalized}`
                  : pendingUsernameClaim
                    ? 'Continue'
                    : 'Save'
              }
              disabledLabel={blockedLabel}
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

  handleBlock: {
    marginTop: Space.xxl,
  },
  handlePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    // 8 all round except the left, where the `@` needs the same optical inset
    // the artboard gives it.
    padding: Space.sm,
    paddingLeft: Space.lg,
    borderRadius: Radii.pill,
    borderWidth: Rule.hair,
  },
  at: {
    fontFamily: Fonts.extrabold,
    fontSize: 20,
  },
  handleInput: {
    flex: 1,
    minWidth: 0,
    height: HANDLE_HEIGHT,
    paddingVertical: 0,
    paddingHorizontal: 0,
    fontFamily: Fonts.extrabold,
    fontSize: 21,
    letterSpacing: tracking(21, -0.01),
  },
  verdict: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
    borderRadius: Radii.pill,
    borderWidth: Rule.hair,
  },
  verdictLabel: {
    ...Type.label(10),
    fontFamily: Fonts.extrabold,
    letterSpacing: tracking(10, 0.08),
  },
  problem: {
    ...Type.body(12.5),
    marginTop: 10,
    paddingHorizontal: Space.xs,
  },

  identity: {
    flexDirection: 'row',
    gap: Space.md,
    marginTop: 22,
  },
  identityCopy: {
    flex: 1,
    minWidth: 0,
  },
  hint: {
    ...Type.body(12),
    lineHeight: 17,
    marginTop: 7,
  },

  spacer: {
    flexGrow: 1,
    flexShrink: 1,
    minHeight: Space.xxl,
  },
});
