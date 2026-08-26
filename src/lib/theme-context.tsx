/**
 * Dark / Light / System theming.
 *
 * The choice is persisted; "system" follows the OS live rather than sampling
 * once at launch, so flipping the phone's appearance changes the app underneath
 * the user without a restart.
 *
 * Components that must follow the choice call `useColors()`. Its return type is
 * the same `Palette` shape a direct `import { Colors }` gives, so migrating a
 * component is a one-line change at the top and nothing else.
 *
 * THE DISSOLVE. Switching used to repaint in a single frame, which reads as a
 * flash rather than as a change. Seventy-odd files take colour from
 * `useColors()` as plain strings, so there is no honest way to animate every
 * consumer without rewriting all of them. `ThemeVeil` below is the cheap and
 * truthful substitute: a full-bleed sheet of the ground we just LEFT, laid over
 * the app in the same frame the new palette paints, then lifted. The eye reads
 * a dissolve. It is a GROUND-colour cross-fade, not a per-token one — a screen
 * that is mostly artwork (a Session) dissolves through the app's ground rather
 * than through its own, and that is the accepted limit of the trick.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { StyleSheet, useColorScheme, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import {
  Duration,
  Palettes,
  PointerEvents,
  ZIndex,
  type Palette,
  type ThemeChoice,
  type ThemeName,
} from './theme';

const STORAGE_KEY = 'aux:theme-choice';

type ThemeContextValue = {
  /** What the user picked: dark, light, or follow the system. */
  choice: ThemeChoice;
  /** What that resolves to right now. */
  scheme: ThemeName;
  colors: Palette;
  setChoice: (next: ThemeChoice) => void;
  /** True until the stored choice has been read, so nothing flashes the wrong theme. */
  hydrating: boolean;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const isChoice = (v: unknown): v is ThemeChoice =>
  v === 'dark' || v === 'light' || v === 'system';

/**
 * There are exactly two schemes, so the ground being left behind is always the
 * other one's. Nothing has to be remembered between renders to know it, which
 * is what keeps the veil free of refs and of state written during render.
 */
const outgoingGround = (scheme: ThemeName): string =>
  Palettes[scheme === 'dark' ? 'light' : 'dark'].bg;

/**
 * The sheet that makes a theme change read as a dissolve.
 *
 * Mounted with a `key` of the active scheme, so a flip DESTROYS this instance
 * and builds a fresh one in the very commit that repaints the palette. That is
 * the whole mechanism, and it is why the opacity starts at 1 inside
 * `useSharedValue` instead of being raised by an effect: an effect runs after
 * its commit is already on screen, so the user would get the new palette for a
 * frame, then the old ground slammed back over it, then the fade — a blink,
 * which is worse than the harsh swap this replaces.
 *
 * `armed` is false for the instance that mounts at launch, and for the one that
 * mounts when the stored choice arrives while the splash is still up. Without
 * it the app would open by fading a full screen of the wrong colour off itself.
 */
function ThemeVeil({ ground, armed }: { ground: string; armed: boolean }) {
  const reduced = useReducedMotion();

  /**
   * Frozen at mount. This instance either came up holding the outgoing ground
   * or it did not, and a later prop change cannot retroactively make it so —
   * `useSharedValue`'s argument is read once too, and the two must agree.
   */
  const [holds] = useState(armed && !reduced);
  const cover = useSharedValue(holds ? 1 : 0);

  useEffect(() => {
    // Nothing to lift on the instance that mounted transparent, and nothing to
    // lift when the user has asked for no motion: there the swap stays instant.
    if (!holds) return;
    cover.value = withTiming(0, {
      // `Duration.scrim` IS this gesture — a full-bleed sheet clearing off the
      // page — and it sits at the bottom of the 200-320ms band the spec allows.
      duration: Duration.scrim,
      // Out, so the new palette is legible almost immediately and only the
      // last, imperceptible few percent of the veil linger.
      easing: Easing.out(Easing.quad),
    });
  }, [holds, cover]);

  const lift = useAnimatedStyle(() => ({ opacity: cover.value }));

  /*
    `PointerEvents.none` is not decoration here. This is a full-bleed view over
    the entire app, and a full-bleed overlay that ate every tap underneath it
    has already shipped in this codebase once.
  */
  return (
    <Animated.View style={[styles.veil, PointerEvents.none, { backgroundColor: ground }, lift]} />
  );
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Subscribes to OS appearance changes; updates while the app is open.
  const system = useColorScheme();
  const [choice, setChoiceState] = useState<ThemeChoice>('dark');
  const [hydrating, setHydrating] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (!cancelled && isChoice(stored)) setChoiceState(stored);
      })
      .finally(() => {
        if (!cancelled) setHydrating(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setChoice = useCallback((next: ThemeChoice) => {
    // Apply immediately and persist in the background — a theme switch that
    // waits on disk feels broken.
    setChoiceState(next);
    void AsyncStorage.setItem(STORAGE_KEY, next);
  }, []);

  /**
   * Lifted out of the memo below because the veil needs it too, and deriving it
   * in two places is how the two would drift apart.
   */
  const scheme: ThemeName = choice === 'system' ? (system === 'light' ? 'light' : 'dark') : choice;

  const value = useMemo<ThemeContextValue>(
    () => ({ choice, scheme, colors: Palettes[scheme], setChoice, hydrating }),
    [choice, scheme, setChoice, hydrating]
  );

  return (
    <ThemeContext.Provider value={value}>
      {/*
        A plain flex host, so the veil has something full-screen to be absolute
        against. It sits ABOVE `GestureHandlerRootView` (mounted inside
        `children`, in @/lib/providers) and that is safe: the rule about GHRV
        being outermost is about it being an ANCESTOR of every gesture handler,
        and `SafeAreaProvider` already renders a view above it regardless.
      */}
      <View style={styles.root}>
        {children}
        {/*
          Last sibling, so it paints over everything `children` draws —
          the toast layer and the update prompt included. A theme change
          dissolves the whole app, chrome and all.

          `hydrating` alone is the arming condition, and it covers both cases
          that must NOT dissolve. It is true for the launch instance, so the app
          cannot open by fading a full screen of the opposite palette off
          itself. And it is still true when a stored choice of the other scheme
          arrives, because `setChoiceState` runs in the `.then` above and
          `setHydrating(false)` only in the `.finally` after it — that swap
          happens behind the splash, where there is nothing to dissolve.
          Clearing it later does not remount the veil, since the key has not
          changed, so the first REAL flip is the first armed instance.
        */}
        <ThemeVeil key={scheme} ground={outgoingGround(scheme)} armed={!hydrating} />
      </View>
    </ThemeContext.Provider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  veil: {
    // Spread rather than composed in the style array, because the z-index below
    // has to sit in the same object. `absoluteFill` is a plain frozen object in
    // RN 0.86, not a registered style id — `absoluteFillObject` is gone.
    ...StyleSheet.absoluteFill,
    /*
      The same layer as the toasts rather than one above them, because there is
      no token above `toast` and inventing one here would put the app's z-order
      in two files. A tie is broken by tree order on web and by draw order
      natively, and the veil is the later sibling either way.
    */
    zIndex: ZIndex.toast,
  },
});

function useThemeContext(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useColors/useTheme used outside ThemeProvider — check src/lib/providers.tsx');
  }
  return ctx;
}

/** The active palette. Same shape as the statically imported `Colors`. */
export function useColors(): Palette {
  return useThemeContext().colors;
}

/** The full control surface, for the Appearance setting. */
export function useTheme(): ThemeContextValue {
  return useThemeContext();
}
