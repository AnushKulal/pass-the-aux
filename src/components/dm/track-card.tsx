/**
 * A shared-track bubble: the track, and the one thing you would want to do with
 * it — **Add to the queue**.
 *
 * Source: `design/nocturne/aux-nocturne.dc.html` L761–L768 — the `isTrack` shape
 * in the DM thread. A 224px card on a coral edge, a kicker across the top, the
 * artwork tile with title and artist beside it, and an action cell along the
 * bottom.
 *
 * ## BOTH ACCENTS APPEAR HERE, AND THAT IS THE POINT
 *
 * The kicker and the frame are CORAL because "somebody put music in front of
 * you" is a state of this message, in the register the palette reserves for
 * music happening. The action is BLUE because adding to the queue is a thing you
 * do. This is exactly the Join-button pattern from the accent rule — badge
 * coral, button blue — and it is why the artboard's coral `ADD TO THE QUEUE`
 * text is the one thing here drawn differently from the design. A coral CTA
 * inside a coral frame would leave the card with no colour left to say which
 * part of it is pressable.
 *
 * The previous direction argued this card should NOT be accent-framed, because
 * a shared track is not a playing track and the red had to keep meaning
 * "playing". That argument dies with the accent split: the red is no longer the
 * action colour, so spending a little of it on a kind marker costs the CTA
 * nothing.
 *
 * ## The artwork is a DARK WELL now
 *
 * This file used to draw the tile as a bright plate. `C.artwork` inverted in
 * nocturne — it is a near-black recess with a faint `artInk` glyph — so the
 * tile is what separates itself from the card by being DARKER, and the hairline
 * that used to contain a bright plate is gone. Do not put it back: a light ring
 * around a dark well reads as a frame with nothing in it, and every real cover
 * that lands on top of it already has its own edge.
 *
 * ## Two deliberate deviations from the artboard, both structural
 *
 * The kicker is a `StatusPill`, not the design's full-bleed strip across the top
 * of the card. Bleeding a child to the edge of a bordered, radius-20 bubble
 * needs `overflow:'hidden'` on the bubble, and on Android a clipping view drops
 * its own `boxShadow` — the card would silently lose its lift on one platform.
 * The pill says the same thing in the same colour and costs nothing.
 *
 * The action is `AuxButton variant="pri"`, not a flat text cell: it is the house
 * CTA at the design's own 46px, and hand-rolling a second pill language inside a
 * message bubble is how the button vocabulary starts to drift.
 *
 * "In a Session" is read from the playback store rather than from a route
 * param: `usePlayback().roomId` is the Session this device is actually driving,
 * so the card works the same whether you opened the thread from the rail, from
 * a profile, or from inside the Session itself.
 */

import { Image } from 'expo-image';
import { ListPlus, Music } from 'lucide-react-native';
import { memo, useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Bubble } from '@/components/chat/bubble-kit';
import { AuxButton, BLURHASH_SURFACE, Divider, StatusPill, useToast } from '@/components/ui';
import type { DmTrack } from '@/features/dm';
import { useAddToQueue } from '@/features/rooms/queries';
import { usePlayback } from '@/playback/store';
import { Duration, Fonts, Radii, Space, Type, tracking } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

/** L761's 224px, less the 10px the thread's own gutters take back. */
const CARD_WIDTH = 214;
/** L764: a 42px tile at radius 14. */
const ARTWORK = 42;

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

  const canQueue = Boolean(track && roomId);
  /** Why the action is off, in as few words as say it. Null when it is on. */
  const blockedReason = !track
    ? 'Track unavailable'
    : !roomId
      ? 'Join a Session to queue this'
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
    <Bubble mine={mine} tone="surface" card style={[styles.card, { borderColor: C.liveMid }]}>
      {/*
        The kind marker. `accent` and not `liveWash`: at 9px inside a 214px card
        the wash tone is a whisper, and this is the thing that lets you find the
        one track somebody sent you while scrolling past forty lines of text.
      */}
      <StatusPill tone="accent" label="Shared a track" />

      <View style={styles.identity}>
        <View style={[styles.artwork, { backgroundColor: C.artwork }]}>
          {/* The glyph sits under the image, so it doubles as the error state. */}
          <Music size={17} strokeWidth={2} color={C.artInk} />
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
          <Text numberOfLines={1} style={[styles.artist, { color: C.ink3 }]}>
            {artist}
          </Text>
        </View>
      </View>

      {trimmedCaption ? (
        <Text style={[styles.caption, { color: C.ink2 }]}>{trimmedCaption}</Text>
      ) : null}

      {canQueue ? (
        <View style={styles.action}>
          <AuxButton
            label={addToQueue.isPending ? 'Adding' : 'Add to the queue'}
            onPress={onAdd}
            variant="pri"
            size="sm"
            icon={ListPlus}
            loading={addToQueue.isPending}
            fullWidth
          />
        </View>
      ) : (
        /*
          A REASON, not a dead button. A disabled control whose own label is the
          explanation for why it is disabled is a control you have to press to
          understand — and a greyed pill inside a coral frame is also the one
          shape on this card that would compete with the frame. When there is a
          Session to queue into, the button appears; until then the card says
          plainly why there is nothing to press.
        */
        <>
          <Divider style={styles.rule} />
          <Text style={[styles.blocked, { color: C.ink3 }]}>{blockedReason}</Text>
        </>
      )}
    </Bubble>
  );
}

export const TrackCard = memo(TrackCardBase);

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    gap: Space.md,
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  artwork: {
    width: ARTWORK,
    height: ARTWORK,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.md,
    overflow: 'hidden',
  },
  text: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontFamily: Fonts.semibold,
    fontSize: 13,
    lineHeight: 17,
    letterSpacing: tracking(13, -0.01),
  },
  artist: {
    ...Type.body(11),
    marginTop: 2,
  },
  caption: {
    ...Type.body(12),
    // The card's own `gap` already spaces it; this only pulls it a little
    // tighter to the artist line it belongs to.
    marginTop: -Space.xs,
  },
  action: {
    // `AuxButton` is `alignSelf:'flex-start'` by default and `fullWidth` only
    // stretches it inside a stretching parent, which a `gap` column is not.
    alignSelf: 'stretch',
  },
  rule: {
    marginTop: -Space.xs,
  },
  blocked: {
    ...Type.body(11.5),
    marginTop: -Space.xs,
  },
});
