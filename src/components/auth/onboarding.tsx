/**
 * The onboarding kit.
 *
 * Sign in, Claim handle and Profile setup each carried their own copy of the
 * same field, the same tick and the same 56px button — three hand-rolled
 * `Field` components with three slightly different focus rules between them.
 * This is that set, once.
 *
 * Built from design/v2/aux-v2.dc.html, screens "Sign in", "Claim handle" and
 * "Profile setup". It is deliberately NOT in '@/components/ui': every piece
 * here is shaped by the signed-out flow (a 56px `pill` button, a recessed well
 * with no border, a tick that only ever means "done"), and the kit already has
 * general-purpose answers for screens that want one.
 */

import { Check } from 'lucide-react-native';
import { useEffect } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type TextInputProps,
} from 'react-native';
import {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import {
  Duration,
  Fonts,
  Radii,
  Space,
  TOUCH_TARGET,
  Type,
  dropped,
  pressed as recessed,
  tracking,
} from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

/** The design's field well. No border — the recess is the whole affordance. */
const FIELD_HEIGHT = 52;
/** The multiline variant: the bio well on Profile setup. */
const AREA_MIN_HEIGHT = 46;
const CTA_HEIGHT = 56;

/**
 * The screen entrance.
 *
 * Driven by a shared value from an effect, NOT by `entering={FadeIn…}`.
 * Reanimated marks an entering view `visibility: hidden` until its animation
 * runs, and on react-native-web that animation never fires — which leaves a
 * screen that reports correct colour, size and layout while being completely
 * invisible. Both of the screens this replaced were written that way.
 *
 * An effect always runs, so this cannot fail the same way.
 */
export function useEnterStyle() {
  const reduced = useReducedMotion();
  const enter = useSharedValue(0);

  useEffect(() => {
    enter.value = reduced ? 1 : withTiming(1, { duration: Duration.enter });
  }, [reduced, enter]);

  return useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * 10 }],
  }));
}

/* ------------------------------------------------------------------ header */

export type OnboardingHeaderProps = {
  title: string;
  /** One line. If it does not tell the reader what to do next, cut it. */
  lede: string;
  /** 30 on the two full screens, 29 where a longer title has to fit. */
  size?: number;
};

export function OnboardingHeader({ title, lede, size = 30 }: OnboardingHeaderProps) {
  const C = useColors();

  return (
    <View>
      <Text
        accessibilityRole="header"
        style={[
          Type.display(size),
          {
            color: C.ink,
            lineHeight: Math.round(size * 1.1),
            letterSpacing: tracking(size, -0.03),
          },
        ]}>
        {title}
      </Text>
      <Text style={[styles.lede, { color: C.ink2 }]}>{lede}</Text>
    </View>
  );
}

/* ------------------------------------------------------------------- field */

export type OnboardingFieldProps = {
  /** Rendered as the uppercase kicker above the well, and as the a11y name. */
  label?: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  error?: string;
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences';
  autoComplete?: string;
  keyboardType?: KeyboardTypeOptions;
  maxLength?: number;
  multiline?: boolean;
  /** Required when there is no visible label. */
  accessibilityLabel?: string;
};

