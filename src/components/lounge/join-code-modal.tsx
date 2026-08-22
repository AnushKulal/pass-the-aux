/**
 * Redeeming an eight-character invite code.
 *
 * The code panel is the loudest readout in the app and it is deliberate: a
 * community starts as eight characters somebody reads out over a room, so they
 * get a 2px accent frame, 32px extrabold, tabular figures and as much tracking
 * as the panel will carry. Accent is legitimate here — a code is *joinable*,
 * which is exactly what the colour is reserved for.
 */

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
  type TextStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AuxButton } from '@/components/ui';
import { loungeErrorMessage, useJoinByCode } from '@/features/lounges/queries';
import {
  Duration,
  PointerEvents,
  Rule,
  Space,
  TOUCH_TARGET,
  Type,
  ZIndex,
  tracking,
} from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

export type JoinCodeModalProps = {
  visible: boolean;
  onClose: () => void;
  /** Receives the joined lounge's id so the caller can navigate to it. */
  onJoined: (loungeId: string) => void;
};

/** `gen_random_bytes(6)` hex-encoded and truncated: eight uppercase characters. */
const CODE_LENGTH = 8;
const CODE_SIZE = 32;
const CODE_TRACKING = tracking(CODE_SIZE, 0.14);

/** `Type.readout` hands back a readonly fontVariant tuple; TextStyle wants a mutable one. */
const readout = (size: number): TextStyle => ({
  ...Type.readout(size),
  fontVariant: ['tabular-nums'],
});

export function JoinCodeModal({ visible, onClose, onJoined }: JoinCodeModalProps) {
  const C = useColors();
  const insets = useSafeAreaInsets();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const join = useJoinByCode();

  const reduced = useReducedMotion();
  const rise = useSharedValue(0);

  useEffect(() => {
    if (reduced) {
      rise.value = visible ? 1 : 0;
      return;
    }
    rise.value = withTiming(visible ? 1 : 0, {
      duration: visible ? Duration.sheet : Duration.scrim,
    });
  }, [visible, reduced, rise]);

  const sheetStyle = useAnimatedStyle(() => ({
    opacity: rise.value,
    transform: [{ translateY: (1 - rise.value) * 16 }],
  }));

  /*
    Reopening should feel like a fresh attempt, not a retry of the last failure.
    Adjusted during render rather than in an effect: an effect would paint the
    stale code for one frame first, and React re-renders immediately here.
  */
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setCode('');
      setError(null);
    }
  }

  const handleChange = useCallback((value: string) => {
    // Codes are uppercase hex; normalising as the user types means a pasted
    // lowercase code from a chat app just works.
    setCode(
      value
        .replace(/[^a-zA-Z0-9]/g, '')
        .toUpperCase()
        .slice(0, CODE_LENGTH),
    );
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
          style={[styles.scrim, { backgroundColor: C.scrim }]}
        />

        <View style={[styles.dock, PointerEvents.boxNone]}>
          <Animated.View
            style={[
              styles.sheet,
              { backgroundColor: C.bg, borderTopColor: C.live, paddingBottom: insets.bottom },
              sheetStyle,
            ]}>
            <View style={[styles.head, { borderBottomColor: C.rule }]}>
              <Text style={[styles.headTitle, { color: C.ink }]}>JOIN WITH A CODE</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel"
                onPress={onClose}
                style={({ pressed }) => [styles.close, pressed && styles.dim]}>
                <Text style={[styles.closeLabel, { color: C.ink2 }]}>CLOSE</Text>
              </Pressable>
            </View>

            <View style={styles.body}>
              <Text style={[styles.hint, { color: C.ink2 }]}>
                Ask someone in the lounge for its invite code — eight characters.
              </Text>

              <Text style={[styles.kicker, { color: C.ink3 }]}>INVITE CODE</Text>

              {/*
                The panel is the field. A 2px accent frame and the code itself,
                turned around so you can type into it. The frame never changes
                width — a thicker focus ring would shift the code by a pixel
                every time the field is touched.
              */}
              <View style={[styles.codePanel, { borderColor: C.live }]}>
                <TextInput
                  value={code}
                  onChangeText={handleChange}
                  placeholder="A1B2C3D4"
                  placeholderTextColor={C.ink3}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  autoComplete="off"
                  maxLength={CODE_LENGTH}
                  selectionColor={C.live}
                  accessibilityLabel="Invite code"
                  style={[styles.codeInput, { color: C.liveText }]}
                />
              </View>

              {/* A polite live region is what actually announces the failure —
                  RN has no aria-invalid equivalent to hang it off. */}
              {error ? (
                <View
                  accessibilityLiveRegion="polite"
                  style={[
                    styles.error,
                    { borderColor: C.dangerBorder, backgroundColor: C.dangerWash },
                  ]}>
                  <Text style={[styles.errorText, { color: C.danger }]}>{error}</Text>
                </View>
              ) : null}

              <AuxButton
                label="JOIN"
                variant="accent"
                fullWidth
                onPress={handleSubmit}
                loading={join.isPending}
                disabled={code.length < CODE_LENGTH}
              />
              <AuxButton label="CANCEL" variant="ghost" fullWidth onPress={onClose} />
            </View>
          </Animated.View>
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
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  dim: {
    opacity: 0.6,
  },
  dock: {
    flex: 1,
    justifyContent: 'flex-end',
    zIndex: ZIndex.modal,
  },
  sheet: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    borderTopWidth: Rule.major,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: Space.md,
    paddingRight: Space.xs,
    paddingTop: Space.md,
    paddingBottom: Space.sm + 2,
    borderBottomWidth: Rule.major,
  },
  headTitle: {
    ...Type.heading(15),
    letterSpacing: tracking(15, 0.03),
    flex: 1,
  },
  close: {
    minHeight: TOUCH_TARGET,
    minWidth: TOUCH_TARGET,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingHorizontal: Space.xs,
  },
  closeLabel: {
    ...Type.heading(10),
    letterSpacing: tracking(10, 0.1),
  },
  body: {
    padding: Space.md,
    paddingTop: Space.xl,
    paddingBottom: Space.xxl,
    gap: Space.md,
  },
  hint: {
    ...Type.body(14),
  },
  kicker: {
    ...Type.label(10),
  },
  codePanel: {
    borderWidth: Rule.major,
    paddingHorizontal: Space.lg,
    justifyContent: 'center',
  },
  codeInput: {
    ...readout(CODE_SIZE),
    letterSpacing: CODE_TRACKING,
    minHeight: 72,
    paddingVertical: Space.lg,
    // Tracking leaves a gap after the last glyph; pulling it back keeps the
    // string sitting flush against the frame's left edge as designed.
    marginRight: -CODE_TRACKING,
  },
  error: {
    borderWidth: Rule.hair,
    padding: Space.md,
  },
  errorText: {
    ...Type.body(13),
  },
});
