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
 */

import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  View,
  type ListRenderItemInfo,
} from 'react-native';

import {
  ChatNotice,
  LogStart,
  styles as kit,
  type ChatGround,
} from '@/components/chat/bubble-kit';
import { MessageActionsSheet, MessageRow } from '@/components/chat/message-row';
import { Skeleton } from '@/components/ui';
import {
  useDeleteMessage,
  useMessageSubscription,
  useMessages,
  useToggleReaction,
  useViewerId,
  type ChatMessage,
  type ChatScope,
} from '@/features/chat/queries';
import { Radii, Space } from '@/lib/theme';
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

  const [selected, setSelected] = useState<ChatMessage | null>(null);

  const data = useMemo(() => decorate(messages), [messages]);

  const openActions = useCallback((message: ChatMessage) => setSelected(message), []);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<Decorated>) => (
      <MessageRow
        message={item.message}
        mine={item.message.userId === viewerId}
        showHeader={item.showHeader}
        daySeparator={item.daySeparator}
        ground={ground}
        onLongPress={openActions}
        onToggleReaction={toggleReaction}
        onOpenProfile={onOpenProfile}
      />
    ),
    [openActions, toggleReaction, onOpenProfile, viewerId, ground],
  );

  const closeActions = useCallback(() => setSelected(null), []);

  const onEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const solid = ground === 'sheet';

  if (isPending) return <ChatSkeleton ground={ground} />;

  if (isError && messages.length === 0) {
    return (
      <View style={kit.noticeDock}>
        <ChatNotice
          label="The log didn't load."
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
