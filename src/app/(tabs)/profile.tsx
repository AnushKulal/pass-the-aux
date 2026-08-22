import { Image } from 'expo-image';
import { router } from 'expo-router';
import { ChevronRight, Pencil, SlidersHorizontal } from 'lucide-react-native';
import { memo, useCallback } from 'react';
import type { ReactNode } from 'react';
import { Alert, FlatList, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useToast } from '@/components/ui';
import { useMyLounges, type MyLounge } from '@/features/profile/queries';
import { useAuth } from '@/lib/auth';
import type { ProfileRow } from '@/lib/database.types';
import { Duration, Rule, Space, TOUCH_TARGET, Type, tracking } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

const GUTTER = 12;
const AVATAR = 72;

export default function ProfileScreen() {
  const C = useColors();
  const reduced = useReducedMotion();
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

  const renderLounge = useCallback(({ item }: { item: MyLounge }) => <LoungeRow item={item} />, []);

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.root, { backgroundColor: C.bg }]}>
      <Animated.View
        style={styles.flex}
        entering={
          reduced
            ? undefined
            : FadeInDown.duration(Duration.enter).withInitialValues({
                opacity: 0,
                transform: [{ translateY: 8 }],
              })
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
          ListEmptyComponent={lounges.isPending ? <LoungePlaceholders /> : <NoLounges />}
          ListFooterComponent={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Sign out"
              onPress={confirmSignOut}
              style={({ pressed }) => [
                styles.signOut,
                {
                  borderColor: C.dangerBorder,
                  backgroundColor: pressed ? C.dangerWash : 'transparent',
                },
              ]}>
              <Text style={[styles.signOutLabel, { color: C.danger }]}>SIGN OUT</Text>
            </Pressable>
          }
        />
      </Animated.View>
    </SafeAreaView>
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
  const C = useColors();

  if (!profile) {
    return (
      <View style={[styles.identity, { borderBottomColor: C.rule }]}>
        <Text style={[styles.name, { color: C.ink }]}>
          {loading ? 'Loading your profile…' : 'Profile unavailable'}
        </Text>
        <Text style={[styles.bio, { color: C.ink2 }]}>
          {loading
            ? 'One second.'
            : 'We could not load your profile. Check your connection and try again.'}
        </Text>
        {loading ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Try again"
            onPress={onRetry}
            style={({ pressed: isPressed }) => [
              styles.edit,
              styles.retry,
              { borderColor: C.rule2, backgroundColor: isPressed ? C.surface : 'transparent' },
            ]}>
            <Text style={[styles.editLabel, { color: C.ink }]}>TRY AGAIN</Text>
          </Pressable>
        )}
      </View>
    );
  }

  const name = profile.display_name || profile.username;
  const connection = !profile.spotify_linked
    ? 'SPOTIFY NOT LINKED'
    : profile.is_premium
      ? 'SPOTIFY LINKED (PREMIUM)'
      : 'SPOTIFY LINKED (FREE)';

  return (
    <View>
      <View style={[styles.identity, { borderBottomColor: C.rule }]}>
        <View style={styles.identityRow}>
          <View style={styles.avatarWell}>
            <View style={[styles.avatar, { backgroundColor: C.live }]}>
              {profile.avatar_url ? (
                <Image
                  source={{ uri: profile.avatar_url }}
                  style={styles.avatarImage}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  transition={Duration.press}
                  accessibilityIgnoresInvertColors
                />
              ) : (
                <Text style={[styles.avatarInitial, { color: C.onLive }]}>
                  {name.charAt(0).toUpperCase()}
                </Text>
              )}
            </View>
            {/* On aux, on the app: the presence mark is the one accent the
                identity block is allowed. */}
            <View style={[styles.presence, { backgroundColor: C.live, borderColor: C.bg }]} />
          </View>

          <View style={styles.identityText}>
            <View style={styles.nameRow}>
              <View style={styles.nameColumn}>
                <Text numberOfLines={1} style={[styles.name, { color: C.ink }]}>
                  {name}
                </Text>
                <Text numberOfLines={1} style={[styles.handle, { color: C.ink2 }]}>
                  @{profile.username}
                </Text>
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Edit profile"
                onPress={onEdit}
                style={({ pressed: isPressed }) => [
                  styles.edit,
                  { borderColor: isPressed ? C.live : C.rule2 },
                ]}>
                <Pencil size={14} strokeWidth={2} color={C.ink} />
                <Text style={[styles.editLabel, { color: C.ink }]}>EDIT</Text>
              </Pressable>
            </View>

            <View style={styles.chips}>
              {profile.spotify_linked ? <Chip>SPOTIFY</Chip> : <Chip>YOUTUBE</Chip>}
              {profile.is_premium ? <Chip accent>PREMIUM</Chip> : null}
            </View>
          </View>
        </View>

        <Text style={[styles.since, { color: C.ink3 }]}>
          MEMBER SINCE {formatMonth(profile.created_at)} · {connection}
        </Text>
      </View>

      <NavRow
        leading={<SlidersHorizontal size={19} strokeWidth={2} color={C.ink2} />}
        title="Settings"
        detail="Appearance, accounts, about the developer"
        onPress={() => router.push('/settings')}
      />
      <NavRow
        title="Connections"
        detail={
          !profile.spotify_linked
            ? 'NOT LINKED — PLAYING VIA YOUTUBE'
            : profile.is_premium
              ? 'SPOTIFY LINKED · PREMIUM'
              : 'SPOTIFY LINKED · FREE — PLAYING VIA YOUTUBE'
        }
        onPress={() => router.push('/settings/connections')}
      />

      <Text style={[styles.kicker, { color: C.ink3 }]}>YOUR LOUNGES</Text>
    </View>
  );
}

