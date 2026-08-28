/**
 * The confirmation dialog — the app's own answer to "are you sure?".
 *
 * WHY THIS EXISTS AT ALL, and it is a bug report rather than a preference: the
 * destructive confirms in this app were `Alert.alert`, which paints the
 * PLATFORM's dialog — a stock Android box with its own type, its own corners
 * and its own blue, dropped on top of a screen that shares none of them. Worse
 * on the third platform: react-native-web ships no Alert implementation, so on
 * web the confirm never appeared and the guard silently evaporated. Callers
 * papered over that with `globalThis.confirm`, which is the browser's chrome —
 * a second foreign dialog to keep in step with the first.
 *
 * One themed Modal behaves identically on all three, and is the only one of the
 * three that can be looked at next to the rest of the app.
 *
 * NOT IN THE ARTBOARD. `design/nocturne/aux-nocturne.dc.html` draws no dialog,
 * so this is assembled out of parts it does draw rather than invented:
 *   the panel      — the floating-chrome recipe the toast uses (L1529): a
 *                    `chromeBorder` edge over `dropped(C,'lg')`. That edge is
 *                    the load-bearing half; it is roughly twice as bright as
 *                    `rule`, and the delta is the whole difference between a
 *                    piece of glass and a card lying on the page.
 *   the copy block — the sheet head's title-over-prose pairing (L1457).
 *   the actions    — the danger pill with a quiet cancel under it, exactly as
 *                    the lounge sheet's own confirm step stacks them.
 *
 * `surfaceSolid`, NOT `surface`, and this is the translucency hazard at its
 * sharpest. A dialog floats over ARBITRARY content — a feed, artwork, another
 * modal's blur — and `surface` is 5.5% white with nothing underneath it to sit
 * on. The screen would read straight through the question being asked.
 *
 * IT IS DELIBERATELY NOT GLASS. Every other floating panel in the app is a
 * BlurView, and this one is opaque on purpose: the app budgets one live blur
 * surface and the nav capsule spends it, and a dialog is the one moment where
 * the thing behind it should stop competing for attention entirely.
 *
 * NO CORAL, EVER, on this component. Coral is state and live-entry; a question
 * about whether to destroy something is neither. `danger` is the default tone
 * and `pri` the only alternative, for the rare confirm asking you to go ahead
 * rather than to tear something down.
 */

import { useEffect } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { AuxButton } from '@/components/ui/aux-button';
import { Duration, PointerEvents, Radii, Rule, Space, Type, ZIndex, dropped } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

/** `danger` destroys something; `pri` proceeds with something. Nothing else. */
export type ConfirmDialogTone = 'danger' | 'pri';

export type ConfirmDialogProps = {
  visible: boolean;
  /** A question, ending in a question mark: "Sign out?". */
  title: string;
  /** One line saying what actually happens if they say yes. */
  message: string;
  /** Sentence case — `AuxButton` does not uppercase it, so "SIGN OUT" ships as a shout. */
  confirmLabel: string;
  cancelLabel?: string;
  tone?: ConfirmDialogTone;
  /** Spins the confirm action while the thing it started is in flight. */
  loading?: boolean;
  onConfirm: () => void;
  /** Also the scrim tap and the Android hardware back button. */
  onCancel: () => void;
};

/**
 * The sheet family's corner, borrowed. `Radii.xxl` is documented as the top of
 * a sheet, and a dialog is not a sheet — but it is the same class of floating
 * panel, and two floating-panel corners 6px apart is a disagreement the eye
 * catches the moment one opens on top of the other.
 */
const PANEL_RADIUS = Radii.xxl;

/** Narrow enough that the question reads as a question rather than a page. */
const PANEL_MAX_WIDTH = 380;

