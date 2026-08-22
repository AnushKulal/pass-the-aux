/**
 * resolve-track — the cross-provider bridge.
 *
 * A Session can hold a Spotify Premium listener and a free YouTube listener at
 * the same time, and both must hear the same song at the same position. So a
 * track is stored once in `tracks`, provider-agnostic, and `track_links` maps
 * it to a Spotify id and a YouTube id. This function builds that mapping once
 * and it is cached forever, so the whole app pays the cost of resolving a given
 * song exactly one time.
 *
 * Request:  { from: 'spotify' | 'youtube', providerId: string }
 * Response: { track, links: { spotify?, youtube? }, needsConfirmation, candidates? }
 *
 * Security: writes go through the service role because the catalog is shared
 * infrastructure that RLS would otherwise block. The service role bypasses RLS
 * entirely, so the caller's JWT is verified BEFORE any of it is touched — this
 * endpoint must never be reachable unauthenticated.
 */

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

import { ACCEPT_THRESHOLD, rankCandidates, type MatchTarget } from '../_shared/match.ts';

import {
  ProviderError,
  requireEnv,
  spotifySearch,
  spotifyToken,
  spotifyTrack,
  youtubeSearch,
  youtubeVideo,
  type Provider,
  type ProviderTrack,
} from '../_shared/providers.ts';

type TrackRow = {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  duration_ms: number;
  isrc: string | null;
  artwork_url: string | null;
  created_at: string;
};

type LinkRow = { provider: Provider; provider_id: string; confidence: number };

type CandidateDto = {
  provider: Provider;
  providerId: string;
  title: string;
  artist: string;
  durationMs: number;
  artworkUrl: string | null;
  score: number;
};

type ResolveResponse = {
  track: TrackRow;
  links: Partial<Record<Provider, string>>;
  needsConfirmation: boolean;
  candidates?: CandidateDto[];
};

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** How many candidates we hand back for the user to disambiguate. */
const CANDIDATE_LIMIT = 3;
/** Search width. Wider costs YouTube quota; 10 is plenty once scoring is doing its job. */
const SEARCH_LIMIT = 10;

/**
 * The Deno client is created without the generated `Database` type — that file
 * lives in the app bundle, outside this function's import graph — so query
 * results are shaped here instead.
 */
function rows<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// ============================================================ request handling

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  try {
    if (req.method !== 'POST') {
      throw new ProviderError(405, 'method_not_allowed', 'Use POST.');
    }

    // Verify the caller BEFORE creating the service-role client, so there is no
    // code path where an unauthenticated request touches an RLS-bypassing key.
    const userId = await verifyCaller(req);
    const { from, providerId } = await parseBody(req);

    const service = createClient(
      requireEnv('SUPABASE_URL'),
      requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { persistSession: false, autoRefreshToken: false } }
    );

    return json(await resolve(service, userId, from, providerId), 200);
  } catch (error) {
    if (error instanceof ProviderError) {
      return json({ error: { code: error.code, message: error.message } }, error.status);
    }
    console.error('resolve-track failed', error);
    return json({ error: { code: 'internal', message: 'Track resolution failed.' } }, 500);
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

async function parseBody(req: Request): Promise<{ from: Provider; providerId: string }> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ProviderError(400, 'bad_request', 'Body must be JSON.');
  }

  if (typeof body !== 'object' || body === null) {
    throw new ProviderError(400, 'bad_request', 'Body must be a JSON object.');
  }

  const record = body as Record<string, unknown>;
  const from = record.from;
  const providerId = record.providerId;

  if (from !== 'spotify' && from !== 'youtube') {
    throw new ProviderError(400, 'bad_request', "`from` must be 'spotify' or 'youtube'.");
  }
  // Both providers use short URL-safe ids. Constraining the shape here keeps
  // anything strange out of the outbound provider URLs we build from it.
  if (typeof providerId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(providerId)) {
    throw new ProviderError(400, 'bad_request', '`providerId` is not a valid provider id.');
  }

  return { from, providerId };
}

// ================================================================ the resolver

