import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Stop, Text as SvgText } from 'react-native-svg';

import { useEnterStyle } from '@/components/auth/onboarding';
import { Wordmark } from '@/components/shell/wordmark';
import { AuxButton } from '@/components/ui';
import { Fonts, PointerEvents, Space, Type, tracking } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

/**
 * The dead end.
 *
 * Reached by a bad deep link — a shared Session URL for a Session that ended, or
 * a Lounge invite for a Lounge the opener was never in.
 *
 * Built from design/nocturne/aux-nocturne.dc.html L662-671: a ghost wordmark
 * bleeding off the right edge, the gradient numeral, "Dead cable.", one line of
 * `ink2` prose, and a single gradient pill back to the Feed. No card — this is
 * the same empty-state grammar as `EmptyState` (headline → body → one hugging
 * CTA) with the card taken away, because a 404 is the whole screen rather than
 * a hole in one.
 *
 * WHAT WENT: the 2px coral rule under the numeral. It was this screen's accent
 * statement while the numeral itself was flat coral; the numeral now carries a
 * coral-to-blue ramp, and a coral bar under it would be a second accent
 * competing with the first for the same job.
 */
export default function NotFoundScreen() {
  const C = useColors();

  /*
    The shared entrance helper, driven by a shared value from an effect. NOT
    `entering={FadeInDown…}`: Reanimated marks an entering view
    `visibility: hidden` until its animation runs, and on react-native-web it
    never runs — which would leave the whole 404 blank on the one route whose
    entire job is explaining a dead end. This screen used to carry a hand-rolled
    copy of that helper; it uses the shared one now so it cannot drift from it.
  */
  const enterStyle = useEnterStyle();

  return (
    <SafeAreaView
      edges={['top', 'bottom', 'left', 'right']}
      style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={styles.center}>
        <Animated.View style={[styles.block, enterStyle]}>
          {/*
            The watermark. Absolutely positioned so it takes no layout space and
            the copy below it stays put, and anchored to the BLOCK rather than to
            the screen: the artboard's `top:132px` is measured inside a fixed
            874px frame, so as a constant it would drop the mark onto the numeral
            on a short device and strand it under the status bar on a tall one.
            Anchoring to the block holds the 30px of air the design draws.

            `right: -34` is the artboard's own bleed. Absolute insets are
            measured from the padding box, so this runs 34px past the gutter and
            the dot falls off the edge of the screen — which is the intent, and
            the reason the mark reads as a watermark rather than as a second
            logo someone forgot to remove.
          */}
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[styles.ghost, PointerEvents.none]}>
            <Wordmark size={GHOST} />
          </View>

          <Numeral />

          <Text accessibilityRole="header" style={[styles.title, { color: C.ink }]}>
            Dead cable.
          </Text>
          <Text style={[styles.body, { color: C.ink2 }]}>
            This Session ended, or you were never in the Lounge that held it.
          </Text>

          {/*
            `replace`, not `back`: the history entry that got us here is itself
            the broken one, so going back would land on it again.

            Blue, and only blue. Going home is an ACTION — the coral in the
            numeral above describes a state of the world, it does not offer one.
            `md` is the artboard's 50px pill (L670), and `AuxButton` already hugs
            its label, which is the design's `inline-flex`.
          */}
          <View style={styles.action}>
            <AuxButton
              label="Back to the Feed"
              onPress={() => router.replace('/')}
              variant="pri"
              size="md"
            />
          </View>
        </Animated.View>
      </View>
    </SafeAreaView>
  );
}

/* -------------------------------------------------------------- the numeral */

/** Design L665: `76px/.9`, `-.055em`, `linear-gradient(120deg, live, pri)`. */
const NUMERAL = 76;

/**
 * The SVG viewport CLIPS, so this ratio is deliberately generous rather than
 * exact: the ink of "404" in Archivo 800 at -0.055em measures a little over
 * 1.7em, and the numeral is alone on its line, so the slack costs nothing while
 * being a hair short would shave the last digit.
 */
const NUMERAL_WIDTH = 1.8;
/**
 * Archivo's figures sit on the cap line (~0.73em tall), and `alignmentBaseline`
 * is not dependable across the three platforms this ships to — so the baseline
 * is placed by hand, exactly as it is in `Wordmark`. These two ratios leave
 * roughly equal air above and below inside a box that matches the design's
 * tight `line-height:.9`.
 */
const NUMERAL_BASELINE = 0.8;
const NUMERAL_BOX = 0.86;

/**
 * CSS measures gradient angles clockwise from straight up; SVG wants two
 * points. 120deg is (sin120, -cos120) = (0.866, 0.5) — left to right, leaning
 * thirty degrees down.
 */
const NUMERAL_ANGLE = { x1: '0', y1: '0', x2: '0.866', y2: '0.5' } as const;

/** Only one 404 is ever mounted, so a fixed id cannot collide with itself. */
const NUMERAL_INK = 'nf404Ink';

