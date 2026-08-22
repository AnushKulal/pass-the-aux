/**
 * A lounge: three views of one community.
 *
 * README §8. The header names it, counts it, and hands out the way in; the tabs
 * split it into SESSIONS (what is playing), CHAT (what everyone is saying) and
 * MEMBERS (who is here). A non-member gets "Join to see inside" rather than an
 * error — RLS hiding the roster is not a failure, it is the door being shut.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, MoreVertical } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ListRenderItem,
  type TextStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChatComposer } from '@/components/chat/chat-composer';
import { ChatList } from '@/components/chat/chat-list';
import { LoungeMenuModal } from '@/components/lounge/lounge-menu-modal';
import { MemberRow } from '@/components/lounge/member-row';
import { SessionCard } from '@/components/lounge/session-card';
import { Screen, Skeleton, useToast } from '@/components/ui';
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
  type LoungeSessionSummary,
} from '@/features/lounges/queries';
import { supabase } from '@/lib/supabase';
import {
  Duration,
  PointerEvents,
  Radius,
  Rule,
  Space,
  TOUCH_TARGET,
  Type,
  ZIndex,
  tracking,
} from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

type LoungeTab = 'sessions' | 'chat' | 'members';

const TABS: { key: LoungeTab; label: string }[] = [
  { key: 'sessions', label: 'SESSIONS' },
  { key: 'chat', label: 'CHAT' },
  { key: 'members', label: 'MEMBERS' },
];

const CODE_SIZE = 32;
const CODE_TRACKING = tracking(CODE_SIZE, 0.14);

/** `Type.readout` hands back a readonly fontVariant tuple; TextStyle wants a mutable one. */
const readout = (size: number): TextStyle => ({
  ...Type.readout(size),
  fontVariant: ['tabular-nums'],
});

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
  const [inviteOpen, setInviteOpen] = useState(false);
  const [tab, setTab] = useState<LoungeTab>('sessions');

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
    setInviteOpen(true);
  }, []);

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

  const renderSession = useCallback<ListRenderItem<LoungeSessionSummary>>(
    ({ item }) => (
      <SessionCard
        name={item.room.name}
        hostName={item.hostName}
        listeners={item.listeners}
        isPlaying={item.room.is_playing}
        nowPlaying={item.nowPlaying}
        onPress={() => router.push(`/room/${item.room.id}`)}
      />
    ),
    [],
  );

  const memberCount = members.data?.length ?? null;
  const liveCount = sessions.data?.length ?? 0;

  const chips = useMemo(
    () => [
      {
        key: 'members',
        text: memberCount === null ? 'MEMBERS' : `${memberCount} MEMBERS`,
        live: false,
      },
      { key: 'privacy', text: lounge?.is_public ? 'PUBLIC' : 'PRIVATE', live: false },
      { key: 'live', text: liveCount > 0 ? `${liveCount} LIVE` : 'NO SESSIONS', live: liveCount > 0 },
    ],
    [lounge?.is_public, liveCount, memberCount],
  );

  return (
    <Screen padded={false}>
      {detail.isPending ? (
        <DetailSkeleton onBack={handleBack} />
      ) : detail.isError ? (
        <Marker
          kicker="NO ANSWER"
          title="Could not load this lounge"
          body={loungeErrorMessage(detail.error, 'Check your connection and try again.')}
          onBack={handleBack}
          actions={
            <ActionCell label="TRY AGAIN" tone="accentOutline" onPress={() => void detail.refetch()} />
          }
        />
      ) : !lounge ? (
        /*
          RLS hid the row. Either the lounge is private and we are not a member,
          or it no longer exists — indistinguishable from here, so the copy
          covers both without accusing the user of a bad link.
        */
        <Marker
          kicker="NOT A MEMBER"
          title="Join to see inside"
          body="This lounge is private, or it no longer exists. Redeem its invite code to get in."
          onBack={handleBack}
          actions={
            <ActionCell
              label="ENTER AN INVITE CODE"
              tone="accentOutline"
              onPress={() => router.replace('/explore')}
            />
          }
        />
      ) : !isMember ? (
        <Marker
          kicker="NOT A MEMBER"
          title="Join to see inside"
          body={
            lounge.description ||
            'Sessions, chat and the member list are only visible to members. Find it in Explore, or enter its 8-character invite code.'
          }
          onBack={handleBack}
          actions={
            <>
              <ActionCell
                label={`JOIN ${lounge.name.toUpperCase()}`}
                tone="accent"
                busy={join.isPending}
                onPress={handleJoin}
              />
              <ActionCell
                label="FIND A LOUNGE"
                tone="accentOutline"
                onPress={() => router.replace('/explore')}
              />
            </>
          }
        />
      ) : (
        <View style={styles.fill}>
          {/* ---------------------------------------------------- header */}
          <View style={styles.header}>
            <View style={styles.headerRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Go back"
                onPress={handleBack}
                style={({ pressed }) => [styles.iconTarget, styles.backTarget, pressed && styles.dim]}>
                <ArrowLeft size={20} color={C.ink} strokeWidth={2} />
              </Pressable>

              <View style={styles.headerText}>
                <Text numberOfLines={1} style={[styles.loungeName, { color: C.ink }]}>
                  {lounge.name}
                </Text>

                <View style={styles.chips}>
                  {chips.map((chip) => (
                    <Text
                      key={chip.key}
                      style={[
                        chip.live ? styles.chipLive : styles.chip,
                        { color: chip.live ? C.liveText : C.ink3 },
                      ]}>
                      {chip.text}
                    </Text>
                  ))}
                </View>
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Invite people"
                onPress={openInvite}
                style={({ pressed }) => [
                  styles.invite,
                  { borderColor: pressed ? C.live : C.rule3 },
                ]}>
                <Text style={[styles.inviteLabel, { color: C.ink }]}>INVITE</Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="More options"
                onPress={() => setMenuOpen(true)}
                style={({ pressed }) => [styles.iconTarget, pressed && styles.dim]}>
                <MoreVertical size={19} color={C.ink2} strokeWidth={2} />
              </Pressable>
            </View>

            {/*
              The tabs' own bottom borders ARE the header's 2px section rule —
              the active cell simply paints its segment accent. Nothing is
              absolutely positioned, so nothing can be clipped on Android.
            */}
            <View accessibilityRole="tablist" style={styles.tabsRow}>
              <View style={[styles.tabEdge, { borderBottomColor: C.rule }]} />
              {TABS.map((entry, index) => {
                const active = tab === entry.key;
                return (
                  <View key={entry.key} style={styles.tabWrap}>
                    {/* 8px of dead rule between adjacent 44px targets, per the
                        touch-target floor — the rule itself never breaks. */}
                    {index > 0 ? (
                      <View style={[styles.tabGap, { borderBottomColor: C.rule }]} />
                    ) : null}
                    <Pressable
                      accessibilityRole="tab"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={entry.label}
                      onPress={() => setTab(entry.key)}
                      style={[styles.tab, { borderBottomColor: active ? C.live : C.rule }]}>
                      <Text style={[styles.tabLabel, { color: active ? C.ink : C.ink2 }]}>
                        {entry.label}
                      </Text>
                    </Pressable>
                  </View>
                );
              })}
              <View style={[styles.tabFill, { borderBottomColor: C.rule }]} />
            </View>
          </View>

          {/* ---------------------------------------------------- panels */}
          <Panel key={tab}>
            {tab === 'sessions' ? (
              <FlatList
                data={sessions.data ?? []}
                keyExtractor={sessionKey}
                renderItem={renderSession}
                style={styles.fill}
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={false}
                ListEmptyComponent={
                  sessions.isPending ? (
                    <View style={styles.blockSkeletons}>
                      <Skeleton width="100%" height={88} radius={Radius} />
                      <Skeleton width="100%" height={88} radius={Radius} />
                    </View>
                  ) : (
                    <View style={styles.emptyBlock}>
                      <Text style={[styles.emptyKicker, { color: C.ink3 }]}>NO SESSIONS</Text>
                      <Text style={[styles.emptyTitle, { color: C.ink }]}>
                        Nobody is on aux right now
                      </Text>
                      <Text style={[styles.note, { color: C.ink2 }]}>
                        Start a Session and pick the first track.
                      </Text>
                    </View>
                  )
                }
                ListFooterComponent={
                  <View style={styles.footerBlock}>
                    <ActionCell
                      label="START A SESSION"
                      tone="accentOutline"
                      busy={startSession.isPending}
                      onPress={handleStartSession}
                    />
                    <Text style={[styles.note, { color: C.ink3 }]}>
                      Anyone in this lounge can start one. You&apos;ll be on aux.
                    </Text>
                  </View>
                }
              />
            ) : tab === 'chat' ? (
              /*
                ChatList and ChatComposer are mounted directly rather than
                through `LoungeChat` so the log can hand every avatar and name
                a profile target — the wrapper has no prop for it. Mounted only
                while selected: the subscription's SUBSCRIBED handler replays
                whatever landed while it was torn down.
              */
              <View style={styles.fill}>
                <ChatList
                  loungeId={loungeId}
                  roomId={null}
                  emptyTitle="No messages yet"
                  emptyDescription="This is the lounge — say hello, or drop a track everyone should hear."
                  onOpenProfile={openProfile}
                />
                <ChatComposer
                  loungeId={loungeId}
                  roomId={null}
                  placeholder={`Message ${lounge.name}`}
                />
              </View>
            ) : (
              <FlatList
                data={members.data ?? []}
                keyExtractor={memberKey}
                renderItem={renderMember}
                style={styles.fill}
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={false}
                ListEmptyComponent={
                  members.isPending ? (
                    <View style={styles.blockSkeletons}>
                      <Skeleton width="100%" height={56} radius={Radius} />
                      <Skeleton width="100%" height={56} radius={Radius} />
                      <Skeleton width="100%" height={56} radius={Radius} />
                    </View>
                  ) : (
                    <View style={styles.emptyBlock}>
                      <Text style={[styles.emptyKicker, { color: C.ink3 }]}>EMPTY</Text>
                      <Text style={[styles.emptyTitle, { color: C.ink }]}>No members listed</Text>
                    </View>
                  )
                }
                ListFooterComponent={
                  <View style={styles.footerBlock}>
                    <Text style={[styles.note, { color: C.ink3 }]}>
                      Roles are enforced in the database, not the app.
                    </Text>
                  </View>
                }
              />
            )}
          </Panel>
        </View>
      )}

      <LoungeMenuModal
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
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

      <InviteSheet
        visible={inviteOpen && lounge !== null}
        loungeName={lounge?.name ?? ''}
        code={lounge?.invite_code ?? ''}
        onClose={() => setInviteOpen(false)}
        onShare={() => void handleShare()}
      />
    </Screen>
  );
}

