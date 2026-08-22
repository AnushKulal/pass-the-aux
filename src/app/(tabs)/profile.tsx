import { router } from 'expo-router';
import { CalendarDays, ChevronRight, LogOut, Music, Pencil, Settings, Users } from 'lucide-react-native';
import { memo, useCallback } from 'react';
import { Alert, FlatList, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

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
import { Colors, Radius, Space, TOUCH_TARGET, Type } from '@/lib/theme';

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
    ({ item }: { item: MyLounge }) => <LoungeCard item={item} />,
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
          <Settings size={22} color={Colors.text} />
        </Pressable>
      }>
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
            onEdit={() => router.push('/(auth)/claim-username')}
            onRetry={() => {
              void refreshProfile();
            }}
          />
        }
        ListEmptyComponent={lounges.isPending ? <LoungeSkeletons /> : <NoLounges />}
        ListFooterComponent={
          <View style={styles.footer}>
            <AuxButton
              label="Sign out"
              icon={LogOut}
              variant="danger"
              fullWidth
              onPress={confirmSignOut}
            />
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
  onEdit,
  onRetry,
}: {
  profile: ProfileRow | null;
  loading: boolean;
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
              size={72}
            />
            <View style={styles.identityText}>
              <Text numberOfLines={1} style={styles.name}>
                {profile.display_name || profile.username}
              </Text>
              <Text numberOfLines={1} style={styles.handle}>
                @{profile.username}
              </Text>
              <View style={styles.since}>
                <CalendarDays size={14} color={Colors.muted} />
                <Text style={styles.sinceText}>Member since {formatMonth(profile.created_at)}</Text>
              </View>
            </View>
          </View>
        ) : loading ? (
          <View style={styles.identity}>
            <Skeleton width={72} height={72} radius={36} />
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

      <Text style={styles.sectionTitle}>Your lounges</Text>
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
            <Music size={20} color={Colors.muted} />
          </View>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>Spotify</Text>
            {/* Never guess "Not connected" before the profile lands — that is a
                different claim from "still checking". */}
            {loading ? <Skeleton width="80%" height={14} /> : <Text style={styles.rowValue}>{status}</Text>}
          </View>
          <ChevronRight size={20} color={Colors.muted} />
        </View>
      </GlassCard>
    </Pressable>
  );
}

/* ------------------------------------------------------------------- list */

const LoungeCard = memo(function LoungeCard({ item }: { item: MyLounge }) {
  const { lounge, role } = item;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${lounge.name}. You are ${role === 'owner' ? 'the owner' : `a ${role}`}.`}
      onPress={() => router.push({ pathname: '/lounge/[id]', params: { id: lounge.id } })}
      style={({ pressed }) => [styles.rowPressable, pressed && styles.pressed]}>
      <GlassCard>
        <View style={styles.row}>
          <Avatar uri={lounge.icon_url} name={lounge.name} size={44} />
          <View style={styles.rowText}>
            <Text numberOfLines={1} style={styles.rowTitle}>
              {lounge.name}
            </Text>
            <Text numberOfLines={1} style={styles.rowValue}>
              {role === 'member' ? 'Member' : role === 'mod' ? 'Moderator' : 'Owner'}
            </Text>
          </View>
          <ChevronRight size={20} color={Colors.muted} />
        </View>
      </GlassCard>
    </Pressable>
  );
});

function LoungeSkeletons() {
  return (
    <View style={styles.skeletons}>
      {[0, 1, 2].map((key) => (
        <GlassCard key={key}>
          <View style={styles.row}>
            <Skeleton width={44} height={44} radius={22} />
            <View style={styles.rowText}>
              <Skeleton width="60%" height={18} />
              <Skeleton width="30%" height={14} />
            </View>
          </View>
        </GlassCard>
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
  content: {
    paddingTop: Space.sm,
    paddingBottom: Space.xxl,
    gap: Space.md,
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
    gap: Space.xs,
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
  },
  sinceText: {
    ...Type.caption,
    color: Colors.muted,
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
    backgroundColor: Colors.surfaceRaised,
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
  sectionTitle: {
    ...Type.heading,
    color: Colors.text,
    marginTop: Space.sm,
  },
  skeletons: {
    gap: Space.md,
  },
  footer: {
    marginTop: Space.xl,
  },
});
