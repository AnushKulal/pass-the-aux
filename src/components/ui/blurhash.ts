/**
 * A 1x1-component blurhash encoding the dark palette's `surface` (#141312).
 *
 * expo-image requires a `placeholder` on every remote image. A flat, on-palette
 * hash avoids the coloured flash a generic sample hash would cause and costs
 * nothing to decode.
 *
 * Regenerate if the surface moves: the four trailing characters are the DC term,
 * base83 of (r << 16 | g << 8 | b), so the string is literally the surface
 * colour and a stale one flashes the wrong palette on every image load. This one
 * is deliberately the *dark* surface in both themes — the placeholder is visible
 * for a frame or two and a light plate flashing to artwork is the more jarring
 * of the two.
 */
export const BLURHASH_SURFACE = '002O|q';
