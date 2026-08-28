/**
 * The onboarding kit.
 *
 * Sign in, Claim handle and Profile setup each carried their own copy of the
 * same field, the same tick and the same 56px button — three hand-rolled
 * `Field` components with three slightly different focus rules between them.
 * This is that set, once.
 *
 * Built from design/nocturne/aux-nocturne.dc.html: the field card (L122-125,
 * L161), the inset input pair (L193-196) and the gradient CTA with its disabled
 * twin (L127, L223-224). It is deliberately NOT in '@/components/ui': every
 * piece here is shaped by the signed-out flow (a 54px gradient pill, a kicker
 * that lives inside the field, a tick that only ever means "done"), and the kit
 * already has general-purpose answers for screens that want one.
 *
 * TWO CHANGES, BOTH REVERSING EARLIER DECISIONS IN THIS FILE:
 *
 * 1. `OnboardingSwitch` IS GONE. It existed for exactly one caller — the
 *    Sign in / Create account segmented control on `(auth)/sign-in` — and its
 *    own doc argued that stating both modes up front was better than hiding
 *    signup behind a link. The user has ruled otherwise: signing in and
 *    creating an account are now two screens, because they are two different
 *    things and one of them must never run the profile setup the other does.
 *    A segmented control that flips a form between those two is precisely the
 *    shape that made them look interchangeable. With the caller gone the
 *    component is dead code, and dead code in a shared kit is an invitation to
 *    put the switch back.
 * 2. A PASSWORD FIELD REVEALS ITSELF. `OnboardingField` grows an eye toggle
 *    whenever `secureTextEntry` is set, so every screen with a password gets
 *    it without opting in — see the field below.
 */

import { LinearGradient } from 'expo-linear-gradient';
import { Check, Eye, EyeOff } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

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

/**
 * The card field's own input box.
 *
 * The artboard's field card measures 58px tall, which assumes a browser's
 * automatic line box around a 16px input. React Native has no such thing: an
 * unsized `TextInput` is 20px on iOS and ~40px on Android, so the two platforms
 * would draw two different cards. Pinning the input at 28 makes the card 68
 * everywhere and, as a bonus, clears the 44px touch target on its own.
 */
const CARD_INPUT = 28;
/** The inset input inside a card — design L193, `min-height:42`. */
const INSET_HEIGHT = 42;
/** The bio well — design L196, `height:56`. */
const INSET_AREA_HEIGHT = 56;
const CTA_HEIGHT = 54;

/**
 * The password reveal button.
 *
 * The disc is 28 so the card variant's row stays exactly `CARD_INPUT` tall —
 * a taller button would make the password card 4px deeper than the email card
 * sitting 10px above it, which is visible in a stack of two. `hitSlop` takes
 * the TARGET to 44 without moving the layout, the same trick the claim screen's
 * back tile uses.
 */
const EYE = 28;
const EYE_HIT = (TOUCH_TARGET - EYE) / 2;
const EYE_GLYPH = 18;
/** The inset variant has room for the real thing, so it gets a real 44 box. */
const EYE_INSET = TOUCH_TARGET;

/**
 * The screen entrance.
 *
 * Driven by a shared value from an effect, NOT by `entering={FadeIn…}`.
 * Reanimated marks an entering view `visibility: hidden` until its animation
 * runs, and on react-native-web that animation never fires — which leaves a
 * screen that reports correct colour, size and layout while being completely
 * invisible. Both of the screens this replaced were written that way.
 *
 * An effect always runs, so this cannot fail the same way.
 */
export function useEnterStyle() {
  const reduced = useReducedMotion();
  const enter = useSharedValue(0);

  useEffect(() => {
    enter.value = reduced ? 1 : withTiming(1, { duration: Duration.enter });
  }, [reduced, enter]);

  return useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * 10 }],
  }));
}

/* -------------------------------------------------------------- brand rule */

/** The bar's height on both screens that draw it — design L112. */
const BRAND_RULE_HEIGHT = 4;

export type BrandRuleProps = {
  /** 64 on Intro, 52 under Sign in's smaller wordmark. */
  width: number;
  /** Margins only. The bar sits in a different slot on each screen. */
  style?: StyleProp<ViewStyle>;
};

