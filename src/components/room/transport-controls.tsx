/**
 * The transport row.
 *
 * Only the host gets controls. Guests get an honest "Request the aux" instead
 * of greyed-out buttons: RLS rejects a non-host UPDATE on `rooms` anyway, and a
 * control that looks disabled but still errors on tap is worse than a control
 * that was never offered.
 *
 * The play button is the one place on this screen where a control is allowed to
 * carry `Colors.accent`: it is the play state itself. Glass fill, accent ring,
 * accent glyph — a lit button rather than a painted one.
 */

import * as Haptics from 'expo-haptics';
import {
  Music,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  type LucideIcon,
} from 'lucide-react-native';
import { memo } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, PointerEvents, Radius, Space, TOUCH_TARGET, Type } from '@/lib/theme';

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
  /**
   * Optional. There is no "previous track" in the schema — the queue is
   * forward-only — so this is wired to a seek back to zero and labelled as
   * restarting, not as going back.
   */
  onRestart?: () => void;
};

const PRIMARY_SIZE = 64;
const GLYPH_STROKE = 1.6;

/** Between the play button and its neighbours. Well past the 8px floor. */
const CONTROL_GAP = Space.xxl + 2;

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
  onRestart,
}: TransportControlsProps) {
  if (!isHost) {
    return (
      <View style={styles.guestRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={requestSent ? 'Aux requested' : 'Request the aux'}
          accessibilityHint={
            requestSent
              ? undefined
              : hostName
                ? `Asks ${hostName} in the Session chat`
                : 'Asks in the Session chat'
          }
          accessibilityState={{ disabled: requestSent }}
          disabled={requestSent}
          onPress={() => {
            if (Platform.OS !== 'web') {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }
            onRequestAux();
          }}
          style={({ pressed }) => [
            styles.requestPill,
            pressed && styles.pressed,
            requestSent && styles.disabled,
          ]}>
          <Music size={17} strokeWidth={GLYPH_STROKE} color={Colors.text} />
          <Text numberOfLines={1} style={styles.requestLabel}>
            {requestSent ? 'Requested' : 'Request the aux'}
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.hostRow}>
      <GhostButton
        icon={SkipBack}
        label="Restart this track"
        onPress={onRestart}
        tint={Colors.muted}
        disabled={!onRestart || !canPlay || isBusy}
      />

      <PlayButton isPlaying={isPlaying} busy={isBusy} disabled={!canPlay || isBusy} onPress={onPlayPause} />

      <GhostButton
        icon={SkipForward}
        label="Skip to the next track"
        onPress={onSkip}
        tint={Colors.text}
        disabled={!canSkip || isBusy}
      />
    </View>
  );
});

// ------------------------------------------------------------------ buttons

function press() {
  if (Platform.OS !== 'web') {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }
}

type GhostButtonProps = {
  icon: LucideIcon;
  label: string;
  onPress?: () => void;
  tint: string;
  disabled: boolean;
};

/** No chrome at all — the artboard's side controls are bare glyphs on a 44 grid. */
function GhostButton({ icon: Icon, label, onPress, tint, disabled }: GhostButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled || !onPress}
      onPress={() => {
        press();
        onPress?.();
      }}
      style={({ pressed }) => [styles.ghost, pressed && styles.pressed, disabled && styles.disabled]}>
      <Icon size={22} strokeWidth={GLYPH_STROKE} color={tint} />
    </Pressable>
  );
}

type PlayButtonProps = {
  isPlaying: boolean;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
};

function PlayButton({ isPlaying, busy, disabled, onPress }: PlayButtonProps) {
  const Glyph = isPlaying ? Pause : Play;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={() => {
        press();
        onPress();
      }}
      style={({ pressed }) => [styles.play, pressed && styles.pressed, disabled && styles.disabled]}>
      {/* Stacked translucent rings stand in for a glow; RN has no box-shadow spread. */}
      <View style={[styles.playHalo, PointerEvents.none]} />

      {busy ? (
        <ActivityIndicator size="small" color={Colors.accent} />
      ) : (
        <Glyph size={20} strokeWidth={GLYPH_STROKE} color={Colors.accent} fill={Colors.accent} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hostRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: CONTROL_GAP,
  },
  ghost: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  play: {
    width: PRIMARY_SIZE,
    height: PRIMARY_SIZE,
    borderRadius: PRIMARY_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.glass,
    borderWidth: 1,
    // The one control allowed to wear accent: it IS the play state.
    borderColor: Colors.accentDim,
  },
  playHalo: {
    position: 'absolute',
    top: -6,
    right: -6,
    bottom: -6,
    left: -6,
    borderRadius: (PRIMARY_SIZE + 12) / 2,
    backgroundColor: Colors.accent,
    opacity: 0.07,
  },
  pressed: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.4,
  },

  // -------------------------------------------------------------- passenger
  guestRow: {
    flexDirection: 'row',
  },
  requestPill: {
    flex: 1,
    minHeight: TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.sm + 1,
    paddingHorizontal: Space.xl,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.borderBright,
  },
  requestLabel: {
    ...Type.label,
    color: Colors.text,
  },
});
