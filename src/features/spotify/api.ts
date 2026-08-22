/**
 * Typed client for the `spotify-api` Edge Function.
 *
 * Nothing in the app talks to Spotify directly. The OAuth tokens live in
 * `provider_tokens`, which is RLS-locked with no policies, so the only thing
 * that can reach api.spotify.com is the Edge Function holding the service role
 * key. This module is the one seam between the two, which also means it is the
 * one place that has to understand Spotify's JSON shapes — everything above it
 * consumes the normalised `SpotifyTrack`.
 */

import { supabase } from '@/lib/supabase';
import { PlaybackError, type PlaybackErrorCode } from '@/playback/types';

/** A Spotify track flattened into the shape the `tracks` table stores. */
export type SpotifyTrack = {
  providerId: string;
  title: string;
  artist: string;
  album: string | null;
  durationMs: number;
  isrc: string | null;
  artworkUrl: string | null;
};

// ------------------------------------------------------------- raw Spotify JSON

type SpotifyImage = { url: string; width?: number | null; height?: number | null };
type SpotifyArtistObject = { id: string; name: string };
type SpotifyAlbumObject = { id: string; name: string; images?: SpotifyImage[] };

export type SpotifyTrackObject = {
  id: string;
  uri: string;
  name: string;
  duration_ms: number;
  artists?: SpotifyArtistObject[];
  album?: SpotifyAlbumObject | null;
  external_ids?: { isrc?: string | null };
  is_playable?: boolean;
};

export type SpotifyDevice = {
  id: string | null;
  name: string;
  type: string;
  is_active: boolean;
  is_restricted: boolean;
  volume_percent: number | null;
};

export type SpotifyPlaybackState = {
  device: SpotifyDevice | null;
  is_playing: boolean;
  progress_ms: number | null;
  item: SpotifyTrackObject | null;
  timestamp?: number;
};

// ------------------------------------------------------------------ error mapping

/**
 * The Edge Function already collapsed Spotify's statuses into a closed set; we
 * only have to widen it onto `PlaybackErrorCode`. `rate_limited` becomes
 * `network` because that is how callers should treat it: transient, retryable,
 * not the user's fault.
 */
const EDGE_CODE_TO_PLAYBACK: Record<string, PlaybackErrorCode> = {
  premium_required: 'premium_required',
  no_active_device: 'no_active_device',
  not_playable: 'not_playable',
  auth_expired: 'auth_expired',
  rate_limited: 'network',
  bad_request: 'unknown',
  forbidden: 'unknown',
  unknown: 'unknown',
};

type EdgeErrorBody = { error?: { code?: string; message?: string } };

/**
 * `functions.invoke` throws away the response body on non-2xx and hands back a
 * `FunctionsHttpError` carrying the raw `Response` on `.context`. Newer
 * versions also surface it as `result.response`. Check both so the structured
 * `{ error: { code, message } }` body is never lost.
 */
function responseFrom(result: { response?: Response }, error: unknown): Response | null {
  if (result.response instanceof Response) return result.response;
  const context = (error as { context?: unknown } | null | undefined)?.context;
  return context instanceof Response ? context : null;
}

async function toPlaybackError(
  result: { response?: Response },
  error: unknown
): Promise<PlaybackError> {
  const response = responseFrom(result, error);

  if (!response) {
    // No HTTP response at all: DNS, offline, aborted request.
    const message = error instanceof Error ? error.message : 'Could not reach Spotify.';
    return new PlaybackError('network', message);
  }

  let body: EdgeErrorBody | null = null;
  try {
    body = (await response.clone().json()) as EdgeErrorBody;
  } catch {
    body = null;
  }

  const rawCode = body?.error?.code ?? 'unknown';
  const code = EDGE_CODE_TO_PLAYBACK[rawCode] ?? 'unknown';
  const message = body?.error?.message ?? 'Spotify request failed.';

  // `auth_expired` is the one code the user cannot retry their way out of —
  // they have to re-link the account.
  return new PlaybackError(code, message, code !== 'auth_expired');
}

// ------------------------------------------------------------------ the transport

type ProxyRequest = {
  path: string;
  method?: 'GET' | 'PUT' | 'POST';
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
};

async function callSpotify<T>(request: ProxyRequest): Promise<T | null> {
  const result = await supabase.functions.invoke<T>('spotify-api', { body: request });

  if (result.error) {
    throw await toPlaybackError(result, result.error as unknown);
  }
  return result.data ?? null;
}

// -------------------------------------------------------------------- normalising

function largestArtwork(images: SpotifyImage[] | undefined): string | null {
  if (!images || images.length === 0) return null;
  const largest = images.reduce((best, image) =>
    (image.width ?? 0) > (best.width ?? 0) ? image : best
  );
  return largest.url ?? null;
}