/**
 * The short coral-to-blue bar under the wordmark.
 *
 * ONE IMPLEMENTATION, because there were two. Intro and Sign in each drew this
 * gradient inline, and each carried a comment calling itself "the one element
 * in the app that paints both accents" — neither knowing the other existed. The
 * claim was not a harmless flourish: read on its own it grants a licence, so
 * the next person who wanted coral and blue on one object would have found
 * written permission sitting next to a working example. Besides the two copies,
 * the 404 numeral in `src/app/+not-found.tsx` is a third two-accent element,
 * and `Wordmark`'s own peach-coral-blue ramp — the object this bar sits
 * directly underneath on both screens — is a fourth.
 *
 * The DEVICE is worth keeping, which is why this is a component and not a
 * deletion. The rule it looks like it breaks — coral is state, blue is action,
 * never both on one element — governs CONTROLS and BADGES; it is what stops a
 * Join button from claiming to be live. A bar that carries no meaning is
 * neither, and it belongs to the same typographic-artwork register as the mark
 * above it, where the two-accent ramp IS the brand. What could not stay is the
 * uniqueness: asserted three times, true none of them.
 */
export function BrandRule({ width, style }: BrandRuleProps) {
  const C = useColors();

  return (
    <LinearGradient
      colors={[C.live, C.pill]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
      style={[{ width, height: BRAND_RULE_HEIGHT, borderRadius: Radii.pill }, style]}
    />
  );
}

/* ------------------------------------------------------------------ header */

export type OnboardingHeaderProps = {
  /**
   * The tracked line above the title — "STEP 2 OF 2", "YOUR PROFILE".
   *
   * Optional because it has to be able to tell the truth: the claim screen is
   * step 2 of signup but is also reachable from Settings, where it is step
   * nothing, and a hardcoded counter would lie there.
   */
  kicker?: string;
  title: string;
  /** One line. If it does not tell the reader what to do next, cut it. */
  lede: string;
  /** 36 on the claim screen, 26 where a longer title has to fit. */
  size?: number;
};

export function OnboardingHeader({ kicker, title, lede, size = 30 }: OnboardingHeaderProps) {
  const C = useColors();

  return (
    <View>
      {kicker ? <Text style={[styles.kicker, { color: C.ink3 }]}>{kicker}</Text> : null}

      <Text
        accessibilityRole="header"
        style={[
          Type.display(size),
          {
            color: C.ink,
            lineHeight: Math.round(size * 1.1),
            letterSpacing: tracking(size, -0.03),
            marginTop: kicker ? Space.sm : 0,
          },
        ]}>
        {title}
      </Text>
      <Text style={[styles.lede, { color: C.ink2 }]}>{lede}</Text>
    </View>
  );
}

/* ------------------------------------------------------------------- field */

export type OnboardingFieldVariant =
  /**
   * The design's field CARD (L122-125): a translucent surface at radius 18 with
   * the kicker set inside it, above the input. The house field for a form that
   * sits directly on the app ground.
   */
  | 'card'
  /**
   * The inset input (L193-196): a `bgRecessed` well at radius 12. For fields
   * INSIDE a card — a `surface` field card nested in a `surface` card
   * composites to ~11% white and the inner one stops being a separate object,
   * so the recessed fill is not a style choice there, it is the only one that
   * reads.
   */
  | 'inset';

export type OnboardingFieldProps = {
  /** Rendered as the uppercase kicker, and as the a11y name. */
  label?: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  error?: string;
  variant?: OnboardingFieldVariant;
  /**
   * Masks the value AND puts an eye toggle in the field.
   *
   * The toggle is not opt-in. Every password in this app is typed on a phone
   * keyboard with no visible feedback, and a field you cannot check is a field
   * people get wrong twice; making it a second prop would just mean some
   * screens forget it.
   */
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences';
  autoComplete?: string;
  keyboardType?: KeyboardTypeOptions;
  maxLength?: number;
  multiline?: boolean;
  /** Required when there is no visible label. */
  accessibilityLabel?: string;
};

export function OnboardingField({
  label,
  value,
  onChangeText,
  placeholder,
  error,
  variant = 'card',
  secureTextEntry = false,
  autoCapitalize = 'sentences',
  autoComplete,
  keyboardType,
  maxLength,
  multiline = false,
  accessibilityLabel,
}: OnboardingFieldProps) {
  const C = useColors();

  /**
   * Focus is tracked so the field can answer when you touch it.
   *
   * DELIBERATE DEVIATION from the design, which draws these as inset wells with
   * a shadow pair. That recipe works in a static mock and fails at this size in
   * the running app: on a dark ground the light half of the pair sits at 3.2%
   * alpha, so all you actually see is the dark smudge, and the field reads as
   * dirty rather than recessed. A hairline gives the same containment cleanly,
   * and spending the feedback on FOCUS instead puts the emphasis where a form
   * needs it. Nocturne's own field card is a hairline too, so this deviation is
   * now only about the `inset` variant.
   */
  const [focused, setFocused] = useState(false);

  /**
   * Whether the password is currently legible.
   *
   * Local to the field and reset on unmount, which is the right lifetime: a
   * revealed password is a deliberate act for the next few seconds, never a
   * setting to remember.
   */
  const [revealed, setRevealed] = useState(false);
  const masked = secureTextEntry && !revealed;

  /**
   * Focus and failure must not paint the same edge.
   *
   * This read `error ? C.live : focused ? C.live : C.rule` — two branches, one
   * colour, so a field that failed validation looked exactly like a field being
   * typed into. That hid every error at the one moment it fires, since a field
   * is almost always focused when its own validation runs.
   *
   * Failure keeps the alarm; focus steps down to the brightest neutral rule and
   * keeps the accent ring below, which is enough to answer back without
   * claiming something is wrong.
   *
   * THE ALARM IS `danger`, NOT `live`. Splitting the two branches fixed the
   * collision but left failure painted in the coral that means live, playing,
   * in sync everywhere else — so this field reported "rejected" in the same hue
   * the Feed uses for "listening right now", and disagreed with the kit's own
   * `TextField`, which has used `danger` from the start. Two form fields in one
   * app cannot have two failure colours. An error is not a state of the world
   * to report; it is a failure, and failure is pink-red.
   */
  const edge = error ? C.danger : focused ? C.rule3 : C.rule;

  /*
    The ring is NEUTRAL on focus and red only on failure. It used to spend the
    accent on both, so an empty field you had simply tapped into looked exactly
    like a field that had been rejected — alarming, and on the very first screen
    of the app. Red is reserved here as everywhere else: it means something is
    wrong, not that the cursor is present.

    And it is now ACTUALLY red. This branch read `liveWash`, which is coral: the
    "red" the paragraph above promised was the live hue wearing the wrong name,
    which is exactly how a wrong colour survives a review. `dangerWash` is the
    token that means failure, and it is what `TextField` rings with.

    String form, not the array: this lands on a `TextInput` in the `inset`
    branch, and `TextStyle` types `boxShadow` as a string only.
  */
  const ring = error
    ? { boxShadow: `0 0 0 3px ${C.dangerWash}` }
    : focused
      ? { boxShadow: `0 0 0 3px ${C.ruleSoft}` }
      : null;

  /**
   * The card variant draws its border on the WRAPPER, so tapping the kicker or
   * the padding — most of the card's area — would otherwise do nothing. The ref
   * hands those taps to the input.
   */
  const input = useRef<TextInput>(null);

  const card = variant === 'card';

  const field = (
    <TextInput
      ref={input}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={C.ink3}
      secureTextEntry={masked}
      autoCapitalize={autoCapitalize}
      /*
        Keyed off the PROP, not off `masked`, and that is load-bearing rather
        than tidy: Android's keyboard reattaches when `secureTextEntry` flips,
        and if autocorrect switches on at the same moment it can swallow the
        text already in the field. A password never wants autocorrect anyway,
        revealed or not.
      */
      autoCorrect={!secureTextEntry}
      keyboardType={keyboardType}
      maxLength={maxLength}
      multiline={multiline}
      textAlignVertical={multiline ? 'top' : 'center'}
      // The public prop is a plain string so callers need no RN types; RN
      // wants its own union.
      autoComplete={autoComplete as TextInputProps['autoComplete']}
      accessibilityLabel={accessibilityLabel ?? label}
      // Blue. Selecting text is something you DO, so it takes the action accent
      // like every other interaction in the app. This was `live`, which spent
      // the "playing right now" coral on the drag handles of an email field.
      // `TextField` has always set the caret this way.
      selectionColor={C.pill}
      style={
        card
          ? [
              styles.cardInput,
              { color: C.ink },
              multiline ? styles.cardArea : null,
              // Shares the row with the eye, so it has to be allowed to shrink.
              secureTextEntry ? styles.cardInputShared : null,
            ]
          : [
              multiline ? styles.insetArea : styles.inset,
              { backgroundColor: C.bgRecessed, color: C.ink, borderColor: edge },
              // The eye floats over the right end of the well; without the
              // reserved gutter a long password types straight under it.
              secureTextEntry ? styles.insetShared : null,
              ring,
            ]
      }
    />
  );

  /**
   * Show / hide.
   *
   * A REAL BUTTON, not a glyph with a tap handler: it announces itself as a
   * button, its name changes with what pressing it will do, and it reports the
   * current state so a screen reader is not left guessing. It also does not
   * submit anything — the only submit path in this flow is `PrimaryCta`, and
   * `onSubmitEditing` is not wired on these inputs.
   *
   * The card variant nests this inside the card's own focus-the-input
   * Pressable, and the two platforms resolve that differently on purpose. On
   * native the inner control captures the touch and the outer never fires,
   * which is right — the keyboard stays up because both screens set
   * `keyboardShouldPersistTaps="handled"`. On web the click also bubbles to the
   * card, whose handler puts the caret back in the input after the button has
   * taken DOM focus. Either way the peek does not cost you your place.
   */
  const reveal = secureTextEntry ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={revealed ? 'Hide password' : 'Show password'}
      accessibilityState={{ selected: revealed }}
      hitSlop={card ? EYE_HIT : 0}
      onPress={() => setRevealed((current) => !current)}
      style={({ pressed }) => [
        card ? styles.eye : styles.eyeInset,
        pressed ? styles.held : null,
      ]}>
      {revealed ? (
        <EyeOff size={EYE_GLYPH} strokeWidth={2} color={C.ink2} />
      ) : (
        <Eye size={EYE_GLYPH} strokeWidth={2} color={C.ink3} />
      )}
    </Pressable>
  ) : null;

  const message = error ? (
    // `danger`, matching the edge and the ring above and the kit's `TextField`.
    // It was `liveText`, which put the sentence explaining a rejection in the
    // hue that elsewhere means the thing being described is live.
    <Text accessibilityLiveRegion="polite" style={[styles.error, { color: C.danger }]}>
      {error}
    </Text>
  ) : null;

  if (card) {
    return (
      <View>
        {/* `accessible={false}` so this stays a tap target and does NOT become
            a second a11y node in front of the input it focuses. */}
        <Pressable
          accessible={false}
          onPress={() => input.current?.focus()}
          style={[styles.card, { backgroundColor: C.surface, borderColor: edge }, ring]}>
          {label ? <Text style={[styles.cardKicker, { color: C.ink3 }]}>{label}</Text> : null}
          {reveal ? (
            <View style={styles.cardRow}>
              {field}
              {reveal}
            </View>
          ) : (
            field
          )}
        </Pressable>
        {message}
      </View>
    );
  }

  return (
    <View>
      {label ? <Text style={[styles.kicker, { color: C.ink3 }]}>{label}</Text> : null}
      {reveal ? (
        <View>
          {field}
          {reveal}
        </View>
      ) : (
        field
      )}
      {message}
    </View>
  );
}

