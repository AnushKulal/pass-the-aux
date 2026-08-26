/**
 * The first screen: a four-page carousel, then the door.
 *
 * Built from design/nocturne/aux-nocturne.dc.html, screens "intro1" through
 * "intro4" (L41-106) — the wordmark page, the "no audio passes through Aux"
 * page, the sync-tolerance page and the provider page, over a fixed page
 * counter, a four-segment progress rail, a Next button that becomes
 * "Get started", and a quiet link beneath it.
 *
 * FOUR PAGES AGAIN, AND THE RECORD OF WHY IT WAS EVER ONE.
 *
 * This screen shipped as a SINGLE page, and its header made the case in full:
 * the design's carousel had been collapsed on purpose, after the feedback that
 * the app was "so descriptive in so many places", on the reasoning that four
 * pages of pitch in front of the sign-in door was the most descriptive thing in
 * it. That was a judgement call. It was made for a stated reason, and it was
 * made on someone else's behalf.
 *
 * They have now said the opposite in as many words — "the starting 4
 * description pages are not there, there is only one" — so the carousel is
 * back. The old paragraph is recorded here rather than quietly deleted, because
 * the reasoning behind it was not stupid; it simply was not the author's to
 * settle. Anyone tempted to collapse this to one page a second time should know
 * that it has already been tried, and reversed by the person it was tried for.
 *
 * Shown ONCE. A flag in AsyncStorage forwards a returning user straight to
 * sign-in, which is why four pages of explanation cost a person four swipes in
 * their life rather than four swipes per launch.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandRule, PrimaryCta, SecondaryLink } from '@/components/auth/onboarding';
import { Wordmark } from '@/components/shell/wordmark';
import { GlassCard, StatusPill } from '@/components/ui';
import { useEntrance } from '@/lib/entrance';
import { Duration, Fonts, Radii, Rule, Space, tracking, Type } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

const SEEN_KEY = 'aux:intro-seen';

/**
 * The screen gutter, and this screen used to say 30.
 *
 * Intro, Sign in, Claim handle and Profile setup are walked in sequence on a
 * first launch, and they were drawn at 30, 24, 22 and 18 — four content columns
 * in four taps, stepping inward at every one. 18 is the house value
 * (`src/components/ui/screen.tsx` and all eleven tab screens), so it is the one
 * the other three moved to.
 */
const GUTTER = 18;

/**
 * The content column, capped.
 *
 * The pager itself is full-bleed — a page has to be exactly as wide as the
 * viewport or the snap lands between two pages — but the words inside it must
 * not be. react-native-web has no phone to constrain it, and a headline
 * stretched across a desktop window is the same unreadable measure `Screen`
 * caps at 720. 420 rather than 720 because this is a phone layout with forced
 * line breaks in its titles: past roughly the artboard's own 402 the breaks
 * stop falling where they were drawn.
 */
const PAGE_MAX = 420;

/** The mark, at the design's Intro size. */
const LOGO = 62;
/** The brand rule under the kicker — 64 wide here, 52 on Sign in. */
const RULE_W = 64;

/**
 * The page headline, and the design says 33.
 *
 * 33 is measured against the artboard's 402pt frame at 22px of padding, which
 * leaves 358 for the line. This app's gutter is 18 on a device that can be 375
 * wide, so the same type gets 339 — and "fraction of a second." sets to roughly
 * 340 at 33px. It fit in the mock and overflowed on the narrow phones. 30 keeps
 * the design's proportions (1.1 leading, -0.03em) inside the column we have.
 */
const TITLE = 30;

/** The progress rail: the design's 4px bar at a 6px gap (L93-98). */
const RAIL_H = 4;
const RAIL_GAP = 6;

/**
 * The pages, as components rather than as data.
 *
 * Each one owns its own `useEntrance` calls, which is only possible if each one
 * IS a component — a render function called inline would put those hooks in the
 * parent, and they would break the moment a page is conditionally mounted,
 * which is exactly what happens below.
 */
const PAGES = [IntroOne, IntroTwo, IntroThree, IntroFour];
const LAST = PAGES.length - 1;

/** Keeps a scroll ratio inside the deck, including a rubber-band overshoot. */
const clampPage = (n: number) => Math.max(0, Math.min(LAST, n));

/** "01 / 04" — the design's tabular counter (L44). */
const pad = (n: number) => String(n).padStart(2, '0');

