/**
 * A lounge. Built from design/v2/aux-v2.dc.html, screen "Lounge detail".
 *
 * One scroller, not three tabs: the tile and the name, the way in, whatever is
 * live right now, then the members. Chat is a sheet off the same screen so the
 * roster stays the thing you land on.
 *
 * A non-member gets "Join to see inside" rather than an error — RLS hiding the
 * roster is not a failure, it is the door being shut.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import {
  ArrowLeft,
  ChevronRight,
  Copy,
  MessageCircle,
  MoreHorizontal,
  Play,
  X,
} from 'lucide-react-native';
import { memo, useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ListRenderItem,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChatNotice } from '@/components/chat/bubble-kit';
import { ChatComposer } from '@/components/chat/chat-composer';
import { ChatList } from '@/components/chat/chat-list';
import { LoungeMenuModal } from '@/components/lounge/lounge-menu-modal';
import { MemberRow } from '@/components/lounge/member-row';
import { SessionCard } from '@/components/lounge/session-card';
import { LivePulse, Screen, Skeleton, useToast } from '@/components/ui';
import { shareInviteCode } from '@/features/lounges/invite';
import {
  loungeErrorMessage,
  loungeKeys,
  useCurrentUserId,
  useJoinLounge,
  useLeaveLounge,
  useLounge,
  useLoungeMembers,
  useLoungeSessions,
  useStartSession,
  type LoungeMemberEntry,
} from '@/features/lounges/queries';
import { supabase } from '@/lib/supabase';
import {
  Fonts,
  Radii,
  Rule,
  Sheet as SheetMetrics,
  Space,
  TOUCH_TARGET,
  Type,
  bloom,
  dropped,
  raised,
  tracking,
} from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

/** The artboard's hero tile. */
const ART = 96;
/** The chrome squares in the header row. */
const TILE = 38;

/**
 * Deleting a lounge lives here rather than in `@/features/lounges/queries`
 * because nothing else in the app can do it — the owner's `···` sheet is the
 * only entry point. The RLS policy is `owner_id = auth.uid()`, and a policy
 * refusal deletes zero rows *without* raising, so the row count is what gets
 * checked; otherwise a non-owner would see a cheerful "Lounge deleted".
 */
function useDeleteLounge() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (loungeId: string): Promise<void> => {
      const { data, error } = await supabase
        .from('lounges')
        .delete()
        .eq('id', loungeId)
        .select('id');

      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error('The database refused that. Only the owner can delete a lounge.');
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: loungeKeys.all });
    },
  });
}

