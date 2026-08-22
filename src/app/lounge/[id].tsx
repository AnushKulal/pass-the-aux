import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import {
  Globe,
  Lock,
  MoreVertical,
  Plus,
  Radio,
  Share2,
  Users,
  WifiOff,
  type LucideIcon,
} from 'lucide-react-native';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View, type ListRenderItem } from 'react-native';

import { LoungeMenuModal } from '@/components/lounge/lounge-menu-modal';
import { MemberRow } from '@/components/lounge/member-row';
import { SessionCard } from '@/components/lounge/session-card';
import {
  AuxButton,
  EmptyState,
  GlassCard,
  Screen,
  SheetTabs,
  Skeleton,
  useToast,
  type SheetTab,
} from '@/components/ui';
import { LoungeChat } from '@/features/chat';
import { shareInviteCode } from '@/features/lounges/invite';
import {
  loungeErrorMessage,
  useCurrentUserId,
  useJoinLounge,
  useLeaveLounge,
  useLounge,
  useLoungeMembers,
  useLoungeSessions,
  useStartSession,
  type LoungeMemberEntry,
} from '@/features/lounges/queries';
import {
  Colors,
  Fonts,
  PointerEvents,
  Radius,
  Space,
  TOUCH_TARGET,
  Type,
  bloomGradient,
} from '@/lib/theme';

/**
 * The lounge is two views of one community, exactly as a Session is Queue and
 * Chat: who is on aux and who is here, or what everybody is saying.
 */
const TABS: SheetTab[] = [
  { key: 'lounge', label: 'Lounge' },
  { key: 'chat', label: 'Chat' },
];

