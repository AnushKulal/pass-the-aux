/**
 * A person, as a circle with one letter in it.
 *
 * From design/nocturne/aux-nocturne.dc.html — the plain avatar at L292 / L484 /
 * L683 / L1096, the identity gradient at L158 / L178 / L234 / L362 / L860, the
 * speaking ring at L1056, and the presence dot at L235 / L684 / L805.
 *
 * THREE THINGS CHANGED FROM THE SQUARE PATCHBAY AVATAR AND ALL THREE MATTER:
 *
 * 1. It is round. Every avatar in the artboards is `border-radius:50%` except
 *    the three large profile TILES (76/78/82px at radius 26/22/28), which is
 *    what `radius` is for. The default is computed from `size` rather than a
 *    999 constant: Android clips a huge radius unevenly on odd pixel sizes.
 * 2. `identity` paints the coral-to-magenta gradient behind a WHITE monogram.
 *    It is the signed-in user's own face and the hero avatars — the design
 *    never gives it to a row of other people, because the point of a gradient
 *    that only you carry is that you can find yourself in a list.
 * 3. The presence dot is a HOLE, not a badge: a coral disc ringed in the screen
 *    colour, so it reads as punched through the avatar. The ring must therefore
 *    follow the theme (`C.bg`) — pinning it dark leaves a black notch on a
 *    light ground.
 *
 * The ring (`live` / `speaking`) stays CORAL, because it says someone is
 * talking right now, which is state. Nothing here is ever blue.
 */

import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { BLURHASH_SURFACE } from '@/components/ui/blurhash';
import { useColors } from '@/lib/theme-context';
import { Duration, Fonts } from '@/lib/theme';

export type AvatarProps = {
  uri?: string | null;
  name: string;
  size?: number;
  /** Someone is on the aux or speaking: a 2px coral ring. */
  live?: boolean;
  speaking?: boolean;
  /** The identity gradient. Reserved for the signed-in user's own avatar. */
  identity?: boolean;
  /** The punched-hole activity dot at the bottom-right. */
  presence?: boolean;
  /** Overrides the circle — 26/22/28 on the three large profile tiles. */
  radius?: number;
};

/** L1056: `border:2px solid var(--aux-live)`. */
const RING = 2;

/**
 * The design's monogram runs 10px at 22, 17px at 44, 34px at 82 — a straight
 * 0.39 of the box, floored so the 22px stack avatars stay readable.
 */
const monogram = (size: number) => Math.max(10, Math.round(size * 0.39));

/**
 * CSS `linear-gradient(150deg, …)` on a square. The axis unit vector is
 * (0.5, 0.866); projected out from the centre far enough to cover the box, the
 * stops land at (0.16, 0) and (0.84, 1). Passing the corners instead would be
 * 135deg and visibly rotates the seam.
 */
const GRAD_START = { x: 0.16, y: 0 } as const;
const GRAD_END = { x: 0.84, y: 1 } as const;

/**
 * The coral bloom under an identity avatar, as the artboards ladder it:
 * `0 8px 20px` at 48 (L234), `0 10px 24px` at 82 (L178), `0 12px 26px` at 76
 * (L362). It is a COLOURED glow — light coming off the tile — so it does not go
 * through `dropped()`, which is grey by definition.
 */
function identityBloom(size: number, color: string): object {
  const [offsetY, blurRadius] = size >= 76 ? [12, 26] : size >= 64 ? [10, 24] : [8, 20];
  return { boxShadow: [{ offsetX: 0, offsetY, blurRadius, color }] };
}

function initialFor(name: string): string {
  const trimmed = name.trim();
  return trimmed ? (trimmed[0] as string).toUpperCase() : '?';
}

export function Avatar({
  uri,
  name,
  size = 40,
  live = false,
  speaking = false,
  identity = false,
  presence = false,
  radius,
}: AvatarProps) {
  const C = useColors();
  const initial = useMemo(() => initialFor(name), [name]);
  const ringed = live || speaking;
  const corner = radius ?? size / 2;

  /*
    12px at 44, 13px at 48, 18px at 82 — and the ring scales with the dot, at
    2.5 / 3 / 3.5. Snapped to half-pixels rather than rounded, because at 12px a
    2px ring reads as an outline and a 3px one eats the dot.
  */
  const dot = Math.max(10, Math.round(size * 0.27));
  const dotRing = Math.round(dot * 0.21 * 2) / 2;

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={live ? `${name}, live` : name}
      style={{ width: size, height: size }}>
      <View
        style={[
          styles.frame,
          {
            width: size,
            height: size,
            borderRadius: corner,
            backgroundColor: identity ? C.live : C.avatar,
            // Border is inset in React Native, so the box stays exactly `size`
            // whether or not the ring is showing.
            borderWidth: ringed ? RING : 0,
            borderColor: ringed ? C.live : 'transparent',
          },
          identity ? identityBloom(size, C.glowSoft) : null,
        ]}>
        {/* Under everything, so the monogram and any photo sit on top of it. */}
        {identity ? (
          <LinearGradient
            colors={[C.live, C.avatarEnd]}
            start={GRAD_START}
            end={GRAD_END}
            style={StyleSheet.absoluteFill}
          />
        ) : null}

        {/* The initial sits under the image, so it doubles as the error fallback. */}
        <Text
          numberOfLines={1}
          style={[
            styles.initial,
            {
              // White on the gradient (L158); `ink` on the neutral fill (L292).
              // `ink2` — what this used to be — measures below AA on `avatar`.
              color: identity ? C.pillInk : C.ink,
              fontSize: monogram(size),
            },
          ]}>
          {initial}
        </Text>

        {uri ? (
          <Image
            source={{ uri }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            cachePolicy="memory-disk"
            placeholder={{ blurhash: BLURHASH_SURFACE }}
            transition={Duration.press}
            accessibilityIgnoresInvertColors
          />
        ) : null}
      </View>

      {/*
        A SIBLING of the clipped frame, not a child: the frame carries
        `overflow: 'hidden'` so a photo cannot escape its corner, and a dot
        drawn inside it would be sliced in half by exactly the same clip.
      */}
      {presence ? (
        <View
          style={[
            styles.dot,
            {
              width: dot,
              height: dot,
              borderRadius: dot / 2,
              backgroundColor: C.live,
              borderWidth: dotRing,
              borderColor: C.bg,
            },
          ]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  initial: {
    fontFamily: Fonts.extrabold,
    includeFontPadding: false,
  },
  dot: {
    position: 'absolute',
    right: 0,
    bottom: 0,
  },
});
