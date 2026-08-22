/**
 * Authenticated Spotify Web API proxy.
 *
 * Every Spotify call in Aux goes client -> here -> Spotify. The client only
 * ever holds its own Supabase JWT; the Spotify access and refresh tokens live
 * in `provider_tokens`, which is RLS-locked with zero policies so only the
 * service role can read them.
 *
 * Three things make this a proxy rather than an open tunnel:
 *
 *  1. The user id comes from the verified JWT, never from the body. Otherwise
 *     any signed-in user could drive any other user's Spotify account by
 *     passing someone else's id.
 *  2. Paths are allowlisted. An unrestricted proxy would hand every user the
 *     full Web API under a token they cannot see — playlist deletion, follows,
 *     library writes, the lot.
 *  3. Upstream failures are normalised to a closed set of error codes, so the
 *     UI can say "open Spotify on a device" instead of surfacing a raw 404.
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
  toErrorResponse,
} from '../_shared/cors.ts';

const SPOTIFY_ACCOUNTS = 'https://accounts.spotify.com';
const SPOTIFY_API = 'https://api.spotify.com/v1';

/** Refresh this far ahead of expiry so a request in flight cannot age out. */
const REFRESH_WINDOW_MS = 60_000;

/**
 * Exactly the endpoints Aux needs: read playback, drive playback, and look up
 * tracks. `me/player/volume` is here because the Spotify adapter advertises
 * `canSetVolume: true` — push-to-talk ducking has to be able to reach it.
 */
const ALLOWED_PATHS = new Set([
  'me/player',
  'me/player/play',
  'me/player/pause',
  'me/player/seek',
  'me/player/volume',
  'me/player/currently-playing',
  'me/player/devices',
  'search',
  'tracks',
]);

/** `tracks/{id}`. Spotify ids are base62, so anything else is a probe. */
const TRACK_BY_ID = /^tracks\/[A-Za-z0-9]{1,64}$/;

const ALLOWED_METHODS = new Set(['GET', 'PUT', 'POST']);

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

// -------------------------------------------------------------- request parsing

type ProxyRequest = {
  path: string;
  method: string;
  query: Record<string, string>;
  body: unknown;
};

function normalisePath(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new HttpError('bad_request', 'A "path" string is required.', 400);
  }

  const path = raw.trim().replace(/^\/+/, '').replace(/\/+$/, '');

  // Reject anything that could escape the allowlist by re-pointing the URL:
  // an absolute URL, a protocol-relative host, or a traversal segment.
  if (path === '' || path.includes('..') || path.includes('//') || /^[a-z][a-z0-9+.-]*:/i.test(path)) {
    throw new HttpError('forbidden', 'That Spotify endpoint is not permitted.', 403);
  }

  if (!ALLOWED_PATHS.has(path) && !TRACK_BY_ID.test(path)) {
    throw new HttpError('forbidden', 'That Spotify endpoint is not permitted.', 403);
  }

  return path;
}

function normaliseQuery(raw: unknown): Record<string, string> {
  if (raw == null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new HttpError('bad_request', '"query" must be an object.', 400);
  }

  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value == null) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = String(value);
    }
  }
  return out;
}

async function parseRequest(req: Request): Promise<ProxyRequest> {
  const body = await readJsonBody(req);
  const method = typeof body.method === 'string' ? body.method.toUpperCase() : 'GET';

  if (!ALLOWED_METHODS.has(method)) {
    throw new HttpError('forbidden', `Method ${method} is not permitted.`, 403);
  }

  return {
    path: normalisePath(body.path),
    method,
    query: normaliseQuery(body.query),
    body: body.body ?? null,
  };
}

// --------------------------------------------------------------- token handling

type TokenRow = {
  access_token: string;
  refresh_token: string | null;
  expires_at: string;
};

/**
 * Wipes the stored link. Called when Spotify tells us the refresh token is
 * dead (the user revoked access in their Spotify settings). Leaving a stale
 * row behind would make every later request fail slowly instead of the UI
 * simply showing "Connect Spotify" again.
 */
async function clearLink(admin: SupabaseClient, userId: string): Promise<void> {
  await admin.from('provider_tokens').delete().eq('user_id', userId).eq('provider', 'spotify');
  await admin
    .from('profiles')
    .update({ spotify_linked: false, is_premium: false })
    .eq('id', userId);
}

