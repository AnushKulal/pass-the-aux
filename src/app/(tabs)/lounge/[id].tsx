/**
 * A lounge, from the inside.
 *
 * Built from design/nocturne/aux-nocturne.dc.html, `isLounge` L414-522: the
 * closed door at L415-424, the member view at L426-521, and the invite sheet at
 * L1478-1490.
 *
 * THE SHAPE CHANGED, AND THAT IS THE POINT OF THIS PASS. The old screen was one
 * scroller — hero tile, Start button, a "Chat" row that opened a sheet, live
 * Sessions, then the roster — which gave the roster the whole page and hid the
 * lounge log behind a tap. Nocturne splits it into three segments (L433-436):
 * Sessions, Chat, Members. Chat stops being a sheet and becomes a destination
 * visible from the header, which is what the log needed — it is the only room a
 * lounge has when nobody is on aux.
 *
 * NOTHING WAS DROPPED; four things moved:
 *   the lounge log   -> the Chat segment, mounted inline with its composer
 *   the invite code  -> its own sheet (L1478), off the header's person-plus
 *                       circle. The old header chip could only fire the OS
 *                       share sheet; it could never show you the code
 *   the description  -> a quiet line above the Sessions list, the segment you
 *                       land on. The design's header row has no space for it
 *   your role        -> the `···` sheet, which already prints "YOU ARE OWNER",
 *                       and the OWNER / MOD badge on your own row in Members
 *
 * THE SESSION CARD AND THE MEMBER ROW ARE IMPORTED, and this paragraph used to
 * say the opposite. It claimed `@/components/lounge/session-card` and
 * `.../member-row` were "Patchbay-era — square, radius-free", spending the
 * accent on a blue OWNER fill and a coral `IN` cell, and on that basis this file
 * drew private `SessionCell` and `MemberCell` copies instead.
 *
 * THE CLAIM WAS FALSE. Both components had already been rebuilt for Nocturne:
 * `member-row` cites L502-L515 and its header records fixing the very blue-OWNER
 * bug the claim accused it of, `session-card` cites L438-455 and calls itself
 * "the accent rule in one object", and every badge in both is a full pill. So
 * the app shipped two member rows and two session cards with one of each ever
 * reaching a screen, and the shared pair drifted where nobody could see it.
 *
 * The duplicates are gone. What they had and the shared components did not has
 * moved across; what the shared components have and they did not arrives with
 * them — the kit's punched presence dot instead of a hand-pinned disc, and two
 * props this screen has no use for yet but the next caller will: `syncLabel`
 * for a drift readout, and `solid` for a Session card nested in another surface.
 *
 * THE ACCENT RULE, which decides every colour on this screen: coral is STATE
 * (live, on aux, PREMIUM, OWNER, joinable), blue is ACTION (start, play, send,
 * copy, the selected segment). A live Session card names itself in coral and
 * carries a blue play puck; neither element is ever painted in both.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BlurView } from 'expo-blur';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Copy, MoreHorizontal, Share2, UserRoundPlus, X } from 'lucide-react-native';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ListRenderItem,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useEnterStyle } from '@/components/auth/onboarding';
import { ChatNotice } from '@/components/chat/bubble-kit';
import { ChatComposer } from '@/components/chat/chat-composer';
import { ChatList } from '@/components/chat/chat-list';
import { LoungeMenuModal } from '@/components/lounge/lounge-menu-modal';
import { MemberRow } from '@/components/lounge/member-row';
import { SessionCard } from '@/components/lounge/session-card';
import {
  AuxButton,
  CircleIconButton,
  GlassCard,
  PillButton,
  Screen,
  SheetTabs,
  Skeleton,
  useToast,
} from '@/components/ui';
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
import { useDockReserve, useDockReserveLess } from '@/lib/dock';
import { supabase } from '@/lib/supabase';
import {
  Duration,
  Fonts,
  Radii,
  Rule,
  Space,
  Type,
  ZIndex,
  raised,
  sheetShadow,
  tracking,
} from '@/lib/theme';
import { useColors, useTheme } from '@/lib/theme-context';

/**
 * The design's screen gutter, and `Space` has no step for it — `lg` is 16 and
 * `xl` is 20. Every artboard body says 18. `@/components/ui/screen` holds the
 * same constant for the same reason; both disappear the day `Space.gutter`
 * lands in the token layer.
 */
