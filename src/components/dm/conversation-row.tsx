/**
 * One conversation in the Messages inbox (README §13).
 *
 * The row carries THREE facts and TWO destinations, and the design leans on
 * both:
 *
 *  - **Unread renders bright.** Name 800 / preview `ink` 600 when there is
 *    something to read; name 600 / preview `ink2` 400 once there is not. That
 *    contrast is the screen — an inbox where every row shouts equally is a list,
 *    not an inbox — so the weights are picked from `row.unreadCount` and nothing
 *    else, never softened for "consistency".
 *  - **The avatar and the name open the person; the rest opens the thread.**
 *    Two nested 44pt targets inside one big one. React Native's responder system
 *    hands a gesture to exactly one view — the innermost that claims it — so the
 *    outer press does not also fire; react-native-web negotiates the same way,
 *    and `stopPropagation()` on the press event covers the DOM path where a
 *    click could still bubble past it.
 *
 * Rows stagger in at 50ms steps (`Stagger.messages`). The Feed's 55ms is a
 * different screen with a taller row; do not borrow it.
 */

import { memo, useCallback, useEffect, useRef } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type TextStyle,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { Avatar } from '@/components/ui';
import type { DmAuthor, InboxRow } from '@/features/dm';
import { serverNow } from '@/lib/clock';
import { Duration, Fonts, Rule, Space, Stagger, TOUCH_TARGET, Type, tracking } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

/** §13: a 40px avatar. The row is that plus its 10px band, and a hairline. */
const AVATAR = 40;
const ROW_PAD_V = 10;
export const CONVERSATION_ROW_HEIGHT = AVATAR + ROW_PAD_V * 2 + Rule.hair;

/** The presence dot, and the ground-coloured ring that lifts it off the well. */
const DOT = 11;

/** 40 + 2 on every side clears the 44pt floor without moving the avatar. */
const AVATAR_SLOP = { top: 2, bottom: 2, left: 2, right: 2 };
/**
 * The name is one line of 15px type, so its target is grown vertically instead.
 * Left slop stays 0: the avatar's target already reaches 2px past its box and
 * the 10px row gap has to keep ≥8px of clear air between the two.
 */
const NAME_SLOP = { top: 14, bottom: 14, left: 0, right: Space.sm };

/**
 * The stagger is capped rather than run to the end of the list. A row mounted
 * on scroll would otherwise sit invisible for `index × 50ms` before fading in —
 * at row 20 that is a full second of blank band. Eight steps covers the first
 * screenful, which is the only place the stagger is ever perceived.
 */
const MAX_STAGGER_STEPS = 8;

/**
 * `Type.readout()` freezes `fontVariant` as a readonly tuple, which RN's
 * `TextStyle` (a mutable `FontVariant[]`) will not accept. Re-stating it keeps
 * the tabular figures the readout role exists for.
 */
const readout = (size: number): TextStyle => ({
  ...Type.readout(size),
  fontVariant: ['tabular-nums'],
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
  const reduced = useReducedMotion();

  const person = row.other;
  const name = person ? person.display_name.trim() || person.username : 'Someone';
  const unread = row.unreadCount > 0;

  const nowMs = serverNow();
  const presence = presenceFor(person, nowMs);
  const status = presenceLabel(presence);
  const stamp = stampFor(row.previewAt ?? row.lastMessageAt, nowMs);

  const hasPreview = row.preview.trim().length > 0;
  const preview = hasPreview
    ? row.previewIsMine
      ? `You: ${row.preview}`
      : row.preview
    : 'No messages yet';

  // ---- entrance: fade + translateY(8) → 0, 50ms per row, off under reduce-motion
  const enter = useSharedValue(reduced ? 1 : 0);
  /*
    Read once, at mount. The inbox reorders itself the moment a message lands
    (`last_message_at` is the sort key), and reading `index` live would re-run
    the entrance on rows that never left the screen.
  */
  const delay = useRef(Math.min(index, MAX_STAGGER_STEPS) * Stagger.messages);

  useEffect(() => {
    if (reduced) {
      enter.value = 1;
      return;
    }
    enter.value = withDelay(
      delay.current,
      withTiming(1, { duration: Duration.enter, easing: Easing.bezier(0.2, 0.8, 0.2, 1) }),
    );
  }, [enter, reduced]);

  const entering = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * 8 }],
  }));

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
            borderBottomColor: C.rule,
            backgroundColor: pressed ? C.surface : 'transparent',
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
          <Avatar name={name} uri={person?.avatar_url} size={AVATAR} />

          {/*
            Square, like everything in this direction, with a 2px ring in the
            ground colour instead of a shadow.

            Deliberately NOT accent: red is reserved for live / playing /
            joinable / on aux, and "opened the app recently" is none of those.
            The moment presence can say somebody is in a Session, that dot has
            earned the colour — this one has not.
          */}
          {presence === 'online' ? (
            <View style={[styles.dot, { backgroundColor: C.ink, borderColor: C.bg }]} />
          ) : null}
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

            {status ? (
              <Text style={[styles.status, { color: presence === 'online' ? C.ink2 : C.ink3 }]}>
                {status}
              </Text>
            ) : null}
          </View>

          {/* The contrast that IS the design: bright and heavier when unread. */}
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

          {/* The one accent on the row, and it means exactly one thing. */}
          {unread ? (
            <View style={[styles.badge, { backgroundColor: C.live }]}>
              <Text style={[styles.badgeText, { color: C.onLive }]} numberOfLines={1}>
                {row.unreadCount > 99 ? '99+' : row.unreadCount}
              </Text>
            </View>
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
    gap: Space.sm + 2,
    minHeight: CONVERSATION_ROW_HEIGHT - Rule.hair,
    paddingHorizontal: Space.md,
    paddingVertical: ROW_PAD_V,
    borderBottomWidth: Rule.hair,
  },
  avatarWell: {
    flexShrink: 0,
  },
  targetPressed: {
    opacity: 0.72,
  },
  dot: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    width: DOT,
    height: DOT,
    borderWidth: Rule.major,
  },
  identity: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  nameLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
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
    ...Type.body(15),
    lineHeight: 20,
  },
  status: {
    ...Type.label(10),
    flexShrink: 0,
  },
  preview: {
    ...Type.body(14),
    lineHeight: 18,
  },
  meta: {
    flexShrink: 0,
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 5,
    // Keeps the stamp column from shuffling as `NOW` becomes `MAR 4`.
    minWidth: 42,
  },
  stamp: {
    ...readout(10),
    letterSpacing: tracking(10, 0.06),
  },
  badge: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: Space.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    ...readout(10),
    lineHeight: 18,
  },
});