export default function LoungeDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const loungeId = typeof params.id === 'string' ? params.id : '';

  const toast = useToast();
  const userId = useCurrentUserId();
  const [menuOpen, setMenuOpen] = useState(false);
  const [tab, setTab] = useState<string>('lounge');

  const detail = useLounge(loungeId);
  const lounge = detail.data?.lounge ?? null;
  const isMember = detail.data?.isMember ?? false;
  const isOwner = detail.data?.role === 'owner';

  // Membership gates every nested read: RLS returns zero rows to a non-member,
  // which would otherwise render as a permanently empty roster.
  const members = useLoungeMembers(isMember ? loungeId : '');
  const sessions = useLoungeSessions(isMember ? loungeId : '');

  const join = useJoinLounge();
  const leave = useLeaveLounge();
  const startSession = useStartSession();

  const handleBack = useCallback(() => {
    // A deep-linked invite has no history behind it; fall back to the tab.
    if (router.canGoBack()) router.back();
    else router.replace('/lounges');
  }, []);

  const handleShare = useCallback(async () => {
    if (!lounge) return;
    try {
      const result = await shareInviteCode(lounge.name, lounge.invite_code);
      if (result === 'copied') toast.show(`Invite code ${lounge.invite_code} copied`, 'success');
      else if (result === 'shared') toast.show('Invite sent', 'success');
    } catch (error) {
      toast.show(loungeErrorMessage(error, 'Could not share the invite.'), 'error');
    }
  }, [lounge, toast]);

  const handleJoin = useCallback(() => {
    join.mutate(loungeId, {
      onSuccess: () => toast.show('Joined the lounge', 'success'),
      onError: (error) => toast.show(loungeErrorMessage(error, 'Could not join.'), 'error'),
    });
  }, [join, loungeId, toast]);

  const handleLeave = useCallback(() => {
    leave.mutate(loungeId, {
      onSuccess: () => {
        setMenuOpen(false);
        toast.show('You left the lounge', 'info');
        router.replace('/lounges');
      },
      onError: (error) => toast.show(loungeErrorMessage(error, 'Could not leave.'), 'error'),
    });
  }, [leave, loungeId, toast]);

  const handleStartSession = useCallback(() => {
    startSession.mutate(loungeId, {
      onSuccess: (room) => router.push(`/room/${room.id}`),
      onError: (error) =>
        toast.show(loungeErrorMessage(error, 'Could not start a Session.'), 'error'),
    });
  }, [startSession, loungeId, toast]);

  const renderMember = useCallback<ListRenderItem<LoungeMemberEntry>>(
    ({ item }) => (
      <MemberRow
        displayName={item.profile?.display_name ?? 'Unknown'}
        username={item.profile?.username ?? 'unknown'}
        avatarUrl={item.profile?.avatar_url}
        role={item.role}
        isYou={item.userId === userId}
      />
    ),
    [userId],
  );

  const header = useMemo(
    () =>
      lounge ? (
        <View style={styles.header}>
          <GlassCard>
            <View style={styles.about}>
              {lounge.description ? (
                <Text style={styles.description}>{lounge.description}</Text>
              ) : null}

              <View style={styles.aboutMeta}>
                {lounge.is_public ? (
                  <Globe size={16} color={Colors.muted} strokeWidth={1.6} />
                ) : (
                  <Lock size={16} color={Colors.muted} strokeWidth={1.6} />
                )}
                <Text style={styles.metaLabel}>
                  {lounge.is_public ? 'Public lounge' : 'Private lounge'}
                </Text>
              </View>

              {/* The invite code is the lounge's front door — members must be
                  able to find it without hunting through a menu. Mono and
                  tracked wide: eight characters that get read out loud have to
                  survive being misheard, and mono is the only face here where
                  0/O and 1/I are visibly different shapes. */}
              {isMember ? (
                <View style={styles.inviteRow}>
                  <View style={styles.inviteBlock}>
                    <Text style={styles.inviteLabel}>Invite code</Text>
                    <Text selectable style={styles.inviteCode}>
                      {lounge.invite_code}
                    </Text>
                  </View>
                  <AuxButton
                    label="Share"
                    icon={Share2}
                    variant="ghost"
                    size="sm"
                    onPress={() => void handleShare()}
                  />
                </View>
              ) : null}
            </View>
          </GlassCard>

          <SectionTitle
            title="Active Sessions"
            action={
              isMember && (sessions.data?.length ?? 0) > 0 ? (
                <AuxButton
                  label="New"
                  icon={Plus}
                  variant="ghost"
                  size="sm"
                  loading={startSession.isPending}
                  onPress={handleStartSession}
                />
              ) : null
            }
          />

          {sessions.isPending ? (
            <View style={styles.sessionSkeletons}>
              <Skeleton width="100%" height={84} radius={18} />
              <Skeleton width="100%" height={84} radius={18} />
            </View>
          ) : (sessions.data?.length ?? 0) === 0 ? (
            <GlassCard>
              <View style={styles.noSessions}>
                <Radio size={22} color={Colors.muted} strokeWidth={1.6} />
                <Text style={styles.noSessionsText}>
                  Nobody is on aux right now. Start a Session and pick the first track.
                </Text>
                <AuxButton
                  label="Start a Session"
                  variant="accent"
                  icon={Radio}
                  loading={startSession.isPending}
                  onPress={handleStartSession}
                />
              </View>
            </GlassCard>
          ) : (
            /* Mapped, not virtualised: a lounge has a handful of live Sessions
               at most, and this block is the members FlatList's own header —
               nesting a second VirtualizedList here is what RN warns about. */
            <View style={styles.sessionList}>
              {sessions.data?.map((item) => (
                <SessionCard
                  key={item.room.id}
                  name={item.room.name}
                  hostName={item.hostName}
                  listeners={item.listeners}
                  isPlaying={item.room.is_playing}
                  nowPlaying={item.nowPlaying}
                  onPress={() => router.push(`/room/${item.room.id}`)}
                />
              ))}
            </View>
          )}

          <SectionTitle
            title={
              members.data ? `Members (${members.data.length})` : 'Members'
            }
          />
        </View>
      ) : null,
    [
      lounge,
      isMember,
      sessions.data,
      sessions.isPending,
      members.data,
      startSession.isPending,
      handleShare,
      handleStartSession,
    ],
  );

  const headerActions = (
    <View style={styles.headerActions}>
      {/* An invite code belongs to the people already inside; a browsing
          non-member has nothing to share yet. */}
      <IconAction
        label="Share invite"
        icon={Share2}
        disabled={!isMember}
        onPress={() => void handleShare()}
      />
      <IconAction
        label="More options"
        icon={MoreVertical}
        disabled={!isMember}
        onPress={() => setMenuOpen(true)}
      />
    </View>
  );

  return (
    <Screen title={lounge?.name ?? 'Lounge'} onBack={handleBack} right={headerActions}>
      <Bloom />

      {detail.isPending ? (
        <DetailSkeleton />
      ) : detail.isError ? (
        <EmptyState
          icon={WifiOff}
          title="Could not load this lounge"
          description={loungeErrorMessage(detail.error, 'Check your connection and try again.')}
          action={
            <AuxButton label="Try again" variant="ghost" onPress={() => void detail.refetch()} />
          }
        />
      ) : !lounge ? (
        /*
          RLS hid the row. Either the lounge is private and we are not a member,
          or it no longer exists — indistinguishable from here, so the copy
          covers both without accusing the user of a bad link.
        */
        <EmptyState
          icon={Lock}
          title="Join to view this lounge"
          description="This lounge is private, or it no longer exists. Redeem its invite code to get in."
          action={
            /*
              Primary, not accent: this navigates to Explore, it does not join
              anything. Explore's own code-submit button is ink on glass in the
              artboard for the same reason — accent belongs to the join itself.
            */
            <AuxButton
              label="Enter an invite code"
              variant="primary"
              onPress={() => router.replace('/explore')}
            />
          }
        />
      ) : !isMember ? (
        <View style={styles.previewWrap}>
          <EmptyState
            icon={Users}
            title={`Join ${lounge.name}`}
            description={
              lounge.description ||
              'Join to see its members and drop into whatever is playing.'
            }
            action={
              <AuxButton
                label="Join lounge"
                variant="accent"
                loading={join.isPending}
                onPress={handleJoin}
              />
            }
          />
        </View>
      ) : (
        <View style={styles.tabbed}>
          <View style={styles.tabs}>
            <SheetTabs tabs={TABS} active={tab} onChange={setTab} />
          </View>

          {tab === 'chat' ? (
            /*
              Mounted only while selected, like the Session's chat: the
              subscription's SUBSCRIBED handler replays whatever landed while it
              was torn down, so nothing is lost by unmounting it.
              bottomInset is left to default — this screen reaches the window
              edge, so the composer owns the home-indicator padding.
            */
            <LoungeChat loungeId={loungeId} />
          ) : (
            <FlatList
              data={members.data ?? []}
              keyExtractor={memberKey}
              renderItem={renderMember}
              ListHeaderComponent={header}
              ItemSeparatorComponent={Divider}
              style={styles.list}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              ListEmptyComponent={
                members.isPending ? (
                  <View style={styles.memberSkeletons}>
                    <Skeleton width="100%" height={44} radius={12} />
                    <Skeleton width="100%" height={44} radius={12} />
                    <Skeleton width="100%" height={44} radius={12} />
                  </View>
                ) : (
                  <EmptyState icon={Users} title="No members listed" />
                )
              }
            />
          )}
        </View>
      )}

      <LoungeMenuModal
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        isOwner={isOwner}
        isLeaving={leave.isPending}
        onLeave={handleLeave}
      />
    </Screen>
  );
}

