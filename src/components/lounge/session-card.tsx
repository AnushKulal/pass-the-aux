/**
 * A Session running inside a lounge.
 *
 * design/nocturne/aux-nocturne.dc.html L438-455: a raised card, a pulsing coral
 * dot beside the Session's name, a 52px artwork well, `track — artist`, one
 * quiet line of `host · sync`, and a blue play puck on the right.
 *
 * THIS CARD IS THE ACCENT RULE IN ONE OBJECT, which is why it is worth stating
 * here in full:
 *
 *   CORAL is a STATE of the world — the dot and the Session's own name, because
 *   this room is happening right now whether or not you do anything.
 *   BLUE is an ACTION you take — the play puck, because pressing the card is
 *   how you walk in.
 *
 * They sit 12px apart on the same card and neither borrows the other's colour.
 * The failure mode is painting the puck coral "because the session is live":
 * that is true and it is not what the puck says. It says "press me".
 *
 * REPLACES the Patchbay row this file used to hold — a zero-radius band with a
 * hairline `IN` cell set in coral, which spent the state colour on the one
 * element that was an action. It also carried a private copy of the heartbeat;
 * the kit's `LivePulse` now runs every dot in the app off one clock, at named
 * tempos, so two marks on the same screen cannot beat against each other.
 *
 * THE ONLY SESSION CARD IN THE APP, as of this pass, and it was not before.
 * `src/app/(tabs)/lounge/[id].tsx` carried a private `SessionCell` copy and
 * rendered that, because its header still described this file as the Patchbay
 * row above — a description that stopped being true the moment that row was
 * replaced, but stayed in the comment. Two cards shipped, one was ever drawn.
 * The duplicate is deleted and the lounge screen imports this.
 *
 * IT ARRIVES NOW, WHERE BEFORE IT SIMPLY EXISTED. The Sessions segment used to
 * cross-fade in as one block, so every card in it appeared at the same instant
 * with the same treatment — the "easy fade" the design never asked for. The
 * design animates CONTENT in (`auxRow`: 8px up, fading, one after the next), so
 * this card takes an `index` and hands it to `useEntrance`. Nothing is
 * hand-rolled here: the hook owns the curve, the cap on the stagger and the
 * reduced-motion branch, and it keys off focus so the cascade replays on every
 * entry rather than once per app launch.
 *
 * THE CORAL IS NOW CONDITIONAL, AND THAT IS A CORRECTION. This card used to
 * name every Session in `liveText` unconditionally, under a comment reading
 * "the NAME stays coral, because a paused Session is still a live room you can
 * walk into". That was true of a PAUSED room and false of the room this card
 * actually kept painting: press "Start a Session", back out, and the row sits
 * there with no track and nobody in it, wearing the state accent and the word
 * "0 listening". Coral is still the STATE accent — the fix is about WHEN it
 * shows, not what colour it is. `isSessionLive` in `@/features/lounges/live`
 * decides, and this card calls it on its OWN props rather than taking an
 * `isLive` prop, so no caller can hand it a different answer than the lounge
 * header above it computed.
 */

import { LinearGradient } from 'expo-linear-gradient';
import { Play } from 'lucide-react-native';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { GlassCard, LivePulse } from '@/components/ui';
import { isSessionLive } from '@/features/lounges/live';
import { useEntrance } from '@/lib/entrance';
import { Fonts, PointerEvents, Radii, Rule, Space, Type, tracking } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

export type SessionCardProps = {
  name: string;
  hostName: string;
  /**
   * People in the room this second — `room_participants`, not a running total.
   * Half of the liveness predicate; see the header.
   */
  listeners: number;
  /** `rooms.is_playing`. The other half. */
  isPlaying: boolean;
  /**
   * `artworkUrl` is optional so the shape `useLoungeSessions` already returns
   * assigns without a cast; nothing in the well reads it yet — see the note on
   * `WELL` — but callers should stop stripping it.
   */
  nowPlaying: { title: string; artist: string; artworkUrl?: string | null } | null;
  /**
   * Drift against the host, as the Session screen words it ("in sync",
   * "−412ms"). The artboard's meta line is `host · sync`; without it the line
   * simply loses its second half rather than printing an empty separator.
   */
  syncLabel?: string | null;
  /**
   * Nested inside another `surface` card, or laid over artwork. Two translucent
   * cards stacked composite to ~11% and the inner one stops being an object.
   */
  solid?: boolean;
  /** Position in the Sessions column. Drives the 55ms-per-row entrance stagger. */
  index?: number;
  onPress: () => void;
};

