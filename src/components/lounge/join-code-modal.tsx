/**
 * Redeeming an eight-character invite code.
 *
 * Drawn in the design's sheet chrome — `design/nocturne/aux-nocturne.dc.html`
 * L1163-L1167 for the shell and L327-L330 for the code entry itself. The
 * artboard has no join-by-code SHEET (it puts the field inline at the top of
 * Explore), so the chrome comes from the sheets it does draw and the contents
 * come from that inline block.
 *
 * THE SHEET FLOATS, and that is the shape change from the direction this file
 * was written for. It used to be a slab welded to the bottom of the frame:
 * square corners, full bleed, a 2px rule along its top edge and a flat `bg`
 * fill. L1163 is an OBJECT — inset from both sides, lifted clear of the bottom,
 * rounded on all four corners, blurred, and bordered the whole way around. Two
 * consequences, both load-bearing:
 *
 *   `sheetShadow()`, NOT `dropped()`. A sheet is lit by the page it covers, so
 *   its shadow falls UPWARD onto that page. `dropped()` throws it down past the
 *   bottom of the screen where nobody can see it, and the sheet loses its edge
 *   against whatever it is covering.
 *
 *   EVERY SURFACE INSIDE IT IS OPAQUE. This is the translucency hazard at its
 *   sharpest, because a modal floats over arbitrary content: `surface` is 5.5%
 *   white, and laid over a BlurView it has nothing solid to sit on and simply
 *   dissolves. The code well takes `bgRecessed`, which is a real colour.
 *
 * THE CODE PANEL IS NEUTRAL, NOT CORAL, and the two accents make that a
 * decision rather than a default. Coral says "this is happening"; blue says
 * "you do this". A code you are still typing is neither — it is not joinable
 * until it resolves, and it is not an action until you press Join. So the well
 * is ink in a recess and the JOIN button below it carries the blue. Compare the
 * invite sheet one screen over, where the code you already HAVE is drawn on a
 * coral plate: that code IS a joinable state, and it earns the colour.
 *
 * The panel is still the loudest readout in the app, and that is deliberate: a
 * community starts as eight characters somebody reads out over a room, so it
 * gets 30px extrabold, tabular figures and as much tracking as the well carries
 * — matched to the invite sheet's plate so the code you type and the code you
 * copy are set identically.
 */

import { BlurView } from 'expo-blur';
import { X } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AuxButton, CircleIconButton } from '@/components/ui';
import { loungeErrorMessage, useJoinByCode } from '@/features/lounges/queries';
import {
  Duration,
  PointerEvents,
  Radii,
  Rule,
  Sheet as SheetMetrics,
  Space,
  Type,
  ZIndex,
  pressedSoft,
  sheetShadow,
  tracking,
} from '@/lib/theme';
import { useColors, useTheme } from '@/lib/theme-context';

export type JoinCodeModalProps = {
  visible: boolean;
  onClose: () => void;
  /** Receives the joined lounge's id so the caller can navigate to it. */
  onJoined: (loungeId: string) => void;
};

/** `gen_random_bytes(6)` hex-encoded and truncated: eight uppercase characters. */
const CODE_LENGTH = 8;
/**
 * Matched to the invite sheet's plate in `src/app/(tabs)/lounge/[id].tsx`. The
 * two are the same eight characters at two moments in their life and must not
 * be set at two different sizes.
 */
const CODE_SIZE = 30;
const CODE_TRACKING = tracking(CODE_SIZE, 0.1);

/**
 * L1163 draws the sheet at 30, and `SheetMetrics.radius` is 28. The literal
 * wins here because this sheet has to agree with `InviteSheet` on the lounge
 * screen, which is also 30 — a 2px disagreement between two sheets the same
 * flow opens back to back is visible. The token wants to move to 30; this
 * constant disappears the day it does.
 */
const SHEET_RADIUS = 30;

/** `Type.readout` hands back a readonly fontVariant tuple; TextStyle wants a mutable one. */
const readout = (size: number): TextStyle => ({
  ...Type.readout(size),
  fontVariant: ['tabular-nums'],
});

