/**
 * The lounge / Session log.
 *
 * Newest-first data rendered `inverted`, decorated with run and day boundaries,
 * and drawn as the card list Nocturne specifies (design L463 for the lounge,
 * L1251 for the Session). All four states live here: a skeleton in the real
 * card geometry, a failure that offers the retry, an empty log that says what to
 * do, and the log itself.
 *
 * The two logs differ in exactly two numbers — an 18px gutter and a 12px gap on
 * the screen, 16 and 10 inside the Session sheet — and in one fact that is not
 * cosmetic at all: inside the sheet every fill has to be the opaque one. Both
 * ride on the single `ground` prop. See `ChatGround`.
 *
 * HOW THE LOG ARRIVES. The cards come in one after another — `useEntrance` per
 * row, from `@/lib/entrance` — instead of the whole screen cross-fading in as
 * one block. The skeleton and the two notices deliberately do NOT: a
 * placeholder, a failure and an empty log are all things the reader is WAITING
 * on, and staggering a wait turns it into a performance.
 */

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import Animated from 'react-native-reanimated';

import {
  ChatNotice,
  LogStart,
  styles as kit,
  type ChatGround,
} from '@/components/chat/bubble-kit';
import {
  MessageActionsSheet,
  MessageRow,
  type MessageRowProps,
} from '@/components/chat/message-row';
import { Skeleton } from '@/components/ui';
import {
  chatKeys,
  useDeleteMessage,
  useMessageSubscription,
  useMessages,
  useToggleReaction,
  useViewerId,
  type ChatMessage,
  type ChatScope,
} from '@/features/chat/queries';
import { serverNow } from '@/lib/clock';
import { useEntrance } from '@/lib/entrance';
import { Radii, Space, Stagger } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

/** Messages closer together than this from one author render as one run. */
const GROUP_WINDOW_MS = 5 * 60_000;

/**
 * The placeholder log. Full-width cards now rather than alternating bubbles —
 * a skeleton whose shape does not match what replaces it makes the swap visible
 * as a pop. Heights are one, two and three lines of body inside the card's
 * 13px padding and 18px head.
 */
const SKELETON_CARDS = [74, 95, 74, 116, 74] as const;

export type ChatListProps = ChatScope & {
  /** Copy for the empty state, which differs between a lounge and a Session. */
  emptyLabel?: string;
  /** Screen or Session sheet — decides the gutter and, crucially, the fills. */
  ground?: ChatGround;
  /** Forwarded to every row: avatars and names become profile targets. */
  onOpenProfile?: (userId: string) => void;
};

type Decorated = {
  message: ChatMessage;
  showHeader: boolean;
  daySeparator: string | null;
};

/** Module scope so the reference never changes between renders. */
const keyExtractor = (item: Decorated) => item.message.id;

const startOfDay = (value: string | Date) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

function dayLabel(iso: string): string {
  const now = new Date();
  const day = startOfDay(iso);

  if (day === startOfDay(now)) return 'Today';

  /*
    Stepping the date field rather than subtracting 24h: on the two DST
    changeovers a day is 23 or 25 hours long, and fixed-millisecond arithmetic
    labels one of them wrong.
  */
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (day === startOfDay(yesterday)) return 'Yesterday';

  const date = new Date(iso);
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    // Only disambiguate the year once the log is old enough to need it.
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
}

/**
 * Annotate each message with what it needs to draw itself.
 *
 * The list is newest-first because it is rendered `inverted`, so the visually
 * *preceding* message — the one a run or a day boundary is measured against —
 * is the NEXT index, not the previous one. Getting this backwards is the classic
 * inverted-chat bug: the run break appears under the last message of a run
 * instead of above the first.
 *
 * `showHeader` no longer decides whether an avatar is drawn — every card in this
 * direction carries its own head, because a headless card is an orphaned
 * paragraph. It now decides only the step of MARGIN that separates one run from
 * the next, which is how a card list expresses grouping.
 */
