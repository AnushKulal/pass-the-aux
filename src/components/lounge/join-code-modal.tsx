import { useCallback, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { AuxButton, GlassCard, TextField } from '@/components/ui';
import { loungeErrorMessage, useJoinByCode } from '@/features/lounges/queries';
import { Colors, PointerEvents, Space, Type, ZIndex } from '@/lib/theme';

export type JoinCodeModalProps = {
  visible: boolean;
  onClose: () => void;
  /** Receives the joined lounge's id so the caller can navigate to it. */
  onJoined: (loungeId: string) => void;
};

/** `gen_random_bytes(6)` hex-encoded and truncated: eight uppercase characters. */
const CODE_LENGTH = 8;

export function JoinCodeModal({ visible, onClose, onJoined }: JoinCodeModalProps) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const join = useJoinByCode();

  // Reopening should feel like a fresh attempt, not a retry of the last failure.
  useEffect(() => {
    if (visible) {
      setCode('');
      setError(null);
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

              <TextField
                label="Invite code"
                value={code}
                onChangeText={handleChange}
                placeholder="A1B2C3D4"
                autoCapitalize="none"
                autoComplete="off"
                maxLength={CODE_LENGTH}
                error={error ?? undefined}
              />

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
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    // 8pt minimum between adjacent tappables.
    gap: Space.md,
    marginTop: Space.xs,
  },
});