export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'danger',
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const C = useColors();
  const reduced = useReducedMotion();
  const pop = useSharedValue(0);

  /*
    Driven from an effect, never `entering={ZoomIn}`: a Reanimated layout
    animation marks the view hidden until it runs, and on react-native-web it
    never runs — the panel would be the right size in the right place and
    invisible forever. That failure has shipped in this repo before.
  */
  useEffect(() => {
    if (reduced) {
      pop.value = visible ? 1 : 0;
      return;
    }
    pop.value = withTiming(visible ? 1 : 0, {
      duration: visible ? Duration.enter : Duration.scrim,
    });
  }, [visible, reduced, pop]);

  /*
    Scale is safe on THIS view where it is not on a button: the panel is
    centred, floats over everything and has no neighbours to nudge, so nothing
    reflows as it settles.
  */
  const panelStyle = useAnimatedStyle(() => ({
    opacity: pop.value,
    transform: [{ scale: 0.96 + pop.value * 0.04 }],
  }));

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      // The Android hardware back button, which is the whole reason this prop
      // exists here: dismiss IS cancel, and a confirm that could be backed out
      // of into the destructive branch would not be a confirm at all.
      onRequestClose={onCancel}
      statusBarTranslucent>
      <View style={styles.fill}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          onPress={onCancel}
          style={[styles.scrim, { backgroundColor: C.scrim }]}
        />

        {/*
          `box-none`, so a tap in this view's own padding falls through to the
          scrim behind it. Without it the centring frame swallows every near
          miss and the dialog looks like it is ignoring taps.

          The scrim is a SIBLING of this view rather than its parent because
          Yoga measures absolute insets from the PADDING box: an `absoluteFill`
          inside a padded parent leaves the padding uncovered, which here would
          be an untinted strip down both edges of the screen.
        */}
        <View style={[styles.center, PointerEvents.boxNone]}>
          <Animated.View
            /*
              The focus trap. On iOS `accessibilityViewIsModal` hides every
              sibling view — the scrim included — from VoiceOver; on web
              `aria-modal` does the same for the page underneath. Android needs
              neither: RN's Modal is a real Dialog there and TalkBack is already
              confined to it.
            */
            accessibilityViewIsModal
            aria-modal
            style={[
              styles.panel,
              { backgroundColor: C.surfaceSolid, borderColor: C.chromeBorder },
              dropped(C, 'lg'),
              panelStyle,
            ]}>
            {/*
              The live region is on the COPY, not on the panel. On the panel it
              would re-announce the whole dialog — buttons and all — every time
              `loading` flipped the confirm action into a spinner. The title and
              the message never change while the dialog is open, so scoped here
              it fires once: when the question appears.
            */}
            <View accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.copy}>
              <Text accessibilityRole="header" style={[styles.title, { color: C.ink }]}>
                {title}
              </Text>
              <Text style={[styles.message, { color: C.ink2 }]}>{message}</Text>
            </View>

            <View style={styles.actions}>
              <AuxButton
                label={confirmLabel}
                variant={tone}
                size="lg"
                fullWidth
                loading={loading}
                onPress={onConfirm}
              />
              {/*
                Cancel stays live while the confirm action is in flight, and
                that is deliberate: it is the escape hatch, and a request that
                hangs would otherwise leave the user watching a spinner in a
                dialog with no way out. Dismissing cannot un-fire the action,
                but the caller reports the outcome with a toast regardless.
              */}
              <AuxButton label={cancelLabel} variant="ghost" fullWidth onPress={onCancel} />
            </View>
          </Animated.View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  scrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Space.xl,
    zIndex: ZIndex.modal,
  },
  panel: {
    width: '100%',
    maxWidth: PANEL_MAX_WIDTH,
    borderRadius: PANEL_RADIUS,
    borderWidth: Rule.hair,
    padding: Space.xxl,
    gap: Space.xl,
    /*
      No `overflow: 'hidden'`. Nothing here draws outside the panel, and Android
      throws a view's own boxShadow away along with whatever the clip removes —
      the clip would cost this panel the `dropped()` lift that makes it float.
    */
  },
  copy: {
    gap: Space.sm,
  },
  title: {
    // `Type.display` already carries the negative tracking a title wants; a
    // second `letterSpacing` here would fight it. 20 rather than the lounge
    // sheet confirm's 22, because this panel is 380 wide, not the full frame.
    ...Type.display(20),
  },
  message: {
    ...Type.body(14),
  },
  actions: {
    /*
      Stacked, not side by side. It matches the lounge sheet's confirm step, and
      a row would set a long destructive label and "Cancel" at two very
      different widths — which is how a Cancel ends up reading as the quiet one
      only by accident of how many letters it has.
    */
    gap: Space.sm,
  },
});
