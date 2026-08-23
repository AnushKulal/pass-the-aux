/**
 * The transport row and the aux card, and who is allowed to touch them.
 *
 * Built from design/v2/aux-v2.dc.html, screen "Session".
 *
 * Five cells: shuffle, previous, a 74px `pill` play circle, next, repeat. The
 * circle is the one filled control on the screen — it is the play state itself,
 * which is exactly what that colour is reserved for.
 *
 * A passenger still SEES the transport, because hiding it makes the screen look
 * broken rather than borrowed, but the cells are inert and marked disabled to
 * assistive tech. RLS would reject a passenger's UPDATE on `rooms` anyway.
 *
 * `AuxCard` is the row underneath: who has the aux, and the one button that
 * changes that — TAKE THE AUX for a passenger, PASS THE AUX for the host.
 */

import * as Haptics from 'expo-haptics';
import { Pause, Play, Repeat, Shuffle, SkipBack, SkipForward } from 'lucide-react-native';
import { memo, type ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/ui';
import {
  Fonts,
  Radii,
  Space,
  TOUCH_TARGET,
  Type,
  glowShadow,
  raised,
  tracking,
} from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

export type TransportControlsProps = {
  isHost: boolean;
  isPlaying: boolean;
  /** Something is loaded, or there is a queue to pull from. */
  canPlay: boolean;
  canSkip: boolean;
  isBusy: boolean;
  onPlayPause: () => void;
  onSkip: () => void;
  /**
   * There is no "previous track" in the schema — the queue is forward-only —
   * so this restarts the current one. Used as the fallback for the back cell.
   */
  onRestart?: () => void;
  /** −15 seconds. Falls back to `onRestart` when absent. */
  onSeekBack?: () => void;
  onShuffle?: () => void;
  onRepeat?: () => void;
};

const PLAY = 74;
const GLYPH_STROKE = 2;

export const TransportControls = memo(function TransportControls({
  isHost,
  isPlaying,
  canPlay,
  canSkip,
  isBusy,
  onPlayPause,
  onSkip,
  onRestart,
  onSeekBack,
  onShuffle,
  onRepeat,
}: TransportControlsProps) {
  const C = useColors();

  const seekBack = onSeekBack ?? onRestart;
  const Glyph = isPlaying ? Pause : Play;
  const live = isHost && !isBusy;
  const playBlocked = !live || !canPlay;

  return (
    <View style={styles.row}>
      <Cell label="Shuffle" disabled={!onShuffle} onPress={onShuffle}>
        <Shuffle size={19} strokeWidth={GLYPH_STROKE} color={C.ink2} />
      </Cell>

      <Cell
        label={onSeekBack ? 'Back 15 seconds' : 'Restart this track'}
        disabled={!live || !canPlay || !seekBack}
        onPress={seekBack}>
        <SkipBack size={22} strokeWidth={GLYPH_STROKE} color={C.ink} fill={C.ink} />
      </Cell>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
        accessibilityState={{ disabled: playBlocked, busy: isBusy }}
        disabled={playBlocked}
        onPress={() => {
          press('medium');
          onPlayPause();
        }}
        style={({ pressed }) => [
          styles.play,
          { backgroundColor: C.pill },
          glowShadow(C.glow, Math.round(PLAY / 2)),
          pressed ? styles.held : null,
          playBlocked ? styles.inert : null,
        ]}>
        {isBusy ? (
          <ActivityIndicator size="small" color={C.pillInk} />
        ) : (
          <Glyph size={28} strokeWidth={GLYPH_STROKE} color={C.pillInk} fill={C.pillInk} />
        )}
      </Pressable>

      <Cell label="Skip to the next track" disabled={!live || !canSkip} onPress={onSkip}>
        <SkipForward size={22} strokeWidth={GLYPH_STROKE} color={C.ink} fill={C.ink} />
      </Cell>

      <Cell label="Repeat" disabled={!onRepeat} onPress={onRepeat}>
        <Repeat size={19} strokeWidth={GLYPH_STROKE} color={C.ink2} />
      </Cell>
    </View>
  );
});

// ---------------------------------------------------------------- aux card

export type AuxCardProps = {
  /** Whoever holds the aux right now. */
  name: string | null;
  avatarUrl?: string | null;
  isHost: boolean;
  /** Latches after a request so the button cannot be spammed into the chat. */
  requestSent: boolean;
  onRequestAux: () => void;
  /**
   * Hand the aux to someone else. There is no `rooms.host_id` transfer RPC yet,
   * so the Session leaves this out and the cell reads as unavailable.
   */
  onPassAux?: () => void;
};

export const AuxCard = memo(function AuxCard({
  name,
  avatarUrl,
  isHost,
  requestSent,
  onRequestAux,
  onPassAux,
}: AuxCardProps) {
  const C = useColors();

  const who = isHost ? 'You' : (name ?? 'Nobody');
  const action = isHost ? 'Pass the aux' : requestSent ? 'Requested' : 'Take the aux';
  const blocked = isHost ? !onPassAux : requestSent;

  return (
    <View style={[styles.aux, { backgroundColor: C.surface }, raised(C)]}>
      <Avatar name={who} uri={avatarUrl} size={38} live />

      <View style={styles.auxMeta}>
        <Text style={[styles.auxKicker, { color: C.ink3 }]}>On aux</Text>
        <Text numberOfLines={1} style={[styles.auxName, { color: C.ink }]}>
          {who}
        </Text>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={isHost ? 'Pass the aux to someone else' : action}
        accessibilityHint={
          isHost || requestSent ? undefined : 'Asks for the aux in the Session chat'
        }
        accessibilityState={{ disabled: blocked }}
        disabled={blocked}
        hitSlop={{ top: 4, bottom: 4, left: 0, right: 0 }}
        onPress={() => {
          press('light');
          if (isHost) onPassAux?.();
          else onRequestAux();
        }}
        style={({ pressed }) => [
          styles.auxAction,
          { backgroundColor: C.pill },
          pressed ? styles.held : null,
          blocked ? styles.inert : null,
        ]}>
        <Text style={[styles.auxActionLabel, { color: C.pillInk }]}>{action}</Text>
      </Pressable>
    </View>
  );
});

// ------------------------------------------------------------------ cells

function press(weight: 'light' | 'medium') {
  if (Platform.OS === 'web') return;
  void Haptics.impactAsync(
    weight === 'medium' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light
  );
}

type CellProps = {
  label: string;
  disabled: boolean;
  onPress?: () => void;
  children: ReactNode;
};

/** A bare 44px target. No fill and no border — the artboard's outer glyphs. */
function Cell({ label, disabled, onPress, children }: CellProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled || !onPress}
      onPress={() => {
        press('light');
        onPress?.();
      }}
      style={({ pressed }) => [
        styles.cell,
        pressed ? styles.held : null,
        disabled ? styles.inert : null,
      ]}>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Space.xxl,
    paddingHorizontal: Space.xl,
  },
  cell: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  play: {
    width: PLAY,
    height: PLAY,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  held: {
    opacity: 0.82,
  },
  inert: {
    opacity: 0.4,
  },

  // ------------------------------------------------------------- aux card
  aux: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md + 1,
    padding: Space.md + 1,
    paddingRight: Space.md + 3,
    borderRadius: Radii.lg,
  },
  auxMeta: {
    flex: 1,
    minWidth: 0,
  },
  auxKicker: {
    ...Type.label(10),
    letterSpacing: tracking(10, 0.14),
  },
  auxName: {
    fontFamily: Fonts.extrabold,
    fontSize: 14.5,
    letterSpacing: tracking(14.5, -0.01),
    marginTop: 2,
  },
  auxAction: {
    flexGrow: 0,
    flexShrink: 0,
    paddingHorizontal: 15,
    paddingVertical: 11,
    borderRadius: Radii.sm,
  },
  auxActionLabel: {
    fontFamily: Fonts.semibold,
    fontSize: 12,
    letterSpacing: tracking(12, 0.02),
  },
});
