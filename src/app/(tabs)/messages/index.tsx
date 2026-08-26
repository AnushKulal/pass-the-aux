/**
 * Messages — the DM inbox. Design: `design/nocturne/aux-nocturne.dc.html`
 * L672-719 (`isDms`).
 *
 * HOW UNREAD READS NOW, AND WHY IT HAD TO CHANGE.
 *
 * This screen used to say "unread" with a RAISED CARD against a bare row on the
 * ground — the lift was the whole signal. That does not survive Nocturne. The
 * design is exact about depth: all 43 of its radius-24 surfaces carry a shadow
 * and not one of its 54 radius-18 surfaces does, and a conversation row is
 * radius 18. Lifting one row out of a stack of flat ones would also have been
 * the weakest possible cue on the two platforms where `boxShadow` degrades to
 * nothing (Android 7-8), which the theme explicitly warns against for a
 * distinction that carries MEANING.
 *
 * So every row is now the same glass row — `surface` fill, `rule` hairline,
 * radius 18, no shadow — and unread is carried by four things that all point
 * the same way:
 *
 *   1. the CORAL count badge, with the halo the design gives it. It is the
 *      loudest object on the screen and it exists only on unread rows;
 *   2. a brighter card: `surface2` over `surface` (9% white against 5.5%) with
 *      a `rule2` edge. A value step, so it survives with no shadows at all;
 *   3. the name at 800 instead of 600;
 *   4. the preview in full `ink` instead of `ink2`.
 *
 * Coral appears here in exactly its reserved senses — unread, online, PREMIUM —
 * and nothing on this screen is blue, because nothing on it is a CTA.
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
 *
 * HOW IT ARRIVES. The header lifts in as a module and the rows stagger up
 * under it, 50ms apart, through `useEntrance` — see the note at `chromeEnter`.
 * The screen-wide cross-fade that used to wrap the whole list is gone.
 *
 * THIS SCREEN STILL INLINES A SECOND CONVERSATION ROW. `ThreadRowBase` below is
 * a near-copy of `<ConversationRow>`, which already exists, already carries the
 * same metrics, and additionally offers the avatar/name profile target this
 * copy cannot. They now share an entrance because both call `useEntrance` with
 * the same arguments, but that is one behaviour deduplicated, not the
 * duplication resolved — and the two have already drifted once: an unread row
 * borders `C.rule2` here and `C.liveMid` there. Collapsing them needs a profile
 * destination for `onOpenProfile`, which this build does not have a route for,
 * so it is a change with a decision in it rather than a tidy-up.
 *
 * DELIBERATE DEVIATIONS FROM THE ARTBOARD. Its header carries a search toggle
 * and its people rows carry an "add friend" CTA; there is no inbox search and
 * no friend graph in this build, and inventing chrome for absent features is
 * worse than leaving the artboard incomplete. The back tile the artboard does
 * not have is kept, because Messages is reached by `router.push` from the nav
 * capsule and there is a stack behind it.
 */

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ChevronLeft, MessageCircle } from 'lucide-react-native';
import { memo, useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
  type TextStyle,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChatNotice } from '@/components/chat/bubble-kit';
import { presenceFor, presenceLabel, stampFor } from '@/components/dm/conversation-row';
import { Avatar, CircleIconButton, Skeleton, StatusPill } from '@/components/ui';
import {
  useDmSubscription,
  useInbox,
  useOpenConversation,
  useTotalUnread,
  useViewerId,
  type DmAuthor,
  type InboxRow,
} from '@/features/dm';
import { serverNow } from '@/lib/clock';
import { useDockReserve } from '@/lib/dock';
import { useEntrance } from '@/lib/entrance';
import { supabase } from '@/lib/supabase';
import {
  Fonts,
  Radii,
  Rule,
  Space,
  Stagger,
  TOUCH_TARGET,
  Type,
  tracking,
} from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

/** The artboard's gutter — `padding:0 18px` on the scroller, and on the header. */
const GUTTER = 18;
/** `gap:10px` between rows, in both sections. */
const ROW_GAP = 10;

