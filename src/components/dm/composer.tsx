/**
 * The DM composer.
 *
 * From `design/nocturne/aux-nocturne.dc.html` L788-793 (`isDm`, the bottom
 * bar): a floating capsule — inset from both sides, rounded the whole way
 * around, glass over the ground — holding two ghost circles, a transparent
 * field and one gradient send disc.
 *
 * REPLACES a full-width bar that painted `bg` across the window behind a top
 * hairline. Three things were wrong with that here, and only the first is
 * cosmetic:
 *   - a rule along the top edge ONLY is the universal signal for a bar, and
 *     nothing else in this direction is a bar any more;
 *   - an opaque slab of `bg` covers the ambient blobs the whole app is lit by;
 *   - it covered them *behind the floating nav capsule*, which is blurred glass
 *     and has nothing left to blur once a solid rectangle sits under it.
 *
 * ## IT DOES NOT OWN THE BOTTOM EDGE
 *
 * The nav capsule now hovers over the same corner of the screen (inset 16, 42px
 * off the bottom, 68px tall), so this bar cannot assume the window ends where
 * it does. It therefore paints NO ground and NO edge outside the capsule: the
 * frame around it is transparent, whatever the host reserves underneath shows
 * the ambient ground, and the capsule is the only thing drawn.
 *
 * `bottomInset` is the single knob and the contract is exact: the frame's
 * padding is `bottomInset + Space.md`, so the capsule's bottom edge lands
 * `bottomInset + 12` off the bottom of whatever box the host gives it. The
 * thread screen passes `insets.bottom + Dock.reserve - Space.md` while the
 * keyboard is down (and 0 while it is up, when the capsule is behind the
 * keyboard) and its own comment depends on that arithmetic — which is why the
 * step below stays `Space.md` rather than taking the design's 14px gutter drop.
 *
 * ## THE ACCENTS
 *
 * SEND IS BLUE. It is an action, and in nocturne actions are blue — the
 * `CircleIconButton` at tone `pri`, the same disc the lounge bar sends with, so
 * the two composers cannot drift apart again. (The note this header used to
 * carry — "SEND is the inverted pill, never the accent" — belonged to a
 * direction with one accent, where spending it on the send button would have
 * competed with "this message is mine". There are two accents now and they are
 * split by MEANING rather than by rationing.)
 *
 * THE MIC GOES CORAL ONLY WHILE THE RECORDER IS ACTUALLY RUNNING. Recording is
 * a state of the world, which is coral's whole job; a mic that is merely
 * available is a control like any other and stays a ghost circle.
 *
 * Fully controlled. The thread screen owns `value` and the mutation; this file
 * never touches the data layer. It owns exactly three pieces of local state —
 * the field's measured height, the caret, and a one-shot selection override
 * used to place the caret after completing a mention.
 */

import { Mic, Paperclip, Send } from 'lucide-react-native';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
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
import { CircleIconButton } from '@/components/ui';
import { Rule, Space, TOUCH_TARGET, Type, raised } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

/** `dm_body_length` on `direct_messages` — reject before the round-trip. */
const MAX_LENGTH = 4000;
/** A counter that is always on is noise; it only matters near the wall. */
const COUNTER_FROM = 3800;

/** L791: `font:400 15px Archivo` in the field, the same as the lounge bar. */
const BODY = Type.body(15);
const INPUT_PADDING_Y = 12;
/** The design's 44px field, which is also the touch floor. */
const MIN_INPUT_HEIGHT = TOUCH_TARGET;
/** Four lines, then the field scrolls instead of eating the thread. */
const MAX_INPUT_HEIGHT = BODY.lineHeight * 4 + INPUT_PADDING_Y * 2;

/** L788: `padding:6px 6px 6px 8px`, `gap:8px`, `margin:0 14px 14px`. */
const CAPSULE_PAD = 6;
const CAPSULE_LEAD = Space.sm;
const CAPSULE_GAP = Space.sm;
const GUTTER = 14;

/**
 * A deliberate 28 where the design writes 999, for the reason `ChatComposer`
 * spells out: at the resting height (6 + 44 + 6) the two are the same shape,
 * and they only diverge once the field grows, where 999 keeps stretching the
 * corner and the curve eats into the capsule's own left padding.
 */