/* -------------------------------------------------------------------- tick */

/**
 * Done.
 *
 * CORAL, not blue, and that is the accent rule rather than a preference: blue
 * says "you do this" and a tick is not something you do — it reports that a
 * thing is now true, which is exactly what coral is reserved for. `onLive` is
 * the warm near-black the palette keeps for ink on a coral fill; white on coral
 * fails.
 *
 * `ring` punches the disc out of whatever it sits on, the same way the avatar's
 * presence dot does — necessary when it lands on the identity gradient, where a
 * coral disc on coral has no edge of its own.
 *
 * Decorative on purpose: every caller already reports the same fact through
 * `accessibilityState` on the row that owns it, and a second announcement
 * reads as two separate things being true.
 */
export function Done({ size = 24, ring = false }: { size?: number; ring?: boolean }) {
  const C = useColors();

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[
        styles.done,
        {
          width: size,
          height: size,
          backgroundColor: C.live,
          borderWidth: ring ? 2 : 0,
          borderColor: ring ? C.bg : 'transparent',
        },
      ]}>
      <Check size={Math.round(size * 0.5)} strokeWidth={3} color={C.onLive} />
    </View>
  );
}

/* ----------------------------------------------------------------- buttons */

export type PrimaryCtaProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  /**
   * What the button says while it is blocked.
   *
   * The design gives the disabled CTA its own copy — "Link YouTube, Spotify or
   * Apple Music" where the enabled one says "Save profile & enter Aux" — so the
   * button states the unmet condition instead of leaving the reader to guess
   * why it will not move. Falls back to `label` when a screen has nothing more
   * useful to say.
   */
  disabledLabel?: string;
  /** 13px instead of 14 — for the one label long enough to need it. */
  compact?: boolean;
  /** When the visible label is shorter than the action. */
  accessibilityLabel?: string;
};

