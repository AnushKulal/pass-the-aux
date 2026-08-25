/**
 * What is playing next, and whose fault it is.
 *
 * Built from design/nocturne/aux-nocturne.dc.html L1169–L1196, the Session's
 * queue sheet: a position numeral OUTSIDE the row card, the card itself, and
 * the row's control outside it on the right. Pulling the numeral out of the
 * card is the move that makes this read as an ordered list rather than as a
 * stack of unrelated cards — the numbers form their own column down the left
 * edge and the eye can run it without reading a word.
 *
 * "added by anush" is not decoration — attribution is the social texture of a
 * shared queue. It is what turns a playlist into a Session. The artboard folds
 * it into the subtitle rather than giving it its own line (L1184), so a row
 * stays one glance deep; the duration moves out to its own right-hand column,
 * because a duration is a measurement and measurements line up. `addedByName`
 * falls back to a username, so it is printed without an `@` — it is not
 * reliably a handle.
 *
 * THREE DELIBERATE DEVIATIONS FROM THE ARTBOARD:
 *
 * 1. The artboard's queue row carries no artwork and marks its left edge with a
 *    4px BLUE spine. We keep the thumbnail — it is the fastest way to recognise
 *    a track, and expo-image will often already have it cached from the add
 *    sheet — and the well stands where the spine would have. It also would have
 *    spent the ACTION accent on a decoration that cannot be tapped, which is
 *    the one thing blue may never be used for in this direction.
 *
 * 2. CORAL MARKS ROW ONE, AND ONLY ROW ONE. `useQueue` returns upcoming tracks
 *    only — `room_advance` stamps `played_at` the moment a track starts — so
 *    what is playing is never in this list; it is the header strip above it.
 *    The state worth saying inside the list is "this is what plays when the
 *    current track ends", and that is row one: its numeral and its artwork ring
 *    go coral. Everything below it is a plain, unaccented row.
 *
 * 3. The artboard draws a BUMP control on each row and a whole second sheet
 *    behind it. There is no reorder RPC — `queue_items.position` is written by
 *    `queue_append` and read by `room_advance`, and nothing in
 *    `supabase/migrations/` can move a row — so the control is not drawn rather
 *    than drawn dead, and the footer line says plainly what the order is
 *    instead of leaving people hunting for a drag handle. See the handoff note.
 *
 * Four states: skeleton rows, an empty state that names the one next move, an
 * error with a retry, and the list itself.
 */

import { Image } from 'expo-image';
import { ListMusic, Plus, WifiOff, X } from 'lucide-react-native';
import { memo, useCallback, type ReactNode } from 'react';
import { FlatList, StyleSheet, Text, View, type ListRenderItemInfo } from 'react-native';

import {
  BLURHASH_SURFACE,
  CircleIconButton,
  EmptyState,
  GlassCard,
  PillButton,
  Skeleton,
} from '@/components/ui';
import { useQueue, useRemoveQueueItem, type QueueEntry } from '@/features/rooms/queries';
import { Fonts, Radii, Rule, Space, Type, tracking } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

import { TABULAR, formatClock, initialFor, readout } from './drift';

const GUTTER = Space.lg - 2;
/**
 * One step down from the add sheet's 42px well (L1229). See deviation 1 — the
 * artboard's queue row has no artwork at all, so this size is ours: small
 * enough that the row stays a row, large enough to recognise a cover by.
 */
