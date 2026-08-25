/**
 * The live mark, as the Feed, Explore and the Lounges draw it.
 *
 * design/nocturne/aux-nocturne.dc.html — the `auxpulse` keyframe (L15) and the
 * badge punched into an avatar at L235 (`13px` disc, `3px solid var(--aux-bg)`).
 *
 * THIS IS NOW A THIN ADAPTER OVER `LivePulse`, AND THAT IS THE POINT.
 *
 * It used to own a second copy of the heartbeat: its own shared value, its own
 * 2.2s cycle, its own reduced-motion branch, easing opacity *and* scale. The
 * kit's `LivePulse` now carries the nocturne mark — opacity only, on a coral
 * glow, at four named tempos that mean something — so two implementations
 * beating at different rates on the same screen was the only thing this file
 * was still contributing. Every dot in the app is on one clock again.
 *
 * WHAT STAYED: the ring. `LivePulse` deliberately has no notion of one, because
 * a ring is not a property of the mark — it is a property of the SURFACE the
 * mark is punched into, and only a badge overhanging something else needs it.
 * That is a placement concern, so it lives out here with the two callers that
 * actually place a badge rather than inside the kit.
 *
 * The dot never carries meaning on its own: whatever it sits beside — a count,
 * "Live now", a track title — says it in words, so this stays hidden from
 * assistive tech (`LivePulse` does that for us) and collapses to a static disc
 * under reduced motion.
 */

import { StyleSheet, View } from 'react-native';

import { LivePulse, type LivePulseTempo } from '@/components/ui';
import { Radii } from '@/lib/theme';

export type LiveDotProps = {
  size?: number;
  /**
   * Draws the dot as a badge punched out of the surface behind it — the ring is
   * that surface's colour, never a new one. `C.badgeRing` is the token for a
   * badge sitting on glass; `C.bg` for one sitting directly on the ground.
   */
  ringColor?: string;
  ringWidth?: number;
  /**
   * The heartbeat. `badge` (2s) is a LIVE marker in a list, `session` (1.8s) a
   * Session you could walk into. Passing the wrong one is a lie about what the
   * screen is doing, which is why `LivePulse` names them rather than taking ms.
   */
  tempo?: LivePulseTempo;
};

export function LiveDot({ size = 7, ringColor, ringWidth = 2.5, tempo = 'badge' }: LiveDotProps) {
  if (!ringColor) return <LivePulse size={size} tempo={tempo} />;

  /*
    The ring is a filled disc with the dot centred on it, not a border — which
    reads identically and keeps `size` meaning the same thing it did when this
    was a `borderWidth`. React Native insets a border, so callers laid out
    against the OUTER box; growing it here would nudge every badge two pixels
    off the corner it is pinned to.
  */
  const core = Math.max(2, size - ringWidth * 2);

  return (
    <View
      style={[
        styles.ring,
        { width: size, height: size, borderRadius: Radii.pill, backgroundColor: ringColor },
      ]}>
      <LivePulse size={core} tempo={tempo} />
    </View>
  );
}

const styles = StyleSheet.create({
  /*
    The dot's coral glow draws over this fill rather than under it — a child's
    outset shadow paints above its parent's background. That is the nocturne
    mark: the ring separates the badge from the artwork underneath, and the
    glow is light coming off the dot on top of it.
  */
  ring: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
