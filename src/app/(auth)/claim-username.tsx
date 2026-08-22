import { Image } from 'expo-image';
import { router } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  ActivityIndicator,
  BackHandler,
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
import {
  USERNAME_MAX,
  USERNAME_MIN,
  USERNAME_PATTERN,
  normalizeUsername,
  useUpdateProfile,
  useUsernameAvailability,
  type ProfilePatch,
  type UsernameStatus,
} from '@/features/profile/queries';
import { useAuth } from '@/lib/auth';
import { Duration, Fonts, Rule, Space, TOUCH_TARGET, Type, tracking } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';
import type { Palette } from '@/lib/theme';

const GUTTER = 26;
const CELL = 46;
const BUTTON = 52;
/** The `@` block and the avatar block, straight off the artboard. */
const AT_BLOCK = 46;
const AVATAR_BLOCK = 76;

export default function ClaimUsernameScreen() {
  const C = useColors();
  const reduced = useReducedMotion();
  const toast = useToast();
  const { user, profile, pendingUsernameClaim, finishUsernameClaim } = useAuth();
  const update = useUpdateProfile(user?.id);

  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [handleFocused, setHandleFocused] = useState(false);
  const avatarField = useRef<TextInput>(null);

  // The profile row can arrive a beat after this screen mounts (the signup
  // trigger writes it server-side). Seed once, then never stomp on typing.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !profile) return;
    seeded.current = true;
    setUsername(profile.username);
    setDisplayName(profile.display_name);
    setAvatarUrl(profile.avatar_url ?? '');
  }, [profile]);

  const availability = useUsernameAvailability(username, profile?.username);
  const normalized = normalizeUsername(username);
  const avatarProblem = avatarUrlProblem(avatarUrl);

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
    setSubmitted(true);

    if (!user) return;
    if (avatarProblem) return;
    if (availability.status === 'checking') {
      toast.show('Still checking that username — one second.', 'info');
      return;
    }
    // Covers 'idle' (empty field) as well as 'invalid' and 'taken'.
    if (availability.status !== 'available') return;

    const patch: ProfilePatch = {
      display_name: displayName.trim() || normalized,
      avatar_url: avatarUrl.trim() || null,
    };
    // Sending an unchanged username would still hit the unique index; only
    // include it when it is actually a change.
    if (normalized !== profile?.username) patch.username = normalized;

    try {
      await update.mutateAsync(patch);
      toast.show('Profile saved.', 'success');
      leave();
    } catch (caught) {
      toast.show(caught instanceof Error ? caught.message : 'Could not save your profile.', 'error');
    }
  }, [
    availability.status,
    avatarProblem,
    avatarUrl,
    displayName,
    leave,
    normalized,
    profile?.username,
    toast,
    update,
    user,
  ]);

  // "Taken" is reported by the chip inside the control, with its own colour —
  // saying it twice reads as two separate problems. This line is reserved for
  // the format rules, which only matter once they try to save.
  const usernameError =
    submitted && (availability.status === 'invalid' || availability.status === 'idle')
      ? (availability.message ?? 'Pick a username.')
      : null;

  /*
    A handle that is merely still being typed is not a failure. "Too short" is
    reported quietly in the hint line; only characters the constraint actually
    rejects earn the red frame and the INVALID verdict, so the control does not
    shout at someone two keystrokes in.
  */
  const rejected = normalized.length > 0 && !USERNAME_PATTERN.test(normalized);
  const verdict: UsernameStatus =
    availability.status === 'invalid' && !rejected ? 'idle' : availability.status;

  const frame = frameColor(C, verdict, handleFocused);
  const initial = (displayName.trim() || normalized || '?').charAt(0).toUpperCase();
  const showAvatar = !avatarProblem && avatarUrl.trim().length > 0;

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
            {pendingUsernameClaim ? (
              <Text style={[styles.step, { color: C.ink3 }]}>STEP 2 OF 2</Text>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Back"
                onPress={leave}
                style={styles.back}>
                <ArrowLeft size={15} color={C.ink2} strokeWidth={2} />
                <Text style={[styles.backLabel, { color: C.ink2 }]}>YOU</Text>
              </Pressable>
            )}

            <Text style={[styles.title, { color: C.ink }]}>Claim your handle</Text>
            <Text style={[styles.lede, { color: C.ink2 }]}>
              {pendingUsernameClaim
                ? 'You are in. Pick the name people will see when you take the aux.'
                : 'Change how you show up in lounges and Sessions.'}
            </Text>

            {/*
              Composed rather than a plain field because the artboard puts the
              `@` inside the control as furniture and the verdict chip inside
              the same frame — the whole control is one object that changes
              colour, not a field with decorations bolted on.
            */}
            <View style={[styles.handle, { borderColor: frame }]}>
              <View style={[styles.at, { backgroundColor: C.live }]}>
                <Text style={[styles.atGlyph, { color: C.onLive }]}>@</Text>
              </View>
              <TextInput
                value={username}
                // Canonicalised on the way in so the field, the button and the
                // availability verdict can never disagree about what was typed.
                onChangeText={(next) => setUsername(normalizeUsername(next))}
                onFocus={() => setHandleFocused(true)}
                onBlur={() => setHandleFocused(false)}
                accessibilityLabel="Username"
                placeholder="handle"
                placeholderTextColor={C.ink3}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="username"
                maxLength={USERNAME_MAX}
                selectionColor={C.live}
                style={[styles.handleInput, { backgroundColor: C.surface, color: C.ink }]}
              />
              <StatusChip status={verdict} />
            </View>

            {/* One live region for the whole control: the chip carries the
                verdict, this line carries the reason. */}
            <Text
              accessibilityLiveRegion="polite"
              style={[
                styles.hint,
                { color: usernameError || verdict === 'taken' || rejected ? C.danger : C.ink3 },
              ]}>
              {usernameError ??
                availability.message ??
                `${USERNAME_MIN} to ${USERNAME_MAX} characters. Lowercase letters, numbers and underscores only.`}
            </Text>

            <View style={styles.identity}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Change your avatar"
                onPress={() => avatarField.current?.focus()}
                style={[styles.avatar, { backgroundColor: C.live }]}>
                {showAvatar ? (
                  <Image
                    source={{ uri: avatarUrl.trim() }}
                    style={styles.avatarImage}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                    transition={Duration.press}
                    accessibilityIgnoresInvertColors
                  />
                ) : (
                  <Text style={[styles.avatarInitial, { color: C.onLive }]}>{initial}</Text>
                )}
              </Pressable>

              <View style={styles.identityFields}>
                <Field
                  label="DISPLAY NAME"
                  value={displayName}
                  onChangeText={setDisplayName}
                  placeholder="What friends call you"
                  maxLength={40}
                  autoComplete="name"
                />
                <Text style={[styles.caption, { color: C.ink3 }]}>
                  Tap the block to change your avatar
                </Text>
              </View>
            </View>

            <View style={styles.avatarUrl}>
              <Field
                inputRef={avatarField}
                label="AVATAR URL"
                value={avatarUrl}
                onChangeText={setAvatarUrl}
                placeholder="https://..."
                autoCapitalize="none"
                keyboardType="url"
                error={submitted ? avatarProblem : undefined}
              />
            </View>

            <View style={styles.gap} />

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={pendingUsernameClaim ? `Continue as @${normalized}` : 'Save'}
              accessibilityState={{ busy: update.isPending }}
              disabled={update.isPending}
              onPress={() => {
                void save();
              }}
              style={({ pressed }) => [
                styles.primary,
                { backgroundColor: pressed ? C.liveText : C.live, opacity: update.isPending ? 0.55 : 1 },
              ]}>
              {update.isPending ? (
                <ActivityIndicator size="small" color={C.onLive} />
              ) : (
                <Text numberOfLines={1} style={[styles.primaryLabel, { color: C.onLive }]}>
                  {pendingUsernameClaim && normalized ? `CONTINUE AS @${normalized.toUpperCase()}` : 'SAVE'}
                </Text>
              )}
            </Pressable>

            {pendingUsernameClaim ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Skip for now"
                disabled={update.isPending}
                onPress={leave}
                style={({ pressed }) => [
                  styles.secondary,
                  {
                    borderColor: C.rule3,
                    backgroundColor: pressed ? C.surface : 'transparent',
                    opacity: update.isPending ? 0.55 : 1,
                  },
                ]}>
                <Text style={[styles.secondaryLabel, { color: C.ink }]}>SKIP FOR NOW</Text>
              </Pressable>
            ) : null}
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/* ------------------------------------------------------------------- parts */