const CAPSULE_RADIUS = 28;

const DISC = TOUCH_TARGET;

/** `Type.readout` hands back a readonly fontVariant tuple; TextStyle wants a mutable one. */
const readout = (size: number): TextStyle => ({
  ...Type.readout(size),
  fontVariant: ['tabular-nums'],
});

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(n, hi));

/**
 * `CircleIconButton` takes a required handler. A disc whose handler was omitted
 * is rendered `disabled`, so this is never reached — but a fresh arrow per
 * render would defeat the memo on a control that re-renders on every keystroke.
 */
const NOOP = () => {};

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
  /** A send is in flight — SEND goes inert until it lands. */
  sending?: boolean;
  /** Blanket disable: no thread yet, blocked, offline. */
  disabled?: boolean;
  /**
   * The recorder is RUNNING right now. Turns the mic coral, because that is a
   * live state rather than an action — see the header. Purely presentational:
   * `onRecord` is still what the disc calls.
   */
  recording?: boolean;

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
   * Space to leave UNDER the capsule, on top of the `Space.md` the frame adds
   * itself. Defaults to the safe-area inset. A host that floats chrome over
   * this corner — the tab group's nav capsule does — must reserve it here; see
   * the header for the exact contract.
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
  recording = false,
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
      // contentSize already carries the field's own padding; adding it again
      // makes the bar jump a line taller than the text in it.
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

      <View style={[styles.frame, { paddingBottom: (bottomInset ?? insets.bottom) + Space.md }]}>
        <View
          style={[
            styles.capsule,
            { backgroundColor: C.surface, borderColor: C.rule },
            /* Glass has no edge of its own at 5.5% white — the hairline above
               and this lift together are what make it an object. */
            raised(C),
          ]}>
          <CircleIconButton
            icon={Paperclip}
            size={DISC}
            tone="ghost"
            disabled={!attachEnabled}
            accessibilityLabel="Attach something"
            onPress={onAttach ?? NOOP}
          />

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

          <CircleIconButton
            icon={Mic}
            size={DISC}
            /* Coral is the RUNNING recorder, never the offer of one. */
            tone={recording ? 'live' : 'ghost'}
            disabled={!recordEnabled}
            accessibilityLabel={recording ? 'Recording a voice note' : 'Record a voice note'}
            onPress={onRecord ?? NOOP}
          />

          {/*
            `disabled` rather than hidden. A send button that vanishes on an
            empty field moves the two controls beside it every time you clear
            the draft, and the empty state is exactly when someone is hunting
            for it.
          */}
          <CircleIconButton
            icon={Send}
            size={DISC}
            tone="pri"
            disabled={!canSend}
            accessibilityLabel={sending ? 'Sending message' : 'Send message'}
            onPress={handleSend}
          />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  /**
   * No fill and no hairline — see the header. This frame exists only to place
   * the capsule and to hold the bottom reservation the host asks for.
   */
  frame: {
    paddingHorizontal: GUTTER,
    paddingTop: Space.sm,
  },
  capsule: {
    flexDirection: 'row',
    // The field grows upward; every disc stays on the bottom edge of the capsule.
    alignItems: 'flex-end',
    gap: CAPSULE_GAP,
    paddingLeft: CAPSULE_LEAD,
    paddingRight: CAPSULE_PAD,
    paddingVertical: CAPSULE_PAD,
    borderRadius: CAPSULE_RADIUS,
    borderWidth: Rule.hair,
  },
  /*
    Transparent, with no well of its own. The design draws the field as bare
    text inside the capsule, and it is right: a `bgRecessed` trough inside a
    56px glass capsule leaves 6px of glass framing a second box, which reads as
    two nested fields rather than one bar.
  */
  input: {
    ...BODY,
    flex: 1,
    minWidth: 0,
    // No horizontal padding of its own — the capsule's gap is the inset, and
    // doubling it pushes the caret away from the paperclip beside it.
    paddingVertical: INPUT_PADDING_Y,
  },
  counter: {
    // A remaining-character count measures. Tabular figures.
    ...readout(11),
    // Centred against the capsule's content box rather than pinned to the
    // bottom with the discs: on a three-line draft a bottom-pinned counter sits
    // under the last line of text and reads as part of the message.
    alignSelf: 'center',
  },
});
