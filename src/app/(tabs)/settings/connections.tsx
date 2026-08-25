/**
 * Connections — the Spotify link and the playback source. Design:
 * `design/nocturne/aux-nocturne.dc.html`, the `sc-if isConn` block at L577–L599.
 *
 * The artboard finally has a real screen for this, where the previous direction
 * had none and this file was assembled out of the Settings vocabulary. Two
 * cards: the Spotify account with a status chip and its actions, then the
 * playback source as a pill-track segmented control.
 *
 * THE ARTBOARD BREAKS THE ACCENT RULE HERE AND THIS FILE DOES NOT.
 * Its "I have Premium" button is a coral-washed pill (`--aux-live-w` fill,
 * `--aux-live-m` edge, `--aux-live-t` label) sitting beside a neutral "Unlink".
 * Coral in this direction means a state of the world — live, playing, in sync,
 * PREMIUM — and blue means an action you take; rechecking your plan is an
 * action, so it is the blue gradient pill and the coral is spent on the PREMIUM
 * badge in the card header instead, where it describes rather than invites.
 * That is the rule applied literally: the button is blue, the badge beside it
 * is coral, and no single element carries both.
 *
 * UNLINK IS DESTRUCTIVE AND NOW LOOKS IT. It used to be the quiet neutral tile
 * on the right, drawn in `surface3` — the same weight as a cancel. Destruction
 * has its own pink-red hue again in this palette, distinct from both accents,
 * and severing an account link is exactly what it is for. So is the FAILURE
 * message above it: `danger` covers destruction and failure both, and a link
 * attempt that did not work is not a live state.
 *
 * FOUR STATES, on the Spotify card:
 *   loading   a card-shaped skeleton while the profile read settles
 *   error     the link attempt failed; the reason stays on the card, and the
 *             button under it becomes the retry
 *   empty     not linked — the one action that links it
 *   ready     linked, with the paragraph that says where audio is coming from
 *
 * The playback source below reads a local store and cannot fail, so it has no
 * states of its own; blanking it while the network settles would only hide a
 * control that already works.
 */

import { LinearGradient } from 'expo-linear-gradient';
import { Redirect, router } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type TextStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AuxButton, GlassCard, Skeleton, StatusPill } from '@/components/ui';
import { useSpotifyLink } from '@/features/spotify/use-spotify-link';
import { useAuth } from '@/lib/auth';
import { useDockReserve } from '@/lib/dock';
import {
  Duration,
  Fonts,
  Radii,
  Rule,
  Space,
  TOUCH_TARGET,
  Type,
  tracking,
} from '@/lib/theme';
import { useColors } from '@/lib/theme-context';
import { usePlayback, type SourcePreference } from '@/playback/store';

/** The artboard's scroll body is `padding:14px 18px 130px`. See `(tabs)/profile.tsx`. */
const GUTTER = 18;

const BACK_ICON = 16;

/**
 * `GlassCard` keeps its 24px corner private. The skeleton has to stand in for a
 * whole card, so it needs the same number; it goes away with the same
 * `Radii.card = 24` that retires the constant in `glass-card.tsx`.
 */
const CARD_RADIUS = 24;

/**
 * What the skeleton stands in for: 16 pad + a 24px header row (the badge is
 * taller than the title beside it) + 11 + four 22px body lines + 15 + a 46px
 * action row + 16 pad.
 *
 * It cannot be exact for every branch and does not pretend to be — the premium
 * paragraph is two lines shorter than the free one. This is sized for the two
 * branches a first load actually lands on, unlinked and free, so the card
 * settles rather than jumping. The previous value was 138, which was a whole
 * paragraph short of any of them.
 */
const CARD_HEIGHT = 216;

/** The artboard's segmented track: 5px of padding around 44px segments. */
const TRACK_PAD = 5;
const SEGMENT_HEIGHT = 44;

/** Resolved link state. "free" is a normal, supported way to use Aux. */
type LinkState = 'unlinked' | 'free' | 'premium';

const SOURCES: { value: SourcePreference; label: string; caption: string }[] = [
  {
    value: 'auto',
    label: 'Auto',
    caption: 'Auto picks the best source you can actually control — Spotify on Premium, YouTube otherwise.',
  },
  {
    value: 'youtube',
    label: 'Always YouTube',
    caption: 'Always YouTube is useful if Spotify keeps stealing your car stereo.',
  },
];