async function refreshAccessToken(
  admin: SupabaseClient,
  userId: string,
  row: TokenRow
): Promise<string> {
  if (!row.refresh_token) {
    await clearLink(admin, userId);
    throw new HttpError('auth_expired', 'Reconnect your Spotify account.', 401);
  }

  const res = await fetch(`${SPOTIFY_ACCOUNTS}/api/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: row.refresh_token,
      client_id: env('SPOTIFY_CLIENT_ID'),
    }),
  });

  if (!res.ok) {
    await clearLink(admin, userId);
    throw new HttpError('auth_expired', 'Reconnect your Spotify account.', 401);
  }

  const tokens = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };

  const { error } = await admin.from('provider_tokens').upsert(
    {
      user_id: userId,
      provider: 'spotify',
      access_token: tokens.access_token,
      // Spotify only sometimes rotates the refresh token; keep the old one
      // when it does not, or the next refresh has nothing to present.
      refresh_token: tokens.refresh_token ?? row.refresh_token,
      scope: tokens.scope,
      expires_at: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,provider' }
  );
  if (error) {
    console.error('token refresh persist failed', error);
  }

  return tokens.access_token;
}

async function accessTokenFor(admin: SupabaseClient, userId: string): Promise<string> {
  const { data, error } = await admin
    .from('provider_tokens')
    .select('access_token, refresh_token, expires_at')
    .eq('user_id', userId)
    .eq('provider', 'spotify')
    .maybeSingle();

  if (error) {
    console.error('provider_tokens read failed', error);
    throw new HttpError('unknown', 'Could not read your Spotify connection.', 500);
  }

  const row = (data ?? null) as TokenRow | null;
  if (!row) {
    throw new HttpError('auth_expired', 'Connect your Spotify account first.', 401);
  }

  const expiresInMs = new Date(row.expires_at).getTime() - Date.now();
  if (!Number.isFinite(expiresInMs) || expiresInMs < REFRESH_WINDOW_MS) {
    return refreshAccessToken(admin, userId, row);
  }
  return row.access_token;
}

// ------------------------------------------------------------- upstream mapping

type SpotifyErrorBody = {
  error?: { status?: number; message?: string; reason?: string };
};

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/**
 * Collapses Spotify's status + `reason` into the closed error set the client
 * knows how to act on. The two that matter most are PREMIUM_REQUIRED (the
 * account cannot be remote-controlled at all) and NO_ACTIVE_DEVICE (it can,
 * but nothing is listening yet) — both are recoverable with a clear prompt,
 * and both arrive as generic 403/404s if you do not read `reason`.
 */
function mapUpstreamError(status: number, payload: unknown, retryAfter: string | null): HttpError {
  const parsed = (payload ?? {}) as SpotifyErrorBody;
  const reason = parsed.error?.reason ?? '';
  const message = parsed.error?.message ?? 'Spotify request failed.';

  if (status === 429) {
    const seconds = retryAfter ?? '';
    return new HttpError(
      'rate_limited',
      seconds
        ? `Spotify is rate limiting us. Try again in ${seconds}s.`
        : 'Spotify is rate limiting us. Try again shortly.',
      429,
      retryAfter ? { 'Retry-After': retryAfter } : {}
    );
  }

  if (status === 401) {
    return new HttpError('auth_expired', 'Reconnect your Spotify account.', 401);
  }

  if (status === 403) {
    if (reason === 'PREMIUM_REQUIRED') {
      return new HttpError(
        'premium_required',
        'Spotify Premium is required to control playback.',
        403
      );
    }
    return new HttpError('forbidden', message, 403);
  }

  if (status === 404) {
    if (reason === 'NO_ACTIVE_DEVICE') {
      return new HttpError(
        'no_active_device',
        'Open Spotify on a device, then try again.',
        404
      );
    }
    return new HttpError('not_playable', message, 404);
  }

  return new HttpError('unknown', message, status >= 500 ? 502 : 400);
}

// ------------------------------------------------------------------------ router

Deno.serve(async (req: Request): Promise<Response> => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const admin = adminClient();
    const userId = await requireUserId(req, admin);
    const request = await parseRequest(req);
    const accessToken = await accessTokenFor(admin, userId);

    const url = new URL(`${SPOTIFY_API}/${request.path}`);
    for (const [key, value] of Object.entries(request.query)) {
      url.searchParams.set(key, value);
    }

    const hasBody = request.body != null && request.method !== 'GET';
    const upstream = await fetch(url.toString(), {
      method: request.method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      },
      body: hasBody ? JSON.stringify(request.body) : undefined,
    });

    // Every playback command (play/pause/seek/volume) answers 204 with no body.
    // Normalise that to JSON `null` so the client always parses a JSON body.
    if (upstream.status === 204) return jsonResponse(null);

    const text = await upstream.text();
    const payload = text ? safeJson(text) : null;

    if (!upstream.ok) {
      throw mapUpstreamError(upstream.status, payload, upstream.headers.get('retry-after'));
    }

    return jsonResponse(payload);
  } catch (error) {
    return toErrorResponse(error);
  }
});
