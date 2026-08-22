/**
 * The message bar.
 *
 * Two flush cells with no gap and no radius: a recessed field and, hard against
 * it, the SEND block. The 2px rule across the top is what separates the bar
 * from the log — there is no shadow and no blur in this direction.
 *
 * SEND is accent only while pressing it would actually send something. Idle it
 * *loses the red* and drops to a bordered surface cell, which is the same
 * signal the sync ladder uses: red means the thing is live, its absence means
 * it is not. It never turns amber.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputContentSizeChangeEventData,
  type TextStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSendMessage, type ChatScope } from '@/features/chat/queries';
import { Rule, Space, Type, tracking } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

/** Matches the CHECK constraint on messages.body — reject before the round-trip. */
const MAX_LENGTH = 2000;
/** A counter that is always on is noise; it only matters once you are near the wall. */
const COUNTER_FROM = 1900;

const BODY = Type.body(16);
const INPUT_PADDING_Y = 13;
/** The artboard's bar height, and comfortably over the 44px floor. */
const MIN_INPUT_HEIGHT = BODY.lineHeight + INPUT_PADDING_Y * 2;
/** Four lines, then the field scrolls instead of eating the whole screen. */
const MAX_INPUT_HEIGHT = BODY.lineHeight * 4 + INPUT_PADDING_Y * 2;
/** The artboard's SEND cell. */
const SEND_WIDTH = 56;

/** `Type.readout` hands back a readonly fontVariant tuple; TextStyle wants a mutable one. */
const readout = (size: number): TextStyle => ({
  ...Type.readout(size),
  fontVariant: ['tabular-nums'],
});

export type ChatComposerProps = ChatScope & {
  placeholder?: string;
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
          styles.bar,
          {
            backgroundColor: C.bg,
            borderTopColor: C.rule,
            paddingBottom: bottomInset ?? insets.bottom,
          },
        ]}>
        <View style={[styles.field, { backgroundColor: C.bgRecessed }]}>
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
            textAlignVertical="top"
            selectionColor={C.live}
            accessibilityLabel="Message"
            style={[styles.input, { color: C.ink, height }]}
          />

          {value.length >= COUNTER_FROM ? (
            <Text
              accessibilityLiveRegion="polite"
              style={[styles.counter, { color: remaining <= 0 ? C.danger : C.ink3 }]}>
              {remaining}
            </Text>
          ) : null}
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send message"
          accessibilityState={{ disabled: !canSend, busy: send.isPending }}
          disabled={!canSend}
          onPress={onSend}
          style={({ pressed }) => [
            styles.send,
            canSend
              ? { backgroundColor: pressed ? C.liveText : C.live }
              : { backgroundColor: C.surface, borderLeftWidth: Rule.hair, borderLeftColor: C.rule },
          ]}>
          <Text style={[styles.sendLabel, { color: canSend ? C.onLive : C.ink3 }]}>SEND</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    // The field grows upward; SEND stays anchored to the bottom edge.
    alignItems: 'flex-end',
    // 2px, because this is a boundary between two major regions of the screen.
    borderTopWidth: Rule.major,
  },
  field: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Space.md,
  },
  input: {
    ...BODY,
    paddingVertical: INPUT_PADDING_Y,
    // The field must never be shorter than the SEND cell beside it.
    minHeight: MIN_INPUT_HEIGHT,
    maxHeight: MAX_INPUT_HEIGHT,
  },
  counter: {
    // A remaining-character count measures. Tabular figures.
    ...readout(11),
    alignSelf: 'flex-end',
    paddingBottom: Space.sm,
  },
  send: {
    width: SEND_WIDTH,
    minHeight: MIN_INPUT_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendLabel: {
    ...Type.heading(11),
    letterSpacing: tracking(11, 0.06),
  },
});