export default function IntroScreen() {
  const C = useColors();
  const { width: windowWidth } = useWindowDimensions();

  /**
   * Three states, not two. Rendering the intro while the stored flag is still
   * being read would flash it at every returning user for one frame.
   */
  const [status, setStatus] = useState<'checking' | 'show'>('checking');

  useEffect(() => {
    let cancelled = false;
    void AsyncStorage.getItem(SEEN_KEY)
      .then((seen) => {
        if (cancelled) return;
        if (seen) router.replace('/(auth)/sign-in');
        else setStatus('show');
      })
      .catch(() => {
        // A failed read is indistinguishable from a fresh install, and showing
        // the intro once more is a far better failure than locking someone out.
        if (!cancelled) setStatus('show');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Mark the intro seen and go somewhere, and WHERE now matters.
   *
   * Both buttons on this screen used to call one handler that went to sign-in,
   * which was harmless while sign-in also carried a Create account tab. It is a
   * bug now that creating an account is its own route: this screen only ever
   * renders on a FIRST LAUNCH, so "Get started" was sending brand-new users to
   * a form for an account they do not have, and the door out of that — the
   * secondary link — went to exactly the same place.
   */
  const leave = useCallback((to: '/(auth)/create-account' | '/(auth)/sign-in') => {
    void AsyncStorage.setItem(SEEN_KEY, '1').catch(() => undefined);
    router.replace(to);
  }, []);

  /* ----------------------------------------------------------------- pager */

  const pager = useRef<ScrollView>(null);

  /**
   * The page width, measured rather than assumed.
   *
   * Seeded from the window so the very first layout is right in the common
   * case, then corrected by `onLayout` — the SafeAreaView eats the left and
   * right insets in landscape on a notched device, and a pager whose page is
   * wider than its viewport snaps to offsets that drift further from the page
   * edge with every swipe.
   */
  const [pageWidth, setPageWidth] = useState(windowWidth);

  /** Which page is settled under the viewport. Drives the rail and the CTA. */
  const [active, setActive] = useState(0);

  /**
   * How far into the deck the reader has got, as a high-water mark.
   *
   * THIS IS WHAT MAKES THE ENTRANCE WORK, and it is why the extra state is
   * here. `useEntrance` replays on FOCUS, and a tab navigator is the case it
   * was written for; a pager is not. All four pages belong to one focused
   * screen, so mounting them all up front would run all four entrances at once,
   * three of them off-screen where nobody sees them — the copy would simply be
   * sitting there, already arrived, every time you swiped to it.
   *
   * So a page mounts the moment the reader starts moving toward it (see
   * `onScroll`, which reveals on `ceil`, not on `round`). Mounting is what
   * starts its entrance, so the content arrives while the page is still
   * travelling in and has landed by the time it stops. The mark never falls, so
   * swiping back does not re-trigger anything: an entrance that replayed on
   * every return would be a flicker, not an arrival.
   */
  const [reached, setReached] = useState(0);

  /**
   * `active` again, as a ref.
   *
   * `onScroll` fires at 16ms and React batches; the Next button needs the page
   * the scroller is actually on, not the page the last committed render knew
   * about. The state copy above exists for rendering, this one for handlers.
   */
  const activeRef = useRef(0);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const viewport = e.nativeEvent.layoutMeasurement.width;
    if (viewport <= 0) return;

    const ratio = e.nativeEvent.contentOffset.x / viewport;
    const settled = clampPage(Math.round(ratio));
    // `ceil`, so the page being travelled toward counts as reached the instant
    // the drag leaves the page being travelled from.
    const approaching = clampPage(Math.ceil(ratio));

    activeRef.current = settled;
    setActive((prev) => (prev === settled ? prev : settled));
    setReached((prev) => (approaching > prev ? approaching : prev));
  }, []);

  const onPagerLayout = useCallback((e: LayoutChangeEvent) => {
    const measured = e.nativeEvent.layout.width;
    setPageWidth((prev) => (measured <= 0 || prev === measured ? prev : measured));
  }, []);

  /**
   * Re-seat the scroller when the page width changes.
   *
   * A rotation leaves `contentOffset.x` where it was while every page around it
   * got wider, which parks the viewport across a seam. Reads the ref rather
   * than the state so this depends on the WIDTH alone — listing `active` here
   * would fire mid-swipe and fight the gesture.
   */
  useEffect(() => {
    pager.current?.scrollTo({ x: activeRef.current * pageWidth, animated: false });
  }, [pageWidth]);

  const advance = useCallback(() => {
    if (activeRef.current >= LAST) {
      leave('/(auth)/create-account');
      return;
    }
    const target = activeRef.current + 1;
    // Reveal BEFORE the travel starts, not when it ends: the whole point of the
    // high-water mark is that the page's content arrives during the journey.
    setReached((prev) => (target > prev ? target : prev));
    pager.current?.scrollTo({ x: target * pageWidth, animated: true });
  }, [leave, pageWidth]);

  // The splash is still up, so rendering nothing here is invisible.
  if (status === 'checking') return null;

  const last = active === LAST;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={styles.bar}>
        <Text
          accessibilityLiveRegion="polite"
          accessibilityLabel={`Page ${active + 1} of ${PAGES.length}`}
          style={[styles.counter, { color: C.ink3 }]}>
          {`${pad(active + 1)} / ${pad(PAGES.length)}`}
        </Text>
      </View>

      {/*
        A HORIZONTAL PAGER, and that is a choice rather than a transcription.

        There was no page transition in the file this replaces, because there
        were no pages — so nothing here was being fixed, it was being picked,
        against a note that the previous animation was not liked. A carousel is
        the one component where the honest answer is not an animation at all:
        the pages move with the thumb, at the speed of the thumb, and stop where
        the thumb stops. Cross-fading four pages in place would have been the
        "some easy fade" this codebase has already been asked twice to drop.

        `pagingEnabled` is the same primitive on all three targets —
        react-native-web implements it with CSS scroll snap — so the snap is the
        platform's, not a hand-rolled spring that needs tuning per device.
      */}
      <ScrollView
        ref={pager}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={onScroll}
        // A backstop, not a duplicate. Programmatic `scrollTo` does not emit a
        // scroll event on every platform, and without this a Next tap that went
        // unheard would leave the rail one page behind the content.
        onMomentumScrollEnd={onScroll}
        onLayout={onPagerLayout}
        style={styles.pager}>
        {PAGES.map((Page, i) => (
          <View key={i} style={{ width: pageWidth }}>
            {i <= reached ? <Page /> : null}
          </View>
        ))}
      </ScrollView>

      <View style={styles.bar}>
        <Rail active={active} />

        {/*
          BLUE, on every page including the last. Advancing a carousel and
          creating an account are both CONTROL — you make them happen — which is
          the half of the accent rule blue owns. Nothing on this screen is live,
          so nothing on it is coral except the sync readout on page three, which
          genuinely is a statement about being in sync.
        */}
        <PrimaryCta
          label={last ? 'Get started' : 'Next'}
          onPress={advance}
          accessibilityLabel={last ? 'Get started, create an account' : 'Next page'}
        />

        {/*
          The design puts "Skip for now" in this slot (L104) and this says
          something else, deliberately.

          Skip made sense while both controls on this screen led to the same
          door. They no longer do — "Get started" goes to create-account and
          this goes to sign-in, which was a bug fix two commits ago — and a link
          labelled "Skip for now" on a FIRST LAUNCH would hand a brand-new user
          the sign-in form for an account they have never made. That is the
          exact failure that fix removed, and relabelling this would put it
          straight back.

          Skipping the rest of the pitch is still available, and is now the
          gesture rather than a control: swipe, or tap Next. What is not
          available is skipping into the wrong form.
        */}
        <SecondaryLink label="I already have an account" onPress={() => leave('/(auth)/sign-in')} />
      </View>
    </SafeAreaView>
  );
}

/* --------------------------------------------------------------------- rail */

/**
 * Four segments, one lit (design L93-98).
 *
 * Decorative on purpose: the counter directly above already announces "Page 2
 * of 4" politely, and a second, wordless announcement of the same fact is noise
 * in a screen reader.
 */
function Rail({ active }: { active: number }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.rail}>
      {PAGES.map((_, i) => (
        <RailSegment key={i} lit={i === active} />
      ))}
    </View>
  );
}