/**
 * The one filled button per screen.
 *
 * A 54px PILL, gradient-filled top-to-bottom, sitting on a blue glow rather than
 * a grey drop shadow. It replaces a flat `pill` rectangle at radius 16 on a
 * neutral shadow, and the three changes work together: the glow is the same
 * colour as the fill, so the button reads as lit rather than as raised, and a
 * fully-round end is what stops that glow from looking like a smudge under a
 * corner.
 *
 * This is the ONLY blue fill on most screens, which is the whole point — blue
 * is reserved for the action you are being asked to take.
 *
 * DISABLED IS A DIFFERENT OBJECT, not the same one at 55% (design L224): a
 * surface pill with a hairline and `ink3` copy. A dimmed gradient still reads
 * as the loudest thing on the screen, which is precisely wrong for the one
 * control that cannot be used yet. Loading keeps the gradient — busy is not
 * blocked.
 */
export function PrimaryCta({
  label,
  onPress,
  disabled = false,
  loading = false,
  disabledLabel,
  compact = false,
  accessibilityLabel,
}: PrimaryCtaProps) {
  const C = useColors();
  const blocked = disabled || loading;
  const flat = disabled && !loading;
  const shown = flat ? (disabledLabel ?? label) : label;

  const text = (
    <Text
      numberOfLines={1}
      style={[
        compact ? styles.ctaLabelCompact : styles.ctaLabel,
        { color: flat ? C.ink3 : C.pillInk },
      ]}>
      {shown}
    </Text>
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? shown}
      accessibilityState={{ disabled: blocked, busy: loading }}
      disabled={blocked}
      onPress={onPress}
      style={({ pressed }) => [
        flat ? styles.blocked : null,
        pressed && !blocked ? styles.held : null,
      ]}>
      {flat ? (
        <View style={[styles.cta, styles.ctaFlat, { backgroundColor: C.surface, borderColor: C.rule }]}>
          {text}
        </View>
      ) : (
        <LinearGradient
          colors={[C.priTint, C.pill]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={[
            styles.cta,
            { boxShadow: [{ offsetX: 0, offsetY: 10, blurRadius: 26, color: C.glow }] },
          ]}>
          {loading ? <ActivityIndicator size="small" color={C.pillInk} /> : text}
        </LinearGradient>
      )}
    </Pressable>
  );
}

