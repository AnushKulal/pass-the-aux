/**
 * The lounge / Session message bar.
 *
 * From `design/nocturne/aux-nocturne.dc.html` L492 (lounge) and L1280
 * (Session): a floating capsule holding a transparent field and one 44px
 * gradient send circle. It replaces a full-width bar that sat on the bottom
 * edge behind a hairline — this one has air on all four sides and reads as an
 * object over the log rather than a border under it.
 *
 * THE TWO GROUNDS DRAW THE CAPSULE DIFFERENTLY, AND THE DESIGN IS EXPLICIT.
 * On the screen it is `--g` + `--gb` + `--sh` — glass, raised. Inside the
 * Session sheet it is `--aux-bg2` with the same hairline and NO shadow: a
 * 5.5%-white capsule inside a blurred chrome panel has nothing to be
 * translucent against, and a drop shadow inside a floating sheet is a shadow
 * cast by nothing.
 *
 * SEND IS THE BLUE GRADIENT, AND IT ALWAYS WAS THE RIGHT COLOUR. Sending is an
 * action; actions are blue. What changed is that it is now the shared
 * `CircleIconButton` at tone `pri` rather than a square tile hand-rolled here,
 * so the send on this bar and the send on the DM bar cannot drift apart again.
 */

import { Send } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputContentSizeChangeEventData,
  type TextStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ChatGround } from '@/components/chat/bubble-kit';
import { CircleIconButton } from '@/components/ui';
import { useSendMessage, type ChatScope } from '@/features/chat/queries';
import { Rule, Space, TOUCH_TARGET, Type, raised } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

/** Matches the CHECK constraint on messages.body — reject before the round-trip. */
const MAX_LENGTH = 2000;
/** A counter that is always on is noise; it only matters once you are near the wall. */
const COUNTER_FROM = 1900;

/** L493: `font:400 15px Archivo` in the field. */
const BODY = Type.body(15);
const INPUT_PADDING_Y = 12;
/** The design's 44px field, which is also the touch floor. */
const MIN_INPUT_HEIGHT = TOUCH_TARGET;
/** Four lines, then the field scrolls instead of eating the whole screen. */
const MAX_INPUT_HEIGHT = BODY.lineHeight * 4 + INPUT_PADDING_Y * 2;

/** L492: `padding:6px 6px 6px 16px` around the field. */
const CAPSULE_PAD = 6;
const CAPSULE_LEAD = Space.lg;

/**
 * The capsule corner, and a DELIBERATE 28 where the design writes 999.
 *
 * At the bar's resting height — 6 + 44 + 6 — those two are the same shape: 28
 * is exactly half of 56, so a 28 radius IS a pill here. They diverge only once
 * the field grows to two or three lines, where 999 keeps stretching the corner
 * with the box and the capsule becomes an oval whose curve eats into its own
 * 16px left padding, clipping the first character of the top line. 28 stays a
 * generously rounded rectangle instead.
 */
const CAPSULE_RADIUS = 28;

/** The gutter and the drop to the edge, per ground: L492 / L1280. */
const FRAME: Record<ChatGround, { gutter: number; bottom: number }> = {
  screen: { gutter: 18, bottom: 14 },
  sheet: { gutter: Space.lg, bottom: Space.lg },
};

/** `Type.readout` hands back a readonly fontVariant tuple; TextStyle wants a mutable one. */
const readout = (size: number): TextStyle => ({
  ...Type.readout(size),
  fontVariant: ['tabular-nums'],
});

export type ChatComposerProps = ChatScope & {
  placeholder?: string;
  /** Screen or Session sheet. See `ChatGround` — it decides the capsule's fill. */
  ground?: ChatGround;
  /**
   * Distance from the bottom of the screen to the bottom of this composer.
   * Inside the room's bottom sheet the composer is not flush with the window,
   * and without this the keyboard lifts it by the wrong amount.
   */
  keyboardOffset?: number;
  /**
   * Bottom padding under the bar. Defaults to the safe-area inset; pass 0 when
   * a parent sheet already pads for the home indicator, or the gap doubles.
   */
  bottomInset?: number;
};

