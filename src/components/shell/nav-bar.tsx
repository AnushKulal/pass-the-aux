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
 *   - CREATE moves to a lifted centre button. It used to exist only inside the
 *     Feed's empty state, which meant the app's primary verb disappeared the
 *     moment you had any content
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
import { memo, type RefObject } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from 'expo-router/js-tabs';

import { useTotalUnread } from '@/features/dm';
import { Dock, Fonts, Rule, ZIndex, bloom, floating } from '@/lib/theme';
import { useColors, useTheme } from '@/lib/theme-context';

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

        {LEFT.map((cell) => (
          <NavCell
            key={cell.name}
            icon={cell.icon}
            label={cell.label}
            focused={current === cell.name}
            onPress={() => goTab(cell.name)}
          />
        ))}

        {/*
          A HOLE, not the button. The button itself is a sibling of this
          BlurView, below — see `CreateButton`. This reserves its width so the
          four real cells keep the spacing `space-between` gave them.
        */}
        <View style={styles.fabSlot} pointerEvents="none" />

        <NavCell
          icon={MessageCircle}
          label="Messages"
          focused={current.startsWith('messages')}
          badge={unread}
          onPress={() => router.push('/messages')}
        />
        <NavCell
          icon={User}
          label="You"
          focused={current === 'profile'}
          onPress={() => goTab('profile')}
        />
      </BlurView>

      {/*
        OUTSIDE the BlurView, and that is the whole point.

        The capsule must carry `overflow: 'hidden'` or the blur paints square
        corners behind its rounded border. The FAB stands proud of the capsule's
        top edge, so as a CHILD its protruding cap was sliced clean off — a
        circle with a flat lid, which is exactly how it shipped.

        SHRINKING THE BUTTON DOES NOT RETIRE THIS. The cap is 8px now where it
        was 16, which makes the clipping less obvious and no less real; at any
        positive lift some of the circle is outside the box that clips. Do not
        read the smaller number as permission to move it back inside.

        As a sibling it is clipped by nothing, and being later in the tree it
        paints above the glass without needing a z-index.
      */}
      <CreateButton />
    </View>
  );
}

/* ------------------------------------------------------------------- cells */

/**
 * The marker behind the selected cell's glyph.
 *
 * WIDER THAN IT IS TALL, and that is the load-bearing part of the shape: it has
 * to be impossible to mistake for the round button in the middle of the same
 * row. 44x32 inside a 48px cell leaves 2px of air each side and 8px above and
 * below, so it reads as a pill sitting under one icon rather than as a tile the
 * cell has been filled with. See `NavCell` for why it exists at all.
 */
const ACTIVE = { width: 44, height: 32, radius: 16 } as const;

type CellProps = {
  icon: LucideIcon;
  label: string;
  focused: boolean;
  badge?: number;
  onPress: () => void;
};

