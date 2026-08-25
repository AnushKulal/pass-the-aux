/**
 * One Feed row — who is listening, to what, and how far in.
 *
 * design/nocturne/aux-nocturne.dc.html, the `feed` loop at L281-298. Two skins
 * of one card:
 *
 *   live — a `GlassCard`: artwork, track, artist, a blue Join, and underneath
 *          it the person, a coral bar and a timecode.
 *   idle — the identical geometry with the card taken away and every value
 *          stepped down one ink. Nothing to join, so nothing lifts off the page.
 *
 * The bar and the timecode are the point of the screen. They advance against
 * the SERVER clock on a 250ms tick, interpolated from the last presence beat,
 * so several cards ticking at once is the moment the product explains itself.
 *
 * THE ACCENT RULE, IN ITS PUREST FORM — this card is where it is easiest to see
 * and easiest to get wrong. Two accents sit on one row:
 *   CORAL is STATE. The pulsing badge on the artwork and the progress fill both
 *   say "this is happening right now".
 *   BLUE is ACTION. The Join button says "you do this".
 * Never one element in both. A Join button tinted coral, or a live badge tinted
 * blue, breaks the only colour rule the app has.
 *
 * THREE DEVIATIONS FROM THE ARTBOARD, ALL DELIBERATE:
 *
 * 1. The artboard's top-right pill is a coral wash (`--aux-live-w`). It is the
 *    JOIN affordance, and an action is blue in this direction — so it became an
 *    `AuxButton variant="pri"` and the coral moved to the badge on the artwork,
 *    where it describes a state rather than inviting a tap.
 * 2. The artboard makes the person's row its own tap target (`f.onProfile`).
 *    There is no route for somebody else's profile in this app — `(tabs)/
 *    profile` is your own — so it would be a target that does nothing. The
 *    person is drawn, not pressed, until that screen exists.
 * 3. The idle skin is not in the artboard, which draws one loop. It is kept
 *    because half the Feed is people listening alone: giving them a card with
 *    no Join on it would promise something the row cannot deliver.
 */

import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type TextStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { LiveDot } from '@/components/feed/live-dot';
import {
  Avatar,
  AuxButton,
  BLURHASH_SURFACE,
  GlassCard,
  ProgressBar,
  useToast,
} from '@/components/ui';
import { livePositionMs } from '@/features/presence/presence-client';
import type { FeedEntry } from '@/features/presence/use-lounge-presence';
import { serverNow } from '@/lib/clock';
import { Duration, Fonts, Rule, Space, Stagger, Type } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

/** The artwork tile, the badge on its corner, and the person under it (L283/L292). */
const ART = 54;
const BADGE = 14;
const AVATAR = 22;

/**
 * The artwork corner, and `Radii` has no step for it — `md` is 14 and `lg` is
 * 18, and at 54px both are visibly wrong beside the card's own 24. Held locally
 * for the same reason `GlassCard` holds its 24; both disappear the day the
 * token layer grows the steps.
 */
const ART_RADIUS = 16;

/** Playback position advances on a 250ms tick. */
const TICK_MS = 250;

/** `Type.readout` hands back a readonly tuple; TextStyle wants a mutable one. */
const readout = (size: number): TextStyle => ({
  ...Type.readout(size),
  fontVariant: ['tabular-nums'],
});

// ------------------------------------------------------------- the shared clock

/**
 * One timer for the entire Feed.
 *
 * Every row advances its own timecode between presence beats, but N rows with N
 * intervals is N wakeups per tick on a phone. They all want the same answer to
 * the same question — what time is it on the server — so they share one timer,
 * and it stops completely when the last subscriber unmounts.
 */
const tickListeners = new Set<(nowMs: number) => void>();
let ticker: ReturnType<typeof setInterval> | null = null;

function subscribeTick(listener: (nowMs: number) => void): () => void {
  tickListeners.add(listener);

  if (ticker === null) {
    ticker = setInterval(() => {
      const now = serverNow();
      for (const notify of tickListeners) notify(now);
    }, TICK_MS);
  }

  return () => {
    tickListeners.delete(listener);
    if (tickListeners.size === 0 && ticker !== null) {
      clearInterval(ticker);
      ticker = null;
    }
  };
}

/**
 * The server clock, ticking. Exported so the Feed's hero card rides the same
 * timer as the rows underneath it instead of starting a second one.
 */
export function useFeedClock(): number {
  const [now, setNow] = useState(serverNow);
  useEffect(() => subscribeTick(setNow), []);
  return now;
}

