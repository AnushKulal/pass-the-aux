/**
 * Drives the Spotify account-linking flow (Authorization Code with PKCE).
 *
 * The split of work matters: this hook generates the PKCE pair and owns the
 * browser handoff, but it never sees a Spotify token. It sends the `code` and
 * `code_verifier` to the `spotify-auth` Edge Function, which does the exchange
 * server-side and stores the tokens in the RLS-locked `provider_tokens` table.
 * All that comes back is `{ isPremium, displayName }`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SETUP: BOTH redirect URIs below must be registered in the Spotify developer
 * dashboard (Settings -> Redirect URIs). Spotify matches them exactly, and a
 * missing entry fails with INVALID_CLIENT before the user sees a consent
 * screen — which reads like a broken app rather than a config gap.
 *
 *   Native   aux://spotify-callback
 *            (plus the Expo Go form, exp://<host>:8081/--/spotify-callback,
 *             if you link accounts while running in Expo Go)
 *   Web      <origin>/spotify-callback  — one entry per origin you serve from,
 *            e.g. http://localhost:8081/spotify-callback and the production
 *            https://<domain>/spotify-callback
 *
 * The web flow also needs a `/spotify-callback` route to exist in the app so
 * the popup has something to load; that route only has to call
 * `WebBrowser.maybeCompleteAuthSession()`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useQueryClient } from '@tanstack/react-query';
import { makeRedirectUri } from 'expo-auth-session';
import * as Crypto from 'expo-crypto';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useState } from 'react';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

// Closes the popup and hands the redirect URL back to `openAuthSessionAsync`.
// No-op on native; required on web.
WebBrowser.maybeCompleteAuthSession();

/**
 * RFC 7636 unreserved characters. Exactly 64 of them, so `byte % 64` maps
 * uniformly onto the alphabet with no modulo bias.
 */
const VERIFIER_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
const VERIFIER_LENGTH = 64;

async function createCodeVerifier(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(VERIFIER_LENGTH);
  let verifier = '';
  for (let i = 0; i < bytes.length; i++) {
    verifier += VERIFIER_ALPHABET[bytes[i] % VERIFIER_ALPHABET.length];
  }
  return verifier;
}

async function createCodeChallenge(verifier: string): Promise<string> {
  const base64 = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
    encoding: Crypto.CryptoEncoding.BASE64,
  });
  // base64 -> base64url: OAuth challenges travel in a query string.
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function spotifyRedirectUri(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    // `makeRedirectUri` on web would include the dev-server path/hash; Spotify
    // needs a stable, exactly-registered URL, so build it from the origin.
    return `${window.location.origin}/spotify-callback`;
  }
  return makeRedirectUri({ scheme: 'aux', path: 'spotify-callback' });
}

type EdgeErrorBody = { error?: { code?: string; message?: string } };

async function readEdgeErrorMessage(
  result: { response?: Response },
  error: unknown
): Promise<string> {
  const context = (error as { context?: unknown } | null | undefined)?.context;
  const response =
    result.response instanceof Response
      ? result.response
      : context instanceof Response
        ? context
        : null;

  if (response) {
    try {
      const body = (await response.clone().json()) as EdgeErrorBody;
      if (body?.error?.message) return body.error.message;
    } catch {
      // fall through to the generic message
    }
  }

  return error instanceof Error && error.message
    ? error.message
    : 'Could not reach Spotify. Check your connection and try again.';
}

async function invokeAuth<T>(
  action: 'start' | 'callback' | 'unlink',
  body: Record<string, unknown> = {}
): Promise<T> {
  const result = await supabase.functions.invoke<T>(`spotify-auth?action=${action}`, { body });

  if (result.error) {
    throw new Error(await readEdgeErrorMessage(result, result.error as unknown));
  }
  if (result.data == null) {
    throw new Error('Spotify returned an empty response. Please try again.');
  }
  return result.data;
}

type StartResponse = { url: string; state: string };
type CallbackResponse = { isPremium: boolean; displayName: string | null };

export type UseSpotifyLink = {
  /** Runs the whole OAuth round trip. Resolves once the profile is updated. */
  link: () => Promise<void>;
  /** Deletes the stored tokens server-side and clears the profile flags. */
  unlink: () => Promise<void>;
  linking: boolean;
  error: string | null;
};

export function useSpotifyLink(): UseSpotifyLink {
  const queryClient = useQueryClient();
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The Edge Function is the only writer of `spotify_linked` / `is_premium`,
  // so the cached profile is stale the moment either call succeeds.
  const invalidateProfile = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['profile'] });
  }, [queryClient]);

  const link = useCallback(async () => {
    setLinking(true);
    setError(null);

    try {
      const redirectUri = spotifyRedirectUri();
      const codeVerifier = await createCodeVerifier();
      const codeChallenge = await createCodeChallenge(codeVerifier);

      const start = await invokeAuth<StartResponse>('start', {
        redirect_uri: redirectUri,
        code_challenge: codeChallenge,
      });

      const result = await WebBrowser.openAuthSessionAsync(start.url, redirectUri);

      // Anything but 'success' is a dismissal ('cancel' / 'dismiss' on iOS,
      // 'opened' when Android hands off and the user never comes back).
      // Backing out is a choice, not a failure, so leave the error banner
      // alone and let the screen return to its idle state.
      if (result.type !== 'success') return;

      const params = Linking.parse(result.url).queryParams ?? {};
      const code = typeof params.code === 'string' ? params.code : null;
      const returnedState = typeof params.state === 'string' ? params.state : null;

      if (typeof params.error === 'string') {
        throw new Error(
          params.error === 'access_denied'
            ? 'Spotify access was declined.'
            : `Spotify returned an error: ${params.error}`
        );
      }
      if (!code) {
        throw new Error('Spotify did not return an authorization code.');
      }
      // A mismatched state means the callback did not originate from the
      // request we just made — treat it as hostile and drop the code.
      if (returnedState !== start.state) {
        throw new Error('Spotify sign-in could not be verified. Please try again.');
      }

      await invokeAuth<CallbackResponse>('callback', {
        code,
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
      });

      await invalidateProfile();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not connect Spotify.');
    } finally {
      setLinking(false);
    }
  }, [invalidateProfile]);

  const unlink = useCallback(async () => {
    setLinking(true);
    setError(null);

    try {
      await invokeAuth<{ ok: boolean }>('unlink');
      await invalidateProfile();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not disconnect Spotify.');
    } finally {
      setLinking(false);
    }
  }, [invalidateProfile]);

  return { link, unlink, linking, error };
}