/** The header badge. `StatusPill` uppercases it, which is the artboard's setting. */
const BADGE: Record<LinkState, string> = {
  unlinked: 'Not linked',
  free: 'Linked · free',
  premium: 'Premium',
};

/**
 * The paragraph under the badge, and it is the whole reason this screen exists.
 *
 * "Free · linked" is the fact people read as a fault, so every one of these
 * ends by naming what is actually playing. The trailing clause is set in `ink`
 * rather than `ink2` — the artboard's own emphasis span, same weight, brighter
 * ink only, because the reassurance is the part that has to survive a skim.
 */
const BODY: Record<LinkState, { lead: string; emphasis: string }> = {
  unlinked: {
    lead: 'Linking makes your Spotify library searchable from the track picker. Playback control needs Premium; without it Aux plays the same track through YouTube instead.',
    emphasis: ' Nothing is lost by linking.',
  },
  free: {
    lead: 'Spotify only allows playback control on Premium. Your account is linked and your library is searchable — Aux just plays your audio through YouTube instead.',
    emphasis: ' Nothing is broken.',
  },
  premium: {
    lead: 'Aux plays through Spotify on this device. Everyone else in the Session hears the same track at the same second,',
    emphasis: ' from their own account.',
  },
};

/** `Type.readout()` hands back a readonly tuple; `TextStyle` wants a mutable one. */
const readout = (size: number): TextStyle => ({
  ...Type.readout(size),
  fontVariant: ['tabular-nums'],
});