/** L442: a 52px tile at radius 16, and the artboard's own padding of 15. */
const WELL = 52;
const WELL_RADIUS = 16;
const CARD_PADDING = 15;

/** L451: a 40px puck carrying a 15px glyph. */
const PUCK = 40;
const PUCK_GLYPH = 15;

/** Top-to-bottom, matching `linear-gradient(180deg, …)` in the artboard. */
const GRADIENT_TOP = { x: 0.5, y: 0 } as const;
const GRADIENT_BOTTOM = { x: 0.5, y: 1 } as const;

function glyphFor(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed[0]!.toUpperCase() : '·';
}

function SessionCardBase({
  name,
  hostName,
  listeners,
  isPlaying,
  nowPlaying,
  syncLabel,
  solid = false,
  index = 0,
  onPress,
}: SessionCardProps) {
  const C = useColors();
  /* `auxRow`. The lift and the delay belong to the hook — see the header. */
  const entering = useEntrance({ index, kind: 'row' });

  /*
    THE ONE PREDICATE, called on this card's own props. Playing, or somebody in
    the room. Everything coral below hangs off this single boolean, so the dot
    and the name can never disagree with each other or with the "· N live" count
    in the header — that count runs the same function over the same rows.
  */
  const live = isSessionLive({ isPlaying, listeners });

  /*
    "0 listening" was printing on empty rooms, which is the badge's lie in a
    quieter typeface — a count of nobody, dressed as a readout. At zero there is
    no number worth reporting, so the line says the state in words instead. It
    is still `ink3` either way: the card announces live ONCE, in coral, at the
    top, and this line is metadata whichever way it reads.
  */
  const occupancy = listeners > 0 ? `${listeners} listening` : 'nobody listening yet';
  const meta = [`${hostName} on aux`, occupancy, syncLabel].filter(Boolean).join(' · ');

  /*
    The empty case says NOTHING PLAYING YET, and it is the third thing this line
    has said. It was `${hostName} is on aux`, which repeats the meta line
    directly under it word for word; the copy the lounge screen used to render
    fell back to the Session's name, which repeats the coral heading directly
    above it. Both spent the loudest line on the card restating a neighbour. The
    room is named, the host is named — the only fact missing is that the decks
    are empty, so that is what goes here.
  */
  const track = nowPlaying ? `${nowPlaying.title} — ${nowPlaying.artist}` : 'Nothing playing yet';

  return (
    /*
      `Animated.View`, not `View`, and the entrance sits OUTSIDE the Pressable:
      the press already owns `transform: scale(.985)` on the same element, and
      two transforms fighting over one style would make a card pressed mid-
      entrance snap to its resting position.
    */
    <Animated.View style={entering}>
      <Pressable
        accessibilityRole="button"
        // The state the colour carries has to be spoken, not implied: a screen
        // reader gets no coral. "Live" / "Empty" is the whole of what the dot
        // and the name's hue say to everybody else.
        accessibilityLabel={`${name}. ${live ? 'Live' : 'Empty'}. ${track}. ${meta}.`}
        accessibilityHint="Opens this Session"
        onPress={onPress}
        // L438: `style-active="transform:scale(.985)"`. The fill belongs to
        // `GlassCard` and is deliberately not overridable from out here.
        style={({ pressed }) => [pressed && styles.held]}>
        {/* `padded={false}`: the artboard's Session card runs 15px, one step off
            the kit's 16, and overriding a prop-driven padding from `style` is a
            coin toss about array order. */}
        <GlassCard solid={solid} padded={false} style={styles.card}>
          <View style={styles.head}>
            {/*
              `session` is the 1.8s beat the artboard runs on this dot (L445) —
              ambient, "there is a room here", not the 1s urgency of a recording
              light.

              BOTH MARKS NOW READ `live`, WHERE THE DOT READ `isPlaying` AND THE
              NAME READ NOTHING AT ALL. The old split meant a room with four
              people sitting between tracks lost its dot while a room with
              nobody in it kept its coral name — the two halves of one state
              disagreeing on one card. A paused Session with people in it is
              still live and keeps both; an empty idle room is not, and the name
              drops to `ink2`.

              `ink2` AND NOT `ink`: this line is 12px extrabold on open tracking
              — a kicker — sitting directly above a 15px semibold track title in
              `ink`. Handing the kicker the same near-white would put the loudest
              ink in the card on the room's label rather than on what is playing
              in it. Coral could carry that weight because it was saying
              something; grey at full strength is only shouting.
            */}
            {live ? <LivePulse size={7} tempo="session" /> : null}
            <Text numberOfLines={1} style={[styles.name, { color: live ? C.liveText : C.ink2 }]}>
              {name}
            </Text>
          </View>

          <View style={styles.body}>
            {/*
              A dark WELL with a faint monogram — `artwork` inverted in this
              direction and `artInk` is a 22% white. Code written against the old
              bright plate puts dark ink on dark here and loses the letter.
            */}
            <View style={[styles.well, { backgroundColor: C.artwork, borderColor: C.rule }]}>
              <Text style={[styles.wellGlyph, { color: C.artInk }]}>
                {glyphFor(nowPlaying?.title ?? name)}
              </Text>
            </View>

            <View style={styles.text}>
              <Text numberOfLines={1} style={[styles.track, { color: C.ink }]}>
                {track}
              </Text>
              {/* All of it in `ink3`. The card has already said "live" once, in
                  coral, at the top; a second accent down here would make the
                  colour mean "session metadata" instead of "happening now". */}
              <Text numberOfLines={1} style={[styles.meta, { color: C.ink3 }]}>
                {meta}
              </Text>
            </View>

            {/*
              DECORATIVE AND UNTOUCHABLE, deliberately not a `CircleIconButton`.
              The design gives the tap to the whole card; a real button nested
              inside it would trade taps along its edge and read out to a screen
              reader as a second control that does the same thing.
            */}
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[
                styles.puck,
                PointerEvents.none,
                // L451: `0 8px 18px var(--aux-glow)`. A COLOURED bloom — light
                // coming off the puck — never a grey drop shadow, and never the
                // coral `glowSoft`, which would put the state colour under the
                // one element on this card that is an action.
                { boxShadow: [{ offsetX: 0, offsetY: 8, blurRadius: 18, color: C.glow }] },
              ]}>
              <LinearGradient
                colors={[C.priTint, C.pill]}
                start={GRADIENT_TOP}
                end={GRADIENT_BOTTOM}
                style={[StyleSheet.absoluteFill, styles.puckFill]}
              />
              <Play size={PUCK_GLYPH} strokeWidth={2} color={C.pillInk} fill={C.pillInk} />
            </View>
          </View>
        </GlassCard>
      </Pressable>
    </Animated.View>
  );
}

