/**
 * A 1x1-component blurhash encoding Colors.surface (#140F1E).
 *
 * expo-image requires a `placeholder` on every remote image. A flat, on-palette
 * hash avoids the coloured flash a generic sample hash would cause and costs
 * nothing to decode. Reuse this anywhere a dark placeholder is wanted.
 *
 * Regenerate if Colors.surface moves: the DC term is base83(r<<16 | g<<8 | b),
 * so the string is literally the surface colour and a stale one flashes the
 * wrong palette on every image load.
 */
export const BLURHASH_SURFACE = '002O-a';
