/**
 * About. Design: `design/nocturne/aux-nocturne.dc.html`, the `sc-if isAbout`
 * block at L644–L661.
 *
 * The artboard turns this from a facts list into a short piece of writing: a
 * lead paragraph that states the one architectural claim the app rests on, the
 * developer card, the build stats, and then HOW SYNC WORKS — the only place in
 * the product that explains the sync engine to the person using it.
 *
 * EVERY NUMBER IN THE SYNC CARD IS READ OUT OF THE CODE, not transcribed from
 * the mock. The artboard says "five times, lowest round-trip wins" (true:
 * `SAMPLE_COUNT = 5` in '@/lib/clock'), "±2%" (true: `Drift.RATE_NUDGE`), and
 * "every reading is written to sync_metrics" — which is NOT true: `use-room-sync`
 * samples one in ten, deliberately, because an unsampled two-hour Session is
 * ~2,400 rows per listener. A card that explains the engine is the last place
 * that may round a number, so it says one in ten. The two thresholds the mock
 * leaves out (`Drift.IGNORE` 250ms, `Drift.SEEK` 1.5s) are named here, since
 * "a three-rung ladder" with no rungs is a shape rather than an explanation.
 *
 * FOUR STATES. Nothing here is fetched, so they attach to the two things that
 * can actually be unknown or go wrong:
 *   loading   the repository handoff is in flight — the button says so and locks
 *   error     the browser refused; the button says so and the URL appears so it
 *             can be copied by hand
 *   empty     a build fact the binary was not stamped with reads as an em dash
 *             rather than a made-up version number
 *   ready     the facts
 */

import Constants from 'expo-constants';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { ArrowLeft } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type TextStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Wordmark } from '@/components/shell/wordmark';
import { GlassCard } from '@/components/ui';
import { installedVersionCode } from '@/lib/apk-updates';
import { useDockReserve } from '@/lib/dock';
import { useEntrance } from '@/lib/entrance';
import { Fonts, Radii, Rule, Space, TOUCH_TARGET, Type, tracking } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

/** The artboard's scroll body is `padding:14px 18px 130px`. See `(tabs)/profile.tsx`. */
const GUTTER = 18;

const BACK_ICON = 16;

/** The artboard's lockup mark is 22px of cap height (design L650). */
const MARK = 22;

/** The design's ghost footer button: 50 tall, one step under the 54px CTA. */
const FOOTER_HEIGHT = 50;

const REPOSITORY = 'https://github.com/AnushKulal/pass-the-aux';

/** The em dash stands for "this build was not stamped with one". */
const UNKNOWN = '—';

/** `Type.readout()` hands back a readonly tuple; `TextStyle` wants a mutable one. */
const readout = (size: number): TextStyle => ({
  ...Type.readout(size),
  fontVariant: ['tabular-nums'],
});