export const SessionCard = memo(SessionCardBase);

const styles = StyleSheet.create({
  /*
    NO BOTTOM MARGIN. It carried `Space.md`, which was invisible while nothing
    rendered this card; its one caller now stacks these in a column that already
    sets `gap: Space.md`, and the two together drew 24px where the artboard's
    Sessions list (L440 `gap:12`) draws 12. Spacing between siblings belongs to
    whatever owns the column, not to the sibling.
  */
  card: {
    padding: CARD_PADDING,
  },
  held: {
    transform: [{ scale: 0.985 }],
  },

  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  name: {
    ...Type.heading(12),
    letterSpacing: tracking(12, 0.06),
    flexShrink: 1,
  },

  body: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    marginTop: Space.md,
  },

  well: {
    width: WELL,
    height: WELL,
    borderRadius: WELL_RADIUS,
    borderWidth: Rule.hair,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  wellGlyph: {
    fontFamily: Fonts.extrabold,
    fontSize: 21,
    lineHeight: 25,
    letterSpacing: tracking(21, -0.02),
  },

  text: {
    flex: 1,
    minWidth: 0,
  },
  track: {
    ...Type.body(15),
    fontFamily: Fonts.semibold,
    lineHeight: 20,
  },
  /*
    The artboard sets this at 10px. Held at 11 for the same reason the token
    layer lightened `ink3`: it is the only place the card says who is on aux and
    whether you are in sync, and 10px regular is under this app's floor for
    something anyone actually has to read.
  */
  meta: {
    ...Type.body(11),
    lineHeight: 16,
    letterSpacing: tracking(11, 0.07),
    marginTop: 3,
  },

  puck: {
    width: PUCK,
    height: PUCK,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    // The gradient is a clipped child, so the puck has to clip; without this
    // Android paints a square gradient behind a round shadow.
    overflow: 'hidden',
  },
  puckFill: {
    borderRadius: Radii.pill,
  },
});
