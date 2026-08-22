/**
 * What is playing next, and whose fault it is.
 *
 * "@anush added this" is not decoration — attribution is the social texture of
 * a shared queue. It is what turns a playlist into a Session. The artboard
 * folds it into the subtitle rather than giving it its own line, so a row stays
 * one glance deep: position, art, what it is, how long it runs, who put it on.
 *
 * The artboard also draws a 44px BUMP control beside each row's remove. There
 * is no reorder RPC — `queue_items.position` is written by `queue_append` and
 * read by `room_advance`, and nothing in `supabase/migrations/` can move a row
 * — so the control is not drawn rather than drawn dead. See the handoff note.
 */

import { Image } from 'expo-image';
import { ListMusic, X } from 'lucide-react-native';
import { memo, useCallback, type ReactNode } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View, type ListRenderItemInfo } from 'react-native';

import { BLURHASH_SURFACE, EmptyState, Skeleton } from '@/components/ui';
import { useQueue, useRemoveQueueItem, type QueueEntry } from '@/features/rooms/queries';
import { Rule, Space, TOUCH_TARGET, Type, tracking } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

import { formatClock, initialFor, readout } from './drift';

const GUTTER = Space.md;
const WELL = 32;
const SKELETON_ROWS = 4;
/** Two tabular digits plus air, so 01..99 never reflows the row. */
const INDEX_WIDTH = 20;

export type QueueListProps = {
  roomId: string | null;
  isHost: boolean;
  currentUserId: string | null;
  onAddTrack: () => void;
  /** The now-playing strip the sheet puts above the queue. */
  header?: ReactNode;
};

export function QueueList({ roomId, isHost, currentUserId, onAddTrack, header }: QueueListProps) {
  const C = useColors();
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
      <View>
        {header}
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <View key={index} style={[styles.row, { borderBottomColor: C.ruleSoft }]}>
            <View style={styles.indexSpacer} />
            <Skeleton width={WELL} height={WELL} radius={0} />
            <View style={styles.meta}>
              <Skeleton width="70%" height={14} radius={0} />
              <Skeleton width="45%" height={11} radius={0} />
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
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      ListHeaderComponent={header ? <>{header}</> : null}
      ListEmptyComponent={
        <EmptyState
          icon={ListMusic}
          title="Nothing queued"
          description="Whatever anyone adds plays next. Go first."
        />
      }
      ListFooterComponent={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add a track to the queue"
          onPress={onAddTrack}
          style={({ pressed }) => [
            styles.add,
            { borderColor: C.live },
            pressed ? { backgroundColor: C.liveWash } : null,
          ]}>
          <Text style={[styles.addLabel, { color: C.liveText }]}>+ Add a track</Text>
        </Pressable>
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
  const C = useColors();
  const { track } = entry;

  return (
    <View style={[styles.row, { borderBottomColor: C.ruleSoft }]}>
      {/* A position is a measurement, so it is tabular like every other number. */}
      <Text style={[styles.index, { color: C.ink3 }]}>
        {(index + 1).toString().padStart(2, '0')}
      </Text>

      <View style={[styles.well, { backgroundColor: C.bgRecessed, borderColor: C.rule }]}>
        {track.artwork_url ? (
          <Image
            source={{ uri: track.artwork_url }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            cachePolicy="memory-disk"
            placeholder={{ blurhash: BLURHASH_SURFACE }}
            accessibilityIgnoresInvertColors
          />
        ) : (
          <Text style={[styles.wellInitial, { color: C.ink3 }]}>{initialFor(track.title)}</Text>
        )}
      </View>

      <View style={styles.meta}>
        <Text numberOfLines={1} style={[styles.title, { color: C.ink }]}>
          {track.title}
        </Text>
        <Text numberOfLines={1} style={[styles.subtitle, { color: C.ink2 }]}>
          {`${track.artist} · ${formatClock(track.duration_ms)} · @${entry.addedByName}`}
        </Text>
      </View>

      {canRemove ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove ${track.title} from the queue`}
          onPress={() => onRemove(entry.id)}
          style={({ pressed }) => [
            styles.control,
            { borderColor: C.rule },
            pressed ? { borderColor: C.danger } : null,
          ]}>
          <X size={18} strokeWidth={2} color={C.ink2} />
        </Pressable>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm + 1,
    minHeight: TOUCH_TARGET + Space.md,
    paddingHorizontal: GUTTER,
    paddingVertical: Space.sm + 1,
    borderBottomWidth: Rule.hair,
  },
  index: {
    ...readout(11),
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
  well: {
    width: WELL,
    height: WELL,
    flexGrow: 0,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: Rule.hair,
  },
  wellInitial: {
    ...readout(13),
  },
  meta: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    ...Type.heading(14),
    letterSpacing: tracking(14, 0.01),
  },
  subtitle: {
    ...Type.body(13),
  },
  control: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    flexGrow: 0,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: Rule.hair,
  },
  add: {
    margin: Space.lg - 2,
    marginBottom: Space.xl,
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: Space.lg - 2,
    borderWidth: Rule.hair,
  },
  addLabel: {
    ...Type.heading(11),
    letterSpacing: tracking(11, 0.1),
    textTransform: 'uppercase',
  },
});
