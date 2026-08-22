import { router } from 'expo-router';
import { ChevronRight, LogOut, Music, Pencil, Settings, Users } from 'lucide-react-native';
import { memo, useCallback } from 'react';
import { Alert, FlatList, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import {
  Avatar,
  AuxButton,
  EmptyState,
  GlassCard,
  Screen,
  Skeleton,
  useToast,
} from '@/components/ui';
import { useMyLounges, type MyLounge } from '@/features/profile/queries';
import { useAuth } from '@/lib/auth';
import type { ProfileRow } from '@/lib/database.types';
import { Bloom, Colors, PointerEvents, Radius, Space, TOUCH_TARGET, Type } from '@/lib/theme';

/**
 * `Colors.danger` washed back to a tinted outline, per the artboard: sign out is
 * destructive enough to stay rose, but it is not the loudest thing on a screen
 * that is mostly about who you are.
 */
const DANGER_WASH = 'rgba(242, 101, 126, 0.10)';
const DANGER_EDGE = 'rgba(242, 101, 126, 0.34)';

export default function ProfileScreen() {
  const toast = useToast();
  const { user, profile, loading, signOut, refreshProfile } = useAuth();
  const lounges = useMyLounges(user?.id);

  const confirmSignOut = useCallback(() => {
    confirmDestructive(
      'Sign out?',
      'You will need your email and password to get back in. Any Session you are hosting ends for everyone.',
      'Sign out',
      () => {
        void signOut().catch((caught: unknown) => {
          toast.show(caught instanceof Error ? caught.message : 'Could not sign out.', 'error');
        });
      }
    );
  }, [signOut, toast]);

  const renderLounge = useCallback(
    ({ item }: { item: MyLounge }) => <LoungeRow item={item} />,
    []
  );

  return (
    <Screen
      title="Profile"
      scroll={false}
      right={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Settings"
          onPress={() => router.push('/settings/connections')}
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
          <Settings size={22} color={Colors.text} strokeWidth={1.6} />
        </Pressable>
      }>
      {/* Signature 1. Fainter than a Session: there is no artwork here, only
          the people the artwork is for. */}
      <View style={[styles.bloom, PointerEvents.none]}>
        <Svg width="100%" height="100%">
          <Defs>
            <RadialGradient id="profileBloom" cx="50%" cy="8%" rx="62%" ry="88%">
              <Stop offset="0" stopColor={Bloom.a} stopOpacity={0.24} />
              <Stop offset="0.45" stopColor={Bloom.b} stopOpacity={0.13} />
              <Stop offset="0.76" stopColor={Colors.bg} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#profileBloom)" />
        </Svg>
      </View>

      {/*
        A FlatList rather than a ScrollView: a heavy lounge user has dozens of
        memberships, and the identity block rides along as the list header so
        there is no VirtualizedList-inside-ScrollView nesting.
      */}
      <FlatList
        data={lounges.data ?? []}
        keyExtractor={keyExtractor}
        renderItem={renderLounge}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <ProfileHeader
            profile={profile}
            loading={loading}
            count={lounges.data?.length ?? null}
            onEdit={() => router.push('/(auth)/claim-username')}
            onRetry={() => {
              void refreshProfile();
            }}
          />
        }
        ListEmptyComponent={lounges.isPending ? <LoungeSkeletons /> : <NoLounges />}
        ListFooterComponent={
          <View style={styles.footer}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Sign out"
              onPress={confirmSignOut}
              style={({ pressed }) => [styles.signOut, pressed && styles.pressed]}>
              <LogOut size={18} color={Colors.danger} strokeWidth={1.6} />
              <Text style={styles.signOutLabel}>Sign out</Text>
            </Pressable>
          </View>
        }
      />
    </Screen>
  );
}

const keyExtractor = (item: MyLounge) => item.lounge.id;

/* ------------------------------------------------------------------ header */

function ProfileHeader({
  profile,
  loading,
  count,
  onEdit,
  onRetry,
}: {
  profile: ProfileRow | null;
  loading: boolean;
  count: number | null;
  onEdit: () => void;
  onRetry: () => void;
}) {
  return (
    <View style={styles.header}>
      <GlassCard>
        {profile ? (
          <View style={styles.identity}>
            <Avatar
              uri={profile.avatar_url}
              name={profile.display_name || profile.username}
              size={68}
            />
            <View style={styles.identityText}>
              <Text numberOfLines={1} style={styles.name}>
                {profile.display_name || profile.username}
              </Text>
              <Text numberOfLines={1} style={styles.handle}>
                @{profile.username}
              </Text>
              {/* Signature 4: a join date is a measurement, so it is mono. */}
              <Text style={styles.since}>Member since {formatMonth(profile.created_at)}</Text>
            </View>
          </View>
        ) : loading ? (
          <View style={styles.identity}>
            <Skeleton width={68} height={68} radius={34} />
            <View style={styles.identityText}>
              <Skeleton width="70%" height={22} />
              <Skeleton width="45%" height={18} />
              <Skeleton width="60%" height={14} />
            </View>
          </View>
        ) : (
          /*
            Loading has settled and there is still no row — the fetch failed, or
            the signup trigger has not landed yet. A skeleton here would shimmer
            forever, so say what happened and offer the way out.
          */
          <View style={styles.identityText}>
            <Text style={styles.name}>Profile unavailable</Text>
            <Text style={styles.handle}>
              We could not load your profile. Check your connection and try again.
            </Text>
          </View>
        )}

        <View style={styles.editRow}>
          {profile ? (
            <AuxButton
              label="Edit profile"
              icon={Pencil}
              variant="ghost"
              size="sm"
              onPress={onEdit}
            />
          ) : loading ? null : (
            <AuxButton label="Try again" variant="ghost" size="sm" onPress={onRetry} />
          )}
        </View>
      </GlassCard>

      <SpotifyRow profile={profile} loading={loading} />

      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>Your lounges</Text>
        {count === null ? null : (
          <Text style={styles.sectionCount}>{String(count).padStart(2, '0')}</Text>
        )}
      </View>
    </View>
  );
}

