/**
 * What is playing next, and whose fault it is.
 *
 * Built from design/v2/aux-v2.dc.html, the Session's queue sheet: one raised
 * card per track, 9px apart, position · art · title · who added it · remove.
 * Rows are cards rather than ruled lines because this list lives inside a
 * sheet, and a sheet full of hairlines reads as a table rather than as a stack
 * of things you can pick up.
 *
 * "@anush added this" is not decoration — attribution is the social texture of
 * a shared queue. It is what turns a playlist into a Session. The artboard
 * folds it into the subtitle rather than giving it its own line, so a row stays
 * one glance deep.
 *
 * The artboard also draws a BUMP control beside each row's remove. There is no
 * reorder RPC — `queue_items.position` is written by `queue_append` and read by
 * `room_advance`, and nothing in `supabase/migrations/` can move a row — so the
 * control is not drawn rather than drawn dead. See the handoff note.
 *
 * Four states: skeleton cards, an empty state that names the one next move, an
 * error with a retry, and the list itself.
 */

import { Image } from 'expo-image';
import { ListMusic, Plus, RotateCw, X } from 'lucide-react-native';
import { memo, useCallback, type ReactNode } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View, type ListRenderItemInfo } from 'react-native';

import { BLURHASH_SURFACE, Skeleton } from '@/components/ui';
import { useQueue, useRemoveQueueItem, type QueueEntry } from '@/features/rooms/queries';
import {
  Fonts,
  Radii,
  Rule,
  Space,
  TOUCH_TARGET,
  Type,
  raised,
  tracking,
} from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

import { formatClock, initialFor, readout } from './drift';

const GUTTER = Space.lg - 2;
/** The artboard's art well inside a queue row. */
const WELL = 44;
const WELL_RADIUS = 13;
const SKELETON_ROWS = 4;
/** Two tabular digits plus air, so 01..99 never reflows the row. */
const INDEX_WIDTH = 22;
/** Visual size of the remove cell; hit slop takes it the rest of the way to 44. */
const REMOVE = 32;
const REMOVE_SLOP = (TOUCH_TARGET - REMOVE) / 2;

export type QueueListProps = {
  roomId: string | null;
  isHost: boolean;
  currentUserId: string | null;
  onAddTrack: () => void;
  /** The now-playing strip the sheet puts above the queue. */
  header?: ReactNode;
};

export function QueueList({ roomId, isHost, currentUserId, onAddTrack, header }: QueueListProps) {
  const { data, isLoading, error, refetch } = useQueue(roomId);
  // `mutate` is stable; the useMutation result object is not, and depending on
  // it would hand every memoised row a fresh callback on each parent render.
  const { mutate: removeItem } = useRemoveQueueItem(roomId);

  const handleRemove = useCallback(
    (queueItemId: string) => {
      removeItem(queueItemId);
    },
    [removeItem]
  );

  const handleRetry = useCallback(() => {
    void refetch();
  }, [refetch]);

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
      <View style={styles.list}>
        {header}
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <QueueRowSkeleton key={index} />
        ))}
      </View>
    );
  }

  if (error && !data) {
    return (
      <View style={styles.list}>
        {header}
        <QueueNotice
          title="The queue did not load"
          body={error instanceof Error ? error.message : 'The connection dropped.'}
          actionIcon={RotateCw}
          actionLabel="Try again"
          onPress={handleRetry}
        />
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
      contentContainerStyle={styles.list}
      ListHeaderComponent={header ? <>{header}</> : null}
      ListEmptyComponent={
        <QueueNotice
          title="Nothing up next"
          body="Whatever anyone adds plays after this. Go first."
          actionIcon={Plus}
          actionLabel="Add a track"
          onPress={onAddTrack}
        />
      }
      ListFooterComponent={
        (data?.length ?? 0) > 0 ? <AddTrackWell onPress={onAddTrack} /> : null
      }
    />
  );
}

const keyExtractor = (item: QueueEntry) => item.id;

// ------------------------------------------------------------------- rows

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
    <View style={[styles.row, { backgroundColor: C.surface }, raised(C)]}>
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
          hitSlop={REMOVE_SLOP}
          onPress={() => onRemove(entry.id)}
          style={({ pressed }) => [styles.remove, pressed ? { backgroundColor: C.liveWash } : null]}>
          <X size={16} strokeWidth={2.2} color={C.ink3} />
        </Pressable>
      ) : null}
    </View>
  );
});

