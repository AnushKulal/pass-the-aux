/**
 * Client side of the cross-provider resolver.
 *
 * Queueing a song is provider-agnostic: whatever the user found — a Spotify
 * track or a YouTube video — becomes one catalog track with links to both, so
 * the Premium listener and the free listener in the same Session play the same
 * recording. All of that happens in the `resolve-track` Edge Function; this
 * module is the typed door to it.
 */

import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from '@supabase/supabase-js';

import type { MusicProvider, TrackRow } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';
import type { PlayableRef, ResolvedTrack } from '@/playback/types';

/** One of the alternatives offered when the resolver is not confident enough. */
export type TrackMatchCandidate = {
  provider: MusicProvider;
  providerId: string;
  /** The provider's own title, uncleaned — "(Live)" is exactly what the user needs to see. */
  title: string;
  artist: string;
  durationMs: number;
  artworkUrl: string | null;
  /** 0..1 from the same scorer the server used. */
  score: number;
};

export type TrackResolution = {
  track: ResolvedTrack;
  /**
   * The other provider had no confident match. The track is still playable on
   * the provider it came from — show a picker built from `candidates` and send
   * the answer to `confirmMatch`.
   */
  needsConfirmation: boolean;
  candidates: TrackMatchCandidate[];
};

export type TrackResolveErrorCode =
  | 'unauthorized'
  | 'bad_request'
  | 'not_found'
  /** The YouTube data quota is spent for the day. */
  | 'quota_exceeded'
  | 'provider_unavailable'
  | 'network'
  | 'internal';

export class TrackResolveError extends Error {
  constructor(
    readonly code: TrackResolveErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'TrackResolveError';
  }
}

/**
 * Resolve a provider id into a catalog track with links for both providers.
 *
 * Cheap and idempotent: the server answers a known id from `track_links` in a
 * single query, so callers are free to call this on every queue action rather
 * than trying to cache it themselves.
 */
export async function resolveTrack(
  from: MusicProvider,
  providerId: string
): Promise<TrackResolution> {
  const { data, error } = await supabase.functions.invoke<unknown>('resolve-track', {
    body: { from, providerId },
  });

  if (error) throw await edgeFunctionError(error, 'Could not resolve that track.');
  return parseResolution(data);
}

/**
 * Record the match the user picked from `candidates`.
 *
 * The server deliberately never stores a low-confidence guess — `track_links`
 * is unique per (provider, provider_id) and every future listener reads it, so
 * a wrong row would be permanent. This is the row that closes that gap, written
 * at full confidence because a human verified it.
 */
export async function confirmMatch(
  trackId: string,
  provider: MusicProvider,
  providerId: string
): Promise<ResolvedTrack> {
  const { error } = await supabase.from('track_links').insert({
    track_id: trackId,
    provider,
    provider_id: providerId,
    confidence: 1,
  });

  // 23505: someone confirmed it first, or that provider id is already mapped.
  // Either way the catalog now holds an answer — read it back rather than fail.
  if (error && error.code !== '23505') {
    throw new TrackResolveError('internal', error.message);
  }

  return await loadResolvedTrack(trackId);
}

/** The catalog track plus its provider links, straight from the database. */
export async function loadResolvedTrack(trackId: string): Promise<ResolvedTrack> {
  // Two flat queries rather than one embedded select: the embed would depend on
  // PostgREST relationship inference, and these are plain indexed lookups.
  const [trackResult, linkResult] = await Promise.all([
    supabase.from('tracks').select('*').eq('id', trackId).single(),
    supabase.from('track_links').select('provider, provider_id').eq('track_id', trackId),
  ]);

  if (trackResult.error || !trackResult.data) {
    throw new TrackResolveError('not_found', trackResult.error?.message ?? 'Track not found.');
  }
  if (linkResult.error) {
    throw new TrackResolveError('internal', linkResult.error.message);
  }

  const links: Partial<Record<MusicProvider, string>> = {};
  for (const link of linkResult.data ?? []) {
    links[link.provider] = link.provider_id;
  }

  return { ...trackResult.data, links };
}