/**
 * One segment, crossfading between the track and the accent.
 *
 * A blue overlay faded over the track, rather than an animated
 * `backgroundColor`: the colour is a palette lookup that changes with the
 * theme, and interpolating between two of those inside a worklet means both
 * ends have to stay parseable colour strings forever. Fading an opaque overlay
 * in and out is the same picture with nothing to get wrong.
 */
function RailSegment({ lit }: { lit: boolean }) {
  const C = useColors();
  const reduced = useReducedMotion();
  const on = useSharedValue(lit ? 1 : 0);

  useEffect(() => {
    const to = lit ? 1 : 0;
    // The design's own .18s on this bar; `Duration.press` is the nearest token
    // and is what every other 160-200ms state change in the app uses.
    on.value = reduced ? to : withTiming(to, { duration: Duration.press });
  }, [lit, reduced, on]);

  const fill = useAnimatedStyle(() => ({ opacity: on.value }));

  return (
    <View style={[styles.segment, { backgroundColor: C.track }]}>
      <Animated.View
        style={[StyleSheet.absoluteFill, styles.segmentFill, { backgroundColor: C.pill }, fill]}
      />
    </View>
  );
}

/* -------------------------------------------------------------------- pages */

/** intro1 (L47-53): the mark, the kicker, the rule, one paragraph. */
function IntroOne() {
  const C = useColors();
  const mark = useEntrance({ index: 0, kind: 'module' });
  const copy = useEntrance({ index: 1, kind: 'module' });

  return (
    <View style={[styles.page, styles.centred]}>
      {/*
        No tile behind the mark, deliberately.

        The previous version set it on a 172px `artwork` plate, which worked
        when `artwork` was a near-white tile. In this direction that token is a
        dark WELL and `artInk` is 22% white, so the same code renders a barely
        visible mark on a barely visible square. The design's answer is not a
        brighter plate: it is no plate, with the gradient carrying the mark.
      */}
      <Animated.View style={mark}>
        <Wordmark size={LOGO} />
      </Animated.View>

      <Animated.View style={[styles.copy, copy]}>
        <Text style={[styles.kicker, { color: C.ink3 }]}>PASS THE AUX</Text>

        {/*
          Was an inline `LinearGradient` here and a second, near-identical one
          on Sign in, each declaring itself the only element in the app that
          paints both accents. Neither was — see `BrandRule`, which now owns
          the gradient, the height and the reasoning for all of it.
        */}
        <BrandRule width={RULE_W} style={styles.rule} />

        <Text style={[styles.lede, { color: C.ink2 }]}>
          You join a <Text style={{ color: C.ink, fontFamily: Fonts.semibold }}>Lounge</Text>, see
          who is listening to what right now, and tap in to hear the same chorus at the same moment.
        </Text>
      </Animated.View>
    </View>
  );
}

