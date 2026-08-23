/**
 * The bubble language, shared by every chat surface in the app.
 *
 * There are two logs — the DM thread (`@/components/dm/message-bubble`) and the
 * lounge / Session log (`@/components/chat/message-row`) — and they were built
 * a month apart, so they did not match: one was a bubble column, the other a
 * flat Discord-style row. This file is the single drawing both now render
 * through, so a message looks the same wherever it is read.
 *
 * The grammar, from `design/v2/aux-v2.dc.html`, screen "Thread":
 *
 *  - THEIRS sits left on `surface`, raised off the ground, with the bottom-left
 *    corner cut to 6.
 *  - YOURS sits right on the ACCENT, with the bottom-right corner cut instead.
 *    This is the one legitimate accent fill in a log: "this one is mine" is the
 *    only distinction a thread actually has to make, and alignment alone fails
 *    the moment a bubble is wide enough to reach both edges.
 *  - Attachments — a track, a photo, a file, a voice note — keep `surface` on
 *    BOTH sides. They carry their own frame, and a red field behind a red-framed
 *    card would spend the accent on decoration.
 *
 * DENSITY, NOT DRAMA. A thread is read, not admired: 14px body, 10px between
 * bubbles, and the small `raised()` recipe rather than `raisedLarge()`. The
 * accent bubble takes NO shadow at all — a coloured fill on a dark ground is
 * already separated, and a drop shadow under every one of your own messages is
 * the fastest way to make a log look like a pile of cards.
 */

