/**
 * The lounge / Session log.
 *
 * Newest-first data rendered `inverted`, decorated with run and day boundaries,
 * and drawn through `./bubble-kit` — the same bubble language the DM thread
 * uses. All four states live here: a skeleton of the real bubble geometry, a
 * failure that offers the retry, an empty log that says what to do, and the log
 * itself.
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
  BUBBLE_GAP,
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

/** Alternating widths and sides read as "messages are coming", not as breakage. */
const SKELETON_BUBBLES = [
  { width: '62%', height: 44, mine: false },
  { width: '48%', height: 44, mine: true },
  { width: '74%', height: 66, mine: false },
  { width: '40%', height: 44, mine: true },
  { width: '58%', height: 44, mine: false },
] as const;

export type ChatListProps = ChatScope & {
  /** Copy for the empty state, which differs between a lounge and a Session. */
  emptyLabel?: string;
  /** Forwarded to every row: avatars and names become profile targets. */
  onOpenProfile?: (userId: string) => void;
};

type Decorated = {
  message: ChatMessage;
  showHeader: boolean;
  /** Last of its run: the one row of the run that carries a timestamp. */
  showStamp: boolean;
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
 * inverted-chat bug: avatars appear on the last message of a run instead of the
 * first.
 *
 * `showStamp` is the mirror of that: the visually LAST message of a run is the
 * one whose NEWER neighbour — index − 1 — starts a fresh run.
 */
function decorate(messages: ChatMessage[]): Decorated[] {
  const rows = messages.map((message, index) => {
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
      showStamp: false,
      daySeparator: newDay ? dayLabel(message.createdAt) : null,
    };
  });

  for (let index = 0; index < rows.length; index += 1) {
    rows[index].showStamp = index === 0 || rows[index - 1].showHeader;
  }

  return rows;
}

export function ChatList({
  loungeId,
  roomId,
  emptyLabel,
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
        showStamp={item.showStamp}
        daySeparator={item.daySeparator}
        onLongPress={openActions}
        onToggleReaction={toggleReaction}
        onOpenProfile={onOpenProfile}
      />
    ),
    [openActions, toggleReaction, onOpenProfile, viewerId],
  );

  const closeActions = useCallback(() => setSelected(null), []);

  const onEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (isPending) return <ChatSkeleton />;

  if (isError && messages.length === 0) {
    return (
      <View style={kit.noticeDock}>
        <ChatNotice label="The log didn't load." action={{ label: 'Retry', onPress: refetch }} />
      </View>
    );
  }

  if (messages.length === 0) {
    return (
      <View style={kit.noticeDock}>
        <ChatNotice label={emptyLabel ?? 'Say something.'} />
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

/** First-load placeholder, in the real bubble geometry so nothing shifts. */
function ChatSkeleton() {
  return (
    <View accessibilityLabel="Loading messages" style={styles.skeleton}>
      {SKELETON_BUBBLES.map((bubble) => (
        <View
          key={`${bubble.width}-${bubble.height}`}
          style={[styles.skeletonRow, bubble.mine ? kit.alignEnd : kit.alignStart]}>
          <Skeleton width={bubble.width} height={bubble.height} radius={Radii.lg} />
        </View>
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
    paddingHorizontal: Space.md,
    paddingBottom: Space.lg,
    gap: BUBBLE_GAP,
  },
  skeletonRow: {
    flexDirection: 'row',
  },
});