function decorate(messages: ChatMessage[]): Decorated[] {
  return messages.map((message, index) => {
    const older = messages[index + 1];

    const newDay = !older || startOfDay(older.createdAt) !== startOfDay(message.createdAt);
    const newAuthor = !older || older.userId !== message.userId;
    const gap =
      !older ||
      new Date(message.createdAt).getTime() - new Date(older.createdAt).getTime() > GROUP_WINDOW_MS;

    return {
      message,
      // A day break always starts a fresh run, whoever spoke last.
      showHeader: newDay || newAuthor || gap,
      daySeparator: newDay ? dayLabel(message.createdAt) : null,
    };
  });
}

/**
 * How recently a confirmed message of your own must have been written for its
 * card to be an id swap rather than an arrival. Mirrors the window the cache
 * matches echoes in (`ECHO_WINDOW_MS`), and generous on purpose: the only thing
 * riding on this number is whether 8px of lift plays on a card that is already
 * sitting on screen.
 */
const ECHO_GRACE_MS = 15_000;

/**
 * How long a first load may sit on the skeleton before the log admits it is not
 * loading any more.
 *
 * A SKELETON THAT NEVER RESOLVES IS THE SAME LIE AS A BLANK SCREEN, and this
 * log has a real way of reaching one: `useMessages` is `enabled` only once the
 * viewer id is known, and a disabled query in TanStack v5 reports
 * `status: 'pending'` forever — it is not loading, it is not going to. A signed
 * out viewer, a session that failed to read back, or a request that simply
 * hangs all land on the same five grey cards, and the only bug report that can
 * come out of that is "the session chat doesn't exist".
 *
 * Eight seconds is chosen to be longer than any first page has any business
 * taking and short enough that nobody has left the screen: this must never fire
 * over a slow-but-working load, because a notice that appears and then vanishes
 * behind arriving content is worse than the wait it interrupted.
 */
const LOAD_PATIENCE_MS = 8_000;

/** The reason, if the thrown thing carried one. */
function reasonFor(error: unknown): string | null {
  return error instanceof Error && error.message.length > 0 ? error.message : null;
}

/**
 * Is this card arriving, or is it one already on screen collecting its real id?
 *
 * A send lands in the cache twice: immediately, under a `pending:` id, and
 * again when the server confirms it — under the server's id. That changes the
 * row's key, so React unmounts the card the sender is looking at and mounts a
 * fresh one in its place. Give the row an entrance and that swap plays as a
 * second fade-up, on the one card in the app that is watched hardest.
 *
 * So a message of your own that is already confirmed and only seconds old does
 * not arrive: its optimistic twin was standing in exactly that spot a moment
 * ago. Everything else does — including your own message the first time, as the
 * pending card, which is the frame the send is actually felt on.
 *
 * `serverNow()`, not `Date.now()`: this is the same comparison the cache makes
 * to match an echo, and a device clock minutes out would answer it wrong in
 * both directions.
 */
function isArriving(message: ChatMessage, mine: boolean): boolean {
  if (!mine || message.pending) return true;
  return serverNow() - new Date(message.createdAt).getTime() > ECHO_GRACE_MS;
}

type MessageCellProps = MessageRowProps & {
  /** Position in the newest-first list. Drives the stagger. */
  index: number;
  /** False for a card that is already on screen under another id. */
  arrive: boolean;
};

