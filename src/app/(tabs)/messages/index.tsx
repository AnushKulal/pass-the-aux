/**
 * Messages — the DM inbox. Design canvas: `data-screen-label="Messages"`.
 *
 * A back tile and a title, then CONVERSATIONS. The artboard says the whole
 * screen in one gesture: an unread thread is a RAISED CARD, a read one is a
 * bare row on the ground. That contrast is the design — the weights and the
 * lift both come from `row.unreadCount` and nothing else.
 *
 * PEOPLE keeps its section below. It is the only way to start a thread with
 * somebody you have never written to, so cutting it would leave the screen
 * unable to do the one thing it is for.
 *
 * Two data sources, and they are not the same shape of question:
 *
 *  - `useInbox()` is the conversations, kept live by `useDmSubscription(null)`
 *    — the inbox-wide variant, which watches every row RLS lets this viewer see.
 *  - `usePeople()` is "who could I write to", answered from the lounges you are
 *    in, because in this product that IS the social graph.
 */

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ChevronLeft, MessageCircle } from 'lucide-react-native';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
  type TextStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChatNotice } from '@/components/chat/bubble-kit';
import { presenceFor, stampFor } from '@/components/dm/conversation-row';
import { Avatar, Skeleton } from '@/components/ui';
import {
  useDmSubscription,
  useInbox,
  useOpenConversation,
  useViewerId,
  type DmAuthor,
  type InboxRow,
} from '@/features/dm';
import { serverNow } from '@/lib/clock';
import { supabase } from '@/lib/supabase';
import {
  Duration,
  Fonts,
  Radii,
  Space,
  TOUCH_TARGET,
  Type,
  raised,
  tracking,
} from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

const CARD_GUTTER = 14;
const TEXT_GUTTER = 24;

const BACK_TILE = 38;
const BACK_SLOP = { top: 3, bottom: 3, left: 6, right: 6 };

const AVATAR = 50;
const PERSON_AVATAR = 42;
const DOT = 13;

const INBOX_SKELETONS = [0, 1, 2, 3];
const PEOPLE_SKELETONS = [0, 1, 2];

/** People are a browse list, not a directory: one screenful, most recent first. */
const PEOPLE_LIMIT = 24;
/** How many roster rows to scan before giving up on de-duplicating by hand. */
const ROSTER_SCAN = 400;

/** `Type.readout()` hands back a readonly tuple; `TextStyle` wants a mutable one. */
const readout = (size: number): TextStyle => ({
  ...Type.readout(size),
  fontVariant: ['tabular-nums'],
});

/* -------------------------------------------------------------------- people */

const peopleKey = (viewerId: string | null) => ['messages', 'people', viewerId] as const;

const PROFILE_COLUMNS =
  'id, username, display_name, avatar_url, last_seen_at, show_activity, is_premium';

/**
 * The people you share a lounge with.
 *
 * Three round trips rather than one embedded select: the hand-authored
 * `Database` type declares no relationships, so PostgREST embeds do not
 * typecheck against it. RLS does the scoping — `members read the roster` only
 * returns rows for lounges you are actually in — so this cannot leak a
 * stranger's profile into the list.
 */
async function fetchPeople(viewerId: string): Promise<DmAuthor[]> {
  const mine = await supabase.from('lounge_members').select('lounge_id').eq('user_id', viewerId);
  if (mine.error) throw new Error(mine.error.message);

  const loungeIds = (mine.data ?? []).map((row) => row.lounge_id);
  if (loungeIds.length === 0) return [];

  const roster = await supabase
    .from('lounge_members')
    .select('user_id')
    .in('lounge_id', loungeIds)
    .neq('user_id', viewerId)
    .limit(ROSTER_SCAN);
  if (roster.error) throw new Error(roster.error.message);

  const ids = [...new Set((roster.data ?? []).map((row) => row.user_id))];
  if (ids.length === 0) return [];

  // Ordered by last seen so the section leads with whoever is actually around,
  // which is also what makes the presence dot worth drawing.
  const profiles = await supabase
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .in('id', ids)
    .order('last_seen_at', { ascending: false })
    .limit(PEOPLE_LIMIT)
    .returns<DmAuthor[]>();
  if (profiles.error) throw new Error(profiles.error.message);

  return profiles.data ?? [];
}