export function normalizeTrack(raw: SpotifyTrackObject): SpotifyTrack {
  return {
    providerId: raw.id,
    title: raw.name,
    // Spotify models features as extra artists; joining them keeps the credit
    // intact in one line rather than silently dropping the collaborators.
    artist: (raw.artists ?? []).map((artist) => artist.name).join(', '),
    album: raw.album?.name ?? null,
    durationMs: raw.duration_ms,
    isrc: raw.external_ids?.isrc ?? null,
    artworkUrl: largestArtwork(raw.album?.images),
  };
}

function isTrackObject(value: SpotifyTrackObject | null | undefined): value is SpotifyTrackObject {
  return value != null && typeof value.id === 'string';
}

// ------------------------------------------------------------------ public surface

/** Spotify caps `limit` at 50; anything higher is a 400 from upstream. */
const MAX_SEARCH_LIMIT = 50;

export async function searchTracks(q: string, limit = 20): Promise<SpotifyTrack[]> {
  const query = q.trim();
  if (query === '') return [];

  const data = await callSpotify<{ tracks?: { items?: (SpotifyTrackObject | null)[] } }>({
    path: 'search',
    method: 'GET',
    // No `market` param on purpose: the proxy always calls Spotify with the
    // user's own access token, and Spotify then scopes availability to that
    // account's country automatically.
    query: {
      q: query,
      type: 'track',
      limit: Math.min(Math.max(Math.trunc(limit), 1), MAX_SEARCH_LIMIT),
    },
  });

  return (data?.tracks?.items ?? []).filter(isTrackObject).map(normalizeTrack);
}

export async function getTrack(id: string): Promise<SpotifyTrack> {
  // Spotify ids are base62. Validating here means a malformed id fails fast
  // instead of tripping the Edge Function's allowlist as a 403.
  if (!/^[A-Za-z0-9]{1,64}$/.test(id)) {
    throw new PlaybackError('not_playable', 'That is not a valid Spotify track id.', false);
  }

  const data = await callSpotify<SpotifyTrackObject>({
    path: `tracks/${id}`,
    method: 'GET',
  });

  if (!isTrackObject(data)) {
    throw new PlaybackError('not_playable', 'Spotify has no such track.', false);
  }
  return normalizeTrack(data);
}

export async function getDevices(): Promise<SpotifyDevice[]> {
  const data = await callSpotify<{ devices?: SpotifyDevice[] }>({
    path: 'me/player/devices',
    method: 'GET',
  });
  return data?.devices ?? [];
}

/** `null` when nothing is playing — Spotify answers 204 for an idle account. */
export async function getCurrentlyPlaying(): Promise<SpotifyPlaybackState | null> {
  return callSpotify<SpotifyPlaybackState>({
    path: 'me/player/currently-playing',
    method: 'GET',
  });
}

/** `null` when there is no active playback session on any device. */
export async function getPlaybackState(): Promise<SpotifyPlaybackState | null> {
  return callSpotify<SpotifyPlaybackState>({ path: 'me/player', method: 'GET' });
}

export type PlayOptions = {
  /** Full `spotify:track:...` URI. Omit to resume whatever is loaded. */
  trackUri?: string;
  positionMs?: number;
  deviceId?: string | null;
};

export async function play({ trackUri, positionMs, deviceId }: PlayOptions = {}): Promise<void> {
  const body: Record<string, unknown> = {};
  if (trackUri) body.uris = [trackUri];
  if (positionMs != null) body.position_ms = Math.max(0, Math.round(positionMs));

  await callSpotify({
    path: 'me/player/play',
    method: 'PUT',
    query: deviceId ? { device_id: deviceId } : undefined,
    // An empty body means "resume"; sending `{}` would reset the queue.
    body: Object.keys(body).length > 0 ? body : undefined,
  });
}

export async function pause(): Promise<void> {
  await callSpotify({ path: 'me/player/pause', method: 'PUT' });
}

export async function seek(positionMs: number): Promise<void> {
  await callSpotify({
    path: 'me/player/seek',
    method: 'PUT',
    query: { position_ms: Math.max(0, Math.round(positionMs)) },
  });
}

/** `volume` is 0..1 to match `PlaybackAdapter.setVolume`; Spotify wants 0..100. */
export async function setVolume(volume: number): Promise<void> {
  const percent = Math.round(Math.min(Math.max(volume, 0), 1) * 100);
  await callSpotify({
    path: 'me/player/volume',
    method: 'PUT',
    query: { volume_percent: percent },
  });
}
