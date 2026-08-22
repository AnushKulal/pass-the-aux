import * as Haptics from 'expo-haptics';
import type { LucideIcon } from 'lucide-react-native';
import { useCallback } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { Colors, Duration, PointerEvents, Radius, Space, TOUCH_TARGET, Type } from '@/lib/theme';

export type AuxButtonVariant = 'primary' | 'accent' | 'ghost' | 'danger';
export type AuxButtonSize = 'sm' | 'md' | 'lg';

export type AuxButtonProps = {
  label: string;
  onPress: () => void;
  variant?: AuxButtonVariant;
  size?: AuxButtonSize;
  icon?: LucideIcon;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
};

/** Pressed-state washes. Light fills get darkened, dark fills get lightened. */
const PRESS_LIGHTEN = 'rgba(255, 255, 255, 0.18)';
const PRESS_DARKEN = 'rgba(15, 15, 35, 0.20)';

const VARIANTS: Record<
  AuxButtonVariant,
  { bg: string; fg: string; border: string; press: string }
> = {
  primary: { bg: Colors.primary, fg: Colors.text, border: 'transparent', press: PRESS_LIGHTEN },
  /*
    Accent and danger are both bright fills. Colors.text on either falls below
    4.5:1 (green ~1.9:1, rose ~3.6:1), so both take the near-black bg colour as
    their label — 6.9:1 and 5.2:1 respectively. Do not "fix" these back to white.
  */
  accent: { bg: Colors.accent, fg: Colors.bg, border: 'transparent', press: PRESS_DARKEN },
  danger: { bg: Colors.danger, fg: Colors.bg, border: 'transparent', press: PRESS_DARKEN },
  ghost: { bg: 'transparent', fg: Colors.text, border: Colors.border, press: PRESS_LIGHTEN },
};

const SIZES: Record<
  AuxButtonSize,
  { minHeight: number; paddingHorizontal: number; gap: number; icon: number }
> = {
  sm: { minHeight: TOUCH_TARGET, paddingHorizontal: Space.lg, gap: Space.sm, icon: 16 },
  md: { minHeight: 52, paddingHorizontal: Space.xl, gap: Space.sm, icon: 18 },
  lg: { minHeight: 58, paddingHorizontal: Space.xxl, gap: Space.md, icon: 20 },
};

export function AuxButton({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon: Icon,
  loading = false,
  disabled = false,
  fullWidth = false,
}: AuxButtonProps) {
  const v = VARIANTS[variant];
  const s = SIZES[size];
  const blocked = disabled || loading;

  // Background wash instead of a scale transform: scaling a button nudges the
  // rows around it on Android and makes long labels reflow mid-press.
  const press = useSharedValue(0);
  const wash = useAnimatedStyle(() => ({ opacity: press.value }));

  const handlePress = useCallback(() => {
    // expo-haptics is a no-op stub on web, but calling it there still costs a
    // promise per tap for nothing.
    if (Platform.OS !== 'web') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onPress();
  }, [onPress]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: blocked, busy: loading }}
      disabled={blocked}
      onPress={handlePress}
      onPressIn={() => {
        press.value = withTiming(1, { duration: Duration.fast });
      }}
      onPressOut={() => {
        press.value = withTiming(0, { duration: Duration.base });
      }}
      style={[
        styles.base,
        {
          minHeight: s.minHeight,
          paddingHorizontal: s.paddingHorizontal,
          gap: s.gap,
          backgroundColor: v.bg,
          borderColor: v.border,
        },
        fullWidth && styles.fullWidth,
        blocked && styles.blocked,
      ]}>
      <Animated.View
        style={[StyleSheet.absoluteFill, { backgroundColor: v.press }, wash, PointerEvents.none]}
      />

      {loading ? (
        <ActivityIndicator size="small" color={v.fg} />
      ) : Icon ? (
        <Icon size={s.icon} color={v.fg} />
      ) : null}

      <Text numberOfLines={1} style={[styles.label, { color: v.fg }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    // Held at 1 on every variant so swapping to `ghost` never changes layout.
    borderWidth: 1,
    overflow: 'hidden',
    alignSelf: 'flex-start',
  },
  fullWidth: {
    alignSelf: 'stretch',
    width: '100%',
  },
  blocked: {
    opacity: 0.45,
  },
  label: {
    ...Type.bodyStrong,
    textAlign: 'center',
  },
});