/** intro2 (L58-71): what the server actually sends. */
function IntroTwo() {
  const C = useColors();
  const badge = useEntrance({ index: 0 });
  const title = useEntrance({ index: 1 });
  const card = useEntrance({ index: 2 });
  const tail = useEntrance({ index: 3 });

  return (
    <View style={[styles.page, styles.stack]}>
      <Animated.View style={badge}>
        <StatusPill label="Not a streaming service" tone="outline" />
      </Animated.View>

      <Animated.View style={title}>
        <Text accessibilityRole="header" style={[styles.title, { color: C.ink }]}>
          {'No audio passes\nthrough Aux.'}
        </Text>
      </Animated.View>

      <Animated.View style={card}>
        <GlassCard>
          <Text style={[styles.cardKicker, { color: C.ink3 }]}>The server only ever says</Text>
          {/*
            The one coral sentence on this screen, and it earns the accent:
            coral means live, playing, in sync — and this line IS the sync
            message, quoted. Everything else here is a claim about the product,
            which is what the neutral badges are for.
          */}
          <Text style={[styles.quote, { color: C.liveText }]}>
            this track, starting at this instant
          </Text>
        </GlassCard>
      </Animated.View>

      <Animated.View style={tail}>
        <Text style={[styles.body, { color: C.ink2 }]}>
          Everyone plays the song on their own device, from their own account. That one decision is
          why Aux runs on free tiers.
        </Text>
      </Animated.View>
    </View>
  );
}

/** intro3 (L74-87): the correction ladder. */
function IntroThree() {
  const C = useColors();
  const badge = useEntrance({ index: 0 });
  const title = useEntrance({ index: 1 });
  const card = useEntrance({ index: 2 });
  const tail = useEntrance({ index: 3 });

  return (
    <View style={[styles.page, styles.stack]}>
      <Animated.View style={badge}>
        {/*
          NEUTRAL, where the design draws this one blue (L76).

          Blue in this app means "you make this happen" and is spent on exactly
          one object per screen — here, the Next button a few inches below. A
          blue badge that cannot be tapped, sitting above the blue button that
          can, teaches the wrong thing about the colour. The other two page
          badges are neutral for the same reason: a page kicker is a label, not
          a state of the world, so it takes neither accent.
        */}
        <StatusPill label="The hard part" tone="outline" />
      </Animated.View>

      <Animated.View style={title}>
        <Text accessibilityRole="header" style={[styles.title, { color: C.ink }]}>
          {'Synced to the\nfraction of a second.'}
        </Text>
      </Animated.View>

      <Animated.View style={card}>
        <GlassCard padded={false} style={styles.ladder}>
          <Tolerance bar={C.live} glow value="±40ms" tone={C.liveText} note="Leave it alone" />
          <Tolerance bar={C.ink2} value="±220ms" tone={C.ink} note="Nudge the rate 2%" />
          <Tolerance bar={C.surface3} value="Beyond" tone={C.ink2} note="Hard seek" last />
        </GlassCard>
      </Animated.View>

      <Animated.View style={tail}>
        <Text style={[styles.body, { color: C.ink2 }]}>
          Device clocks are routinely seconds wrong, so Aux measures its own error against the
          server and corrects for it.
        </Text>
      </Animated.View>
    </View>
  );
}

