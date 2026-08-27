/**
 * The bottom navigation.
 *
 * A floating capsule: inset 16px from each side, hovering 42px clear of the
 * bottom, 68px tall, fully rounded, bordered all the way around, and blurred
 * over whatever scrolls beneath it.
 *
 * Built from design/nocturne/aux-nocturne.dc.html L878-889.
 *
 * REPLACES a full-width 88px bar that sat flush against the bottom and both
 * sides with a hairline along its top edge. That version was rejected for
 * looking like a bar, and it is worth being precise about why, because the
 * icons inside barely changed:
 *
 *   - a shape pinned to three edges reads as part of the window frame; the same
 *     shape with air on all four sides reads as an object resting on the app
 *   - a rule along the top edge ONLY is the universal signal for a bar. A
 *     border that closes all the way around says card instead
 *   - a bar is opaque because nothing passes behind it. This is translucent and
 *     blurred, so content visibly slides under it and it stops being structural
 *   - nothing floats without a shadow, and the old bar had none
 *
 * It also carries five slots where the old one had four, and the change is not
 * cosmetic:
 *
 *   - CREATE takes the centre slot. It used to exist only inside the Feed's
 *     empty state, which meant the app's primary verb disappeared the moment
 *     you had any content. It arrived here as a lifted, gradient-filled circle;
 *     it is a flat cell like the other four now, and `CreateButton` says why
 *   - DIRECT MESSAGES get a permanent slot and the unread badge with it. They
 *     were reachable only from a header icon on one screen
 *   - LOUNGES lose their slot. They are not orphaned: the Feed carries a
 *     horizontal lounge row, which is where the design surfaces them, and the
 *     route stays registered for deep links
 *
 * ---------------------------------------------------------------------------
 * ANDROID BLURS NOTHING UNTIL SOMETHING PASSES `blurTarget`, AND THIS IS NOT A
 * TUNING PROBLEM.
 *
 * expo-blur 57 rebuilt the Android path: `BlurView` no longer samples the window
 * on its own, it blurs a `BlurTargetView` that is handed to it by ref. Without
 * one the native side calls `blurView.setBlurEnabled(false)` and paints a flat
 * `setBackgroundColor(tint)` instead — no blur at any intensity — and the
 * library logs it on mount:
 *
 *   "You have selected the "dimezisBlurView" blur method, but the `blurTarget`
 *    prop has not been configured. The blur view will fallback to "none"…"
 *
 * That is the real answer to "the nav bar is clearly using glass ui right so i
 * want a little blurring effect on this": on the device there has been no blur
 * to see, only `C.nav` at 72% over sharp content.
 *
 * The wiring cannot live in this file — the target has to WRAP the content being
 * blurred, which is the shell in `src/app/(tabs)/_layout.tsx`. This component
 * takes the ref as an optional prop and degrades honestly without it (see
 * `blurred` below), so lighting it up is three lines there:
 *
 *   const target = useRef<View | null>(null);
 *   <BlurTargetView ref={target} style={styles.shell}>  …AmbientGround + Tabs…
 *   tabBar={(props) => <NavBar {...props} blurTarget={target} />}
 */

