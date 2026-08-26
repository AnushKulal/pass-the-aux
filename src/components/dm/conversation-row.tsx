/**
 * One conversation in the Messages inbox.
 *
 * Source: `design/nocturne/aux-nocturne.dc.html` L679–L694 — the inbox row on
 * the isDms screen.
 *
 * ## UNREAD IS CARRIED BY COLOUR NOW, NOT BY LIFT. THIS IS THE CHANGE.
 *
 * The previous direction drew an unread row as a RAISED card and a read one as a
 * flat band, and that lift did the whole job. Nocturne's `raised()` is a single
 * soft shadow with a negative spread — far quieter than the old paired
 * soft-UI recipe — and the artboard gives none of its radius-18 surfaces a
 * shadow at all. Scanning a column of twelve rows for the ones that sit 2px
 * proud is not a thing eyes do.
 *
 * So every row is now the same glass row (fill + hairline + radius 18, no
 * shadow), and unread is said FOUR times in the register the palette reserves
 * for a state of the world:
 *   the edge turns coral (`liveMid`),
 *   the fill steps one rung up the white ladder,
 *   the name goes extrabold and the preview to full ink,
 *   and the count badge is the coral pill with its halo.
 * Any one of those alone is missable; together they read from across the room.
 * Coral is right here for the same reason it is right on a LIVE badge — unread
 * is something that is true of the world right now, not something you do.
 *
 * ## Two destinations in one row
 *
 * **The avatar and the name open the person; the rest opens the thread.** Two
 * nested 44pt targets inside one big one. React Native's responder system hands
 * a gesture to exactly one view — the innermost that claims it — so the outer
 * press does not also fire; react-native-web negotiates the same way, and
 * `stopPropagation()` on the press event covers the DOM path where a click could
 * still bubble past it.
 *
 * Rows stagger in at 50ms steps (`Stagger.messages`). The Feed's 55ms is a
 * different screen with a taller row; do not borrow it. The stagger itself is
 * `useEntrance` now — see the note above the call.
 *
 * NOTE FOR WHOEVER TOUCHES THE INBOX SCREEN NEXT: `messages/index.tsx` inlines
 * its own `ThreadRow` and imports only the three pure helpers below. The metrics
 * here are deliberately identical to that row's so the screen can swap to
 * `<ConversationRow>` with no visual diff — and gain the profile target it
 * currently has no way to offer.
 */

import { memo, useCallback } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type TextStyle,
} from 'react-native';
import Animated from 'react-native-reanimated';

import { Avatar, StatusPill } from '@/components/ui';
import type { DmAuthor, InboxRow } from '@/features/dm';
import { serverNow } from '@/lib/clock';
import { useEntrance } from '@/lib/entrance';
import {
  Fonts,
  Radii,
  Rule,
  Space,
  Stagger,
  TOUCH_TARGET,
  Type,
  tracking,
} from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

/** The artboard's 44px avatar (L683). The row is that plus its 12px band. */
const AVATAR = 44;
const ROW_PAD_V = Space.md;
export const CONVERSATION_ROW_HEIGHT = AVATAR + ROW_PAD_V * 2;

/** The artboard's 10px between rows (L678). Kept on the row so it is drop-in. */
const ROW_GAP = 10;

/** 44 + 0 on every side already clears the floor; the slop is for the ring. */
const AVATAR_SLOP = { top: 2, bottom: 2, left: 2, right: 2 };
/**
 * The name is one line of 15px type, so its target is grown vertically instead.
 * Left slop stays 0: the avatar's target already reaches 2px past its box and
 * the 12px row gap has to keep ≥8px of clear air between the two.
 */
const NAME_SLOP = { top: 14, bottom: 14, left: 0, right: Space.sm };

/**
 * `Type.readout()` freezes `fontVariant` as a readonly tuple, which RN's
 * `TextStyle` (a mutable `FontVariant[]`) will not accept. Re-stating it keeps
 * the tabular figures the readout role exists for.
 */
