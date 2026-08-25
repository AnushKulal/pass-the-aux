/**
 * The chat drawing kit: the bubble column, and the chrome every chat surface
 * shares.
 *
 * Sources: `design/nocturne/aux-nocturne.dc.html` — the DM thread at L744–L777,
 * the lounge log at L462–L476, the Session log at L1251–L1264.
 *
 * NOCTURNE SPLITS THE TWO CHAT SURFACES BACK APART, AND THAT IS THE HEADLINE.
 *
 *  - The DM thread is a BUBBLE COLUMN (L749): a 20px bubble, no avatar, no
 *    name. Two people are talking, so which edge a bubble hugs is a complete
 *    answer to "who said this".
 *  - The lounge and Session logs are a CARD LIST (L465, L1253): one glass card
 *    per message carrying avatar, name, time, body and reactions. Six people
 *    are talking, and a six-speaker bubble column is unreadable.
 *
 * The previous direction unified them into one bubble language and this file
 * was that unification. Undoing it is not a reversal of taste — the reason the
 * shapes differ is structural, and the card list lives in `./message-row` now.
 * What is left here is what BOTH still draw.
 *
 * THE OWN-SIDE BUBBLE IS BLUE. THIS IS A CHANGE, AND IT IS THE ACCENT RULE.
 *
 * Coral means a state of the world — live, playing, in sync, on aux, unread.
 * Being the author of a message is not one of those; it is a thing you did, and
 * things you did are blue. The old coral fill also put every second bubble of
 * every DM thread in the same register as the LIVE badge on a session card, and
 * between those two the badge is the one that has to win.
 *
 * DENSITY, NOT DRAMA. A log is read, not admired: 15px body in the thread, 10px
 * between bubbles, and the small `raised()` recipe rather than `raisedLarge()`.
 */

import { memo, type ReactNode } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Pressable,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { Avatar, AuxButton, GlassCard } from '@/components/ui';
import {
  Fonts,
  Rule,
  Space,
  TOUCH_TARGET,
  Type,
  raised,
  tracking,
  type Palette,
} from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

/**
 * The thread bubble's corner, L749. `Radii` has no 20 — `lg` is 18 and `xl` is
 * 22, and both read as a different shape beside the design's own screenshot.
 * Held locally exactly as `GlassCard` holds its 24; both disappear the day the
 * token layer grows the step.
 */
const BUBBLE_RADIUS = 20;

/** The design's 30px identity avatar. */
export const BUBBLE_AVATAR = 30;
/** Half the difference between the avatar and its 44px target. */
const AVATAR_SLOP = (TOUCH_TARGET - BUBBLE_AVATAR) / 2;
/** Pulls a 44px name target back to the height of the text inside it. */
const NAME_INSET = 13;

/**
 * A bubble never spans the column — the free edge on one side is half of what
 * says who spoke. The design's 80% (L747), and 82% for the wider attachment
 * cards.
 */
export const BUBBLE_MAX_WIDTH = '80%';
export const CARD_MAX_WIDTH = '82%';

/** Vertical rhythm between bubbles in a run, and between runs. */
export const BUBBLE_GAP = 10;

/** `@mira`, `@sol_r`. Split, not replace, so the surrounding text survives. */
export const MENTION = /(@[A-Za-z0-9_]{1,32})/g;

/**
 * WHICH GROUND A CHAT SURFACE HAS LANDED ON — and this is not a cosmetic knob.
 *
 * `screen` — the lounge's Chat tab, drawn straight onto the app ground.
 * `sheet`  — the Session log, inside the player's glass panel (L1166:
 *            `background:var(--chrome);backdrop-filter:blur(34px)`).
 *
 * `surface` is 5.5% white. On the plain ground that is a card with the ambient
 * blobs bleeding through it, which is the whole point of the direction. Inside
 * the Session sheet the same token is 5.5% white over a 72% chrome panel over a
 * blur — it composites to very nearly nothing and every message in the log
 * loses its shape. Everything in this folder takes this and swaps to
 * `surfaceSolid` on `sheet`; the design does the same swap by hand, drawing the
 * Session composer on `bg2` (L1280) where the lounge composer is on `--g`
 * (L492).
 */