async function resolve(
  service: SupabaseClient,
  userId: string,
  from: Provider,
  providerId: string
): Promise<ResolveResponse> {
  const other: Provider = from === 'spotify' ? 'youtube' : 'spotify';

  // 1. Cache hit — the common path, and one query.
  const cached = await loadCachedTrack(service, from, providerId);
  let track: TrackRow | null = cached?.track ?? null;
  let links: Partial<Record<Provider, string>> = cached?.links ?? {};

  if (track && links[other]) {
    return { track, links, needsConfirmation: false };
  }

  // 2 + 3. Unknown to us: ask the source provider what this id is, then find or
  // create the catalog row for it.
  if (!track) {
    const source = await fetchProviderTrack(service, userId, from, providerId);
    track = await findOrCreateTrack(service, source);
  }

  // A cached track missing the other provider's link means a previous attempt
  // scored too low to store. Searching again is how it eventually gets one;
  // that only happens for genuinely hard-to-match tracks, so it stays rare.
  const target: MatchTarget = {
    title: track.title,
    artist: track.artist,
    durationMs: track.duration_ms,
  };

  // 4. Score every candidate from the other provider and take the best.
  const candidates = await searchProvider(service, userId, other, target);
  const ranked = rankCandidates(target, candidates).slice(0, CANDIDATE_LIMIT);
  const best = ranked[0];
  const accepted = best && best.score >= ACCEPT_THRESHOLD ? best : null;

  // 5. Persist. The source link is exact — we were handed that id — so it is
  // always confidence 1. A below-threshold guess is deliberately NOT written:
  // `track_links` is unique on (provider, provider_id) and every future listener
  // reads it, so a wrong row would poison the shared catalog permanently. The
  // user confirms instead, and confirmMatch writes the row they picked.
  const pending: LinkRow[] = [];
  if (!links[from]) {
    pending.push({ provider: from, provider_id: providerId, confidence: 1 });
  }
  if (accepted) {
    pending.push({
      provider: other,
      provider_id: accepted.candidate.providerId,
      confidence: Math.round(accepted.score * 1000) / 1000,
    });
  }

  if (pending.length > 0) {
    await writeLinks(service, track.id, pending);
    links = await loadLinks(service, track.id);
  }

  const needsConfirmation = !links[other];
  return {
    track,
    links,
    needsConfirmation,
    candidates: needsConfirmation ? ranked.map(toCandidateDto) : undefined,
  };
}

function toCandidateDto(entry: {
  candidate: ProviderTrack;
  score: number;
}): CandidateDto {
  return {
    provider: entry.candidate.provider,
    providerId: entry.candidate.providerId,
    title: entry.candidate.title,
    artist: entry.candidate.artist || (entry.candidate.channel ?? ''),
    durationMs: entry.candidate.durationMs,
    artworkUrl: entry.candidate.artworkUrl,
    score: Math.round(entry.score * 1000) / 1000,
  };
}

// ------------------------------------------------------------------- catalogue

type CachedRow = { track: TrackRow & { track_links: LinkRow[] } };

/**
 * One round trip for the cache hit: filter on the link row, embed its track,
 * and embed that track's full link set. Filtering from the `track_links` side
 * (rather than filtering an embedded resource) is what keeps the nested link
 * list unfiltered — otherwise PostgREST would hand back only the row we matched
 * on and we would lose the other provider's id.
 */
async function loadCachedTrack(
  service: SupabaseClient,
  provider: Provider,
  providerId: string
): Promise<{ track: TrackRow; links: Partial<Record<Provider, string>> } | null> {
  const { data, error } = await service
    .from('track_links')
    .select('track:tracks!inner(*, track_links(provider, provider_id, confidence))')
    .eq('provider', provider)
    .eq('provider_id', providerId)
    .limit(1);

  if (error) throw new ProviderError(500, 'db_error', error.message);

  const row = rows<CachedRow>(data)[0];
  if (!row?.track) return null;

  const { track_links: linkRows, ...track } = row.track;
  return { track, links: toLinkMap(linkRows ?? []) };
}

function toLinkMap(rows: readonly LinkRow[]): Partial<Record<Provider, string>> {
  const map: Partial<Record<Provider, string>> = {};
  for (const row of rows) {
    map[row.provider] = row.provider_id;
  }
  return map;
}

async function loadLinks(
  service: SupabaseClient,
  trackId: string
): Promise<Partial<Record<Provider, string>>> {
  const { data, error } = await service
    .from('track_links')
    .select('provider, provider_id, confidence')
    .eq('track_id', trackId);

  if (error) throw new ProviderError(500, 'db_error', error.message);
  return toLinkMap(rows<LinkRow>(data));
}

/**
 * Written one row at a time on purpose: a single statement carrying both links
 * would roll both back if either hit a unique violation, and losing the source
 * link — the one id we know for certain — is the worst possible outcome here.
 */