const GUTTER = 18;

/**
 * The design's card corner. Also absent from `Radii` (`xl` is 22, `xxl` is 28)
 * and also held locally by `GlassCard` — this file needs it for the two
 * surfaces it builds by hand, the members panel and the invite sheet's plate.
 */
const CARD_RADIUS = 24;

/**
 * A Session card's resting height, for the placeholder that stands in for one:
 * 15px padding twice, the 15px name line, the artboard's 12px gap and the 52px
 * artwork well. Measured rather than guessed, because a skeleton that is the
 * wrong height makes the swap visible as a jump.
 *
 * The geometry it measures now lives in `@/components/lounge/session-card`
 * (`CARD_PADDING`, `WELL`), not here — if that card's padding or well moves,
 * this number has to follow it.
 */
const SESSION_CARD_H = 110;
/** L1481: the invite sheet's corner, rounder than a card on purpose. */
const SHEET_RADIUS = 30;

type LoungeTab = 'sessions' | 'chat' | 'members';

/** L433-436. Sentence case, not shouted — `SheetTabs` prints whatever it is given. */
const TABS = [
  { key: 'sessions', label: 'Sessions' },
  { key: 'chat', label: 'Chat' },
  { key: 'members', label: 'Members' },
];

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

/**
 * Is the soft keyboard up?
 *
 * The Chat segment needs this and no other screen does. The lounge sits inside
 * `(tabs)`, so the floating nav capsule hovers over its bottom edge and the
 * composer has to be lifted `useDockReserve()` clear of it — but the moment the
 * keyboard opens it covers the capsule entirely, and a composer still holding
 * that much clearance would float in the middle of the screen. So the lift is
 * conditional, and this is the condition.
 *
 * `will*` on iOS so the lift collapses in step with the keyboard's own
 * animation rather than a frame behind it; Android only emits `did*`.
 * On react-native-web neither fires, which is correct — there is no overlay
 * keyboard there and the lift should simply stay.
 */
