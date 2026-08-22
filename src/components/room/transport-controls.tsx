/**
 * The transport row, and who is allowed to touch it.
 *
 * Three cells: a 52px −15 seek, a flexible accent play/pause that is the widest
 * thing on the screen, and a 52px skip. Underneath, one of two rows:
 *
 *   - on aux  → PASS THE AUX, bordered in accent
 *   - passenger → "@mira is on aux. Controls are theirs." + a REQUEST cell
 *
 * A passenger still SEES the transport, because hiding it makes the screen look
 * broken rather than borrowed — but the cells are inert and marked disabled to
 * assistive tech, and the sentence directly beneath says whose they are. RLS
 * would reject a passenger's UPDATE on `rooms` anyway; a control that looks
 * live and then errors is worse than one that reads as someone else's.
 *
 * The play cell is the one accent FILL in this component. It is allowed to be:
 * it is the play state itself, which is exactly what the colour is reserved
 * for.
 */

import * as Haptics from 'expo-haptics';
import { ArrowRight, Pause, Play, RotateCcw, SkipForward } from 'lucide-react-native';
import { memo, type ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { Fonts, Rule, Space, TOUCH_TARGET, Type, tracking } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

import { TABULAR } from './drift';

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
   * forward-only — so this restarts the current one. Used as the fallback for
   * the −15 cell when no explicit seek-back handler is wired.
   */
  onRestart?: () => void;
  /** −15 seconds. Falls back to `onRestart` when absent. */
  onSeekBack?: () => void;
  /**
   * Hand the aux to someone else. There is no `rooms.host_id` transfer RPC yet,
   * so the Session screen currently opens the roster instead of mutating.
   */
  onPassAux?: () => void;
};

const CELL = 52;
const GLYPH_STROKE = 2;

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
  onSeekBack,
  onPassAux,
}: TransportControlsProps) {
  const C = useColors();

  const seekBack = onSeekBack ?? onRestart;
  const Glyph = isPlaying ? Pause : Play;
  const controlsLive = isHost && !isBusy;

  return (
    <View style={styles.root}>
      <View style={styles.row}>
        <SideCell
          label={isPlaying || onSeekBack ? 'Back 15 seconds' : 'Restart this track'}
          disabled={!controlsLive || !canPlay || !seekBack}
          onPress={seekBack}>
          {onSeekBack ? (
            <Text style={[styles.sideLabel, { color: C.ink2 }]}>−15</Text>
          ) : (
            <RotateCcw size={20} strokeWidth={GLYPH_STROKE} color={C.ink2} />
          )}
        </SideCell>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
          accessibilityState={{ disabled: !controlsLive || !canPlay, busy: isBusy }}
          disabled={!controlsLive || !canPlay}
          onPress={() => {
            press('medium');
            onPlayPause();
          }}
          style={({ pressed }) => [
            styles.play,
            { backgroundColor: C.live },
            pressed ? { backgroundColor: C.liveText } : null,
            !controlsLive || !canPlay ? styles.inert : null,
          ]}>
          {isBusy ? (
            <ActivityIndicator size="small" color={C.onLive} />
          ) : (
            <Glyph size={22} strokeWidth={GLYPH_STROKE} color={C.onLive} />
          )}
        </Pressable>

        <SideCell
          label="Skip to the next track"
          disabled={!controlsLive || !canSkip}
          onPress={onSkip}>
          <SkipForward size={20} strokeWidth={GLYPH_STROKE} color={C.ink2} />
        </SideCell>
      </View>

      {isHost ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Pass the aux to someone else"
            accessibilityState={{ disabled: !onPassAux }}
            disabled={!onPassAux}
            onPress={() => {
              press('light');
              onPassAux?.();
            }}
            style={({ pressed }) => [
              styles.pass,
              { borderColor: C.live },
              pressed ? { backgroundColor: C.liveWash } : null,
              !onPassAux ? styles.inert : null,
            ]}>
            <Text style={[styles.passLabel, { color: C.liveText }]}>Pass the aux</Text>
            <ArrowRight size={15} strokeWidth={GLYPH_STROKE} color={C.liveText} />
          </Pressable>

          {onPassAux ? null : (
            /*
              Say what the product cannot do and move on, per the copy guidance.
              `rooms` RLS pins `host_id` to `auth.uid()` on both the USING and
              the WITH CHECK clause, so handing the aux over needs an RPC that
              is not in `supabase/migrations/` yet.
            */
            <Text style={[styles.passNote, { color: C.ink3 }]}>
              Handing the aux over is not wired up yet — you keep the controls for now.
            </Text>
          )}
        </>
      ) : (
        <View style={[styles.passenger, { borderColor: C.rule2 }]}>
          <Text style={[styles.passengerLine, { color: C.ink2 }]}>
            <Text style={[styles.passengerName, { color: C.ink }]}>
              {hostName ? `@${hostName}` : 'Someone else'}
            </Text>
            {' is on aux. Controls are theirs.'}
          </Text>

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
              press('light');
              onRequestAux();
            }}
            style={({ pressed }) => [
              styles.request,
              { borderColor: C.live },
              pressed ? { backgroundColor: C.liveWash } : null,
              requestSent ? styles.inert : null,
            ]}>
            <Text style={[styles.requestLabel, { color: C.liveText }]}>
              {requestSent ? 'Requested' : 'Request'}
            </Text>
          </Pressable>
        </View>
      )}
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

