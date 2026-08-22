/**
 * What is playing next, and whose fault it is.
 *
 * "Anush added this" is not decoration — attribution is the social texture of a
 * shared queue. It is what turns a playlist into a room. The artboard folds it
 * into the subtitle rather than giving it its own line, so a row stays one
 * glance deep: position, art, what it is, how long it runs.
 */

import { Image } from 'expo-image';
import { ListMusic, X } from 'lucide-react-native';
import { memo, useCallback } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View, type ListRenderItemInfo } from 'react-native';

import { AuxButton, BLURHASH_SURFACE, EmptyState, Skeleton } from '@/components/ui';
import { useQueue, useRemoveQueueItem, type QueueEntry } from '@/features/rooms/queries';
import { Colors, Duration, Radius, Space, TOUCH_TARGET, Type } from '@/lib/theme';

const ART_SIZE = 40;
const SKELETON_ROWS = 4;
/** Two mono digits plus air, so 01..99 never reflows the row. */
const INDEX_WIDTH = 18;

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
            <View style={styles.indexSpacer} />
            <Skeleton width={ART_SIZE} height={ART_SIZE} radius={Radius.sm} />
            <View style={styles.meta}>
              <Skeleton width="70%" height={16} />
              <Skeleton width="45%" height={12} />
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
          action={
            /*
              Primary, not accent: an empty queue is the one moment nothing is
              playing, and the artboards draw empty-state CTAs without the live
              colour ("Find a lounge" is a ghost pill, "Back to Home" is ink).
            */
            <AuxButton label="Add a track" onPress={onAddTrack} variant="primary" size="sm" />
          }
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
      {/* A position is a measurement, so it is mono like every other number. */}
      <Text style={styles.index}>{(index + 1).toString().padStart(2, '0')}</Text>

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
        <Text numberOfLines={1} style={styles.subtitle}>
          {`${track.artist} · ${entry.addedByName} added`}
        </Text>
      </View>

      <Text style={styles.length}>{formatDuration(track.duration_ms)}</Text>

      {canRemove ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove ${track.title} from the queue`}
          onPress={() => onRemove(entry.id)}
          style={({ pressed }) => [styles.remove, pressed && styles.removePressed]}>
          <X size={20} strokeWidth={1.6} color={Colors.muted} />
        </Pressable>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  list: {
    paddingTop: Space.lg,
    paddingBottom: Space.xxl,
    gap: Space.md,
  },
  skeletonWrap: {
    paddingTop: Space.lg,
    gap: Space.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    minHeight: ART_SIZE + Space.md,
  },
  index: {
    ...Type.mono,
    color: Colors.muted,
    width: INDEX_WIDTH,
    flexGrow: 0,
    flexShrink: 0,
  },
  /** Holds the index column open in the loading state without a text style. */
  indexSpacer: {
    width: INDEX_WIDTH,
    flexGrow: 0,
    flexShrink: 0,
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
    minWidth: 0,
    gap: 1,
  },
  title: {
    ...Type.bodyStrong,
    color: Colors.text,
  },
  subtitle: {
    ...Type.caption,
    color: Colors.muted,
  },
  length: {
    ...Type.mono,
    color: Colors.muted,
    flexGrow: 0,
    flexShrink: 0,
  },
  remove: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    // Keeps 8px of clear space between the row body and this target.
    marginLeft: -Space.xs,
    marginRight: -Space.md,
  },
  removePressed: {
    opacity: 0.6,
  },
});
