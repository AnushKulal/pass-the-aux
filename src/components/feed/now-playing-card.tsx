/**
 * One Feed row — who is listening, to what, and how far in.
 *
 * design/nocturne/aux-nocturne.dc.html, the `feed` loop at L281-298, and the
 * user's own home-screen capture of that prototype. Two rows inside one card:
 *
 *   row 1 — the artwork tile, the track, "Artist · LOUNGE", and a CORAL entry
 *           pill on the right: JOIN when there is a Session to walk into, SOLO
 *           when this person is listening alone and there is nothing to join.
 *   row 2 — the listener's face, their handle, a coral progress bar filling the
 *           width, and the timecode.
 *
 * The bar and the timecode are the point of the screen. They advance against
 * the SERVER clock on a 250ms tick, interpolated from the last presence beat,
 * so several cards ticking at once is the moment the product explains itself.
 *
 * === THE ACCENT RULE, AND A CORRECTION THIS PASS MAKES ===
 *
 * This file used to carry a long comment insisting the Join button be BLUE,
 * on the reasoning that "coral is state, blue is action, and joining is an
 * action". That comment has been deleted, because the ruling was wrong. The
 * user supplied a screenshot of their own design and the JOIN pill on the home
 * feed is unambiguously coral; the only blue on that screen is the create FAB
 * and the "See all" link. The rule is therefore:
 *
 *   CORAL = state AND live-entry. Live dots, progress fill, listening counts,
 *           and JOIN / SOLO — entering something that is live is the one action
 *           the state colour owns, because the thing you are entering IS the
 *           state.
 *   BLUE  = create and transport. Start a Session, play/pause, form submit.
 *
 * So this card is now coral throughout and carries no blue at all.
 *
 * === THREE DEVIATIONS FROM THE ARTBOARD, ALL DELIBERATE ===
 *
 * 1. THE IDLE SKIN IS GONE, AND THAT REVERSES AN EARLIER DECISION HERE.
 *    Rows for people listening alone used to be drawn flat — no fill, no edge,
 *    no shadow — with the stated reason that "giving them a card with no Join
 *    on it would promise something the row cannot deliver". The SOLO pill now
 *    says it in words, so the promise is no longer implied and no longer has to
 *    be withheld. Every row is a `GlassCard`, which is what the design shows and
 *    what the user asked for: one column of glass with the ambient blobs reading
 *    through it. Idle rows still step every value down one ink and drop the
 *    coral badge, so the hierarchy survives without the missing card.
 * 2. The entry pill is NOT a nested button. `Pressable` is `accessible` by
 *    default, so the card is one element to a screen reader and a button inside
 *    it would be announced as a second, identical action. The card already owns
 *    the press — a tap on the pill falls through to it — so JOIN and SOLO are
 *    both static labels describing the row, structurally identical, differing
 *    only in the skin. See `EntryPill`.
 * 3. The artboard makes the person's row its own tap target (`f.onProfile`).
 *    There is no route for somebody else's profile in this app — `(tabs)/
 *    profile` is your own — so it would be a target that does nothing. The
 *    person is drawn, not pressed, until that screen exists.
 */

import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { memo, useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type TextStyle } from 'react-native';
import Animated from 'react-native-reanimated';

import { LiveDot } from '@/components/feed/live-dot';
import { Avatar, BLURHASH_SURFACE, GlassCard, ProgressBar, useToast } from '@/components/ui';
import { livePositionMs } from '@/features/presence/presence-client';
import type { FeedEntry } from '@/features/presence/use-lounge-presence';
import { serverNow } from '@/lib/clock';
import { useEntrance } from '@/lib/entrance';
import { Duration, Fonts, Radii, Rule, Space, Type, bloom, tracking } from '@/lib/theme';
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

/** L288: `min-height:44px;padding:0 15px` on the entry pill. */
const PILL_HEIGHT = 44;
const PILL_PAD = 15;

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
 * The server clock, ticking. Exported so the Feed's resume card rides the same
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