/* ------------------------------------------------------------------- parts */

function Chip({ children, accent = false }: { children: ReactNode; accent?: boolean }) {
  const C = useColors();
  return (
    <View
      style={[
        styles.chip,
        accent ? { backgroundColor: C.live } : { borderWidth: Rule.hair, borderColor: C.rule2 },
      ]}>
      <Text style={[styles.chipLabel, { color: accent ? C.onLive : C.ink2 }]}>{children}</Text>
    </View>
  );
}

function NavRow({
  leading,
  title,
  detail,
  onPress,
}: {
  leading?: ReactNode;
  title: string;
  detail: string;
  onPress: () => void;
}) {
  const C = useColors();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${detail}`}
      onPress={onPress}
      style={({ pressed: isPressed }) => [
        styles.navRow,
        {
          borderBottomColor: C.rule,
          backgroundColor: isPressed ? C.surface : 'transparent',
        },
      ]}>
      {leading}
      <View style={styles.navText}>
        <Text style={[styles.navTitle, { color: C.ink }]}>{title}</Text>
        <Text numberOfLines={1} style={[styles.navDetail, { color: C.ink2 }]}>
          {detail}
        </Text>
      </View>
      <ChevronRight size={20} strokeWidth={2} color={C.ink3} />
    </Pressable>
  );
}

/* -------------------------------------------------------------------- list */

const LoungeRow = memo(function LoungeRow({ item }: { item: MyLounge }) {
  const C = useColors();
  const { lounge, role } = item;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${lounge.name}. You are ${role === 'owner' ? 'the owner' : `a ${role}`}.`}
      onPress={() => router.push({ pathname: '/lounge/[id]', params: { id: lounge.id } })}
      style={({ pressed: isPressed }) => [
        styles.loungeRow,
        {
          borderBottomColor: C.rule,
          backgroundColor: isPressed ? C.surface : 'transparent',
        },
      ]}>
      <View style={[styles.loungeTag, { borderColor: C.rule2 }]}>
        <Text style={[styles.loungeTagLabel, { color: C.ink2 }]}>{tagFor(lounge.name)}</Text>
      </View>
      <View style={styles.navText}>
        <Text numberOfLines={1} style={[styles.navTitle, { color: C.ink }]}>
          {lounge.name}
        </Text>
        <Text numberOfLines={1} style={[styles.loungeMeta, { color: C.ink3 }]}>
          {role === 'member' ? 'MEMBER' : role === 'mod' ? 'MODERATOR' : 'OWNER'} ·{' '}
          {lounge.is_public ? 'PUBLIC' : 'PRIVATE'}
        </Text>
      </View>
      <ChevronRight size={20} strokeWidth={2} color={C.ink3} />
    </Pressable>
  );
});

/**
 * Ruled placeholders rather than a shimmer: the grid is the thing that is
 * already true while the rows load, so it is what we draw.
 */