const WELL = 40;
const WELL_RADIUS = 13;
const SKELETON_ROWS = 4;
/** Two tabular digits plus air, so 01..99 never reflows the row. */
const INDEX_WIDTH = 22;
/** Diameter of the remove circle. `CircleIconButton` grows the target to 44. */
const REMOVE = 36;

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
        <EmptyState
          icon={WifiOff}
          title="The queue did not load"
          description={error instanceof Error ? error.message : 'The connection dropped.'}
          primary={{ label: 'Try again', onPress: handleRetry }}
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
        <EmptyState
          icon={ListMusic}
          title="Nothing up next"
          description="Whatever anyone adds plays after this. Go first."
          primary={{ label: 'Add a track', onPress: onAddTrack }}
        />
      }
      ListFooterComponent={(data?.length ?? 0) > 0 ? <QueueFooter onAdd={onAddTrack} /> : null}
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

  /*
    The one piece of state a queue row can carry. See deviation 2 in the header:
    the playing track lives in the strip above this list, so the accent inside
    the list belongs to whatever plays next.
  */
  const isNext = index === 0;

  const handleRemove = useCallback(() => onRemove(entry.id), [onRemove, entry.id]);

  return (
    <View style={styles.row}>
      {/*
        A position is a measurement, so it is tabular like every other number.
        The coral is the only thing marking row one, and colour alone is not a
        signal — so the numeral spells the state out for a screen reader
        instead of being read as the digits "zero one".
      */}
      <Text
        accessibilityLabel={isNext ? 'Up next' : `Position ${index + 1}`}
        style={[styles.index, { color: isNext ? C.liveText : C.ink3 }]}>
        {(index + 1).toString().padStart(2, '0')}
      </Text>

      {/*
        `solid` rather than the translucent fill: this list is handed to the
        Session's sheet, which the design draws as a blurred glass panel, and a
        5.5%-white card inside a BlurView loses its edge against the blur. On a
        plain ground `surfaceSolid` is the resolved composite of the same
        colour, so the row looks identical either way — this only ever costs
        nothing and saves the sheet from going soft.
      */}
      <GlassCard variant="row" solid style={styles.card}>
        {/*
          A dark WELL with a faint monogram. Artwork inverted in this direction:
          anything here that assumed a bright plate — dark ink on it, a light
          edge around it — would now be drawing on near-black.
        */}
        <View
          style={[
            styles.well,
            { backgroundColor: C.artwork, borderColor: isNext ? C.liveMid : C.rule },
          ]}>
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
            <Text style={[styles.wellInitial, { color: C.artInk }]}>{initialFor(track.title)}</Text>
          )}
        </View>

        <View style={styles.meta}>
          <Text numberOfLines={1} style={[styles.title, { color: C.ink }]}>
            {track.title}
          </Text>
          <Text numberOfLines={1} style={[styles.subtitle, { color: C.ink3 }]}>
            {`${track.artist} · added by ${entry.addedByName}`}
          </Text>
        </View>

        <Text style={[styles.duration, { color: C.ink3 }]}>{formatClock(track.duration_ms)}</Text>
      </GlassCard>

      {/*
        `canRemove` is per row — the adder or the host — so a mixed list would
        end in a ragged right edge without the spacer. Holding the column open
        costs 36px on rows nobody can remove and keeps every card the same width.
      */}
      {canRemove ? (
        <CircleIconButton
          icon={X}
          size={REMOVE}
          tone="ghost"
          accessibilityLabel={`Remove ${track.title} from the queue`}
          onPress={handleRemove}
        />
      ) : (
        <View style={styles.removeSpacer} />
      )}
    </View>
  );
});

/** The row's own shape, breathing. Not a spinner — this list is a list. */
const QueueRowSkeleton = memo(function QueueRowSkeleton() {
  return (
    <View style={styles.row}>
      <View style={styles.indexSpacer} />
      <GlassCard variant="row" solid style={styles.card}>
        <Skeleton width={WELL} height={WELL} radius={WELL_RADIUS} />
        <View style={styles.metaSkeleton}>
          <Skeleton width="72%" height={14} radius={Radii.xs} />
          <Skeleton width="46%" height={11} radius={Radii.xs} />
        </View>
      </GlassCard>
      <View style={styles.removeSpacer} />
    </View>
  );
});

// ------------------------------------------------------------------ footer

/**
 * The one sentence about how this list works, then the one way to add to it.
 *
 * The sentence stands in for the artboard's "hold the ⋯ to place it anywhere"
 * (L1192): the order is fixed here, and saying so plainly is kinder than
 * leaving someone pressing and holding a row that will never move.
 *
 * The button is BLUE because adding is an action. The empty state carries its
 * own CTA, so this only appears under a list that already has rows in it.
 */
const QueueFooter = memo(function QueueFooter({ onAdd }: { onAdd: () => void }) {
  const C = useColors();

  return (
    <View style={styles.footer}>
      <Text style={[styles.footerNote, { color: C.ink3 }]}>
        Tracks play in the order they land. Anyone in the Session can add.
      </Text>
      <PillButton label="Add a track" icon={Plus} onPress={onAdd} />
    </View>
  );
});

const styles = StyleSheet.create({
  list: {
    paddingHorizontal: GUTTER,
    paddingBottom: Space.xxl + 2,
    gap: Space.sm + 1,
  },

  // -------------------------------------------------------------- the row
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  index: {
    ...readout(12),
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
  /**
   * Layout only — the fill, edge and corner belong to `GlassCard`, which is the
   * whole reason this stopped being a hand-rolled surface.
   */
  card: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
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
  wellInitial: {
    ...readout(15),
  },
  meta: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  /**
   * The real rows sit two lines 2px apart, but those lines have line boxes
   * around them and a `Skeleton` is exactly as tall as its `height`. At a 2px
   * gap the two blocks touch and read as one thick bar, so the placeholder
   * takes the optical gap the text has rather than the literal one.
   */
  metaSkeleton: {
    flex: 1,
    minWidth: 0,
    gap: Space.sm,
  },
  title: {
    fontFamily: Fonts.semibold,
    fontSize: 14,
    letterSpacing: tracking(14, -0.01),
  },
  subtitle: {
    ...Type.body(11),
  },
  duration: {
    ...TABULAR,
    fontFamily: Fonts.semibold,
    fontSize: 11,
    flexGrow: 0,
    flexShrink: 0,
  },
  removeSpacer: {
    width: REMOVE,
    flexGrow: 0,
    flexShrink: 0,
  },

  // ------------------------------------------------------------- footer
  footer: {
    gap: Space.md,
    marginTop: Space.sm,
    /* The numeral column is decoration; the note reads as prose against the
       cards above it, not against the numbers. */
    paddingHorizontal: Space.xs,
  },
  footerNote: {
    ...Type.body(11.5),
  },
});