export type SecondaryCtaProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** When the visible label is shorter than the action. */
  accessibilityLabel?: string;
};

/**
 * The other real action on the screen.
 *
 * Sign in has two things a person might have come to do, and only one of them
 * can wear the gradient — "one filled thing per screen" is what makes the
 * filled thing mean anything. So this is the same 54px pill drawn as a surface
 * with a hairline, and the only accent it spends is on its LABEL.
 *
 * That label is BLUE, and that is the accent rule read exactly: creating an
 * account is the canonical blue act. It is deliberately not a text link either
 * — the previous sign-in screen buried "Create account" in one, which made the
 * second of the two things people come here to do the quietest object on the
 * page. A bordered pill is quieter than the gradient and louder than prose,
 * which is precisely the rank it should hold.
 */
export function SecondaryCta({
  label,
  onPress,
  disabled = false,
  accessibilityLabel,
}: SecondaryCtaProps) {
  const C = useColors();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.cta,
        styles.ctaFlat,
        { backgroundColor: pressed ? C.surface2 : C.surface, borderColor: C.rule },
        disabled ? styles.blocked : null,
      ]}>
      <Text numberOfLines={1} style={[styles.ctaLabel, { color: C.pill }]}>
        {label}
      </Text>
    </Pressable>
  );
}

