import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { AuxButton, Screen } from '@/components/ui';
import { Bloom, Colors, PointerEvents, Space, Type } from '@/lib/theme';

/** Colors.warn and Colors.danger held back to ring and wash weights. */
const WARN_RING = 'rgba(232, 177, 92, 0.16)';
const WARN_RING_INNER = 'rgba(232, 177, 92, 0.30)';
const WARN_GLOW = 'rgba(232, 177, 92, 0.22)';
const DANGER_WASH = 'rgba(242, 101, 126, 0.07)';
const DANGER_EDGE = 'rgba(242, 101, 126, 0.26)';

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
  const params = useLocalSearchParams<{ code?: string; state?: string; error?: string }>();
  const code = typeof params.code === 'string' ? params.code : null;
  const state = typeof params.state === 'string' ? params.state : null;
  const denial = typeof params.error === 'string' ? params.error : null;

  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web') {
      router.replace('/settings/connections');
      return;
    }

    // Spotify's own refusals, worded exactly as the hook words them so the two
    // entry points into this flow never disagree.
    if (denial) {
      setFailure(
        denial === 'access_denied'
          ? 'Spotify access was declined.'
          : `Spotify returned an error: ${denial}`
      );
      return;
    }
    if (!code) {
      setFailure('Spotify did not return an authorization code.');
      return;
    }
    // No state to echo means the opening tab could never verify this callback,
    // so there is nothing here worth handing over.
    if (!state) {
      setFailure('Spotify sign-in could not be verified. Please try again.');
      return;
    }

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
  }, [code, denial, state]);

  return (
    <Screen>
      {/* Two seconds of screen, and almost nothing on it but the atmosphere. */}
      <View style={[styles.bloom, PointerEvents.none]}>
        <Svg width="100%" height="100%">
          <Defs>
            <RadialGradient id="callbackBloom" cx="50%" cy="50%" rx="62%" ry="52%">
              <Stop offset="0" stopColor={Bloom.a} stopOpacity={0.18} />
              <Stop offset="0.45" stopColor={Bloom.b} stopOpacity={0.1} />
              <Stop offset="0.78" stopColor={Colors.bg} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#callbackBloom)" />
        </Svg>
      </View>

      <View style={styles.center}>
        {failure ? (
          <View style={styles.status}>
            <View style={styles.failEmblem}>
              <X size={30} color={Colors.danger} strokeWidth={1.6} />
            </View>
            <View style={styles.copy}>
              <Text style={styles.title}>Could not connect Spotify</Text>
              <Text style={styles.body}>{failure}</Text>
            </View>
            <AuxButton label="Try again" onPress={() => router.replace('/settings/connections')} />
          </View>
        ) : (
          <View style={styles.status}>
            {/*
              Warn, not accent: a handshake in progress is "adjusting", and the
              accent has to keep meaning live. Static rings rather than a spinner
              so nothing loops behind a reduced-motion preference.
            */}
            <View style={styles.ringOuter}>
              <View style={styles.ringInner}>
                <View style={styles.glow}>
                  <View style={styles.dot} />
                </View>
              </View>
            </View>
            <View style={styles.copy}>
              <Text style={styles.title}>Connecting Spotify…</Text>
              <Text style={styles.body}>Handing your sign-in back to Aux.</Text>
            </View>
          </View>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  bloom: {
    position: 'absolute',
    // Out past the screen gutter so the glow reaches the edges rather than
    // stopping on the same line the content does.
    left: -Space.lg,
    right: -Space.lg,
    top: 0,
    bottom: 0,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Space.md,
  },
  status: {
    alignItems: 'center',
    gap: Space.xxl,
  },
  ringOuter: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 1,
    borderColor: WARN_RING,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringInner: {
    width: 62,
    height: 62,
    borderRadius: 31,
    borderWidth: 1,
    borderColor: WARN_RING_INNER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** Stacked translucency stands in for the blur RN has no filter for. */
  glow: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: WARN_GLOW,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.warn,
  },
  failEmblem: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: DANGER_WASH,
    borderWidth: 1,
    borderColor: DANGER_EDGE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    alignItems: 'center',
    gap: Space.sm,
    maxWidth: 290,
  },
  title: {
    ...Type.title,
    color: Colors.text,
    textAlign: 'center',
  },
  body: {
    ...Type.body,
    color: Colors.muted,
    textAlign: 'center',
  },
});
