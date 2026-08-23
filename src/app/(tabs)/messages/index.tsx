/**
 * Messages — the DM inbox (README §13).
 *
 * `N UNREAD` over a list of conversations, newest first, staggered in at 50ms;
 * then a **PEOPLE** section for starting a thread with somebody you have never
 * written to.
 *
 * The screen lives inside `(tabs)` so the rail and the tab bar survive the
 * push, but it deliberately owns no tab cell — `PatchbayTabBar` renders from a
 * fixed CELLS list, so a file added to this group is a route and nothing more.
 * The way in is the rail's DM tile.
 *
 * Two data sources, and they are not the same shape of question:
 *
 *  - `useInbox()` is the conversations, with exact unread counts, kept live by
 *    `useDmSubscription(null)` — the inbox-wide variant, which watches every
 *    `direct_messages` row RLS lets this viewer see rather than one thread.
 *  - `usePeople()` is "who could I write to", which the DM schema has no notion
 *    of. It is answered from the lounges you are in, because in this product
 *    that IS the social graph: there is no friends table (see the handoff's
 *    Schema gaps), so the section lists the people you share a lounge with.
 */

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { MessageCircle } from 'lucide-react-native';
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
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import {
  ConversationRow,
  CONVERSATION_ROW_HEIGHT,
  presenceFor,
  presenceLabel,
} from '@/components/dm/conversation-row';
import { Avatar, EmptyState, Screen, Skeleton, useToast } from '@/components/ui';
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
import { Duration, Fonts, Rule, Space, TOUCH_TARGET, Type, tracking } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

/** The screen gutter the artboards use for rows and headers alike. */
const GUTTER = Space.md;
/** Clears the tab bar without leaving a hole under the last row. */
const LIST_TAIL = Space.xxxl;

const INBOX_SKELETONS = [0, 1, 2, 3];
const PEOPLE_SKELETONS = [0, 1, 2];

/** People are a browse list, not a directory: one screenful, most recent first. */
const PEOPLE_LIMIT = 24;
/** How many roster rows to scan before giving up on de-duplicating by hand. */
const ROSTER_SCAN = 400;

const PERSON_AVATAR = 36;
const PERSON_DOT = 10;

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
 * Three round trips rather than one embedded select, for the same reason the
 * Feed's `useMySessions` is split: the hand-authored `Database` type declares no
 * relationships, so PostgREST embeds do not typecheck against it. RLS does the
 * scoping — `members read the roster` only returns rows for lounges you are
 * actually in — so this cannot leak a stranger's profile into the list.
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

/* ---------------------------------------------------------------- person row */

type PersonRowProps = {
  person: DmAuthor;
  /** The row itself: their profile. */
  onOpenProfile: (person: DmAuthor) => void;
  /** The message cell: open (or reuse) the thread with them. */
  onMessage: (userId: string) => void;
  onAdd: (person: DmAuthor) => void;
  /** True while `open_direct_conversation` is in flight for this person. */
  busy?: boolean;
};