function memberKey(item: LoungeMemberEntry): string {
  return item.userId;
}

function sessionKey(item: LoungeSessionSummary): string {
  return item.room.id;
}

/* ------------------------------------------------------------------ parts */

/**
 * Every screen, tab and mode enters with translateY(8px) → 0 plus a fade over
 * 280ms, and collapses to nothing under reduced motion. Re-keying this on the
 * active tab is what replays it per panel.
 */
function Panel({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();
  const t = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (reduced) {
      t.value = 1;
      return;
    }
    t.value = withTiming(1, { duration: Duration.enter });
  }, [reduced, t]);

  const style = useAnimatedStyle(() => ({
    opacity: t.value,
    transform: [{ translateY: (1 - t.value) * 8 }],
  }));

  return <Animated.View style={[styles.fill, style]}>{children}</Animated.View>;
}

type Tone = 'accent' | 'accentOutline' | 'outline';

/**
 * A flat action cell: no radius, no shadow, 48px tall, label in the heading
 * weight. `accent` fills, `accentOutline` borders — the artboard reserves the
 * fill for the single most consequential action on any given screen.
 */
function ActionCell({
  label,
  tone,
  onPress,
  busy = false,
  disabled = false,
}: {
  label: string;
  tone: Tone;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
}) {
  const C = useColors();
  const blocked = busy || disabled;

  const fill = tone === 'accent';
  const border = tone === 'accent' ? 'transparent' : tone === 'accentOutline' ? C.live : C.rule2;
  const ink = fill ? C.onLive : tone === 'accentOutline' ? C.liveText : C.ink;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: blocked, busy }}
      disabled={blocked}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionCell,
        {
          borderColor: border,
          backgroundColor: fill
            ? pressed
              ? C.liveText
              : C.live
            : pressed
              ? C.liveWash
              : 'transparent',
        },
        blocked && styles.dim,
      ]}>
      {busy ? <ActivityIndicator size="small" color={ink} /> : null}
      <Text numberOfLines={1} style={[styles.actionLabel, { color: ink }]}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * The full-screen states: a kicker, a display line, a paragraph and whatever
 * you can do about it. Left-aligned rather than centred — this direction has no
 * centred illustrations, and a left column keeps the same measure as the rest
 * of the app.
 */
