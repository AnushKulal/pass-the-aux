/**
 * The four intro pages, pre-auth.
 *
 * They exist to say the one thing that makes Aux make sense before anyone is
 * asked for an email: no audio passes through the backend, so the hard problem
 * is time, not bandwidth. Shown once — the "seen" flag is persisted and the
 * screen forwards straight to sign-in on every later launch.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'expo-image';
import { Redirect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type TextStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Duration, PointerEvents, Rule, Space, Type, type Palette } from '@/lib/theme';
import { useTheme } from '@/lib/theme-context';

const SEEN_KEY = 'aux:intro-seen';
const PAGE_COUNT = 4;

/** The spec's `cubic-bezier(.2,.8,.2,1)`. */
const EASE = Easing.bezier(0.2, 0.8, 0.2, 1);

const AUX_LOGO = require('../../../assets/images/aux-logo.png') as number;

/**
 * `Type.readout()` freezes its `fontVariant` as a readonly tuple, which RN's
 * `TextStyle.fontVariant` (a mutable `FontVariant[]`) will not take. Re-stating
 * it under a `TextStyle` annotation is the whole fix.
 */
const TABULAR = { fontVariant: ['tabular-nums'] as NonNullable<TextStyle['fontVariant']> };
const readout = (size: number): TextStyle => ({ ...Type.readout(size), ...TABULAR });

/* ------------------------------------------------------------------ motion */

/**
 * The module transition: `translateY(8px) → 0` plus a fade over 280ms, re-run
 * every time the page changes. Under reduced motion the page simply appears.
 */
function usePageEnter(step: number, reduced: boolean) {
  const progress = useSharedValue(1);

  useEffect(() => {
    if (reduced) {
      progress.value = 1;
      return;
    }
    progress.value = 0;
    progress.value = withTiming(1, { duration: Duration.enter, easing: EASE });
  }, [step, reduced, progress]);

  return useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 8 }],
  }));
}

/* ------------------------------------------------------------------- parts */

function Kicker({ text, color }: { text: string; color: string }) {
  return <Text style={[styles.kicker, { color }]}>{text}</Text>;
}

function Pitch({ children, color }: { children: ReactNode; color: string }) {
  return <Text style={[styles.pitch, { color }]}>{children}</Text>;
}

/* ------------------------------------------------------------------- pages */

function PageOne({ C, dark }: { C: Palette; dark: boolean }) {
  return (
    <View style={styles.page}>
      {/*
        The mark has a black background baked into the file, so it can only be
        composited onto a near-black ground. On light it is simply absent —
        that is the asset's limitation, called out in the handoff.
      */}
      {dark ? (
        <View style={[styles.bleedPlate, PointerEvents.none]}>
          <Image
            source={AUX_LOGO}
            style={styles.bleedLogo}
            contentFit="contain"
            cachePolicy="memory-disk"
          />
        </View>
      ) : null}
      <Text style={[styles.titleOne, { color: C.ink }]}>{'Pass\nthe aux.'}</Text>
      {/* Bleeds off the right edge: the rule is longer than the column. */}
      <View style={[styles.bleedRule, { backgroundColor: C.live }]} />
      <Pitch color={C.ink2}>
        You join a <Text style={{ color: C.ink }}>Lounge</Text>. You see who is listening to what,
        right now. You tap in and hear the same chorus at the same moment.
      </Pitch>
    </View>
  );
}

function PageTwo({ C }: { C: Palette }) {
  return (
    <View style={styles.page}>
      <Kicker text="NOT A STREAMING SERVICE" color={C.liveText} />
      <Text style={[styles.title, { color: C.ink }]}>{'No audio\npasses\nthrough Aux.'}</Text>
      <View style={[styles.quoteBlock, { borderColor: C.rule2 }]}>
        <Text style={[styles.quoteLabel, { color: C.ink3 }]}>THE SERVER ONLY EVER SAYS</Text>
        <Text style={[styles.quote, { color: C.liveText }]}>
          this track, starting at this instant
        </Text>
      </View>
      <Pitch color={C.ink2}>
        Everyone plays the song on their own device, from their own account. That one decision is
        why Aux runs on free tiers.
      </Pitch>
    </View>
  );
}

/**
 * The 45° hatch on the middle rung.
 *
 * There is no repeating-gradient primitive in React Native, so the stripes are
 * six rotated bars behind a clip. Cheap, static, and it survives any theme
 * because the stripe takes `ink`.
 */
function HatchBar({ color }: { color: string }) {
  return (
    <View style={styles.rungBar}>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <View
          key={i}
          style={[styles.hatch, { backgroundColor: color, left: -14 + i * 8.5 }]}
        />
      ))}
    </View>
  );
}