/** The row's own shape, breathing. Not a spinner — this list is a list. */
const QueueRowSkeleton = memo(function QueueRowSkeleton() {
  const C = useColors();

  return (
    <View style={[styles.row, { backgroundColor: C.surface }, raised(C)]}>
      <View style={styles.indexSpacer} />
      <Skeleton width={WELL} height={WELL} style={styles.wellSkeleton} />
      <View style={styles.meta}>
        <Skeleton width="72%" height={14} style={styles.lineSkeleton} />
        <Skeleton width="46%" height={11} style={styles.lineSkeleton} />
      </View>
    </View>
  );
});

// --------------------------------------------------------------- notices

type QueueNoticeProps = {
  title: string;
  body: string;
  actionIcon: typeof Plus;
  actionLabel: string;
  onPress: () => void;
};

/**
 * Empty and error wear the same card, because they are the same shape of
 * moment: one sentence about where you are, and one button out of it.
 */
const QueueNotice = memo(function QueueNotice({
  title,
  body,
  actionIcon: Icon,
  actionLabel,
  onPress,
}: QueueNoticeProps) {
  const C = useColors();

  return (
    <View style={[styles.notice, { backgroundColor: C.surface }, raised(C)]}>
      <ListMusic size={20} strokeWidth={2} color={C.ink3} />
      <Text style={[styles.noticeTitle, { color: C.ink }]}>{title}</Text>
      <Text style={[styles.noticeBody, { color: C.ink2 }]}>{body}</Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={actionLabel}
        onPress={onPress}
        style={({ pressed }) => [
          styles.noticeAction,
          { backgroundColor: C.pill },
          pressed ? styles.dim : null,
        ]}>
        <Icon size={15} strokeWidth={2.4} color={C.pillInk} />
        <Text style={[styles.noticeActionLabel, { color: C.pillInk }]}>{actionLabel}</Text>
      </Pressable>
    </View>
  );
});

/**
 * The artboard draws this as a recessed well. At 50px it is under the size
 * where an inset shadow pair reads as depth on a dark ground — the light half
 * sits at 3.2% alpha and only the dark half survives, which looks like dirt —
 * so it takes the recessed FILL and a hairline instead. Same reading, no smudge.
 */
const AddTrackWell = memo(function AddTrackWell({ onPress }: { onPress: () => void }) {
  const C = useColors();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Add a track to the queue"
      onPress={onPress}
      style={({ pressed }) => [
        styles.add,
        { backgroundColor: C.bgRecessed, borderColor: pressed ? C.rule3 : C.rule },
      ]}>
      <Plus size={16} strokeWidth={2.4} color={C.ink2} />
      <Text style={[styles.addLabel, { color: C.ink2 }]}>Add a track</Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  list: {
    paddingHorizontal: GUTTER,
    paddingBottom: Space.xxl + 2,
    gap: Space.sm + 1,
  },
  dim: {
    opacity: 0.7,
  },

  // -------------------------------------------------------------- the row
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md + 2,
    minHeight: TOUCH_TARGET + Space.sm,
    padding: Space.md - 1,
    borderRadius: Radii.button,
  },
  index: {
    ...readout(12.5),
    width: INDEX_WIDTH,
    flexGrow: 0,
    flexShrink: 0,
    textAlign: 'center',
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
    borderRadius: WELL_RADIUS,
    borderWidth: Rule.hair,
  },
  wellSkeleton: {
    borderRadius: WELL_RADIUS,
  },
  lineSkeleton: {
    borderRadius: Radii.xs,
  },
  wellInitial: {
    ...readout(15),
  },
  meta: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    fontFamily: Fonts.semibold,
    fontSize: 14,
    letterSpacing: tracking(14, -0.01),
  },
  subtitle: {
    ...Type.body(12),
  },
  remove: {
    width: REMOVE,
    height: REMOVE,
    flexGrow: 0,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.sm - 2,
  },

  // ------------------------------------------------------------- notices
  notice: {
    alignItems: 'flex-start',
    gap: Space.sm,
    marginTop: Space.xs,
    padding: Space.lg,
    borderRadius: Radii.lg,
  },
  noticeTitle: {
    ...Type.heading(15),
  },
  noticeBody: {
    ...Type.body(13),
    maxWidth: 380,
  },
  noticeAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm - 2,
    marginTop: Space.xs,
    minHeight: TOUCH_TARGET,
    paddingHorizontal: Space.lg,
    borderRadius: Radii.sm,
  },
  noticeActionLabel: {
    fontFamily: Fonts.semibold,
    fontSize: 13,
    letterSpacing: tracking(13, 0.02),
  },

  // ----------------------------------------------------------- add a track
  add: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.sm + 1,
    marginTop: Space.xs,
    minHeight: 50,
    borderRadius: Radii.md + 1,
    borderWidth: Rule.hair,
  },
  addLabel: {
    fontFamily: Fonts.semibold,
    fontSize: 14,
    letterSpacing: tracking(14, 0.01),
  },
});