function useKeyboardUp(): boolean {
  const [up, setUp] = useState(false);

  useEffect(() => {
    const ios = Platform.OS === 'ios';
    const show = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', () =>
      setUp(true),
    );
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () =>
      setUp(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return up;
}

/*
  No `useColors()` here on purpose: this component now owns state and wiring
  only, and every painted surface below is its own memoised part. Reading the
  palette at this level would re-render the whole screen — header, roster and
  live log — on a theme change that only the leaves care about.
*/
export default function LoungeDetailScreen() {
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

  const openMenu = useCallback(() => setMenuOpen(true), []);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const openInvite = useCallback(() => setInviteOpen(true), []);
  const closeInvite = useCallback(() => setInviteOpen(false), []);

  /**
   * The `···` sheet's "Invite people" row now opens the invite sheet instead of
   * firing the share sheet straight from a menu — two modals in a row read as a
   * bug, and the code itself was never shown either way.
   */
  const inviteFromMenu = useCallback(() => {
    setMenuOpen(false);
    setInviteOpen(true);
  }, []);

  const onTab = useCallback((key: string) => {
    if (key === 'sessions' || key === 'chat' || key === 'members') setTab(key);
  }, []);

  const memberCount = members.data?.length ?? null;
  const liveSessions = useMemo(() => sessions.data ?? [], [sessions.data]);

  const openSession = useCallback((roomId: string) => router.push(`/room/${roomId}`), []);

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

  return (
    /*
      `ground={false}`: the ambient blobs are mounted once behind the navigator,
      and every card on this screen is 5.5% white — an opaque screen background
      would leave them nothing to bleed through, which is the whole material.
    */
    <Screen padded={false} ground={false}>
      {detail.isPending ? (
        <DetailSkeleton onBack={handleBack} />
      ) : detail.isError ? (
        <Marker
          kicker="COULD NOT LOAD"
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
          kicker="NOT A MEMBER"
          title="Join to see inside"
          body="This lounge is private, or it no longer exists. Find it in Explore, or enter its 8-character invite code."
          onBack={handleBack}
          actionLabel="Find a lounge"
          onAction={() => router.replace('/explore')}
        />
      ) : !isMember ? (
        <Marker
          kicker="NOT A MEMBER"
          title="Join to see inside"
          body={
            lounge.description ||
            'Sessions, chat and the member list are only visible to members.'
          }
          onBack={handleBack}
          actionLabel={`Join ${lounge.name}`}
          busy={join.isPending}
          onAction={handleJoin}
        />
      ) : (
        <>
          <LoungeHeader
            name={lounge.name}
            memberCount={memberCount}
            isPublic={lounge.is_public}
            liveCount={liveSessions.length}
            onBack={handleBack}
            onInvite={openInvite}
            onMenu={openMenu}
          />

          <View style={styles.tabsSlot}>
            <SheetTabs tabs={TABS} active={tab} onChange={onTab} variant="segmented" />
          </View>

          {tab === 'sessions' ? (
            <SessionsTab
              description={lounge.description}
              sessions={liveSessions}
              isPending={sessions.isPending}
              isError={sessions.isError}
              onRetry={() => void sessions.refetch()}
              onOpen={openSession}
              onStart={handleStartSession}
              starting={startSession.isPending}
            />
          ) : tab === 'chat' ? (
            <ChatTab loungeId={loungeId} loungeName={lounge.name} onOpenProfile={openProfile} />
          ) : (
            <MembersTab
              data={members.data ?? []}
              renderItem={renderMember}
              isPending={members.isPending}
              isError={members.isError}
              onRetry={() => void members.refetch()}
              onInvite={openInvite}
            />
          )}
        </>
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
        onInvite={inviteFromMenu}
        onDelete={isOwner ? handleDelete : undefined}
        isDeleting={remove.isPending}
      />

      <InviteSheet
        visible={inviteOpen && lounge !== null}
        loungeName={lounge?.name ?? ''}
        code={lounge?.invite_code ?? ''}
        onClose={closeInvite}
        onShare={shareInvite}
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

/*
  `initialFor` and `sinceLabel` used to live here, as third and second copies of
  the artwork monogram and the `since Mar 2025` formatter. They went with the
  duplicated cells that were their only callers; `session-card.tsx` and
  `member-row.tsx` each carry the one that belongs to them.
*/

/* ----------------------------------------------------------------- header */

/**
 * L427-431: a back circle, the name over one line of counts, then invite and
 * `···`. No lounge tile and no description — the design gives this row 12px of
 * padding and nothing else, because the segmented control directly beneath it
 * is what the eye is meant to land on.
 */
const LoungeHeader = memo(function LoungeHeader({
  name,
  memberCount,
  isPublic,
  liveCount,
  onBack,
  onInvite,
  onMenu,
}: {
  name: string;
  memberCount: number | null;
  isPublic: boolean;
  liveCount: number;
  onBack: () => void;
  onInvite: () => void;
  onMenu: () => void;
}) {
  const C = useColors();

  const head = [
    memberCount === null ? null : `${memberCount} member${memberCount === 1 ? '' : 's'}`,
    isPublic ? 'Public' : 'Invite only',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={styles.header}>
      <CircleIconButton icon={ArrowLeft} accessibilityLabel="Go back" onPress={onBack} />

      <View style={styles.headerText}>
        <Text numberOfLines={1} style={[styles.headerTitle, { color: C.ink }]}>
          {name}
        </Text>
        {/*
          The live count is the one coloured span in the row. Coral, because a
          running Session is state — the same claim the pulsing dot on the card
          below makes, and the reason the count is not simply appended to the
          grey string.
        */}
        <Text numberOfLines={1} style={[styles.headerMeta, { color: C.ink3 }]}>
          {head}
          {liveCount > 0 ? (
            <Text style={{ color: C.liveText }}>{` · ${liveCount} live`}</Text>
          ) : null}
        </Text>
      </View>

      <CircleIconButton
        icon={UserRoundPlus}
        accessibilityLabel="Show the invite code"
        onPress={onInvite}
      />
      <CircleIconButton icon={MoreHorizontal} accessibilityLabel="More options" onPress={onMenu} />
    </View>
  );
});

/* --------------------------------------------------------------- sessions */

/**
 * L440-462. Live Sessions, then the card that starts one.
 *
 * A ScrollView rather than a FlatList: `fetchLoungeSessions` returns only the
 * rooms with `is_active`, which is a handful even in a busy lounge, and the
 * "Start a Session" card has to sit after the last one rather than float as a
 * footer.
 */
function SessionsTab({
  description,
  sessions,
  isPending,
  isError,
  onRetry,
  onOpen,
  onStart,
  starting,
}: {
  description: string;
  sessions: LoungeSessionSummary[];
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  onOpen: (roomId: string) => void;
  onStart: () => void;
  starting: boolean;
}) {
  const C = useColors();
  const dockReserve = useDockReserve();
  const enter = useEnterStyle();

  return (
    <Animated.View style={[styles.fill, enter]}>
      <ScrollView
        style={styles.fill}
        contentContainerStyle={[
          styles.tabBody,
          /*
            The nav capsule floats and takes no layout space, so the last card
            would otherwise sit underneath it. Inline rather than a StyleSheet
            entry because `useDockReserve()` folds in the device's bottom inset
            and a static object cannot carry that — this used to be
            `Dock.reserve + insets.bottom`, spelled out by hand, which is the
            addition nine of ten callers forgot.
          */
          { paddingBottom: dockReserve },
        ]}
        showsVerticalScrollIndicator={false}>
        {/*
          The lounge's own blurb, which the design's header row has nowhere to
          put. It goes on the landing segment and is capped at two lines: it
          explains the room once, it is not the room.
        */}
        {description ? (
          <Text numberOfLines={2} style={[styles.blurb, { color: C.ink2 }]}>
            {description}
          </Text>
        ) : null}

        {isPending ? (
          <>
            <Skeleton width="100%" height={SESSION_CARD_H} radius={CARD_RADIUS} />
            <Skeleton width="100%" height={SESSION_CARD_H} radius={CARD_RADIUS} />
          </>
        ) : isError ? (
          <ChatNotice label="Sessions didn't load." action={{ label: 'Retry', onPress: onRetry }} />
        ) : sessions.length === 0 ? (
          <Text style={[styles.quiet, { color: C.ink2 }]}>
            Nobody is on aux. Start one below.
          </Text>
        ) : (
          sessions.map((entry) => (
            <SessionCard
              key={sessionKey(entry)}
              name={entry.room.name}
              hostName={entry.hostName}
              listeners={entry.listeners}
              isPlaying={entry.room.is_playing}
              nowPlaying={entry.nowPlaying}
              /*
                No `solid`: these cards sit on the screen ground, which is the
                ambient blobs rather than another surface, so 5.5% white has
                something to sit on. The prop is for a Session card nested in a
                card or laid over artwork — neither happens here.

                The bound arrow does cost `SessionCard`'s `memo`, and that is
                fine HERE and only here: `fetchLoungeSessions` returns the
                active rooms alone, which is the same handful that makes this a
                ScrollView rather than a FlatList.
              */
              onPress={() => onOpen(entry.room.id)}
            />
          ))
        )}

        {/* L456-459: the CTA lives inside a card with its own footnote, not as a
            bare button on the ground. */}
        <GlassCard>
          <PillButton label="Start a Session" loading={starting} onPress={onStart} />
          <Text style={[styles.cardNote, { color: C.ink3 }]}>
            Anyone in this Lounge can start one. You&apos;ll be on aux.
          </Text>
        </GlassCard>
      </ScrollView>
    </Animated.View>
  );
}

/* ------------------------------------------------------------------- chat */

/**
 * L465-497 — the lounge log, now a segment rather than a sheet.
 *
 * `ChatList` and `ChatComposer` are mounted directly rather than through
 * `LoungeChat` so the log can hand every avatar and name a profile target; the
 * wrapper has no prop for it. Mounted only while this segment is selected: the
 * subscription's SUBSCRIBED handler replays whatever landed while it was torn
 * down, so leaving the segment costs nothing.
 *
 * THE COMPOSER IS LIFTED, and this is the one place the design and this app
 * genuinely disagree. The artboard pads the chat body `0 18px 12px` and sits
 * the composer flush against the frame — it can, because its lounge chat hides
 * the floating nav. Ours cannot: the nav belongs to `(tabs)` and hovers over
 * every screen in the group, so the composer clears it by `useDockReserve()`
 * and gives that clearance back the moment the keyboard covers the capsule
 * anyway.
 */
function ChatTab({
  loungeId,
  loungeName,
  onOpenProfile,
}: {
  loungeId: string;
  loungeName: string;
  onOpenProfile: (userId: string) => void;
}) {
  const enter = useEnterStyle();
  const keyboardUp = useKeyboardUp();

  /*
    `ChatComposer` adds `Space.md` of its own under whatever it is handed, so
    the reservation is passed minus that step — the bar's content then ends
    exactly one dock reserve off the bottom, 16px clear of the capsule's top
    edge. That subtraction is what `useDockReserveLess` is for; it used to be
    `insets.bottom + Dock.reserve - Space.md`, spelled out by hand.

    Unconditional, because a hook cannot be. The keyboard decides whether the
    lift is APPLIED, not whether it is measured.
  */
  const clearance = useDockReserveLess(Space.md);
  const lift = keyboardUp ? 0 : clearance;

  return (
    <Animated.View style={[styles.fill, enter]}>
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
        bottomInset={lift}
      />
    </Animated.View>
  );
}

/* ---------------------------------------------------------------- members */

/**
 * L499-521: one card of hairline-separated rows, then a footnote about where
 * roles are actually enforced.
 *
 * The card is a shell around a FlatList rather than a `contentContainerStyle`
 * skin, for two reasons. `fetchLoungeMembers` has no limit, so the roster stays
 * virtualised; and the footnote has to sit OUTSIDE the card, which a footer
 * component drawn inside the content container cannot do. The cost is that the
 * panel is full height even for a lounge of three — worth it to keep the
 * footnote permanently visible rather than buried under two hundred rows.
 *
 * Shadow on the outer view, clipping on the inner one: Android clips a view's
 * own boxShadow away with `overflow: 'hidden'`, so a single view carrying both
 * silently loses its lift on one platform.
 */
function MembersTab({
  data,
  renderItem,
  isPending,
  isError,
  onRetry,
  onInvite,
}: {
  data: LoungeMemberEntry[];
  renderItem: ListRenderItem<LoungeMemberEntry>;
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  onInvite: () => void;
}) {
  const C = useColors();
  const dockReserve = useDockReserve();
  const enter = useEnterStyle();

  return (
    <Animated.View
      style={[
        styles.fill,
        styles.membersColumn,
        /*
          Inline, not a StyleSheet entry: `useDockReserve()` folds in the
          device's bottom inset, which a static object cannot carry. This is the
          panel's whole bottom edge, so under-reserving here buries the footnote
          under the nav capsule rather than merely the last row.
        */
        { paddingBottom: dockReserve },
        enter,
      ]}>
      <View style={[styles.membersShell, raised(C)]}>
        <View
          style={[styles.membersClip, { backgroundColor: C.surface, borderColor: C.rule }]}>
          <FlatList
            data={data}
            keyExtractor={memberKey}
            renderItem={renderItem}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              isPending ? (
                <View style={styles.memberSkeletons}>
                  <Skeleton width="100%" height={40} radius={Radii.pill} />
                  <Skeleton width="100%" height={40} radius={Radii.pill} />
                  <Skeleton width="100%" height={40} radius={Radii.pill} />
                </View>
              ) : isError ? (
                <View style={styles.memberNotice}>
                  <ChatNotice
                    label="The roster didn't load."
                    action={{ label: 'Retry', onPress: onRetry }}
                  />
                </View>
              ) : (
                <View style={styles.memberNotice}>
                  <ChatNotice
                    label="Only you in here so far."
                    action={{ label: 'Invite someone', onPress: onInvite }}
                  />
                </View>
              )
            }
          />
        </View>
      </View>

      <Text style={[styles.footnote, { color: C.ink3 }]}>
        Roles are enforced in the database, not the app. Owners and mods can remove members and end
        Sessions.
      </Text>
    </Animated.View>
  );
}

/* --------------------------------------------------------- invite sheet */

/**
 * The invite code — L1478-1490, drawn in the design's sheet chrome (L1161-1163).
 *
 * SHEET SHADOW, NOT `dropped()`. A sheet is lit by the page it covers, so its
 * shadow falls UPWARD onto that page; `dropped()` points down, which puts the
 * shadow off-screen underneath the panel and leaves the sheet with no edge
 * against whatever it is covering.
 *
 * The plate is CORAL and the button is BLUE, on purpose: a code is a state of
 * the lounge (it is joinable), copying it is an action. Same rule as the
 * Session card, one screen away.
 *
 * ONE ACTION WHERE THE DESIGN DRAWS TWO. The artboard offers "Copy code" and
 * "Share a link instead"; this app has one invite API, `shareInviteCode`, which
 * is a clipboard write on web and the OS share sheet on native. Two buttons
 * calling it would be the same button twice, so the label says what the
 * platform will actually do.
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
  const { scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const dark = scheme === 'dark';

  /*
    The panel rises; the scrim fades with the Modal's own `fade`. `slide` would
    have carried the scrim up from the bottom edge with it, which reads as a
    dark rectangle growing rather than as a page dimming — and the design
    animates the two separately for exactly that reason (`auxFade` on the
    scrim at L1162, `auxSheetIn` on the panel at L1163).

    Written from an effect rather than straight into the shared value: the
    compiler treats a shared value as immutable outside one, and `visible` is
    already a prop so this costs no extra render. Same shape as
    `LoungeMenuModal`, so the two sheets on this screen enter identically.
  */
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

  const panel = useAnimatedStyle(() => ({
    opacity: rise.value,
    transform: [{ translateY: (1 - rise.value) * 24 }],
  }));

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      statusBarTranslucent
      onRequestClose={onClose}>
      <View style={styles.sheetLayer}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          style={[styles.scrim, { backgroundColor: C.scrim }]}
        />

        {/*
          Shadow outside, clip inside — the BlurView needs `overflow: 'hidden'`
          to respect the 30px corner, and on Android that same property would
          throw away a shadow drawn on the clipping view.
        */}
        <Animated.View
          style={[
            styles.sheetShell,
            { marginBottom: Math.max(insets.bottom + Space.sm, Space.huge) },
            sheetShadow(C),
            panel,
          ]}>
          <BlurView
            intensity={dark ? 46 : 60}
            tint={dark ? 'dark' : 'light'}
            // Android does not blur at all without this; the tint alone would
            // leave a flat translucent slab with nothing happening behind it.
            experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
            style={[styles.sheetPanel, { borderColor: C.chromeBorder }]}>
            {/* The tint rides ON TOP of the blur. Handed to BlurView as a
                background it becomes the thing being blurred, and the panel
                reads as fog. */}
            <View style={[styles.sheetTint, { backgroundColor: C.nav }]} />

            <View style={styles.grabberSlot}>
              <View style={[styles.grabber, { backgroundColor: C.rule3 }]} />
            </View>

            <View style={styles.sheetHead}>
              <View style={styles.sheetHeadText}>
                <Text style={[styles.sheetTitle, { color: C.ink }]}>Invite code</Text>
                <Text style={[styles.sheetKicker, { color: C.ink3 }]}>
                  EIGHT CHARACTERS · WORKS EVEN IF PRIVATE
                </Text>
              </View>
              <CircleIconButton
                icon={X}
                accessibilityLabel="Close"
                tone="chip"
                onPress={onClose}
              />
            </View>

            <View style={styles.sheetBody}>
              <Text style={[styles.sheetProse, { color: C.ink2 }]}>
                Anyone with it can join {loungeName} — public or not.
              </Text>

              <Text
                accessibilityLabel={`Invite code ${code.split('').join(' ')}`}
                style={[
                  styles.codePlate,
                  { backgroundColor: C.liveWash, borderColor: C.liveMid, color: C.liveText },
                ]}>
                {code}
              </Text>

              <AuxButton
                label={Platform.OS === 'web' ? 'Copy code' : 'Share the invite'}
                variant="pri"
                icon={Platform.OS === 'web' ? Copy : Share2}
                align="center"
                fullWidth
                onPress={onShare}
              />
            </View>
          </BlurView>
        </Animated.View>
      </View>
    </Modal>
  );
}

/* --------------------------------------------------------------- markers */

/**
 * The full-screen states — L415-424: a kicker, a title, one paragraph, and the
 * single thing you can do about it, all inside one card rather than laid on the
 * ground. The card is what makes "you cannot see in here" read as a closed door
 * rather than as a failure.
 */
function Marker({
  kicker,
  title,
  body,
  onBack,
  actionLabel,
  onAction,
  busy = false,
}: {
  kicker: string;
  title: string;
  body: string;
  onBack: () => void;
  actionLabel: string;
  onAction: () => void;
  busy?: boolean;
}) {
  const C = useColors();
  const dockReserve = useDockReserve();

  return (
    <View style={styles.fill}>
      <View style={styles.markerBar}>
        <CircleIconButton icon={ArrowLeft} accessibilityLabel="Go back" onPress={onBack} />
      </View>

      {/*
        The reserve is what OFF-CENTRES this card, and it has to be inline: the
        marker is centred in the space the nav capsule leaves, and the capsule's
        height depends on the device inset. `markerBody` carried a bare
        `Dock.reserve` in the StyleSheet, which centred it against a constant and
        drifted low by exactly the inset on every phone that has one.
      */}
      <View style={[styles.markerBody, { paddingBottom: dockReserve }]}>
        <GlassCard padded={false} style={styles.markerCard}>
          <Text style={[styles.markerKicker, { color: C.ink3 }]}>{kicker}</Text>
          <Text accessibilityRole="header" style={[styles.markerTitle, { color: C.ink }]}>
            {title}
          </Text>
          <Text style={[styles.markerProse, { color: C.ink2 }]}>{body}</Text>
          <View style={styles.markerAction}>
            <AuxButton label={actionLabel} variant="pri" loading={busy} onPress={onAction} />
          </View>
        </GlassCard>
      </View>
    </View>
  );
}

/** Carries its own back target: a lounge that never answers must still be exitable. */
function DetailSkeleton({ onBack }: { onBack: () => void }) {
  const dockReserve = useDockReserve();

  return (
    <View style={styles.fill}>
      <View style={styles.markerBar}>
        <CircleIconButton icon={ArrowLeft} accessibilityLabel="Go back" onPress={onBack} />
      </View>

      {/* The real geometry, so nothing pops when it resolves: the tab track,
          then two Session cards. The reserve is inline for the same reason it is
          everywhere else on this screen — it carries the device's bottom inset,
          which no StyleSheet entry can. */}
      <View
        accessibilityLabel="Loading this lounge"
        style={[styles.detailSkeleton, { paddingBottom: dockReserve }]}>
        <Skeleton width="62%" height={22} radius={Radii.sm} />
        <Skeleton width="100%" height={54} radius={Radii.pill} />
        <Skeleton width="100%" height={SESSION_CARD_H} radius={CARD_RADIUS} />
        <Skeleton width="100%" height={SESSION_CARD_H} radius={CARD_RADIUS} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  /* header — L427 `padding:12px 18px 12px`, `gap:12` */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingHorizontal: GUTTER,
    paddingVertical: Space.md,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    ...Type.display(19),
    letterSpacing: tracking(19, -0.02),
  },
  headerMeta: {
    ...Type.body(11),
    lineHeight: 14,
    letterSpacing: tracking(11, 0.05),
    marginTop: 2,
  },

  /* the segmented control — L432 `padding:2px 18px 12px` */
  tabsSlot: {
    paddingHorizontal: GUTTER,
    paddingTop: 2,
    paddingBottom: Space.md,
  },

  /* sessions — L440 `padding:0 18px 130px;gap:12` */
  tabBody: {
    paddingHorizontal: GUTTER,
    gap: Space.md,
  },
  blurb: {
    ...Type.body(13),
    lineHeight: 19,
  },
  quiet: {
    ...Type.body(13.5),
    paddingVertical: Space.sm,
  },
  cardNote: {
    ...Type.body(12),
    lineHeight: 18,
    marginTop: 11,
  },

  /* members — L500 the card, L519 the footnote */
  membersColumn: {
    paddingHorizontal: GUTTER,
  },
  membersShell: {
    flex: 1,
    borderRadius: CARD_RADIUS,
  },
  membersClip: {
    flex: 1,
    borderRadius: CARD_RADIUS,
    borderWidth: Rule.hair,
    overflow: 'hidden',
  },
  memberSkeletons: {
    padding: Space.md + 2,
    gap: Space.md,
  },
  memberNotice: {
    padding: Space.md,
  },
  footnote: {
    ...Type.body(12),
    lineHeight: 18,
    paddingTop: Space.md + 2,
    paddingHorizontal: Space.xs,
  },

  /* invite sheet — L1161-1163 chrome, L1478-1490 content */
  sheetLayer: {
    flex: 1,
    justifyContent: 'flex-end',
    zIndex: ZIndex.sheet,
  },
  scrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  sheetShell: {
    // L1163 `margin:0 10px 40px` — the sheet floats clear of all three edges,
    // the same language the nav capsule uses.
    marginHorizontal: 10,
    maxHeight: '82%',
    maxWidth: 520,
    width: '100%',
    alignSelf: 'center',
    borderRadius: SHEET_RADIUS,
  },
  sheetPanel: {
    borderRadius: SHEET_RADIUS,
    borderWidth: Rule.hair,
    // Without this the blur paints square corners behind the rounded border.
    overflow: 'hidden',
  },
  sheetTint: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  grabberSlot: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: Space.sm,
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: Radii.pill,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Space.md,
    paddingHorizontal: Space.xl,
    paddingBottom: Space.md,
  },
  sheetHeadText: {
    flex: 1,
    minWidth: 0,
    paddingTop: 2,
  },
  sheetTitle: {
    ...Type.display(18),
    letterSpacing: tracking(18, -0.015),
  },
  sheetKicker: {
    ...Type.body(11),
    lineHeight: 14,
    letterSpacing: tracking(11, 0.04),
    marginTop: 3,
  },
  sheetBody: {
    paddingHorizontal: Space.lg,
    paddingBottom: Space.xxl,
    gap: Space.lg,
  },
  sheetProse: {
    ...Type.body(14),
    lineHeight: 22,
  },
  /**
   * The code itself. A Text rather than a Text in a View, because the plate IS
   * the code — and note the border and fill live on a TextStyle here, which is
   * fine; only `boxShadow` is typed string-only on Text, and this plate has
   * none.
   */
  codePlate: {
    fontFamily: Fonts.extrabold,
    fontSize: 30,
    lineHeight: 38,
    /*
      Spelled out rather than spread from `Type.readout`, which freezes its
      `fontVariant` as a readonly tuple that RN's mutable `FontVariant[]` will
      not take. The tabular figures are the point of the role and have to
      survive: an eight-character code with a 1 in it must not sit narrower
      than the same code with an 8.
    */
    fontVariant: ['tabular-nums'],
    letterSpacing: tracking(30, 0.1),
    textAlign: 'center',
    borderRadius: CARD_RADIUS,
    borderWidth: Rule.hair,
    paddingVertical: Space.xxl,
    paddingHorizontal: GUTTER,
  },

  /* markers */
  markerBar: {
    flexDirection: 'row',
    paddingHorizontal: GUTTER,
    paddingTop: Space.md,
  },
  /* The dock reserve that used to sit here is inline on the JSX — see `Marker`. */
  markerBody: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Space.xl,
  },
  markerCard: {
    padding: Space.xl,
  },
  markerKicker: {
    ...Type.heading(10),
    letterSpacing: tracking(10, 0.12),
  },
  markerTitle: {
    ...Type.display(26),
    lineHeight: 29,
    letterSpacing: tracking(26, -0.025),
    marginTop: 10,
    marginBottom: 10,
  },
  markerProse: {
    ...Type.body(14),
    lineHeight: 22,
  },
  markerAction: {
    marginTop: Space.lg + 2,
  },

  detailSkeleton: {
    paddingHorizontal: GUTTER,
    paddingTop: Space.md,
    gap: Space.md,
  },
});
