/**
 * You — the profile tab. Design canvas: `data-screen-label="You"`.
 *
 * A centred identity block over a 132px photo tile, three stat cards, the
 * connection rows, and the sign-out outline. No lounge list: the artboard
 * spends that space on the LOUNGES stat and the Lounges tab owns the list.
 *
 * FOUR STATES, all on the hero's centre line so the layout never jumps:
 *   loading   a skeleton of the real thing — tile, name, actions, stats, rows
 *   error     the profile read failed; says why and offers one retry
 *   empty     signed in but no profile row is readable yet; offers the single
 *             action that creates one
 *   ready     the artboard
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

import { Skeleton, useToast } from '@/components/ui';
import { useMyLounges, useProfile } from '@/features/profile/queries';
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
  raised,
  tracking,
} from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

/** The artboard's gutters: 20 for cards, 24 for the kicker above them. */
const CARD_GUTTER = 20;
const TEXT_GUTTER = 24;

const PHOTO = 132;
const CONNECTION_TILE = 38;
/** What the skeleton has to match: 15 padding + 38 tile + 15 padding. */
const CONNECTION_ROW = 68;
const STAT_CARD = 79;

/** What the screen is showing. Derived once, read everywhere. */
type Status = 'loading' | 'error' | 'empty' | 'ready';

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
  /*
    Same query key and options as the one AuthProvider runs, so React Query
    hands back the SAME cache entry rather than firing a second request. The
    context exposes only the row and a coarse `loading`; the failure lives
    here, and a screen that cannot tell "still fetching" from "the fetch threw"
    has no error state to draw.
  */
  const profileQuery = useProfile(user?.id);
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

  const retry = useCallback(() => {
    void refreshProfile();
  }, [refreshProfile]);

  const editProfile = useCallback(() => router.push('/(auth)/claim-username'), []);

  const memberships = lounges.data;
  const stats = useMemo(() => {
    const rows = memberships ?? [];
    return {
      lounges: rows.length,
      hosting: rows.filter((row) => row.role === 'owner').length,
    };
  }, [memberships]);

  /*
    A row already in hand beats every other signal: a background refetch
    failing is no reason to replace a profile the user can see.
  */
  const status: Status = profile
    ? 'ready'
    : loading || !user
      ? 'loading'
      : profileQuery.isError
        ? 'error'
        : 'empty';

  /** Counts are unknown until the memberships land — a 0 there would be a lie. */
  const countsPending = lounges.isPending || lounges.isError;
  const count = (n: number) => (countsPending ? '—' : String(n));

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.root, { backgroundColor: C.bg }]}>
      <Animated.View style={[styles.flex, enterStyle]}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {status === 'ready' && profile ? (
            <>
              <Identity profile={profile} onEdit={editProfile} />

              <View style={styles.stats}>
                <Stat value={count(stats.lounges)} label="Lounges" />
                <Stat value={count(stats.hosting)} label="Hosting" />
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
          ) : status === 'loading' ? (
            <ProfileSkeleton />
          ) : status === 'error' ? (
            <Notice
              title="Profile did not load"
              line={messageOf(profileQuery.error)}
              action="Try again"
              onAction={retry}
            />
          ) : (
            <Notice title="No profile yet" action="Choose a handle" onAction={editProfile} />
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

function Identity({ profile, onEdit }: { profile: ProfileRow; onEdit: () => void }) {
  const C = useColors();
  const name = profile.display_name || profile.username;
  const photo = profile.photo_url ?? profile.avatar_url;

  return (
    <View style={styles.hero}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Edit your photo"
        onPress={onEdit}
        style={[styles.photo, { backgroundColor: C.artwork }, dropped(C, 'lg')]}>
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
          onPress={onEdit}
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

/* ----------------------------------------------------------- other states */

/**
 * The loading state: the artboard with its content removed, not a spinner.
 *
 * Every block is the size of the thing it stands in for, so nothing moves when
 * the data lands — which is the only reason to prefer a skeleton at all.
 */
function ProfileSkeleton() {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Loading your profile">
      <View style={styles.hero}>
        <Skeleton width={PHOTO} height={PHOTO} style={styles.skeletonPhoto} />
        <Skeleton width={168} height={26} style={styles.skeletonName} />
        <Skeleton width={104} height={14} style={styles.skeletonHandle} />
        <View style={styles.heroActions}>
          <Skeleton width={136} height={TOUCH_TARGET} style={styles.skeletonAction} />
          <Skeleton width={108} height={TOUCH_TARGET} style={styles.skeletonAction} />
        </View>
      </View>

      <View style={styles.stats}>
        <View style={styles.statSlot}>
          <Skeleton width="100%" height={STAT_CARD} style={styles.skeletonCard} />
        </View>
        <View style={styles.statSlot}>
          <Skeleton width="100%" height={STAT_CARD} style={styles.skeletonCard} />
        </View>
        <View style={styles.statSlot}>
          <Skeleton width="100%" height={STAT_CARD} style={styles.skeletonCard} />
        </View>
      </View>

      <Kicker>Connections</Kicker>
      <View style={styles.group}>
        <Skeleton width="100%" height={CONNECTION_ROW} style={styles.skeletonCard} />
        <Skeleton width="100%" height={CONNECTION_ROW} style={styles.skeletonCard} />
      </View>
    </View>
  );
}

/**
 * The error and empty states.
 *
 * Both borrow the hero's centre line and its 132px tile, so moving between
 * them and the loaded screen shifts nothing. One line at most, then the single
 * action that resolves the state.
 */
/**
 * Deliberately NOT `@/components/ui/empty-state`.
 *
 * That card stands where a list or a hero card would; this one stands where the
 * PROFILE HERO is — same 132px tile, same centre line, same action pill — so
 * the four states of this screen occupy identical geometry and nothing moves
 * when the row lands. Swapping it for the shared card would make the loading,
 * error and empty states a different shape from the populated one, which is the
 * exact jump the skeleton exists to prevent.
 *
 * If you are here to unify it: unify the hero instead, not this.
 */
function Notice({
  title,
  line,
  action,
  onAction,
}: {
  title: string;
  line?: string;
  action: string;
  onAction: () => void;
}) {
  const C = useColors();

  return (
    <View style={styles.hero}>
      <View style={[styles.photo, { backgroundColor: C.surface }, raised(C)]} />

      <Text style={[styles.name, { color: C.ink }]}>{title}</Text>
      {line ? (
        <Text numberOfLines={3} style={[styles.bio, { color: C.ink2 }]}>
          {line}
        </Text>
      ) : null}

      <View style={styles.heroActions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action}
          onPress={onAction}
          style={({ pressed }) => [
            styles.action,
            { backgroundColor: pressed ? C.cream : C.pill },
            dropped(C, 'md'),
          ]}>
          <Text style={[styles.actionLabel, { color: C.pillInk }]}>{action}</Text>
        </Pressable>
      </View>
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

  /*
    A 38px well, so backgroundColor plus a hairline — NOT `pressedSoft`. On a
    dark ground the light half of the inset pair sits at 3.2% alpha, and at
    this size only the dark half lands: it reads as a smudge, not a recess.
  */
  const body = (
    <>
      <View
        style={[styles.connectionTile, { backgroundColor: C.bgRecessed, borderColor: C.rule }]}
      />
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

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Check your connection.';
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
    textAlign: 'center',
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
  statSlot: {
    flex: 1,
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
    borderWidth: Rule.hair,
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

  skeletonPhoto: {
    borderRadius: Radii.xxl,
  },
  skeletonName: {
    borderRadius: Radii.sm,
    marginTop: Space.xl,
  },
  skeletonHandle: {
    borderRadius: Radii.sm,
    marginTop: Space.sm,
  },
  skeletonAction: {
    borderRadius: Radii.md - 1,
  },
  skeletonCard: {
    borderRadius: Radii.lg,
  },

  signOut: {
    marginHorizontal: CARD_GUTTER,
    marginTop: 26,
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
