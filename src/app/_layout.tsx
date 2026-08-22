import {
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
} from '@expo-google-fonts/poppins';
import { Righteous_400Regular } from '@expo-google-fonts/righteous';
import { useFonts } from 'expo-font';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { Providers } from '@/lib/providers';
import { Colors, Duration } from '@/lib/theme';

/**
 * React Navigation paints its own container, scene backgrounds and transition
 * interstitials from the active theme — NOT from `contentStyle`. Left at the
 * default it uses the light theme, whose background is #F2F2F2, which shows
 * through as a grey flash between screens and behind anything that does not
 * paint edge to edge.
 *
 * Aux is dark-only, so there is no light variant to switch to: the palette is
 * hard-wired to the design tokens.
 */
const AuxNavigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: Colors.accent,
    background: Colors.bg,
    card: Colors.surface,
    text: Colors.text,
    border: Colors.border,
    notification: Colors.accent,
  },
};

/**
 * Hold the native splash until the typefaces are resident. Righteous carries
 * the entire brand read of the app; one frame of system-font fallback looks
 * like a rendering bug, so we would rather stay on the splash a beat longer.
 *
 * Swallowing the rejection is deliberate: on Fast Refresh the module re-runs
 * after the splash is already gone, and the resulting unhandled rejection is
 * noise, not a failure.
 */
void SplashScreen.preventAutoHideAsync().catch(() => undefined);
SplashScreen.setOptions({ duration: Duration.slow, fade: true });

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Righteous_400Regular,
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
  });

  const fontsSettled = fontsLoaded || fontError !== null;

  useEffect(() => {
    /**
     * Hide on error as well as success. A font that fails to decode should
     * degrade to the system face, never leave the user stranded on a splash
     * screen with no way forward.
     */
    if (fontsSettled) {
      void SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [fontsSettled]);

  // The native splash is still covering this frame, so rendering nothing is
  // invisible to the user — no flash, no layout thrash.
  if (!fontsSettled) return null;

  return (
    <Providers>
      <ThemeProvider value={AuxNavigationTheme}>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            // Every screen draws its own header through the `Screen` component,
            // which gives us glass headers the native stack header cannot do.
            headerShown: false,
            contentStyle: { backgroundColor: Colors.bg },
            animation: 'slide_from_right',
          }}>
          <Stack.Screen name="(auth)" options={{ animation: 'fade' }} />
          <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
          <Stack.Screen name="lounge/[id]" />
          {/* A Session is a place you drop into, so it rises from the bottom. */}
          <Stack.Screen name="room/[id]" options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="settings/connections" />
          <Stack.Screen name="spotify-callback" />
          <Stack.Screen name="+not-found" options={{ animation: 'fade' }} />
        </Stack>
      </ThemeProvider>
    </Providers>
  );
}
