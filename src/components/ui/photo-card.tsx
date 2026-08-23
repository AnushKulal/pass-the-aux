/**
 * The photo-forward card — the primitive the new direction is built on.
 *
 * A photograph fills the whole card, a dark scrim sits over its lower portion,
 * and everything else is placed INTO that image through four overlay slots.
 * There is no text block below the picture: the picture IS the card.
 *
 * Three things carry the look, and all three are load-bearing:
 *
 *   1. The image bleeds to every edge. No inset, no border, no plate around it.
 *   2. The corners are generously rounded, and an image that runs off the top of
 *      the screen rounds only the edge it is not attached to (`corners`).
 *   3. The scrim. Text over an arbitrary photograph is unreadable without one,
 *      and skipping it is the single most common reason this style fails in
 *      practice — it looks fine against the three photos it was designed with
 *      and falls apart against the first bright one a user brings.
 *
 * The scrim is UNCONDITIONAL and it is dark in both themes. It exists because of
 * the PHOTO, not because of the palette: a light theme does not make white text
 * legible over a snowfield. That is also why its colour comes from `DarkPalette`
 * rather than `useColors()` — see SCRIM below.
 */

import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState, type ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

// The direct path, not the '@/components/ui' barrel: `PhotoCard` is exported
// FROM that barrel, so going through it would close a cycle. `avatar.tsx`
// imports this the same way, for the same reason.
import { BLURHASH_SURFACE } from '@/components/ui/blurhash';
import {
  DarkPalette,
  Duration,
  Fonts,
  GradientDirection,
  GradientLocations,
  gradientStops,
  PointerEvents,
  Radii,
  Space,
} from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

/** `lg` for a card in a list, `xl` for a hero or a sheet. */
export type PhotoCardRadius = 'lg' | 'xl';

/**
 * Which corners round.
 *
 * `bottom` is for a full-bleed header image that runs off the top of the screen
 * under the status bar — rounding its top corners would show ground above it and
 * break the bleed. `top` is the same trick for an image on a sheet's lower edge.
 */
export type PhotoCardCorners = 'all' | 'bottom' | 'top';

type PhotoCardBase = {
  uri: string | null;
  radius?: PhotoCardRadius;
  corners?: PhotoCardCorners;
  /**
   * Top-left overlay slot. The top of the card is NOT scrimmed, so anything put
   * here needs its own ground — a chip, a pill, a filled icon button — rather
   * than bare text.
   */
  topLeft?: ReactNode;
  topRight?: ReactNode;
  /** The title slot. Takes the slack in its row, so a long title wraps instead
   *  of crushing whatever sits opposite it. */
  bottomLeft?: ReactNode;
  bottomRight?: ReactNode;
  /** Makes the whole card pressable, with a subtle scale under the finger. */
  onPress?: () => void;
  accessibilityLabel?: string;
  /** Replaces the default gradient-and-glyph plate drawn when `uri` is null. */
  fallback?: ReactNode;
  /** Seeds that default plate: its letter, and which way its gradient runs. */
  fallbackSeed?: string;
  /** Margins and width from the parent. The card owns everything inside it. */
  style?: StyleProp<ViewStyle>;
};

/**
 * Exactly one of `aspect` or `height`.
 *
 * A card in a feed is a RATIO — it should get taller on a bigger phone. A card
 * in a horizontal rail is a fixed HEIGHT with its width set from `style`.
 * Accepting both would let a call site state a contradiction that only shows up
 * on one screen size, so the union rejects it at the call site instead.
 */
export type PhotoCardProps = PhotoCardBase &
  ({ aspect: number; height?: never } | { height: number; aspect?: never });

/**
 * The scrim, deliberately not theme-aware.
 *
 * `useColors().scrim` is 45% on light, tuned for dimming the app's own ground
 * behind a sheet. That is not this job — this one has to hold white text over
 * whatever photograph arrives — so it takes the dark palette's value in both
 * themes. Still a token: the rule is "no invented colours", not "no explicit
 * palette".
 */