function memberKey(item: LoungeMemberEntry): string {
  return item.userId;
}

function Divider() {
  return <View style={styles.divider} />;
}

/**
 * A mono eyebrow, a hairline running out to whatever action sits on the right.
 * The same rule-plus-label figure the chat log uses for day breaks, so the two
 * halves of this screen are visibly one system.
 */
function SectionTitle({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <View style={styles.sectionTitle}>
      <Text style={styles.sectionLabel}>{title}</Text>
      <View style={styles.sectionRule} />
      {action}
    </View>
  );
}

/**
 * The room's light. Decorative only — Bloom colours never carry meaning, which
 * is precisely what keeps Colors.accent free to mean "live". There is no blur
 * in React Native, so the softness is faked with two overlapping gradients that
 * fall off on different axes; the hard top edge is parked above the header.
 */
function Bloom() {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.bloom, PointerEvents.none]}>
      <LinearGradient
        colors={bloomGradient(0.3)}
        locations={[0, 0.45, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={bloomGradient(0.18)}
        locations={[0, 0.5, 1]}
        start={{ x: 0.1, y: 0.1 }}
        end={{ x: 0.95, y: 0.9 }}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

function IconAction({
  label,
  icon: Icon,
  onPress,
  disabled = false,
}: {
  label: string;
  icon: LucideIcon;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconAction,
        pressed && styles.iconActionPressed,
        disabled && styles.iconActionDisabled,
      ]}>
      <Icon size={22} color={Colors.text} strokeWidth={1.6} />
    </Pressable>
  );
}

