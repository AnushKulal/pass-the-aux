/**
 * A shared-track bubble: the track, and the one thing you would want to do with
 * it — **ADD TO THE QUEUE** (§13).
 *
 * The card is framed in accent because a track someone passed you is a
 * *playable* thing, which is exactly what the red is reserved for. The action
 * cell, though, follows the same discipline the composer's SEND does: it is
 * accent only while pressing it would actually do something. With no Session
 * attached there is nothing to queue into, so the cell drops to ink and states
 * the reason instead of failing after the tap.
 *
 * "In a Session" is read from the playback store rather than from a route
 * param: `usePlayback().roomId` is the Session this device is actually driving,
 * so the card works the same whether you opened the thread from the rail, from
 * a profile, or from inside the Session itself.
 */

import { Image } from 'expo-image';
import { ListPlus, Music } from 'lucide-react-native';
import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BLURHASH_SURFACE, useToast } from '@/components/ui';
import type { DmTrack } from '@/features/dm';
import { useAddToQueue } from '@/features/rooms/queries';
import { usePlayback } from '@/playback/store';
import { Duration, Rule, Space, TOUCH_TARGET, Type, tracking } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

/** The artboard's card. Wide enough for a title, narrow enough to read as a card. */
const CARD_WIDTH = 212;
const ARTWORK = 38;

export type TrackCardProps = {
  /** Null while an optimistic share has not resolved its track row yet. */
  track: DmTrack | null;
  /**
   * The `body` a track message may carry. The payload constraint permits it, so
   * something has to draw it or a note sent with the track disappears.
   */
  caption?: string;
};

function TrackCardBase({ track, caption }: TrackCardProps) {
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
  /** Why the action is off, in the words §13 would use. Null when it is on. */
  const blockedReason = !track
    ? 'TRACK UNAVAILABLE'
    : !roomId
      ? 'JOIN A SESSION TO QUEUE THIS'
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
    <View style={[styles.card, { borderColor: C.live, backgroundColor: C.bg }]}>
      <Text style={[styles.kicker, { backgroundColor: C.live, color: C.onLive }]}>
        SHARED A TRACK
      </Text>

      <View style={styles.identity}>
        <View style={[styles.artwork, { backgroundColor: C.bgRecessed, borderColor: C.rule }]}>
          {/* The glyph sits under the image, so it doubles as the error state. */}
          <Music size={18} strokeWidth={2} color={C.artwork} />
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
        <Text style={[styles.caption, { color: C.ink2, borderTopColor: C.rule }]}>
          {trimmedCaption}
        </Text>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Add ${title} to the queue`}
        accessibilityHint={
          blockedReason === 'JOIN A SESSION TO QUEUE THIS'
            ? 'Join a Session first — there is nowhere to queue this yet'
            : undefined
        }
        accessibilityState={{ disabled: !canQueue, busy: addToQueue.isPending }}
        disabled={!canQueue}
        onPress={onAdd}
        style={({ pressed }) => [
          styles.action,
          {
            borderTopColor: C.rule,
            backgroundColor: pressed && canQueue ? C.liveWash : 'transparent',
          },
        ]}>
        <ListPlus size={15} strokeWidth={2} color={canQueue ? C.liveText : C.ink3} />
        <Text numberOfLines={1} style={[styles.actionLabel, { color: canQueue ? C.liveText : C.ink3 }]}>
          {addToQueue.isPending ? 'ADDING…' : (blockedReason ?? 'ADD TO THE QUEUE')}
        </Text>
      </Pressable>
    </View>
  );
}

export const TrackCard = memo(TrackCardBase);

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    borderWidth: Rule.hair,
  },
  kicker: {
    ...Type.heading(10),
    letterSpacing: tracking(10, 0.1),
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 9,
    paddingVertical: Space.sm + 2,
  },
  artwork: {
    width: ARTWORK,
    height: ARTWORK,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: Rule.hair,
    overflow: 'hidden',
  },
  text: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    ...Type.heading(13),
    letterSpacing: tracking(13, 0.01),
  },
  artist: {
    ...Type.body(11),
  },
  caption: {
    ...Type.body(12),
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderTopWidth: Rule.hair,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    minHeight: TOUCH_TARGET,
    paddingHorizontal: 9,
    borderTopWidth: Rule.hair,
  },
  actionLabel: {
    ...Type.heading(10),
    letterSpacing: tracking(10, 0.09),
    flexShrink: 1,
  },
});