function Rung({
  bar,
  reading,
  readingColor,
  action,
  C,
}: {
  bar: ReactNode;
  reading: string;
  readingColor: string;
  action: string;
  C: Palette;
}) {
  return (
    <View style={[styles.rung, { borderBottomColor: C.rule }]}>
      {bar}
      <Text style={[styles.rungReading, { color: readingColor }]}>{reading}</Text>
      <Text style={[styles.rungAction, { color: C.ink2 }]}>{action}</Text>
    </View>
  );
}

function PageThree({ C }: { C: Palette }) {
  return (
    <View style={styles.page}>
      <Kicker text="THE HARD PART" color={C.liveText} />
      <Text style={[styles.title, { color: C.ink }]}>
        {'Synced to the\nfraction of\na second.'}
      </Text>
      <View style={[styles.ladder, { borderTopColor: C.rule }]}>
        <Rung
          C={C}
          bar={<View style={[styles.rungBar, { backgroundColor: C.live }]} />}
          reading="±40ms"
          readingColor={C.liveText}
          action="Leave it alone"
        />
        <Rung
          C={C}
          bar={<HatchBar color={C.ink} />}
          reading="±220ms"
          readingColor={C.ink}
          action="Nudge the rate 2%"
        />
        <Rung
          C={C}
          bar={<View style={[styles.rungBar, styles.rungOutline, { borderColor: C.ink2 }]} />}
          reading="BEYOND"
          readingColor={C.ink2}
          action="Hard seek"
        />
      </View>
      <Pitch color={C.ink2}>
        Device clocks are routinely seconds wrong, so Aux measures its own error against the server
        and corrects for it.
      </Pitch>
    </View>
  );
}

function PageFour({ C }: { C: Palette }) {
  return (
    <View style={styles.page}>
      <Kicker text="BRING WHAT YOU HAVE" color={C.liveText} />
      <Text style={[styles.title, { color: C.ink }]}>
        {'Spotify or\nYouTube.\nSame chorus.'}
      </Text>
      <View style={styles.providerRow}>
        <View style={[styles.providerCard, { borderColor: C.rule2 }]}>
          <Text style={[styles.providerName, { color: C.ink }]}>SPOTIFY</Text>
          <Text style={[styles.providerNote, { color: C.ink3 }]}>
            Premium plays through Spotify
          </Text>
        </View>
        {/* The accent border is the point: YouTube is the default path. */}
        <View style={[styles.providerCard, { borderColor: C.live }]}>
          <Text style={[styles.providerName, { color: C.liveText }]}>YOUTUBE</Text>
          <Text style={[styles.providerNote, { color: C.ink3 }]}>
            Everyone else, no account needed
          </Text>
        </View>
      </View>
      <Pitch color={C.ink2}>
        One catalogue, per-provider links. A Premium listener and a free listener are playing the
        same recording, not two uploads that share a title.
      </Pitch>
    </View>
  );
}

/* ------------------------------------------------------------------ screen */