function SpotifyRow({ profile, loading }: { profile: ProfileRow | null; loading: boolean }) {
  const status = !profile?.spotify_linked
    ? 'Not connected — Aux plays through YouTube'
    : profile.is_premium
      ? 'Connected — Premium, plays through Spotify'
      : 'Connected — Free, plays through YouTube';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        loading ? 'Spotify connection. Opens connection settings.' : `Spotify. ${status}.`
      }
      onPress={() => router.push('/settings/connections')}
      style={({ pressed }) => [styles.rowPressable, pressed && styles.pressed]}>
      <GlassCard>
        <View style={styles.row}>
          <View style={styles.rowIcon}>
            <Music size={20} color={Colors.muted} strokeWidth={1.6} />
          </View>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>Spotify</Text>
            {/* Never guess "Not connected" before the profile lands — that is a
                different claim from "still checking". */}
            {loading ? <Skeleton width="80%" height={14} /> : <Text style={styles.rowValue}>{status}</Text>}
          </View>
          <ChevronRight size={20} color={Colors.muted} strokeWidth={1.6} />
        </View>
      </GlassCard>
    </Pressable>
  );
}

/* ------------------------------------------------------------------- list */

const LoungeRow = memo(function LoungeRow({ item }: { item: MyLounge }) {
  const { lounge, role } = item;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${lounge.name}. You are ${role === 'owner' ? 'the owner' : `a ${role}`}.`}
      onPress={() => router.push({ pathname: '/lounge/[id]', params: { id: lounge.id } })}
      style={({ pressed }) => [styles.listRow, pressed && styles.pressed]}>
      <Avatar uri={lounge.icon_url} name={lounge.name} size={40} />
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={styles.rowTitle}>
          {lounge.name}
        </Text>
        <Text numberOfLines={1} style={styles.rowValue}>
          {role === 'member' ? 'Member' : role === 'mod' ? 'Moderator' : 'Owner'}
        </Text>
      </View>
      {/* An affordance glyph, not copy — `faint` is doing divider duty here. */}
      <ChevronRight size={20} color={Colors.faint} strokeWidth={1.6} />
    </Pressable>
  );
});

function LoungeSkeletons() {
  return (
    <View style={styles.skeletons}>
      {[0, 1, 2].map((key) => (
        <View key={key} style={styles.listRow}>
          <Skeleton width={40} height={40} radius={20} />
          <View style={styles.rowText}>
            <Skeleton width="60%" height={18} />
            <Skeleton width="30%" height={14} />
          </View>
        </View>
      ))}
    </View>
  );
}

function NoLounges() {
  return (
    <EmptyState
      icon={Users}
      title="No lounges yet"
      description="Lounges are where your people hang out between Sessions. Join one with an invite code, or start your own."
      action={<AuxButton label="Find a lounge" onPress={() => router.push('/(tabs)/explore')} />}
    />
  );
}

/* ------------------------------------------------------------------ utils */

function formatMonth(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'recently';
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
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
  onConfirm: () => void
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
  bloom: {
    position: 'absolute',
    // Out past the screen gutter so the glow reaches the edges rather than
    // stopping on the same line the content does.
    left: -Space.lg,
    right: -Space.lg,
    top: 0,
    height: 340,
  },
  content: {
    paddingTop: Space.md,
    paddingBottom: Space.xxl,
    // 8px between adjacent hit areas, per the touch-target spacing rule.
    gap: Space.sm,
  },
  header: {
    gap: Space.md,
  },
  iconButton: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    // Pulls the optical centre of the glyph onto the gutter line.
    marginRight: -Space.md,
  },
  pressed: {
    opacity: 0.7,
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.lg,
  },
  identityText: {
    flex: 1,
    gap: 3,
  },
  name: {
    ...Type.title,
    color: Colors.text,
  },
  handle: {
    ...Type.body,
    color: Colors.muted,
  },
  since: {
    ...Type.monoLabel,
    color: Colors.muted,
    marginTop: 3,
  },
  editRow: {
    marginTop: Space.lg,
    flexDirection: 'row',
  },
  rowPressable: {
    borderRadius: Radius.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    minHeight: TOUCH_TARGET,
  },
  rowIcon: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.glassStrong,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    ...Type.bodyStrong,
    color: Colors.text,
  },
  rowValue: {
    ...Type.label,
    color: Colors.muted,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.md,
    marginTop: Space.md,
  },
  sectionTitle: {
    ...Type.monoLabel,
    color: Colors.muted,
  },
  sectionCount: {
    ...Type.monoLabel,
    color: Colors.muted,
  },
  /**
   * Hairline-separated rows rather than a stack of cards: the lounges are a
   * list you scan, and cards would give every one of them the weight of the
   * identity block above.
   */
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    minHeight: 56,
    paddingBottom: Space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  skeletons: {
    gap: Space.sm,
  },
  footer: {
    marginTop: Space.xl,
  },
  signOut: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.sm,
    minHeight: 52,
    borderRadius: Radius.pill,
    backgroundColor: DANGER_WASH,
    borderWidth: 1,
    borderColor: DANGER_EDGE,
  },
  signOutLabel: {
    ...Type.bodyStrong,
    color: Colors.danger,
  },
});