const readout = (size: number): TextStyle => ({
  ...Type.readout(size),
  fontVariant: ['tabular-nums'],
});

/**
 * The badge voice: 800, uppercase, widely tracked. `Type.label` has the case and
 * the tracking but ships at 600, which goes soft at 9px beside a 15px name.
 * Same helper the inbox screen holds for the same reason.
 */
const badge = (size: number, em: number): TextStyle => ({
  ...Type.heading(size),
  letterSpacing: tracking(size, em),
  textTransform: 'uppercase',
});

/* ------------------------------------------------------------------ presence */

/**
 * What the dot and the status line can honestly say.
 *
 * `hidden` is not "offline": it is somebody who turned `show_activity` off, and
 * the difference matters — we draw nothing rather than reporting a stale guess
 * about a person who asked not to be reported on.
 */
export type PresenceState = 'online' | 'idle' | 'offline' | 'hidden';

/** `touch_last_seen()` is a cheap heartbeat; three minutes tolerates a miss. */
const ONLINE_WINDOW_MS = 3 * 60_000;
const IDLE_WINDOW_MS = 20 * 60_000;

export function presenceFor(
  person: DmAuthor | null | undefined,
  nowMs: number = serverNow(),
): PresenceState {
  if (!person) return 'hidden';
  if (!person.show_activity) return 'hidden';

  const seen = new Date(person.last_seen_at).getTime();
  if (Number.isNaN(seen)) return 'offline';

  // Clamped: a phone clock running ahead of the server must not read as "seen
  // in the future" and fall through to offline.
  const age = Math.max(0, nowMs - seen);
  if (age <= ONLINE_WINDOW_MS) return 'online';
  if (age <= IDLE_WINDOW_MS) return 'idle';
  return 'offline';
}

/** The status word beside the name. Empty when there is nothing to claim. */
export function presenceLabel(state: PresenceState): string {
  switch (state) {
    case 'online':
      return 'ONLINE';
    case 'idle':
      return 'IDLE';
    case 'offline':
      return 'OFFLINE';
    default:
      return '';
  }
}

/* ----------------------------------------------------------------- timestamp */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * The row's right-hand stamp: `NOW`, `7M`, `3H`, `4D`, then `MAR 4`.
 *
 * A number that measures, so it sets as a readout with tabular figures — the
 * column cannot twitch as digits change while the list re-renders.
 */
export function stampFor(iso: string | null | undefined, nowMs: number = serverNow()): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';

  const age = Math.max(0, nowMs - then);
  if (age < MINUTE) return 'NOW';
  if (age < HOUR) return `${Math.floor(age / MINUTE)}M`;
  if (age < DAY) return `${Math.floor(age / HOUR)}H`;
  if (age < 7 * DAY) return `${Math.floor(age / DAY)}D`;

  return new Date(then)
    .toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    .toUpperCase();
}

/* ----------------------------------------------------------------------- row */

export type ConversationRowProps = {
  row: InboxRow;
  /** Position in the list. Drives the 50ms entrance stagger. */
  index?: number;
  /** The row's own press: open the thread. */
  onOpenThread: (conversationId: string) => void;
  /**
   * The avatar and the name. Both land here, and only when there is a person to
   * open — a conversation whose profile row vanished renders inert rather than
   * pushing at nothing.
   */
  onOpenProfile: (person: DmAuthor) => void;
};

