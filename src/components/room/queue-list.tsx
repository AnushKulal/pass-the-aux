/**
 * What is playing next, and whose fault it is.
 *
 * "Anush added this" is not decoration — attribution is the social texture of a
 * shared queue. It is what turns a playlist into a room.
 */

import { Image } from 'expo-image';
import { ListMusic, X } from 'lucide-react-native';
import { memo, useCallback } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View, type ListRenderItemInfo } from 'react-native';

import {
  AuxButton,
  Avatar,
  BLURHASH_SURFACE,
  EmptyState,
  Skeleton,
} from '@/components/ui';
import { useQueue, useRemoveQueueItem, type QueueEntry } from '@/features/rooms/queries';
import { Colors, Duration, Radius, Space, TOUCH_TARGET, Type } from '@/lib/theme';

const ART_SIZE = 48;
const SKELETON_ROWS = 4;

export type QueueListProps = {
  roomId: string | null;
  isHost: boolean;
  currentUserId: string | null;
  onAddTrack: () => void;
};

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, '0')}`;
}

export function QueueList({ roomId, isHost, currentUserId, onAddTrack }: QueueListProps) {
  const { data, isLoading } = useQueue(roomId);
  // `mutate` is stable; the useMutation result object is not, and depending on
  // it would hand every memoised row a fresh callback on each parent render.
  const { mutate: removeItem } = useRemoveQueueItem(roomId);

  const handleRemove = useCallback(
    (queueItemId: string) => {
      removeItem(queueItemId);
    },
    [removeItem]
  );

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<QueueEntry>) => (
      <QueueRow
        entry={item}
        index={index}
        // RLS allows the adder or the host. Anyone else never sees the control,
        // rather than seeing one that fails.
        canRemove={isHost || item.addedById === currentUserId}
        onRemove={handleRemove}
      />
    ),
    [isHost, currentUserId, handleRemove]
  );

  if (isLoading && !data) {
    return (
      <View style={styles.skeletonWrap}>
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <View key={index} style={styles.row}>
            <Skeleton width={ART_SIZE} height={ART_SIZE} radius={Radius.sm} />
            <View style={styles.meta}>
              <Skeleton width="70%" height={16} />
              <Skeleton width="45%" height={13} />
            </View>
          </View>
        ))}
      </View>
    );
  }

  return (
    <FlatList
      data={data ?? []}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      contentContainerStyle={styles.list}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      ListEmptyComponent={
        <EmptyState
          icon={ListMusic}
          title="Nothing queued"
          description="Whatever anyone adds plays next. Go first."
          action={<AuxButton label="Add a track" onPress={onAddTrack} variant="accent" size="sm" />}
        />
      }
    />
  );
}

const keyExtractor = (item: QueueEntry) => item.id;

type QueueRowProps = {
  entry: QueueEntry;
  index: number;
  canRemove: boolean;
  onRemove: (queueItemId: string) => void;
};

const QueueRow = memo(function QueueRow({ entry, index, canRemove, onRemove }: QueueRowProps) {
  const { track } = entry;

  return (
    <View style={styles.row}>
      <Text style={styles.position}>{index + 1}</Text>

      {track.artwork_url ? (
        <Image
          source={{ uri: track.artwork_url }}
          style={styles.art}
          contentFit="cover"
          cachePolicy="memory-disk"
          placeholder={{ blurhash: BLURHASH_SURFACE }}
          transition={Duration.fast}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View style={[styles.art, styles.artFallback]} />
      )}

      <View style={styles.meta}>
        <Text numberOfLines={1} style={styles.title}>
          {track.title}
        </Text>
        <Text numberOfLines={1} style={styles.artist}>
          {track.artist} · {formatDuration(track.duration_ms)}
        </Text>

        <View style={styles.credit}>
          <Avatar uri={entry.addedByAvatar} name={entry.addedByName} size={18} />
          <Text numberOfLines={1} style={styles.creditText}>
            {entry.addedByName} added this
          </Text>
        </View>
      </View>

      {canRemove ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove ${track.title} from the queue`}
          onPress={() => onRemove(entry.id)}
          style={({ pressed }) => [styles.remove, pressed && styles.removePressed]}>
          <X size={20} color={Colors.muted} />
        </Pressable>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  list: {
    paddingBottom: Space.xxl,
    gap: Space.sm,
  },
  skeletonWrap: {
    gap: Space.sm,
    paddingTop: Space.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingVertical: Space.sm,
    minHeight: TOUCH_TARGET + Space.md,
  },
  position: {
    ...Type.caption,
    color: Colors.muted,
    width: 18,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  art: {
    width: ART_SIZE,
    height: ART_SIZE,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surfaceRaised,
  },
  artFallback: {
    backgroundColor: Colors.surfaceRaised,
  },
  meta: {
    flex: 1,
    gap: 2,
  },
  title: {
    ...Type.bodyStrong,
    color: Colors.text,
  },
  artist: {
    ...Type.caption,
    color: Colors.muted,
  },
  credit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    marginTop: Space.xs,
  },
  creditText: {
    ...Type.caption,
    color: Colors.muted,
    flexShrink: 1,
  },
  remove: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    // Keeps 8px of clear space between the row body and this target.
    marginLeft: Space.sm,
  },
  removePressed: {
    opacity: 0.6,
  },
});