/**
 * One rung of the correction ladder.
 *
 * The leading bar is the only coral glow on this screen, and only on the top
 * row: ±40ms is the band where playback is IN SYNC, which is the state accent
 * spent on the thing it was reserved for. The rows below describe corrections,
 * not a state, so they run neutral and step down in brightness.
 */
function Tolerance({
  bar,
  glow = false,
  value,
  tone,
  note,
  last = false,
}: {
  bar: string;
  glow?: boolean;
  value: string;
  /** The readout's ink. The row's own prose is always `ink2`. */
  tone: string;
  note: string;
  last?: boolean;
}) {
  const C = useColors();

  return (
    <View
      accessible
      accessibilityLabel={`${value}, ${note}`}
      style={[
        styles.rung,
        last ? null : { borderBottomWidth: Rule.hair, borderBottomColor: C.ruleSoft },
      ]}>
      <View
        style={[
          styles.rungBar,
          { backgroundColor: bar },
          // Array form: this lands on a View, and `ViewStyle` types `boxShadow`
          // as the array while `TextStyle` types it as a string.
          glow
            ? { boxShadow: [{ offsetX: 0, offsetY: 0, blurRadius: 14, color: C.liveMid }] }
            : null,
        ]}
      />
      <Text style={[styles.rungValue, { color: tone }]}>{value}</Text>
      <Text style={[styles.rungNote, { color: C.ink2 }]}>{note}</Text>
    </View>
  );
}

/** intro4 (L90-104): one catalogue, two providers. */
function IntroFour() {
  const C = useColors();
  const badge = useEntrance({ index: 0 });
  const title = useEntrance({ index: 1 });
  const cards = useEntrance({ index: 2 });
  const tail = useEntrance({ index: 3 });

  return (
    <View style={[styles.page, styles.stack]}>
      <Animated.View style={badge}>
        <StatusPill label="Bring what you have" tone="outline" />
      </Animated.View>

      <Animated.View style={title}>
        <Text accessibilityRole="header" style={[styles.title, { color: C.ink }]}>
          {'Spotify or YouTube.\nSame chorus.'}
        </Text>
      </Animated.View>

      {/*
        BOTH CARDS NEUTRAL, where the design washes the YouTube one in coral
        (L94).

        That wash inverts the convention the built app already keeps: coral is
        PREMIUM and live, neutral is a provider — `(tabs)/profile.tsx` L470-472
        draws exactly this pair as two `outline` pills with a coral `Premium`
        beside them. Painting the FREE tier coral here and the Premium one grey
        would teach the opposite of every other screen, on the screen that goes
        first. The distinction the design was drawing is in the copy, which is
        where it belongs: one card says Premium, the other says no account
        needed.
      */}
      <Animated.View style={[styles.providers, cards]}>
        <GlassCard style={styles.provider}>
          <Text style={[styles.providerName, { color: C.ink }]}>Spotify</Text>
          <Text style={[styles.providerNote, { color: C.ink3 }]}>Premium plays through Spotify</Text>
        </GlassCard>
        <GlassCard style={styles.provider}>
          <Text style={[styles.providerName, { color: C.ink }]}>YouTube</Text>
          <Text style={[styles.providerNote, { color: C.ink3 }]}>
            Everyone else, no account needed
          </Text>
        </GlassCard>
      </Animated.View>

      <Animated.View style={tail}>
        <Text style={[styles.body, { color: C.ink2 }]}>
          One catalogue, per-provider links. A Premium listener and a free listener are playing the
          same recording, not two uploads that share a title.
        </Text>
      </Animated.View>
    </View>
  );
}