function ConversationRowBase({
  row,
  index = 0,
  onOpenThread,
  onOpenProfile,
}: ConversationRowProps) {
  const C = useColors();

  /*
    WAS a hand-rolled shared value + `withDelay(withTiming())` right here, with
    its own `MAX_STAGGER_STEPS = 8` and its own curve. It has moved to
    `useEntrance`, which carries the identical cap and the design's own
    `auxRow` recipe, for two reasons beyond not keeping three copies of one
    behaviour:

      - the local copy fired on MOUNT. A FlatList row does not unmount when you
        leave the inbox and come back, so the entrance played once per app
        launch and was missing from every return to Messages after the first —
        exactly the module switch it exists for. `useEntrance` keys off focus.
      - it ran at `Duration.enter` (280ms) on `Easing.standard`. The design
        gives a ROW `auxRow` at 240ms on cubic-bezier(.2,.85,.2,1); the
        primitive's `kind: 'row'` is that, and the 8px lift is unchanged.

    `Stagger.messages` stays: the step is this screen's, not the primitive's.
  */
  const entering = useEntrance({ index, kind: 'row', step: Stagger.messages });

  const person = row.other;
  const name = person ? person.display_name.trim() || person.username : 'Someone';
  const unread = row.unreadCount > 0;

  const nowMs = serverNow();
  const presence = presenceFor(person, nowMs);
  const online = presence === 'online';
  const status = presenceLabel(presence);
  const stamp = stampFor(row.previewAt ?? row.lastMessageAt, nowMs);

  const hasPreview = row.preview.trim().length > 0;
  const preview = hasPreview
    ? row.previewIsMine
      ? `You: ${row.preview}`
      : row.preview
    : 'No messages yet';

  const openThread = useCallback(() => {
    onOpenThread(row.conversationId);
  }, [onOpenThread, row.conversationId]);

  const openProfile = useCallback(
    (event: GestureResponderEvent) => {
      /*
        Native hands the gesture to this Pressable alone, so the row behind it
        never sees it. On the DOM the click can still bubble, and a tap on a
        name that opened the thread *and* the profile would be the worst kind of
        bug — silent, and only on one platform.
      */
      event.stopPropagation?.();
      if (person) onOpenProfile(person);
    },
    [onOpenProfile, person],
  );

  const summary = [
    name,
    status || null,
    unread ? `${row.unreadCount} unread` : null,
    hasPreview ? preview : 'no messages yet',
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Animated.View style={entering}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={summary}
        accessibilityHint="Opens the conversation"
        /*
          The profile is reachable by touch through two nested targets, which a
          screen reader cannot see inside an accessible container. Exposing it
          as an action on the row itself keeps both destinations available to
          assistive tech without inventing a second focus stop for the avatar
          and a third for the name that both say the same thing.
        */
        accessibilityActions={person ? PROFILE_ACTIONS : undefined}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'profile' && person) onOpenProfile(person);
        }}
        onPress={openThread}
        style={({ pressed }) => [
          styles.row,
          {
            /*
              Hand-rolled rather than `GlassCard variant="row"` for one reason:
              the fill has to move on press AND on unread, and the card
              deliberately does not expose its skin. The recipe is the card's,
              copied exactly — `surface` over a `rule` hairline at radius 18,
              no shadow — so the two stay the same object.

              Both states press one rung further up the same white ladder, so
              the feedback is identical either way and only the resting
              brightness separates them.
            */
            backgroundColor: unread
              ? pressed
                ? C.surface3
                : C.surface2
              : pressed
                ? C.surface2
                : C.surface,
            // The coral edge. See the header: this is half of what replaced the
            // lift, and it is the cue that survives a fast scroll.
            borderColor: unread ? C.liveMid : C.rule,
          },
        ]}>
        {/* Target 1: the avatar. */}
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          disabled={!person}
          hitSlop={AVATAR_SLOP}
          onPress={openProfile}
          style={({ pressed }) => [styles.avatarWell, pressed && styles.targetPressed]}>
          {/*
            The kit's punched hole — a coral disc ringed in the GROUND colour,
            which is what the artboard draws (`border:2.5px solid var(--aux-bg)`)
            even where the avatar sits on a card. Hand-rolling it here to ring it
            in the card colour instead buys a difference of five percent white
            and a second dot to keep in sync with `Avatar`.
          */}
          <Avatar name={name} uri={person?.avatar_url} size={AVATAR} presence={online} />
        </Pressable>

        <View style={styles.identity}>
          <View style={styles.nameLine}>
            {/* Target 2: the name. */}
            <Pressable
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              disabled={!person}
              hitSlop={NAME_SLOP}
              onPress={openProfile}
              style={({ pressed }) => [styles.nameTarget, pressed && styles.targetPressed]}>
              <Text
                numberOfLines={1}
                style={[
                  styles.name,
                  {
                    color: C.ink,
                    fontFamily: unread ? Fonts.extrabold : Fonts.semibold,
                  },
                ]}>
                {name}
              </Text>
            </Pressable>

            {/*
              Coral only for ONLINE — being here now is a state of the world.
              IDLE and OFFLINE are not, and painting them the accent would spend
              it on the two facts nobody is looking for.
            */}
            {status ? (
              <Text style={[styles.status, { color: online ? C.liveText : C.ink3 }]}>
                {status}
              </Text>
            ) : null}
          </View>

          {/* Bright and heavier when unread — the third saying of the same fact. */}
          <Text
            numberOfLines={1}
            style={[
              styles.preview,
              {
                color: !hasPreview ? C.ink3 : unread ? C.ink : C.ink2,
                fontFamily: unread ? Fonts.semibold : Fonts.regular,
              },
            ]}>
            {preview}
          </Text>
        </View>

        <View style={styles.meta}>
          <Text style={[styles.stamp, { color: C.ink3 }]}>{stamp}</Text>

          {/*
            `StatusPill accent + live` is the artboard's badge exactly: coral
            fill, `onLive` warm-black numeral (white on coral fails), and the
            centred 14px halo. Which is why it is the kit pill and not a
            hand-rolled circle with a `live` background.
          */}
          {unread ? (
            <StatusPill
              tone="accent"
              live
              label={row.unreadCount > 99 ? '99+' : String(row.unreadCount)}
              accessibilityLabel={`${row.unreadCount} unread`}
            />
          ) : null}
        </View>
      </Pressable>
    </Animated.View>
  );
}