/**
 * One card's arrival, held one level above the card.
 *
 * WHAT `index` MEANS HERE, WHICH IS THE WHOLE TRICK. `useEntrance` reads it
 * ONCE, at mount, and this list is `inverted` over newest-first data — so the
 * end it grows at is index 0. Opening a chat mounts 0, 1, 2… together and they
 * lift in one after another, the cascade running up from the newest card, which
 * is the end of the log the eye is already on. A message landing in a
 * conversation that is already open mounts alone AT index 0, and index 0 is a
 * delay of zero: one row arriving, no stagger. The rows already on screen keep
 * the delay they mounted with and nothing re-triggers them, so a live
 * conversation never replays its own history.
 *
 * `inverted` does not flip the lift, which is the thing to check before
 * trusting any transform in here: the list and each of its cells both carry
 * scaleY(-1) — the second exists to cancel the first — so a translateY inside a
 * cell means what it says.
 *
 * AND WHY THIS IS NOT JUST `MessageRow`'s ROOT VIEW. `index` is the one value
 * here that changes when a SIBLING arrives: a new message prepends and shifts
 * every index by one. `MessageRow` is memoised on the promise that it redraws
 * only when its own message is replaced, and threading a number that is read
 * once at mount is not worth re-rendering twenty cards per incoming message. So
 * the index — and the hook that reads it — live out here, in a wrapper that
 * holds nothing but opacity and 8px of travel and is cheap to re-render.
 */
function MessageCell({ index, arrive, ...row }: MessageCellProps) {
  const entrance = useEntrance({ index, step: Stagger.messages });

  return (
    <Animated.View style={arrive ? entrance : undefined}>
      <MessageRow {...row} />
    </Animated.View>
  );
}