/* ------------------------------------------------------------------- styles */

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingBottom: Space.xl,
  },

  /**
   * The counter above the pager and the controls below it, on the same column
   * as the pages. The pager itself takes no gutter — see `PAGE_MAX`.
   */
  bar: {
    width: '100%',
    maxWidth: PAGE_MAX,
    alignSelf: 'center',
    paddingHorizontal: GUTTER,
  },
  counter: {
    fontFamily: Fonts.extrabold,
    fontSize: 10,
    letterSpacing: tracking(10, 0.14),
    // Tabular, so "01 / 04" does not shuffle sideways as the page changes.
    fontVariant: ['tabular-nums'],
    paddingTop: Space.md,
  },

  pager: {
    flex: 1,
  },
  /**
   * `flex: 1` fills the pager's height — a horizontal ScrollView bounds its
   * children vertically, so the page stretches and its content can centre
   * against the real viewport rather than against its own height.
   */
  page: {
    flex: 1,
    width: '100%',
    maxWidth: PAGE_MAX,
    alignSelf: 'center',
    paddingHorizontal: GUTTER,
  },
  centred: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  /**
   * The design's three text pages: a column whose blocks sit 14-16px apart. One
   * gap rather than four margins — the 2px the artboard varies by is not
   * visible, and a gap cannot be forgotten on a block added later.
   */
  stack: {
    justifyContent: 'center',
    gap: Space.lg,
  },

  rail: {
    flexDirection: 'row',
    gap: RAIL_GAP,
    marginBottom: 18,
  },
  segment: {
    flex: 1,
    height: RAIL_H,
    borderRadius: Radii.pill,
    overflow: 'hidden',
  },
  segmentFill: {
    borderRadius: Radii.pill,
  },

  /* ---- intro1 */

  copy: {
    alignItems: 'center',
  },
  kicker: {
    fontFamily: Fonts.extrabold,
    fontSize: 9,
    letterSpacing: tracking(9, 0.26),
    marginTop: 22,
    // The design's own 0.85 on an already-quiet ink. It is the least important
    // thing on the screen and is set to say so.
    opacity: 0.85,
  },
  /** Spacing only — `BrandRule` carries the width, height and radius. */
  rule: {
    marginTop: 16,
  },
  lede: {
    ...Type.body(16),
    lineHeight: 26,
    marginTop: 20,
    textAlign: 'center',
    // 290 in the design. Caps the measure at roughly 45 characters so the
    // paragraph breaks into four even lines instead of one long ragged block.
    maxWidth: 290,
  },

  /* ---- intro2 to intro4 */

  title: {
    fontFamily: Fonts.extrabold,
    fontSize: TITLE,
    lineHeight: Math.round(TITLE * 1.1),
    letterSpacing: tracking(TITLE, -0.03),
  },
  body: {
    ...Type.body(15),
    lineHeight: 24,
  },
  cardKicker: {
    fontFamily: Fonts.extrabold,
    fontSize: 10,
    letterSpacing: tracking(10, 0.12),
    textTransform: 'uppercase',
  },
  quote: {
    fontFamily: Fonts.extrabold,
    fontSize: 17,
    lineHeight: 23,
    letterSpacing: tracking(17, -0.01),
    marginTop: 7,
  },

  /**
   * `padded={false}` on the card, because the rungs carry their own vertical
   * padding and a hairline that has to run the full width of the card's inside
   * edge. The design's own `6px 14px`, rounded to the two nearest tokens.
   */
  ladder: {
    paddingHorizontal: Space.lg,
    paddingVertical: Space.xs,
  },
  rung: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingVertical: Space.md,
  },
  rungBar: {
    width: 4,
    height: 30,
    borderRadius: Radii.pill,
    flexShrink: 0,
  },
  rungValue: {
    // The measuring voice, and this is exactly what it is for: three readouts
    // in a column whose digits have to line up.
    fontFamily: Fonts.extrabold,
    fontSize: 13,
    fontVariant: ['tabular-nums'],
    width: 74,
    flexShrink: 0,
  },
  rungNote: {
    ...Type.body(14),
    flex: 1,
  },

  providers: {
    flexDirection: 'row',
    gap: Space.md,
  },
  provider: {
    flex: 1,
  },
  providerName: {
    fontFamily: Fonts.extrabold,
    fontSize: 13,
    letterSpacing: tracking(13, 0.02),
  },
  providerNote: {
    ...Type.body(12),
    lineHeight: 17,
    marginTop: 5,
  },
});