export default function IntroScreen() {
  const { colors: C, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const reduced = useReducedMotion();

  const [step, setStep] = useState(0);
  /** 'checking' holds a blank frame rather than flashing page one at a returning user. */
  const [status, setStatus] = useState<'checking' | 'show' | 'seen'>('checking');

  useEffect(() => {
    let cancelled = false;
    void AsyncStorage.getItem(SEEN_KEY)
      .then((value) => {
        if (!cancelled) setStatus(value === '1' ? 'seen' : 'show');
      })
      .catch(() => {
        if (!cancelled) setStatus('show');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const pageStyle = usePageEnter(step, reduced);

  /**
   * Persisting is fire-and-forget on purpose: the worst case of a lost write is
   * seeing the intro twice, and making the user wait on disk to leave a
   * marketing screen is worse than that.
   */
  const finish = useCallback(() => {
    void AsyncStorage.setItem(SEEN_KEY, '1').catch(() => undefined);
    router.replace('/(auth)/sign-in');
  }, [router]);

  const next = useCallback(() => {
    // Never navigate from inside a state updater — React may run it twice.
    if (step < PAGE_COUNT - 1) setStep(step + 1);
    else finish();
  }, [step, finish]);

  if (status === 'checking') return null;
  if (status === 'seen') return <Redirect href="/(auth)/sign-in" />;

  const last = step === PAGE_COUNT - 1;

  return (
    <View
      style={[
        styles.screen,
        {
          backgroundColor: C.bg,
          paddingTop: insets.top + Space.sm,
          paddingBottom: insets.bottom + Space.md,
        },
      ]}>
      <View style={styles.header}>
        <Text style={[styles.counter, { color: C.ink3 }]}>
          {`0${step + 1} / 0${PAGE_COUNT}`}
        </Text>
        <Pressable
          onPress={finish}
          accessibilityRole="button"
          accessibilityLabel="Skip the introduction"
          style={styles.skip}>
          {({ pressed }) => (
            <Text style={[styles.skipLabel, { color: pressed ? C.liveText : C.ink2 }]}>SKIP</Text>
          )}
        </Pressable>
      </View>

      <Animated.View style={[styles.pageHost, pageStyle]}>
        {step === 0 ? <PageOne C={C} dark={scheme === 'dark'} /> : null}
        {step === 1 ? <PageTwo C={C} /> : null}
        {step === 2 ? <PageThree C={C} /> : null}
        {step === 3 ? <PageFour C={C} /> : null}
      </Animated.View>

      <View style={styles.progress}>
        {[0, 1, 2, 3].map((i) => (
          <View
            key={i}
            style={[styles.progressBar, { backgroundColor: i === step ? C.live : C.rule2 }]}
          />
        ))}
      </View>

      <Pressable
        onPress={next}
        accessibilityRole="button"
        accessibilityLabel={last ? 'Get started' : 'Next page'}
        style={({ pressed }) => [
          styles.cta,
          { backgroundColor: pressed ? C.liveText : C.live },
        ]}>
        <Text style={[styles.ctaLabel, { color: C.onLive }]}>
          {last ? 'GET STARTED' : 'NEXT'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  /** 66/26/40 in the artboard; the 66 is the status bar plus 8. */
  screen: {
    flex: 1,
    paddingHorizontal: 26,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  counter: {
    ...Type.label(10),
    letterSpacing: 1.4,
    // A counter is a number that measures: it must not re-flow as it counts.
    ...TABULAR,
  },
  skip: {
    minHeight: 44,
    minWidth: 48,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  skipLabel: {
    ...Type.heading(10),
    letterSpacing: 1.2,
  },
  pageHost: {
    flex: 1,
    minHeight: 0,
    justifyContent: 'center',
  },
  page: {
    justifyContent: 'center',
  },
  bleedPlate: {
    position: 'absolute',
    right: -18,
    top: 0,
    width: 150,
    height: 150,
    opacity: 0.9,
  },
  bleedLogo: {
    width: 150,
    height: 150,
  },
  titleOne: {
    ...Type.display(46),
    lineHeight: 45,
    letterSpacing: -1.84,
  },
  title: {
    ...Type.display(34),
    lineHeight: 36,
    letterSpacing: -1.02,
    marginTop: 10,
    marginBottom: Space.lg,
  },
  bleedRule: {
    height: Rule.major,
    marginTop: 18,
    marginBottom: 18,
    marginRight: -26,
  },
  pitch: {
    ...Type.body(16),
    lineHeight: 25,
  },
  kicker: {
    ...Type.label(10),
    letterSpacing: 1.4,
  },
  quoteBlock: {
    borderWidth: Rule.hair,
    padding: Space.md,
    marginBottom: Space.lg,
  },
  quoteLabel: {
    ...Type.label(10),
    letterSpacing: 1.1,
  },
  quote: {
    ...Type.heading(15),
    letterSpacing: 0.3,
    marginTop: 5,
  },
  ladder: {
    borderTopWidth: Rule.hair,
    marginBottom: Space.lg,
  },
  rung: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    borderBottomWidth: Rule.hair,
  },
  rungBar: {
    width: 10,
    height: 22,
    flexShrink: 0,
    overflow: 'hidden',
  },
  rungOutline: {
    borderWidth: Rule.hair,
  },
  hatch: {
    position: 'absolute',
    top: -8,
    width: 3,
    height: 38,
    transform: [{ rotate: '45deg' }],
  },
  rungReading: {
    ...readout(12),
    letterSpacing: 0.6,
    width: 78,
    flexShrink: 0,
  },
  rungAction: {
    ...Type.body(13),
    flexShrink: 1,
  },
  providerRow: {
    flexDirection: 'row',
    gap: Space.sm,
    marginBottom: Space.lg,
  },
  providerCard: {
    flex: 1,
    borderWidth: Rule.hair,
    padding: 11,
  },
  providerName: {
    ...Type.heading(12),
    letterSpacing: 0.48,
  },
  providerNote: {
    ...Type.body(11),
    lineHeight: 15,
    marginTop: Space.xs,
  },
  progress: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: Space.lg,
  },
  progressBar: {
    flex: 1,
    height: 3,
  },
  cta: {
    minHeight: 52,
    justifyContent: 'center',
    paddingHorizontal: Space.lg,
  },
  ctaLabel: {
    ...Type.heading(13),
    letterSpacing: 1.3,
  },
});
