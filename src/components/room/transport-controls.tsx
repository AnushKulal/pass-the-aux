/**
 * The transport row and the aux card, and who is allowed to touch them.
 *
 * Built from design/nocturne/aux-nocturne.dc.html, screen `isSession`: the
 * transport at L936-L940 (a 50px glass circle, the 66px play, a 50px glass
 * circle), the passenger notice at L941-L945, and the aux hand-off at L946-L949.
 *
 * THE PLAY CIRCLE IS BLUE AND THAT IS THE WHOLE POINT. Coral in this direction
 * means a state of the world — live, playing, in sync, on aux — and blue means
 * an action you take. Play is an action, so it takes the primary gradient
 * (`priTint` over `pill`) and the BLUE glow, matching `CircleIconButton`'s
 * `pri` tone exactly. The coral on this screen belongs to the sync readout in
 * 'now-playing.tsx' and to the aux ring below, never to a button.
 *
 * WHY THE PLAY CIRCLE IS NOT `CircleIconButton`, WHICH IT OTHERWISE WOULD BE:
 * it is the one control here with a BUSY face. A Spotify transport call is an
 * HTTP round-trip, and `transport.isBusy` covers it with a spinner so a tap
 * that takes 400ms does not read as a dead button. The kit's circle has no
 * loading state and this file may not add one, so the recipe is reproduced
 * here — same 66px, same gradient stops, same `0 12px 30px var(--aux-glow)`
 * bloom (L938), same 28px stroke-only glyph. If `CircleIconButton` ever grows a
 * `loading` prop, this becomes four lines and should.
 *
 * FIVE CELLS, NOT THE ARTBOARD'S THREE. The design draws seekBack / play / skip
 * only, but `onShuffle` and `onRepeat` are wired on the Session screen and
 * deleting a control to match a static mock is how features quietly disappear.
 * They flank the design's three as `ghost` circles — no fill, no border — so
 * the row still reads as one 66px action with satellites rather than five
 * competing buttons.
 *
 * A passenger still SEES the transport, because hiding it makes the screen look
 * broken rather than borrowed, but the cells are inert and marked disabled to
 * assistive tech. RLS would reject a passenger's UPDATE on `rooms` anyway. What
 * is new is the notice underneath (L943): the dimming used to be the only
 * explanation, and a dimmed row explains nothing.
 *
 * `AuxCard` is the row underneath: who has the aux, and the one button that
 * changes that — TAKE THE AUX for a passenger, PASS THE AUX for the host. It
 * has a loading face (skeletons in the real row shape) and an empty one
 * (nobody on aux yet, and the button that fixes that).
 *
 * DELIBERATE DEVIATION IN `AuxCard`: the artboard draws both hand-off buttons
 * as coral wash pills (L944, L948). They are ACTIONS, so they are blue here and
 * the coral is spent on the state beside them — the avatar's live ring and the
 * ON AUX kicker. That is the accent rule's own worked example ("the BUTTON is
 * blue and the BADGE beside it is coral") applied to the one place the artboard
 * contradicts it.
 */

import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { Pause, Play, Repeat, Shuffle, SkipBack, SkipForward } from 'lucide-react-native';
import { memo } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { AuxButton, Avatar, CircleIconButton, GlassCard, Skeleton } from '@/components/ui';
import { Fonts, Radii, Space, Type, tracking } from '@/lib/theme';
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
  /**
   * Whoever holds the aux, for the passenger notice. Optional so the Session
   * screen keeps compiling untouched; without it the notice still explains the
   * rule, it just cannot name the person.
   */
  auxName?: string | null;
  /**
   * Opt-in shortcut on the passenger notice (L944). Left out by default because
   * `AuxCard` already carries the request affordance further down the screen,
   * and two "Request" buttons on one screen is worse than a scroll.
   */
  onRequestAux?: () => void;
};

/** L938. The one control on this screen that is filled. */
const PLAY = 66;
/** L937 / L939. `CircleIconButton` has no 50, and 52 is the step it does have. */
const SATELLITE = 52;
const GLYPH_STROKE = 2;

