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
import { Radius, Rule, Space, Type } from '@/lib/theme';

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
};

/** Every field in the prototype: 46px, `surface`, 1px `rule2`, square. */
const FIELD_HEIGHT = 46;

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
}: TextFieldProps) {
  const C = useColors();
  const [focused, setFocused] = useState(false);

  const onFocus = useCallback(() => setFocused(true), []);
  const onBlur = useCallback(() => setFocused(false), []);

  /*
    Focus is an ink border, never the accent — a focused field is not a live one,
    and spending the red here is exactly what stops it meaning anything on the
    Feed. Only the colour changes; the 1px width is held on every state so
    focusing a field never nudges its text by a pixel.
  */
  const borderColor = error ? C.danger : focused ? C.ink : C.rule2;

  return (
    <View style={styles.root}>
      {label ? <Text style={[styles.label, { color: C.ink3 }]}>{label}</Text> : null}

      <TextInput
        value={value}
        onChangeText={onChangeText}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder={placeholder}
        placeholderTextColor={C.ink3}
        secureTextEntry={secureTextEntry}
        autoCapitalize={autoCapitalize}
        autoCorrect={!secureTextEntry}
        maxLength={maxLength}
        keyboardType={keyboardType}
        // The public prop is a plain string per the UI-kit contract; RN wants its
        // own union. Narrowed here so callers are not forced to import RN types.
        autoComplete={autoComplete as TextInputProps['autoComplete']}
        accessibilityLabel={label}
        // The error Text below is a polite live region, which is what actually
        // announces the failure; RN has no aria-invalid equivalent.
        selectionColor={C.live}
        style={[styles.input, { color: C.ink, backgroundColor: C.surface, borderColor }]}
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
  label: {
    ...Type.label(11),
  },
  input: {
    ...Type.body(16),
    height: FIELD_HEIGHT,
    // A fixed line height inside a fixed-height box makes Android centre the
    // text the way iOS already does.
    lineHeight: undefined,
    paddingHorizontal: Space.md,
    paddingVertical: 0,
    borderRadius: Radius,
    borderWidth: Rule.hair,
  },
  error: {
    ...Type.label(11),
  },
});
