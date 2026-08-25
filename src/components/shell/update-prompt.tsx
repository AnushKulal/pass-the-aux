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
 */

import { LinearGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';

import {
  Duration,
  PointerEvents,
  Radii,
  Rule,
  Space,
  TOUCH_TARGET,
  Type,
  ZIndex,
  dropped,
} from '@/lib/theme';
import { useColors } from '@/lib/theme-context';
import { useUpdates } from '@/lib/updates';

/**
 * How far below its resting place the sheet starts.
 *
 * A fixed value rather than a measured height: the card is absolutely
 * positioned against the bottom edge, so anything larger than the card puts it
 * fully off-screen, and measuring first would cost a frame in which the sheet
 * is visible but un-animated. 480 clears the tallest form this card takes.
 */
const SHEET_TRAVEL = 480;

export function UpdatePrompt() {
  const C = useColors();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();

  const { promptVisible, pending, status, apply, dismissPrompt } = useUpdates();

  const y = useSharedValue(SHEET_TRAVEL);
  const opacity = useSharedValue(0);

  /**
   * The card stays in the tree and is moved off the bottom edge instead of
   * being unmounted.
   *
   * It used to carry a `mounted` state so it could survive its own exit, but
   * raising that flag meant a synchronous setState at the top of this effect,
   * which cascades a render every time the prompt opens. Parking the card is
   * the cheaper answer to the same problem: nothing has to be kept alive
   * artificially if nothing ever dies. It starts at `SHEET_TRAVEL` with zero
   * opacity, so the first paint is already off-screen.
   */
  useEffect(() => {
    // Sheet duration on the way up — this travels a full card height rather
    // than nudging a module into place. Back down faster, so dismissing feels
    // like a dismissal and not a second presentation.
    const ms = reduced ? 0 : promptVisible ? Duration.sheet : Duration.press;

    y.value = withTiming(promptVisible ? 0 : SHEET_TRAVEL, { duration: ms });
    opacity.value = withTiming(promptVisible ? 1 : 0, { duration: ms });
  }, [promptVisible, reduced, y, opacity]);

  const animated = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: y.value }],
  }));

  const applying = status === 'applying';

  return (
    <View
      style={[
        styles.layer,
        { paddingBottom: insets.bottom + Space.lg },
        PointerEvents.boxNone,
        /*
          `display: none` when there is nothing to show, and it is load-bearing.
          This card is PARKED rather than unmounted — always in the tree, moved
          off-screen by transform — so while parked it still occupies its 254px
          at the bottom of the window and still hit-tests. `pointerEvents` in the
          style prop does NOT reliably reach react-native-web here, so the parked
          card silently swallowed every tap in the bottom quarter of the screen:
          the intro's "Get started", and the whole navigation bar.

          `display: none` removes it from hit-testing outright, which no styling
          discrepancy between platforms can undo. It costs the last frames of the
          exit animation, and that is a trade worth making for a control surface
          that cannot eat input.
        */
        promptVisible ? null : styles.parked,
      ]}>
      {/*
        Parked rather than unmounted, so it must be inert while it is parked:
        off-screen is not the same as gone. Without these three the dismissed
        card still swallows taps along the bottom edge and still reads out to a
        screen reader as a live update offer.
      */}
      <Animated.View
        accessibilityElementsHidden={!promptVisible}
        importantForAccessibility={promptVisible ? 'auto' : 'no-hide-descendants'}
        style={[
          styles.card,
          animated,
          { backgroundColor: C.surfaceSolid, borderColor: C.chromeBorder },
          /*
            `surfaceSolid`, not `surface`. This card floats over whatever screen
            happens to be underneath it, and `surface` is 5.5% white — at that
            alpha the content behind would read straight through the update
            notes. Anything that overlays arbitrary content needs the opaque
            composite.
          */
          dropped(C, 'lg'),
          promptVisible ? PointerEvents.auto : PointerEvents.none,
        ]}>
        <View style={styles.head}>
          <View style={styles.headText}>
            {/* Ink, matching the banner's mark and the Settings dot — one
                event, one loudness, on all three surfaces that report it. */}
            <Text style={[styles.kicker, { color: C.ink3 }]}>UPDATE READY</Text>
            <Text style={[styles.title, { color: C.ink }]}>A new version of aux is ready</Text>
          </View>

          <Pressable
            onPress={dismissPrompt}
            disabled={applying}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
            hitSlop={8}
            style={styles.close}>
            <X size={20} strokeWidth={2} color={C.ink2} />
          </Pressable>
        </View>

        {/*
          What actually changed, across every patch this user skipped. Omitted
          entirely rather than shown empty when the incoming manifest predates
          the changelog — an empty heading is worse than no heading.
        */}
        {pending.notes.length > 0 ? (
          <View style={[styles.notes, { borderTopColor: C.rule }]}>
            <Text style={[styles.notesKicker, { color: C.ink3 }]}>
              {pending.patchCount > 1
                ? `IN THE LAST ${pending.patchCount} PATCHES`
                : 'IN THIS PATCH'}
            </Text>

            {pending.notes.map((note) => (
              <View key={note} style={styles.note}>
                {/* A rule, not a bullet glyph — separation is the rule here. */}
                <View style={[styles.noteMark, { backgroundColor: C.ink3 }]} />
                <Text style={[styles.noteText, { color: C.ink2 }]}>{note}</Text>
              </View>
            ))}

            {pending.hidden > 0 ? (
              <Text style={[styles.more, { color: C.ink3 }]}>
                {`+${pending.hidden} more ${pending.hidden === 1 ? 'fix' : 'fixes'}`}
              </Text>
            ) : null}
          </View>
        ) : null}

        <Text style={[styles.body, { color: C.ink2 }]}>
          It installs instantly. The app restarts, so finish what you are listening to first — you
          can always apply it later from Settings.
        </Text>

        <View style={[styles.actions, { borderTopColor: C.rule }]}>
          <Pressable
            onPress={dismissPrompt}
            disabled={applying}
            accessibilityRole="button"
            style={[styles.action, { borderRightWidth: Rule.hair, borderRightColor: C.rule }]}>
            <Text style={[styles.actionLabel, { color: C.ink2 }]}>NOT NOW</Text>
          </Pressable>

          {/*
            Blue, and under the current rule that is now exactly right rather
            than merely defensible.

            The old direction had ONE accent covering live, playing, joinable, in
            sync and selected, so this button had to avoid it — applying an
            update is none of those things, and the note here used to explain
            that at length. There are two accents now, and the second one means
            precisely "this is the thing you do". A primary action is what blue
            is FOR, so this stopped being an exception and became the rule.
          */}
          <Pressable
            onPress={() => void apply()}
            disabled={applying}
            accessibilityRole="button"
            style={styles.action}>
            <LinearGradient
              colors={[C.priTint, C.pill]}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={styles.actionFill}>
              <Text style={[styles.actionLabel, { color: C.pillInk }]}>
                {applying ? 'RESTARTING' : 'UPDATE NOW'}
              </Text>
            </LinearGradient>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: Space.lg,
    zIndex: ZIndex.toast,
    ...Platform.select({ android: { elevation: ZIndex.toast }, default: {} }),
  },
  /**
   * Taken out of hit-testing entirely while there is no update to offer.
   *
   * Not belt-and-braces — this is the only thing that actually worked. The card
   * is parked off-screen rather than unmounted, so without this it still holds
   * its ~250px at the bottom of the window and still receives every tap that
   * lands there. `pointerEvents` on the style does not reach react-native-web
   * reliably, and the parked card ate the intro's primary button and the whole
   * navigation bar.
   */
  parked: {
    display: 'none',
  },
  card: {
    /*
      Rounded, bordered and floating — where this was previously radius 0 with a
      2px hard edge and no shadow at all, because the old direction separated
      surfaces with rules rather than depth.

      `overflow: hidden` is not optional now that there is a radius: the actions
      row runs edge to edge along the bottom of the card, so without it the
      primary action's fill paints square corners straight through the rounded
      ones.
    */
    borderRadius: Radii.xxl,
    borderWidth: Rule.hair,
    overflow: 'hidden',
  },
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: Space.lg,
    paddingBottom: Space.sm,
    gap: Space.sm,
  },
  headText: { flex: 1, gap: 6 },
  kicker: Type.label(10),
  title: Type.display(20),
  close: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    // Pull the glyph back to the card's edge without shrinking its hit area.
    marginTop: -Space.sm,
    marginRight: -Space.sm,
  },
  notes: {
    borderTopWidth: Rule.hair,
    marginHorizontal: Space.lg,
    paddingTop: Space.md,
    gap: Space.sm,
  },
  notesKicker: {
    ...Type.label(10),
    marginBottom: 2,
  },
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Space.sm,
  },
  noteMark: {
    width: 8,
    height: Rule.major,
    // Sits on the text's first-line baseline rather than its box top.
    marginTop: 8,
  },
  noteText: {
    ...Type.body(13),
    flex: 1,
  },
  more: {
    ...Type.label(10),
    // Aligns with the note text, past the 8px mark and its gap.
    marginLeft: 8 + Space.sm,
  },
  body: {
    ...Type.body(14),
    padding: Space.lg,
  },
  actions: {
    flexDirection: 'row',
    borderTopWidth: Rule.hair,
  },
  action: {
    flex: 1,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** The gradient has to fill the whole cell, so the press target owns no padding. */
  actionFill: {
    width: '100%',
    height: '100%',
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: Type.heading(12),
});
