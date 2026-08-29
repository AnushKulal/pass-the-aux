/**
 * Spotify and YouTube, normalised into one shape.
 *
 * `resolve-track` and `search-tracks` both turn provider JSON into the same
 * `ProviderTrack`, and that has to happen in one place. Two copies of the
 * "Artist - Song (Official Video)" parsing would drift, and the two paths would
 * start disagreeing about what a track is — search would list one title and the
 * row it resolves into would hold another.
 *
 * Nothing here reads the request or writes the catalog; callers own that.
 *
 * Required secrets: SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, YOUTUBE_API_KEY.
 */

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

import { cleanTitle, type MatchCandidate } from './match.ts';

export type Provider = 'spotify' | 'youtube';

/**
 * A track as one provider describes it, before it becomes a catalog row.
 *
 * `title` stays exactly as the provider wrote it because that is what the
 * scorer needs — "(Live)" and "(Sped Up)" are the signals it penalises on.
 * `displayTitle` is the cleaned form that goes into the catalog.
 */
export type ProviderTrack = MatchCandidate & {
  provider: Provider;
  providerId: string;
  displayTitle: string;
  album: string | null;
  artworkUrl: string | null;
  isrc: string | null;
};

/**
 * A failure carrying a code the client is allowed to branch on.
 *
 * Deliberately not the `HttpError` in `_shared/cors.ts`: these are the track
 * vocabulary `TrackResolveErrorCode` parses, and `quota_exceeded` in particular
 * has to survive the trip or the UI cannot say the YouTube quota ran out.
 */
export class ProviderError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new ProviderError(500, 'server_misconfigured', `${name} is not configured.`);
  }
  return value;
}

type TokenRow = { access_token: string; refresh_token: string | null; expires_at: string };

// ------------------------------------------------------------------- spotify

export type SpotifyTrackJson = {
  id: string;
  name: string;
  duration_ms: number;
  external_ids?: { isrc?: string };
  album?: { name?: string; images?: { url?: string }[] };
  artists?: { name?: string }[];
};

/** Client-credentials token, cached per warm instance until shortly before expiry. */
let appToken: { value: string; expiresAt: number } | null = null;

async function spotifyAppToken(): Promise<string> {
  if (appToken && appToken.expiresAt > Date.now() + 60_000) return appToken.value;

  const credentials = btoa(
    `${requireEnv('SPOTIFY_CLIENT_ID')}:${requireEnv('SPOTIFY_CLIENT_SECRET')}`
  );
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!response.ok) {
    throw new ProviderError(503, 'provider_unavailable', 'Spotify rejected the app credentials.');
  }

  const body = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) {
    throw new ProviderError(503, 'provider_unavailable', 'Spotify returned no app token.');
  }

  appToken = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return appToken.value;
}

/**
 * The caller's own Spotify token, refreshed if it is close to expiring, or
 * `null` when this user has no link left to use.
 *
 * Search needs that distinction: listing tracks the user cannot play is worse
 * than useless, so a null here means answer from YouTube instead.
 */
export async function spotifyUserToken(
  service: SupabaseClient,
  userId: string
): Promise<string | null> {
  const { data } = await service
    .from('provider_tokens')
    .select('access_token, refresh_token, expires_at')
    .eq('user_id', userId)
    .eq('provider', 'spotify')
    .limit(1);

  const row = (Array.isArray(data) ? (data as TokenRow[])[0] : undefined) ?? null;
  if (!row) return null;

  if (Date.parse(row.expires_at) > Date.now() + 60_000) return row.access_token;
  if (!row.refresh_token) return null;

  const refreshed = await refreshSpotifyToken(row.refresh_token);
  if (!refreshed) return null;

  await service
    .from('provider_tokens')
    .update({
      access_token: refreshed.accessToken,
      // Spotify rotates the refresh token some of the time, and the one we sent
      // dies the moment it does. Persisting only the access token would strand a
      // dead refresh token here and silently un-link the user on the next
      // refresh; keep the old one only when Spotify sent nothing back.
      refresh_token: refreshed.refreshToken ?? row.refresh_token,
      expires_at: new Date(Date.now() + refreshed.expiresIn * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('provider', 'spotify');

  return refreshed.accessToken;
}

/**
 * Prefer the caller's own Spotify token, fall back to an app token.
 *
 * The fallback is not a nicety: the person queueing a YouTube video may have no
 * Spotify account at all, and the Session still needs a Spotify link for the
 * Premium listeners in it. Catalog reads (`/tracks`, `/search`) are public, so
 * an app token is enough for every lookup here.
 */
export async function spotifyToken(service: SupabaseClient, userId: string): Promise<string> {
  return (await spotifyUserToken(service, userId)) ?? (await spotifyAppToken());
}

async function refreshSpotifyToken(
  refreshToken: string
): Promise<{ accessToken: string; expiresIn: number; refreshToken: string | null } | null> {
  const credentials = btoa(
    `${requireEnv('SPOTIFY_CLIENT_ID')}:${requireEnv('SPOTIFY_CLIENT_SECRET')}`
  );
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  });

  // A revoked refresh token is the user's problem to fix by re-linking, not a
  // reason to fail the resolve — the app token still answers catalog queries.
  if (!response.ok) return null;

  const body = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
  };
  return body.access_token
    ? {
        accessToken: body.access_token,
        expiresIn: body.expires_in ?? 3600,
        refreshToken: body.refresh_token ?? null,
      }
    : null;
}

