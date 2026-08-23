/**
 * The DM composer.
 *
 * Four flush cells under a 2px rule: attach / field / mic / SEND, divided by
 * hairlines. They are butted together on purpose — this is one control bar, not
 * four neighbouring buttons, so the "8px between adjacent targets" floor is met
 * by the 1px rules that separate them the way the segmented tabs do. Each cell
 * still clears 44x44 on its own.
 *
 * SEND carries the accent only while pressing it would actually send. Idle it
 * loses the red and drops to a bordered surface cell — the same signal the rest
 * of the app uses: red means the thing is live, its absence means it is not.
 *
 * Fully controlled. The thread screen owns `value` and the mutation; this file
 * never touches the data layer. It owns exactly three pieces of local state —
 * the field's measured height, the caret, and a one-shot selection override
 * used to place the caret after completing a mention.
 */

import { Mic, Paperclip } from 'lucide-react-native';
import { useCallback, useMemo, useRef, useState } from 'react';
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
  type TextInputSelectionChangeEventData,
  type TextStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  MentionPicker,
  applyMention,
  findMentionQuery,
  type MentionCandidate,
} from '@/components/dm/mention-picker';
import { Rule, Space, TOUCH_TARGET, Type, tracking } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

/** `dm_body_length` on `direct_messages` — reject before the round-trip. */
const MAX_LENGTH = 4000;
/** A counter that is always on is noise; it only matters near the wall. */
const COUNTER_FROM = 3800;

const BODY = Type.body(16);
const INPUT_PADDING_Y = 14;
/** The prototype's 52px bar, comfortably over the 44px floor. */
const MIN_INPUT_HEIGHT = BODY.lineHeight + INPUT_PADDING_Y * 2;
/** Four lines, then the field scrolls instead of eating the thread. */
const MAX_INPUT_HEIGHT = BODY.lineHeight * 4 + INPUT_PADDING_Y * 2;
/** The prototype's icon cells and SEND cell. */
const ICON_CELL = 46;
const SEND_WIDTH = 58;
const ICON = 19;

/** `Type.readout` hands back a readonly fontVariant tuple; TextStyle wants a mutable one. */
const readout = (size: number): TextStyle => ({
  ...Type.readout(size),
  fontVariant: ['tabular-nums'],
});

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(n, hi));

export type DmComposerProps = {
  value: string;
  onChangeText: (next: string) => void;
  /** Called with the trimmed body. The screen owns the mutation and the clear. */
  onSend: (body: string) => void;

  /** Opens the attach sheet. Omit and the paperclip renders disabled. */
  onAttach?: () => void;
  /** Opens the recording sheet. Omit and the mic renders disabled. */
  onRecord?: () => void;

  placeholder?: string;
  /** A send is in flight — SEND drops out of the accent until it lands. */
  sending?: boolean;
  /** Blanket disable: no thread yet, blocked, offline. */
  disabled?: boolean;

  /**
   * The FULL @-mention pool for this thread. Omit or leave empty and typing `@`
   * does nothing. Never pre-filter it — the picker's count depends on getting
   * everything.
   */
  mentionPeople?: readonly MentionCandidate[];
  mentionScopeLabel?: string;

  /**
   * Distance from the bottom of the window to the bottom of this bar. Inside a
   * sheet the composer is not flush with the window and the keyboard would
   * otherwise lift it by the wrong amount.
   */
  keyboardOffset?: number;
  /**
   * Bottom padding under the bar. Defaults to the safe-area inset; pass 0 when
   * a parent already pads for the home indicator, or the gap doubles.
   */
  bottomInset?: number;
};