export default function LoungeDetailScreen() {
  const C = useColors();
  const params = useLocalSearchParams<{ id: string }>();
  const loungeId = typeof params.id === 'string' ? params.id : '';

  const toast = useToast();
  const userId = useCurrentUserId();
  const [menuOpen, setMenuOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  const detail = useLounge(loungeId);
  const lounge = detail.data?.lounge ?? null;
  const isMember = detail.data?.isMember ?? false;
  const role = detail.data?.role ?? null;
  const isOwner = role === 'owner';

  // Membership gates every nested read: RLS returns zero rows to a non-member,
  // which would otherwise render as a permanently empty roster.
  const members = useLoungeMembers(isMember ? loungeId : '');
  const sessions = useLoungeSessions(isMember ? loungeId : '');

  const join = useJoinLounge();
  const leave = useLeaveLounge();
  const remove = useDeleteLounge();
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

  const shareInvite = useCallback(() => void handleShare(), [handleShare]);

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

  const handleDelete = useCallback(() => {
    remove.mutate(loungeId, {
      onSuccess: () => {
        setMenuOpen(false);
        toast.show('Lounge deleted', 'info');
        router.replace('/lounges');
      },
      onError: (error) => toast.show(loungeErrorMessage(error, 'Could not delete.'), 'error'),
    });
  }, [remove, loungeId, toast]);

  const handleStartSession = useCallback(() => {
    startSession.mutate(loungeId, {
      onSuccess: (room) => router.push(`/room/${room.id}`),
      onError: (error) =>
        toast.show(loungeErrorMessage(error, 'Could not start a Session.'), 'error'),
    });
  }, [startSession, loungeId, toast]);

  /**
   * README §15 is not built yet. Rather than wire a dead target, own rows go to
   * the You tab and everyone else's says so plainly.
   */
  const openProfile = useCallback(
    (targetId: string) => {
      if (targetId && targetId === userId) {
        router.push('/profile');
        return;
      }
      // TODO(profiles): route to /profile/[id] once that screen exists.
      toast.show('That profile screen is not built yet.', 'info');
    },
    [toast, userId],
  );

  const openInvite = useCallback(() => {
    setMenuOpen(false);
    void handleShare();
  }, [handleShare]);

  const openMenu = useCallback(() => setMenuOpen(true), []);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const openChat = useCallback(() => setChatOpen(true), []);
  const closeChat = useCallback(() => setChatOpen(false), []);

  const renderMember = useCallback<ListRenderItem<LoungeMemberEntry>>(
    ({ item }) => (
      <MemberRow
        displayName={item.profile?.display_name ?? 'Unknown'}
        username={item.profile?.username ?? 'unknown'}
        avatarUrl={item.profile?.avatar_url}
        role={item.role}
        isYou={item.userId === userId}
        joinedAt={item.joinedAt}
        isPremium={item.profile?.is_premium ?? false}
        // No presence table yet, so the only presence this screen can honestly
        // assert is your own.
        isOnline={item.userId === userId}
        onPress={() => openProfile(item.userId)}
      />
    ),
    [openProfile, userId],
  );

  const memberCount = members.data?.length ?? null;
  const liveSessions = useMemo(() => sessions.data ?? [], [sessions.data]);

  const header = useMemo(() => {
    if (!lounge) return null;

    return (
      <View>
        <View style={styles.headerRow}>
          <Tile icon={ArrowLeft} label="Go back" onPress={handleBack} />
          <View style={styles.headerGap} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Invite code ${lounge.invite_code}. Share it.`}
            onPress={shareInvite}
            hitSlop={4}
            style={({ pressed }) => [
              styles.code,
              { backgroundColor: C.surface },
              raised(C),
              pressed ? styles.dim : null,
            ]}>
            <Text style={[styles.codeText, { color: C.ink2 }]}>{lounge.invite_code}</Text>
            <Copy size={13} strokeWidth={2} color={C.ink2} />
          </Pressable>
          <Tile icon={MoreHorizontal} label="More options" onPress={openMenu} />
        </View>

        <View style={styles.hero}>
          <View
            style={[
              styles.art,
              { backgroundColor: C.artwork },
              bloom(C.glow, 'md'),
            ]}>
            <Text style={[styles.artTag, { color: C.artInk }]}>{tagFor(lounge.name)}</Text>
          </View>

          <View style={styles.heroMeta}>
            <Text style={[styles.role, { color: C.ink3 }]}>{role ?? 'Member'}</Text>
            <Text numberOfLines={2} style={[styles.name, { color: C.ink }]}>
              {lounge.name}
            </Text>
            {lounge.description ? (
              <Text numberOfLines={3} style={[styles.description, { color: C.ink2 }]}>
                {lounge.description}
              </Text>
            ) : null}
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Start a session"
          accessibilityState={{ disabled: startSession.isPending, busy: startSession.isPending }}
          disabled={startSession.isPending}
          onPress={handleStartSession}
          style={({ pressed }) => [
            styles.start,
            { backgroundColor: C.pill },
            dropped(C, 'lg'),
            pressed ? styles.held : null,
            startSession.isPending ? styles.dim : null,
          ]}>
          {startSession.isPending ? (
            <ActivityIndicator size="small" color={C.pillInk} />
          ) : (
            <Play size={17} strokeWidth={2} color={C.pillInk} fill={C.pillInk} />
          )}
          <Text style={[styles.startLabel, { color: C.pillInk }]}>Start a session</Text>
        </Pressable>

        <Row icon={MessageCircle} label="Chat" onPress={openChat} />

        <View style={styles.sectionHead}>
          {liveSessions.length > 0 ? <LivePulse size={6} /> : null}
          <Text
            style={[
              styles.sectionKicker,
              { color: liveSessions.length > 0 ? C.liveText : C.ink3 },
            ]}>
            {liveSessions.length > 0 ? 'Live sessions' : 'Sessions'}
          </Text>
        </View>

        {sessions.isPending ? (
          <View style={styles.sessionSkeletons}>
            <Skeleton width="100%" height={86} radius={Radii.xl} />
            <Skeleton width="100%" height={86} radius={Radii.xl} />
          </View>
        ) : sessions.isError ? (
          <View style={styles.notice}>
            <ChatNotice
              label="Sessions didn't load."
              action={{ label: 'Retry', onPress: () => void sessions.refetch() }}
            />
          </View>
        ) : liveSessions.length === 0 ? (
          <Text style={[styles.quiet, { color: C.ink2 }]}>
            Nobody is on aux. Start one above.
          </Text>
        ) : (
          <View style={styles.sessions}>
            {liveSessions.map((entry) => (
              <SessionCard
                key={entry.room.id}
                name={entry.room.name}
                hostName={entry.hostName}
                listeners={entry.listeners}
                isPlaying={entry.room.is_playing}
                nowPlaying={entry.nowPlaying}
                onPress={() => router.push(`/room/${entry.room.id}`)}
              />
            ))}
          </View>
        )}

        <View style={styles.sectionHead}>
          <Text style={[styles.sectionKicker, { color: C.ink3 }]}>
            {memberCount === null ? 'Members' : `Members · ${memberCount}`}
          </Text>
        </View>
      </View>
    );
  }, [
    C,
    handleBack,
    handleStartSession,
    liveSessions,
    lounge,
    memberCount,
    openChat,
    openMenu,
    role,
    sessions,
    shareInvite,
    startSession.isPending,
  ]);

  return (
    <Screen padded={false}>
      {detail.isPending ? (
        <DetailSkeleton onBack={handleBack} />
      ) : detail.isError ? (
        <Marker
          title="Could not load this lounge"
          body={loungeErrorMessage(detail.error, 'Check your connection and try again.')}
          onBack={handleBack}
          actionLabel="Try again"
          onAction={() => void detail.refetch()}
        />
      ) : !lounge ? (
        /*
          RLS hid the row. Either the lounge is private and we are not a member,
          or it no longer exists — indistinguishable from here.
        */
        <Marker
          title="Join to see inside"
          body="This lounge is private, or it no longer exists."
          onBack={handleBack}
          actionLabel="Enter an invite code"
          onAction={() => router.replace('/explore')}
        />
      ) : !isMember ? (
        <Marker
          title="Join to see inside"
          body={lounge.description || 'Sessions, chat and members are for members only.'}
          onBack={handleBack}
          actionLabel={`Join ${lounge.name}`}
          busy={join.isPending}
          onAction={handleJoin}
        />
      ) : (
        <FlatList
          data={members.data ?? []}
          keyExtractor={memberKey}
          renderItem={renderMember}
          style={styles.fill}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={header}
          ListEmptyComponent={
            members.isPending ? (
              <View style={styles.memberSkeletons}>
                <Skeleton width="100%" height={54} radius={Radii.md} />
                <Skeleton width="100%" height={54} radius={Radii.md} />
                <Skeleton width="100%" height={54} radius={Radii.md} />
              </View>
            ) : members.isError ? (
              <View style={styles.notice}>
                <ChatNotice
                  label="The roster didn't load."
                  action={{ label: 'Retry', onPress: () => void members.refetch() }}
                />
              </View>
            ) : (
              <View style={styles.notice}>
                <ChatNotice
                  label="Only you in here so far."
                  action={{ label: 'Invite someone', onPress: shareInvite }}
                />
              </View>
            )
          }
        />
      )}

      <LoungeMenuModal
        visible={menuOpen}
        onClose={closeMenu}
        isOwner={isOwner}
        isLeaving={leave.isPending}
        onLeave={handleLeave}
        loungeName={lounge?.name}
        memberCount={memberCount}
        role={role}
        onInvite={openInvite}
        onDelete={isOwner ? handleDelete : undefined}
        isDeleting={remove.isPending}
      />

      <ChatSheet
        visible={chatOpen && lounge !== null}
        loungeId={loungeId}
        loungeName={lounge?.name ?? ''}
        onClose={closeChat}
        onOpenProfile={openProfile}
      />
    </Screen>
  );
}

function memberKey(item: LoungeMemberEntry): string {
  return item.userId;
}

/** The artboard's three-letter mark: BMT, 3AM, VNL. */
function tagFor(name: string): string {
  const letters = name.replace(/[^a-z0-9]/gi, '');
  return (letters.slice(0, 3) || '?').toUpperCase();
}

/* ------------------------------------------------------------------ parts */

/** The raised card square the artboard puts every piece of chrome in. */
const Tile = memo(function Tile({
  icon: Icon,
  label,
  onPress,
}: {
  icon: typeof ArrowLeft;
  label: string;
  onPress: () => void;
}) {
  const C = useColors();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={(TOUCH_TARGET - TILE) / 2}
      style={({ pressed }) => [
        styles.tile,
        { backgroundColor: C.surface },
        raised(C),
        pressed ? styles.dim : null,
      ]}>
      <Icon size={18} strokeWidth={2.2} color={C.ink} />
    </Pressable>
  );
});

/** A raised row: recessed icon well, label, chevron. */
const Row = memo(function Row({
  icon: Icon,
  label,
  onPress,
}: {
  icon: typeof MessageCircle;
  label: string;
  onPress: () => void;
}) {
  const C = useColors();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: C.surface },
        raised(C),
        pressed ? styles.dim : null,
      ]}>
      {/*
        A 38px well takes a hairline, NOT `pressedSoft()`. On a dark ground the
        light half of the inset pair sits at 3.2% alpha, so at this size only
        the dark half lands and it reads as dirt rather than as depth.
      */}
      <View style={[styles.rowWell, { backgroundColor: C.bgRecessed, borderColor: C.rule }]}>
        <Icon size={17} strokeWidth={2} color={C.ink2} />
      </View>
      <Text style={[styles.rowLabel, { color: C.ink }]}>{label}</Text>
      <ChevronRight size={17} strokeWidth={2} color={C.ink3} />
    </Pressable>
  );
});

/**
 * The lounge log, as a sheet.
 *
 * `ChatList` and `ChatComposer` are mounted directly rather than through
 * `LoungeChat` so the log can hand every avatar and name a profile target —
 * the wrapper has no prop for it. Mounted only while open: the subscription's
 * SUBSCRIBED handler replays whatever landed while it was torn down.
 */
function ChatSheet({
  visible,
  loungeId,
  loungeName,
  onClose,
  onOpenProfile,
}: {
  visible: boolean;
  loungeId: string;
  loungeName: string;
  onClose: () => void;
  onOpenProfile: (userId: string) => void;
}) {
  const C = useColors();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      statusBarTranslucent
      onRequestClose={onClose}>
      <View style={[styles.scrim, { backgroundColor: C.scrim }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          style={styles.scrimTap}
        />

        <View
          style={[
            styles.sheet,
            { backgroundColor: C.bg, paddingBottom: insets.bottom },
            dropped(C, 'lg'),
          ]}>
          <View style={styles.grabberSlot}>
            <View style={[styles.grabber, { backgroundColor: C.ink3 }]} />
          </View>

          <View style={styles.sheetHead}>
            <Text numberOfLines={1} style={[styles.sheetTitle, { color: C.ink }]}>
              {loungeName}
            </Text>
            <Tile icon={X} label="Close" onPress={onClose} />
          </View>

          <View style={styles.fill}>
            <ChatList
              loungeId={loungeId}
              roomId={null}
              emptyLabel="Say hello, or drop a track everyone should hear."
              onOpenProfile={onOpenProfile}
            />
            <ChatComposer
              loungeId={loungeId}
              roomId={null}
              placeholder={`Message ${loungeName}`}
              bottomInset={0}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** The full-screen states: a title, one line, and whatever you can do about it. */
function Marker({
  title,
  body,
  onBack,
  actionLabel,
  onAction,
  busy = false,
}: {
  title: string;
  body: string;
  onBack: () => void;
  actionLabel: string;
  onAction: () => void;
  busy?: boolean;
}) {
  const C = useColors();

  return (
    <View style={styles.fill}>
      <View style={styles.markerBar}>
        <Tile icon={ArrowLeft} label="Go back" onPress={onBack} />
      </View>

      <View style={styles.markerBody}>
        <Text style={[styles.markerTitle, { color: C.ink }]}>{title}</Text>
        <Text style={[styles.description, { color: C.ink2 }]}>{body}</Text>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          accessibilityState={{ disabled: busy, busy }}
          disabled={busy}
          onPress={onAction}
          style={({ pressed }) => [
            styles.start,
            styles.markerAction,
            { backgroundColor: C.pill },
            dropped(C, 'lg'),
            pressed ? styles.held : null,
            busy ? styles.dim : null,
          ]}>
          {busy ? <ActivityIndicator size="small" color={C.pillInk} /> : null}
          <Text numberOfLines={1} style={[styles.startLabel, { color: C.pillInk }]}>
            {actionLabel}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Carries its own back target: a lounge that never answers must still be exitable. */
function DetailSkeleton({ onBack }: { onBack: () => void }) {
  return (
    <View style={styles.fill}>
      <View style={styles.markerBar}>
        <Tile icon={ArrowLeft} label="Go back" onPress={onBack} />
      </View>

      <View accessibilityLabel="Loading this lounge" style={styles.detailSkeleton}>
        <View style={styles.skeletonHero}>
          <Skeleton width={ART} height={ART} radius={Radii.xl} />
          <View style={styles.skeletonMeta}>
            <Skeleton width="70%" height={24} radius={Radii.sm} />
            <Skeleton width="50%" height={13} radius={Radii.sm} />
          </View>
        </View>
        <Skeleton width="100%" height={56} radius={Radii.button} />
        <Skeleton width="100%" height={86} radius={Radii.xl} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  dim: {
    opacity: 0.6,
  },
  held: {
    opacity: 0.9,
  },

  /* header */
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm + 1,
    paddingHorizontal: Space.xxl,
    paddingTop: Space.md,
  },
  headerGap: {
    flex: 1,
  },
  tile: {
    width: TILE,
    height: TILE,
    borderRadius: Radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  code: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm + 1,
    paddingHorizontal: Space.md + 2,
    paddingVertical: 10,
    borderRadius: Radii.sm,
  },
  codeText: {
    fontFamily: Fonts.semibold,
    fontSize: 11.5,
    letterSpacing: tracking(11.5, 0.06),
    fontVariant: ['tabular-nums'],
  },

  /* hero */
  hero: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 17,
    paddingHorizontal: Space.xxl,
    paddingTop: Space.xxl,
  },
  art: {
    width: ART,
    height: ART,
    flexGrow: 0,
    flexShrink: 0,
    borderRadius: Radii.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  artTag: {
    fontFamily: Fonts.extrabold,
    fontSize: 22,
    letterSpacing: tracking(22, -0.03),
  },
  heroMeta: {
    flex: 1,
    minWidth: 0,
    paddingTop: Space.xs,
  },
  role: {
    ...Type.label(11),
    letterSpacing: tracking(11, 0.14),
  },
  name: {
    ...Type.display(25),
    lineHeight: 27,
    letterSpacing: tracking(25, -0.03),
    marginTop: 5,
  },
  description: {
    ...Type.body(13),
    lineHeight: 18,
    marginTop: 5,
  },

  /* the way in */
  start: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.sm + 2,
    minHeight: 56,
    marginHorizontal: Space.xl,
    marginTop: Space.xl + 2,
    borderRadius: Radii.button,
  },
  startLabel: {
    fontFamily: Fonts.semibold,
    fontSize: 15,
    letterSpacing: tracking(15, -0.005),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md + 2,
    minHeight: TOUCH_TARGET + 20,
    marginHorizontal: Space.xl,
    marginTop: Space.md,
    paddingHorizontal: Space.md + 3,
    borderRadius: Radii.lg,
  },
  rowWell: {
    width: 38,
    height: 38,
    borderRadius: Radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: Rule.hair,
  },
  rowLabel: {
    flex: 1,
    minWidth: 0,
    fontFamily: Fonts.extrabold,
    fontSize: 14.5,
    letterSpacing: tracking(14.5, -0.005),
  },

  /* sections */
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    paddingHorizontal: Space.xxl,
    paddingTop: Space.xxl + 4,
    paddingBottom: Space.md,
  },
  sectionKicker: {
    ...Type.label(10.5),
    letterSpacing: tracking(10.5, 0.15),
  },
  sessions: {
    gap: Space.sm + 1,
  },
  sessionSkeletons: {
    paddingHorizontal: Space.md + 2,
    gap: Space.sm + 1,
  },
  memberSkeletons: {
    paddingHorizontal: Space.xxl,
    gap: Space.sm,
  },
  quiet: {
    ...Type.body(13.5),
    paddingHorizontal: Space.xxl,
  },
  notice: {
    paddingHorizontal: Space.xl,
  },

  /* lists */
  listContent: {
    flexGrow: 1,
    paddingBottom: Space.huge * 2,
  },

  /* markers */
  markerBar: {
    flexDirection: 'row',
    paddingHorizontal: Space.xxl,
    paddingTop: Space.md,
  },
  markerBody: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Space.xxl,
    paddingBottom: Space.huge,
    gap: Space.sm,
  },
  markerTitle: {
    ...Type.display(28),
    letterSpacing: tracking(28, -0.03),
  },
  markerAction: {
    marginHorizontal: 0,
    alignSelf: 'stretch',
  },

  /* chat sheet */
  scrim: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  scrimTap: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  sheet: {
    height: '88%',
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    borderTopLeftRadius: SheetMetrics.radius,
    borderTopRightRadius: SheetMetrics.radius,
    overflow: 'hidden',
  },
  grabberSlot: {
    paddingTop: Space.md + 2,
    alignItems: 'center',
  },
  grabber: {
    width: SheetMetrics.grabberW,
    height: SheetMetrics.grabberH,
    borderRadius: SheetMetrics.grabberH / 2,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingHorizontal: Space.xxl,
    paddingTop: Space.lg + 2,
    paddingBottom: Space.md + 2,
  },
  sheetTitle: {
    ...Type.display(20),
    letterSpacing: tracking(20, -0.025),
    flex: 1,
    minWidth: 0,
  },

  detailSkeleton: {
    paddingHorizontal: Space.xxl,
    paddingTop: Space.xxl,
    gap: Space.xl,
  },
  skeletonHero: {
    flexDirection: 'row',
    gap: 17,
  },
  skeletonMeta: {
    flex: 1,
    minWidth: 0,
    gap: Space.sm,
    paddingTop: Space.sm,
  },
});