export type ChatGround = 'screen' | 'sheet';

/** `Type.readout` hands back a readonly fontVariant tuple; TextStyle wants a mutable one. */
export const readout = (size: number): TextStyle => ({
  ...Type.readout(size),
  fontVariant: ['tabular-nums'],
});

export function formatBubbleTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/**
 * What a bubble is made of.
 *
 * `fill`    — your own words. The blue primary.
 * `surface` — their words, and every attachment on either side.
 */
export type BubbleTone = 'fill' | 'surface';

/** The ink that reads on a given tone. Never guess this at a call site. */
export function bubbleInk(C: Palette, tone: BubbleTone) {
  const fill = tone === 'fill';
  return {
    body: fill ? C.pillInk : C.ink,
    /*
      A handle is a LINK, and a link is blue here — the design draws every
      handle it prints in `pri-t` (L490, the mention picker's handle column).
      Inside the blue bubble that same blue is invisible, so there the handle is
      carried by WEIGHT on the white the body already uses.

      This used to be `liveText` on both sides. Coral on a handle spent the
      state accent on a piece of prose.
    */
    mention: fill ? C.pillInk : C.priTint,
    mentionFont: fill ? Fonts.extrabold : Fonts.semibold,
    /** 70% white on the blue; `ink2` on glass. Both clear AA on their fill. */
    meta: fill ? C.onCream2 : C.ink2,
  };
}

/* --------------------------------------------------------------------- body */

export type BubbleBodyProps = {
  text: string;
  tone: BubbleTone;
  /**
   * The card log's 14px/1.5 (L470) instead of the thread's 15px/1.45 (L749).
   *
   * Two sizes rather than a free `size` number: these are the only two the
   * design uses, and a static pair keeps the text style out of the render path
   * on a component that redraws once per message.
   */
  compact?: boolean;
};

/**
 * The body, with handles lifted out of it.
 *
 * Nested `<Text>` rather than a row of views, so a mention still wraps mid-line
 * with the words around it instead of becoming an unbreakable block.
 */
export const BubbleBody = memo(function BubbleBody({
  text,
  tone,
  compact = false,
}: BubbleBodyProps) {
  const C = useColors();
  const ink = bubbleInk(C, tone);
  const parts = text.split(MENTION);

  return (
    <Text
      selectable
      style={[
        compact ? styles.bodyCompact : styles.body,
        // Your own words carry a step of weight: white on the blue needs it,
        // and the design steps the own-side bubble up too.
        tone === 'fill' && styles.bodyMine,
        { color: ink.body },
      ]}>
      {parts.map((part, index) =>
        // split() with one capture group puts the matches on the odd indices.
        index % 2 === 1 ? (
          <Text
            key={`${index}-${part}`}
            style={{ color: ink.mention, fontFamily: ink.mentionFont }}>
            {part}
          </Text>
        ) : (
          part
        ),
      )}
    </Text>
  );
});

/* ------------------------------------------------------------------- shapes */

export type BubbleProps = {
  mine: boolean;
  tone: BubbleTone;
  /** Attachment cards pad evenly; a line of text is padded for its baseline. */
  card?: boolean;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
};

/**
 * The bubble itself: the fill, the corner, and the lift.
 *
 * BOTH SIDES ARE LIFTED NOW. The design gives every shape in the thread the
 * same `--sh` (L749, L752, L761, L767, L770) — the previous direction withheld
 * the shadow from the accent bubble on the theory that a coloured fill
 * separates itself, which was true of a red fill on near-black and is not true
 * of the blue.
 *
 * The `surface` bubble additionally takes the 1px `rule` edge, because 5.5%
 * white has no edge of its own and reads FLAT under any shadow without one.
 * The blue fill is opaque and needs none.
 *
 * THE CUT CORNER IS KEPT, and the design's own bubbles are a uniform 20. It
 * survives for one shape: an attachment card is `surface` on BOTH sides
 * (L761/L767), so on a photo or a file the corner is the only thing besides
 * alignment left naming the speaker.
 */
