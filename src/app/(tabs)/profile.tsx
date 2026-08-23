/**
 * You — the profile tab. Design canvas: `data-screen-label="You"`.
 *
 * A centred identity block over a 132px photo tile, three stat cards, the
 * connection rows, and the sign-out outline. No lounge list: the artboard
 * spends that space on the LOUNGES stat and the Lounges tab owns the list.
 */

import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type TextStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useToast } from '@/components/ui';
import { useMyLounges } from '@/features/profile/queries';
import { useAuth } from '@/lib/auth';
import type { ProfileRow } from '@/lib/database.types';
import {
  Duration,
  Fonts,
  Radii,
  Rule,
  Space,
  TOUCH_TARGET,
  Type,
  dropped,
  glowShadow,
  pressedSoft,
  raised,
  tracking,
} from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

/** The artboard's gutters: 20 for cards, 24 for the kicker above them. */
const CARD_GUTTER = 20;
const TEXT_GUTTER = 24;

const PHOTO = 132;
const CONNECTION_TILE = 38;

/** `Type.readout()` hands back a readonly tuple; `TextStyle` wants a mutable one. */
const readout = (size: number): TextStyle => ({
  ...Type.readout(size),
  fontVariant: ['tabular-nums'],
});

export default function ProfileScreen() {
  const C = useColors();
  const reduced = useReducedMotion();
  const toast = useToast();
  const { user, profile, loading, signOut, refreshProfile } = useAuth();
  const lounges = useMyLounges(user?.id);

  /*
    Driven from a shared value in an effect, never `entering={FadeIn…}`: a
    Reanimated layout animation marks the view hidden until it runs, and on
    react-native-web it never runs.
  */
  const enter = useSharedValue(0);
  useEffect(() => {
    enter.value = reduced ? 1 : withTiming(1, { duration: Duration.enter });
  }, [reduced, enter]);
  const enterStyle = useAnimatedStyle(() => ({ opacity: enter.value }));

  const confirmSignOut = useCallback(() => {
    confirmDestructive('Sign out?', 'Any Session you are hosting ends.', 'Sign out', () => {
      void signOut().catch((caught: unknown) => {
        toast.show(caught instanceof Error ? caught.message : 'Could not sign out.', 'error');
      });
    });
  }, [signOut, toast]);

  const memberships = lounges.data;
  const stats = useMemo(() => {
    const rows = memberships ?? [];
    return {
      lounges: rows.length,
      hosting: rows.filter((row) => row.role === 'owner').length,
    };
  }, [memberships]);

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.root, { backgroundColor: C.bg }]}>
      <Animated.View style={[styles.flex, enterStyle]}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {profile ? (
            <>
              <Identity profile={profile} />

              <View style={styles.stats}>
                <Stat value={String(stats.lounges)} label="Lounges" />
                <Stat value={String(stats.hosting)} label="Hosting" />
                <Stat value={monthOf(profile.created_at)} label={sinceOf(profile.created_at)} />
              </View>

              <Kicker>Connections</Kicker>
              <View style={styles.group}>
                <ConnectionRow
                  name="Spotify"
                  value={spotifyValue(profile)}
                  linked={profile.spotify_linked}
                  onPress={() => router.push('/settings/connections')}
                />
                <ConnectionRow name="YouTube" value="Not linked" linked={false} />
              </View>
            </>
          ) : (
            <Unavailable
              loading={loading}
              onRetry={() => {
                void refreshProfile();
              }}
            />
          )}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sign out"
            onPress={confirmSignOut}
            style={({ pressed }) => [
              styles.signOut,
              { borderColor: C.live, backgroundColor: pressed ? C.liveWash : 'transparent' },
            ]}>
            <Text style={[styles.signOutLabel, { color: C.liveText }]}>Sign out</Text>
          </Pressable>
        </ScrollView>
      </Animated.View>
    </SafeAreaView>
  );
}

/* --------------------------------------------------------------- identity */