// -------------------------------------------------------------- the entry pill

/**
 * The pill on the right of row 1 — the artboard's L288 geometry exactly: 44
 * tall, 15 across, an 11px extrabold uppercase word on a fully rounded cell.
 *
 * BOTH SKINS ARE CORAL, because both describe the same live state; they differ
 * in whether you can act on it.
 *
 *   join — the solid `live` fill under `onLive` (a warm near-black; white on
 *          coral fails), with a coral bloom under it. This is the pill in the
 *          user's screenshot and the one thing on the row asking to be tapped.
 *   solo — the `liveWash` fill behind a `liveMid` edge. Same hue, a quarter of
 *          the volume: this person is listening alone and there is no Session
 *          to walk into, so the pill reports rather than invites.
 *
 * The artboard draws both as the wash and varies only the text colour. That is
 * the one thing not copied: a wash pill you CAN enter and a wash pill you
 * cannot are indistinguishable at 11px, and the difference between them is the
 * whole question this row answers. Give the actionable one the fill back and
 * the two read apart instantly. Revert by dropping the `join` branch below.
 *
 * Hidden from assistive tech: the card's own label already says "live now" or
 * "listening alone", and a nested element inside an `accessible` Pressable is
 * either unreachable or announced as a second, identical control.
 */
function EntryPill({ kind }: { kind: 'join' | 'solo' }) {
  const C = useColors();
  const join = kind === 'join';

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.pill,
        join
          ? { backgroundColor: C.live, borderColor: C.live, ...bloom(C.glowSoft, 'sm') }
          : { backgroundColor: C.liveWash, borderColor: C.liveMid },
      ]}>
      <Text style={[styles.pillLabel, { color: join ? C.onLive : C.liveText }]}>
        {join ? 'Join' : 'Solo'}
      </Text>
    </View>
  );
}

// -------------------------------------------------------------------- the card

export type NowPlayingCardProps = {
  entry: FeedEntry;
  /**
   * Position in the list. Cards arrive one after another at 55ms steps, which
   * needs to know where in the run this one sits. Handed straight down from
   * `renderItem`, which already has it — nothing here re-derives it, so the
   * card stays memoised.
   */
  index?: number;
};