export function Bubble({ mine, tone, card = false, children, style }: BubbleProps) {
  const C = useColors();
  const fill = tone === 'fill';

  return (
    <View
      style={[
        card ? styles.card : styles.bubble,
        mine ? styles.cornerMine : styles.cornerTheirs,
        {
          backgroundColor: fill ? C.pill : C.surface,
          borderColor: fill ? 'transparent' : C.rule,
        },
        raised(C),
        style,
      ]}>
      {children}
    </View>
  );
}

/* --------------------------------------------------------------- separators */

/** The day break: a hairline out of both sides of a label. */
export const DaySeparator = memo(function DaySeparator({ label }: { label: string }) {
  const C = useColors();

  return (
    <View accessibilityRole="header" style={styles.separator}>
      <View style={[styles.separatorRule, { backgroundColor: C.rule }]} />
      <Text style={[styles.separatorLabel, { color: C.ink3 }]}>{label}</Text>
      <View style={[styles.separatorRule, { backgroundColor: C.rule }]} />
    </View>
  );
});

/**
 * The top of the log, drawn as the same figure — so "this is where it starts"
 * and "this is a new day" read as one system rather than two.
 */
export const LogStart = memo(function LogStart({ label = 'Start' }: { label?: string }) {
  return <DaySeparator label={label} />;
});

/* ----------------------------------------------------------------- identity */

export type BubbleIdentityProps = {
  name: string;
  avatarUrl?: string | null;
  /** Absent and the avatar and name are drawn but are not targets. */
  onPress?: () => void;
};

/**
 * Avatar and name above the first bubble of somebody else's run.
 *
 * The THREAD's identity line — the card log names its author inside the card
 * instead, on the same baseline as the timestamp (L469).
 *
 * Never drawn on your own side: the blue fill and the right edge already name
 * the sender, and a column of your own avatars would be the loudest thing on a
 * screen where the accents are supposed to mean something.
 */
export const BubbleIdentity = memo(function BubbleIdentity({
  name,
  avatarUrl,
  onPress,
}: BubbleIdentityProps) {
  const C = useColors();

  return (
    <View style={styles.identity}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${name}'s profile`}
        disabled={!onPress}
        onPress={onPress}
        style={({ pressed }) => [styles.avatarTarget, pressed && styles.dim]}>
        <Avatar uri={avatarUrl} name={name} size={BUBBLE_AVATAR} />
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${name}'s profile`}
        disabled={!onPress}
        onPress={onPress}
        style={({ pressed }) => [styles.nameTarget, pressed && styles.dim]}>
        <Text numberOfLines={1} style={[styles.name, { color: C.ink }]}>
          {name}
        </Text>
      </Pressable>
    </View>
  );
});

/**
 * The stamp under the LAST bubble of a run, in tabular figures.
 *
 * Not under every bubble: a timestamp per line doubles the height of a thread
 * without adding a fact anyone reads. A message still in flight always shows
 * one, because "has this sent" is a question worth answering immediately.
 */
export const BubbleStamp = memo(function BubbleStamp({
  iso,
  pending = false,
}: {
  iso: string;
  pending?: boolean;
}) {
  const C = useColors();

  return (
    <Text style={[styles.stamp, { color: C.ink3 }]}>
      {formatBubbleTime(iso)}
      {pending ? ' · Sending' : ''}
    </Text>
  );
});

/* ------------------------------------------------------------------ notices */

export type ChatNoticeProps = {
  /** One line. Never a paragraph, and always a thing to do or to know. */
  label: string;
  action?: { label: string; onPress: () => void };
  /**
   * The opaque fill. Set it wherever this lands on anything other than the
   * plain screen ground — inside the Session's blurred sheet, most of all,
   * where a 5.5%-white card over a 72%-chrome panel is barely a shape.
   */
  solid?: boolean;
};

/**
 * The one figure every chat surface uses where a list would be — empty, failed,
 * or filtered to nothing. A card, one line, and at most one way out.
 *
 * Shared so the inbox, the DM thread, the lounge log and the Session log cannot
 * drift into four different ways of saying "there is nothing here".
 *
 * Deliberately NOT `@/components/ui/empty-state`: this one sits INSIDE a
 * message log, in the position a message would occupy, so it carries no icon
 * tile and no display-size title. A chat log that is merely empty should read
 * as a quiet line in the conversation, not as a full-page announcement that
 * something has gone wrong. The shared card is for screens; this is for logs.
 */