/** L938: `box-shadow:0 12px 30px var(--aux-glow)`. */
function playBloom(color: string): object {
  return { boxShadow: [{ offsetX: 0, offsetY: 12, blurRadius: 30, color }] };
}

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
  auxName,
  onRequestAux,
}: TransportControlsProps) {
  const C = useColors();

  const seekBack = onSeekBack ?? onRestart;
  const Glyph = isPlaying ? Pause : Play;
  const live = isHost && !isBusy;
  const playBlocked = !live || !canPlay;

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <CircleIconButton
          icon={Shuffle}
          size={44}
          tone="ghost"
          accessibilityLabel="Shuffle"
          disabled={!onShuffle}
          onPress={() => {
            press('light');
            onShuffle?.();
          }}
        />

        <CircleIconButton
          icon={SkipBack}
          size={SATELLITE}
          tone="surface"
          accessibilityLabel={onSeekBack ? 'Back 15 seconds' : 'Restart this track'}
          disabled={!live || !canPlay || !seekBack}
          onPress={() => {
            press('light');
            seekBack?.();
          }}
        />

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
            // The bloom is what makes the circle sit above the screen; a held or
            // inert circle drops it and settles back onto the ground.
            pressed || playBlocked ? null : playBloom(C.glow),
            pressed ? styles.held : null,
            playBlocked ? styles.inert : null,
          ]}>
          {/* Under the glyph, carrying its own radius rather than relying on a
              clipping parent — Android drops the bloom above if this clips. */}
          <LinearGradient
            colors={[C.priTint, C.pill]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={[StyleSheet.absoluteFill, styles.playFill]}
          />

          {isBusy ? (
            <ActivityIndicator size="small" color={C.pillInk} />
          ) : (
            // Stroke-only: every transport glyph in the artboards is
            // `fill:none`, and a filled triangle at 28px reads as a different,
            // heavier icon set than the rest of the screen.
            <Glyph size={28} strokeWidth={GLYPH_STROKE} color={C.pillInk} />
          )}
        </Pressable>

        <CircleIconButton
          icon={SkipForward}
          size={SATELLITE}
          tone="surface"
          accessibilityLabel="Skip to the next track"
          disabled={!live || !canSkip}
          onPress={() => {
            press('light');
            onSkip();
          }}
        />

        <CircleIconButton
          icon={Repeat}
          size={44}
          tone="ghost"
          accessibilityLabel="Repeat"
          disabled={!onRepeat}
          onPress={() => {
            press('light');
            onRepeat?.();
          }}
        />
      </View>

      {/*
        L941-L945. Only a passenger sees it; a host's own controls need no
        caption. Before this, the 40% dimming was the ENTIRE explanation for why
        five buttons did nothing, which reads as a broken screen rather than a
        borrowed one. The wording falls back to the rule when `auxName` is
        absent instead of asserting a name it does not have.
      */}
      {isHost ? null : (
        <GlassCard variant="row" style={styles.notice}>
          <View style={styles.noticeRow}>
            <Text style={[styles.noticeText, { color: C.ink2 }]}>
              {auxName ? (
                <>
                  <Text style={[styles.noticeWho, { color: C.ink }]}>{auxName}</Text> is on aux.
                  Controls are theirs.
                </>
              ) : (
                'Only whoever is on aux can drive playback. Everyone hears the same instant either way.'
              )}
            </Text>

            {/*
              `bordered`, not the artboard's coral wash (L944). Requesting the
              aux is an ACTION, and the accent rule says coral is never spent on
              one — but blue here would out-shout `AuxCard`'s own CTA further
              down the screen, which is the primary way to ask. The glass
              secondary is the register a shortcut belongs in.

              The wrapper centres it: `AuxButton` sizes itself with
              `alignSelf: 'flex-start'` and this sentence wraps to three lines
              on a narrow phone.
            */}
            {onRequestAux ? (
              <View style={styles.noticeAction}>
                <AuxButton label="Request" variant="bordered" size="sm" onPress={onRequestAux} />
              </View>
            ) : null}
          </View>
        </GlassCard>
      )}
    </View>
  );
});