import { memo, type ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { Avatar } from '@/components/ui';
import {
  Fonts,
  Radii,
  Rule,
  Space,
  TOUCH_TARGET,
  Type,
  raised,
  tracking,
  type Palette,
} from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

/** The design's 30px identity avatar. */
export const BUBBLE_AVATAR = 30;
/** Half the difference between the avatar and its 44px target. */
const AVATAR_SLOP = (TOUCH_TARGET - BUBBLE_AVATAR) / 2;
/** Pulls a 44px name target back to the height of the text inside it. */
const NAME_INSET = 13;

/**
 * A bubble never spans the column — the free edge on one side is half of what
 * says who spoke. The design's 76%, and 82% for the wider attachment cards.
 */
export const BUBBLE_MAX_WIDTH = '76%';
export const CARD_MAX_WIDTH = '82%';

/** Vertical rhythm between bubbles in a run, and between runs. */
export const BUBBLE_GAP = 10;

/** `@mira`, `@sol_r`. Split, not replace, so the surrounding text survives. */
export const MENTION = /(@[A-Za-z0-9_]{1,32})/g;

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
 * `fill`    — your own words. The accent.
 * `surface` — their words, and every attachment on either side.
 */
export type BubbleTone = 'fill' | 'surface';

/** The ink that reads on a given tone. Never guess this at a call site. */
export function bubbleInk(C: Palette, tone: BubbleTone) {
  const fill = tone === 'fill';
  return {
    body: fill ? C.onLive : C.ink,
    /*
      Accent-on-accent is invisible, so inside your own bubble a handle is
      carried by WEIGHT instead of by colour. `ink` would work on the light
      theme and vanish on the dark one, where it is the same near-white as
      `onLive` — so both themes use `onLive` at 800.
    */
    mention: fill ? C.onLive : C.liveText,
    mentionFont: fill ? Fonts.extrabold : Fonts.semibold,
    meta: fill ? C.onLive : C.ink2,
  };
}

/* --------------------------------------------------------------------- body */

/**
 * The body, with handles lifted out of it.
 *
 * Nested `<Text>` rather than a row of views, so a mention still wraps mid-line
 * with the words around it instead of becoming an unbreakable block.
 */
export const BubbleBody = memo(function BubbleBody({
  text,
  tone,
}: {
  text: string;
  tone: BubbleTone;
}) {
  const C = useColors();
  const ink = bubbleInk(C, tone);
  const parts = text.split(MENTION);

  return (
    <Text
      selectable
      style={[
        styles.body,
        // Your own words carry a step of weight: white on the accent needs it,
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
 * The cut corner points at its own edge — bottom-left for theirs, bottom-right
 * for yours — which is what makes a column of bubbles read as two speakers
 * rather than as a ragged list.
 */
export function Bubble({ mine, tone, card = false, children, style }: BubbleProps) {
  const C = useColors();
  const fill = tone === 'fill';

  return (
    <View
      style={[
        card ? styles.card : styles.bubble,
        mine ? styles.cornerMine : styles.cornerTheirs,
        { backgroundColor: fill ? C.live : C.surface },
        // The accent fill separates itself. Only the surface bubble is lifted,
        // and only by the small recipe.
        fill ? null : raised(C),
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
 * Never drawn on your own side: the accent fill and the right edge already name
 * the sender, and a column of your own avatars would be the loudest thing on a
 * screen where the red is supposed to mean something.
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
 * Not under every bubble: a timestamp per line doubles the height of a log
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

/** Carries the 40px action pill to the 44px floor. */
const NOTICE_SLOP = { top: 2, bottom: 2, left: 0, right: 0 } as const;

export type ChatNoticeProps = {
  /** One line. Never a paragraph, and always a thing to do or to know. */
  label: string;
  action?: { label: string; onPress: () => void };
};

/**
 * The one figure every chat surface uses where a list would be — empty, failed,
 * or filtered to nothing. A raised card, one line, and at most one way out.
 *
 * Shared so the inbox, the DM thread and the lounge log cannot drift into three
 * different ways of saying "there is nothing here".
 *
 * Deliberately NOT `@/components/ui/empty-state`: this one sits INSIDE a
 * message log, in the position a bubble would occupy, so it carries no icon
 * tile and no display-size title. A chat log that is merely empty should read
 * as a quiet line in the conversation, not as a full-page announcement that
 * something has gone wrong. The shared card is for screens; this is for logs.
 */
export const ChatNotice = memo(function ChatNotice({ label, action }: ChatNoticeProps) {
  const C = useColors();

  return (
    <View style={[styles.notice, { backgroundColor: C.surface }, raised(C)]}>
      <Text numberOfLines={2} style={[styles.noticeLabel, { color: C.ink2 }]}>
        {label}
      </Text>
      {action ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action.label}
          onPress={action.onPress}
          hitSlop={NOTICE_SLOP}
          style={({ pressed }) => [
            styles.noticeAction,
            { backgroundColor: pressed ? C.cream : C.pill },
          ]}>
          <Text numberOfLines={1} style={[styles.noticeActionLabel, { color: C.pillInk }]}>
            {action.label}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
});

export const styles = StyleSheet.create({
  /* ------------------------------------------------------------- the bubble */
  bubble: {
    paddingHorizontal: 15,
    paddingVertical: Space.md,
    borderRadius: Radii.lg,
  },
  card: {
    padding: Space.md,
    borderRadius: Radii.lg,
  },
  /** The cut corner points at the speaker's own edge. */
  cornerTheirs: {
    borderBottomLeftRadius: 6,
  },
  cornerMine: {
    borderBottomRightRadius: 6,
  },

  body: {
    ...Type.body(14),
    lineHeight: 20,
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
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    minHeight: TOUCH_TARGET + Space.xs,
    padding: 15,
    borderRadius: Radii.lg,
  },
  noticeLabel: {
    flex: 1,
    minWidth: 0,
    ...Type.body(13.5),
  },
  noticeAction: {
    minHeight: 40,
    flexShrink: 0,
    justifyContent: 'center',
    paddingHorizontal: Space.lg,
    borderRadius: Radii.xs,
  },
  noticeActionLabel: {
    fontFamily: Fonts.semibold,
    fontSize: 12.5,
    lineHeight: 16,
  },
});
