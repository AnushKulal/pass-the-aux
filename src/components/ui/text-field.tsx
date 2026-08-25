/**
 * The text field.
 *
 * From design/nocturne/aux-nocturne.dc.html: the standalone well at L194 /
 * L529 / L552, the textarea at L197 / L531, and the pill-shaped code and search
 * entries at L329 / L1225.
 *
 * AN INPUT IS A WELL CUT INTO THE PAGE, NOT A CARD SITTING ON IT. That is the
 * one structural change from the previous direction: the fill moved from
 * `surface` (a raised 5.5%-white card) to `bgRecessed`, which is DARKER than
 * the ground. Leaving it on `surface` makes a field look like a button — and
 * inside a `surface` card the two translucent layers composited to ~11% and the
 * field vanished into its container entirely.
 *
 * The focus edge is deliberately NEUTRAL. Coral means live and blue means "you
 * do this"; a cursor sitting in a box is neither, and spending an accent on it
 * is what stops the accents meaning anything on the Feed. Only a genuine
 * failure gets a colour, and it gets `danger`, which has its own hue again.
 */

import { useCallback, useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type TextInputProps,
} from 'react-native';

import { useColors } from '@/lib/theme-context';
import { Fonts, Radii, Rule, Space, tracking, Type } from '@/lib/theme';

export type TextFieldProps = {
  label?: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  error?: string;
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences';
  maxLength?: number;
  autoComplete?: string;
  keyboardType?: KeyboardTypeOptions;
  /** The description well on New Lounge (L531). */
  multiline?: boolean;
  /** `pill` is the invite-code and search entry (L329, L1225). */
  shape?: 'field' | 'pill';
  /** Required when there is no visible label — a search field, say. */
  accessibilityLabel?: string;
};

/** L529: `min-height:48px`. The old 46 was half a step under the design's. */
const FIELD_HEIGHT = 48;
/** L531: `height:82px` — three lines of 15px with the well's own padding. */
const AREA_MIN_HEIGHT = 82;

export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  error,
  secureTextEntry = false,
  autoCapitalize = 'sentences',
  maxLength,
  autoComplete,
  keyboardType,
  multiline = false,
  shape = 'field',
  accessibilityLabel,
}: TextFieldProps) {
  const C = useColors();
  const [focused, setFocused] = useState(false);

  const onFocus = useCallback(() => setFocused(true), []);
  const onBlur = useCallback(() => setFocused(false), []);

  /*
    Failure and focus must not paint the same edge, or a field that has just
    been rejected looks exactly like a field being typed into — which is almost
    always, since validation fires on a focused field. Failure keeps the alarm;
    focus steps up to the brightest neutral rule. The 1px width is held on every
    state so focusing never nudges the text by a pixel.
  */
  const borderColor = error ? C.danger : focused ? C.rule3 : C.rule;

  /*
    The ring is a STRING, not the `boxShadow` array used everywhere else in this
    kit. `TextInput` takes a `TextStyle`, and `TextStyle` types `boxShadow` as a
    string only — the array form typechecks on a `View` and fails here.
  */
  const ring = error
    ? { boxShadow: `0 0 0 3px ${C.dangerWash}` }
    : focused
      ? { boxShadow: `0 0 0 3px ${C.ruleSoft}` }
      : null;

  return (
    <View style={styles.root}>
      {label ? <Text style={[styles.label, { color: C.ink3 }]}>{label}</Text> : null}

      <TextInput
        value={value}
        onChangeText={onChangeText}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder={placeholder}
        // Explicit: RN's platform default is a mid grey that measures under 3:1
        // on this ground, and `ink3` is the token that was raised to clear AA.
        placeholderTextColor={C.ink3}
        secureTextEntry={secureTextEntry}
        autoCapitalize={autoCapitalize}
        autoCorrect={!secureTextEntry}
        maxLength={maxLength}
        keyboardType={keyboardType}
        multiline={multiline}
        // Without this a multiline field on Android centres its first line and
        // the caret starts halfway down an empty box.
        textAlignVertical={multiline ? 'top' : 'center'}
        // The public prop is a plain string per the UI-kit contract; RN wants its
        // own union. Narrowed here so callers are not forced to import RN types.
        autoComplete={autoComplete as TextInputProps['autoComplete']}
        accessibilityLabel={accessibilityLabel ?? label}
        // The error Text below is a polite live region, which is what actually
        // announces the failure; RN has no aria-invalid equivalent.
        selectionColor={C.pill}
        style={[
          multiline ? styles.area : styles.input,
          shape === 'pill' && !multiline ? styles.pill : null,
          { color: C.ink, backgroundColor: C.bgRecessed, borderColor },
          ring,
        ]}
      />

      {error ? (
        <Text accessibilityLiveRegion="polite" style={[styles.error, { color: C.danger }]}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: Space.sm,
    width: '100%',
  },
  /** L529: `font:800 9px;letter-spacing:.13em` — a kicker, not a caption. */
  label: {
    ...Type.label(10),
    fontFamily: Fonts.extrabold,
    letterSpacing: tracking(10, 0.13),
  },
  input: {
    ...Type.body(15),
    height: FIELD_HEIGHT,
    // A fixed line height inside a fixed-height box makes Android centre the
    // text the way iOS already does.
    lineHeight: undefined,
    paddingHorizontal: Space.lg,
    paddingVertical: 0,
    borderRadius: Radii.md,
    borderWidth: Rule.hair,
  },
  /** L329/L1225: same well, fully rounded, with the gutter opened to match. */
  pill: {
    borderRadius: Radii.pill,
    paddingHorizontal: Space.lg + 2,
  },
  area: {
    ...Type.body(15),
    minHeight: AREA_MIN_HEIGHT,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
    borderRadius: Radii.md,
    borderWidth: Rule.hair,
  },
  error: {
    ...Type.label(11),
  },
});