/**
 * A TWO-ACCENT RAMP, WHICH IS DECORATION AND NOT AN EXCEPTION. The design's own
 * call (L665).
 *
 * This comment used to open "THE ONE ELEMENT IN THIS APP PAINTED IN BOTH
 * ACCENTS". It was not, and neither were the other elements claiming it: Intro
 * and Sign in each drew a coral-to-blue brand rule under the wordmark carrying
 * the identical sentence, and `Wordmark` itself runs a peach-coral-blue ramp
 * directly above them. Four objects, three assertions of uniqueness, true none
 * of them — and a uniqueness claim is not a harmless flourish, because read on
 * its own it grants a licence to whoever needs coral and blue on one control
 * next. The two rules are now one component, `BrandRule` in
 * '@/components/auth/onboarding', whose header carries the ruling for all of
 * them; this numeral is the same call and no longer restates it.
 *
 * The reasoning the claim was wrapped around is the actual rule and it stands.
 * Coral is state, blue is action, never both on one element — and that governs
 * CONTROLS and BADGES: it is what stops a Join button from claiming to be live.
 * A numeral is neither. It sits in the typographic-artwork register with the
 * wordmark, and the ramp is precisely what says "this is a dead end" rather
 * than "this is a thing you can press". The one CONTROL on this screen is flat
 * blue, as it must be. Do not add a third accent here; there is nothing left
 * for one to mean.
 *
 * Drawn with react-native-svg because React Native cannot fill text with a
 * gradient at all, and the usual escape hatch (@react-native-masked-view) is
 * not in this project's dependency set. `Wordmark` solves the identical problem
 * the identical way, so the app's two gradient-filled strings share one
 * technique instead of inventing a second.
 *
 * In light mode `live` and `pill` resolve to the SAME blue — the palette's
 * documented accent collapse — so this degrades to a flat blue numeral rather
 * than breaking. That is the design's light theme, not a fault here.
 */
function Numeral() {
  const C = useColors();

  return (
    <View accessibilityRole="image" accessibilityLabel="404">
      <Svg width={Math.ceil(NUMERAL * NUMERAL_WIDTH)} height={Math.ceil(NUMERAL * NUMERAL_BOX)}>
        <Defs>
          <LinearGradient
            id={NUMERAL_INK}
            x1={NUMERAL_ANGLE.x1}
            y1={NUMERAL_ANGLE.y1}
            x2={NUMERAL_ANGLE.x2}
            y2={NUMERAL_ANGLE.y2}>
            <Stop offset={0} stopColor={C.live} />
            <Stop offset={1} stopColor={C.pill} />
          </LinearGradient>
        </Defs>
        <SvgText
          x={0}
          y={NUMERAL * NUMERAL_BASELINE}
          fontFamily={Fonts.extrabold}
          fontSize={NUMERAL}
          fontWeight="800"
          letterSpacing={tracking(NUMERAL, -0.055)}
          fill={`url(#${NUMERAL_INK})`}>
          404
        </SvgText>
      </Svg>
    </View>
  );
}

/* ---------------------------------------------------------------- the ghost */

/** Design L664: the 60px mark at 16%, sitting above and right of the numeral. */
const GHOST = 60;
/**
 * `Wordmark` sizes its box at 1.1x the cap size, so a 60px mark is 66px tall.
 * -96 puts its foot 30px clear of the numeral — the artboard's own gap, held as
 * an offset from the block instead of as an absolute frame coordinate.
 */
const GHOST_TOP = -96;
const GHOST_RIGHT = -34;
const GHOST_OPACITY = 0.16;

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  /**
   * The artboard reserves 130px at the foot of this screen, which is the nav
   * capsule's clearance — and `+not-found` lives OUTSIDE `(tabs)`, so there is
   * no capsule here to clear. A fraction of that reservation is kept purely for
   * the optical lift it was doing: a block centred on true centre reads low.
   */
  center: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Space.xl,
    paddingTop: Space.xxl,
    paddingBottom: Space.huge,
  },
  /**
   * react-native-web has no phone to constrain it, and this screen is one
   * left-aligned column — without a cap the body line runs the full width of a
   * desktop window and the ghost drifts far away from the numeral it belongs to.
   */
  block: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    alignItems: 'flex-start',
    // The ghost is positioned against this, so it has to be the containing
    // block rather than letting the inset fall through to the screen.
    position: 'relative',
  },
  ghost: {
    position: 'absolute',
    top: GHOST_TOP,
    right: GHOST_RIGHT,
    opacity: GHOST_OPACITY,
  },
  title: {
    ...Type.display(22),
    letterSpacing: tracking(22, -0.02),
    marginTop: Space.lg,
  },
  body: {
    ...Type.body(15),
    // The design's 1.55, a step looser than `Type.body`'s own 1.5 — one sentence
    // wrapping to two lines wants the extra air between them.
    lineHeight: Math.round(15 * 1.55),
    marginTop: Space.sm,
    maxWidth: 344,
  },
  /** The gap belongs to the layout — `AuxButton` deliberately carries no margins. */
  action: {
    marginTop: Space.xl,
  },
});