export default function AboutScreen() {
  const C = useColors();
  const dockReserve = useDockReserve();

  /*
    The handoff used to swallow its own failure — `.catch(() => undefined)` —
    which left the control looking untapped on any device with no browser to
    hand. It now has somewhere to say so, and the URL to fall back on.
  */
  const [handoff, setHandoff] = useState<'idle' | 'opening' | 'error'>('idle');

  /*
    ===================== HOW THIS SCREEN ARRIVES =====================

    The local shared-value entrance this used to hold — opacity only, fired on
    mount — is `useEntrance` now, along with its three siblings in Settings,
    Connections and You. It faded without LIFTING, which is the dissolve the
    user asked to be rid of, and it fired on mount, which in a group that keeps
    its screens alive means it played once per app launch and never again.

    WHAT ANIMATES. This screen is a short piece of writing followed by four
    objects, so it reads top to bottom and the arrival should too:

      MODULE  the whole column. The back link, the title and the lead paragraph
              ride it — the lead is the second half of the heading, not a card,
              and the design tightens the gap between them to say so.
      BANDS   the developer card, the build stats, the sync card and the source
              link, one step apart at `Stagger.feed`.

    The three stat tiles are ONE band rather than three. They are read as a row
    of related facts, and a cascade running sideways under one running down is
    two sequences competing for the same eye.
  */
  const moduleStyle = useEntrance({ kind: 'module' });
  const developerIn = useEntrance({ index: 0 });
  const statsIn = useEntrance({ index: 1 });
  const syncIn = useEntrance({ index: 2 });
  const sourceIn = useEntrance({ index: 3 });

  const openRepository = useCallback(async () => {
    setHandoff('opening');
    try {
      await WebBrowser.openBrowserAsync(REPOSITORY);
      setHandoff('idle');
    } catch {
      setHandoff('error');
    }
  }, []);

  /** Both may be absent: a bare `expo start` stamps neither. */
  const version = Constants.expoConfig?.version ?? UNKNOWN;
  const build = installedVersionCode();

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.root, { backgroundColor: C.bg }]}>
      <Animated.View style={[styles.flex, moduleStyle]}>
        <ScrollView
          contentContainerStyle={[
            styles.content,
            /*
              The nav capsule floats and takes no layout space, so the body has
              to leave room for it or its last row sits under the glass. Inline
              rather than a StyleSheet entry because `useDockReserve()` includes
              the device's bottom inset, which a static object cannot carry —
              the old `Dock.reserve` here left NEGATIVE clearance on every phone
              with a home indicator.
            */
            { paddingBottom: dockReserve },
          ]}
          showsVerticalScrollIndicator={false}>
          <BackLink
            label="Settings"
            onPress={() => {
              if (router.canGoBack()) router.back();
              else router.replace('/settings');
            }}
          />
          <Text accessibilityRole="header" style={[styles.title, { color: C.ink }]}>
            About
          </Text>

          {/*
            The artboard's emphasis span: same 400 weight, brighter ink only.
            It lands on the clause that is the actual claim — the rest of the
            sentence is setup for it.
          */}
          <Text style={[styles.lead, { color: C.ink2 }]}>
            Aux is built and maintained by one person. No audio passes through the backend — every
            listener plays from their own account, and the server only says
            <Text style={{ color: C.ink }}> this track, starting at this instant.</Text>
          </Text>

          {/* -------------------------------------------------------- developer */}
          {/*
            The band's entrance goes on the spacing wrapper that was already
            here rather than on a new one — `GlassCard` is a plain View and
            cannot take an animated style, but this wrapper can, so the card
            arrives without anything being added around it.
          */}
          <Animated.View style={[styles.card, developerIn]}>
            <GlassCard style={styles.developer}>
              {/*
                The real wordmark rather than the "AUX" monogram tile this
                screen used to draw. That tile was `bgRecessed` behind a
                hairline with `ink` lettering — which was correct under the
                previous direction and is now redundant twice over: artwork
                inverted to a dark well, so the tile reads as a hole, and the
                mark has had a gradient of its own since nocturne landed.
              */}
              <Wordmark size={MARK} />
              <View style={styles.developerText}>
                <Text numberOfLines={1} style={[styles.name, { color: C.ink }]}>
                  Anush Kulal
                </Text>
                <Text numberOfLines={1} style={[styles.handle, { color: C.ink3 }]}>
                  DEVELOPER · @AnushKulal
                </Text>
              </View>
            </GlassCard>
          </Animated.View>

          {/* ------------------------------------------------------------ build */}
          <Animated.View style={[styles.stats, statsIn]}>
            <Stat label="Version" value={version} />
            <Stat label="Build" value={build > 0 ? String(build) : UNKNOWN} />
            {/*
              The artboard's third fact is STACK / "Expo · Supabase". A third
              column leaves roughly 78px of text on a 375pt frame and two words
              wrap to three lines there, so this carries the runtime alone and
              the sync card below names the backend in the sentence where it
              actually matters.
            */}
            <Stat label="Stack" value="Expo" numeric={false} />
          </Animated.View>

          {/* ------------------------------------------------------------- sync */}
          <Animated.View style={[styles.cardTight, syncIn]}>
            <GlassCard>
              <Text style={[styles.kicker, { color: C.ink3 }]}>How sync works</Text>
              <Text style={[styles.prose, { color: C.ink2 }]}>
                Clock offset is sampled NTP-style, five times a round, and the lowest round-trip
                wins. Drift is corrected on a three-rung ladder — ignore it under 250ms, nudge the
                playback rate ±2% up to 1.5s, hard-seek past that. One reading in ten is written to
                sync_metrics on Supabase.
              </Text>
            </GlassCard>
          </Animated.View>

          {/* ----------------------------------------------------------- source */}
          {/*
            The design's ghost footer: `surface` behind a hairline, and on press
            the EDGE turns blue rather than the fill changing. That is the one
            place a secondary control is allowed to touch the action colour —
            it is answering a press, not advertising itself. Hand-rolled rather
            than `AuxButton variant="bordered"` for two reasons: the role is a
            link, not a button, and the label carries the handoff's three states.

            THE FALLBACK ADDRESS IS INSIDE THIS BAND, not a band of its own, and
            that is what keeps it from animating. It appears only after a failed
            handoff — long after the screen has settled and its entrance has
            finished — so as a child of an already-arrived wrapper it simply
            exists. Given a step of its own it would have faded in on a delay,
            and nobody should wait to be told how to recover from an error.
          */}
          <Animated.View style={sourceIn}>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel="Open the source repository"
              accessibilityState={{ disabled: handoff === 'opening', busy: handoff === 'opening' }}
              disabled={handoff === 'opening'}
              onPress={() => {
                void openRepository();
              }}
              style={({ pressed }) => [
                styles.footer,
                {
                  backgroundColor: C.surface,
                  borderColor: pressed ? C.pill : C.rule,
                },
              ]}>
              {/*
                ONE HUE ON THIS LABEL, AND IT IS THE FAILURE ONE.

                This used to read `error ? liveText : pressed ? priTint : ink` —
                a single Text cycling through BOTH accents: coral when the
                handoff failed, blue while held. Two things were wrong with it.
                Coral is the LIVE accent — playing, in sync, on aux, unread —
                and a browser that refused to open is a failure, which has its
                own pink-red hue (`danger`); an error is not a state of the
                world worth celebrating. And no single element may carry two
                accents at all, so the blue press tint moves off the label
                entirely: the EDGE already turns blue on press (see the note
                above), which is this control's designated place for the action
                colour, and having the word turn blue underneath it was the same
                signal twice.
              */}
              <Text
                style={[styles.footerLabel, { color: handoff === 'error' ? C.danger : C.ink }]}>
                {handoff === 'opening'
                  ? 'Opening…'
                  : handoff === 'error'
                    ? 'Could not open the browser'
                    : 'Open source repository'}
              </Text>
            </Pressable>

            {/* The fallback the error leaves you with: the address, selectable. */}
            {handoff === 'error' ? (
              <Text selectable style={[styles.fallback, { color: C.ink3 }]}>
                {REPOSITORY}
              </Text>
            ) : null}
          </Animated.View>
        </ScrollView>
      </Animated.View>
    </SafeAreaView>
  );
}

