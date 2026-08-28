/**
 * The over-the-air update sheet.
 *
 * Rises from the bottom edge when an update has been fetched and is waiting.
 * Applying it restarts the app, which would throw someone out of a Session
 * mid-track, so the reload is always the user's choice.
 *
 * Three ways out, deliberately:
 *   Update now  — apply and restart
 *   Not now     — hides the sheet, and NOTHING else
 *   X           — same as Not now, for anyone who reads a dismiss glyph first
 *
 * "Not now" no longer loses the update: the state lives in `@/lib/updates`, so
 * Settings → Software update still offers it. That was the whole reason this
 * component stopped owning its own state.
 *
 * All this renders is the sheet. Which notes to show — and how far behind the
 * user is — is decided in `@/lib/release-notes`.
 *
 * ## IT IS BUILT OUT OF THE KIT NOW, AND IT WAS NOT BEFORE
 *
 * This card was drawn under the PREVIOUS direction — a panel whose two actions
 * were cells in an edge-to-edge row divided by hairlines, the right-hand one
 * painting its own `LinearGradient` — and then patched forward one bug at a
 * time. Every part of that is now the odd one out in this app:
 *
 *   the actions are `AuxButton`s. The kit's `pri` variant IS this gradient
 *   (`priTint` over `pill`) plus the blue bloom under it, and it is what the
 *   Settings row offering the SAME update already uses. Two surfaces reporting
 *   one event should not have two different primary buttons. It also retires
 *   the hand-rolled fill for good — see the sizing note down at the actions.
 *
 *   the head is the sheet head every other sheet in this app has: an 18px
 *   display title with a `label(10)` kicker UNDER it (design L1163-1167, and
 *   `@/components/dm/attach-sheet`), closed by a `CircleIconButton` rather than
 *   a bare glyph in a hand-measured box.
 *
 *   the two hairline rules are gone. Separating with rules was the old
 *   direction's whole grammar; nocturne separates with space and with the
 *   shapes themselves, and the notes list here is now laid out exactly as the
 *   Settings card lays out the same strings.
 *
 * WHAT IT IS, in the design's vocabulary: a piece of BOTTOM CHROME, not a modal
 * sheet. It does not scrim, it does not block, and content stays visible above
 * and below it — so it takes the toast's recipe (`--sh-toast`, which is
 * `dropped(C, 'lg')`, over a `chromeBorder` edge) rather than the modal sheet's
 * `--sh-sheet`, and it sits in the toast's slot: `useDockReserve()`, clear of
 * the floating nav capsule. It previously paid only `insets.bottom`, which put
 * a 250px card straight over the navigation on every tab screen.
 *
 * `Sheet.radius` and not a card radius, because the eye reads this as a member
 * of the sheet family the moment it slides up from the bottom edge.
 *
 * NO `overflow: 'hidden'`, and that is a REVERSAL. The clip was added when the
 * action row ran edge to edge and its fill would otherwise paint square corners
 * through the rounded ones. Nothing draws to the edge any more, and the clip is
 * not merely redundant now — it is harmful twice over: Android throws away a
 * view's own `boxShadow` along with whatever the clip removes, so the card lost
 * the `dropped()` lift that makes it float on one platform only, and the
 * primary button's blue bloom would be clipped to the card's inside edge.
 */