async function writeLinks(
  service: SupabaseClient,
  trackId: string,
  rows: readonly LinkRow[]
): Promise<void> {
  for (const row of rows) {
    // Ignore duplicates rather than overwrite: if another request linked this
    // id first, its row is as valid as ours and a Session may already be
    // playing from it. First writer wins, quietly.
    const { error } = await service
      .from('track_links')
      .upsert({ ...row, track_id: trackId }, { onConflict: 'track_id,provider', ignoreDuplicates: true });

    // 23505 here is the *other* unique index, (provider, provider_id): this
    // provider id is already mapped to a different track. Nothing a request can
    // fix — the existing mapping stands, and the response reports what the
    // database actually holds rather than what we wanted to write.
    if (error && error.code !== '23505') {
      throw new ProviderError(500, 'db_error', error.message);
    }
  }
}

/**
 * ISRC is the industry recording identifier and the strongest dedupe key we
 * ever get; when Spotify gives us one, use it and nothing else. YouTube never
 * does, so a YouTube-sourced track falls back to matching the catalog on
 * metadata — otherwise the same song queued from YouTube and from Spotify would
 * become two rows and the Session would treat them as different tracks.
 */
async function findOrCreateTrack(
  service: SupabaseClient,
  source: ProviderTrack
): Promise<TrackRow> {
  if (source.isrc) {
    const existing = await trackByIsrc(service, source.isrc);
    if (existing) return existing;
  } else {
    const twin = await trackByMetadata(service, source);
    if (twin) return twin;
  }

  const { data, error } = await service
    .from('tracks')
    .insert({
      title: source.displayTitle || source.title,
      artist: source.artist,
      album: source.album,
      duration_ms: source.durationMs,
      isrc: source.isrc,
      artwork_url: source.artworkUrl,
    })
    .select('*')
    .limit(1);

  if (error) {
    // Another request inserted the same ISRC between our read and our write.
    if (error.code === '23505' && source.isrc) {
      const raced = await trackByIsrc(service, source.isrc);
      if (raced) return raced;
    }
    throw new ProviderError(500, 'db_error', error.message);
  }

  const inserted = rows<TrackRow>(data)[0];
  if (!inserted) throw new ProviderError(500, 'db_error', 'Track insert returned no row.');
  return inserted;
}

async function trackByIsrc(service: SupabaseClient, isrc: string): Promise<TrackRow | null> {
  const { data, error } = await service
    .from('tracks')
    .select('*')
    .eq('isrc', isrc)
    .limit(1);

  if (error) throw new ProviderError(500, 'db_error', error.message);
  return rows<TrackRow>(data)[0] ?? null;
}

/** Duration window in ms for the no-ISRC dedupe sweep. */
const TWIN_WINDOW_MS = 3_000;

async function trackByMetadata(
  service: SupabaseClient,
  source: ProviderTrack
): Promise<TrackRow | null> {
  const { data, error } = await service
    .from('tracks')
    .select('*')
    .gte('duration_ms', source.durationMs - TWIN_WINDOW_MS)
    .lte('duration_ms', source.durationMs + TWIN_WINDOW_MS)
    .limit(50);

  if (error) throw new ProviderError(500, 'db_error', error.message);

  const twins = rows<TrackRow>(data);
  if (twins.length === 0) return null;

  // Same scorer as the cross-provider match, so "is this the same recording?"
  // is answered one way in this codebase, not two.
  const target: MatchTarget = {
    title: source.displayTitle || source.title,
    artist: source.artist,
    durationMs: source.durationMs,
  };
  const [best] = rankCandidates(
    target,
    twins.map((row) => ({
      row,
      title: row.title,
      artist: row.artist,
      durationMs: row.duration_ms,
    }))
  );

  return best && best.score >= ACCEPT_THRESHOLD ? best.candidate.row : null;
}

// =========================================================== provider dispatch

async function fetchProviderTrack(
  service: SupabaseClient,
  userId: string,
  provider: Provider,
  providerId: string
): Promise<ProviderTrack> {
  return provider === 'spotify'
    ? await spotifyTrack(await spotifyToken(service, userId), providerId)
    : await youtubeVideo(providerId);
}

async function searchProvider(
  service: SupabaseClient,
  userId: string,
  provider: Provider,
  target: MatchTarget
): Promise<ProviderTrack[]> {
  const query = `${target.title} ${target.artist}`.trim();
  if (!query) return [];

  try {
    return provider === 'spotify'
      ? await spotifySearch(await spotifyToken(service, userId), query, SEARCH_LIMIT)
      : await youtubeSearch(query, SEARCH_LIMIT);
  } catch (error) {
    // A search outage must not block queueing: we still have a playable track
    // for the source provider. Return no candidates and let the caller ask.
    if (error instanceof ProviderError && error.status >= 500) {
      console.error(`${provider} search failed`, error);
      return [];
    }
    throw error;
  }
}