/* ------------------------------------------------------------------- parts */

/**
 * The back control shared by the settings family — a named LINK above the
 * title, not the 44px circle `ui/screen.tsx` draws. See the note in
 * `settings/index.tsx`; the three copies are deliberately identical and stay
 * local to their files until the kit grows a home for it.
 */
function BackLink({ label, onPress }: { label: string; onPress: () => void }) {
  const C = useColors();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Back to ${label}`}
      onPress={onPress}
      style={({ pressed }) => [styles.back, pressed && styles.backHeld]}>
      <ArrowLeft size={BACK_ICON} strokeWidth={2} color={C.ink2} />
      <Text style={[styles.backLabel, { color: C.ink2 }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * One build fact.
 *
 * KICKER ABOVE VALUE, which is the artboard's order and the reverse of what
 * this screen used to draw. It matters more than it looks: the label is the
 * question and the value is the answer, and a version number with no context
 * above it is just a number floating in a box.
 *
 * Radius 18 and NO shadow — the design's second card size, and it is exact
 * about which is which: all 43 of its radius-24 surfaces carry a shadow, none
 * of its 54 radius-18 ones do.
 */
function Stat({
  label,
  value,
  numeric = true,
}: {
  label: string;
  value: string;
  /** Tabular figures and the larger size. False for a value that is a word. */
  numeric?: boolean;
}) {
  const C = useColors();

  return (
    <View style={[styles.stat, { backgroundColor: C.surface, borderColor: C.rule }]}>
      <Text numberOfLines={1} style={[styles.statLabel, { color: C.ink3 }]}>
        {label}
      </Text>
      <Text numberOfLines={1} style={[numeric ? styles.statValue : styles.statWord, { color: C.ink }]}>
        {value}
      </Text>
    </View>
  );
}

/* ------------------------------------------------------------------ styles */

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  content: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    paddingHorizontal: GUTTER,
    paddingTop: 14,
    // The bottom padding is inline on the ScrollView — see the note there.
  },

  /* -------------------------------------------------------------- header */

  back: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: Space.sm,
    minHeight: TOUCH_TARGET,
    paddingRight: Space.md,
  },
  backHeld: {
    opacity: 0.6,
  },
  backLabel: {
    fontFamily: Fonts.semibold,
    fontSize: 12,
    lineHeight: 16,
  },
  title: {
    ...Type.display(28),
    letterSpacing: tracking(28, -0.025),
    marginTop: Space.sm,
    // 8, not the 18 the other two screens use: a paragraph follows immediately
    // here, and the artboard tightens the gap so the title and its lead read as
    // one block rather than a heading over a section.
    marginBottom: Space.sm,
  },
  lead: {
    ...Type.body(14),
    lineHeight: 22,
  },

  /* ----------------------------------------------------------- developer */

  card: {
    marginTop: Space.lg,
  },
  /** The artboard opens with 16 under the lead and tightens to 12 between cards. */
  cardTight: {
    marginTop: Space.md,
  },
  developer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
  },
  developerText: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    ...Type.display(16),
    // `Type.display` sets its line box at 1.06x, which is right for a 28px
    // screen title and clips a descender at 16 on Android. Opened to 1.3.
    lineHeight: 21,
    letterSpacing: tracking(16, -0.01),
  },
  /*
    400 at 11px, uppercase and widely tracked — NOT `Type.label`, which is the
    same case and tracking at 600. The artboard sets this line light on purpose
    so it reads as a footnote under the name rather than as a second title.
  */
  handle: {
    fontFamily: Fonts.regular,
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: tracking(11, 0.06),
    textTransform: 'uppercase',
    marginTop: 2,
  },

  /* --------------------------------------------------------------- build */

  stats: {
    flexDirection: 'row',
    gap: 10,
    marginTop: Space.md,
  },
  stat: {
    flex: 1,
    minWidth: 0,
    padding: 14,
    borderRadius: Radii.lg,
    borderWidth: Rule.hair,
  },
  statLabel: {
    ...Type.label(9.5),
    fontFamily: Fonts.extrabold,
    letterSpacing: tracking(9.5, 0.11),
  },
  statValue: {
    ...readout(18),
    letterSpacing: tracking(18, -0.02),
    marginTop: 5,
  },
  /** The one stat whose value is a word rather than a numeral, so no tabular figures. */
  statWord: {
    fontFamily: Fonts.extrabold,
    fontSize: 15,
    lineHeight: 20,
    marginTop: 5,
  },

  /* ---------------------------------------------------------------- sync */

  kicker: {
    ...Type.label(9.5),
    fontFamily: Fonts.extrabold,
    letterSpacing: tracking(9.5, 0.12),
  },
  prose: {
    ...Type.body(13),
    lineHeight: 21,
    marginTop: 7,
  },

  /* -------------------------------------------------------------- source */

  footer: {
    minHeight: FOOTER_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
    paddingHorizontal: Space.lg,
    borderRadius: Radii.pill,
    borderWidth: Rule.hair,
  },
  footerLabel: {
    fontFamily: Fonts.semibold,
    fontSize: 13,
    lineHeight: 17,
    letterSpacing: tracking(13, 0.02),
  },
  fallback: {
    ...Type.body(12),
    marginTop: Space.sm,
    paddingHorizontal: 2,
  },
});
