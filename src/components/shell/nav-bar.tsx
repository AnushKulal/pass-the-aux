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
import { Dock, Fonts, Rule, ZIndex, floating } from '@/lib/theme';
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
        corners behind its rounded border. The FAB is lifted 20px proud of the
        capsule's top edge, so as a CHILD it had its top 20px sliced clean off —
        a circle with a flat lid, which is exactly how it shipped.

        As a sibling it is clipped by nothing, and being later in the tree it
        paints above the glass without needing a z-index.
      */}
      <CreateButton />
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
    Selection is carried by ink weight alone — no tile, no pill, no underline.
    On glass that is enough, and it is the one place this design is quieter than
    the bar it replaces: a filled selection chip inside a translucent capsule
    reads as a second piece of chrome floating inside the first.
  */
  const ink = focused ? C.ink : C.ink3;

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={badge > 0 ? label + ', ' + badge + ' unread' : label}
      onPress={onPress}
      style={({ pressed }) => [styles.cell, pressed ? styles.held : null]}>
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
 * Create a session.
 *
 * Lifted 20px out of the capsule and gradient-filled, which makes it the only
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
          // The design's own recipe rather than `bloom()`, whose sizes are all
          // wider than this — a 60px button under a 42px blur reads as a smudge.
          { boxShadow: [{ offsetX: 0, offsetY: 12, blurRadius: 30, color: C.glow }] },
        ]}>
        <Plus size={Dock.fabIcon} strokeWidth={2.4} color={C.pillInk} />
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
   * Vertically: `(height - fab) / 2` would centre it in the bar; adding
   * `fabLift` raises it from there, so 16px of the circle sits above the
   * capsule's top edge and the rest is inside it. Every one of those pixels is
   * now drawn, where the clipped version simply lost them.
   */
  fabWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: (Dock.height - Dock.fab) / 2 + Dock.fabLift,
    alignItems: 'center',
  },
  /** The gap the FAB used to occupy in the row it no longer belongs to. */
  fabSlot: {
    width: Dock.fab,
    height: Dock.height,
  },
  fab: {
    width: Dock.fab,
    height: Dock.fab,
    borderRadius: Dock.fab / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabHeld: {
    transform: [{ scale: 0.985 }],
  },
});