export function DmComposer({
  value,
  onChangeText,
  onSend,
  onAttach,
  onRecord,
  placeholder = 'Message',
  sending = false,
  disabled = false,
  mentionPeople,
  mentionScopeLabel,
  keyboardOffset = 0,
  bottomInset,
}: DmComposerProps) {
  const C = useColors();
  const insets = useSafeAreaInsets();

  const [height, setHeight] = useState(MIN_INPUT_HEIGHT);
  const [caret, setCaret] = useState(0);
  /**
   * Non-null for exactly one render, to move the caret after a completion.
   * Leaving `selection` permanently controlled fights the Android IME, so it is
   * handed to the field only when it has something to say and cleared as soon
   * as the field reports back.
   */
  const [pendingCaret, setPendingCaret] = useState<number | null>(null);
  const caretRef = useRef(0);

  const trimmed = value.trim();
  const canSend = trimmed.length > 0 && trimmed.length <= MAX_LENGTH && !sending && !disabled;
  const remaining = MAX_LENGTH - value.length;

  const query = useMemo(() => {
    if (!mentionPeople || mentionPeople.length === 0 || disabled) return null;
    return findMentionQuery(value, caret);
  }, [mentionPeople, disabled, value, caret]);

  const handleChangeText = useCallback(
    (next: string) => {
      /*
        `onSelectionChange` lands AFTER `onChangeText` on Android, so reading
        the caret from state here would leave the mention token one character
        stale — the picker would filter on `al` while the field shows `ali`.
        A single-point edit moves the caret by exactly the length delta, which
        is true for typing, deleting and pasting alike; the real selection
        event corrects it a moment later either way.
      */
      const guess = clamp(caretRef.current + (next.length - value.length), 0, next.length);
      caretRef.current = guess;
      setCaret(guess);
      // A keystroke always outranks a stale override. `handlePickMention` calls
      // `onChangeText` directly, so this never fights a completion.
      setPendingCaret(null);
      onChangeText(next);
    },
    [onChangeText, value.length],
  );

  const handleSelectionChange = useCallback(
    (event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
      const { end } = event.nativeEvent.selection;
      caretRef.current = end;
      setCaret(end);
      // Release the override once the field has actually honoured it.
      setPendingCaret((pending) => (pending === null || pending === end ? null : pending));
    },
    [],
  );

  const handleContentSizeChange = useCallback(
    (event: NativeSyntheticEvent<TextInputContentSizeChangeEventData>) => {
      const next = event.nativeEvent.contentSize.height;
      setHeight(clamp(next, MIN_INPUT_HEIGHT, MAX_INPUT_HEIGHT));
    },
    [],
  );

  const handlePickMention = useCallback(
    (person: MentionCandidate) => {
      if (!query) return;
      const next = applyMention(value, query, person.handle);
      caretRef.current = next.caret;
      setCaret(next.caret);
      setPendingCaret(next.caret);
      onChangeText(next.value);
    },
    [query, value, onChangeText],
  );

  const handleSend = useCallback(() => {
    if (!canSend) return;
    setHeight(MIN_INPUT_HEIGHT);
    onSend(trimmed);
  }, [canSend, onSend, trimmed]);

  const attachEnabled = !!onAttach && !disabled;
  const recordEnabled = !!onRecord && !disabled;

  return (
    <KeyboardAvoidingView
      /*
        `padding` grows this bar by the keyboard height and, because the thread
        above it is flex:1, the thread gives up exactly that much room. Android
        runs adjustResize already, so `height` is belt-and-braces for the cases
        (a translucent-status-bar Activity, a sheet) where it does not.
      */
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={keyboardOffset}>
      {query ? (
        <MentionPicker
          people={mentionPeople ?? []}
          token={query.token}
          onPick={handlePickMention}
          scopeLabel={mentionScopeLabel}
        />
      ) : null}

      <View
        style={[
          styles.bar,
          {
            backgroundColor: C.bg,
            borderTopColor: C.rule,
            paddingBottom: bottomInset ?? insets.bottom,
          },
        ]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Attach something"
          accessibilityState={{ disabled: !attachEnabled }}
          disabled={!attachEnabled}
          onPress={onAttach}
          style={({ pressed }) => [
            styles.iconCell,
            { borderRightColor: C.rule, backgroundColor: pressed ? C.surface : 'transparent' },
          ]}>
          <Paperclip size={ICON} strokeWidth={2} color={attachEnabled ? C.ink2 : C.ink3} />
        </Pressable>

        <View style={[styles.field, { backgroundColor: C.bgRecessed }]}>
          <TextInput
            value={value}
            onChangeText={handleChangeText}
            onSelectionChange={handleSelectionChange}
            onContentSizeChange={handleContentSizeChange}
            selection={pendingCaret === null ? undefined : { start: pendingCaret, end: pendingCaret }}
            placeholder={placeholder}
            placeholderTextColor={C.ink3}
            editable={!disabled}
            multiline
            maxLength={MAX_LENGTH}
            // A multiline field already treats Return as a newline; sending is
            // the button's job alone, so submitBehavior stays at its default.
            textAlignVertical="top"
            selectionColor={C.live}
            accessibilityLabel={placeholder}
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
          accessibilityLabel="Record a voice note"
          accessibilityState={{ disabled: !recordEnabled }}
          disabled={!recordEnabled}
          onPress={onRecord}
          style={({ pressed }) => [
            styles.iconCell,
            styles.iconCellLeft,
            { borderLeftColor: C.rule, backgroundColor: pressed ? C.surface : 'transparent' },
          ]}>
          <Mic size={ICON} strokeWidth={2} color={recordEnabled ? C.ink2 : C.ink3} />
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send message"
          accessibilityState={{ disabled: !canSend, busy: sending }}
          disabled={!canSend}
          onPress={handleSend}
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
    // The field grows upward; every other cell stays on the bottom edge.
    alignItems: 'flex-end',
    // 2px, because this is a boundary between two major regions of the screen.
    borderTopWidth: Rule.major,
  },
  iconCell: {
    width: ICON_CELL,
    height: MIN_INPUT_HEIGHT,
    minWidth: TOUCH_TARGET,
    minHeight: TOUCH_TARGET,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRightWidth: Rule.hair,
  },
  iconCellLeft: {
    borderRightWidth: 0,
    borderLeftWidth: Rule.hair,
  },
  field: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
    paddingHorizontal: Space.md,
  },
  input: {
    ...BODY,
    paddingVertical: INPUT_PADDING_Y,
    // The field must never be shorter than the cells beside it.
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
    height: MIN_INPUT_HEIGHT,
    minWidth: TOUCH_TARGET,
    minHeight: TOUCH_TARGET,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendLabel: {
    ...Type.heading(11),
    letterSpacing: tracking(11, 0.06),
  },
});
