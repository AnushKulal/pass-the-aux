import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Duration, Rule, Space, Type, tracking } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

/**
 * Where Spotify sends the browser back on web: `<origin>/spotify-callback`,
 * the redirect URI `useSpotifyLink` registers and asks for.
 *
 * This screen deliberately does NOT exchange the code. The PKCE verifier lives
 * in the closure of the `link()` call that opened the popup and never leaves
 * that tab, so `maybeCompleteAuthSession` posts this URL — code, state and all
 * — back to it and the hook finishes on its own completion path, state check
 * included. Duplicating the exchange here would mean duplicating the verifier,
 * which is the one secret PKCE exists to keep in one place.
 *
 * The route exists on native too so both platforms resolve the same path, but
 * native never renders it: `openAuthSessionAsync` intercepts the `aux://`
 * deep link itself.
 */
export default function SpotifyCallbackScreen() {
  const C = useColors();
  const reduced = useReducedMotion();

  const params = useLocalSearchParams<{ code?: string; state?: string; error?: string }>();
  const code = typeof params.code === 'string' ? params.code : null;
  const state = typeof params.state === 'string' ? params.state : null;
  const denial = typeof params.error === 'string' ? params.error : null;

  const [elapsed, setElapsed] = useState(0);

  /*
    Derived during render rather than pushed into state from an effect: the
    verdict is a pure function of the callback URL, and running it through
    setState would render the "connecting" frame first and then replace it.
  */
  const failure = useMemo<string | null>(() => {
    if (Platform.OS !== 'web') return null;
    // Spotify's own refusals, worded exactly as the hook words them so the two
    // entry points into this flow never disagree.
    if (denial) {
      return denial === 'access_denied'
        ? 'Spotify access was declined.'
        : `Spotify returned an error: ${denial}`;
    }
    if (!code) return 'Spotify did not return an authorization code.';
    // No state to echo means the opening tab could never verify this callback,
    // so there is nothing here worth handing over.
    if (!state) return 'Spotify sign-in could not be verified. Please try again.';
    return null;
  }, [code, denial, state]);

  useEffect(() => {
    if (Platform.OS !== 'web') {
      router.replace('/settings/connections');
      return;
    }
    if (failure) return;

    try {
      WebBrowser.maybeCompleteAuthSession();
    } catch {
      // Throws when this window has no opener to post back to — the popup was
      // replaced, or the redirect was opened in a fresh tab. The URL is still
      // recorded for the original tab to pick up when it regains focus, so the
      // recovery is the same either way: land on Connections and let the
      // profile state say whether it took.
    }

    // Not treated as an error path: `use-spotify-link` calls
    // `maybeCompleteAuthSession` at module scope too, so by the time this
    // effect runs the handoff has usually already happened and been cleaned
    // up — a "no session in progress" result here means done, not failed.
    router.replace('/settings/connections');
  }, [failure]);

  // The readout is the only thing on the screen that changes, and a handshake
  // with no elapsed time on it reads as frozen.
  useEffect(() => {
    if (failure) return;
    const timer = setInterval(() => setElapsed((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [failure]);

  /*
    Driven by a shared value from an effect, NOT `entering={FadeInDown…}`.
    Reanimated marks an entering view `visibility: hidden` until its animation
    runs, and on react-native-web it never runs. This screen renders ONLY on web
    — native redirects straight to Connections — so the layout animation left it
    permanently blank on the single platform it exists for.
  */
  const enter = useSharedValue(0);

  useEffect(() => {
    enter.value = reduced ? 1 : withTiming(1, { duration: Duration.enter });
  }, [reduced, enter]);

  const enterStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * 8 }],
  }));

  return (
    <SafeAreaView
      edges={['top', 'bottom', 'left', 'right']}
      style={[styles.root, { backgroundColor: C.bg }]}>
      <Animated.View style={[styles.center, enterStyle]}>
        {failure ? (
          <>
            <Text style={[styles.kicker, { color: C.ink3 }]}>SPOTIFY</Text>
            <Text style={[styles.title, { color: C.ink }]}>Could not connect Spotify</Text>
            <View style={[styles.majorRule, { backgroundColor: C.dangerBorder }]} />
            <Text style={[styles.body, { color: C.ink2 }]}>{failure}</Text>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Try again"
              onPress={() => router.replace('/settings/connections')}
              style={({ pressed }) => [
                styles.action,
                { borderColor: C.rule3, backgroundColor: pressed ? C.surface : 'transparent' },
              ]}>
              <Text style={[styles.actionLabel, { color: C.ink }]}>TRY AGAIN</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={[styles.kicker, { color: C.ink3 }]}>CONNECTING…</Text>
            <Text style={[styles.title, { color: C.ink }]}>Connecting Spotify</Text>
            <View style={[styles.majorRule, { backgroundColor: C.rule }]} />

            {/* The prototype's handshake row: a pulsing accent square, the
                sentence, and an elapsed readout in tabular figures. */}
            <View style={[styles.status, { borderColor: C.rule }]}>
              <PulseMark color={C.live} reduced={reduced} />
              <Text style={[styles.statusText, { color: C.ink2 }]}>
                Handing your sign-in back to Aux…
              </Text>
              <Text style={[styles.readout, { color: C.ink3 }]}>{clock(elapsed)}</Text>
            </View>
          </>
        )}
      </Animated.View>
    </SafeAreaView>
  );
}

/** 8px accent square, breathing at 1s. Static under reduced motion. */
function PulseMark({ color, reduced }: { color: string; reduced: boolean }) {
  const pulse = useSharedValue(1);

  useEffect(() => {
    if (reduced) {
      pulse.value = 1;
      return;
    }
    pulse.value = withRepeat(
      withTiming(0.25, { duration: 1000, easing: Easing.inOut(Easing.quad) }),
      -1,
      true
    );
  }, [pulse, reduced]);

  const animated = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return <Animated.View style={[styles.mark, { backgroundColor: color }, animated]} />;
}

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Space.lg,
  },
  kicker: {
    ...Type.label(11),
    letterSpacing: tracking(11, 0.12),
  },
  title: {
    ...Type.display(26),
    letterSpacing: tracking(26, -0.025),
    marginTop: Space.sm,
  },
  majorRule: {
    height: Rule.major,
    marginTop: 14,
    marginBottom: Space.lg,
  },
  body: {
    ...Type.body(16),
    maxWidth: 340,
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    borderWidth: Rule.hair,
    padding: Space.md,
  },
  mark: {
    width: 8,
    height: 8,
  },
  statusText: {
    ...Type.body(14),
    flex: 1,
  },
  readout: {
    ...Type.readout(12),
    fontVariant: ['tabular-nums' as const],
  },
  action: {
    marginTop: Space.xl,
    alignSelf: 'flex-start',
    justifyContent: 'center',
    minHeight: 46,
    paddingHorizontal: Space.lg,
    borderWidth: Rule.hair,
  },
  actionLabel: {
    ...Type.heading(11),
    letterSpacing: tracking(11, 0.1),
  },
});