function Marker({
  kicker,
  title,
  body,
  actions,
  onBack,
}: {
  kicker: string;
  title: string;
  body: string;
  actions?: ReactNode;
  onBack: () => void;
}) {
  const C = useColors();

  return (
    <View style={styles.fill}>
      <View style={styles.markerBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={onBack}
          style={({ pressed }) => [styles.iconTarget, styles.backTarget, pressed && styles.dim]}>
          <ArrowLeft size={20} color={C.ink} strokeWidth={2} />
        </Pressable>
      </View>

      <View style={styles.markerBody}>
        <Text style={[styles.emptyKicker, { color: C.ink3 }]}>{kicker}</Text>
        <Text style={[styles.markerTitle, { color: C.ink }]}>{title}</Text>
        <Text style={[styles.markerText, { color: C.ink2 }]}>{body}</Text>
        {actions ? <View style={styles.markerActions}>{actions}</View> : null}
      </View>
    </View>
  );
}

/**
 * The invite code, on its own, in a 2px accent frame.
 *
 * This is the clearest readout moment in the app: a community starts as eight
 * characters somebody reads out over a room, so they get the extrabold face at
 * 32px, tabular figures and .14em of tracking. Accent is exactly right here —
 * a code is *joinable*.
 */
function InviteSheet({
  visible,
  loungeName,
  code,
  onClose,
  onShare,
}: {
  visible: boolean;
  loungeName: string;
  code: string;
  onClose: () => void;
  onShare: () => void;
}) {
  const C = useColors();
  const insets = useSafeAreaInsets();

  const reduced = useReducedMotion();
  const rise = useSharedValue(0);

  useEffect(() => {
    if (reduced) {
      rise.value = visible ? 1 : 0;
      return;
    }
    rise.value = withTiming(visible ? 1 : 0, {
      duration: visible ? Duration.sheet : Duration.scrim,
    });
  }, [visible, reduced, rise]);

  const sheetStyle = useAnimatedStyle(() => ({
    opacity: rise.value,
    transform: [{ translateY: (1 - rise.value) * 16 }],
  }));

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        onPress={onClose}
        style={[styles.scrim, { backgroundColor: C.scrim }]}
      />

      <View style={[styles.sheetDock, PointerEvents.boxNone]}>
        <Animated.View
          style={[
            styles.sheet,
            { backgroundColor: C.bg, borderTopColor: C.live, paddingBottom: insets.bottom },
            sheetStyle,
          ]}>
          <View style={[styles.sheetHead, { borderBottomColor: C.rule }]}>
            <Text style={[styles.sheetTitle, { color: C.ink }]}>INVITE CODE</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onClose}
              style={({ pressed }) => [styles.sheetClose, pressed && styles.dim]}>
              <Text style={[styles.sheetCloseLabel, { color: C.ink2 }]}>CLOSE</Text>
            </Pressable>
          </View>

          <View style={styles.sheetBody}>
            <Text style={[styles.markerText, { color: C.ink2 }]}>
              Eight characters. Anyone with it can join {loungeName} — public or not.
            </Text>

            <View style={[styles.codeFrame, { borderColor: C.live }]}>
              <Text selectable style={[styles.code, { color: C.liveText }]}>
                {code}
              </Text>
            </View>

            <ActionCell label="SHARE INVITE CODE" tone="accent" onPress={onShare} />
            <Text style={[styles.note, { color: C.ink3 }]}>
              {Platform.OS === 'web'
                ? 'Copies the code to your clipboard.'
                : 'Opens your share sheet with the code in the message.'}
            </Text>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

/** Carries its own back target: a lounge that never answers must still be exitable. */
function DetailSkeleton({ onBack }: { onBack: () => void }) {
  const C = useColors();

  return (
    <View style={styles.fill}>
      <View style={styles.markerBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={onBack}
          style={({ pressed }) => [styles.iconTarget, styles.backTarget, pressed && styles.dim]}>
          <ArrowLeft size={20} color={C.ink} strokeWidth={2} />
        </Pressable>
      </View>

      <View accessibilityLabel="Loading this lounge" style={styles.detailSkeleton}>
        <Skeleton width="60%" height={26} radius={Radius} />
        <Skeleton width="40%" height={12} radius={Radius} />
        <Skeleton width="100%" height={Rule.major} radius={Radius} />
        <Skeleton width="100%" height={88} radius={Radius} />
        <Skeleton width="100%" height={88} radius={Radius} />
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

  /* header */
  header: {
    paddingTop: 13,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Space.sm,
    paddingHorizontal: Space.md,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
    // Optically drops the name onto the same line as the 44px back target.
    paddingTop: Space.sm,
  },
  loungeName: {
    ...Type.display(20),
    letterSpacing: tracking(20, -0.015),
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: Space.xs,
  },
  chip: {
    ...Type.label(10),
  },
  chipLive: {
    // The only accent in the header, and only when something is actually live.
    ...Type.heading(10),
    letterSpacing: tracking(10, 0.09),
  },
  iconTarget: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backTarget: {
    // Pulls the arrow's optical centre back onto the 12px gutter line.
    marginLeft: -Space.md,
  },
  invite: {
    minHeight: TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: Space.md,
    borderWidth: Rule.hair,
  },
  inviteLabel: {
    ...Type.heading(10),
    letterSpacing: tracking(10, 0.09),
  },

  /* tabs */
  tabsRow: {
    flexDirection: 'row',
    marginTop: Space.md,
  },
  tabWrap: {
    flexDirection: 'row',
  },
  tabGap: {
    width: Space.sm,
    borderBottomWidth: Rule.major,
  },
  tab: {
    minHeight: TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: Space.md,
    borderBottomWidth: Rule.major,
  },
  tabLabel: {
    ...Type.heading(11),
    letterSpacing: tracking(11, 0.1),
  },
  tabEdge: {
    width: Space.md,
    borderBottomWidth: Rule.major,
  },
  tabFill: {
    flex: 1,
    borderBottomWidth: Rule.major,
  },

  /* lists */
  listContent: {
    flexGrow: 1,
    paddingBottom: Space.xxl,
  },
  blockSkeletons: {
    gap: Rule.hair,
  },
  emptyBlock: {
    paddingHorizontal: Space.md,
    paddingTop: Space.xxl,
    gap: Space.sm,
  },
  emptyKicker: {
    ...Type.label(10),
  },
  emptyTitle: {
    ...Type.display(22),
  },
  footerBlock: {
    paddingHorizontal: Space.md,
    paddingTop: Space.xl,
    gap: Space.md,
  },
  note: {
    ...Type.body(12),
  },

  /* actions */
  actionCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    minHeight: 48,
    paddingHorizontal: Space.lg,
    borderWidth: Rule.hair,
  },
  actionLabel: {
    ...Type.heading(11),
    letterSpacing: tracking(11, 0.1),
  },

  /* markers */
  markerBar: {
    paddingTop: 13,
    paddingHorizontal: Space.md,
    flexDirection: 'row',
  },
  markerBody: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Space.md,
    paddingBottom: Space.huge,
    gap: Space.sm,
  },
  markerTitle: {
    ...Type.display(24),
  },
  markerText: {
    ...Type.body(14),
  },
  markerActions: {
    marginTop: Space.md,
    gap: Space.sm,
    alignSelf: 'stretch',
  },

  /* invite sheet */
  scrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  sheetDock: {
    flex: 1,
    justifyContent: 'flex-end',
    zIndex: ZIndex.sheet,
  },
  sheet: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    borderTopWidth: Rule.major,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: Space.md,
    paddingRight: Space.xs,
    paddingTop: Space.md,
    paddingBottom: Space.sm + 2,
    borderBottomWidth: Rule.major,
  },
  sheetTitle: {
    ...Type.heading(15),
    letterSpacing: tracking(15, 0.03),
    flex: 1,
  },
  sheetClose: {
    minHeight: TOUCH_TARGET,
    minWidth: TOUCH_TARGET,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingHorizontal: Space.xs,
  },
  sheetCloseLabel: {
    ...Type.heading(10),
    letterSpacing: tracking(10, 0.1),
  },
  sheetBody: {
    padding: Space.md,
    paddingTop: Space.xxl,
    paddingBottom: Space.xxl,
    gap: Space.md,
  },
  codeFrame: {
    borderWidth: Rule.major,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.xl,
  },
  code: {
    ...readout(CODE_SIZE),
    letterSpacing: CODE_TRACKING,
    // Tracking leaves a gap after the last glyph; pulling it back keeps the
    // string flush against the frame as drawn.
    marginRight: -CODE_TRACKING,
  },

  detailSkeleton: {
    padding: Space.md,
    paddingTop: Space.xl,
    gap: Space.md,
  },
});
