/**
 * The lounge / Session message bar.
 *
 * The DM composer's bar with the two unwired tiles removed: a recessed field
 * and one raised SEND tile over a hairline. Same 44px geometry, same 14px
 * corner, same inverted-pill send — the two chat surfaces are one visual
 * language, so this file and `@/components/dm/composer` must keep matching.
 *
 * THE FIELD IS NOT `pressed()`. A 44px well on a dark ground shows only the
 * dark half of the inset pair and reads as dirt; the recipe is for surfaces of
 * about 80px and up. It gets `bgRecessed` and a hairline instead.
 *
 * SEND is the inverted pill and never the accent: in a log the accent means
 * "this message is mine", and it may not be spent twice.
 */

import { Send } from 'lucide-react-native';
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
import { Radii, Rule, Space, TOUCH_TARGET, Type, dropped } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

/** Matches the CHECK constraint on messages.body — reject before the round-trip. */
const MAX_LENGTH = 2000;
/** A counter that is always on is noise; it only matters once you are near the wall. */
const COUNTER_FROM = 1900;

const BODY = Type.body(14.5);
const INPUT_PADDING_Y = 12;
/** The design's 44px bar, which is also the touch floor. */
const MIN_INPUT_HEIGHT = TOUCH_TARGET;
/** Four lines, then the field scrolls instead of eating the whole screen. */
const MAX_INPUT_HEIGHT = BODY.lineHeight * 4 + INPUT_PADDING_Y * 2;

const TILE = TOUCH_TARGET;

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
            paddingBottom: (bottomInset ?? insets.bottom) + Space.md,
          },
        ]}>
        <View
          style={[
            styles.field,
            { backgroundColor: C.bgRecessed, borderColor: C.rule, height },
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
            selectionColor={C.live}
            accessibilityLabel={placeholder}
            style={[styles.input, { color: C.ink }]}
          />

          {value.length >= COUNTER_FROM ? (
            <Text
              accessibilityLiveRegion="polite"
              style={[styles.counter, { color: remaining <= 0 ? C.liveText : C.ink3 }]}>
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
            styles.tile,
            { backgroundColor: pressed ? C.cream : C.pill },
            dropped(C, 'sm'),
            !canSend && styles.inert,
          ]}>
          <Send size={18} strokeWidth={2.2} color={C.pillInk} />
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
    gap: 11,
    paddingHorizontal: Space.lg,
    paddingTop: Space.md,
    borderTopWidth: Rule.hair,
  },
  field: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radii.md,
    // Small recessed things get a hairline, never the inset pair.
    borderWidth: Rule.hair,
  },
  input: {
    ...BODY,
    flex: 1,
    minWidth: 0,
    alignSelf: 'stretch',
    paddingHorizontal: 15,
    paddingVertical: INPUT_PADDING_Y,
  },
  counter: {
    // A remaining-character count measures. Tabular figures.
    ...readout(11),
    alignSelf: 'center',
    paddingRight: Space.md,
  },
  tile: {
    width: TILE,
    height: TILE,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.md,
  },
  inert: {
    opacity: 0.45,
  },
});
