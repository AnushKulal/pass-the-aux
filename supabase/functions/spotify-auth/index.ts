/**
 * Spotify account linking — Authorization Code with PKCE.
 *
 * WHY AN EDGE FUNCTION AT ALL: `provider_tokens` has RLS enabled with zero
 * policies, so nothing but the service role can touch it. That is deliberate.
 * A Spotify refresh token is a long-lived key to somebody's music account; if
 * it ever reached the client it would sit in AsyncStorage/localStorage where
 * another script or a rooted device could lift it. So the token exchange
 * happens here and the only thing that crosses back to the app is
 * `{ isPremium, displayName }`.
 *
 * WHY NO CLIENT SECRET: this is the pure PKCE flow. The `code_verifier` proves
 * possession instead, so there is no Spotify client secret to store, rotate or
 * leak. `SPOTIFY_CLIENT_ID` is the only Spotify value required, and it lives
 * here purely so the app bundle does not have to carry it.
 *
 * WHY THE VERIFIER STAYS ON THE CLIENT: PKCE verifiers are single-use and only
 * meaningful between `start` and `callback` within one flow. Persisting them
 * would mean building session storage and expiry for a value that is worthless
 * the moment the flow completes.
 *
 * Required secrets:
 *   SPOTIFY_CLIENT_ID
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (injected by Supabase)
 */

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

import {
  HttpError,
  handlePreflight,
  jsonResponse,
  readJsonBody,
  requiredString,
  toErrorResponse,
} from '../_shared/cors.ts';

const SPOTIFY_ACCOUNTS = 'https://accounts.spotify.com';
const SPOTIFY_API = 'https://api.spotify.com/v1';

/**
 * `streaming` unlocks the Web Playback SDK; the `user-modify-playback-state` /
 * `user-read-playback-state` pair is what lets the sync engine drive an
 * existing Spotify device. `user-read-private` is needed for exactly one field:
 * `product`, which tells us whether this account is Premium.
 */
const SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'user-read-private',
  'streaming',
].join(' ');

function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

function adminClient(): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Derives the user from the Supabase JWT on the request. Never read a user id
 * out of the body — a caller can write anything there, and this function
 * writes token rows keyed by user id.
 */
async function requireUserId(req: Request, admin: SupabaseClient): Promise<string> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    throw new HttpError('auth_expired', 'Missing Authorization header.', 401);
  }

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) {
    throw new HttpError('auth_expired', 'Your session has expired. Sign in again.', 401);
  }
  return data.user.id;
}

type SpotifyTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  token_type: string;
};

type SpotifyMeResponse = {
  id: string;
  display_name?: string | null;
  product?: string | null;
};

// ------------------------------------------------------------------ action=start

/**
 * Builds the authorize URL. The client sends its PKCE challenge and the exact
 * redirect URI it will listen on; we add the client id, the scopes and a random
 * `state` so the client can detect a swapped or replayed callback.
 */
async function handleStart(req: Request, admin: SupabaseClient): Promise<Response> {
  await requireUserId(req, admin);

  const body = await readJsonBody(req);
  const redirectUri = requiredString(body, 'redirect_uri');
  const codeChallenge = requiredString(body, 'code_challenge');
  const state = crypto.randomUUID();

  const url = new URL(`${SPOTIFY_ACCOUNTS}/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', env('SPOTIFY_CLIENT_ID'));
  url.searchParams.set('scope', SCOPES);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('state', state);

  return jsonResponse({ url: url.toString(), state });
}

// --------------------------------------------------------------- action=callback

async function exchangeCode(
  code: string,
  codeVerifier: string,
  redirectUri: string
): Promise<SpotifyTokenResponse> {
  const res = await fetch(`${SPOTIFY_ACCOUNTS}/api/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: env('SPOTIFY_CLIENT_ID'),
      code_verifier: codeVerifier,
    }),
  });

  const payload: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const detail =
      payload && typeof payload === 'object' && 'error_description' in payload
        ? String((payload as { error_description?: unknown }).error_description)
        : 'Spotify rejected the authorization code.';
    throw new HttpError('auth_expired', detail, 400);
  }
  return payload as SpotifyTokenResponse;
}

async function fetchSpotifyProfile(accessToken: string): Promise<SpotifyMeResponse> {
  const res = await fetch(`${SPOTIFY_API}/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new HttpError('unknown', 'Could not read your Spotify profile.', 502);
  }
  return (await res.json()) as SpotifyMeResponse;
}

async function handleCallback(req: Request, admin: SupabaseClient): Promise<Response> {
  const userId = await requireUserId(req, admin);

  const body = await readJsonBody(req);
  const code = requiredString(body, 'code');
  const codeVerifier = requiredString(body, 'code_verifier');
  const redirectUri = requiredString(body, 'redirect_uri');

  const tokens = await exchangeCode(code, codeVerifier, redirectUri);
  const me = await fetchSpotifyProfile(tokens.access_token);
  const isPremium = me.product === 'premium';

  const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString();

  const { error: tokenError } = await admin.from('provider_tokens').upsert(
    {
      user_id: userId,
      provider: 'spotify',
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? null,
      scope: tokens.scope ?? SCOPES,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,provider' }
  );
  if (tokenError) {
    console.error('provider_tokens upsert failed', tokenError);
    throw new HttpError('unknown', 'Could not save your Spotify connection.', 500);
  }

  // `is_premium` is denormalised onto the profile so every other surface can
  // answer "can this person host on Spotify?" without a Spotify round-trip.
  const { error: profileError } = await admin
    .from('profiles')
    .update({ spotify_linked: true, is_premium: isPremium })
    .eq('id', userId);
  if (profileError) {
    console.error('profile update failed', profileError);
    throw new HttpError('unknown', 'Could not update your profile.', 500);
  }

  return jsonResponse({ isPremium, displayName: me.display_name ?? null });
}

// ----------------------------------------------------------------- action=unlink

/**
 * Disconnecting has to happen server-side for the same reason linking does:
 * the client has no read or delete rights on `provider_tokens`.
 */
async function handleUnlink(req: Request, admin: SupabaseClient): Promise<Response> {
  const userId = await requireUserId(req, admin);

  const { error: deleteError } = await admin
    .from('provider_tokens')
    .delete()
    .eq('user_id', userId)
    .eq('provider', 'spotify');
  if (deleteError) {
    console.error('provider_tokens delete failed', deleteError);
    throw new HttpError('unknown', 'Could not disconnect Spotify.', 500);
  }

  const { error: profileError } = await admin
    .from('profiles')
    .update({ spotify_linked: false, is_premium: false })
    .eq('id', userId);
  if (profileError) {
    console.error('profile update failed', profileError);
    throw new HttpError('unknown', 'Could not update your profile.', 500);
  }

  return jsonResponse({ ok: true });
}

// ------------------------------------------------------------------------ router

Deno.serve(async (req: Request): Promise<Response> => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const action = new URL(req.url).searchParams.get('action') ?? '';
    const admin = adminClient();

    switch (action) {
      case 'start':
        return await handleStart(req, admin);
      case 'callback':
        return await handleCallback(req, admin);
      case 'unlink':
        return await handleUnlink(req, admin);
      default:
        throw new HttpError(
          'bad_request',
          'Unknown action. Expected action=start, action=callback or action=unlink.',
          400
        );
    }
  } catch (error) {
    return toErrorResponse(error);
  }
});