/** `1:47`. A number that measures, so it sets with tabular figures. */
export function timecode(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1_000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

export function glyphFor(value: string | null | undefined): string {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed[0]!.toUpperCase() : '·';
}

/**
 * Blank strings arrive from the providers as often as nulls do, and an empty
 * artist would otherwise draw a stray separator in the subtitle.
 */
function present(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

// -------------------------------------------------------------------- the card

export type NowPlayingCardProps = {
  entry: FeedEntry;
  /**
   * Position in the list. Cards stagger in at 55ms steps, which needs to know
   * where in the run this one sits.
   */
  index?: number;
};

function NowPlayingCardBase({ entry, index = 0 }: NowPlayingCardProps) {
  const C = useColors();
  const router = useRouter();
  const toast = useToast();
  const nowMs = useFeedClock();
  const reduced = useReducedMotion();

  /*
    `isLive` is not "this person has a track loaded", it is "there is a Session
    here you can walk into" — and it is the only thing on the card allowed to
    reach for the card skin, the coral badge or the Join button. Somebody
    listening alone gets the identical layout flattened onto the ground.
  */
  const isLive = entry.roomId !== null;
  const positionMs = livePositionMs(entry, nowMs);

  /*
    A Session with nothing queued yet is live — you can still walk in — but it
    has no clock to report. A timecode counting up from 0:00 over silence is
    the one number on this screen that would be untrue, and a bar creeping
    across an empty room is the same lie drawn wider.
  */
  const track = present(entry.trackTitle);
  const artist = present(entry.artist);
  const showBar = track !== null && entry.durationMs > 0;

  /*
    Paused is not live. The fill drops to a flat `ink3` rather than staying
    coral, because coral means "happening right now" and a paused peer is the
    one case where the bar is standing still — which is invisible from the bar
    alone once it has stopped moving.
  */
  const playing = track !== null && entry.isPlaying;

  const title = track ?? entry.loungeName;
  const subtitle =
    track !== null
      ? [artist, entry.loungeName].filter(Boolean).join(' · ')
      : isLive
        ? 'Session open — nothing playing yet'
        : 'Not playing anything';

  const summary = [
    track !== null
      ? `${entry.displayName} is playing ${track}`
      : `${entry.displayName} is in ${entry.loungeName}`,
    artist ? `by ${artist}` : null,
    track !== null && !entry.isPlaying ? 'paused' : null,
    showBar ? `${timecode(positionMs)} in` : null,
    isLive ? 'live now' : 'listening alone',
  ]
    .filter(Boolean)
    .join(', ');

  // ---- entrance: translateY(8) → 0 + fade, 55ms per card, off under reduce-motion
  const enter = useSharedValue(reduced ? 1 : 0);
  /*
    The stagger is read once, at mount. Presence reorders the Feed the moment
    somebody starts playing, and reading `index` live would re-run the entrance
    on cards that never left the screen.
  */
  const delay = useRef(index * Stagger.feed);

  useEffect(() => {
    if (reduced) {
      enter.value = 1;
      return;
    }
    enter.value = withDelay(
      delay.current,
      withTiming(1, { duration: Duration.enter, easing: Easing.bezier(0.2, 0.8, 0.2, 1) })
    );
  }, [enter, reduced]);

  const entering = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * 8 }],
  }));

  const open = useCallback(() => {
    if (entry.roomId === null) {
      toast.show(`@${entry.username} is not in a Session`, 'info');
      return;
    }
    // Object form rather than a template literal: it stays valid under typed
    // routes regardless of whether the route types have been generated yet.
    router.push({ pathname: '/room/[id]', params: { id: entry.roomId } });
  }, [entry.roomId, entry.username, router, toast]);

  const body = (
    <>
      <View style={styles.head}>
        <View style={styles.artWrap}>
          <View style={[styles.art, { backgroundColor: C.artwork, borderColor: C.rule }]}>
            {/*
              Under the cover, so it doubles as the decode placeholder and the
              error fallback. `artInk` is faint on purpose: artwork is a WELL
              with a monogram in it now, not a bright plate — anything written
              against the old bright tile (dark ink, a light edge) is wrong here.
            */}
            <Text style={[styles.artGlyph, { color: C.artInk }]}>{glyphFor(title)}</Text>

            {entry.artworkUrl ? (
              <Image
                source={{ uri: entry.artworkUrl }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                cachePolicy="memory-disk"
                // FlatList recycles cards; without this the previous listener's
                // cover stays on screen until the new one has decoded.
                recyclingKey={`art:${entry.userId}`}
                placeholder={{ blurhash: BLURHASH_SURFACE }}
                transition={Duration.press}
                accessible={false}
              />
            ) : null}
          </View>

          {/*
            A SIBLING of the tile, not a child: the tile clips its cover, and the
            badge has to overhang that clip on both edges. `badgeRing` is the
            token for a badge punched into glass — the ring is the surface
            behind it, never a new colour, and it must not be `surface`, which
            is 5.5% white and would go see-through over the artwork.
          */}
          {isLive ? (
            <View style={styles.artBadge}>
              <LiveDot size={BADGE} ringColor={C.badgeRing} ringWidth={3} tempo="session" />
            </View>
          ) : null}
        </View>

        <View style={styles.info}>
          <Text numberOfLines={1} style={[styles.title, { color: isLive ? C.ink : C.ink2 }]}>
            {title}
          </Text>
          <Text numberOfLines={1} style={[styles.subtitle, { color: isLive ? C.ink2 : C.ink3 }]}>
            {subtitle}
          </Text>
        </View>

        {/*
          BLUE, beside a coral badge, on one card. The whole card already opens
          the Session; this is what makes the affordance visible instead of
          secret, which is the one thing the old row never said out loud.

          Hidden from assistive tech deliberately. `Pressable` is `accessible`
          by default, so the card is a single element to a screen reader and a
          nested button inside it would either be unreachable or announced as a
          second, identical action. The card's own hint already says it joins.
        */}
        {isLive ? (
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={styles.join}>
            <AuxButton label="Join" onPress={open} variant="pri" size="sm" />
          </View>
        ) : null}
      </View>

      <View style={styles.foot}>
        {/*
          Keyed by user so a recycled card mounts a fresh `Avatar` rather than
          showing the previous listener's face until the new one decodes — the
          same problem `recyclingKey` solves on the cover above, which the kit's
          `Avatar` gives no way to solve from out here.
        */}
        <Avatar key={entry.userId} uri={entry.avatarUrl} name={entry.displayName} size={AVATAR} />
        <Text numberOfLines={1} style={[styles.handle, { color: isLive ? C.ink2 : C.ink3 }]}>
          @{entry.username}
        </Text>

        {showBar ? (
          <>
            {/*
              CORAL, and the gradient is `ProgressBar`'s default because a bar is
              always measuring something that is playing. The flat `ink3` is the
              paused case — see `playing` above.
            */}
            <ProgressBar
              progress={positionMs / entry.durationMs}
              height={4}
              color={playing ? undefined : C.ink3}
              style={styles.bar}
            />
            <Text style={[styles.elapsed, { color: isLive ? C.ink2 : C.ink3 }]}>
              {timecode(positionMs)}
            </Text>
          </>
        ) : null}
      </View>
    </>
  );

  return (
    <Animated.View style={entering}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={summary}
        accessibilityHint={isLive ? 'Joins this Session' : undefined}
        onPress={open}
        style={({ pressed }) => [
          isLive ? styles.card : styles.flat,
          // The artboard's own press (`transform:scale(.985)`), not a fade: a
          // card that dims reads as disabled, and dropping the opacity of a
          // raised surface takes its shadow down with it.
          pressed && styles.pressed,
        ]}>
        {isLive ? <GlassCard>{body}</GlassCard> : <View style={styles.flatBody}>{body}</View>}
      </Pressable>
    </Animated.View>
  );
}