export default function ConnectionsScreen() {
  const C = useColors();
  const reduced = useReducedMotion();
  const dockReserve = useDockReserve();
  const { session, profile, loading } = useAuth();
  const { link, unlink, linking, error } = useSpotifyLink();
  // The playback store is the only reader of this preference, so this screen
  // has to write into that store — a settings copy of it would be a switch
  // wired to nothing.
  const source = usePlayback((state) => state.sourcePreference);

  const enter = useSharedValue(0);
  useEffect(() => {
    enter.value = reduced ? 1 : withTiming(1, { duration: Duration.enter });
  }, [reduced, enter]);
  const enterStyle = useAnimatedStyle(() => ({ opacity: enter.value }));

  const state: LinkState = !profile?.spotify_linked
    ? 'unlinked'
    : profile.is_premium
      ? 'premium'
      : 'free';

  const overridden = state === 'premium' && source === 'youtube';
  const caption = SOURCES.find((option) => option.value === source)?.caption ?? '';

  /*
    The failure used to live in a toast, which is the wrong surface for it: it
    slides away while the card underneath still says "Not linked" and offers no
    account of why. `link()` clears the string on its next run, so the block
    below disappears exactly when the user retries.
  */
  const failed = Boolean(error) && !linking;

  // This screen sits outside both guarded groups, so a deep link can land here
  // signed out. Without this it would render "Not linked" to a stranger.
  if (!loading && !session) return <Redirect href="/(auth)/sign-in" />;

  const body = BODY[state];

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.root, { backgroundColor: C.bg }]}>
      <Animated.View style={[styles.flex, enterStyle]}>
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
          {/*
            "Back", not the artboard's "You". This screen is reachable from both
            the You tab and Settings, and a link that names the wrong
            destination is worse than one that names none.
          */}
          <BackLink
            label="Back"
            onPress={() => {
              if (router.canGoBack()) router.back();
              else router.replace('/(tabs)/profile');
            }}
          />
          <Text accessibilityRole="header" style={[styles.title, { color: C.ink }]}>
            Connections
          </Text>

          {/* ---------------------------------------------------- spotify card */}
          {loading ? (
            <View accessibilityRole="progressbar" accessibilityLabel="Loading your Spotify link">
              <Skeleton width="100%" height={CARD_HEIGHT} radius={CARD_RADIUS} />
            </View>
          ) : (
            <GlassCard>
              <View style={styles.cardHead}>
                <Text style={[styles.cardTitle, { color: C.ink }]}>Spotify</Text>
                {/*
                  CORAL ON PREMIUM AND NOWHERE ELSE. The accent rule names
                  PREMIUM explicitly as a state of the world, and this badge is
                  the only element on the screen entitled to it — everything
                  else here is either an action (blue) or a fact in the neutral
                  register (`outline`, a `surface2` fill behind a hairline).
                */}
                <StatusPill
                  label={BADGE[state]}
                  tone={state === 'premium' ? 'accent' : 'outline'}
                />
              </View>

              {/*
                One paragraph, and on a failure it is the reason instead.

                THE ERROR TAKES `danger`, NOT `liveText`. This block used to
                carry a comment asserting the opposite — that `liveText` was
                "the house colour for a thing that went wrong" and that `danger`
                was reserved for controls that destroy something. That was
                invented here and it is backwards. Coral is the LIVE accent:
                playing, in sync, on aux, unread, Premium — things that are TRUE
                RIGHT NOW about the world. Pink-red is destruction AND FAILURE,
                which is why a failed link reads in the same hue as the Unlink
                button below it rather than in the same hue as the PREMIUM badge
                above it. `ui/text-field.tsx` and `ui/toast.tsx` have always done
                it this way.
              */}
              {failed ? (
                <Text accessibilityLiveRegion="polite" style={[styles.body, { color: C.danger }]}>
                  {error}
                </Text>
              ) : overridden ? (
                <Text style={[styles.body, { color: C.ink2 }]}>
                  Premium is linked, but the playback source below is set to YouTube, so
                  <Text style={{ color: C.ink }}> that is what this device uses.</Text>
                </Text>
              ) : (
                <Text style={[styles.body, { color: C.ink2 }]}>
                  {body.lead}
                  <Text style={{ color: C.ink }}>{body.emphasis}</Text>
                </Text>
              )}

              <View style={styles.actions}>
                {state === 'unlinked' ? (
                  <AuxButton
                    label={failed ? 'Try again' : 'Connect Spotify'}
                    variant="pri"
                    size="sm"
                    disabled={linking}
                    onPress={() => {
                      void link();
                    }}
                  />
                ) : (
                  <>
                    {state === 'free' || failed ? (
                      <AuxButton
                        label={failed ? 'Try again' : 'Recheck Premium'}
                        variant="pri"
                        size="sm"
                        disabled={linking}
                        onPress={() => {
                          void link();
                        }}
                      />
                    ) : null}
                    <AuxButton
                      label="Unlink"
                      variant="danger"
                      size="sm"
                      disabled={linking}
                      onPress={() => {
                        void unlink();
                      }}
                    />
                  </>
                )}
              </View>
            </GlassCard>
          )}

          {linking ? <Handshake reduced={reduced} /> : null}

          {/* ------------------------------------------------- playback source */}
          <View style={styles.sourceCard}>
            <GlassCard>
              <Text style={[styles.kicker, { color: C.ink3 }]}>Playback source</Text>

              {/*
                A WELL, so `bgRecessed` behind a hairline rather than `surface`.
                A `surface` track inside a `surface` card composites to ~11%
                white and the two stop being separate objects — the exact
                failure mode the token's own comment warns about.
              */}
              <View
                accessibilityRole="radiogroup"
                style={[styles.track, { backgroundColor: C.bgRecessed, borderColor: C.rule }]}>
                {SOURCES.map((option) => (
                  <Segment
                    key={option.value}
                    label={option.label}
                    selected={source === option.value}
                    onPress={() => usePlayback.getState().setSourcePreference(option.value)}
                  />
                ))}
              </View>

              <Text style={[styles.helper, { color: C.ink3 }]}>{caption}</Text>
            </GlassCard>
          </View>
        </ScrollView>
      </Animated.View>
    </SafeAreaView>
  );
}

/* ------------------------------------------------------------------- parts */

/**
 * The back control shared by the settings family — a named LINK above the
 * title, not the 44px circle `ui/screen.tsx` draws. See the note in
 * `settings/index.tsx`; the two are deliberately identical and stay local to
 * their files until the kit grows a home for it.
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
 * One segment of the source switch.
 *
 * The selected one is the BLUE GRADIENT with its own glow, because a selected
 * segment is listed in the accent rule alongside the CTA and the FAB as
 * something you do. The gradient is an absolutely-positioned child bleeding one
 * pixel past every edge rather than the view's own background — absolute insets
 * are measured from the padding box, so at zero it leaves a hairline of track
 * showing inside the fill. `AuxButton` solves it the same way, and this is the
 * same recipe as the WHO CAN JOIN control on New Lounge (design L534).
 */