// ---------------------------------------------------------------- aux card

export type AuxCardProps = {
  /** Whoever holds the aux right now. */
  name: string | null;
  avatarUrl?: string | null;
  isHost: boolean;
  /** True until the room row has landed — draws the row's own skeleton. */
  isLoading?: boolean;
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
  isLoading = false,
  requestSent,
  onRequestAux,
  onPassAux,
}: AuxCardProps) {
  const C = useColors();

  if (isLoading) {
    return (
      <GlassCard>
        <View accessible accessibilityLabel="Loading who is on aux" style={styles.auxRow}>
          <Skeleton width={38} height={38} radius={Radii.pill} />
          <View style={styles.auxMeta}>
            <Skeleton width={48} height={9} radius={Radii.xs} style={styles.auxSkeletonKicker} />
            <Skeleton width={96} height={14} radius={Radii.xs} />
          </View>
          <Skeleton width={104} height={46} radius={Radii.pill} />
        </View>
      </GlassCard>
    );
  }

  const nobody = !isHost && name === null;
  const who = isHost ? 'You' : (name ?? 'Nobody yet');
  const action = isHost ? 'Pass the aux' : requestSent ? 'Requested' : 'Take the aux';
  const blocked = isHost ? !onPassAux : requestSent;

  return (
    <GlassCard>
      <View style={styles.auxRow}>
        {/* Coral on this avatar means someone is holding the aux. Nobody, no ring. */}
        <Avatar name={who} uri={avatarUrl} size={38} live={!nobody} />

        <View style={styles.auxMeta}>
          {/* The kicker carries the STATE, which is why it goes coral the moment
              somebody actually has the aux — leaving the accent free for it is
              the reason the button beside it is blue. */}
          <Text style={[styles.auxKicker, { color: nobody ? C.ink3 : C.liveText }]}>On aux</Text>
          <Text numberOfLines={1} style={[styles.auxName, { color: nobody ? C.ink2 : C.ink }]}>
            {who}
          </Text>
        </View>

        <AuxButton
          label={action}
          variant="pri"
          size="sm"
          disabled={blocked}
          onPress={() => {
            if (isHost) onPassAux?.();
            else onRequestAux();
          }}
        />
      </View>
    </GlassCard>
  );
});

// ------------------------------------------------------------------ cells

function press(weight: 'light' | 'medium') {
  if (Platform.OS === 'web') return;
  void Haptics.impactAsync(
    weight === 'medium' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingTop: Space.lg,
    paddingHorizontal: Space.lg,
  },
  /**
   * Centred with the design's own gap rather than spread across the width. The
   * old row used `space-between`, which pushed shuffle and repeat into the
   * screen's margins and left the play circle floating in a gap on either side
   * instead of anchoring a group.
   */
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.md,
  },
  play: {
    width: PLAY,
    height: PLAY,
    // Computed rather than `Radii.pill`: Android clips a 999 radius unevenly on
    // odd diameters, which shows as a flat spot on a circle this size.
    borderRadius: PLAY / 2,
    alignItems: 'center',
    justifyContent: 'center',
    // The gradient is an absolutely-positioned child, so this is its
    // containing block.
    position: 'relative',
  },
  playFill: {
    borderRadius: PLAY / 2,
  },
  held: {
    opacity: 0.82,
  },
  inert: {
    opacity: 0.4,
  },

  // -------------------------------------------------------- passenger notice
  notice: {
    marginTop: Space.md + 2,
  },
  noticeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm + 2,
  },
  noticeText: {
    flex: 1,
    minWidth: 0,
    ...Type.body(12),
    lineHeight: 17,
  },
  noticeWho: {
    fontFamily: Fonts.semibold,
  },
  noticeAction: {
    flexShrink: 0,
    alignSelf: 'center',
  },

  // ------------------------------------------------------------- aux card
  auxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md + 1,
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
  auxSkeletonKicker: {
    marginBottom: Space.xs + 1,
  },
});
