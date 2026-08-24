/**
 * A shared-track bubble: the track, and the one thing you would want to do with
 * it — **Add to the queue**.
 *
 * Drawn exactly as `design/v2/aux-v2.dc.html` draws it in "Thread": a surface
 * bubble with a bright artwork tile, the title and artist beside it, and a
 * filled action cell across the bottom. Deliberately NOT accent-framed. A track
 * in a thread is a thing you were handed, not a thing that is playing, and the
 * red has to keep meaning the second one. The action cell is the inverted pill,
 * and it drops to a bordered surface cell — stating the reason — the moment
 * pressing it would fail.
 *
 * "In a Session" is read from the playback store rather than from a route
 * param: `usePlayback().roomId` is the Session this device is actually driving,
 * so the card works the same whether you opened the thread from the rail, from
 * a profile, or from inside the Session itself.
 */

import { Image } from 'expo-image';
import { Music } from 'lucide-react-native';
import { memo, useCallback } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { Bubble } from '@/components/chat/bubble-kit';
import { BLURHASH_SURFACE, useToast } from '@/components/ui';
import type { DmTrack } from '@/features/dm';
import { useAddToQueue } from '@/features/rooms/queries';
import { usePlayback } from '@/playback/store';
import { Duration, Fonts, Radii, Rule, Space, Type, tracking } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

/** Wide enough for a title, narrow enough to still read as a bubble. */
const CARD_WIDTH = 214;
const ARTWORK = 46;
/** The design's 38px cell, carried to the 44px floor by its slop. */
const ACTION_HEIGHT = 40;
const ACTION_SLOP = { top: 2, bottom: 2, left: 0, right: 0 } as const;

export type TrackCardProps = {
  /** Null while an optimistic share has not resolved its track row yet. */
  track: DmTrack | null;
  /**
   * The `body` a track message may carry. The payload constraint permits it, so
   * something has to draw it or a note sent with the track disappears.
   */
  caption?: string;
  /** Which edge the bubble's cut corner points at. */
  mine?: boolean;
};

function TrackCardBase({ track, caption, mine = false }: TrackCardProps) {
  const C = useColors();
  const toast = useToast();

  /*
    A raw selector, not a derived object: this component is memoised and sits in
    a long list, and returning `{ roomId }` would allocate a new object on every
    store tick — which is every 250ms while something is playing.
  */
  const roomId = usePlayback((state) => state.roomId);
  const addToQueue = useAddToQueue(roomId);

  const title = track?.title?.trim() || 'Unknown track';
  const artist = track?.artist?.trim() || 'Unknown artist';

  const canQueue = Boolean(track && roomId) && !addToQueue.isPending;
  /** Why the action is off, in as few words as say it. Null when it is on. */
  const blockedReason = !track
    ? 'Track unavailable'
    : !roomId
      ? 'Join a session to queue this'
      : null;

  const onAdd = useCallback(() => {
    if (!track || !roomId) return;
    addToQueue.mutate(track.id, {
      onSuccess: () => toast.show(`${title} added to the queue.`, 'success'),
      onError: (error: Error) =>
        toast.show(error.message || 'Could not add that to the queue.', 'error'),
    });
  }, [addToQueue, roomId, title, toast, track]);

  const trimmedCaption = caption?.trim();

  return (
    <Bubble mine={mine} tone="surface" card style={styles.card}>
      <View style={styles.identity}>
        <View style={[styles.artwork, { backgroundColor: C.artwork }]}>
          {/* The glyph sits under the image, so it doubles as the error state. */}
          <Music size={18} strokeWidth={2} color={C.artInk} />
          {track?.artwork_url ? (
            <Image
              source={{ uri: track.artwork_url }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              cachePolicy="memory-disk"
              placeholder={{ blurhash: BLURHASH_SURFACE }}
              transition={Duration.press}
              accessibilityIgnoresInvertColors
            />
          ) : null}
        </View>

        <View style={styles.text}>
          <Text numberOfLines={1} style={[styles.title, { color: C.ink }]}>
            {title}
          </Text>
          <Text numberOfLines={1} style={[styles.artist, { color: C.ink2 }]}>
            {artist}
          </Text>
        </View>
      </View>

      {trimmedCaption ? (
        <Text style={[styles.caption, { color: C.ink2 }]}>{trimmedCaption}</Text>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Add ${title} to the queue`}
        accessibilityHint={
          blockedReason === 'Join a session to queue this'
            ? 'Join a Session first — there is nowhere to queue this yet'
            : undefined
        }
        accessibilityState={{ disabled: !canQueue, busy: addToQueue.isPending }}
        disabled={!canQueue}
        onPress={onAdd}
        hitSlop={ACTION_SLOP}
        style={({ pressed }) => [
          styles.action,
          canQueue
            ? { backgroundColor: pressed ? C.cream : C.pill }
            : { backgroundColor: C.bgRecessed, borderWidth: Rule.hair, borderColor: C.rule },
        ]}>
        {addToQueue.isPending ? <ActivityIndicator size="small" color={C.pillInk} /> : null}
        <Text numberOfLines={1} style={[styles.actionLabel, { color: canQueue ? C.pillInk : C.ink3 }]}>
          {addToQueue.isPending ? 'Adding' : (blockedReason ?? 'Add to the queue')}
        </Text>
      </Pressable>
    </Bubble>
  );
}

export const TrackCard = memo(TrackCardBase);

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
  },
  artwork: {
    width: ARTWORK,
    height: ARTWORK,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.sm + 1,
    overflow: 'hidden',
  },
  text: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontFamily: Fonts.semibold,
    fontSize: 14,
    lineHeight: 18,
    letterSpacing: tracking(14, -0.01),
  },
  artist: {
    ...Type.body(12),
    marginTop: 2,
  },
  caption: {
    ...Type.body(12),
    marginTop: Space.sm,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.sm,
    height: ACTION_HEIGHT,
    marginTop: 11,
    paddingHorizontal: Space.md,
    borderRadius: Radii.xs,
  },
  actionLabel: {
    fontFamily: Fonts.semibold,
    fontSize: 12.5,
    lineHeight: 16,
    flexShrink: 1,
  },
});