/**
 * What this track needs to actually play on a given provider, or null when the
 * resolver never found a link for it there.
 */
export function toPlayableRef(
  track: ResolvedTrack,
  provider: MusicProvider
): PlayableRef | null {
  const providerId = track.links[provider];
  if (!providerId) return null;
  return { provider, providerId, durationMs: track.duration_ms };
}

// ------------------------------------------------------------------- plumbing

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

const PROVIDERS: readonly MusicProvider[] = ['spotify', 'youtube'];

function asProvider(value: unknown): MusicProvider | null {
  return PROVIDERS.find((provider) => provider === value) ?? null;
}

/**
 * The response crosses a network boundary, so it is `unknown` until proven
 * otherwise. Only the fields the app actually reads are checked; the rest of
 * the row is trusted to match the schema both sides were generated from.
 */
function parseResolution(data: unknown): TrackResolution {
  if (!isRecord(data) || !isRecord(data.track) || typeof data.track.id !== 'string') {
    throw new TrackResolveError('internal', 'The resolver returned an unexpected response.');
  }

  const links: Partial<Record<MusicProvider, string>> = {};
  if (isRecord(data.links)) {
    for (const [key, value] of Object.entries(data.links)) {
      const provider = asProvider(key);
      if (provider && typeof value === 'string') links[provider] = value;
    }
  }

  const track: ResolvedTrack = { ...(data.track as unknown as TrackRow), links };
  const rawCandidates: unknown[] = Array.isArray(data.candidates) ? data.candidates : [];

  return {
    track,
    needsConfirmation: data.needsConfirmation === true,
    candidates: rawCandidates
      .map(parseCandidate)
      .filter((candidate): candidate is TrackMatchCandidate => candidate !== null),
  };
}

function parseCandidate(value: unknown): TrackMatchCandidate | null {
  if (!isRecord(value)) return null;
  const provider = asProvider(value.provider);
  const providerId = asString(value.providerId);
  if (!provider || !providerId) return null;

  return {
    provider,
    providerId,
    title: asString(value.title),
    artist: asString(value.artist),
    durationMs: asNumber(value.durationMs),
    artworkUrl: typeof value.artworkUrl === 'string' ? value.artworkUrl : null,
    score: asNumber(value.score),
  };
}

/**
 * Turns a functions-client failure into a typed error, unwrapping the JSON body
 * the Edge Function sent so the UI can say "the YouTube quota ran out" instead
 * of "Edge Function returned a non-2xx status code".
 *
 * Shared with the search hook, which talks to a different function the same way.
 */
export async function edgeFunctionError(error: unknown, fallback: string): Promise<Error> {
  if (error instanceof FunctionsHttpError) {
    const body = await readErrorBody(error);
    const payload = isRecord(body) && isRecord(body.error) ? body.error : null;
    if (payload) {
      return new TrackResolveError(
        toErrorCode(payload.code),
        asString(payload.message, fallback)
      );
    }
    return new TrackResolveError('internal', fallback);
  }

  if (error instanceof FunctionsFetchError || error instanceof FunctionsRelayError) {
    return new TrackResolveError('network', 'No connection to the Aux server.');
  }

  return error instanceof Error ? error : new TrackResolveError('internal', fallback);
}

/**
 * `context` on a functions-js error is the raw `Response`. Cloned before
 * reading so nothing downstream finds the body already consumed.
 */
async function readErrorBody(error: FunctionsHttpError): Promise<unknown> {
  const context: unknown = error.context;
  if (!(context instanceof Response)) return context ?? null;

  try {
    return await context.clone().json();
  } catch {
    // The function crashed before it could serialise an error body.
    return null;
  }
}

const ERROR_CODES: readonly TrackResolveErrorCode[] = [
  'unauthorized',
  'bad_request',
  'not_found',
  'quota_exceeded',
  'provider_unavailable',
  'network',
  'internal',
];

function toErrorCode(value: unknown): TrackResolveErrorCode {
  return ERROR_CODES.find((code) => code === value) ?? 'internal';
}