function LoungePlaceholders() {
  const C = useColors();
  return (
    <View>
      {[0, 1, 2].map((key) => (
        <View key={key} style={[styles.loungeRow, { borderBottomColor: C.rule }]}>
          <View style={[styles.loungeTag, { borderColor: C.rule }]} />
          <View style={styles.navText}>
            <View style={[styles.barWide, { backgroundColor: C.surface2 }]} />
            <View style={[styles.barNarrow, { backgroundColor: C.surface }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

function NoLounges() {
  const C = useColors();
  return (
    <View style={styles.empty}>
      <Text style={[styles.emptyText, { color: C.ink2 }]}>
        No lounges yet — create one or join with a code.
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Find a lounge"
        onPress={() => router.push('/(tabs)/explore')}
        style={({ pressed: isPressed }) => [
          styles.emptyAction,
          { borderColor: C.live, backgroundColor: isPressed ? C.liveWash : 'transparent' },
        ]}>
        <Text style={[styles.emptyActionLabel, { color: C.liveText }]}>FIND A LOUNGE</Text>
      </Pressable>
    </View>
  );
}

/* ------------------------------------------------------------------ utils */

/** Two letters, the way the artboard tags a lounge tile. */
function tagFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '??';
  const first = words[0]?.[0] ?? '';
  const second = words.length > 1 ? (words[1]?.[0] ?? '') : (words[0]?.[1] ?? '');
  return (first + second).toUpperCase();
}

function formatMonth(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'RECENTLY';
  return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }).toUpperCase();
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
    paddingBottom: Space.xxxl,
  },
  identity: {
    paddingHorizontal: GUTTER,
    paddingTop: Space.lg,
    paddingBottom: 14,
    borderBottomWidth: Rule.hair,
  },
  identityRow: {
    flexDirection: 'row',
    gap: Space.md,
  },
  avatarWell: {
    position: 'relative',
  },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarInitial: {
    ...Type.display(36),
    letterSpacing: 0,
  },
  presence: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 15,
    height: 15,
    borderWidth: 3,
  },
  identityText: {
    flex: 1,
    minWidth: 0,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Space.sm,
  },
  nameColumn: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    ...Type.display(22),
    letterSpacing: tracking(22, -0.02),
  },
  handle: {
    ...Type.body(14),
  },
  bio: {
    ...Type.body(16),
    marginTop: Space.md,
  },
  edit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: TOUCH_TARGET,
    paddingHorizontal: 11,
    borderWidth: Rule.hair,
  },
  retry: {
    alignSelf: 'flex-start',
    marginTop: Space.md,
  },
  editLabel: {
    ...Type.heading(11),
    letterSpacing: tracking(11, 0.09),
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: Space.sm,
  },
  chip: {
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  chipLabel: {
    ...Type.heading(11),
    letterSpacing: tracking(11, 0.09),
  },
  since: {
    ...Type.label(11),
    letterSpacing: tracking(11, 0.09),
    marginTop: Space.sm,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 56,
    paddingHorizontal: GUTTER,
    paddingVertical: Space.md,
    borderBottomWidth: Rule.hair,
  },
  navText: {
    flex: 1,
    minWidth: 0,
  },
  navTitle: {
    ...Type.label(14),
    letterSpacing: 0,
    textTransform: 'none',
  },
  navDetail: {
    ...Type.label(11),
    letterSpacing: tracking(11, 0.06),
    marginTop: 2,
  },
  kicker: {
    ...Type.label(11),
    letterSpacing: tracking(11, 0.12),
    paddingHorizontal: GUTTER,
    paddingTop: 14,
    paddingBottom: 6,
  },
  loungeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 56,
    paddingHorizontal: GUTTER,
    paddingVertical: 11,
    borderBottomWidth: Rule.hair,
  },
  loungeTag: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: Rule.hair,
  },
  loungeTagLabel: {
    ...Type.heading(11),
    letterSpacing: tracking(11, 0.04),
  },
  loungeMeta: {
    ...Type.label(11),
    letterSpacing: tracking(11, 0.08),
    marginTop: 2,
  },
  barWide: {
    width: '60%',
    height: 12,
  },
  barNarrow: {
    width: '30%',
    height: 10,
    marginTop: 6,
  },
  empty: {
    paddingHorizontal: GUTTER,
    paddingBottom: 14,
  },
  emptyText: {
    ...Type.body(16),
  },
  emptyAction: {
    alignSelf: 'flex-start',
    justifyContent: 'center',
    marginTop: Space.md,
    minHeight: 46,
    paddingHorizontal: Space.lg,
    borderWidth: Rule.hair,
  },
  emptyActionLabel: {
    ...Type.heading(11),
    letterSpacing: tracking(11, 0.1),
  },
  signOut: {
    marginHorizontal: GUTTER,
    marginTop: Space.lg,
    marginBottom: Space.xxl,
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: Space.lg,
    borderWidth: Rule.hair,
  },
  signOutLabel: {
    ...Type.heading(11),
    letterSpacing: tracking(11, 0.1),
  },
});