const SCRIM = ['transparent', DarkPalette.scrim] as const;

/** How far up the card the scrim reaches. Enough for two lines plus padding. */
const SCRIM_EXTENT = '55%';

/** Barely there. A card is large; the dock's 0.9 would read as a lurch here. */
const PRESS_SCALE = 0.98;

/** Fallback glyph height, as a fraction of the plate's short side. */
const GLYPH_RATIO = 0.44;

const DIRECTIONS = ['corner', 'vertical', 'horizontal'] as const;

/** Same rule as `Avatar`: first character, uppercased. */
function glyphFor(seed: string | undefined): string {
  const trimmed = seed?.trim();
  return trimmed ? (trimmed[0] as string).toUpperCase() : '?';
}

/**
 * Picks the fallback gradient's direction from the seed.
 *
 * Without it, a grid of six lounges with no artwork renders six pixel-identical
 * tiles, which reads as a rendering bug rather than as six things missing a
 * photo. Deterministic, so a given lounge keeps its plate across launches.
 */
function directionFor(seed: string | undefined): keyof typeof GradientDirection {
  if (!seed) return 'corner';
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return DIRECTIONS[Math.abs(h) % DIRECTIONS.length] as keyof typeof GradientDirection;
}

export function PhotoCard({
  uri,
  radius = 'lg',
  corners = 'all',
  aspect,
  height,
  topLeft,
  topRight,
  bottomLeft,
  bottomRight,
  onPress,
  accessibilityLabel,
  fallback,
  fallbackSeed,
  style,
}: PhotoCardProps) {
  const C = useColors();
  const reduced = useReducedMotion();

  /*
    The held flag is React state driving the shared value from an effect, rather
    than a write straight out of the press handler: the compiler treats a shared
    value as immutable outside an effect, and one extra render per press is not
    a cost worth arguing with it over. Same trade as `AuxButton`.
  */
  const [held, setHeld] = useState(false);
  const press = useSharedValue(1);

  useEffect(() => {
    press.value = withTiming(held && !reduced ? PRESS_SCALE : 1, {
      duration: Duration.press,
    });
  }, [held, reduced, press]);

  /*
    WHICH uri failed, rather than a boolean.

    A recycled FlatList row keeps its state, so a plain `failed` flag tripped by
    one row's broken image would blank out the perfectly good photo the next row
    puts in its place. Comparing against the current uri resets itself when the
    row is reused — no effect, no extra render.
  */
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const showPhoto = uri !== null && failedUri !== uri;

  /*
    The fallback glyph scales with the card, and under `aspect` the card's size
    is only known after layout. Zero until then — the gradient is already
    painted, so the plate is never blank, the letter just lands a frame later.
  */
  const [glyph, setGlyph] = useState(0);
  const onPlateLayout = (e: LayoutChangeEvent) => {
    const { width, height: h } = e.nativeEvent.layout;
    setGlyph(Math.round(Math.min(width, h) * GLYPH_RATIO));
  };

  const animated = useAnimatedStyle(() => ({ transform: [{ scale: press.value }] }));

  const R = radius === 'xl' ? Radii.xl : Radii.lg;
  const shape: ViewStyle =
    corners === 'all'
      ? { borderRadius: R }
      : corners === 'bottom'
        ? { borderBottomLeftRadius: R, borderBottomRightRadius: R }
        : { borderTopLeftRadius: R, borderTopRightRadius: R };

  const size: ViewStyle = height !== undefined ? { height } : { aspectRatio: aspect };

  const card = (
    <Animated.View
      style={[
        styles.card,
        shape,
        size,
        // Shows through while the blurhash decodes, so it is the recessed
        // artwork well, not `surface` — a lifted grey behind a photo reads as a
        // missing image rather than as a hole the image drops into.
        { backgroundColor: C.bgRecessed },
        animated,
      ]}>
      {showPhoto ? null : fallback !== undefined ? (
        <View style={StyleSheet.absoluteFill}>{fallback}</View>
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.plate]} onLayout={onPlateLayout}>
          <LinearGradient
            colors={gradientStops(C)}
            locations={GradientLocations}
            {...GradientDirection[directionFor(fallbackSeed)]}
            style={StyleSheet.absoluteFill}
          />
          {glyph > 0 ? (
            <Text numberOfLines={1} style={[styles.letter, { color: C.ink2, fontSize: glyph }]}>
              {glyphFor(fallbackSeed)}
            </Text>
          ) : null}
        </View>
      )}

      {showPhoto ? (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="memory-disk"
          placeholder={{ blurhash: BLURHASH_SURFACE }}
          transition={Duration.press}
          /*
            Without this a recycled row paints the PREVIOUS row's photo for a
            frame before the new one decodes, and the scroll looks like it is
            shuffling the wrong artwork past you. Keyed on the uri so the view
            resets exactly when the content it holds changes.
          */
          recyclingKey={uri}
          onError={() => setFailedUri(uri)}
          accessibilityIgnoresInvertColors
        />
      ) : null}

      <LinearGradient
        colors={SCRIM}
        {...GradientDirection.vertical}
        style={[styles.scrim, PointerEvents.none]}
      />

      {/*
        `box-none` all the way down: the gaps between the slots let a touch
        through to the card's own press, while a control a caller puts INSIDE a
        slot still gets its taps.
      */}
      <View style={[styles.overlay, PointerEvents.boxNone]}>
        {topLeft || topRight ? (
          <View style={[styles.row, styles.rowTop, PointerEvents.boxNone]}>
            <View style={[styles.start, PointerEvents.boxNone]}>{topLeft}</View>
            <View style={[styles.end, PointerEvents.boxNone]}>{topRight}</View>
          </View>
        ) : null}

        {bottomLeft || bottomRight ? (
          <View style={[styles.row, styles.rowBottom, PointerEvents.boxNone]}>
            <View style={[styles.start, PointerEvents.boxNone]}>{bottomLeft}</View>
            <View style={[styles.end, PointerEvents.boxNone]}>{bottomRight}</View>
          </View>
        ) : null}
      </View>
    </Animated.View>
  );

  if (!onPress) {
    // Only claim to be an image when there is something to announce; otherwise
    // leave the slots' own content addressable individually.
    const labelled = accessibilityLabel !== undefined;
    return (
      <View
        accessible={labelled}
        accessibilityRole={labelled ? 'image' : undefined}
        accessibilityLabel={accessibilityLabel}
        style={style}>
        {card}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      onPressIn={() => setHeld(true)}
      onPressOut={() => setHeld(false)}
      style={style}>
      {card}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    // Clips the photo, the scrim and the fallback plate to the rounded shape.
    // Every layer inside is absolutely positioned and carries no radius of its
    // own — this one property is what gives all of them their corners.
    overflow: 'hidden',
  },
  plate: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  letter: {
    fontFamily: Fonts.extrabold,
    // `textAlignVertical` is Android-only, so the glyph is centred by the plate
    // above rather than inside its own text box.
    includeFontPadding: false,
  },
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: SCRIM_EXTENT,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    padding: Space.lg,
    justifyContent: 'space-between',
  },
  row: {
    flexDirection: 'row',
    gap: Space.md,
  },
  rowTop: {
    alignItems: 'flex-start',
  },
  rowBottom: {
    alignItems: 'flex-end',
    // `space-between` parks a lone child at the TOP, so a card with only bottom
    // slots would float its title into the unscrimmed half. This pins it down.
    marginTop: 'auto',
  },
  start: {
    // Takes the slack, so the end slot sits hard against the right edge even
    // when its opposite number is empty.
    flex: 1,
    alignItems: 'flex-start',
  },
  end: {
    // Never squeezed: a badge or an icon button keeps its intrinsic size.
    flexShrink: 0,
    alignItems: 'flex-end',
  },
});
