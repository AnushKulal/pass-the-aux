import { MessageCircle } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
} from 'react-native';

import { MessageActionsSheet, MessageRow } from '@/components/chat/message-row';
import { AuxButton, EmptyState, Skeleton } from '@/components/ui';
import {
  useDeleteMessage,
  useMessageSubscription,
  useMessages,
  useToggleReaction,
  useViewerId,
  type ChatMessage,
  type ChatScope,
} from '@/features/chat/queries';
import { Colors, Space, Type } from '@/lib/theme';

/** Messages closer together than this from one author render as one run. */
const GROUP_WINDOW_MS = 5 * 60_000;

export type ChatListProps = ChatScope & {
  /** Copy for the empty state, which differs between a lounge and a Session. */
  emptyTitle?: string;
  emptyDescription?: string;
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
 * inverted-chat bug: avatars appear on the last message of a run instead of the
 * first.
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

export function ChatList({ loungeId, roomId, emptyTitle, emptyDescription }: ChatListProps) {
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
        showHeader={item.showHeader}
        daySeparator={item.daySeparator}
        onLongPress={openActions}
        onToggleReaction={toggleReaction}
      />
    ),
    [openActions, toggleReaction],
  );

  const closeActions = useCallback(() => setSelected(null), []);

  const onEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (isPending) return <ChatSkeleton />;

  if (isError && messages.length === 0) {
    return (
      <View style={styles.emptyDock}>
        <EmptyState
          icon={MessageCircle}
          title="Chat didn't load"
          description="Check your connection and try again."
          action={<AuxButton label="Retry" onPress={refetch} variant="ghost" size="sm" />}
        />
      </View>
    );
  }

  if (messages.length === 0) {
    return (
      <View style={styles.emptyDock}>
        <EmptyState
          icon={MessageCircle}
          title={emptyTitle ?? 'No messages yet'}
          description={emptyDescription ?? 'Say something to get it started.'}
        />
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
              <ActivityIndicator size="small" color={Colors.muted} />
            </View>
          ) : !hasNextPage ? (
            <Text style={styles.logStart}>This is the beginning of the conversation.</Text>
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

/**
 * First-load placeholder. Alternating widths and an occasional avatar read as
 * "messages are coming" rather than as a broken layout.
 */
function ChatSkeleton() {
  return (
    <View accessibilityLabel="Loading messages" style={styles.skeleton}>
      {[82, 54, 68, 40, 74, 60].map((width, index) => (
        <View key={width} style={styles.skeletonRow}>
          <View style={styles.skeletonGutter}>
            {index % 2 === 0 ? <Skeleton width={36} height={36} radius={18} /> : null}
          </View>
          <View style={styles.skeletonBody}>
            {index % 2 === 0 ? <Skeleton width={104} height={12} radius={6} /> : null}
            <Skeleton width={`${width}%`} height={14} radius={7} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingVertical: Space.lg,
  },
  emptyDock: {
    flex: 1,
    justifyContent: 'center',
  },
  olderLoader: {
    paddingVertical: Space.lg,
    alignItems: 'center',
  },
  logStart: {
    ...Type.caption,
    // Readable copy, so `muted` — `faint` is under 4.5:1 and is for
    // placeholders and hairlines only.
    color: Colors.muted,
    textAlign: 'center',
    paddingHorizontal: Space.xl,
    paddingBottom: Space.lg,
  },
  skeleton: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: Space.lg,
    paddingBottom: Space.lg,
    gap: Space.lg,
  },
  skeletonRow: {
    flexDirection: 'row',
  },
  skeletonGutter: {
    width: 36 + Space.md,
    paddingRight: Space.md,
  },
  skeletonBody: {
    flex: 1,
    gap: Space.sm,
  },
});