const NavCell = memo(function NavCell({
  icon: Icon,
  label,
  focused,
  badge = 0,
  onPress,
}: CellProps) {
  const C = useColors();

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
    module you are on. `ink` against `ink3` is two greys a step apart, and the
    loudest thing in this row by a wide margin is a saturated gradient circle
    standing proud of the middle of it. Beside that, a grey icon turning a
    lighter grey does not read as a selection; it reads as a rendering
    difference. The artboard measures that contrast with no FAB drawn over it.
    Ours has one, so ours needs more than the artboard does.

    Going past the design here is therefore deliberate, and the constraints on
    the extra thing are tight:
      - NOT blue, or anything on the primary ramp. Blue is CREATE and CONTROL,
        and this control neither creates nor controls — it reports where you
        already are. A blue marker two cells from the create button would also
        turn one blue circle into two or three, which is the exact confusion
        being complained about.
      - NOT coral. Coral is state-of-the-world: live, playing, unread. Your own
        location in your own app is not an event happening to you, and the
        unread badge one cell over has to stay the only warm thing in the bar.
      - NOT a disc. A filled circle under a glyph is the FAB's own silhouette.

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
    <Pressable
      accessibilityRole="tab"
      // Unchanged, and load-bearing: a screen reader has always announced this
      // correctly. Everything above is about making the eye agree with it.
      accessibilityState={{ selected: focused }}
      accessibilityLabel={badge > 0 ? label + ', ' + badge + ' unread' : label}
      onPress={onPress}
      style={({ pressed }) => [styles.cell, pressed ? styles.held : null]}>
      {/*
        First in the tree, so the glyph and the badge both paint on top of it.
        The badge keeps its exact `right: 5 / top: 6` corner and simply lands on
        the pill instead of on bare glass — its 2px `badgeRing` was already
        there to separate it from whatever is behind, and a neutral fill under a
        coral dot is not two accents, it is one accent on a surface.
      */}
      {focused ? (
        <View
          pointerEvents="none"
          style={[styles.active, { backgroundColor: C.surface3, borderColor: C.rule2 }]}
        />
      ) : null}

      <Icon size={Dock.icon} strokeWidth={focused ? 2.4 : 2} color={ink} />

      {badge > 0 ? (
        <View style={[styles.badge, { backgroundColor: C.live, borderColor: C.badgeRing }]}>
          <Text style={[styles.badgeText, { color: C.onLive }]}>
            {badge > 99 ? '99+' : badge}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
});

/* --------------------------------------------------------------------- FAB */

/**
 * THE CENTRE ACTION'S METRICS, OVERRIDDEN LOCALLY — 60/20/26 was too big.
 *
 * `Dock.fab`/`Dock.fabLift`/`Dock.fabIcon` carry the design's own numbers
 * (aux-nocturne.dc.html L881: `60px`, `margin-top:-20px`, a 26px glyph). At
 * those values the circle is 88% of the capsule's height, stands 16px proud of
 * it, and is 25% wider than the 48px cells either side. The bar stopped reading
 * as five destinations with one emphasised and started reading as one button
 * with four attendants — which is also why the selected tab was invisible next
 * to it; see `NavCell`.
 *
 * 52/16/22 is the correction, and each number does one job:
 *
 *   size 52  only 4px larger than a `Dock.cell`. The emphasis now comes from
 *            the gradient, the lift and the glow — three things none of the
 *            other cells have — rather than from bulk.
 *   lift 16  `fabLift` IS the offset of the circle's centre above the row (see
 *            `fabWrap`), so this leaves 8px of cap above the capsule:
 *            unmistakably lifted, half the previous overhang. That overhang is
 *            also dead to touch on Android, where a child drawn outside its
 *            parent's bounds still paints but stops receiving touches — so the
 *            two numbers together leave exactly 52 - 8 = 44 of live target,
 *            which is `TOUCH_TARGET` on the nose. At 60/20 it was 44 as well,
 *            so the shrink costs nothing at the finger; go smaller or lift
 *            higher and it starts to.
 *   icon 22  equal to `Dock.icon`, the nav glyphs. 22/52 is .42 against the
 *            design's 26/60 = .43, so the plus keeps its proportion inside the
 *            circle while stopping being the largest glyph in the bar — the
 *            first half of the complaint was about the plus, not just the disc.
 *
 * The tokens stay in `theme.ts` untouched because that file is not this job's
 * to edit. If they are ever re-tuned there, these are the values that were
 * wrong and this is why.
 */
const FAB = { size: 52, lift: 16, icon: Dock.icon } as const;

/**
 * Create a session.
 *
 * Lifted out of the capsule and gradient-filled, which makes it the only
 * element in the shell that is unambiguously an ACTION rather than a place.
 * That is the accent rule doing its job: blue for the thing you do, and the
 * coral badge two cells over for the thing that is happening.
 */
const CreateButton = memo(function CreateButton() {
  const C = useColors();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Start a session"
      onPress={() => router.push('/room/create')}
      style={({ pressed }) => [styles.fabWrap, pressed ? styles.fabHeld : null]}>
      <LinearGradient
        colors={[C.priTint, C.pill]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={[
          styles.fab,
          /*
            `bloom.sm` (0/8/24), where this used to hand-roll 0/12/30 with the
            note "the design's own recipe rather than `bloom()`, whose sizes are
            all wider than this — a 60px button under a 42px blur reads as a
            smudge". That was true of `bloom.md` at 60px and it is no longer the
            situation: the button came down to 52 and met the ladder's small
            step, which `Chip` already uses for a 44px pill. Scaling the literal
            would have landed on 0/10/26 — near enough that keeping every glow
            in the app on one ladder is worth the two pixels. The tighter glow
            is also part of the fix: half of "it dominates the bar" was the
            50%-alpha blue haze bleeding across the cells either side.
          */
          bloom(C.glow, 'sm'),
        ]}>
        <Plus size={FAB.icon} strokeWidth={2.4} color={C.pillInk} />
      </LinearGradient>
    </Pressable>
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
    // Without this the blur paints square corners behind the rounded border.
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
    height: Dock.cell,
    borderRadius: Dock.cell / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  held: {
    opacity: 0.6,
  },
  /**
   * Explicit insets rather than leaning on the cell's `alignItems`/
   * `justifyContent`. Yoga does apply a parent's alignment to an absolute child
   * that declares no insets, but react-native-web has not always agreed, and a
   * selection marker that centres on two platforms and corners on the third is
   * the kind of bug nobody notices until it ships. The arithmetic is the
   * centring, written down.
   */
  active: {
    position: 'absolute',
    top: (Dock.cell - ACTIVE.height) / 2,
    left: (Dock.cell - ACTIVE.width) / 2,
    width: ACTIVE.width,
    height: ACTIVE.height,
    borderRadius: ACTIVE.radius,
    borderWidth: Rule.hair,
  },

  badge: {
    position: 'absolute',
    right: 5,
    top: 6,
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

  /**
   * Centred on the capsule horizontally, and lifted proud of it vertically.
   *
   * `left: 0, right: 0` with `alignItems: 'center'` rather than a measured
   * offset, so the circle stays on the capsule's centre line at every screen
   * width without arithmetic that can drift.
   *
   * Vertically: `(height - size) / 2` would centre it in the bar; adding
   * `lift` raises it from there. Which means `lift` is not the overhang — it is
   * the offset of the circle's CENTRE above the row's centre line, and the
   * overhang falls out of it as `size / 2 + lift - height / 2`: 8px at 52/16,
   * where it was 16px at the design's 60/20. Every one of those pixels is drawn,
   * where the clipped version simply lost them.
   */
  fabWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: (Dock.height - FAB.size) / 2 + FAB.lift,
    alignItems: 'center',
  },
  /**
   * The gap the FAB used to occupy in the row it no longer belongs to.
   *
   * Narrowing it with the button is not cosmetic: the four cells are spaced by
   * `space-between` against whatever is left over, so the 8px this gives back
   * becomes 2px of extra air in each of the four gaps. On a 320pt screen those
   * gaps were down to ~4px, which is where the row started to look crowded and
   * where two 44px-wide selection pills would have nearly touched.
   */
  fabSlot: {
    width: FAB.size,
    height: Dock.height,
  },
  fab: {
    width: FAB.size,
    height: FAB.size,
    borderRadius: FAB.size / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabHeld: {
    transform: [{ scale: 0.985 }],
  },
});