export async function spotifyFetch(token: string, path: string): Promise<unknown> {
  const response = await fetch(`https://api.spotify.com/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (response.status === 404) {
    throw new ProviderError(404, 'not_found', 'Spotify does not know that track id.');
  }
  if (response.status === 429) {
    throw new ProviderError(503, 'provider_unavailable', 'Spotify is rate limiting us.');
  }
  if (!response.ok) {
    throw new ProviderError(503, 'provider_unavailable', `Spotify returned ${response.status}.`);
  }
  return await response.json();
}

export function spotifyToProviderTrack(item: SpotifyTrackJson): ProviderTrack {
  const artist = (item.artists ?? [])
    .map((entry) => entry.name ?? '')
    .filter(Boolean)
    .join(', ');

  return {
    provider: 'spotify',
    providerId: item.id,
    title: item.name,
    // Spotify appends its own noise: "Song - Remastered 2011", "Song - Radio Edit".
    displayTitle: cleanTitle(item.name),
    artist,
    durationMs: item.duration_ms,
    album: item.album?.name ?? null,
    artworkUrl: item.album?.images?.[0]?.url ?? null,
    isrc: item.external_ids?.isrc ?? null,
  };
}

export async function spotifyTrack(token: string, trackId: string): Promise<ProviderTrack> {
  const body = (await spotifyFetch(token, `/tracks/${trackId}`)) as SpotifyTrackJson;
  if (!body?.id || !body.duration_ms) {
    throw new ProviderError(404, 'not_found', 'Spotify returned an unusable track.');
  }
  return spotifyToProviderTrack(body);
}

export async function spotifySearch(
  token: string,
  query: string,
  limit: number
): Promise<ProviderTrack[]> {
  const params = new URLSearchParams({
    q: query,
    type: 'track',
    limit: String(limit),
  });
  const body = (await spotifyFetch(token, `/search?${params}`)) as {
    tracks?: { items?: SpotifyTrackJson[] };
  };

  return (body.tracks?.items ?? [])
    .filter((item) => !!item?.id && !!item.duration_ms)
    .map(spotifyToProviderTrack);
}

// ------------------------------------------------------------------- youtube

export type YouTubeVideoJson = {
  id?: string;
  snippet?: {
    title?: string;
    channelTitle?: string;
    thumbnails?: Record<string, { url?: string } | undefined>;
  };
  contentDetails?: { duration?: string };
};

const TOPIC_SUFFIX = /\s*-\s*topic\s*$/i;

/** "Artist - Topic" uploads are the label's own audio: right cut, no intro, no ads. */
export function isTopicChannel(channelTitle: string | null | undefined): boolean {
  return TOPIC_SUFFIX.test(channelTitle ?? '');
}

/** `PT4M13S` / `PT1H2M3S` → milliseconds. Returns 0 for anything unparseable. */
export function parseIsoDuration(value: string | undefined): number {
  if (!value) return 0;
  const match = /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(value);
  if (!match) return 0;

  const [, days, hours, minutes, seconds] = match;
  const total =
    Number(days ?? 0) * 86_400 +
    Number(hours ?? 0) * 3_600 +
    Number(minutes ?? 0) * 60 +
    Number(seconds ?? 0);
  return Math.round(total * 1000);
}

/**
 * Uploaders write "Artist - Song Title"; auto-generated Topic channels do not
 * (their titles are already clean and the channel name is the artist). Getting
 * this right matters twice over — it is what the catalog row displays, and it
 * is what the Spotify search query is built from.
 */
export function splitYouTubeTitle(
  rawTitle: string,
  channelTitle: string
): { title: string; artist: string } {
  const channelArtist = channelTitle.replace(TOPIC_SUFFIX, '').trim();
  const display = cleanTitle(rawTitle);

  if (TOPIC_SUFFIX.test(channelTitle)) {
    return { title: display, artist: channelArtist };
  }

  const parts = /^(.{1,60}?)\s+[-–—]\s+(.+)$/.exec(display);
  if (parts) {
    const [, left, right] = parts;
    return { title: right.trim(), artist: left.trim() || channelArtist };
  }

  return { title: display, artist: channelArtist };
}

export function youtubeToProviderTrack(item: YouTubeVideoJson): ProviderTrack | null {
  const id = item.id;
  const durationMs = parseIsoDuration(item.contentDetails?.duration);
  const rawTitle = item.snippet?.title ?? '';
  if (!id || !rawTitle || durationMs <= 0) return null;

  const channelTitle = item.snippet?.channelTitle ?? '';
  const { title, artist } = splitYouTubeTitle(rawTitle, channelTitle);
  const thumbnails = item.snippet?.thumbnails ?? {};

  return {
    provider: 'youtube',
    providerId: id,
    title: rawTitle,
    displayTitle: title,
    artist,
    channel: channelTitle,
    durationMs,
    album: null,
    artworkUrl: thumbnails.maxres?.url ?? thumbnails.high?.url ?? thumbnails.medium?.url ?? null,
    isrc: null,
  };
}

export async function youtubeFetch(path: string, params: URLSearchParams): Promise<unknown> {
  params.set('key', requireEnv('YOUTUBE_API_KEY'));
  const response = await fetch(`https://www.googleapis.com/youtube/v3/${path}?${params}`);

  if (response.status === 403) {
    // Almost always the daily quota. Distinct code so the UI can say so.
    throw new ProviderError(503, 'quota_exceeded', 'The YouTube data quota is exhausted for today.');
  }
  if (!response.ok) {
    throw new ProviderError(503, 'provider_unavailable', `YouTube returned ${response.status}.`);
  }
  return await response.json();
}

export async function youtubeVideosById(ids: readonly string[]): Promise<ProviderTrack[]> {
  if (ids.length === 0) return [];

  const body = (await youtubeFetch(
    'videos',
    new URLSearchParams({ part: 'snippet,contentDetails', id: ids.join(',') })
  )) as { items?: YouTubeVideoJson[] };

  const out: ProviderTrack[] = [];
  for (const item of body.items ?? []) {
    const track = youtubeToProviderTrack(item);
    if (track) out.push(track);
  }
  return out;
}

export async function youtubeVideo(videoId: string): Promise<ProviderTrack> {
  const [video] = await youtubeVideosById([videoId]);
  if (!video) {
    throw new ProviderError(404, 'not_found', 'That video is unavailable or has no duration.');
  }
  return video;
}

/**
 * search.list costs 100 quota units against a default of 10,000/day, and it does
 * not return durations — so a second, nearly free videos.list call fetches the
 * one signal the scorer weights heaviest.
 */
export async function youtubeSearch(query: string, limit: number): Promise<ProviderTrack[]> {
  const body = (await youtubeFetch(
    'search',
    new URLSearchParams({
      part: 'snippet',
      type: 'video',
      q: query,
      /*
        OVER-FETCH, THEN LET THE CALLER PREFER.

        `search-tracks` floats "Artist - Topic" uploads to the top of whatever
        comes back, and a sort cannot promote a result that was never returned:
        asking for exactly `limit` items means the page is usually full of
        official music videos and the auto-generated audio never appears at all.
        Fetching a wider page gives that preference something to work with.

        It is close to free. `search.list` costs 100 quota units REGARDLESS of
        `maxResults`, and the `videos.list` call below is 1 unit, so the whole
        widening costs a single extra unit against a 10,000/day allowance. 50 is
        the API's own ceiling.
      */
      maxResults: String(Math.min(50, Math.max(limit, limit * 2))),
      /*
        CATEGORY 10 IS MUSIC, and this is the honest half of the answer to
        "why am I getting adverts".

        Nothing here can remove an advert — YouTube serves those from inside its
        own player and blocking them violates the terms this app has to keep.
        What CAN be changed is WHICH video gets queued, and it matters a lot:
        auto-generated "Artist - Topic" uploads are the label's own audio
        delivered through YouTube's music catalogue and carry far less
        advertising than an official music video on a monetised channel.

        Without this filter the query is a general web-video search that happens
        to contain a song title, so reaction videos, lyric re-uploads and
        adverts-in-waiting all compete on equal terms.
      */
      videoCategoryId: '10',
      // Anything we cannot embed is unplayable in the app, so it is not a
      // candidate no matter how well it scores.
      videoEmbeddable: 'true',
      videoSyndicated: 'true',
    })
  )) as { items?: { id?: { videoId?: string } }[] };

  const ids = (body.items ?? [])
    .map((item) => item.id?.videoId)
    .filter((id): id is string => typeof id === 'string');

  return await youtubeVideosById(ids);
}