function PersonRowBase({ person, onOpenProfile, onMessage, onAdd, busy = false }: PersonRowProps) {
  const C = useColors();
  const name = person.display_name.trim() || person.username;
  const presence = presenceFor(person, serverNow());
  const status = presenceLabel(presence);

  const open = useCallback(() => onOpenProfile(person), [onOpenProfile, person]);
  const message = useCallback(() => onMessage(person.id), [onMessage, person.id]);
  const add = useCallback(() => onAdd(person), [onAdd, person]);

  return (
    <View style={[styles.personRow, { borderBottomColor: C.rule }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${name}${status ? `, ${status.toLowerCase()}` : ''}`}
        accessibilityHint="Opens their profile"
        onPress={open}
        style={({ pressed }) => [styles.personMain, pressed && styles.pressed]}>
        <View style={styles.personAvatar}>
          <Avatar name={name} uri={person.avatar_url} size={PERSON_AVATAR} />
          {presence === 'online' ? (
            <View style={[styles.personDot, { backgroundColor: C.ink, borderColor: C.bg }]} />
          ) : null}
        </View>

        <View style={styles.personIdentity}>
          <View style={styles.personNameLine}>
            <Text numberOfLines={1} style={[styles.personName, { color: C.ink }]}>
              {name}
            </Text>
            {person.is_premium ? (
              <View style={[styles.premium, { backgroundColor: C.ink }]}>
                <Text style={[styles.premiumLabel, { color: C.bg }]}>PREMIUM</Text>
              </View>
            ) : null}
          </View>

          <Text numberOfLines={1} style={[styles.personMeta, { color: C.ink2 }]}>
            {status ? `@${person.username} · ${status}` : `@${person.username}`}
          </Text>
        </View>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Message ${name}`}
        accessibilityState={{ disabled: busy }}
        disabled={busy}
        onPress={message}
        style={({ pressed }) => [styles.iconCell, pressed && styles.pressed]}>
        <MessageCircle size={18} strokeWidth={2} color={busy ? C.ink3 : C.ink2} />
      </Pressable>

      {/*
        §13 asks for message AND add. There is no friends table in the schema —
        no follows, no requests, nothing to write — so the cell states that
        plainly on tap instead of pretending to save something. It stays in ink:
        a control that cannot act has not earned the accent.
      */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Add ${name}`}
        onPress={add}
        style={({ pressed }) => [
          styles.addCell,
          { borderColor: C.rule2 },
          pressed && { backgroundColor: C.surface },
        ]}>
        <Text style={[styles.addLabel, { color: C.ink3 }]}>ADD</Text>
      </Pressable>
    </View>
  );
}

const PersonRow = memo(PersonRowBase);

/* ------------------------------------------------------------------- notices */

/** The ruled prose block this app uses for "nothing here" and "that failed". */
function Notice({
  kicker,
  body,
  action,
}: {
  kicker: string;
  body: string;
  action?: { label: string; onPress: () => void };
}) {
  const C = useColors();

  return (
    <View style={styles.notice}>
      <Text style={[styles.noticeKicker, { color: C.ink3 }]}>{kicker}</Text>
      <Text style={[styles.noticeBody, { color: C.ink2 }]}>{body}</Text>
      {action ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action.label}
          onPress={action.onPress}
          style={({ pressed }) => [
            styles.noticeAction,
            { borderColor: C.rule2, backgroundColor: pressed ? C.surface : 'transparent' },
          ]}>
          <Text style={[styles.noticeActionLabel, { color: C.ink }]}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Four rows of the real geometry, so nothing shifts when the data lands. */
function InboxSkeleton() {
  const C = useColors();

  return (
    <View>
      {INBOX_SKELETONS.map((row) => (
        <View key={row} style={[styles.skeletonRow, { borderBottomColor: C.rule }]}>
          <Skeleton width={40} height={40} />
          <View style={styles.skeletonIdentity}>
            <Skeleton width="42%" height={13} />
            <Skeleton width="76%" height={11} />
          </View>
          <Skeleton width={26} height={10} />
        </View>
      ))}
    </View>
  );
}

function PeopleSkeleton() {
  const C = useColors();

  return (
    <View>
      {PEOPLE_SKELETONS.map((row) => (
        <View key={row} style={[styles.skeletonPerson, { borderBottomColor: C.rule }]}>
          <Skeleton width={PERSON_AVATAR} height={PERSON_AVATAR} />
          <View style={styles.skeletonIdentity}>
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
  const toast = useToast();
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

  const unreadTotal = useMemo(
    () => rows.reduce((total, row) => total + row.unreadCount, 0),
    [rows],
  );

  // ---- the screen's own entrance, matched to every other module in the app
  const enter = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (reduced) {
      enter.value = 1;
      return;
    }
    enter.value = withTiming(1, {
      duration: Duration.enter,
      easing: Easing.bezier(0.2, 0.8, 0.2, 1),
    });
  }, [enter, reduced]);

  const moduleStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * 8 }],
  }));

  const openThread = useCallback(
    (conversationId: string) => {
      // Object form rather than a template literal: it stays valid under typed
      // routes whether or not the route types have been generated yet.
      router.push({ pathname: '/messages/[id]', params: { id: conversationId } });
    },
    [router],
  );

  /**
   * There is no route for another person's profile yet — §15's "Others" screen
   * has no file, and the handoff's Schema gaps still list the columns it needs.
   * The targets stay real and say so plainly rather than pushing into a 404;
   * the day that screen lands this becomes one `router.push` and nothing else
   * on the row changes.
   */
  const openProfile = useCallback(
    (person: DmAuthor) => {
      toast.show(`@${person.username} has no profile page yet`, 'info');
    },
    [toast],
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

  const addPerson = useCallback(() => {
    toast.show('Aux cannot add people yet — message them instead', 'info');
  }, [toast]);

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<InboxRow>) => (
      <ConversationRow
        row={item}
        index={index}
        onOpenThread={openThread}
        onOpenProfile={openProfile}
      />
    ),
    [openProfile, openThread],
  );

  const empty = useMemo(() => {
    if (isPending) return <InboxSkeleton />;

    if (isError) {
      return (
        <Notice
          kicker="COULD NOT LOAD YOUR MESSAGES"
          body="Check your connection and try again — nothing was lost."
          action={{ label: 'TRY AGAIN', onPress: refetch }}
        />
      );
    }

    return (
      <View style={styles.emptyWrap}>
        <EmptyState
          icon={MessageCircle}
          title="No messages yet"
          description="Nobody has written to you, and you have not written to anyone. Pick someone below and start."
        />
      </View>
    );
  }, [isError, isPending, refetch]);

  const footer = useMemo(
    () => (
      <View style={[styles.section, { borderTopColor: C.rule }]}>
        <Text style={[styles.kicker, { color: C.ink3 }]}>PEOPLE</Text>

        {peoplePending ? <PeopleSkeleton /> : null}

        {peopleFailed ? (
          <Notice
            kicker="COULD NOT LOAD PEOPLE"
            body="The list of people from your lounges did not arrive."
            action={{ label: 'TRY AGAIN', onPress: () => void refetchPeople() }}
          />
        ) : null}

        {!peoplePending && !peopleFailed && (peopleRows?.length ?? 0) === 0 ? (
          <Notice
            kicker="NOBODY HERE YET"
            body="People show up once you share a lounge with them. Join one and this fills itself."
          />
        ) : null}

        {(peopleRows ?? []).map((person) => (
          <PersonRow
            key={person.id}
            person={person}
            busy={messagingId === person.id}
            onOpenProfile={openProfile}
            onMessage={messagePerson}
            onAdd={addPerson}
          />
        ))}
      </View>
    ),
    [
      C.ink3,
      C.rule,
      addPerson,
      messagePerson,
      messagingId,
      openProfile,
      peopleFailed,
      peoplePending,
      peopleRows,
      refetchPeople,
    ],
  );

  return (
    <Screen padded={false}>
      <Animated.View style={[styles.flex, moduleStyle]}>
        {/* Header, cut off from the rows by the 2px major rule. */}
        <View style={[styles.head, { borderBottomColor: C.rule }]}>
          <Text style={[styles.title, { color: C.ink }]}>Messages</Text>
          {/*
            The unread readout is the badge in words: same fact, same accent.
            At zero it drops to ink3 — "0 UNREAD" in red would be the accent
            reporting the absence of the thing it exists to report.
          */}
          <Text
            accessibilityRole="text"
            style={[styles.unread, { color: unreadTotal > 0 ? C.liveText : C.ink3 }]}>
            {`${unreadTotal} UNREAD`}
          </Text>
        </View>

        <FlatList
          data={isPending || isError ? [] : rows}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
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
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    paddingBottom: LIST_TAIL,
    flexGrow: 1,
  },

  head: {
    paddingHorizontal: GUTTER,
    paddingTop: 13,
    paddingBottom: 12,
    borderBottomWidth: Rule.major,
  },
  title: {
    ...Type.display(22),
  },
  unread: {
    ...readout(11),
    letterSpacing: tracking(11, 0.12),
    marginTop: 3,
  },

  section: {
    borderTopWidth: Rule.major,
  },
  kicker: {
    ...Type.label(10),
    paddingHorizontal: GUTTER,
    paddingTop: Space.lg,
    paddingBottom: Space.sm,
  },

  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    paddingLeft: GUTTER,
    paddingRight: Space.sm,
    paddingVertical: Space.sm,
    borderBottomWidth: Rule.hair,
  },
  personMain: {
    flex: 1,
    minWidth: 0,
    minHeight: TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm + 2,
  },
  personAvatar: {
    flexShrink: 0,
  },
  personDot: {
    position: 'absolute',
    right: -3,
    bottom: -3,
    width: PERSON_DOT,
    height: PERSON_DOT,
    borderWidth: Rule.major,
  },
  personIdentity: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  personNameLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  personName: {
    ...Type.body(14),
    fontFamily: Fonts.semibold,
    lineHeight: 19,
    flexShrink: 1,
  },
  personMeta: {
    ...Type.body(11),
    lineHeight: 15,
  },
  premium: {
    flexShrink: 0,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  premiumLabel: {
    // The floor is 10px for anything readable; the artboard's 9px sits under it.
    ...Type.heading(10),
    letterSpacing: tracking(10, 0.09),
  },
  iconCell: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  addCell: {
    minWidth: TOUCH_TARGET,
    minHeight: TOUCH_TARGET,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: Rule.hair,
    flexShrink: 0,
  },
  addLabel: {
    ...Type.heading(10),
    letterSpacing: tracking(10, 0.1),
  },
  pressed: {
    opacity: 0.72,
  },

  emptyWrap: {
    padding: GUTTER,
  },
  notice: {
    paddingHorizontal: GUTTER,
    paddingVertical: Space.xl,
  },
  noticeKicker: {
    ...Type.label(10),
    marginBottom: Space.sm,
  },
  noticeBody: {
    ...Type.body(14),
    lineHeight: 21,
  },
  noticeAction: {
    marginTop: Space.md,
    alignSelf: 'flex-start',
    minHeight: 46,
    justifyContent: 'center',
    paddingHorizontal: Space.lg,
    borderWidth: Rule.hair,
  },
  noticeActionLabel: {
    ...Type.heading(11),
    letterSpacing: tracking(11, 0.1),
  },

  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm + 2,
    height: CONVERSATION_ROW_HEIGHT,
    paddingHorizontal: GUTTER,
    borderBottomWidth: Rule.hair,
  },
  skeletonPerson: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm + 2,
    paddingHorizontal: GUTTER,
    paddingVertical: Space.sm,
    minHeight: TOUCH_TARGET + Space.lg,
    borderBottomWidth: Rule.hair,
  },
  skeletonIdentity: {
    flex: 1,
    gap: Space.sm,
  },
});
