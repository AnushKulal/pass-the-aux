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
  View,
} from 'react-native';

import { AuxButton, Avatar, Screen, TextField, useToast } from '@/components/ui';
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
import { Colors, Space, Type } from '@/lib/theme';

export default function ClaimUsernameScreen() {
  const toast = useToast();
  const { user, profile, pendingUsernameClaim, finishUsernameClaim } = useAuth();
  const update = useUpdateProfile(user?.id);

  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [submitted, setSubmitted] = useState(false);

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

          <View style={styles.preview}>
            <Avatar uri={avatarProblem ? null : avatarUrl || null} name={displayName || normalized} size={72} />
            <View style={styles.previewText}>
              <Text numberOfLines={1} style={styles.previewName}>
                {displayName.trim() || normalized || 'Your name'}
              </Text>
              <Text numberOfLines={1} style={styles.previewHandle}>
                @{normalized || 'username'}
              </Text>
            </View>
          </View>

          <View style={styles.form}>
            <View>
              <TextField
                label="Username"
                value={username}
                // Canonicalised on the way in so the field, the preview and the
                // availability verdict can never disagree about what was typed.
                onChangeText={(next) => setUsername(normalizeUsername(next))}
                placeholder="lowercase_and_numbers"
                autoCapitalize="none"
                autoComplete="username"
                maxLength={USERNAME_MAX}
                error={usernameError}
              />
              <AvailabilityHint status={availability.status} username={normalized} />
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

          <View style={styles.actions}>
            <AuxButton
              label="Save"
              size="lg"
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

          <Text style={styles.rules}>
            {USERNAME_MIN} to {USERNAME_MAX} characters. Lowercase letters, numbers and underscores
            only.
          </Text>
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
      <View style={styles.hint} accessibilityLiveRegion="polite">
        <ActivityIndicator size="small" color={Colors.muted} />
        <Text style={styles.hintMuted}>Checking…</Text>
      </View>
    );
  }

  const taken = status === 'taken';

  return (
    <View style={styles.hint} accessibilityLiveRegion="polite">
      {taken ? (
        <X size={18} color={Colors.danger} />
      ) : (
        <Check size={18} color={Colors.accent} />
      )}
      <Text style={taken ? styles.hintTaken : styles.hintFree}>
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
  hint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    // Reserved height so the fields below do not jump as the verdict changes.
    minHeight: 24,
    marginTop: Space.xs,
  },
  hintMuted: {
    ...Type.label,
    color: Colors.muted,
  },
  hintFree: {
    ...Type.label,
    color: Colors.accent,
  },
  hintTaken: {
    ...Type.label,
    color: Colors.danger,
  },
  actions: {
    gap: Space.md,
  },
  rules: {
    ...Type.caption,
    // The format constraints are the copy that gets you past this screen —
    // `faint` fails AA on bg, so they have to be `muted`.
    color: Colors.muted,
  },
});