function Identity({ profile }: { profile: ProfileRow }) {
  const C = useColors();
  const name = profile.display_name || profile.username;
  const photo = profile.photo_url ?? profile.avatar_url;

  return (
    <View style={styles.hero}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Edit your photo"
        onPress={() => router.push('/(auth)/claim-username')}
        style={[styles.photo, { backgroundColor: C.artwork }, glowShadow(C.glow, 44)]}>
        {photo ? (
          <Image
            source={{ uri: photo }}
            style={styles.photoImage}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={Duration.press}
            accessibilityIgnoresInvertColors
          />
        ) : (
          <Text style={[styles.photoInitial, { color: C.artInk }]}>
            {name.charAt(0).toUpperCase()}
          </Text>
        )}
      </Pressable>

      <Text numberOfLines={1} style={[styles.name, { color: C.ink }]}>
        {name}
      </Text>
      <Text numberOfLines={1} style={[styles.handle, { color: C.ink2 }]}>
        @{profile.username}
      </Text>
      {profile.bio ? (
        <Text style={[styles.bio, { color: C.ink2 }]} numberOfLines={3}>
          {profile.bio}
        </Text>
      ) : null}

      <View style={styles.heroActions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Edit profile"
          onPress={() => router.push('/(auth)/claim-username')}
          style={({ pressed }) => [
            styles.action,
            { backgroundColor: pressed ? C.cream : C.pill },
            dropped(C, 'md'),
          ]}>
          <Text style={[styles.actionLabel, { color: C.pillInk }]}>Edit profile</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Settings"
          onPress={() => router.push('/settings')}
          style={({ pressed }) => [
            styles.action,
            { backgroundColor: pressed ? C.surface2 : C.surface },
            raised(C),
          ]}>
          <Text style={[styles.actionLabel, { color: C.ink2 }]}>Settings</Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * The signed-in-but-profileless case. The artboard has no state for it, so it
 * borrows the hero's centre line and says the one thing worth saying.
 */
function Unavailable({ loading, onRetry }: { loading: boolean; onRetry: () => void }) {
  const C = useColors();

  return (
    <View style={styles.hero}>
      <View style={[styles.photo, { backgroundColor: C.surface }, raised(C)]} />
      <Text style={[styles.name, { color: C.ink }]}>{loading ? 'Loading…' : 'No profile'}</Text>
      {loading ? null : (
        <View style={styles.heroActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Try again"
            onPress={onRetry}
            style={({ pressed }) => [
              styles.action,
              { backgroundColor: pressed ? C.surface2 : C.surface },
              raised(C),
            ]}>
            <Text style={[styles.actionLabel, { color: C.ink2 }]}>Try again</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

/* ------------------------------------------------------------------ parts */

function Kicker({ children }: { children: ReactNode }) {
  const C = useColors();
  return <Text style={[styles.kicker, { color: C.ink3 }]}>{children}</Text>;
}

function Stat({ value, label }: { value: string; label: string }) {
  const C = useColors();
  return (
    <View style={[styles.stat, { backgroundColor: C.surface }, raised(C)]}>
      <Text numberOfLines={1} style={[styles.statValue, { color: C.ink }]}>
        {value}
      </Text>
      <Text numberOfLines={1} style={[styles.statLabel, { color: C.ink3 }]}>
        {label}
      </Text>
    </View>
  );
}

function ConnectionRow({
  name,
  value,
  linked,
  onPress,
}: {
  name: string;
  value: string;
  linked: boolean;
  onPress?: () => void;
}) {
  const C = useColors();

  const body = (
    <>
      <View style={[styles.connectionTile, { backgroundColor: C.bgRecessed }, pressedSoft(C)]} />
      <Text style={[styles.connectionName, { color: C.ink }]}>{name}</Text>
      <Text style={[styles.connectionValue, { color: linked ? C.ink2 : C.ink3 }]}>{value}</Text>
    </>
  );

  if (!onPress) {
    return (
      <View style={[styles.connection, { backgroundColor: C.surface }, raised(C)]}>{body}</View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}. ${value}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.connection,
        { backgroundColor: pressed ? C.surface2 : C.surface },
        raised(C),
      ]}>
      {body}
    </Pressable>
  );
}

/* ------------------------------------------------------------------ utils */

function spotifyValue(profile: ProfileRow): string {
  if (!profile.spotify_linked) return 'Not linked';
  return profile.is_premium ? 'Premium · linked' : 'Free · linked';
}

function monthOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { month: 'short' });
}

function sinceOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Member';
  return `Since '${String(date.getFullYear()).slice(-2)}`;
}

/**
 * `Alert` on react-native-web renders without its buttons, so a destructive
 * confirmation there would be a dialog you cannot say no to. Fall back to the
 * browser's own confirm, which is the honest equivalent.
 */
function confirmDestructive(
  title: string,
  message: string,
  confirmLabel: string,
  onConfirm: () => void,
) {
  if (Platform.OS === 'web') {
    if (globalThis.confirm?.(`${title}\n\n${message}`)) onConfirm();
    return;
  }

  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: confirmLabel, style: 'destructive', onPress: onConfirm },
  ]);
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
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    paddingTop: Space.md,
    paddingBottom: Space.huge,
  },

  hero: {
    alignItems: 'center',
    paddingHorizontal: TEXT_GUTTER,
  },
  photo: {
    width: PHOTO,
    height: PHOTO,
    borderRadius: Radii.xxl,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  photoImage: {
    width: '100%',
    height: '100%',
  },
  photoInitial: {
    ...Type.display(48),
  },
  name: {
    ...Type.display(27),
    letterSpacing: tracking(27, -0.03),
    marginTop: Space.xl,
  },
  handle: {
    ...Type.body(14),
    marginTop: Space.xs,
  },
  bio: {
    ...Type.body(13),
    textAlign: 'center',
    marginTop: Space.md,
  },
  heroActions: {
    flexDirection: 'row',
    gap: 11,
    marginTop: Space.xl,
  },
  action: {
    minHeight: TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: 22,
    borderRadius: Radii.md - 1,
  },
  actionLabel: {
    fontFamily: Fonts.semibold,
    fontSize: 13.5,
    lineHeight: 18,
  },

  stats: {
    flexDirection: 'row',
    gap: 11,
    paddingHorizontal: CARD_GUTTER,
    paddingTop: Space.xxxl,
  },
  stat: {
    flex: 1,
    padding: Space.lg,
    borderRadius: Radii.lg,
  },
  statValue: {
    ...readout(24),
    letterSpacing: tracking(24, -0.02),
  },
  statLabel: {
    ...Type.label(10.5),
    letterSpacing: tracking(10.5, 0.13),
    marginTop: 5,
  },

  kicker: {
    ...Type.label(10.5),
    letterSpacing: tracking(10.5, 0.15),
    paddingHorizontal: TEXT_GUTTER,
    paddingTop: Space.xxxl,
    paddingBottom: Space.md,
  },
  group: {
    paddingHorizontal: CARD_GUTTER,
    gap: 10,
  },
  connection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: TOUCH_TARGET + Space.xs,
    padding: 15,
    borderRadius: Radii.lg,
  },
  connectionTile: {
    width: CONNECTION_TILE,
    height: CONNECTION_TILE,
    borderRadius: Radii.sm,
  },
  connectionName: {
    flex: 1,
    minWidth: 0,
    fontFamily: Fonts.semibold,
    fontSize: 14.5,
    lineHeight: 19,
  },
  connectionValue: {
    fontFamily: Fonts.semibold,
    fontSize: 12,
    lineHeight: 16,
  },

  signOut: {
    marginHorizontal: CARD_GUTTER,
    marginTop: Space.xxxl,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.button,
    borderWidth: Rule.thick,
  },
  signOutLabel: {
    fontFamily: Fonts.semibold,
    fontSize: 13.5,
    lineHeight: 18,
    letterSpacing: tracking(13.5, 0.04),
  },
});