/**
 * Memoised because presence re-emits the whole lounge roster on every sync:
 * one person changing song must not re-render every other card in the Feed.
 */
export const NowPlayingCard = memo(NowPlayingCardBase);

const styles = StyleSheet.create({
  /** The artboard's gap between feed cards (L280). */
  card: {
    marginBottom: Space.md,
  },
  /*
    The design draws 2px between rows. Every card is a tap target, and two
    targets 2px apart mis-fire — 4 plus the row's own padding is the floor at
    which a near-miss still lands on the card the finger was aimed at.
  */
  flat: {
    marginBottom: Space.xs,
  },
  /*
    An idle card has no fill, no edge and no shadow — the ABSENCE of a card
    rather than a quieter one, which is why `GlassCard` has nothing to offer
    here. It keeps the card's 16px padding anyway: that is what holds every
    artwork tile on one vertical line down a Feed of mixed live and idle rows,
    and the column reading as a list is most of the point of the screen.
  */
  flatBody: {
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
  },
  pressed: {
    transform: [{ scale: 0.985 }],
  },

  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
  },
  artWrap: {
    width: ART,
    height: ART,
  },
  art: {
    width: ART,
    height: ART,
    borderRadius: ART_RADIUS,
    borderWidth: Rule.hair,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  artGlyph: {
    fontFamily: Fonts.extrabold,
    fontSize: 22,
    lineHeight: 26,
    // A single centred glyph, so no tracking: letter-spacing is applied after
    // the last character too, and would shunt one letter left of centre.
    letterSpacing: 0,
  },
  artBadge: {
    position: 'absolute',
    right: -3,
    bottom: -3,
  },

  info: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    ...Type.display(16),
    // `display` sets a 1.06 line height for stacked headlines; a 16px title on
    // one line needs the descender room back or Android clips the tail of a g.
    lineHeight: 19,
  },
  subtitle: {
    ...Type.body(12),
    lineHeight: 16,
    marginTop: 2,
  },
  /** Stops the gradient pill from stretching to the artwork's height. */
  join: {
    flexShrink: 0,
  },

  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: Space.md,
  },
  handle: {
    ...Type.body(11),
    lineHeight: 14,
    // A long handle truncates rather than squeezing the bar out of the row.
    flexShrink: 1,
    minWidth: 0,
  },
  bar: {
    flex: 1,
    // Below this a fill stops reading as a position at all, so the handle is
    // made to give up its characters first.
    minWidth: 56,
  },
  elapsed: {
    ...readout(11),
    flexShrink: 0,
  },
});