import { useCallback, useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated from 'react-native-reanimated';
import { X } from 'lucide-react-native';

import { AuxButton, CircleIconButton } from '@/components/ui';
import { useDockReserve } from '@/lib/dock';
import {
  Duration,
  PointerEvents,
  Rule,
  Sheet as SheetMetrics,
  Space,
  Type,
  ZIndex,
  dropped,
  tracking,
} from '@/lib/theme';
import { useColors } from '@/lib/theme-context';
import { useSheetSlide } from '@/lib/entrance';
import { useUpdates } from '@/lib/updates';

/**
 * Comfortably taller than this card can get: a wrapped title, three notes and a
 * "+N more", a three-line body and two buttons come to a little over 420. Used
 * as the travel ONLY until the card has measured itself once.
 *
 * This number used to be the travel outright, and that was half of the motion
 * complaint. The design's `auxSheetIn` is `translateY(100%)` — the sheet's OWN
 * height, exactly — and a card 300px tall parked 480px down spends the first
 * third of its journey off-screen. On a decelerate curve that third is the FAST
 * part, so what reached the eye was the card appearing near its resting place
 * and then creeping the last few pixels. It read as a pop, which is precisely
 * what a 300ms slide exists to avoid.
 *
 * A CEILING rather than a guess, and the asymmetry is the point: too far only
 * costs the tail of an animation, where too near would start the slide with a
 * slab of card already on screen — which is a pop rather than a slide, and is
 * the worse of the two failures by a distance.
 */
const CARD_HEIGHT_CEILING = 480;

/**
 * How long the card stays in the tree after it is dismissed.
 *
 * `useSheetSlide` runs the exit in `Duration.press` and the entrance in
 * `Duration.sheet`; waiting the longer of the two means this stays correct if
 * that choice ever changes, and the only cost of the extra 140ms is a card
 * sitting mounted below the bottom edge where nobody can reach it.
 */
const PARK_AFTER = Duration.sheet;

/**
 * How long the FIRST open in a session spends off-screen getting its travel
 * right, before it is allowed to slide.
 *
 * This is not a measurement grace period, and the difference is the whole
 * reason the constant exists. `useSheetSlide` holds its distance in a shared
 * value seeded on its first call — with the ceiling above, because nothing has
 * been measured yet — and it never SNAPS: handed a new distance while hidden it
 * animates there, over `Duration.press`. So simply measuring is not enough.
 * The card has to mount, report its height, let the hook walk the parked
 * position in from the ceiling to that height, and only then be shown. Waiting
 * exactly `Duration.press` is waiting for that walk.
 *
 * The wait is deliberately NOT conditional on the measurement having arrived.
 * `onLayout` fires for any mounted view on all three targets, so it will
 * essentially always land first — but if a platform somehow never reports
 * layout, gating on it would leave the sheet parked below the screen forever,
 * which is an updater that has silently stopped working. Unconditional, the
 * worst case is the old behaviour: a slide that starts from the ceiling.
 *
 * Once latched it never resets, so this is paid once per app run and every
 * later open starts instantly from the card's exact height.
 */
const CALIBRATE_AFTER = Duration.press;

/**
 * How many fixes the SHEET lists, which is fewer than `MAX_NOTES`.
 *
 * `@/lib/release-notes` caps at five, and five is right for the Settings card:
 * that screen scrolls, and it is where someone goes deliberately to find out
 * what they turned down. This card does not scroll and is pinned to the bottom
 * edge, so anything it cannot fit is lost off the TOP — the title first. Five
 * notes plus a body and two buttons runs to roughly 480px, which on a short
 * phone is most of the screen and on the shortest is more than it.
 *
 * Nothing is concealed by cutting it to three: the head's kicker already gives
 * the total, the rolled-up count below the list gives the remainder, and
 * Settings still lists all five. A prompt that has to be scrolled to be
 * answered is not a prompt.
 */
const SHEET_NOTES = 3;

export function UpdatePrompt() {
  const C = useColors();
  /*
    The toast's slot, and for the toast's reason: this is the second piece of
    bottom chrome in the app, and `useDockReserve()` is the one definition of
    how much room the floating nav capsule needs. It already includes
    `insets.bottom`, so there is no inset arithmetic left here to get wrong.
  */
  const dockReserve = useDockReserve();

  const { promptVisible, pending, status, apply, dismissPrompt } = useUpdates();

  /**
   * The card's measured height, which is where the sheet's travel comes from.
   *
   * Null until the card has been laid out once. It survives every dismissal,
   * because this component is never unmounted — only its subtree is.
   */
  const [cardHeight, setCardHeight] = useState<number | null>(null);

  /**
   * True while the card is out of the tree entirely.
   *
   * Lowered by the card's own layout and raised again once a dismissal has had
   * time to animate out — see the two notes below.
   */
  const [parked, setParked] = useState(true);

  /**
   * True once the sheet's parked position has been reconciled with the card's
   * real height. A one-way latch — see `CALIBRATE_AFTER`.
   */
  const [calibrated, setCalibrated] = useState(false);

  /*
    `+ dockReserve`, because the card rests that far above the bottom edge. Its
    own height alone would leave the top of it still on screen at rest — the
    design's `translateY(100%)` gets away with that because its sheet sits over
    a scrim that hides the difference, and this one does not.
  */
  const travel = (cardHeight ?? CARD_HEIGHT_CEILING) + dockReserve;

  /**
   * TRANSLATE ONLY, and the opacity that used to ride alongside it is gone.
   *
   * The design's `auxSheetIn` (aux-nocturne.dc.html L25) is
   * `translateY(100%) -> none` and nothing else. This animated `opacity` at the
   * same time, so the card was see-through for the whole of its travel — and a
   * surface with no edge gives the eye nothing to follow, so what registered was
   * the brightness changing rather than the sheet moving. It read as a fade that
   * happened to drift upward, which is exactly what was reported.
   *
   * GATED ON `calibrated`, which is the only latency this component spends and
   * it spends it once. On the first open the card mounts, reports its height,
   * and the hook walks its parked position in from the ceiling to that height
   * before the sheet is allowed to move — so what the user watches is a slide
   * over exactly the card's own height, which is what `translateY(100%)` means.
   * It is off-screen for all of that, so there is nothing to see in the wait.
   */
  const animated = useSheetSlide(promptVisible && calibrated, travel);

  const onCardLayout = useCallback((event: LayoutChangeEvent) => {
    // Rounded up: a fractional height would leave a sub-pixel sliver of the
    // card's top edge showing at rest on a scaled display.
    const height = Math.ceil(event.nativeEvent.layout.height);
    if (height > 0) setCardHeight(height);

    /*
      AND the card is now live, which is what un-parks it. Done from here rather
      than from an effect for two reasons, one forced and one better.

      The forced one: `react-hooks/set-state-in-effect` rejects a synchronous
      setState in an effect body outright, which is the same cascading render
      the old `mounted` flag was removed for. This lint is not negotiable and
      the rule is right.

      The better one: laying out is the honest moment. The card is only
      dismissible — and therefore only owes an exit animation — once it has
      actually been measured and drawn, not once React has been told to render
      it. If layout somehow never reports, `parked` stays raised and dismissal
      degrades to the instant hide this file used to ship, rather than to a card
      stuck in the tree.
    */
    setParked(false);
  }, []);

  /**
   * THE PARK IS NOW DEFERRED, AND THAT IS THE OTHER HALF OF THE MOTION FIX.
   *
   * The card used to be permanently mounted and hidden with `display: none`,
   * which was load-bearing: parked, it still occupied its ~250px at the bottom
   * of the window and still hit-tested, and since `pointerEvents` in the style
   * prop does not reliably reach react-native-web, the dismissed card silently
   * swallowed every tap in the bottom quarter of the screen — the intro's "Get
   * started", and the whole navigation bar.
   *
   * But `display` flipped in the same commit the translate did. Going out that
   * meant the card did not slide away at all: it left the layout on the frame
   * the exit began, so the entire dismissal was invisible and the sheet simply
   * blinked out. Going in, the flip and the animation start raced for the same
   * frame. Either way the motion the design specifies was mostly not shown,
   * which is the "not smooth enough" that was reported.
   *
   * So the flag is kept and RAISED LATE: this timer only parks the card once
   * the exit has had time to finish, and until then the card stays mounted and
   * animates all the way down. Unmounting rather than `display: none`, because
   * a node that does not exist cannot hit-test on ANY platform — no styling
   * discrepancy between targets can undo it, which is more than the old flag
   * could claim. It also subsumes the `accessibilityElementsHidden` and
   * `importantForAccessibility` props that used to keep the parked card from
   * reading out as a live update offer.
   *
   * Nothing is written to state on the way IN, which is what keeps this to a
   * single effect with no cascading render: `parked` is lowered by the card's
   * own layout instead. See `onCardLayout`.
   *
   * WHAT THIS TRADES, stated plainly, because it is the same hazard the old
   * flag existed for: there are now two windows in which this layer is in the
   * tree while nothing on it is meant to be touched — the calibration wait and
   * the exit slide. Both are bounded by an animation and measured in a few
   * hundred milliseconds, where the bug being avoided was a layer that sat over
   * the bottom of every screen for the entire life of the app. The card is
   * never in the tree at all while there is no update to offer, which is the
   * state it spends essentially all of its time in.
   */
  useEffect(() => {
    if (promptVisible || parked) return;
    const timer = setTimeout(() => setParked(true), PARK_AFTER);
    return () => clearTimeout(timer);
  }, [promptVisible, parked]);

  // The one-time calibration wait. See `CALIBRATE_AFTER` for why it is a timer
  // rather than a condition on the measurement having arrived.
  useEffect(() => {
    if (!promptVisible || calibrated) return;
    const timer = setTimeout(() => setCalibrated(true), CALIBRATE_AFTER);
    return () => clearTimeout(timer);
  }, [promptVisible, calibrated]);

  if (!promptVisible && parked) return null;

  const applying = status === 'applying';
  const fixes = pending.notes.length + pending.hidden;

  // See `SHEET_NOTES`. `rolled` counts everything this card is not listing —
  // the notes it trimmed as well as the ones `release-notes` already dropped.
  const listed = pending.notes.slice(0, SHEET_NOTES);
  const rolled = pending.hidden + (pending.notes.length - listed.length);

  /*
    The same sentence the Settings card prints, so the two surfaces reporting
    this update agree about what is in it. It falls back to the plain
    announcement for a manifest that predates the changelog, where both counts
    are zero and "0 patches · 0 fixes" would read as a bug.
  */
  const meta =
    pending.patchCount > 0
      ? `${pending.patchCount} ${pending.patchCount === 1 ? 'patch' : 'patches'} · ${fixes} ${fixes === 1 ? 'fix' : 'fixes'}`
      : 'Update ready';

  return (
    <View style={[styles.layer, { paddingBottom: dockReserve }, PointerEvents.boxNone]}>
      <Animated.View
        onLayout={onCardLayout}
        style={[
          styles.card,
          animated,
          { backgroundColor: C.surfaceSolid, borderColor: C.chromeBorder },
          /*
            `surfaceSolid`, not `surface`. This card floats over whatever screen
            happens to be underneath it, and `surface` is 5.5% white — at that
            alpha the content behind would read straight through the update
            notes. Anything that overlays arbitrary content needs the opaque
            composite. The `chromeBorder` edge is the other half of the recipe:
            it is roughly twice as bright as `rule`, and that delta is the whole
            difference between a piece of chrome and a card lying on the page.
          */
          dropped(C, 'lg'),
          /*
            Secondary, and honestly so: the unmount above is what actually
            guarantees a dismissed card cannot take a tap. This narrows the
            window in which the card is still mounted and sliding away, on the
            platforms where the style is honoured.
          */
          promptVisible ? PointerEvents.auto : PointerEvents.none,
        ]}>
        {/*
          The live region is on the COPY rather than on the card, so it announces
          the offer once when it arrives instead of re-reading the whole sheet —
          buttons included — every time `applying` swaps a label. Polite, not
          assertive: an update that can wait should not interrupt.
        */}
        <View accessibilityLiveRegion="polite" style={styles.head}>
          <View style={styles.headText}>
            <Text accessibilityRole="header" style={[styles.title, { color: C.ink }]}>
              A new version of aux is ready
            </Text>
            {/* Ink3 and unaccented, agreeing with the banner's mark and the
                Settings dot — one event, one loudness, on all three surfaces
                that report it. Coral would claim this is happening right now,
                and blue would compete with the button below. */}
            <Text numberOfLines={1} style={[styles.kicker, { color: C.ink3 }]}>
              {meta}
            </Text>
          </View>

          {/*
            `chip` rather than the default `surface` tone, following the other
            sheet head in this app (`@/components/dm/attach-sheet`): the design
            draws its close circle as the 9%-white fill, and the kit has no tone
            pairing that fill with a hairline.
          */}
          <CircleIconButton
            icon={X}
            tone="chip"
            accessibilityLabel="Dismiss"
            disabled={applying}
            onPress={dismissPrompt}
          />
        </View>

        {/*
          What actually changed, across every patch this user skipped. Omitted
          entirely rather than shown empty when the incoming manifest predates
          the changelog — an empty heading is worse than no heading.

          No heading of its own now, and no rule above it: the kicker in the head
          already says how many patches this spans, so "IN THE LAST N PATCHES"
          was the same fact printed twice. Laid out exactly as the Settings card
          lays these strings out — same mark, same gap, same size — because it is
          the same list, three of it. See `SHEET_NOTES`.
        */}
        {listed.length > 0 ? (
          <View style={styles.notes}>
            {listed.map((note) => (
              <View key={note} style={styles.note}>
                {/* A rule, not a bullet glyph — separation is the rule here. */}
                <View style={[styles.noteMark, { backgroundColor: C.ink3 }]} />
                <Text style={[styles.noteText, { color: C.ink2 }]}>{note}</Text>
              </View>
            ))}

            {rolled > 0 ? (
              <View style={styles.note}>
                <View style={[styles.noteMark, { backgroundColor: C.ink3 }]} />
                <Text style={[styles.noteText, { color: C.ink3 }]}>
                  {`+${rolled} more ${rolled === 1 ? 'fix' : 'fixes'}`}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}

        <Text style={[styles.body, { color: C.ink2 }]}>
          It installs instantly. The app restarts, so finish what you are listening to first — you
          can always apply it later from Settings.
        </Text>

        <View style={styles.actions}>
          {/*
            Blue, and under the current rule that is now exactly right rather
            than merely defensible.

            The old direction had ONE accent covering live, playing, joinable, in
            sync and selected, so this button had to avoid it — applying an
            update is none of those things. There are two accents now, and the
            second one means precisely "this is the thing you do". A primary
            action is what blue is FOR.

            IT NO LONGER BUILDS THAT BLUE ITSELF, and that retires a shipped bug
            rather than merely tidying up. The hand-rolled version put a
            `LinearGradient` at `height: '100%'` inside a cell sized by `flex: 1`
            and a `minHeight` — neither of which is a DEFINITE height for a
            percentage to resolve against — and it drew as a torn blue rectangle
            over the bottom of the card. `AuxButton` owns its own box: the
            gradient inside it is an absolutely-positioned layer pinned to four
            edges, with no percentage anywhere in the chain.

            `loading` as well as the swapped label, so the restart reads as
            in-flight rather than as a button that has changed its mind.
          */}
          <AuxButton
            label={applying ? 'Restarting' : 'Update now'}
            variant="pri"
            size="lg"
            fullWidth
            loading={applying}
            onPress={() => void apply()}
          />
          {/*
            Stacked under it rather than beside it, matching `ConfirmDialog`: a
            row would set "Update now" and "Not now" at two widths decided by
            letter count, which is how a quiet action ends up looking quiet only
            by accident of how many letters it has.
          */}
          <AuxButton
            label="Not now"
            variant="ghost"
            fullWidth
            disabled={applying}
            onPress={dismissPrompt}
          />
        </View>
      </Animated.View>
    </View>
  );
}

/** The screen gutter (`@/components/ui/screen`), which the toast layer also pays. */
const GUTTER = Space.lg + 2;

/** The toast's width cap: past this a bottom card reads as a page, not a notice. */
const CARD_MAX_WIDTH = 480;

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    // No `top`: the layer is only as tall as the card inside it, so it can
    // never become the full-bleed overlay that eats every tap in the app.
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: GUTTER,
    alignItems: 'center',
    zIndex: ZIndex.toast,
    ...Platform.select({ android: { elevation: ZIndex.toast }, default: {} }),
  },
  card: {
    // A percentage WIDTH, which is safe where a percentage height would not be:
    // the layer is pinned left and right, so its width is definite.
    width: '100%',
    maxWidth: CARD_MAX_WIDTH,
    borderRadius: SheetMetrics.radius,
    borderWidth: Rule.hair,
    // The design's sheet gutter — L1163-1167 sets its head at `4px 20px 12px`.
    padding: Space.xl,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
  },
  headText: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    ...Type.display(18),
    // The artboard's own `font:800 18px;letter-spacing:-.015em`, a shade tighter
    // than what `display()` gives at this size.
    letterSpacing: tracking(18, -0.015),
  },
  /** Matches the kicker under every other sheet title in the app. */
  kicker: {
    ...Type.label(10),
    letterSpacing: tracking(10, 0.08),
    marginTop: 3,
  },
  notes: {
    marginTop: Space.lg,
    gap: Space.sm,
  },
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 11,
  },
  noteMark: {
    width: 9,
    height: 2,
    borderRadius: 1,
    // Sits on the text's first-line baseline rather than its box top.
    marginTop: 8,
  },
  noteText: {
    ...Type.body(13),
    flex: 1,
  },
  body: {
    ...Type.body(14),
    marginTop: Space.lg,
  },
  actions: {
    marginTop: Space.xl,
    gap: Space.sm,
  },
});