function Segment({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const C = useColors();

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.segment,
        selected
          ? { boxShadow: [{ offsetX: 0, offsetY: 6, blurRadius: 16, color: C.glow }] }
          : pressed
            ? { backgroundColor: C.surface2 }
            : null,
        selected && pressed ? styles.segmentHeld : null,
      ]}>
      {selected ? (
        <LinearGradient
          colors={[C.priTint, C.pill]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={styles.segmentFill}
        />
      ) : null}
      <Text numberOfLines={1} style={[styles.segmentLabel, { color: selected ? C.pillInk : C.ink2 }]}>
        {label}
      </Text>
    </Pressable>
  );
}

/** The OAuth round trip, while the browser is away. */
function Handshake({ reduced }: { reduced: boolean }) {
  const C = useColors();
  const pulse = useSharedValue(1);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (reduced) {
      pulse.value = 1;
      return;
    }
    pulse.value = withRepeat(
      withTiming(0.25, { duration: 1000, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [pulse, reduced]);

  useEffect(() => {
    const timer = setInterval(() => setElapsed((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const animated = useAnimatedStyle(() => ({ opacity: pulse.value }));
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;

  /*
    `ink2`, not either accent. A handshake in flight is not live, playing, in
    sync or on aux, and it is not something you press — the PULSE is what says
    "still working", and neither colour is available to say it a second time.

    A radius-18 row with no shadow, which is the design's second card size: all
    43 of its radius-24 surfaces carry a shadow and none of its 54 radius-18
    rows do.
  */
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.handshake, { backgroundColor: C.surface, borderColor: C.rule }]}>
      <Animated.View style={[styles.dot, { backgroundColor: C.ink2 }, animated]} />
      <Text style={[styles.handshakeText, { color: C.ink2 }]}>Connecting…</Text>
      <Text style={[styles.elapsed, { color: C.ink3 }]}>
        {minutes}:{String(seconds).padStart(2, '0')}
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
    // The artboard's `margin:8px 0 18px`; `Space` has no 18. Matches the gap
    // Settings puts between its title and its first kicker.
    marginBottom: 18,
  },

  /* --------------------------------------------------------- spotify card */

  cardHead: {
    flexDirection: 'row',
    // The artboard aligns these on the baseline. RN's baseline alignment is not
    // dependable with a bordered View in the row, and a badge that sits half a
    // pixel low beside a 16px title is more visible than the difference the
    // baseline would have made.
    alignItems: 'center',
    gap: 9,
  },
  cardTitle: {
    flex: 1,
    minWidth: 0,
    ...Type.display(16),
    // `Type.display` sets its line box at 1.06x, which is right for a 28px
    // screen title and clips a descender at 16 on Android. Opened to 1.3.
    lineHeight: 21,
    letterSpacing: tracking(16, -0.01),
  },
  body: {
    ...Type.body(14),
    lineHeight: 22,
    marginTop: 11,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
    marginTop: 15,
  },

  /* -------------------------------------------------------------- source */

  sourceCard: {
    marginTop: Space.md,
  },
  kicker: {
    ...Type.label(9.5),
    fontFamily: Fonts.extrabold,
    letterSpacing: tracking(9.5, 0.13),
  },
  track: {
    flexDirection: 'row',
    gap: TRACK_PAD,
    padding: TRACK_PAD,
    marginTop: 9,
    borderRadius: Radii.pill,
    borderWidth: Rule.hair,
  },
  segment: {
    flex: 1,
    minHeight: SEGMENT_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Space.sm,
    borderRadius: Radii.pill,
    // The gradient is an absolutely-positioned CHILD, so the segment has to be
    // a containing block or the fill would find the track instead.
    position: 'relative',
  },
  segmentFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: Radii.pill,
  },
  /** The gradient segment dims under the finger; there is no second blue to ease to. */
  segmentHeld: {
    opacity: 0.9,
  },
  segmentLabel: {
    fontFamily: Fonts.extrabold,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: tracking(12, 0.02),
  },
  helper: {
    ...Type.body(12),
    lineHeight: 18,
    marginTop: 10,
  },

  /* ----------------------------------------------------------- handshake */

  handshake: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    minHeight: TOUCH_TARGET,
    marginTop: 10,
    padding: 14,
    borderRadius: Radii.lg,
    borderWidth: Rule.hair,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: Radii.pill,
  },
  handshakeText: {
    flex: 1,
    minWidth: 0,
    fontFamily: Fonts.semibold,
    fontSize: 15,
    lineHeight: 20,
  },
  elapsed: {
    ...readout(13),
  },
});