export function ChatComposer({
  loungeId,
  roomId,
  placeholder = 'Message',
  ground = 'screen',
  keyboardOffset = 0,
  bottomInset,
}: ChatComposerProps) {
  const C = useColors();
  const insets = useSafeAreaInsets();
  const scope = useMemo<ChatScope>(() => ({ loungeId, roomId: roomId ?? null }), [loungeId, roomId]);
  const send = useSendMessage(scope);

  const [value, setValue] = useState('');
  const [height, setHeight] = useState(MIN_INPUT_HEIGHT);

  const trimmed = value.trim();
  const canSend = trimmed.length > 0 && !send.isPending;
  const remaining = MAX_LENGTH - value.length;

  const onContentSizeChange = useCallback(
    (event: NativeSyntheticEvent<TextInputContentSizeChangeEventData>) => {
      // contentSize already carries the field's own padding; adding it again
      // makes the bar jump a line taller than the text in it.
      const next = event.nativeEvent.contentSize.height;
      setHeight(Math.min(Math.max(next, MIN_INPUT_HEIGHT), MAX_INPUT_HEIGHT));
    },
    [],
  );

  const onSend = useCallback(() => {
    if (!canSend) return;

    /*
      Clear first, send second. The mutation is optimistic, so the message is
      already on screen by the time this returns; leaving the text in the field
      until the server answers is what makes a chat feel laggy.
    */
    setValue('');
    setHeight(MIN_INPUT_HEIGHT);
    send.mutate(trimmed);
  }, [canSend, send, trimmed]);

  const frame = FRAME[ground];
  const inSheet = ground === 'sheet';

  return (
    <KeyboardAvoidingView
      /*
        `padding` grows this bar by the keyboard height and, because the list
        above it is flex:1, the list gives up exactly that much room. Android
        runs adjustResize already, so `height` here is belt-and-braces for the
        cases (a translucent-status-bar Activity, a sheet) where it does not.
      */
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={keyboardOffset}>
      <View
        style={[
          styles.frame,
          {
            paddingHorizontal: frame.gutter,
            paddingBottom: (bottomInset ?? insets.bottom) + frame.bottom,
          },
        ]}>
        <View
          style={[
            styles.capsule,
            {
              backgroundColor: inSheet ? C.bgRecessed : C.surface,
              borderColor: C.rule,
            },
            // Raised on the page; flat inside the sheet, which is already
            // floating and casts the only shadow in that stack.
            inSheet ? null : raised(C),
          ]}>
          <TextInput
            value={value}
            onChangeText={setValue}
            onContentSizeChange={onContentSizeChange}
            placeholder={placeholder}
            placeholderTextColor={C.ink3}
            multiline
            maxLength={MAX_LENGTH}
            // A multiline field already treats Return as a newline; sending is
            // the button's job alone, so submitBehavior stays at its default.
            textAlignVertical="center"
            // The caret and the selection band are UI, not a live state — blue.
            selectionColor={C.pill}
            accessibilityLabel={placeholder}
            style={[styles.input, { color: C.ink, height }]}
          />

          {value.length >= COUNTER_FROM ? (
            <Text
              accessibilityLiveRegion="polite"
              style={[styles.counter, { color: remaining <= 0 ? C.liveText : C.ink3 }]}>
              {remaining}
            </Text>
          ) : null}

          {/*
            `disabled` rather than hidden. A send button that vanishes on an
            empty field moves the one control on the bar every time you clear
            the draft, and the empty state is exactly when someone is hunting
            for it.
          */}
          <CircleIconButton
            icon={Send}
            size={44}
            tone="pri"
            disabled={!canSend}
            accessibilityLabel={send.isPending ? 'Sending message' : 'Send message'}
            onPress={onSend}
          />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  /** No fill and no hairline: the capsule inside is the whole control. */
  frame: {
    paddingTop: Space.sm,
  },
  capsule: {
    flexDirection: 'row',
    // The field grows upward; SEND stays anchored to the bottom of the capsule.
    alignItems: 'flex-end',
    gap: 9,
    paddingLeft: CAPSULE_LEAD,
    paddingRight: CAPSULE_PAD,
    paddingVertical: CAPSULE_PAD,
    borderRadius: CAPSULE_RADIUS,
    borderWidth: Rule.hair,
  },
  input: {
    ...BODY,
    flex: 1,
    minWidth: 0,
    // No horizontal padding of its own — the capsule's 16px lead is the inset,
    // and doubling it pushes the caret off the left of a one-line draft.
    paddingVertical: INPUT_PADDING_Y,
  },
  counter: {
    // A remaining-character count measures. Tabular figures.
    ...readout(11),
    // Centred against the capsule's content box rather than pinned to the
    // bottom with the send: on a three-line draft a bottom-pinned counter sits
    // under the last line of text and reads as part of the message.
    alignSelf: 'center',
  },
});
