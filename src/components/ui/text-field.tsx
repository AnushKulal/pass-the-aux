import { useCallback, useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type TextInputProps,
} from 'react-native';

import { Colors, Radius, Space, Type } from '@/lib/theme';

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
  const [focused, setFocused] = useState(false);

  const onFocus = useCallback(() => setFocused(true), []);
  const onBlur = useCallback(() => setFocused(false), []);

  return (
    <View style={styles.root}>
      {label ? <Text style={styles.label}>{label}</Text> : null}

      <TextInput
        value={value}
        onChangeText={onChangeText}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder={placeholder}
        placeholderTextColor={Colors.faint}
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
        selectionColor={Colors.primary}
        style={[
          styles.input,
          // Border width never changes, only its colour — a thicker focus ring
          // would shift the text by a pixel on every focus.
          focused && styles.inputFocused,
          error ? styles.inputError : null,
        ]}
      />

      {error ? (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: Space.xs,
    width: '100%',
  },
  label: {
    ...Type.label,
    color: Colors.muted,
  },
  input: {
    ...Type.body,
    minHeight: 48,
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
    color: Colors.text,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  inputFocused: {
    borderColor: Colors.primary,
    backgroundColor: Colors.surfaceRaised,
  },
  inputError: {
    borderColor: Colors.danger,
  },
  error: {
    ...Type.label,
    color: Colors.danger,
  },
});