import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Compass, House, MessageCircle, Plus, User, type LucideIcon } from 'lucide-react-native';
import { memo, useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from 'expo-router/js-tabs';

import { useTotalUnread } from '@/features/dm';
import { Dock, Fonts, Radii, Rule, ZIndex, bloom, floating, tracking } from '@/lib/theme';
import { SETTLE, usePressFeedback } from '@/lib/entrance';
import { useMotionMode } from '@/lib/motion';
import { useColors, useTheme } from '@/lib/theme-context';

/**
 * The four NAV slots, left to right, skipping the centre button.
 *
 * The mark indexes into this, so it is the one place the bar's order is stated.
 * Create is absent on purpose: it is an action, it is never "where you are",
 * and a selection mark that could land on it would say otherwise.
 */
/**
 * A `Pressable` that can take an animated style.
 *
 * `Animated.createAnimatedComponent` rather than wrapping the Pressable in an
 * `Animated.View`: a wrapper would scale the touch target along with the
 * visuals, so the hit area would shrink under the finger that is already on it.
 */
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const ORDER = ['index', 'explore', 'messages', 'profile'] as const;

/** The two declared tabs that sit left of the centre action. */
const LEFT: { name: string; icon: LucideIcon; label: string }[] = [
  { name: 'index', icon: House, label: 'Feed' },
  { name: 'explore', icon: Compass, label: 'Explore' },
];

type GlassSpec = {
  /** Blur strength per scheme, in whatever `intensity` means on this platform. */
  readonly dark: number;
  readonly light: number;
  /** How much of `C.nav` to actually paint over the blurred image, 0-1. */
  readonly tint: number;
};

/**
 * THE MATERIAL, and it is per-platform because `intensity` means three
 * different things inside expo-blur 57. Read out of the package rather than
 * guessed at:
 *
 *   web      `backdrop-filter: saturate(180%) blur(intensity * 0.2px)` PLUS a
 *            background of the library's own at `intensity/100 * 0.78`. Turning
 *            the blur up here also turns the transparency DOWN, so the two have
 *            to be traded against each other.
 *   ios      `UIViewPropertyAnimator.fractionComplete = intensity/100` over a
 *            system `UIBlurEffect`. Blur strength and nothing else — the frost
 *            it adds is the material's, not a fill we control.
 *   android  `BlurView.setBlurRadius(intensity / 4)` plus an overlay at
 *            `intensity/100 * 0.69`. The same trade as web at a different rate,
 *            and only once a `blurTarget` exists at all — see the header.
 *
 * `tint` is the local correction the brief asked for. `C.nav` STAYS at .72 in
 * the palette: it is the design's `--chrome`, and the mini-player, the toast
 * and the sheets all need it at full strength. But .72 painted over a blur
 * leaves 28% of the blurred image showing, which is a flat slab with a rumour
 * of glass behind it. Multiplying the token down locally is what makes the blur
 * visible, and it keeps the colour resolving through the palette in both themes.
 *
 * THE FLOOR IS ICON CONTRAST, AND IT WAS MEASURED, NOT EYEBALLED. The worst
 * thing that can slide under the capsule is a saturated pill. Against coral
 * #ff4a2e with no blur mixing at all, an inactive `ink3` icon holds 3.20:1 at a
 * total tint of .62 and falls to 2.78:1 at .55; light mode's mirror case — an
 * inactive icon over a #2f5fe0 pill under white glass — turns at .62 too. Every
 * combination below composites to AT LEAST .62 once the library's own layer is
 * counted, so the non-text 3:1 minimum holds even in the case where the blur
 * contributes nothing.
 */
const GLASS: GlassSpec = Platform.select({
  // The material does the work here, so the tint barely moves: .72 * .72 = .52
  // of our own, and the system frost sits under it.
  ios: { dark: 70, light: 82, tint: 0.72 },
  // 55/4 ≈ 14px of real blur radius; the overlay adds .38, ours adds .43.
  android: { dark: 55, light: 65, tint: 0.6 },
  // 14px of backdrop blur (it was 8px) and .55 of library fill, so ours only
  // has to carry .25 to clear the floor — and the hue still comes from `C.nav`.
  default: { dark: 70, light: 70, tint: 0.35 },
});

/**
 * What to ask for when the blur is going to be refused (Android, no target).
 *
 * There `intensity` only sets a flat overlay's alpha and `tint` has nothing to
 * be translucent ONTO, so the tuning above would paint a darker slab and thin
 * the one layer holding the icons up. These are the numbers the bar has always
 * shipped with: unchanged appearance, and no pretending.
 */
const NO_BLUR: GlassSpec = { dark: 40, light: 60, tint: 1 };

export type NavBarProps = BottomTabBarProps & {
  /**
   * The `BlurTargetView` Android should blur as this capsule's backdrop —
   * expo-blur 57 does nothing without it. Optional because only the tabs shell
   * can supply it; see the header for the wiring.
   */
  blurTarget?: RefObject<View | null>;
};

export function NavBar({ state, navigation, blurTarget }: NavBarProps) {
  const C = useColors();
  const { scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const unread = useTotalUnread();
  const reduced = useReducedMotion();
  const mode = useMotionMode();

  const dark = scheme === 'dark';
  /*
    Is there going to be a real blur behind this glass? iOS and web always
    blur; Android only with a target. When there is none, the capsule keeps the
    FULL `C.nav` — a thin tint over sharp, unblurred content is not glass, it is
    a bar you can read the feed through.
  */
  const blurred = Platform.OS !== 'android' || blurTarget != null;
  const glass = blurred ? GLASS : NO_BLUR;

  const current = state.routes[state.index]?.name ?? '';

  /**
   * ONE MARK FOR THE WHOLE BAR, WHICH SLIDES.
   *
   * Each cell used to draw its own underline and cross-fade it, so changing tab
   * meant one mark dying while another was born two cells away — two events the
   * eye has to connect for itself. A single mark that TRAVELS is the same
   * information carried by one continuous object, and it is the detail that
   * separates a tab bar that feels built from one that feels assembled.
   *
   * Positions are MEASURED rather than computed. The arithmetic is knowable —
   * five known widths under `space-between` inside a known padding — but it
   * would silently break the first time a label gets longer, a cell is added,
   * or a font scales, and a selection mark landing between two tabs is worse
   * than one that fades. `onLayout` cannot be wrong about where a thing is.
   */
  const cellX = useRef<number[]>([]);
  const [measured, setMeasured] = useState(0);
  const markX = useSharedValue(0);
  const markReady = useSharedValue(0);

  const activeIndex = ORDER.findIndex((name) =>
    name === 'messages' ? current.startsWith('messages') : current === name,
  );

  const measureCell = useCallback((slot: number, x: number, width: number) => {
    const centre = x + width / 2;
    if (cellX.current[slot] === centre) return;
    cellX.current[slot] = centre;
    // Re-run the placement effect. A counter rather than the array itself,
    // because mutating a ref does not re-render and the effect has to be told.
    setMeasured((n) => n + 1);
  }, []);

  useEffect(() => {
    const centre = activeIndex >= 0 ? cellX.current[activeIndex] : undefined;
    if (centre === undefined) return;

    const target = centre - Dock.underline / 2;

    if (markReady.value === 0) {
      // FIRST PLACEMENT IS INSTANT. Springing from x=0 on mount would send the
      // mark skating across the bar every cold start, announcing a tab change
      // that never happened.
      markX.value = target;
      markReady.value = 1;
      return;
    }
    markX.value = reduced || mode === 'classic' ? target : withSpring(target, SETTLE);
  }, [activeIndex, measured, reduced, mode, markX, markReady]);

  const markStyle = useAnimatedStyle(() => ({
    opacity: markReady.value,
    transform: [{ translateX: markX.value }],
  }));

  const goTab = (name: string) => {
    const index = state.routes.findIndex((r) => r.name === name);
    if (index === -1) return;
    const route = state.routes[index];
    const event = navigation.emit({
      type: 'tabPress',
      target: route.key,
      canPreventDefault: true,
    });
    if (state.index !== index && !event.defaultPrevented) {
      navigation.navigate(route.name, route.params);
    }
  };

  return (
    <View
      // Load-bearing: this layer spans the full width, so without it the
      // transparent margin either side of the capsule would swallow every tap
      // along the bottom of every screen. A full-bleed overlay in this app has
      // already caused exactly that once.
      pointerEvents="box-none"
      style={[styles.layer, { bottom: Dock.bottom + insets.bottom }]}>
      <BlurView
        intensity={dark ? glass.dark : glass.light}
        tint={dark ? 'dark' : 'light'}
        // `blurMethod`, not `experimentalBlurMethod` — the latter is deprecated
        // in expo-blur 57 and console.warns on every mount. Asked for only when
        // a target exists, because requesting it without one warns as well and
        // then silently falls back to exactly what 'none' does anyway.
        blurMethod={blurred && Platform.OS === 'android' ? 'dimezisBlurView' : 'none'}
        blurTarget={blurTarget}
        style={[styles.capsule, { borderColor: C.chromeBorder }, floating(C)]}>
        {/*
          The tint rides ON TOP of the blur rather than being handed to BlurView
          as a background, because the blur is what the glass is and the colour
          only warms it. Underneath, the tint becomes the thing being blurred
          and the whole capsule reads as fog.

          `opacity` rather than a second, paler colour: it multiplies the token
          down without inventing one, so light mode still gets its own
          `C.nav` — near-white at .78 — and the correction travels with it.
        */}
        <View style={[styles.tint, { backgroundColor: C.nav, opacity: glass.tint }]} />

        {/*
          Above the tint, below the cells: it is a mark ON the glass, and a cell
          that overlapped it would be a cell floating over its own indicator.
        */}
        <Animated.View
          pointerEvents="none"
          style={[styles.mark, markStyle, { backgroundColor: C.pill }]}
        />

        {LEFT.map((cell, slot) => (
          <NavCell
            key={cell.name}
            slot={slot}
            onMeasure={measureCell}
            icon={cell.icon}
            label={cell.label}
            focused={current === cell.name}
            onPress={() => goTab(cell.name)}
          />
        ))}

        {/*
          THE BUTTON ITSELF, back in the row where the design puts it
          (aux-nocturne.dc.html L881 is a child of this flex container too).

          It used to be an absolutely-positioned sibling of this BlurView with a
          same-width `fabSlot` hole standing in for it here, because the lifted
          circle's cap was being sliced off by the capsule's `overflow: 'hidden'`.
          Nothing lifts any more, so the hole reserved space for a thing that is
          now the thing itself and the sibling was a second element to keep
          aligned with the row it was already sitting inside. Both are gone.

          Five equal 48px cells under `space-between`: the centre one lands on
          the capsule's centre line by symmetry, with no measured offset to
          drift. The row also gets 4px back — the old slot was 52 wide — which
          is 1px of extra air in each of the four gaps at every screen width.
        */}
        <CreateButton />

        <NavCell
          slot={2}
          onMeasure={measureCell}
          icon={MessageCircle}
          label="Messages"
          focused={current.startsWith('messages')}
          badge={unread}
          onPress={() => router.push('/messages')}
        />
        <NavCell
          slot={3}
          onMeasure={measureCell}
          icon={User}
          label="You"
          focused={current === 'profile'}
          onPress={() => goTab('profile')}
        />
      </BlurView>
    </View>
  );
}

/* ------------------------------------------------------------------- cells */

type CellProps = {
  icon: LucideIcon;
  label: string;
  focused: boolean;
  badge?: number;
  onPress: () => void;
  /** Where this cell sits in `ORDER`, so the shared mark can find it. */
  slot: number;
  /** Reports this cell's measured centre to the bar that owns the mark. */
  onMeasure: (slot: number, x: number, width: number) => void;
};

const NavCell = memo(function NavCell({
  icon: Icon,
  label,
  focused,
  badge = 0,
  onPress,
  slot,
  onMeasure,
}: CellProps) {
  const C = useColors();
  const press = usePressFeedback(0.9);

  /*
    SELECTION IS A PILL BEHIND THE GLYPH, AND THIS FILE USED TO ARGUE AGAINST
    ONE. The comment that stood here read:

      "Selection is carried by ink weight alone — no tile, no pill, no
       underline. On glass that is enough, and it is the one place this design
       is quieter than the bar it replaces: a filled selection chip inside a
       translucent capsule reads as a second piece of chrome floating inside the
       first."

    It was faithful to the design — the nav at aux-nocturne.dc.html L878-889 is
    icons-only and marks the current tab with `navFeedFg` and nothing else — and
    on a phone it does not work. The note back was that you cannot tell which
    module you are on. `ink` against `ink3` is two greys a step apart; at that
    distance a grey icon turning a lighter grey does not read as a selection, it
    reads as a rendering difference.

    THE CREATE BUTTON GOING QUIET DOES NOT RETIRE THIS, and the wording that
    stood here invited exactly that reading — it pinned the failure on "a
    saturated gradient circle standing proud of the middle of it" drowning out
    the ink change. That circle is gone (see `CreateButton`) and the two greys
    are still two greys, on glass that is still moving. The centre cell also
    still carries the row's only saturated colour, so the strongest thing in the
    bar is STILL not the current tab. Only the first clause of the argument was
    ever about the FAB; the rest of it is about the ink.

    Going past the design here is therefore deliberate, and the constraints on
    the extra thing are tight:
      - NOT blue, or anything on the primary ramp. Blue is CREATE and CONTROL,
        and this control neither creates nor controls — it reports where you
        already are. That constraint got STRICTER when the FAB went flat: blue
        is now the create cell's only remaining distinction, so a blue marker
        two cells away would spend the one signal holding the app's primary
        verb apart from four destinations.
      - NOT coral. Coral is state-of-the-world: live, playing, unread. Your own
        location in your own app is not an event happening to you, and the
        unread badge one cell over has to stay the only warm thing in the bar.
      - NOT a disc. A circle fills the round cell edge to edge and makes the
        selection the heaviest object in the bar; see `ACTIVE`. It was also the
        FAB's own silhouette when the FAB had one.

    Which leaves a NEUTRAL pill, wider than tall — no accent to compete with,
    and a shape that cannot be confused with the round button beside it.

    `surface3` is the fill because it is the only token that moves the right way
    in BOTH themes: white at 13% in dark, ink at 9% in light, so it lightens
    dark glass and darkens light glass instead of picking one and inverting in
    the other. That is the deliberate exception to the usual rule that a fill
    inside a BlurView must be `surfaceSolid` — an opaque patch would have to
    guess what the glass composited to and would be wrong on one theme or the
    other, and the guess is unnecessary here because this never sits on raw
    blur: the `tint` layer is always painted underneath it. `rule2` closes the
    edge so the pill survives a bright pill scrolling under the capsule.

    The two other candidates: a dot beneath the glyph is ~4px of signal against
    a 52px circle and loses the same argument the ink weight just lost; a label
    that appears only when selected puts 9px text on moving glass inside a 48px
    cell. Both were weaker for the same reason.

    Selection SNAPS, matching `Chip` — an SVG stroke colour cannot be driven
    from the UI thread, so a crossfade would ease the pill while the glyph
    jumped. The ink and stroke-weight change stays: it is now the second cue
    rather than the only one, and it is what the pill's own contrast rests on.
  */
  const ink = focused ? C.ink : C.ink3;


  return (
    <AnimatedPressable
      accessibilityRole="tab"
      // Unchanged, and load-bearing: a screen reader has always announced this
      // correctly. Everything above is about making the eye agree with it.
      accessibilityState={{ selected: focused }}
      accessibilityLabel={badge > 0 ? label + ', ' + badge + ' unread' : label}
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      onLayout={(e) => onMeasure(slot, e.nativeEvent.layout.x, e.nativeEvent.layout.width)}
      // 0.9 rather than the 0.96 default: a 56px cell needs a deeper push than
      // a full-width card before the same amount of movement is legible.
      style={[styles.cell, press.style]}>
      {/*
        First in the tree, so the glyph and the badge both paint on top of it.
        The badge keeps its exact `right: 5 / top: 6` corner and simply lands on
        the pill instead of on bare glass — its 2px `badgeRing` was already
        there to separate it from whatever is behind, and a neutral fill under a
        coral dot is not two accents, it is one accent on a surface.
      */}
      {/*
        A COLUMN: glyph, then the word, then the mark. The bar used to be glyphs
        alone with a filled pill behind the active one, and that pill was the
        same shape language as the create button one cell over — which is how
        "which module am I on" became unreadable. A word answers it literally
        and lets every other cue get quieter.
      */}
      <View style={styles.glyphSlot}>
        <Icon size={Dock.icon} strokeWidth={focused ? 2.4 : 2} color={ink} />

        {badge > 0 ? (
          <View style={[styles.badge, { backgroundColor: C.live, borderColor: C.badgeRing }]}>
            <Text style={[styles.badgeText, { color: C.onLive }]}>
              {badge > 99 ? '99+' : badge}
            </Text>
          </View>
        ) : null}
      </View>

      <Text
        numberOfLines={1}
        style={[
          styles.label,
          { color: ink, fontFamily: focused ? Fonts.extrabold : Fonts.semibold },
        ]}>
        {label}
      </Text>

    </AnimatedPressable>
  );
});

/* ------------------------------------------------------------------ create */

/**
 * Create a session — THE FIFTH CELL, and no longer a FAB in any sense.
 *
 * What it was, so nobody reintroduces it a piece at a time: a 52px circle
 * filled with the `priTint -> pill` gradient, lifted 16px so 8px of cap stood
 * above the capsule, sitting on `bloom(C.glow, 'sm')`. Before that it was the
 * design's own 60/20/26 (aux-nocturne.dc.html L881).
 *
 * It has been complained about twice. First that it crowded the bar and made
 * the selected tab unreadable, which the 60 -> 52 shrink answered. Then, of the
 * shrunk version: "i dont like the plus icon that big and glowing can we make it
 * the same as the bottom nav bar other elements". A third set of numbers is not
 * an answer to that — the objection is to the TREATMENT, so the treatment goes.
 * Size, lift, gradient and glow all leave together, and this is now
 * `styles.cell`: the same 48px round hit area as Feed, Explore, Messages and
 * You, drawn flat, sitting in the row rather than proud of it.
 *
 * `Dock.fab` / `Dock.fabLift` / `Dock.fabIcon` are consequently unread by this
 * file. They stay in `theme.ts` because that file is not this job's to edit.
 *
 * ---------------------------------------------------------------------------
 * WHAT HAD TO SURVIVE THE FLATTENING, because this is the tension in the change
 * rather than a detail of it. Create is the app's primary verb, and the whole
 * reason it moved into the nav is that it had been UNFINDABLE — it lived only
 * in the Feed's empty state, so it disappeared the moment you had any content.
 * Four of these cells are places. This one is an action, and if it becomes
 * visually identical to the four it stops reading as one.
 *
 * So the emphasis moves from bulk to hue: THE ACCENT GOES ON THE GLYPH.
 *
 *   `C.pill` is the row's only saturated colour. The other four glyphs are
 *   `ink`/`ink3` greys and the sole warm thing in the bar is the unread badge,
 *   so one blue glyph is unmissable at a glance without adding a single pixel
 *   of area. It is also the accent rule read literally rather than decorated:
 *   blue means CREATE and CONTROL, and this is the create control.
 *
 *   It measures ~4.9:1 in BOTH themes — #4a7dff over the composited dark glass,
 *   #2f5fe0 over the light — comfortably past the 3:1 floor for a non-text
 *   graphic, so the accent carries on its own with nothing behind it. Worth
 *   knowing because the obvious "safety net" is a fill, and a fill is the one
 *   thing this cell must not have.
 *
 *   The symbol does the rest of the work. House, compass, speech bubble and
 *   person each name a PLACE; `+` names a thing you do. It is the only glyph
 *   here that is a verb, and that was true even when it was buried under a
 *   gradient.
 *
 * WHAT IT DELIBERATELY DOES NOT GET: any resting fill, chip, ring or disc. A
 * filled shape behind a glyph in this row is the selected-tab marker's own
 * language (see `NavCell` / `ACTIVE`), so a permanent one here would read as
 * "Create is the screen you are on" — which is the exact confusion the marker
 * was added to end. Pressed feedback is `styles.held`, the same 0.6 opacity dip
 * every other cell uses, for the same reason: it is a peer now.
 */
const CreateButton = memo(function CreateButton() {
  const C = useColors();
  const createPress = usePressFeedback(0.9);

  return (
    <AnimatedPressable
      // `button` where the others are `tab`, and this was always the non-visual
      // half of the distinction — a screen reader has never needed the gradient
      // to tell these apart. Unchanged, and now carrying more of the load.
      accessibilityRole="button"
      accessibilityLabel="Start a session"
      onPress={() => router.push('/room/create')}
      onPressIn={createPress.onPressIn}
      onPressOut={createPress.onPressOut}
      style={[styles.cell, createPress.style]}>
      {/*
        2.4 where an unfocused nav glyph is 2. This is OPTICAL, not a selection
        cue borrowed from `NavCell`: a plus is two short strokes where a house
        or a person is a long closed path, so at a matched stroke weight it lays
        down visibly less ink than anything beside it and the cell looks half
        drawn. It shares a number with the focused cells and cannot be confused
        with them, because focus is the pill and this cell never draws one.
      */}
      {/*
        A FILLED DISC AGAIN, and that reverses the previous pass rather than
        contradicting the feedback that produced it.

        It was flattened to a bare blue glyph because a big glowing circle made
        the current tab unreadable. The reference the user then supplied has a
        glowing centre button too — and it works there because every cell around
        it carries a LABEL and the active one carries an underline. With the
        answer written in words beside it, the button is free to be the loudest
        object in the bar without being mistaken for the selection.

        Sized to the row, not proud of it: 50 inside a 76 bar sits comfortably
        within the capsule, so nothing has to escape the blur's corner clip the
        way the old 60px lifted version did.
      */}
      <LinearGradient
        colors={[C.priTint, C.pill]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={[styles.create, bloom(C.glow, 'sm')]}>
        <Plus size={Dock.fabIcon} strokeWidth={2.6} color={C.pillInk} />
      </LinearGradient>
    </AnimatedPressable>
  );
});

/* ------------------------------------------------------------------ styles */

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    left: Dock.inset,
    right: Dock.inset,
    zIndex: ZIndex.tabBar,
  },
  capsule: {
    height: Dock.height,
    borderRadius: Dock.radius,
    borderWidth: Rule.hair,
    paddingHorizontal: Dock.padding,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    /*
      Without this the blur paints square corners behind the rounded border.

      IT ALSO CLIPS, and that cost used to be paid elsewhere: the create button
      was lifted 8px above this edge, so as a child its cap was sliced clean off
      and it had to be moved out into an absolutely-positioned sibling to get
      those pixels back. Nothing in here lifts any more, so the button came home
      (see the row above). If anything is ever given a negative margin or a lift
      inside this capsule again, this is the line that will eat it.
    */
    overflow: 'hidden',
  },
  tint: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },

  cell: {
    width: Dock.cell,
    height: Dock.cellHeight,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Dock.labelGap,
  },
  /** Holds the glyph so the badge can corner against it rather than the column. */
  glyphSlot: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: Dock.labelSize,
    letterSpacing: tracking(Dock.labelSize, 0.01),
    includeFontPadding: false,
  },
  /**
   * The travelling mark. Absolute, so it can be anywhere along the capsule
   * without belonging to a cell — the whole point is that it outlives the cell
   * it happens to be under.
   *
   * `bottom` rather than `top`: the bar's height is set by its tallest content
   * and the mark has to sit a fixed distance from the capsule's floor, not a
   * computed distance from its ceiling.
   */
  mark: {
    position: 'absolute',
    left: 0,
    bottom: 10,
    width: Dock.underline,
    height: Dock.underlineHeight,
    borderRadius: Radii.pill,
  },
  create: {
    width: Dock.fab,
    height: Dock.fab,
    borderRadius: Dock.fab / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  held: {
    opacity: 0.6,
  },
  /*
    The selection PILL lived here and is gone with its `ACTIVE` metrics. It was
    a filled, bordered rounded-rect behind the active glyph — the same shape
    language as the create button one cell over, which is precisely why the two
    competed and why the current tab stopped being readable. The mark is an
    underline now: nothing is ever pressed by pressing a 3px bar.
  */

  badge: {
    position: 'absolute',
    // Cornered against the GLYPH now, not the old 48px round cell, so these
    // are negative: the badge overhangs the icon the way the reference draws it.
    right: -8,
    top: -5,
    minWidth: 17,
    height: 17,
    borderRadius: 999,
    borderWidth: 2,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontFamily: Fonts.extrabold,
    fontSize: 9,
  },

  /*
    `fabWrap`, `fabSlot`, `fab` and `fabHeld` lived here and are deleted rather
    than left dormant. They positioned a 52px circle absolutely over the capsule,
    reserved a matching hole inside it, drew the disc and gave it its own
    scale-down press. All five cells now share `cell` and `held`, so keeping any
    of them would only be an invitation to lift the button again.
  */
});