export function OnboardingField({
  label,
  value,
  onChangeText,
  placeholder,
  error,
  secureTextEntry = false,
  autoCapitalize = 'sentences',
  autoComplete,
  keyboardType,
  maxLength,
  multiline = false,
  accessibilityLabel,
}: OnboardingFieldProps) {
  const C = useColors();

  return (
    <View>
      {label ? <Text style={[styles.kicker, { color: C.ink3 }]}>{label}</Text> : null}

      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={C.ink3}
        secureTextEntry={secureTextEntry}
        autoCapitalize={autoCapitalize}
        autoCorrect={!secureTextEntry}
        keyboardType={keyboardType}
        maxLength={maxLength}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
        // The public prop is a plain string so callers need no RN types; RN
        // wants its own union.
        autoComplete={autoComplete as TextInputProps['autoComplete']}
        accessibilityLabel={accessibilityLabel ?? label}
        selectionColor={C.live}
        style={[
          multiline ? styles.area : styles.field,
          { backgroundColor: C.bgRecessed, color: C.ink },
          recessed(C),
        ]}
      />

      {error ? (
        <Text accessibilityLiveRegion="polite" style={[styles.error, { color: C.liveText }]}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/* -------------------------------------------------------------------- tick */

/**
 * Done. A `pill` disc with the tick punched out of it — the same mark the
 * design uses for an available handle and for a finished setup row.
 *
 * Decorative on purpose: every caller already reports the same fact through
 * `accessibilityState` on the row that owns it, and a second announcement
 * reads as two separate things being true.
 */
export function Done({ size = 24 }: { size?: number }) {
  const C = useColors();

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[styles.done, { width: size, height: size, backgroundColor: C.pill }]}>
      <Check size={Math.round(size * 0.56)} strokeWidth={3} color={C.pillInk} />
    </View>
  );
}

/* ----------------------------------------------------------------- buttons */

export type PrimaryCtaProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  /** 14px instead of 15 — for the one label long enough to need it. */
  compact?: boolean;
  /** When the visible label is shorter than the action. */
  accessibilityLabel?: string;
};

/** The one filled button per screen: 56px, `pill`, floating on a drop shadow. */
export function PrimaryCta({
  label,
  onPress,
  disabled = false,
  loading = false,
  compact = false,
  accessibilityLabel,
}: PrimaryCtaProps) {
  const C = useColors();
  const blocked = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: blocked, busy: loading }}
      disabled={blocked}
      onPress={onPress}
      style={({ pressed }) => [
        styles.cta,
        { backgroundColor: C.pill },
        dropped(C, 'lg'),
        blocked ? styles.blocked : null,
        pressed && !blocked ? styles.held : null,
      ]}>
      {loading ? (
        <ActivityIndicator size="small" color={C.pillInk} />
      ) : (
        <Text
          numberOfLines={1}
          style={[compact ? styles.ctaLabelCompact : styles.ctaLabel, { color: C.pillInk }]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export type SecondaryLinkProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
};

/** The quiet way out, under the button. Text only — it is not a second action. */
export function SecondaryLink({ label, onPress, disabled = false }: SecondaryLinkProps) {
  const C = useColors();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.secondary, pressed ? styles.held : null]}>
      <Text style={[styles.secondaryLabel, { color: C.ink2 }]}>{label}</Text>
    </Pressable>
  );
}

/* ----------------------------------------------------------------- styles */

const styles = StyleSheet.create({
  lede: {
    ...Type.body(14),
    lineHeight: 20,
    marginTop: Space.sm,
  },

  kicker: {
    ...Type.label(10.5),
    letterSpacing: tracking(10.5, 0.14),
    marginBottom: 9,
  },
  field: {
    height: FIELD_HEIGHT,
    borderRadius: Radii.md,
    paddingHorizontal: Space.lg,
    paddingVertical: 0,
    fontFamily: Fonts.regular,
    fontSize: 15,
  },
  area: {
    minHeight: AREA_MIN_HEIGHT,
    borderRadius: Radii.sm,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontFamily: Fonts.regular,
    fontSize: 14,
    lineHeight: 20,
  },
  error: {
    ...Type.body(12.5),
    marginTop: Space.sm,
  },

  done: {
    flexShrink: 0,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },

  cta: {
    height: CTA_HEIGHT,
    borderRadius: Radii.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaLabel: {
    fontFamily: Fonts.semibold,
    fontSize: 15,
    letterSpacing: tracking(15, -0.005),
  },
  ctaLabelCompact: {
    fontFamily: Fonts.semibold,
    fontSize: 14,
    letterSpacing: tracking(14, 0.02),
  },
  /** The design's disabled state everywhere: the live cell, dimmed. */
  blocked: {
    opacity: 0.55,
  },
  held: {
    opacity: 0.9,
  },

  secondary: {
    minHeight: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryLabel: {
    fontFamily: Fonts.semibold,
    fontSize: 13.5,
  },
});
