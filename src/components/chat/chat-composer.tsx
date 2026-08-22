import { SendHorizontal } from 'lucide-react-native';
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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSendMessage, type ChatScope } from '@/features/chat/queries';
import { Colors, Radius, Space, TOUCH_TARGET, Type } from '@/lib/theme';

/** Matches the CHECK constraint on messages.body — reject before the round-trip. */
const MAX_LENGTH = 2000;
/** A counter that is always on is noise; it only matters once you are near the wall. */
const COUNTER_FROM = 1900;

const LINE_HEIGHT = Type.body.lineHeight;
const INPUT_PADDING_Y = 10;
const MIN_INPUT_HEIGHT = TOUCH_TARGET;
/** Four lines, then the field scrolls instead of eating the whole screen. */
const MAX_INPUT_HEIGHT = LINE_HEIGHT * 4 + INPUT_PADDING_Y * 2;

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
      <View style={[styles.bar, { paddingBottom: (bottomInset ?? insets.bottom) + Space.sm }]}>
        <View style={styles.field}>
          <TextInput
            value={value}
            onChangeText={setValue}
            onContentSizeChange={onContentSizeChange}
            placeholder={placeholder}
            placeholderTextColor={Colors.faint}
            multiline
            maxLength={MAX_LENGTH}
            // A multiline field already treats Return as a newline; sending is
            // the button's job alone, so submitBehavior stays at its default.
            textAlignVertical="top"
            selectionColor={Colors.primary}
            accessibilityLabel="Message"
            style={[styles.input, { height }]}
          />

          {value.length >= COUNTER_FROM ? (
            <Text
              accessibilityLiveRegion="polite"
              style={[styles.counter, remaining <= 0 && styles.counterMaxed]}>
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
            canSend ? styles.sendReady : styles.sendIdle,
            pressed && canSend && styles.sendPressed,
          ]}>
          {/*
            Indigo, not accent green. Accent is reserved for play/live/join, and
            a green send button next to a green "LIVE" pip makes both mean less.
          */}
          <SendHorizontal size={20} color={canSend ? Colors.text : Colors.faint} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Space.sm,
    paddingHorizontal: Space.lg,
    paddingTop: Space.sm,
    backgroundColor: Colors.bg,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  field: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Space.md,
  },
  input: {
    ...Type.body,
    color: Colors.text,
    paddingVertical: INPUT_PADDING_Y,
    // The field must never be shorter than the send button beside it.
    minHeight: MIN_INPUT_HEIGHT,
    maxHeight: MAX_INPUT_HEIGHT,
  },
  counter: {
    ...Type.caption,
    color: Colors.muted,
    alignSelf: 'flex-end',
    paddingBottom: Space.xs,
  },
  counterMaxed: {
    color: Colors.danger,
  },
  send: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendReady: {
    backgroundColor: Colors.primary,
  },
  sendIdle: {
    backgroundColor: Colors.surfaceRaised,
  },
  sendPressed: {
    opacity: 0.85,
  },
});