const AVATAR = 44;
const PERSON_AVATAR = 40;

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

/**
 * The badge voice: 800, uppercase, widely tracked. `Type.label` has the case
 * and the tracking but ships at 600, which goes soft at 9-10px beside the 800
 * names it sits next to; `Type.heading` has the weight but neither the case nor
 * the tracking. Same recipe `StatusPill` derives for the same reason.
 */
const badge = (size: number, em: number): TextStyle => ({
  ...Type.heading(size),
  letterSpacing: tracking(size, em),
  textTransform: 'uppercase',
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
  /** Position in the inbox. Drives the 50ms entrance stagger. */
  index?: number;
  onOpenThread: (conversationId: string) => void;
};

/**
 * The artboard's row (L679-694).
 *
 * Hand-rolled rather than `GlassCard variant="row"` for one reason: the fill
 * has to move on press AND on unread, and the card deliberately does not expose
 * its skin. The recipe is copied exactly — `surface` over a `rule` hairline at
 * radius 18, no shadow — so the two stay the same object.
 */
function ThreadRowBase({ row, index = 0, onOpenThread }: ThreadRowProps) {
  const C = useColors();

  /*
    The same call `<ConversationRow>` makes, with the same arguments, because
    these two rows are the same row twice (see the note on the screen). If one
    of them ever grows a different entrance the duplication has started to
    diverge, and that is the moment to collapse them rather than to fork the
    motion as well.
  */
  const entering = useEntrance({ index, kind: 'row', step: Stagger.messages });

  const person = row.other;
  const name = person ? person.display_name.trim() || person.username : 'Someone';
  const unread = row.unreadCount > 0;

  const nowMs = serverNow();
  const presence = presenceFor(person, nowMs);
  const live = presence === 'online';
  const status = presenceLabel(presence);
  const stamp = stampFor(row.previewAt ?? row.lastMessageAt, nowMs);

  const hasPreview = row.preview.trim().length > 0;
  const preview = hasPreview
    ? row.previewIsMine
      ? `You: ${row.preview}`
      : row.preview
    : 'No messages yet';

  const open = useCallback(() => onOpenThread(row.conversationId), [onOpenThread, row]);

  const summary = [name, status || null, unread ? `${row.unreadCount} unread` : null, preview]
    .filter(Boolean)
    .join(', ');

  return (
    <Animated.View style={entering}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={summary}
        accessibilityHint="Opens the conversation"
        onPress={open}
        style={({ pressed }) => [
          styles.row,
          {
            /*
              The value step that replaced the lift. Both states press one rung
              further up the same ladder, so the feedback is identical and only
              the resting brightness separates them.
            */
            backgroundColor: unread
              ? pressed
                ? C.surface3
                : C.surface2
              : pressed
                ? C.surface2
                : C.surface,
            borderColor: unread ? C.rule2 : C.rule,
          },
        ]}>
        {/*
          The presence dot is the kit's punched hole — a coral disc ringed in the
          ground colour, which is what the artboard draws (`border:2.5px solid
          var(--aux-bg)`) even where the avatar sits on a card.
        */}
        <Avatar name={name} uri={person?.avatar_url} size={AVATAR} presence={live} />

        <View style={styles.rowText}>
          <View style={styles.nameLine}>
            <Text
              numberOfLines={1}
              style={[
                styles.name,
                { color: C.ink, fontFamily: unread ? Fonts.extrabold : Fonts.semibold },
              ]}>
              {name}
            </Text>
            {/* Coral only for ONLINE — it is a state of the world, and the other
                two states are not. */}
            {status ? (
              <Text style={[styles.status, { color: live ? C.liveText : C.ink3 }]}>{status}</Text>
            ) : null}
          </View>

          <Text
            numberOfLines={1}
            style={[
              styles.preview,
              {
                color: !hasPreview ? C.ink3 : unread ? C.ink : C.ink2,
                fontFamily: unread ? Fonts.semibold : Fonts.regular,
              },
            ]}>
            {preview}
          </Text>
        </View>

        <View style={styles.meta}>
          <Text style={[styles.stamp, { color: C.ink3 }]}>{stamp}</Text>
          {/*
            The one accent on the row. `StatusPill accent + live` is the artboard's
            badge exactly: coral fill, `onLive` warm-black numeral, and the centred
            14px halo — which is why it is a pill and not a hand-rolled View.
          */}
          {unread ? (
            <StatusPill
              tone="accent"
              live
              label={row.unreadCount > 99 ? '99+' : String(row.unreadCount)}
              accessibilityLabel={`${row.unreadCount} unread`}
            />
          ) : null}
        </View>
      </Pressable>
    </Animated.View>
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
  /** Position in the PEOPLE list. Drives the entrance stagger. */
  index?: number;
  /** Open (or reuse) the thread with them. */
  onMessage: (userId: string) => void;
  /** True while `open_direct_conversation` is in flight for this person. */
  busy?: boolean;
};

/**
 * L698-716. The whole row is one target rather than the artboard's three: it
 * splits into profile / DM / add-friend, and this build has neither a profile
 * route nor a friend graph, so all three would land on the same handler. The
 * trailing glyph is left as the affordance and swaps to a spinner while
 * `open_direct_conversation` is in flight.
 */
function PersonRowBase({ person, index = 0, onMessage, busy = false }: PersonRowProps) {
  const C = useColors();
  const name = person.display_name.trim() || person.username;
  const live = presenceFor(person, serverNow()) === 'online';

  /* Same row, same arrival — PEOPLE is a list of the same object as the inbox. */
  const entering = useEntrance({ index, kind: 'row', step: Stagger.messages });

  const message = useCallback(() => onMessage(person.id), [onMessage, person.id]);

  return (
    <Animated.View style={entering}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Message ${name}`}
        accessibilityState={{ disabled: busy, busy }}
        disabled={busy}
        onPress={message}
        style={({ pressed }) => [
          styles.row,
          styles.person,
          { backgroundColor: pressed ? C.surface2 : C.surface, borderColor: C.rule },
          busy && styles.blocked,
        ]}>
        <Avatar name={name} uri={person.avatar_url} size={PERSON_AVATAR} presence={live} />

        <View style={styles.rowText}>
          <View style={styles.nameLine}>
            <Text numberOfLines={1} style={[styles.personName, { color: C.ink }]}>
              {name}
            </Text>
            {/* PREMIUM is coral: the palette reserves the accent for it by name. */}
            {person.is_premium ? <StatusPill tone="accent" label="Premium" /> : null}
          </View>

          <Text numberOfLines={1} style={[styles.personSub, { color: C.ink3 }]}>
            @{person.username}
          </Text>
        </View>

        <View style={styles.personAction}>
          {busy ? (
            <ActivityIndicator size="small" color={C.ink3} />
          ) : (
            <MessageCircle size={18} strokeWidth={2} color={C.ink2} />
          )}
        </View>
      </Pressable>
    </Animated.View>
  );
}

const PersonRow = memo(PersonRowBase);

/** Rows of the real geometry, so nothing shifts when the data lands. */
function InboxSkeleton() {
  return (
    <View style={styles.skeletonGroup}>
      {INBOX_SKELETONS.map((row) => (
        <View key={row} style={styles.skeletonRow}>
          <Skeleton width={AVATAR} height={AVATAR} radius={Radii.pill} />
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
          <Skeleton width={PERSON_AVATAR} height={PERSON_AVATAR} radius={Radii.pill} />
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
  const dockReserve = useDockReserve();

  const { rows, isPending, isError, isRefetching, refetch } = useInbox();
  const {
    data: peopleRows,
    isPending: peoplePending,
    isError: peopleFailed,
    refetch: refetchPeople,
  } = usePeople();

  /*
    The header's count. Deliberately the same hook the nav capsule's badge
    reads: it shares the inbox query key, so it costs nothing extra and the
    number under the title can never disagree with the badge that sent the user
    here.
  */
  const unread = useTotalUnread();

  // The inbox-wide subscription: null means "every conversation I am in", so a
  // message arriving while this screen is open re-sorts the list and moves the
  // badge without a poll.
  useDmSubscription(null);

  const { mutate: openConversation } = useOpenConversation();
  const [messagingId, setMessagingId] = useState<string | null>(null);

  /*
    THE SCREEN NO LONGER ARRIVES AS ONE BLOCK.

    This was `useEnterStyle()` on an `Animated.View` around the whole FlatList:
    one opacity ramp for the header, every row and the PEOPLE section together,
    fired on mount. That is the "easy fade" — and being mount-driven it also
    played exactly once per app launch, because a tab screen is never
    unmounted, so returning to Messages showed nothing at all.

    Now the chrome lifts in as a MODULE (10px / 280ms) and the rows stagger
    under it as ROWS (8px / 240ms, 50ms apart). One style object serves both
    the header and the PEOPLE heading on purpose: they are the same kind of
    thing arriving, and giving the second one its own identical hook would say
    they were different.

    Nothing is spread over the skeletons, the notices or the empty state. Those
    are all things the user is WAITING on, and making a thing you are waiting
    for perform on its way in is how a fast screen comes to feel slow.
  */
  const chromeEnter = useEntrance({ kind: 'module' });

  const openThread = useCallback(
    (conversationId: string) => {
      // Object form rather than a template literal: it stays valid under typed
      // routes whether or not the route types have been generated yet.
      router.push({ pathname: '/messages/[id]', params: { id: conversationId } });
    },
    [router],
  );

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  }, [router]);

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
    // `index` comes straight from the list. The row stays memoised — its
    // position only changes when the inbox actually re-sorts, which is a
    // re-render it was taking anyway.
    ({ item, index }: ListRenderItemInfo<InboxRow>) => (
      <ThreadRow row={item} index={index} onOpenThread={openThread} />
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
      <Animated.View style={[styles.head, chromeEnter]}>
        <CircleIconButton
          icon={ChevronLeft}
          size={40}
          tone="surface"
          accessibilityLabel="Back"
          onPress={goBack}
        />

        <View style={styles.headText}>
          <Text style={[styles.title, { color: C.ink }]}>Messages</Text>
          {/*
            L675: the count sets in `live-t` under the title. It only earns the
            accent when there IS something unread — coral means "this is
            happening", and "0 UNREAD" is the absence of that, so the zero case
            drops to `ink3` and stops claiming attention.

            The line is never removed, only re-worded. Dropping it while the
            inbox loads would resize the header under the reader and then again
            when the count lands.
          */}
          <Text
            accessibilityLiveRegion="polite"
            style={[styles.headCount, { color: unread > 0 ? C.liveText : C.ink3 }]}>
            {isPending ? 'Loading' : unread > 0 ? `${unread} unread` : 'All caught up'}
          </Text>
        </View>
      </Animated.View>
    ),
    [C.ink, C.ink3, C.liveText, chromeEnter, goBack, isPending, unread],
  );

  const footer = useMemo(
    () => (
      <>
        {/*
          The entrance goes on a wrapping `Animated.View`, not on an
          `Animated.Text`. `useEntrance` is typed as a ViewStyle — which is the
          honest type, since `boxShadow` alone means the two style shapes are
          not interchangeable — and a heading is a block here anyway.
        */}
        <Animated.View style={chromeEnter}>
          <Text style={[styles.section, { color: C.ink }]}>People</Text>
        </Animated.View>

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
          {(peopleRows ?? []).map((person, index) => (
            <PersonRow
              key={person.id}
              person={person}
              index={index}
              busy={messagingId === person.id}
              onMessage={messagePerson}
            />
          ))}
        </View>
      </>
    ),
    [
      C.ink,
      chromeEnter,
      messagePerson,
      messagingId,
      peopleFailed,
      peoplePending,
      peopleRows,
      refetchPeople,
      router,
    ],
  );

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.root}>
      <View style={styles.flex}>
        <FlatList
          data={isPending || isError ? [] : rows}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          ListHeaderComponent={header}
          ListEmptyComponent={empty}
          ListFooterComponent={footer}
          contentContainerStyle={[
            styles.content,
            /*
              The nav capsule floats and takes no layout space, so the list has
              to leave room for it or its last row sits under the glass. Inline
              rather than a StyleSheet entry because `useDockReserve()` includes
              the device's bottom inset, which a static object cannot carry —
              the old `Dock.reserve` here left NEGATIVE clearance on every phone
              with a home indicator.
            */
            { paddingBottom: dockReserve },
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={C.ink2}
              colors={[C.live]}
              /*
                SOLID, not `surface`. The Android spinner's puck floats over the
                list, and a 5.5%-white fill there composites onto whatever row
                is behind it — the one hazard this token exists for.
              */
              progressBackgroundColor={C.surfaceSolid}
            />
          }
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  /*
    No `backgroundColor`. The ambient ground — the three drifting blobs — is
    painted once by the tab shell behind every scene, and an opaque root here
    would cover it; the translucent cards would then have nothing to show
    through them, which is the whole direction.
  */
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
    // The bottom padding is inline on the FlatList — see the note there.
    flexGrow: 1,
  },

  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingHorizontal: GUTTER,
    paddingTop: 2,
    paddingBottom: Space.md,
  },
  headText: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    ...Type.display(26),
    // L674 tracks this one at -.025em, between the display scale's two steps.
    letterSpacing: tracking(26, -0.025),
  },
  headCount: {
    ...badge(10, 0.1),
    marginTop: 3,
  },

  /**
   * L696: the second section head is a small DISPLAY line, not the tracked
   * uppercase kicker this screen used to run. Nocturne titles its sections the
   * way it titles the screen, one size down.
   */
  section: {
    ...Type.display(17),
    letterSpacing: tracking(17, -0.01),
    paddingHorizontal: GUTTER,
    paddingTop: Space.xxl,
    paddingBottom: Space.md,
  },
  group: {
    paddingHorizontal: GUTTER,
  },
  rows: {
    paddingHorizontal: GUTTER,
  },

  /** The shared glass row: L680 and L699 are the same object at two paddings. */
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    minHeight: TOUCH_TARGET,
    marginHorizontal: GUTTER,
    marginBottom: ROW_GAP,
    paddingVertical: Space.md,
    paddingHorizontal: 14,
    borderRadius: Radii.lg,
    borderWidth: Rule.hair,
  },
  /*
    A people row is one step tighter than a conversation row and carries no
    outer margin — the section already pads it. `marginHorizontal: 0` has to be
    stated, because it is overriding `row` rather than starting from nothing.
  */
  person: {
    marginHorizontal: 0,
    paddingVertical: 11,
    paddingHorizontal: 12,
    gap: 11,
  },
  blocked: {
    opacity: 0.55,
  },
  personAction: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },

  rowText: {
    flex: 1,
    minWidth: 0,
  },
  nameLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  name: {
    fontSize: 15,
    lineHeight: 20,
    flexShrink: 1,
  },
  status: {
    ...badge(9, 0.08),
    flexShrink: 0,
  },
  preview: {
    ...Type.body(13),
    lineHeight: 18,
    marginTop: 2,
  },
  personName: {
    fontFamily: Fonts.semibold,
    fontSize: 14,
    lineHeight: 19,
    flexShrink: 1,
  },
  personSub: {
    ...Type.body(11),
    lineHeight: 15,
    marginTop: 2,
  },

  meta: {
    flexShrink: 0,
    alignItems: 'flex-end',
    gap: 6,
    // Keeps the stamp column from shuffling as `NOW` becomes `MAR 4`.
    minWidth: 42,
  },
  stamp: {
    /*
      L690 sets the stamp at 400, not at the readout's 800 — it is the quietest
      thing on the row. The tabular figures are what matter and they survive the
      family swap.
    */
    ...readout(10),
    fontFamily: Fonts.regular,
    letterSpacing: tracking(10, 0.05),
  },

  skeletonGroup: {
    paddingHorizontal: GUTTER,
  },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingVertical: Space.md,
    paddingHorizontal: 14,
  },
  skeletonText: {
    flex: 1,
    gap: Space.sm,
  },
});
