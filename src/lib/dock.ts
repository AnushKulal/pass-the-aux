/**
 * How much room the floating navigation needs.
 *
 * THIS EXISTS BECAUSE THE CONSTANT VERSION WAS A TRAP.
 *
 * `Dock.reserve` used to be a plain number (42 + 68 + 16 = 126) with a docstring
 * asking every caller to add `insets.bottom` themselves. The capsule positions
 * itself at `Dock.bottom + insets.bottom`, so a screen that padded by the bare
 * constant left `16 - insets.bottom` of clearance: about -18px on an iPhone home
 * indicator and -32px on Android three-button navigation. Negative clearance
 * means the last row of the list sits under the glass, unreadable and untappable.
 *
 * Ten screens were written against that constant and NINE of them got the
 * arithmetic wrong, including the Feed. When nine out of ten callers misuse an
 * API, the API is what is broken — so the number that cannot be used correctly
 * on its own is now `Dock.reserveBase`, which nothing outside this file reads,
 * and the only public way to ask the question is this hook, which cannot be
 * wrong because it does the addition itself.
 *
 * Use it for the bottom padding of any scroll container inside `(tabs)`, and for
 * positioning anything that must float clear of the capsule.
 */

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Dock } from '@/lib/theme';

/**
 * The full bottom reservation: the capsule, the air under it, the air above it,
 * and the device's own bottom inset.
 *
 * A hook rather than a function taking insets, so a caller cannot forget the
 * argument — the whole failure this replaces was an omitted addition.
 */
export function useDockReserve(): number {
  const insets = useSafeAreaInsets();
  return Dock.reserveBase + insets.bottom;
}

/**
 * The same reservation, minus a gap the caller is already applying.
 *
 * For the surfaces that sit directly against the capsule rather than scrolling
 * under it — a DM composer, a toast — where the component's own margin already
 * supplies part of the gap and adding the full reserve would double it.
 */
export function useDockReserveLess(gap: number): number {
  return useDockReserve() - gap;
}