export function ChatList({
  loungeId,
  roomId,
  emptyLabel,
  ground = 'screen',
  onOpenProfile,
}: ChatListProps) {
  const C = useColors();
  const scope = useMemo<ChatScope>(() => ({ loungeId, roomId: roomId ?? null }), [loungeId, roomId]);

  const viewerId = useViewerId();
  const { messages, isPending, isError, hasNextPage, isFetchingNextPage, fetchNextPage, refetch } =
    useMessages(scope);

  useMessageSubscription(scope);

  // Both are stable callbacks by contract, so rows stay memoised across renders.
  const toggleReaction = useToggleReaction(scope);
  const deleteMessage = useDeleteMessage(scope);

  const client = useQueryClient();

  const [selected, setSelected] = useState<ChatMessage | null>(null);

  /*
    THE SKELETON HAS A DEADLINE. See `LOAD_PATIENCE_MS` for why it needs one.

    The flag is set from a timer and never cleared, and it does not need to be:
    React Native's `Modal` renders null while hidden, so the Session's chat
    sheet unmounts this component every time it closes, and the lounge log is
    keyed by its own route. Nothing returns to `pending` under the same mount.
    Clearing it in the effect would also be the `set-state-in-effect` violation
    this codebase has already had to unpick twice — setting it from inside the
    timeout is not, because the frame it lands on is one React scheduled itself.
  */
  const [waitedOut, setWaitedOut] = useState(false);

  useEffect(() => {
    if (!isPending) return;

    const timer = setTimeout(() => setWaitedOut(true), LOAD_PATIENCE_MS);
    return () => clearTimeout(timer);
  }, [isPending]);

  const data = useMemo(() => decorate(messages), [messages]);

  const openActions = useCallback((message: ChatMessage) => setSelected(message), []);

  const renderItem = useCallback(
    // `index` comes from the list itself — see `MessageCell` for what it means
    // in a log that grows at index 0, and why it stops there rather than being
    // threaded into the memoised row.
    ({ item, index }: ListRenderItemInfo<Decorated>) => {
      const mine = item.message.userId === viewerId;

      return (
        <MessageCell
          index={index}
          arrive={isArriving(item.message, mine)}
          message={item.message}
          mine={mine}
          showHeader={item.showHeader}
          daySeparator={item.daySeparator}
          ground={ground}
          onLongPress={openActions}
          onToggleReaction={toggleReaction}
          onOpenProfile={onOpenProfile}
        />
      );
    },
    [openActions, toggleReaction, onOpenProfile, viewerId, ground],
  );

  const closeActions = useCallback(() => setSelected(null), []);

  const onEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const solid = ground === 'sheet';

  /*
    WHY THE FAILURE IS DUG OUT OF THE CACHE RATHER THAN TAKEN FROM THE HOOK.

    `useMessages` returns `isError` and nothing else about it, and this file may
    not reshape that hook — so the only place the thrown error still exists is
    the query it came from. `getQueryState` is a plain read of the entry
    `useMessages` is already subscribed to, so the render that flips `isError`
    is the render that reads this; it is guarded on `isError` precisely so the
    read cannot be hoisted above the moment there is something to read.

    It is worth the indirection. "The log didn't load." is a sentence nobody can
    act on: it is the same words for a dropped connection, an expired token and
    an RLS policy that refuses this room. The server's own message is the only
    part of this notice that ever tells anyone what to fix.
  */
  const failure = isError
    ? reasonFor(client.getQueryState(chatKeys.messages(loungeId, roomId ?? null))?.error)
    : null;

  /*
    Still pending long after a first page should have landed — see
    `LOAD_PATIENCE_MS`. Checked BEFORE `isPending` below, because this is the
    branch that exists to stop that one from being the last word.
  */
  if (isPending && waitedOut) {
    const noSession = viewerId === null;

    return (
      <View style={kit.noticeDock}>
        <ChatNotice
          label={
            noSession
              ? 'Chat is waiting on your session. Sign in again if this does not clear.'
              : 'The log is taking longer than it should.'
          }
          solid={solid}
          /*
            No retry for a missing session: the query is DISABLED in that
            state, so `refetch` would do nothing at all and a button that
            visibly does nothing is how this screen got its reputation.
          */
          action={noSession ? undefined : { label: 'Retry', onPress: refetch }}
        />
      </View>
    );
  }

  if (isPending) return <ChatSkeleton ground={ground} />;

  if (isError && messages.length === 0) {
    return (
      <View style={kit.noticeDock}>
        <ChatNotice
          label={failure ? `The log didn't load — ${failure}` : "The log didn't load."}
          solid={solid}
          action={{ label: 'Retry', onPress: refetch }}
        />
      </View>
    );
  }

  if (messages.length === 0) {
    return (
      <View style={kit.noticeDock}>
        <ChatNotice label={emptyLabel ?? 'Say something.'} solid={solid} />
      </View>
    );
  }

  return (
    <>
      <FlatList
        data={data}
        inverted
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        // Fires at the top of an inverted list, which is where older pages go.
        onEndReached={onEndReached}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          isFetchingNextPage ? (
            <View style={styles.olderLoader}>
              <ActivityIndicator size="small" color={C.ink3} />
            </View>
          ) : !hasNextPage ? (
            <LogStart />
          ) : null
        }
        contentContainerStyle={styles.content}
        // Tapping a message while the keyboard is up must not eat the first tap.
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}
        /*
          removeClippedSubviews is deliberately off: combined with `inverted` it
          is a known source of rows rendering blank on Android, and a chat log
          with holes in it is a worse trade than the memory it would save.
        */
        removeClippedSubviews={false}
        initialNumToRender={15}
        maxToRenderPerBatch={12}
        windowSize={11}
      />

      <MessageActionsSheet
        message={selected}
        // The RLS policy also lets lounge owners and mods delete, but the client
        // does not know the viewer's role here; offering an action that the
        // database would reject is worse than not offering it.
        canDelete={selected !== null && selected.userId === viewerId}
        onClose={closeActions}
        onReact={toggleReaction}
        onDelete={deleteMessage}
      />
    </>
  );
}

/** First-load placeholder, in the real card geometry so nothing shifts. */
function ChatSkeleton({ ground = 'screen' }: { ground?: ChatGround }) {
  return (
    <View
      accessibilityLabel="Loading messages"
      style={[styles.skeleton, { paddingHorizontal: ground === 'sheet' ? Space.lg : 18 }]}>
      {SKELETON_CARDS.map((height, index) => (
        <Skeleton key={`${index}-${height}`} width="100%" height={height} radius={Radii.lg} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingVertical: Space.md,
  },
  olderLoader: {
    paddingVertical: Space.lg,
    alignItems: 'center',
  },
  skeleton: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingBottom: Space.lg,
    gap: Space.md,
  },
});
