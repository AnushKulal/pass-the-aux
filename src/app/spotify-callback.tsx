import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { AuxButton, Screen, Skeleton } from '@/components/ui';
import { Colors, Space, Type } from '@/lib/theme';

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
      <View style={styles.center}>
        {failure ? (
          <View style={styles.status}>
            <Text style={styles.title}>Could not connect Spotify</Text>
            <Text style={styles.body}>{failure}</Text>
            <AuxButton label="Try again" onPress={() => router.replace('/settings/connections')} />
          </View>
        ) : (
          <View style={styles.status}>
            <Text style={styles.title}>Connecting Spotify…</Text>
            <Text style={styles.body}>Handing your sign-in back to Aux.</Text>
            <View style={styles.bars}>
              <Skeleton width="100%" height={16} />
              <Skeleton width="70%" height={16} />
            </View>
          </View>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
  },
  status: {
    alignItems: 'center',
    gap: Space.md,
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
  bars: {
    width: '100%',
    maxWidth: 260,
    gap: Space.sm,
    marginTop: Space.sm,
    alignItems: 'center',
  },
});
