import {
  Archivo_400Regular,
  Archivo_600SemiBold,
  Archivo_800ExtraBold,
} from '@expo-google-fonts/archivo';
import { useFonts } from 'expo-font';
import {
  DarkTheme,
  DefaultTheme,
  Stack,
  ThemeProvider as NavigationThemeProvider,
} from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo } from 'react';

import { Providers } from '@/lib/providers';
import { Duration } from '@/lib/theme';
import { ThemeProvider, useTheme } from '@/lib/theme-context';

/**
 * Hold the native splash until the typefaces are resident and the stored theme
 * choice has been read.
 *
 * Patchbay is a single-family design: Archivo carries the display, the reading
 * and the measuring voice, distinguished only by weight and tracking. One frame
 * of system-font fallback re-flows every screen, so we would rather stay on the
 * splash a beat longer.
 *
 * Swallowing the rejection is deliberate: on Fast Refresh the module re-runs
 * after the splash is already gone, and the resulting unhandled rejection is
 * noise, not a failure.
 */
void SplashScreen.preventAutoHideAsync().catch(() => undefined);
SplashScreen.setOptions({ duration: Duration.sheet, fade: true });

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    // One family, five roles. `Type.display/heading/readout` are 800,
    // `Type.label` is 600 and `Type.body` is 400 — nothing else is loaded, and
    // nothing else should be referenced.
    Archivo_400Regular,
    Archivo_600SemiBold,
    Archivo_800ExtraBold,
  });

  const fontsSettled = fontsLoaded || fontError !== null;

  /**
   * ThemeProvider sits OUTSIDE the navigation theme so the navigator's own
   * colours can be built from the active palette and flip with the setting,
   * rather than being frozen at import time.
   */
  return (
    <ThemeProvider>
      <Providers>
        <RootNavigator fontsSettled={fontsSettled} />
      </Providers>
    </ThemeProvider>
  );
}

function RootNavigator({ fontsSettled }: { fontsSettled: boolean }) {
  const { colors: C, scheme, hydrating } = useTheme();

  const ready = fontsSettled && !hydrating;

  useEffect(() => {
    /**
     * Hide on font error as well as success. A font that fails to decode should
     * degrade to the system face, never leave the user stranded on a splash
     * screen with no way forward.
     */
    if (ready) {
      void SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [ready]);

  /**
   * React Navigation paints its own container, scene backgrounds and transition
   * interstitials from the active theme — NOT from `contentStyle`. Left at the
   * default it uses the light theme, whose background is #F2F2F2, which shows
   * through as a grey flash between screens and behind anything that does not
   * paint edge to edge.
   *
   * `primary` and `notification` take the accent, which in this direction means
   * live / playing / joinable and nothing else. They are only ever used by
   * chrome we do not render (headers, badges), so the reservation holds.
   */
  const navigationTheme = useMemo(() => {
    const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      dark: scheme === 'dark',
      colors: {
        ...base.colors,
        primary: C.live,
        background: C.bg,
        card: C.surface,
        text: C.ink,
        border: C.rule,
        notification: C.live,
      },
    };
  }, [C, scheme]);

  // The native splash is still covering this frame, so rendering nothing is
  // invisible to the user — no flash, no layout thrash.
  if (!ready) return null;

  return (
    <NavigationThemeProvider value={navigationTheme}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          // Every screen draws its own header, so the native stack header would
          // only ever be a second, competing one.
          headerShown: false,
          contentStyle: { backgroundColor: C.bg },
          /*
            NOTHING, AND THAT IS THE ANIMATION.

            The reasoning that put a fade here still holds as far as it goes: a
            lateral push claims "one level deeper into a hierarchy", and the tab
            bar makes almost every destination a SIBLING rather than a child, so
            a slide would be a lie about the shape of the app. What was wrong is
            the conclusion — that the alternative to a directional move is a
            dissolve.

            Every destination on this stack now animates its own CONTENT in:
            the tab screens and the settings family through `useEntrance`
            (@/lib/entrance), the `(auth)` screens through the enter style each
            one already holds. A stack cross-fade on top of that is a second
            opacity ramp over the first, and what it costs is legibility of the
            one that means something — the design's grammar is a module lifting
            in and the rows inside it following, not a screen dissolving whole.
            So the container hands the transition to the content and gets out of
            the way, and the tab navigator in `(tabs)/_layout` does the same.

            The Session below is still the one deliberate exception, and it is
            the exception for the same reason it always was.
          */
          animation: 'none',
        }}>
        {/*
          Both inherit `none`. Signing in or out is not a move within the app —
          it is a change of which app you are in — and the screen you land on
          says so by assembling itself in front of you.
        */}
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        {/*
          A Session is a place you drop INTO — the one destination that is not a
          sibling of the rest. It keeps the vertical rise so that arriving in a
          party feels unlike any other navigation in the app, and it is now the
          ONLY navigator transition left in it, which makes the claim louder
          rather than weaker.

          THAT SENTENCE WAS NOT TRUE WHEN IT WAS WRITTEN, and it is worth
          saying so rather than quietly repairing it. This stack stopped
          animating and the tab navigator's cross-fade went to zero, but the
          NESTED `(auth)` stack was still pushing `slide_from_right` — so the
          loudest transition in the app was a lateral slide into sign-in, which
          is exactly what got complained about next. `(auth)/_layout` now takes
          the same `none`, for the same reason, and the claim holds as written.

          It survives the cull because it is not a dissolve competing with the
          content's own arrival — it is the design's `auxSheetIn`, a travel with
          no opacity at all (aux-nocturne.dc.html L19), the same move
          `useSheetSlide` gives every surface that rises from the bottom edge.
          `Duration.sheet` is what those already take.
        */}
        <Stack.Screen
          name="room/[id]"
          options={{ animation: 'slide_from_bottom', animationDuration: Duration.sheet }}
        />
        {/*
          Inherits `none`, and this one gains the most from it. It is an OAuth
          interstitial that redirects out of itself almost immediately, so any
          transition at all was a gesture the user never got to finish reading.
        */}
        <Stack.Screen name="spotify-callback" />
        {/*
          Also inherits. A dead end is something you are stuck on rather than
          something arriving, and dressing it up delays the one sentence that
          tells you so.
        */}
        <Stack.Screen name="+not-found" />
      </Stack>
    </NavigationThemeProvider>
  );
}
