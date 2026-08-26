/**
 * The ambient ground.
 *
 * Three coloured blobs drifting slowly behind everything, and the single reason
 * the rest of this design works: cards in this direction are 5.5% white, so
 * without something alive underneath them they composite to a flat grey and the
 * whole surface stack collapses into one tone. This is what they are
 * translucent ONTO.
 *
 * Built from design/nocturne/aux-nocturne.dc.html L35-37 and the `auxDrift`
 * keyframes at L21.
 *
 * Drawn with react-native-svg rather than expo-linear-gradient because these are
 * RADIAL and that library only does linear. The dependency was already in
 * package.json with zero imports.
 *
 * ---------------------------------------------------------------------------
 * THREE CORRECTIONS. All three looked correct in a browser and were wrong on a
 * device, which is the only reason "the glass does not read on my phone" could
 * survive this long.
 *
 * 1. THE BLOBS WERE PAINTING AT FULL OPACITY ON NATIVE.
 *    `<Stop stopColor="rgba(122,63,255,0.34)" />` does not mean what it says
 *    here. react-native-svg 15 REPLACES a stop's alpha with `stopOpacity`
 *    instead of multiplying by it, and a missing `stopOpacity` resolves to 1:
 *
 *      const alpha = Math.round(extractOpacity(stopOpacity) * 255);
 *      stops.push([offset, (color & 0x00ffffff) | (alpha << 24)]);
 *                          ^ the token's own alpha is masked off here
 *      // lib/extract/extractGradient.ts, and extractOpacity(undefined) → 1
 *
 *    So on iOS and Android every blob's centre rendered as SOLID #7a3fff /
 *    #ff2d78 / #4a7dff — three neon discs behind the app instead of ambient
 *    light — while the browser, which gets this same markup as real SVG and
 *    honours the colour's own alpha, showed the intended 34%. The alpha is now
 *    carried by `stopOpacity` ALONE and `stopColor` is passed opaque, which is
 *    the one spelling both renderers agree on.
 *
 * 2. THE GROUND DID NOT SCALE WITH THE SURFACE IT LIES ON.
 *    Every number in the design is a fraction of its 390px artboard, and they
 *    were held here as raw pixels. Three 300px discs are most of a phone, a
 *    third of a tablet and a rounding error in a browser window — so the ground
 *    faded out exactly where this direction is most often being looked at. The
 *    geometry is now written in artboard pixels and scaled to the column the app
 *    actually lays out in, so the composition is the artboard's at any width.
 *
 * 3. THE FALLOFF IS A BLURRED DISC'S PROFILE, NOT A CONE.
 *    The design puts a 26-30px CSS blur on each blob and that is still NOT
 *    reproduced: `filter: blur()` has no dependable native equivalent, and an
 *    SVG FeGaussianBlur would cost a real offscreen pass on every frame of the
 *    drift. But what that blur DOES is spread each disc outward and soften its
 *    ramp, and that is reproducible for free — the gradient now runs a blurred
 *    disc's profile out to the full radius instead of a straight linear ramp
 *    that stops dead at 70%. Same peak, roughly 40% more reach, no extra pass.
 */

import { useEffect } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

import { useColors } from '@/lib/theme-context';

/** The drift, straight from the keyframes: a slow lean up and to the right. */
const DRIFT_X = 18;
const DRIFT_Y = -14;

/**
 * The artboard's frame width. Every geometry number below is written in ITS
 * pixels and scaled from here, so the design file stays the source of truth and
 * the device only changes one multiplier.
 */
const FRAME = 390;

/**
 * The widest the ground is allowed to spread, and it is `Screen`'s own column
 * cap rather than a number of its own: on a wide window the cards are centred
 * inside 720px, so the light has to land on THAT column. Anchored to the window
 * instead, the blobs sit in the far corners and every card in the middle
 * composites over bare `bg` — the flat-grey failure this file exists to prevent.
 */
const COLUMN = 720;

type BlobSpec = {
  /** In artboard pixels — see `FRAME`. */
  size: number;
  /** Exactly one of each axis, matching the design's own anchoring. */
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
  /** Full cycle in ms. The three are coprime-ish so they never resynchronise. */
  period: number;
  /** Blob B runs its animation in reverse; it drifts the other way instead. */
  reverse?: boolean;
};

const BLOBS: readonly BlobSpec[] = [
  { size: 300, left: -110, top: -70, period: 18000 },
  { size: 300, right: -120, top: 180, period: 23000, reverse: true },
  { size: 320, left: -70, bottom: -90, period: 27000 },
];

/**
 * A blurred disc's profile, as [fraction of the radius, fraction of the peak].
 *
 * This replaces `transparent 70%` — see correction 3 in the header. A linear
 * ramp that terminates at 0.7R reads as a cone with an edge; a blurred disc
 * holds more light through the middle distance and trails off to nothing, which
 * is what the artboard shows. The centre stop is 1, so the brightest pixel is
 * still EXACTLY the palette token and no light is invented here.
 */
const FALLOFF: readonly (readonly [number, number])[] = [
  [0, 1],
  [0.25, 0.74],
  [0.5, 0.44],
  [0.72, 0.18],
  [0.88, 0.05],
  [1, 0],
];

/** `rgb(…)` / `rgba(…)`, which is how every blob token in the palette is written. */
const RGB_FUNC = /^rgba?\(([^)]+)\)$/i;

