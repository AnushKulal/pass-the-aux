import { useCallback, useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AuxButton, GlassCard } from '@/components/ui';
import { loungeErrorMessage, useJoinByCode } from '@/features/lounges/queries';
import {
  Colors,
  Fonts,
  PointerEvents,
  Radius,
  Space,
  TOUCH_TARGET,
  Type,
  ZIndex,
} from '@/lib/theme';

export type JoinCodeModalProps = {
  visible: boolean;
  onClose: () => void;
  /** Receives the joined lounge's id so the caller can navigate to it. */
  onJoined: (loungeId: string) => void;
};

/** `gen_random_bytes(6)` hex-encoded and truncated: eight uppercase characters. */
const CODE_LENGTH = 8;

/**
 * The code is set in the mono face at title size and tracked wide open, because
 * eight characters read aloud across a room have to survive being misheard —
 * mono is the only face here where 0/O and 1/I are visibly different shapes.
 * No token carries a 24px mono, so it is composed from Fonts.monoMedium and the
 * title size rather than invented.
 */
const CODE_TYPE = {
  fontFamily: Fonts.monoMedium,
  fontSize: Type.title.fontSize,
  lineHeight: Type.title.lineHeight,
  letterSpacing: 3.4,
} as const;

export function JoinCodeModal({ visible, onClose, onJoined }: JoinCodeModalProps) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const join = useJoinByCode();

  // Reopening should feel like a fresh attempt, not a retry of the last failure.
  useEffect(() => {
    if (visible) {
      setCode('');
      setError(null);
      setFocused(false);
    }
  }, [visible]);

  const handleChange = useCallback((value: string) => {
    // Codes are uppercase hex; normalising as the user types means a pasted
    // lowercase code from a chat app just works.
    setCode(value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, CODE_LENGTH));
    setError(null);
  }, []);

  const handleSubmit = useCallback(() => {
    setError(null);
    join.mutate(code, {
      onSuccess: (loungeId) => onJoined(loungeId),
      onError: (err) => setError(loungeErrorMessage(err, 'Could not join. Try again.')),
    });
  }, [code, join, onJoined]);

  const onFocus = useCallback(() => setFocused(true), []);
  const onBlur = useCallback(() => setFocused(false), []);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      // Wires up the Android hardware back button.
      onRequestClose={onClose}
      statusBarTranslucent>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.fill}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          onPress={onClose}
          style={styles.scrim}
        />

        <View style={[styles.center, PointerEvents.boxNone]}>
          <GlassCard style={styles.card}>
            <View style={styles.content}>
              <Text style={styles.title}>Join with a code</Text>
              <Text style={styles.hint}>
                Ask someone in the lounge for its invite code — eight characters.
              </Text>

              {/*
                The panel is the field. A label, a hairline box and the code
                itself in mono — the same object the lounge header hands out,
                turned around so you can type into it. The focus ring is
                Colors.primary: entering a code is not yet a live thing.
              */}
              <View style={[styles.codePanel, focused && styles.codePanelFocused]}>
                <Text style={styles.codeLabel}>Invite code</Text>
                <TextInput
                  value={code}
                  onChangeText={handleChange}
                  onFocus={onFocus}
                  onBlur={onBlur}
                  placeholder="A1B2C3D4"
                  placeholderTextColor={Colors.faint}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="off"
                  maxLength={CODE_LENGTH}
                  selectionColor={Colors.primary}
                  accessibilityLabel="Invite code"
                  style={styles.codeInput}
                />
              </View>

              {/* A polite live region is what actually announces the failure —
                  RN has no aria-invalid equivalent to hang it off. */}
              {error ? (
                <Text accessibilityLiveRegion="polite" style={styles.error}>
                  {error}
                </Text>
              ) : null}

              <View style={styles.actions}>
                <AuxButton label="Cancel" variant="ghost" size="sm" onPress={onClose} />
                <AuxButton
                  label="Join"
                  size="sm"
                  onPress={handleSubmit}
                  loading={join.isPending}
                  disabled={code.length < CODE_LENGTH}
                />
              </View>
            </View>
          </GlassCard>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  scrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: Colors.scrim,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    padding: Space.lg,
    zIndex: ZIndex.modal,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    // Sheet radius — this is a surface that arrives over the room, not a card
    // that sits in it.
    borderRadius: Radius.xl,
  },
  content: {
    gap: Space.md,
  },
  title: {
    ...Type.title,
    color: Colors.text,
  },
  hint: {
    ...Type.body,
    color: Colors.muted,
  },
  codePanel: {
    gap: Space.xs,
    paddingHorizontal: Space.lg,
    paddingTop: Space.md,
    paddingBottom: Space.sm,
    borderRadius: Radius.md,
    backgroundColor: Colors.glass,
    borderWidth: 1,
    // Border width never changes on focus, only its colour: a thicker ring
    // would shift the code by a pixel every time the field is touched.
    borderColor: Colors.border,
  },
  codePanelFocused: {
    borderColor: Colors.primary,
    backgroundColor: Colors.glassStrong,
  },
  codeLabel: {
    ...Type.monoLabel,
    color: Colors.muted,
  },
  codeInput: {
    ...CODE_TYPE,
    color: Colors.text,
    minHeight: TOUCH_TARGET,
    // The tracking adds a trailing gap after the last glyph; pulling it back
    // keeps the string optically centred in its panel.
    marginRight: -CODE_TYPE.letterSpacing,
    paddingVertical: 0,
  },
  error: {
    ...Type.label,
    color: Colors.danger,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    // 8pt minimum between adjacent tappables.
    gap: Space.md,
    marginTop: Space.xs,
  },
});