function DetailSkeleton() {
  return (
    <View style={styles.detailSkeleton}>
      <Skeleton width="100%" height={132} radius={18} />
      <Skeleton width="45%" height={20} />
      <Skeleton width="100%" height={84} radius={18} />
      <Skeleton width="35%" height={20} />
      <Skeleton width="100%" height={44} radius={12} />
      <Skeleton width="100%" height={44} radius={12} />
    </View>
  );
}

const styles = StyleSheet.create({
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    // 8pt clearance between two adjacent 44pt targets.
    gap: Space.sm,
  },
  iconAction: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconActionPressed: {
    opacity: 0.6,
  },
  iconActionDisabled: {
    opacity: 0.35,
  },
  tabbed: {
    flex: 1,
  },
  tabs: {
    paddingBottom: Space.md,
  },
  list: {
    flex: 1,
  },
  listContent: {
    flexGrow: 1,
    paddingBottom: Space.xxxl,
  },
  header: {
    gap: Space.lg,
    paddingBottom: Space.sm,
  },
  about: {
    gap: Space.md,
  },
  description: {
    ...Type.body,
    color: Colors.text,
  },
  aboutMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  metaLabel: {
    ...Type.label,
    color: Colors.muted,
  },
  inviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.md,
    // A hairline promotes the code out of the description block above it
    // without needing a second card to hold it.
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
    paddingTop: Space.md,
  },
  inviteBlock: {
    flexShrink: 1,
    gap: 3,
  },
  inviteLabel: {
    ...Type.monoLabel,
    color: Colors.muted,
  },
  inviteCode: {
    // No token carries a 24px mono, so it is composed from the mono face and
    // the title size rather than invented.
    fontFamily: Fonts.monoMedium,
    fontSize: Type.title.fontSize,
    lineHeight: Type.title.lineHeight,
    letterSpacing: 3.4,
    color: Colors.text,
  },
  sectionTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    minHeight: TOUCH_TARGET,
  },
  sectionLabel: {
    ...Type.monoLabel,
    color: Colors.muted,
  },
  sectionRule: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.border,
  },
  bloom: {
    position: 'absolute',
    // Parked above the header so its hard top edge never lands on the screen —
    // what shows is only the falloff, which is the whole point of a bloom.
    top: -180,
    left: -Space.huge,
    right: -Space.huge,
    height: 380,
    borderRadius: Radius.pill,
    overflow: 'hidden',
  },
  sessionList: {
    gap: Space.md,
  },
  sessionSkeletons: {
    gap: Space.md,
  },
  noSessions: {
    alignItems: 'flex-start',
    gap: Space.md,
  },
  noSessionsText: {
    ...Type.body,
    color: Colors.muted,
  },
  previewWrap: {
    flex: 1,
    justifyContent: 'center',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.border,
  },
  memberSkeletons: {
    gap: Space.md,
    paddingTop: Space.sm,
  },
  detailSkeleton: {
    gap: Space.lg,
  },
});