export function JoinCodeModal({ visible, onClose, onJoined }: JoinCodeModalProps) {
  const C = useColors();
  const { scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const join = useJoinByCode();

  const reduced = useReducedMotion();
  const rise = useSharedValue(0);
  const dark = scheme === 'dark';

  useEffect(() => {
    if (reduced) {
      rise.value = visible ? 1 : 0;
      return;
    }
    rise.value = withTiming(visible ? 1 : 0, {
      duration: visible ? Duration.sheet : Duration.scrim,
    });
  }, [visible, reduced, rise]);

  const sheetStyle = useAnimatedStyle(() => ({
    opacity: rise.value,
    transform: [{ translateY: (1 - rise.value) * 16 }],
  }));

  /*
    Reopening should feel like a fresh attempt, not a retry of the last failure.
    Adjusted during render rather than in an effect: an effect would paint the
    stale code for one frame first, and React re-renders immediately here.
  */
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setCode('');
      setError(null);
    }
  }

  const handleChange = useCallback((value: string) => {
    // Codes are uppercase hex; normalising as the user types means a pasted
    // lowercase code from a chat app just works.
    setCode(
      value
        .replace(/[^a-zA-Z0-9]/g, '')
        .toUpperCase()
        .slice(0, CODE_LENGTH),
    );
    setError(null);
  }, []);

  const handleSubmit = useCallback(() => {
    setError(null);
    join.mutate(code, {
      onSuccess: (loungeId) => onJoined(loungeId),
      onError: (err) => setError(loungeErrorMessage(err, 'Could not join. Try again.')),
    });
  }, [code, join, onJoined]);

  /** The float: clear of the home indicator, and never flush on a device without one. */
  const lift = Math.max(insets.bottom, Space.md) + Space.md;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      // Wires up the Android hardware back button.
      onRequestClose={onClose}
      statusBarTranslucent>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.fill}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          onPress={onClose}
          style={[styles.scrim, { backgroundColor: C.scrim }]}
        />

        <View style={[styles.dock, PointerEvents.boxNone]}>
          {/*
            The shadow rides on this view, the blur clips inside it. Android
            throws away a view's own boxShadow along with whatever
            `overflow: 'hidden'` clips, so a single view would lose its lift on
            one platform only.

            No `maxHeight` here, unlike the sheets that do not raise a keyboard.
            Capping this one at 82% and then lifting it on top of the keyboard
            is how the JOIN button ends up clipped off the bottom on a short
            phone — the content is short enough that the cap has no other job.
          */}
          <Animated.View
            style={[styles.shell, { marginBottom: lift }, sheetShadow(C), sheetStyle]}>
            <BlurView
              intensity={dark ? 46 : 60}
              tint={dark ? 'dark' : 'light'}
              // Android does not blur at all without this; the tint alone would
              // leave a flat translucent slab with nothing happening behind it.
              experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
              style={[styles.glass, { borderColor: C.chromeBorder }]}>
              {/*
                The tint rides ON TOP of the blur rather than being handed to
                BlurView as a background: underneath, the tint becomes the thing
                being blurred and the whole sheet reads as fog. It is also the
                safety net — a Modal is its own window, so if a platform
                declines to blur what is behind it, this layer is still a
                near-opaque `nav` fill and the sheet stays a legible panel.
              */}
              <View style={[StyleSheet.absoluteFill, { backgroundColor: C.nav }]} />

              <View style={styles.grabberSlot}>
                <View style={[styles.grabber, { backgroundColor: C.rule3 }]} />
              </View>

              <View style={styles.head}>
                <View style={styles.headText}>
                  <Text style={[styles.title, { color: C.ink }]}>Join with a code</Text>
                  <Text style={[styles.kicker, { color: C.ink3 }]}>
                    EIGHT CHARACTERS · PUBLIC OR PRIVATE
                  </Text>
                </View>

                {/*
                  `chip` rather than `surface`: the design's close circle is the
                  9%-white fill (L1457), which is what this tone paints, and the
                  kit has no tone pairing that fill with a hairline. The missing
                  1px reads as nothing on glass — the fill alone is twice the
                  contrast a `surface` circle would have here.
                */}
                <CircleIconButton
                  icon={X}
                  tone="chip"
                  accessibilityLabel="Close"
                  onPress={onClose}
                />
              </View>

              <View style={styles.body}>
                {/*
                  The old inline "INVITE CODE" kicker is gone: the head above now
                  carries one of its own, and two kickers 60px apart in the same
                  sheet is exactly the noise the design's sheet heads exist to
                  avoid. The field keeps its `accessibilityLabel`, so nothing was
                  lost to a screen reader.
                */}
                <Text style={[styles.hint, { color: C.ink2 }]}>
                  Ask someone in the lounge for its invite code.
                </Text>

                {/*
                  A RECESS, not a plate. The design's code entry (L329) is
                  `--aux-bg2` behind a 1px rule — an opaque well the ink sits
                  down inside — and opaque is compulsory here anyway, because
                  this panel is mounted inside a BlurView.

                  The frame never changes width. A thicker focus ring would
                  shift the code by a pixel every time the field is touched.
                */}
                <View
                  style={[
                    styles.codePanel,
                    { backgroundColor: C.bgRecessed, borderColor: C.rule },
                    pressedSoft(C),
                  ]}>
                  <TextInput
                    value={code}
                    onChangeText={handleChange}
                    placeholder="A1B2C3D4"
                    placeholderTextColor={C.ink3}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    autoComplete="off"
                    maxLength={CODE_LENGTH}
                    // Blue, because a selection is something you are doing.
                    // Coral here would spend the state colour on a caret.
                    selectionColor={C.pill}
                    accessibilityLabel="Invite code"
                    style={[styles.codeInput, { color: C.ink }]}
                  />
                </View>

                {/* A polite live region is what actually announces the failure —
                    RN has no aria-invalid equivalent to hang it off. */}
                {error ? (
                  <View
                    accessibilityLiveRegion="polite"
                    style={[
                      styles.error,
                      { borderColor: C.dangerBorder, backgroundColor: C.dangerWash },
                    ]}>
                    <Text style={[styles.errorText, { color: C.danger }]}>{error}</Text>
                  </View>
                ) : null}

                {/*
                  `pri`, spelled out. The old `accent` alias still resolves here,
                  but it meant "the one reserved colour" back when the reserved
                  colour WAS the CTA colour; under two accents the name is a
                  trap and the button it names is blue.

                  Sentence case, not a shout: nocturne's CTA voice is extrabold
                  at +0.03em reading "Join", and `AuxButton` does not uppercase
                  it for you — a literal "JOIN" would render as one.
                */}
                <AuxButton
                  label="Join"
                  variant="pri"
                  size="lg"
                  fullWidth
                  onPress={handleSubmit}
                  loading={join.isPending}
                  disabled={code.length < CODE_LENGTH}
                />
                <AuxButton label="Cancel" variant="ghost" fullWidth onPress={onClose} />
              </View>
            </BlurView>
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
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
  dock: {
    flex: 1,
    justifyContent: 'flex-end',
    /* L1163's `margin:0 10px`. It lives on the PARENT rather than as a margin
       on the sheet, because the sheet is `width:'100%'` and a margin would put
       it 20px wider than the screen. */
    paddingHorizontal: Space.sm + 2,
    zIndex: ZIndex.modal,
  },
  /** Carries the shadow and the placement. The glass below carries the skin. */
  shell: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    borderRadius: SHEET_RADIUS,
  },
  glass: {
    borderRadius: SHEET_RADIUS,
    borderWidth: Rule.hair,
    // Without this the blur paints square corners behind the rounded border.
    overflow: 'hidden',
  },
  grabberSlot: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: Space.sm,
  },
  grabber: {
    width: SheetMetrics.grabberW,
    height: SheetMetrics.grabberH,
    borderRadius: Radii.pill,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Space.md,
    paddingHorizontal: Space.xl,
    paddingBottom: Space.md,
  },
  headText: {
    flex: 1,
    minWidth: 0,
    paddingTop: 2,
  },
  title: {
    ...Type.display(18),
    letterSpacing: tracking(18, -0.015),
  },
  /** Matches the kicker under every other sheet title in the app. */
  kicker: {
    ...Type.body(11),
    lineHeight: 14,
    letterSpacing: tracking(11, 0.04),
    marginTop: 3,
  },
  body: {
    paddingHorizontal: Space.lg,
    paddingBottom: Space.xxl,
    gap: Space.md,
  },
  hint: {
    ...Type.body(14),
  },
  codePanel: {
    borderWidth: Rule.hair,
    /*
      The design's fields are radius 14 (L529) at 48px tall. This well is 72,
      where 14 reads very nearly square, so it takes the house corner one step
      up. A full pill would turn a code block into a lozenge.
    */
    borderRadius: Radii.lg,
    paddingHorizontal: Space.lg,
    justifyContent: 'center',
    /*
      NO `overflow: 'hidden'` here, tempting as it is for the web focus ring:
      Android discards a view's own boxShadow along with whatever the clip
      removes, and the boxShadow on this view is the inset that makes it a
      recess at all. Clipping it would flatten the well on one platform only.
    */
  },
  codeInput: {
    ...readout(CODE_SIZE),
    letterSpacing: CODE_TRACKING,
    minHeight: 72,
    paddingVertical: Space.lg,
    textAlign: 'center',
    /*
      Tracking is applied after the LAST glyph too, so a centred string sits
      half a letter-space left of true centre. Pulling the box back by that
      amount re-centres it. (This replaces a negative right margin that flushed
      the code left against the old square frame.)
    */
    marginRight: -CODE_TRACKING,
  },
  error: {
    borderWidth: Rule.hair,
    // Square-cornered error blocks were the previous direction's signature.
    // Nothing in nocturne has a zero corner.
    borderRadius: Radii.md,
    padding: Space.md,
  },
  errorText: {
    ...Type.body(13),
  },
});