type SideCellProps = {
  label: string;
  disabled: boolean;
  onPress?: () => void;
  children: ReactNode;
};

/** A bordered square. No fill, no radius — the direction's non-accent control. */
function SideCell({ label, disabled, onPress, children }: SideCellProps) {
  const C = useColors();

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
        styles.side,
        { borderColor: C.rule2 },
        pressed ? { borderColor: C.ink } : null,
        disabled ? styles.inert : null,
      ]}>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    paddingHorizontal: Space.md,
    paddingTop: Space.lg - 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    // The 8px floor between adjacent targets, exactly.
    gap: Space.sm,
  },
  side: {
    width: CELL,
    height: CELL,
    flexGrow: 0,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: Rule.hair,
  },
  sideLabel: {
    ...Type.heading(11),
    ...TABULAR,
  },
  play: {
    flex: 1,
    height: CELL,
    flexDirection: 'row',
    alignItems: 'center',
    // Left-aligned, as the artboard: the glyph sits on the gutter line rather
    // than floating in the middle of a very wide cell.
    justifyContent: 'flex-start',
    paddingHorizontal: Space.lg,
  },
  inert: {
    opacity: 0.4,
  },

  // ------------------------------------------------------------- on aux
  pass: {
    marginTop: Space.sm,
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    paddingHorizontal: Space.lg - 2,
    borderWidth: Rule.hair,
  },
  passLabel: {
    ...Type.heading(11),
    letterSpacing: tracking(11, 0.1),
    textTransform: 'uppercase',
  },
  passNote: {
    ...Type.body(16),
    marginTop: Space.sm,
  },

  // ----------------------------------------------------------- passenger
  passenger: {
    marginTop: Space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm + 1,
    paddingLeft: 11,
    paddingRight: Space.sm,
    paddingVertical: Space.sm,
    borderWidth: Rule.hair,
  },
  passengerLine: {
    ...Type.body(16),
    flex: 1,
    minWidth: 0,
  },
  passengerName: {
    fontFamily: Fonts.semibold,
  },
  request: {
    flexGrow: 0,
    flexShrink: 0,
    minHeight: TOUCH_TARGET,
    minWidth: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Space.md,
    borderWidth: Rule.hair,
  },
  requestLabel: {
    ...Type.heading(10),
    letterSpacing: tracking(10, 0.09),
    textTransform: 'uppercase',
  },
});