const PROFILE_ACTIONS = [{ name: 'profile', label: 'Open profile' }] as const;

/**
 * Memoised: realtime commits a message into one thread and the inbox re-renders
 * whole, so every other row gets the same props it already had.
 */
export const ConversationRow = memo(ConversationRowBase);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    minHeight: CONVERSATION_ROW_HEIGHT,
    marginBottom: ROW_GAP,
    paddingVertical: ROW_PAD_V,
    paddingHorizontal: 14,
    borderRadius: Radii.lg,
    /*
      Load-bearing, not decoration. `surface` is 5.5% white and has no edge of
      its own; without the hairline the row reads as a smudge on the ground
      rather than as a card — and the unread state has nothing to turn coral.
    */
    borderWidth: Rule.hair,
  },
  avatarWell: {
    flexShrink: 0,
  },
  targetPressed: {
    opacity: 0.72,
  },
  identity: {
    flex: 1,
    minWidth: 0,
  },
  nameLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  nameTarget: {
    flexShrink: 1,
    justifyContent: 'center',
    /*
      44 wide even for a two-letter name — the artboard sets `min-width:44px`
      on this exact element — and 44 tall through `hitSlop`, so the row keeps
      its 20px line and the artboard's density.
    */
    minWidth: TOUCH_TARGET,
    minHeight: 20,
  },
  name: {
    fontSize: 15,
    lineHeight: 20,
    flexShrink: 1,
  },
  status: {
    ...badge(9, 0.08),
    flexShrink: 0,
  },
  preview: {
    ...Type.body(13),
    lineHeight: 18,
    marginTop: 2,
  },
  meta: {
    flexShrink: 0,
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 6,
    // Keeps the stamp column from shuffling as `NOW` becomes `MAR 4`.
    minWidth: 42,
  },
  stamp: {
    /*
      L690 sets the stamp at 400, not at the readout's 800 — it is the quietest
      thing on the row. The tabular figures are what matter and they survive the
      family swap.
    */
    ...readout(10),
    fontFamily: Fonts.regular,
    letterSpacing: tracking(10, 0.05),
  },
});