/**
 * Split a palette colour into an OPAQUE colour and its alpha.
 *
 * Load-bearing, and correction 1 in the header is the whole reason: a stop that
 * carries its alpha in the COLOUR renders at full strength on native, and a stop
 * that carries it in both places gets it applied twice on web (the browser
 * multiplies stop-color's alpha by stop-opacity, per the SVG spec, where
 * react-native-svg overwrites one with the other). Passing an opaque colour and
 * the alpha separately is the only spelling that means the same thing in both.
 *
 * A colour this cannot parse is returned unchanged with alpha 1 rather than
 * guessed at — visibly too strong, which is the failure mode that gets noticed
 * and fixed, instead of silently invisible.
 */
function splitAlpha(color: string): [string, number] {
  const fn = RGB_FUNC.exec(color.trim());
  if (fn) {
    const parts = fn[1].split(',').map((part) => Number(part.trim()));
    if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) {
      const alpha = parts.length > 3 && Number.isFinite(parts[3]) ? parts[3] : 1;
      return [`rgb(${parts[0]},${parts[1]},${parts[2]})`, alpha];
    }
  }
  if (/^#[0-9a-f]{8}$/i.test(color)) {
    return [color.slice(0, 7), parseInt(color.slice(7), 16) / 255];
  }
  return [color, 1];
}

/** An artboard offset in device pixels. `undefined` stays undefined — a blob is
 *  anchored to exactly one edge per axis and the other must not resolve to 0. */
function at(value: number | undefined, scale: number): number | undefined {
  return value === undefined ? undefined : Math.round(value * scale);
}

function Blob({
  spec,
  color,
  index,
  scale,
}: {
  spec: BlobSpec;
  color: string;
  index: number;
  scale: number;
}) {
  const reduced = useReducedMotion();
  const t = useSharedValue(0);

  useEffect(() => {
    if (reduced) {
      // Held at rest rather than skipped: the blobs are the ground, not motion
      // decoration, so they must still be THERE when animation is turned off.
      t.value = 0;
      return;
    }
    t.value = withRepeat(
      withTiming(1, { duration: spec.period / 2, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [reduced, spec.period, t]);

  // Resolved out here, not inside the worklet: the drift is part of the
  // composition and scales with it, and a worklet should close over numbers
  // rather than recompute them on every frame.
  const dir = spec.reverse ? -1 : 1;
  const dx = DRIFT_X * dir * scale;
  const dy = DRIFT_Y * dir * scale;

  const drift = useAnimatedStyle(() => ({
    transform: [{ translateX: t.value * dx }, { translateY: t.value * dy }],
  }));

  const [rgb, peak] = splitAlpha(color);
  const size = Math.round(spec.size * scale);
  const id = `auxBlob${index}`;

  return (
    <Animated.View
      style={[
        styles.blob,
        drift,
        {
          width: size,
          height: size,
          left: at(spec.left, scale),
          right: at(spec.right, scale),
          top: at(spec.top, scale),
          bottom: at(spec.bottom, scale),
        },
      ]}>
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="50%">
            {FALLOFF.map(([offset, level]) => (
              /*
                Every stop is the SAME hue at a different alpha — never
                `transparent` for the last one. Several renderers interpolate an
                unspecified stop through black, which rings a dark halo around
                every blob on a dark ground.
              */
              <Stop key={offset} offset={offset} stopColor={rgb} stopOpacity={peak * level} />
            ))}
          </RadialGradient>
        </Defs>
        <Circle cx="50%" cy="50%" r="50%" fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
}

/**
 * Sits at the bottom of the stack, inside the themed root, above nothing.
 *
 * `pointerEvents="none"` on the container is load-bearing — this covers the
 * entire screen, and an earlier full-bleed overlay in this app silently ate
 * every tap in the app for exactly this reason.
 *
 * Colours come from the palette in both themes. Light is not a dimmed copy of
 * dark: its blobs are roughly a third of the alpha and all three shift blue,
 * because at dark-mode strength they read as stains on a pale ground rather
 * than light behind it. That is the palette's call, and this file only ever
 * scales the geometry.
 */
export function AmbientGround() {
  const C = useColors();
  const { width } = useWindowDimensions();
  const colors = [C.blobA, C.blobB, C.blobC];

  // `width` is 0 for the first frame of a server-rendered web page; falling back
  // to the artboard's own width keeps the ground at 1:1 rather than collapsing
  // it to nothing and popping a frame later.
  const scale = Math.min(width > 0 ? width : FRAME, COLUMN) / FRAME;

  return (
    <View pointerEvents="none" style={styles.root}>
      {/*
        The column, not the window. `root` is what clips (at the window edge);
        this frame deliberately does NOT clip, so a blob anchored off the
        column's left edge keeps bleeding softly across the page instead of
        being sliced into a hard vertical seam down the middle of a wide window.
      */}
      <View style={styles.frame}>
        {BLOBS.map((spec, i) => (
          <Blob key={i} spec={spec} color={colors[i]} index={i} scale={scale} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    overflow: 'hidden',
  },
  frame: {
    flex: 1,
    width: '100%',
    maxWidth: COLUMN,
    alignSelf: 'center',
  },
  blob: {
    position: 'absolute',
  },
});