export type SecondaryLinkProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
};

/** The quiet way out, under the button. Text only — it is not a second action. */
export function SecondaryLink({ label, onPress, disabled = false }: SecondaryLinkProps) {
  const C = useColors();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.secondary, pressed ? styles.held : null]}>
      <Text style={[styles.secondaryLabel, { color: C.ink2 }]}>{label}</Text>
    </Pressable>
  );
}

/* ----------------------------------------------------------------- styles */

const styles = StyleSheet.create({
  lede: {
    ...Type.body(14),
    lineHeight: 20,
    marginTop: Space.sm,
  },

  /*
    The design sets its kickers at 8-10px/800. 10 is the floor here: `ink3` only
    just clears AA, and below 10 a tracked uppercase run on a dark ground stops
    resolving as letters at arm's length. Raise with the designer rather than
    silently shrinking to match the artboard.
  */
  kicker: {
    ...Type.label(10),
    fontFamily: Fonts.extrabold,
    letterSpacing: tracking(10, 0.13),
    marginBottom: 9,
  },

  card: {
    borderRadius: Radii.lg,
    borderWidth: Rule.hair,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
  },
  cardKicker: {
    ...Type.label(9.5),
    fontFamily: Fonts.extrabold,
    letterSpacing: tracking(9.5, 0.13),
  },
  cardInput: {
    height: CARD_INPUT,
    marginTop: Space.xs,
    paddingVertical: 0,
    paddingHorizontal: 0,
    fontFamily: Fonts.regular,
    fontSize: 16,
  },
  cardArea: {
    height: INSET_AREA_HEIGHT,
    lineHeight: 20,
  },
  /** The input and the eye, sharing the card's one content row. */
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  cardInputShared: {
    flex: 1,
    // Without this a long value refuses to shrink and pushes the eye out past
    // the card's right edge, where the card's own radius clips it.
    minWidth: 0,
  },

  inset: {
    height: INSET_HEIGHT,
    borderRadius: Radii.sm,
    borderWidth: Rule.hair,
    paddingHorizontal: Space.md,
    paddingVertical: 0,
    fontFamily: Fonts.regular,
    fontSize: 15,
  },
  insetArea: {
    height: INSET_AREA_HEIGHT,
    borderRadius: Radii.sm,
    borderWidth: Rule.hair,
    paddingHorizontal: Space.md,
    paddingVertical: 10,
    fontFamily: Fonts.regular,
    fontSize: 14,
    lineHeight: 19,
  },
  insetShared: {
    paddingRight: EYE_INSET,
  },
  error: {
    ...Type.body(12.5),
    marginTop: Space.sm,
  },

  eye: {
    width: EYE,
    height: EYE,
    flexShrink: 0,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyeInset: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: EYE_INSET,
    alignItems: 'center',
    justifyContent: 'center',
  },

  done: {
    flexShrink: 0,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },

  cta: {
    minHeight: CTA_HEIGHT,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaFlat: {
    borderWidth: Rule.hair,
  },
  /*
    Heavier and WIDER-TRACKED than the label it replaces, which ran semibold at
    -0.005em. A button label in this design is set like a small caps kicker
    rather than like a sentence — that is what keeps a 14px word from looking
    lost inside a 54px pill.
  */
  ctaLabel: {
    fontFamily: Fonts.extrabold,
    fontSize: 14,
    letterSpacing: tracking(14, 0.03),
  },
  ctaLabelCompact: {
    fontFamily: Fonts.extrabold,
    fontSize: 13,
    letterSpacing: tracking(13, 0.03),
  },
  /** The design's disabled state everywhere: the live cell, dimmed. */
  blocked: {
    opacity: 0.6,
  },
  held: {
    opacity: 0.9,
  },

  secondary: {
    minHeight: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryLabel: {
    fontFamily: Fonts.semibold,
    fontSize: 12,
    letterSpacing: tracking(12, 0.06),
  },
});
