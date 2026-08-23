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
            Fade, not slide.
            A lateral push reads as "one level deeper into a hierarchy", which
            is the wrong claim in this app: the rail and the tab bar make almost
            every destination a SIBLING you can reach from anywhere, not a child
            of the screen you happen to be on. Fading is also what switching
            tabs already does, so the whole app now moves one single way.
            The Session below is the one deliberate exception.
          */
          animation: 'fade',
        }}>
        <Stack.Screen name="(auth)" options={{ animation: 'fade' }} />
        <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
        {/*
          A Session is a place you drop INTO — the one destination that is not a
          sibling of the rest. It keeps the vertical rise so that arriving in a
          party feels unlike any other navigation in the app.
        */}
        <Stack.Screen name="room/[id]" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="spotify-callback" />
        <Stack.Screen name="+not-found" options={{ animation: 'fade' }} />
      </Stack>
    </NavigationThemeProvider>
  );
}
