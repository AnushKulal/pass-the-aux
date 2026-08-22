import { router } from 'expo-router';
import { Check, X } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { AuxButton, Avatar, GlassCard, Screen, TextField, useToast } from '@/components/ui';
import {
  USERNAME_MAX,
  USERNAME_MIN,
  normalizeUsername,
  useUpdateProfile,
  useUsernameAvailability,
  type ProfilePatch,
  type UsernameStatus,
} from '@/features/profile/queries';
import { useAuth } from '@/lib/auth';
import { Bloom, Colors, PointerEvents, Radius, Space, Type } from '@/lib/theme';

export default function ClaimUsernameScreen() {
  const toast = useToast();
  const { user, profile, pendingUsernameClaim, finishUsernameClaim } = useAuth();
  const update = useUpdateProfile(user?.id);

  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [handleFocused, setHandleFocused] = useState(false);

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

  // "Taken" is reported by the hint row below the field, with its own icon —
  // saying it twice reads as two separate problems. The field's error slot is
  // reserved for the format rules, which only matter once they try to save.
  const usernameError =
    submitted && (availability.status === 'invalid' || availability.status === 'idle')
      ? (availability.message ?? 'Pick a username.')
      : undefined;

  return (
    <Screen
      title="Your handle"
      scroll={false}
      onBack={pendingUsernameClaim ? undefined : leave}>
      {/* Signature 1: low and to the left, so the preview glass above it picks
          up colour instead of sitting on flat ground. */}
      <View style={[styles.bloom, PointerEvents.none]}>
        <Svg width="100%" height="100%">
          <Defs>
            <RadialGradient id="claimBloom" cx="16%" cy="34%" rx="70%" ry="52%">
              <Stop offset="0" stopColor={Bloom.a} stopOpacity={0.2} />
              <Stop offset="0.45" stopColor={Bloom.b} stopOpacity={0.12} />
              <Stop offset="0.78" stopColor={Colors.bg} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#claimBloom)" />
        </Svg>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <Text style={styles.lede}>
            {pendingUsernameClaim
              ? 'You are in. Pick the name people will see when you take the aux.'
              : 'Change how you show up in lounges and Sessions.'}
          </Text>

          {/* Live preview of the row everyone else will see you as. */}
          <GlassCard>
            <View style={styles.preview}>
              <Avatar
                uri={avatarProblem ? null : avatarUrl || null}
                name={displayName || normalized}
                size={72}
              />
              <View style={styles.previewText}>
                <Text numberOfLines={1} style={styles.previewName}>
                  {displayName.trim() || normalized || 'Your name'}
                </Text>
                <Text numberOfLines={1} style={styles.previewHandle}>
                  @{normalized || 'username'}
                </Text>
              </View>
            </View>
          </GlassCard>

          <View style={styles.form}>
            <View style={styles.field}>
              <View style={styles.fieldHead}>
                <Text style={styles.fieldLabel}>Username</Text>
                {/* Signature 4: a length is a measurement, so it is mono. */}
                <Text style={styles.count}>
                  {String(normalized.length).padStart(2, '0')}/{USERNAME_MAX}
                </Text>
              </View>

              {/*
                Composed here rather than with TextField because the artboard
                puts the `@` inside the control as field furniture, and the kit's
                input has no prefix slot.
              */}
              <View
                style={[
                  styles.control,
                  handleFocused && styles.controlFocused,
                  usernameError ? styles.controlError : null,
                ]}>
                <Text style={styles.at}>@</Text>
                <TextInput
                  value={username}
                  // Canonicalised on the way in so the field, the preview and the
                  // availability verdict can never disagree about what was typed.
                  onChangeText={(next) => setUsername(normalizeUsername(next))}
                  onFocus={() => setHandleFocused(true)}
                  onBlur={() => setHandleFocused(false)}
                  accessibilityLabel="Username"
                  placeholder="lowercase_and_numbers"
                  placeholderTextColor={Colors.faint}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="username"
                  maxLength={USERNAME_MAX}
                  selectionColor={Colors.text}
                  style={styles.input}
                />
              </View>

              {/* Worded and weighted exactly like the kit's own field error, so
                  a format problem here does not look like a different species of
                  problem from one on the fields below. */}
              {usernameError ? (
                <Text accessibilityLiveRegion="polite" style={styles.messageError}>
                  {usernameError}
                </Text>
              ) : null}

              <AvailabilityHint status={availability.status} username={normalized} />

              <Text style={styles.rules}>
                {USERNAME_MIN} to {USERNAME_MAX} characters. Lowercase letters, numbers and
                underscores only.
              </Text>
            </View>

            <TextField
              label="Display name"
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="What friends call you"
              maxLength={40}
              autoComplete="name"
            />

            <TextField
              label="Avatar URL"
              value={avatarUrl}
              onChangeText={setAvatarUrl}
              placeholder="https://..."
              autoCapitalize="none"
              keyboardType="url"
              error={submitted ? avatarProblem : undefined}
            />
          </View>

          <View style={styles.gap} />

          <View style={styles.actions}>
            <AuxButton
              label="Save"
              fullWidth
              onPress={() => {
                void save();
              }}
              loading={update.isPending}
            />

            {pendingUsernameClaim ? (
              <AuxButton
                label="Skip for now"
                variant="ghost"
                fullWidth
                onPress={leave}
                disabled={update.isPending}
              />
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

/* ------------------------------------------------------------------- parts */

function AvailabilityHint({ status, username }: { status: UsernameStatus; username: string }) {
  if (status === 'idle' || status === 'invalid') return null;

  if (status === 'checking') {
    return (
      <View style={styles.messageRow} accessibilityLiveRegion="polite">
        <ActivityIndicator size="small" color={Colors.muted} />
        <Text style={styles.messageMuted}>Checking…</Text>
      </View>
    );
  }

  const taken = status === 'taken';

  return (
    <View style={styles.messageRow} accessibilityLiveRegion="polite">
      {taken ? (
        <X size={18} color={Colors.danger} strokeWidth={1.6} />
      ) : (
        /*
          Warm white, NOT Colors.accent. A free handle is a success, but the
          accent is reserved for live/playing/joinable — spending it on a form
          verdict is exactly what would stop the Feed being scannable.
        */
        <Check size={18} color={Colors.text} strokeWidth={1.6} />
      )}
      <Text style={taken ? styles.messageError : styles.messageOk}>
        {taken ? `@${username} is taken` : `@${username} is yours`}
      </Text>
    </View>
  );
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
  flex: {
    flex: 1,
  },
  bloom: {
    position: 'absolute',
    // Out past the screen gutter so the glow reaches the edges rather than
    // stopping on the same line the content does.
    left: -Space.lg,
    right: -Space.lg,
    top: 0,
    height: 430,
  },
  content: {
    flexGrow: 1,
    paddingTop: Space.sm,
    paddingBottom: Space.xxl,
    gap: Space.xl,
  },
  lede: {
    ...Type.body,
    color: Colors.muted,
  },
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.lg,
  },
  previewText: {
    flex: 1,
    gap: Space.xs,
  },
  previewName: {
    ...Type.heading,
    color: Colors.text,
  },
  previewHandle: {
    ...Type.body,
    color: Colors.muted,
  },
  form: {
    gap: Space.lg,
  },
  field: {
    gap: Space.xs,
  },
  fieldHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: Space.md,
  },
  fieldLabel: {
    ...Type.label,
    color: Colors.muted,
  },
  count: {
    ...Type.mono,
    color: Colors.muted,
  },
  /*
    Deliberately identical to the kit's TextField shell — same 48px floor, same
    1.5px border held across every state — so the three fields on this screen
    read as one set even though this one is composed locally.
  */
  control: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    minHeight: 48,
    paddingHorizontal: Space.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  controlFocused: {
    backgroundColor: Colors.surfaceRaised,
    borderColor: Colors.text,
  },
  /** Error outranks focus on the border, so the reason is never hidden. */
  controlError: {
    borderColor: Colors.danger,
  },
  /** Furniture, not content — the mono face marks it as part of the control. */
  at: {
    ...Type.mono,
    fontSize: 16,
    lineHeight: 22,
    color: Colors.muted,
  },
  input: {
    ...Type.body,
    flex: 1,
    color: Colors.text,
    paddingVertical: Space.sm,
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    // Reserved height so the fields below do not jump as the verdict changes.
    minHeight: 24,
  },
  messageMuted: {
    ...Type.label,
    color: Colors.muted,
  },
  messageOk: {
    ...Type.label,
    color: Colors.text,
  },
  messageError: {
    ...Type.label,
    color: Colors.danger,
  },
  rules: {
    ...Type.label,
    // The format constraints are the copy that gets you past this screen —
    // `faint` fails AA on bg, so they have to be `muted`.
    color: Colors.muted,
  },
  gap: {
    flexGrow: 1,
    minHeight: Space.xs,
  },
  actions: {
    gap: Space.md,
  },
});