/**
 * The verdict, inside the frame. Accent means the handle is yours to take —
 * "joinable" in the same sense the Feed uses it — and nothing else on this
 * screen is allowed to borrow that colour.
 */
function StatusChip({ status }: { status: UsernameStatus }) {
  const C = useColors();
  if (status === 'idle') return null;

  if (status === 'checking') {
    return (
      <View style={[styles.chip, { backgroundColor: C.surface }]}>
        <ActivityIndicator size="small" color={C.ink3} />
      </View>
    );
  }

  const bad = status === 'taken' || status === 'invalid';
  const label = status === 'available' ? 'AVAILABLE' : status === 'taken' ? 'TAKEN' : 'INVALID';

  return (
    <View style={[styles.chip, { backgroundColor: C.surface }]}>
      <Text style={[styles.chipLabel, { color: bad ? C.danger : C.liveText }]}>{label}</Text>
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  error,
  autoCapitalize = 'sentences',
  autoComplete,
  keyboardType,
  maxLength,
  inputRef,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  error?: string;
  autoCapitalize?: 'none' | 'sentences';
  autoComplete?: string;
  keyboardType?: KeyboardTypeOptions;
  maxLength?: number;
  inputRef?: RefObject<TextInput | null>;
}) {
  const C = useColors();
  const [focused, setFocused] = useState(false);

  return (
    <View>
      <Text style={[styles.fieldLabel, { color: C.ink3 }]}>{label}</Text>
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        placeholderTextColor={C.ink3}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        keyboardType={keyboardType}
        maxLength={maxLength}
        autoComplete={autoComplete as TextInputProps['autoComplete']}
        accessibilityLabel={label}
        selectionColor={C.live}
        style={[
          styles.input,
          {
            backgroundColor: C.surface,
            color: C.ink,
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

/* ------------------------------------------------------------------- utils */

function frameColor(C: Palette, status: UsernameStatus, focused: boolean): string {
  if (status === 'taken' || status === 'invalid') return C.dangerBorder;
  if (status === 'available') return C.live;
  if (focused) return C.ink;
  return C.rule2;
}

function avatarUrlProblem(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  // Only http(s) — a `file://` or `data:` URL would render locally and then be
  // a broken image for everyone else in the lounge.
  if (!/^https?:\/\/\S+$/i.test(trimmed)) return 'Enter a full http or https image URL.';
  return undefined;
}

/* ------------------------------------------------------------------ styles */

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
    paddingHorizontal: GUTTER,
    paddingTop: Space.lg,
    paddingBottom: Space.huge,
  },
  step: {
    ...Type.label(11),
    letterSpacing: tracking(11, 0.12),
    minHeight: Space.xxl,
  },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 7,
    minHeight: TOUCH_TARGET,
    paddingRight: 10,
  },
  backLabel: {
    ...Type.label(11),
    letterSpacing: tracking(11, 0.1),
  },
  title: {
    ...Type.display(40),
    lineHeight: 42,
    letterSpacing: tracking(40, -0.03),
    marginTop: 10,
  },
  lede: {
    ...Type.body(16),
    marginTop: Space.sm,
    marginBottom: Space.xxl,
  },
  /** One frame around `@`, the input and the verdict. */
  handle: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderWidth: Rule.hair,
  },
  at: {
    width: AT_BLOCK,
    alignItems: 'center',
    justifyContent: 'center',
  },
  atGlyph: {
    ...Type.display(20),
    letterSpacing: 0,
  },
  handleInput: {
    flex: 1,
    minWidth: 0,
    height: 56,
    paddingHorizontal: Space.md,
    paddingVertical: 0,
    fontFamily: Fonts.extrabold,
    fontSize: 22,
    letterSpacing: tracking(22, -0.01),
  },
  chip: {
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  chipLabel: {
    ...Type.heading(11),
    letterSpacing: tracking(11, 0.12),
  },
  hint: {
    ...Type.body(14),
    marginTop: Space.sm,
    // Reserved height so nothing below jumps as the verdict changes.
    minHeight: 42,
  },
  identity: {
    flexDirection: 'row',
    gap: 10,
    marginTop: Space.lg,
  },
  avatar: {
    width: AVATAR_BLOCK,
    height: AVATAR_BLOCK,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarInitial: {
    ...Type.display(38),
    letterSpacing: 0,
  },
  identityFields: {
    flex: 1,
    minWidth: 0,
  },
  avatarUrl: {
    marginTop: Space.md,
  },
  caption: {
    ...Type.body(14),
    marginTop: 6,
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
  gap: {
    flexGrow: 1,
    minHeight: Space.xl,
  },
  primary: {
    marginTop: Space.lg,
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
    height: BUTTON,
    justifyContent: 'center',
    alignItems: 'flex-start',
    paddingHorizontal: Space.lg,
    borderWidth: Rule.hair,
  },
  secondaryLabel: {
    ...Type.heading(11),
    letterSpacing: tracking(11, 0.1),
  },
});
