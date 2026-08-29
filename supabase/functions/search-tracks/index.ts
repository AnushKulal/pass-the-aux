/**
 * search-tracks — the only way a device searches for music.
 *
 * Neither search can run on the device: the Spotify access token lives in
 * `provider_tokens`, which has RLS enabled and zero policies, and the YouTube
 * API key would be readable by anyone who unpacked the app bundle. So the
 * client asks here and gets back a provider-neutral list; picking a result
 * hands its `providerId` to `resolve-track`, which turns it into a catalog row.
 *
 * Request:  { provider: 'spotify' | 'youtube', query: string, limit?: number }
 * Response: { results: ProviderTrack-shaped rows }
 *
 * Security: this function reads `provider_tokens` with the service role, which
 * bypasses RLS entirely. The caller's JWT is therefore verified BEFORE that
 * client is created, and the user id comes from the verified token — never from
 * the body, or any signed-in user could search on someone else's Spotify link.
 *
 * Required secrets:
 *   SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, YOUTUBE_API_KEY
 *   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY  (injected)
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
import {
  ProviderError,
  isTopicChannel,
  requireEnv,
  spotifySearch,
  spotifyUserToken,
  youtubeSearch,
  type Provider,
  type ProviderTrack,
} from '../_shared/providers.ts';

/** The row shape `TrackSearchResult` in `src/features/tracks/search.ts` parses. */
type SearchResult = {
  provider: Provider;
  providerId: string;
  title: string;
  artist: string;
  album: string | null;
  durationMs: number;
  artworkUrl: string | null;
  isrc: string | null;
};

const DEFAULT_LIMIT = 20;
/**
 * A YouTube search.list costs 100 units of a 10,000/day quota — a hundred
 * searches for the entire user base, per day. That budget is why the client
 * debounces keystrokes and caches each query for five minutes, and why the
 * ceiling here is 25: one page of results is all anyone scrolls anyway.
 */
const MIN_LIMIT = 1;
const MAX_LIMIT = 25;

Deno.serve(async (req: Request): Promise<Response> => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    if (req.method !== 'POST') {
      throw new HttpError('bad_request', 'Use POST.', 405);
    }

    // Verify the caller BEFORE creating the service-role client, so there is no
    // code path where an unauthenticated request touches an RLS-bypassing key.
    const userId = await verifyCaller(req);
    const { provider, query, limit } = await parseBody(req);

    const service = createClient(
      requireEnv('SUPABASE_URL'),
      requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { persistSession: false, autoRefreshToken: false } }
    );

    return jsonResponse({ results: await search(service, userId, provider, query, limit) });
  } catch (error) {
    // Provider codes ('quota_exceeded', 'provider_unavailable') are the same
    // vocabulary `resolve-track` speaks, and the client parses both functions
    // with one `edgeFunctionError`. Passing them through keeps "the YouTube
    // quota ran out" sayable instead of flattening it to a generic failure.
    if (error instanceof ProviderError) {
      return jsonResponse({ error: { code: error.code, message: error.message } }, error.status);
    }
    return toErrorResponse(error);
  }
});

/** Returns the caller's user id, or throws 401. */
async function verifyCaller(req: Request): Promise<string> {
  const authorization = req.headers.get('Authorization') ?? '';
  if (!/^bearer\s+\S+/i.test(authorization)) {
    throw new ProviderError(401, 'unauthorized', 'Missing bearer token.');
  }

  const asCaller = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await asCaller.auth.getUser();
  if (error || !data.user) {
    throw new ProviderError(401, 'unauthorized', 'Invalid or expired session.');
  }
  return data.user.id;
}

async function parseBody(
  req: Request
): Promise<{ provider: Provider; query: string; limit: number }> {
  const body = await readJsonBody(req);
  const provider = body.provider;

  if (provider !== 'spotify' && provider !== 'youtube') {
    throw new HttpError('bad_request', "`provider` must be 'spotify' or 'youtube'.", 400);
  }

  // Clamped rather than rejected: a bad limit is not worth failing a search the
  // user is already waiting on, and the ceiling is what protects the quota.
  const raw =
    typeof body.limit === 'number' && Number.isFinite(body.limit)
      ? Math.trunc(body.limit)
      : DEFAULT_LIMIT;

  return {
    provider,
    query: requiredString(body, 'query'),
    limit: Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, raw)),
  };
}

/**
 * Spotify results need the caller's *own* token — the app token would search a
 * catalog this user may not be able to play, and the whole point of the
 * provider split is that everything listed here is playable for them.
 *
 * With no usable Spotify link there is nothing to search with, so YouTube
 * answers instead. Falling back beats erroring: the client asked for what it
 * believed it could play, and an empty list is a dead end in the one flow that
 * matters most — adding a song to a Session.
 */
async function search(
  service: SupabaseClient,
  userId: string,
  provider: Provider,
  query: string,
  limit: number
): Promise<SearchResult[]> {
  if (provider === 'spotify') {
    const token = await spotifyUserToken(service, userId);
    if (token) return (await spotifySearch(token, query, limit)).map(toSearchResult);
  }

  /*
    SORT THEN CUT, in that order.

    `youtubeSearch` now over-fetches so this preference has material to work
    with — slicing before the sort would throw away the Topic uploads it exists
    to promote, which is the same as not having it.
  */
  return (await youtubeSearch(query, limit))
    .sort(topicFirst)
    .slice(0, limit)
    .map(toSearchResult);
}

/**
 * Float auto-generated "Artist - Topic" uploads to the top: they are the
 * label's own audio, so they carry the right cut with no intro and no ad roll.
 * Sort is stable, so everything else keeps YouTube's relevance order.
 */
function topicFirst(a: ProviderTrack, b: ProviderTrack): number {
  return Number(isTopicChannel(b.channel)) - Number(isTopicChannel(a.channel));
}

function toSearchResult(track: ProviderTrack): SearchResult {
  return {
    provider: track.provider,
    providerId: track.providerId,
    // The cleaned title, which is also what the catalog row will hold once this
    // result is resolved — otherwise the search row and the queued row disagree.
    title: track.displayTitle || track.title,
    // A YouTube upload with no "Artist - " in the title has only its channel.
    artist: track.artist || (track.channel ?? ''),
    album: track.album,
    durationMs: track.durationMs,
    artworkUrl: track.artworkUrl,
    isrc: track.isrc,
  };
}