function NowPlayingCardBase({ entry, index = 0 }: NowPlayingCardProps) {
  const C = useColors();
  const router = useRouter();
  const toast = useToast();
  const nowMs = useFeedClock();

  /*
    `isLive` is not "this person has a track loaded", it is "there is a Session
    here you can walk into" — and it is what picks JOIN over SOLO, lights the
    coral badge on the artwork, and holds the row at full ink.
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
  /*
    "Artist · LOUNGE", with the lounge set in caps — the user's screenshot sets
    the second half of this line as a label rather than as prose, which is what
    keeps a room name from reading like part of the band's name.
  */
  const subtitle =
    track !== null
      ? [artist, entry.loungeName.toUpperCase()].filter(Boolean).join('  ·  ')
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

  /*
    THE ROW'S ARRIVAL — `auxRow`, and it is no longer built here.

    This file used to hand-roll it: its own shared value, its own reduced-motion
    branch, its own `useRef(index * Stagger.feed)` and a 280ms `Duration.enter`
    on a curve that was one control point off the design's. `useEntrance` is
    that same animation, minus two bugs this copy could not fix from in here.

    It keeps the reasoning this copy was right about — the delay is read ONCE
    and held, because presence reorders the Feed the instant somebody starts
    playing and a live `index` would restart the entrance of a card already
    sitting still on screen. What it adds is that it keys off FOCUS rather than
    mount, so the cascade replays every time the Feed is entered instead of once
    per app launch; a tab navigator never unmounts this screen, so the mount
    version was silent from the second tab switch onward — which is exactly when
    it was being asked for. It is also `Duration.row` (240ms) and the 8px lift
    the design actually specifies for a row, where this copy borrowed a module's.
  */
  const entering = useEntrance({ index, kind: 'row' });

  const open = useCallback(() => {
    if (entry.roomId === null) {
      toast.show(`@${entry.username} is listening alone`, 'info');
      return;
    }
    // Object form rather than a template literal: it stays valid under typed
    // routes regardless of whether the route types have been generated yet.
    router.push({ pathname: '/room/[id]', params: { id: entry.roomId } });
  }, [entry.roomId, entry.username, router, toast]);

  return (
    <Animated.View style={entering}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={summary}
        accessibilityHint={isLive ? 'Joins this Session' : undefined}
        onPress={open}
        style={({ pressed }) => [
          styles.row,
          // The artboard's own press (`transform:scale(.985)`), not a fade: a
          // card that dims reads as disabled, and dropping the opacity of a
          // raised surface takes its shadow down with it.
          pressed && styles.pressed,
        ]}>
        <GlassCard>
          <View style={styles.head}>
            <View style={styles.artWrap}>
              <View style={[styles.art, { backgroundColor: C.artwork, borderColor: C.rule }]}>
                {/*
                  Under the cover, so it doubles as the decode placeholder and
                  the error fallback. `artInk` is faint on purpose: artwork is a
                  WELL with a monogram in it, not a bright plate — anything
                  written against the old bright tile (dark ink, a light edge) is
                  wrong here.
                */}
                <Text style={[styles.artGlyph, { color: C.artInk }]}>{glyphFor(title)}</Text>

                {entry.artworkUrl ? (
                  <Image
                    source={{ uri: entry.artworkUrl }}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                    // FlatList recycles cards; without this the previous
                    // listener's cover stays on screen until the new one has
                    // decoded.
                    recyclingKey={`art:${entry.userId}`}
                    placeholder={{ blurhash: BLURHASH_SURFACE }}
                    transition={Duration.press}
                    accessible={false}
                  />
                ) : null}
              </View>

              {/*
                A SIBLING of the tile, not a child: the tile clips its cover, and
                the badge has to overhang that clip on both edges. `badgeRing` is
                the token for a badge punched into glass — the ring is the
                surface behind it, never a new colour, and it must not be
                `surface`, which is 5.5% white and would go see-through over the
                artwork.
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
              <Text
                numberOfLines={1}
                style={[styles.subtitle, { color: isLive ? C.ink2 : C.ink3 }]}>
                {subtitle}
              </Text>
            </View>

            <EntryPill kind={isLive ? 'join' : 'solo'} />
          </View>

          <View style={styles.foot}>
            {/*
              Keyed by user so a recycled card mounts a fresh `Avatar` rather
              than showing the previous listener's face until the new one
              decodes — the same problem `recyclingKey` solves on the cover
              above, which the kit's `Avatar` gives no way to solve from out here.
            */}
            <Avatar
              key={entry.userId}
              uri={entry.avatarUrl}
              name={entry.displayName}
              size={AVATAR}
            />
            <Text numberOfLines={1} style={[styles.handle, { color: isLive ? C.ink2 : C.ink3 }]}>
              @{entry.username}
            </Text>

            {showBar ? (
              <>
                {/*
                  CORAL, and the gradient is `ProgressBar`'s default because a
                  bar is always measuring something that is playing. The flat
                  `ink3` is the paused case — see `playing` above.
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
        </GlassCard>
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
  /** The artboard's gap between feed cards (L280): a flat 12 for every row. */
  row: {
    marginBottom: Space.md,
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

  /* ------------------------------------------------------------ entry pill */

  /** Never shrinks: the pill is the row's answer, so the title gives up its characters first. */
  pill: {
    flexShrink: 0,
    minHeight: PILL_HEIGHT,
    paddingHorizontal: PILL_PAD,
    borderRadius: Radii.pill,
    borderWidth: Rule.hair,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillLabel: {
    ...Type.heading(11),
    letterSpacing: tracking(11, 0.04),
    textTransform: 'uppercase',
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