function usePeople() {
  const viewerId = useViewerId();

  return useQuery({
    queryKey: peopleKey(viewerId),
    queryFn: () => fetchPeople(viewerId as string),
    enabled: viewerId !== null,
    staleTime: 5 * 60_000,
  });
}

/* ---------------------------------------------------------- conversation row */

type ThreadRowProps = {
  row: InboxRow;
  onOpenThread: (conversationId: string) => void;
};

/**
 * The artboard's row.
 *
 * Unread lifts off the ground on `raised()` and sets in `ink`; read lies flat
 * on the ground in `ink2`. Nothing else separates the two states, which is why
 * neither may be softened for consistency.
 */
function ThreadRowBase({ row, onOpenThread }: ThreadRowProps) {
  const C = useColors();

  const person = row.other;
  const name = person ? person.display_name.trim() || person.username : 'Someone';
  const unread = row.unreadCount > 0;

  const nowMs = serverNow();
  const live = presenceFor(person, nowMs) === 'online';
  const stamp = stampFor(row.previewAt ?? row.lastMessageAt, nowMs);

  const hasPreview = row.preview.trim().length > 0;
  const preview = hasPreview
    ? row.previewIsMine
      ? `You: ${row.preview}`
      : row.preview
    : 'No messages yet';

  const open = useCallback(() => onOpenThread(row.conversationId), [onOpenThread, row]);

  const summary = [name, unread ? `${row.unreadCount} unread` : null, preview]
    .filter(Boolean)
    .join(', ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={summary}
      accessibilityHint="Opens the conversation"
      onPress={open}
      style={({ pressed }) => [
        styles.thread,
        unread
          ? [{ backgroundColor: pressed ? C.surface2 : C.surface }, raised(C)]
          : pressed
            ? { backgroundColor: C.surface }
            : null,
      ]}>
      <View style={styles.avatarWell}>
        <Avatar name={name} uri={person?.avatar_url} size={AVATAR} />
        {live ? (
          <View
            style={[
              styles.dot,
              { backgroundColor: C.live, borderColor: unread ? C.surface : C.bg },
            ]}
          />
        ) : null}
      </View>

      <View style={styles.threadText}>
        <Text numberOfLines={1} style={[styles.threadName, { color: unread ? C.ink : C.ink2 }]}>
          {name}
        </Text>
        <Text
          numberOfLines={1}
          style={[styles.threadPreview, { color: unread ? C.ink2 : C.ink3 }]}>
          {preview}
        </Text>
      </View>

      <View style={styles.threadMeta}>
        <Text style={[styles.stamp, { color: C.ink3 }]}>{stamp}</Text>
        {/* The one accent on the row, and it means exactly one thing. */}
        {unread ? (
          <View style={[styles.badge, { backgroundColor: C.live }]}>
            <Text numberOfLines={1} style={[styles.badgeLabel, { color: C.onLive }]}>
              {row.unreadCount > 99 ? '99+' : row.unreadCount}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

/**
 * Memoised: realtime commits a message into one thread and the inbox re-renders
 * whole, so every other row gets the same props it already had.
 */
const ThreadRow = memo(ThreadRowBase);

/* ---------------------------------------------------------------- person row */

type PersonRowProps = {
  person: DmAuthor;
  /** Open (or reuse) the thread with them. */
  onMessage: (userId: string) => void;
  /** True while `open_direct_conversation` is in flight for this person. */
  busy?: boolean;
};

function PersonRowBase({ person, onMessage, busy = false }: PersonRowProps) {
  const C = useColors();
  const name = person.display_name.trim() || person.username;
  const live = presenceFor(person, serverNow()) === 'online';

  const message = useCallback(() => onMessage(person.id), [onMessage, person.id]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Message ${name}`}
      accessibilityState={{ disabled: busy, busy }}
      disabled={busy}
      onPress={message}
      style={({ pressed }) => [
        styles.person,
        pressed && { backgroundColor: C.surface },
        busy && styles.blocked,
      ]}>
      <View style={styles.avatarWell}>
        <Avatar name={name} uri={person.avatar_url} size={PERSON_AVATAR} />
        {live ? (
          <View style={[styles.personDot, { backgroundColor: C.live, borderColor: C.bg }]} />
        ) : null}
      </View>

      <View style={styles.threadText}>
        <Text numberOfLines={1} style={[styles.threadName, { color: C.ink2 }]}>
          {name}
        </Text>
        <Text numberOfLines={1} style={[styles.threadPreview, { color: C.ink3 }]}>
          @{person.username}
        </Text>
      </View>

      <MessageCircle size={18} strokeWidth={2} color={busy ? C.ink3 : C.ink2} />
    </Pressable>
  );
}

const PersonRow = memo(PersonRowBase);

/** Rows of the real geometry, so nothing shifts when the data lands. */
function InboxSkeleton() {
  return (
    <View style={styles.skeletonGroup}>
      {INBOX_SKELETONS.map((row) => (
        <View key={row} style={styles.skeletonRow}>
          <Skeleton width={AVATAR} height={AVATAR} />
          <View style={styles.skeletonText}>
            <Skeleton width="42%" height={13} />
            <Skeleton width="76%" height={11} />
          </View>
        </View>
      ))}
    </View>
  );
}

function PeopleSkeleton() {
  return (
    <View style={styles.skeletonGroup}>
      {PEOPLE_SKELETONS.map((row) => (
        <View key={row} style={styles.skeletonRow}>
          <Skeleton width={PERSON_AVATAR} height={PERSON_AVATAR} />
          <View style={styles.skeletonText}>
            <Skeleton width="38%" height={12} />
            <Skeleton width="58%" height={10} />
          </View>
        </View>
      ))}
    </View>
  );
}

/* -------------------------------------------------------------------- screen */

const keyExtractor = (row: InboxRow) => row.conversationId;

export default function MessagesScreen() {
  const C = useColors();
  const router = useRouter();
  const reduced = useReducedMotion();

  const { rows, isPending, isError, isRefetching, refetch } = useInbox();
  const {
    data: peopleRows,
    isPending: peoplePending,
    isError: peopleFailed,
    refetch: refetchPeople,
  } = usePeople();

  // The inbox-wide subscription: null means "every conversation I am in", so a
  // message arriving while this screen is open re-sorts the list and moves the
  // badge without a poll.
  useDmSubscription(null);

  const { mutate: openConversation } = useOpenConversation();
  const [messagingId, setMessagingId] = useState<string | null>(null);

  const enter = useSharedValue(0);
  useEffect(() => {
    enter.value = reduced ? 1 : withTiming(1, { duration: Duration.enter });
  }, [reduced, enter]);
  const enterStyle = useAnimatedStyle(() => ({ opacity: enter.value }));

  const openThread = useCallback(
    (conversationId: string) => {
      // Object form rather than a template literal: it stays valid under typed
      // routes whether or not the route types have been generated yet.
      router.push({ pathname: '/messages/[id]', params: { id: conversationId } });
    },
    [router],
  );

  const messagePerson = useCallback(
    (userId: string) => {
      setMessagingId(userId);
      openConversation(userId, {
        onSuccess: (conversationId) => openThread(conversationId),
        onSettled: () => setMessagingId(null),
      });
    },
    [openConversation, openThread],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<InboxRow>) => (
      <ThreadRow row={item} onOpenThread={openThread} />
    ),
    [openThread],
  );

  const empty = useMemo(() => {
    if (isPending) return <InboxSkeleton />;

    if (isError) {
      return (
        <View style={styles.group}>
          <ChatNotice
            label="Your messages didn't load."
            action={{ label: 'Retry', onPress: refetch }}
          />
        </View>
      );
    }

    return (
      <View style={styles.group}>
        <ChatNotice label="No conversations yet. Pick someone below." />
      </View>
    );
  }, [isError, isPending, refetch]);

  const header = useMemo(
    () => (
      <>
        <View style={styles.head}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={BACK_SLOP}
            onPress={() => {
              if (router.canGoBack()) router.back();
              else router.replace('/(tabs)');
            }}
            style={({ pressed }) => [
              styles.backTile,
              { backgroundColor: pressed ? C.surface2 : C.surface },
              raised(C),
            ]}>
            <ChevronLeft size={20} strokeWidth={2.4} color={C.ink} />
          </Pressable>
          <Text style={[styles.title, { color: C.ink }]}>Messages</Text>
        </View>

        <Text style={[styles.kicker, { color: C.ink3 }]}>Conversations</Text>
      </>
    ),
    [C, router],
  );

  const footer = useMemo(
    () => (
      <>
        <Text style={[styles.kicker, { color: C.ink3 }]}>People</Text>

        {peoplePending ? <PeopleSkeleton /> : null}

        {peopleFailed ? (
          <View style={styles.group}>
            <ChatNotice
              label="The people list didn't load."
              action={{ label: 'Retry', onPress: () => void refetchPeople() }}
            />
          </View>
        ) : null}

        {!peoplePending && !peopleFailed && (peopleRows?.length ?? 0) === 0 ? (
          <View style={styles.group}>
            <ChatNotice
              label="Join a lounge and this fills itself."
              action={{ label: 'Find a lounge', onPress: () => router.push('/lounges') }}
            />
          </View>
        ) : null}

        <View style={styles.rows}>
          {(peopleRows ?? []).map((person) => (
            <PersonRow
              key={person.id}
              person={person}
              busy={messagingId === person.id}
              onMessage={messagePerson}
            />
          ))}
        </View>
      </>
    ),
    [C.ink3, messagePerson, messagingId, peopleFailed, peoplePending, peopleRows, refetchPeople, router],
  );

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.root, { backgroundColor: C.bg }]}>
      <Animated.View style={[styles.flex, enterStyle]}>
        <FlatList
          data={isPending || isError ? [] : rows}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          ListHeaderComponent={header}
          ListEmptyComponent={empty}
          ListFooterComponent={footer}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={C.ink2}
              colors={[C.live]}
              progressBackgroundColor={C.surface}
            />
          }
        />
      </Animated.View>
    </SafeAreaView>
  );
}

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
    flexGrow: 1,
  },

  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: TEXT_GUTTER,
  },
  backTile: {
    width: BACK_TILE,
    height: BACK_TILE,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.sm,
  },
  title: {
    ...Type.display(24),
    letterSpacing: tracking(24, -0.03),
  },

  kicker: {
    ...Type.label(10.5),
    letterSpacing: tracking(10.5, 0.15),
    paddingHorizontal: TEXT_GUTTER,
    paddingTop: Space.xxxl,
    paddingBottom: Space.md,
  },
  group: {
    paddingHorizontal: Space.xl,
  },
  rows: {
    paddingHorizontal: CARD_GUTTER,
  },

  thread: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: TOUCH_TARGET,
    marginHorizontal: CARD_GUTTER,
    marginBottom: 9,
    padding: Space.md,
    borderRadius: Radii.lg,
  },
  person: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: TOUCH_TARGET,
    marginBottom: 9,
    padding: Space.md,
    borderRadius: Radii.lg,
  },
  blocked: {
    opacity: 0.55,
  },
  avatarWell: {
    flexShrink: 0,
  },
  dot: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: DOT,
    height: DOT,
    borderRadius: Radii.pill,
    borderWidth: 2.5,
  },
  personDot: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 11,
    height: 11,
    borderRadius: Radii.pill,
    borderWidth: 2.5,
  },
  threadText: {
    flex: 1,
    minWidth: 0,
  },
  threadName: {
    fontFamily: Fonts.semibold,
    fontSize: 14.5,
    lineHeight: 19,
  },
  threadPreview: {
    ...Type.body(12.5),
    marginTop: 2,
  },
  threadMeta: {
    flexShrink: 0,
    alignItems: 'flex-end',
    gap: 6,
  },
  stamp: {
    ...readout(11),
    fontFamily: Fonts.semibold,
  },
  badge: {
    minWidth: 19,
    height: 19,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  badgeLabel: {
    ...readout(10.5),
    lineHeight: 19,
  },

  skeletonGroup: {
    paddingHorizontal: CARD_GUTTER,
  },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: Space.md,
  },
  skeletonText: {
    flex: 1,
    gap: Space.sm,
  },
});