export const ChatNotice = memo(function ChatNotice({
  label,
  action,
  solid = false,
}: ChatNoticeProps) {
  const C = useColors();

  return (
    <GlassCard variant="card" solid={solid} padded={false}>
      <View style={styles.notice}>
        <Text numberOfLines={2} style={[styles.noticeLabel, { color: C.ink2 }]}>
          {label}
        </Text>
        {/*
          The retry is an ACTION, so it is the blue gradient pill — the same
          control the rest of the app uses, at the one size that fits beside a
          line of body text. Hand-rolling it here is how a second button
          language starts.
        */}
        {action ? (
          <AuxButton label={action.label} onPress={action.onPress} variant="pri" size="sm" />
        ) : null}
      </View>
    </GlassCard>
  );
});

export const styles = StyleSheet.create({
  /* ------------------------------------------------------------- the bubble */
  bubble: {
    paddingHorizontal: 15,
    paddingVertical: Space.md,
    borderRadius: BUBBLE_RADIUS,
    borderWidth: Rule.hair,
  },
  card: {
    padding: Space.md,
    borderRadius: BUBBLE_RADIUS,
    borderWidth: Rule.hair,
  },
  /** The cut corner points at the speaker's own edge. */
  cornerTheirs: {
    borderBottomLeftRadius: 6,
  },
  cornerMine: {
    borderBottomRightRadius: 6,
  },

  /** The thread, L749. */
  body: {
    ...Type.body(15),
    lineHeight: 22,
  },
  /** The card log, L470. */
  bodyCompact: {
    ...Type.body(14),
    lineHeight: 21,
  },
  bodyMine: {
    fontFamily: Fonts.semibold,
  },

  /* --------------------------------------------------------------- the row */
  row: {
    flexDirection: 'row',
    paddingHorizontal: Space.md,
    paddingVertical: BUBBLE_GAP / 2,
  },
  rowLeading: {
    marginTop: Space.xs,
  },
  alignStart: {
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
  },
  alignEnd: {
    justifyContent: 'flex-end',
    alignItems: 'flex-end',
  },
  column: {
    maxWidth: BUBBLE_MAX_WIDTH,
    gap: Space.xs + 1,
  },
  columnWide: {
    maxWidth: CARD_MAX_WIDTH,
  },
  pending: {
    opacity: 0.6,
  },
  dim: {
    opacity: 0.6,
  },

  /* ---------------------------------------------------------------- chrome */
  separator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingVertical: Space.md,
    paddingHorizontal: Space.md,
  },
  separatorRule: {
    flex: 1,
    height: Rule.hair,
  },
  separatorLabel: {
    ...Type.label(10.5),
    letterSpacing: tracking(10.5, 0.12),
  },

  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: Space.md,
    paddingTop: Space.sm,
  },
  /** 30px of avatar inside 44px of target, without costing 14px of layout. */
  avatarTarget: {
    padding: AVATAR_SLOP,
    margin: -AVATAR_SLOP,
  },
  nameTarget: {
    minHeight: TOUCH_TARGET,
    minWidth: TOUCH_TARGET,
    justifyContent: 'center',
    marginVertical: -NAME_INSET,
    flexShrink: 1,
  },
  name: {
    fontFamily: Fonts.semibold,
    fontSize: 12.5,
    lineHeight: 17,
    letterSpacing: tracking(12.5, 0.01),
  },
  stamp: {
    ...readout(10),
    letterSpacing: tracking(10, 0.06),
    paddingHorizontal: 2,
  },

  /* --------------------------------------------------------------- notices */
  noticeDock: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Space.xl,
  },
  /** Layout only — the fill, the edge and the lift come from `GlassCard`. */
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    minHeight: TOUCH_TARGET + Space.xs,
    paddingVertical: Space.md,
    paddingHorizontal: Space.lg,
  },
  noticeLabel: {
    flex: 1,
    minWidth: 0,
    ...Type.body(13.5),
  },
});
