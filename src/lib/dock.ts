/**
 * How much room the bottom chrome needs.
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
 *
 * ─── THE BOTTOM CHROME IS NO LONGER ONE OBJECT ──────────────────────────────
 *
 * A minimised Session puts a second piece of glass above the capsule
 * (`@/components/shell/mini-session`), and it is present or absent depending on
 * app STATE rather than on which screen you are looking at. That is exactly the
 * shape of the bug this file was written to end: a reservation that is right
 * most of the time and silently short the rest of it, with the last row of every
 * list hiding under the glass when it is wrong.
 *
 * So the hook asks. `useDockReserve()` now reads `useSession()` and folds the
 * bar's own footprint in when the bar is showing, which means EVERY existing
 * caller — the Feed, Explore, Lounges, Messages, the composers, the toast,
 * `Screen`'s `reserveDock` — got the new clearance for free, with no edits and
 * no chance of one of them being forgotten. That is the whole argument for
 * keeping this a hook rather than a constant: the answer was allowed to grow a
 * second term without ten screens having to be told.
 *
 * Reading session state from here is safe everywhere it is called from:
 * `SessionProvider` is mounted in `@/lib/providers` ABOVE the navigator, so it
 * wraps every route, the toast host and the update prompt alike.
 */

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSession } from '@/lib/session';
import { Dock } from '@/lib/theme';

/**
 * The minimised-Session bar's own metrics.
 *
 * THEY LIVE HERE RATHER THAN IN 'theme.ts' — which this pass does not own —
 * and here is where they belong anyway: the bar's height is not a style choice
 * that happens to be reusable, it is a term in this file's arithmetic. Anything
 * that changes it changes what every scroll container in `(tabs)` has to clear,
 * and putting the number one import away from the sum that consumes it is how
 * `Dock.reserveBase` came to be written out by hand as `42 + 68 + 16` and go
 * stale when the nav grew.
 *
 * `mini-session.tsx` reads both: `height` is the bar, and `gap` is the air it
 * floats on above the capsule.
 */
export const MiniDock = {
  /**
   * 62: a 42px artwork tile with 10px of air above and below it, which is also
   * enough for the two lines of text beside it (14px title over an 11px label).
   */
  height: 62,
  /**
   * The air between the bar's bottom edge and the capsule's top edge. Smaller
   * than `Dock.inset`, on purpose — these two are one stack of chrome, not two
   * unrelated floating objects, and the gap has to read as narrower than the
   * margin holding the pair off the screen edges.
   */
  gap: 10,
} as const;

/**
 * Is the minimised-Session bar on screen right now?
 *
 * `minimized`, NOT `active`: a Session is active while its own screen is up too,
 * and there is no bar then — the screen is the Session. Reading `active` here
 * would over-reserve 72px on the one screen that has no capsule to clear either.
 */
function useMiniDockShowing(): boolean {
  return useSession().minimized;
}

/**
 * The full bottom reservation: the capsule, the return bar when there is one,
 * the air above and below them, and the device's own bottom inset.
 *
 * A hook rather than a function taking insets, so a caller cannot forget the
 * argument — the whole failure this replaces was an omitted addition. It now
 * also cannot forget the bar, which is the same failure one layer up.
 */
export function useDockReserve(): number {
  const insets = useSafeAreaInsets();
  const mini = useMiniDockShowing();

  /*
    `height + gap` and nothing more, because `Dock.reserveBase`'s trailing 16 is
    the air ABOVE the topmost piece of chrome. Adding the bar does not add a
    second helping of that air, it moves it: 16px above the bar instead of 16px
    above the capsule, with `MiniDock.gap` between the two. Adding 16 again here
    would open a visible hole under every list.
  */
  return Dock.reserveBase + insets.bottom + (mini ? MiniDock.height + MiniDock.gap : 0);
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
