/**
 * The transport row.
 *
 * Only the host gets controls. Guests get an honest "Request the aux" instead
 * of greyed-out buttons: RLS rejects a non-host UPDATE on `rooms` anyway, and a
 * control that looks disabled but still errors on tap is worse than a control
 * that was never offered.
 */

import * as Haptics from 'expo-haptics';
import { Hand, Pause, Play, SkipForward, type LucideIcon } from 'lucide-react-native';
import { memo } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { AuxButton } from '@/components/ui';
import { Colors, Space, TOUCH_TARGET, Type, shadow } from '@/lib/theme';

export type TransportControlsProps = {
  isHost: boolean;
  isPlaying: boolean;
  /** Something is loaded, or there is a queue to pull from. */
  canPlay: boolean;
  canSkip: boolean;
  isBusy: boolean;
  onPlayPause: () => void;
  onSkip: () => void;
  onRequestAux: () => void;
  /** Latches after a request so the button cannot be spammed into the chat. */
  requestSent: boolean;
  hostName: string | null;
};

const PRIMARY_SIZE = 64;

export const TransportControls = memo(function TransportControls({
  isHost,
  isPlaying,
  canPlay,
  canSkip,
  isBusy,
  onPlayPause,
  onSkip,
  onRequestAux,
  requestSent,
  hostName,
}: TransportControlsProps) {
  if (!isHost) {
    return (
      <View style={styles.guestRow}>
        <Text numberOfLines={1} style={styles.guestLabel}>
          {hostName ? `${hostName} is on aux` : 'Someone else is on aux'}
        </Text>

        <AuxButton
          label={requestSent ? 'Requested' : 'Request the aux'}
          onPress={onRequestAux}
          variant="ghost"
          size="sm"
          icon={Hand}
          disabled={requestSent}
        />
      </View>
    );
  }

  return (
    <View style={styles.hostRow}>
      <CircleButton
        icon={isPlaying ? Pause : Play}
        label={isPlaying ? 'Pause' : 'Play'}
        onPress={onPlayPause}
        disabled={!canPlay || isBusy}
        busy={isBusy}
        primary
      />

      <CircleButton
        icon={SkipForward}
        label="Skip to the next track"
        onPress={onSkip}
        disabled={!canSkip || isBusy}
      />
    </View>
  );
});

type CircleButtonProps = {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  primary?: boolean;
};

function CircleButton({
  icon: Icon,
  label,
  onPress,
  disabled = false,
  busy = false,
  primary = false,
}: CircleButtonProps) {
  const size = primary ? PRIMARY_SIZE : TOUCH_TARGET + Space.sm;
  // Accent is a bright fill, so the glyph takes the near-black bg colour —
  // Colors.text on accent is ~1.9:1 and would be invisible.
  const tint = primary ? Colors.bg : Colors.text;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={() => {
        if (Platform.OS !== 'web') {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        }
        onPress();
      }}
      style={({ pressed }) => [
        styles.circle,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: primary ? Colors.accent : Colors.surfaceRaised,
        },
        primary && shadow('md'),
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}>
      {busy && primary ? (
        <ActivityIndicator size="small" color={tint} />
      ) : (
        <Icon size={primary ? 30 : 22} color={tint} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hostRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    // The 8px minimum between adjacent tappables, doubled for thumb comfort.
    gap: Space.xl,
    paddingVertical: Space.sm,
  },
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  pressed: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.4,
  },
  guestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.md,
    paddingVertical: Space.sm,
  },
  guestLabel: {
    ...Type.body,
    color: Colors.muted,
    flexShrink: 1,
  },
});
