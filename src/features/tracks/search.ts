/**
 * Track search, pointed at whichever provider the user can actually play.
 *
 * Search never runs from the device directly: the Spotify token lives in
 * `provider_tokens` where no client can read it, and the YouTube API key must
 * not ship inside the app. Both go through the `search-tracks` Edge Function,
 * which answers with a provider-neutral list:
 *
 *   POST search-tracks  { provider, query, limit }
 *   -> { results: TrackSearchResult[] }
 *
 * Picking a result hands its `providerId` to `resolveTrack`, which is where it
 * becomes a catalog track playable on both providers.
 */

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { profileKeys } from '@/features/profile/queries';
import type { MusicProvider } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';

import { edgeFunctionError } from './resolve';

export type TrackSearchResult = {
  provider: MusicProvider;
  providerId: string;
  title: string;
  artist: string;
  album: string | null;
  durationMs: number;
  artworkUrl: string | null;
  isrc: string | null;
};

/** Long enough that a fast typist sends one request per word, not per letter. */
const DEBOUNCE_MS = 400;
/** One character matches everything; it is not a search yet. */
const MIN_QUERY_LENGTH = 2;
/**
 * The YouTube Data API gives ~100 searches a day at 100 units each. Holding
 * results for five minutes means backing out of a song and searching the same
 * thing again is free, which is most of what people actually do.
 */
const SEARCH_STALE_MS = 5 * 60_000;
const SEARCH_GC_MS = 30 * 60_000;
const RESULT_LIMIT = 20;

export const trackSearchKeys = {
  all: ['track-search'] as const,
  query: (provider: MusicProvider, query: string) =>
    ['track-search', provider, query] as const,
  /**
   * Deliberately under the `profile` root rather than `track-search`: the
   * verdict is read straight off the profile row, and linking or unlinking
   * Spotify invalidates exactly `['profile']`. Under `track-search` nothing
   * reaches it, so a fresh Premium link kept answering 'youtube' for the whole
   * five-minute staleTime.
   */
  provider: [...profileKeys.all, 'playback-provider'] as const,
};

/**
 * Which provider this user can play right now.
 *
 * Spotify's Web API refuses playback control on free accounts, so "linked" is
 * not enough — a linked-but-free user is a YouTube listener, and so is everyone
 * else. Defaults to YouTube while the profile loads, because YouTube always works.
 */
export function usePlaybackProvider(): MusicProvider {
  const { data } = useQuery({
    queryKey: trackSearchKeys.provider,
    queryFn: async (): Promise<MusicProvider> => {
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user?.id;
      if (!userId) return 'youtube';

      const { data: profile } = await supabase
        .from('profiles')
        .select('spotify_linked, is_premium')
        .eq('id', userId)
        .single();

      return profile?.spotify_linked && profile.is_premium ? 'spotify' : 'youtube';
    },
    staleTime: SEARCH_STALE_MS,
  });

  return data ?? 'youtube';
}

export type TrackSearchState = {
  results: TrackSearchResult[];
  /** Which provider these results came from. */
  provider: MusicProvider;
  /** A search is in flight — render Skeletons, never a blank list. */
  isSearching: boolean;
  /** Query is empty or too short; show the browse state instead of "no results". */
  isIdle: boolean;
  /** Searched, finished, found nothing. */
  isEmpty: boolean;
  error: Error | null;
  refetch: () => void;
};

/**
 * Debounced, cached, provider-aware track search.
 *
 * Pass the raw text-field value straight in — debouncing and the minimum length
 * are handled here so the caller never has to think about quota.
 */
export function useTrackSearch(query: string): TrackSearchState {
  const provider = usePlaybackProvider();
  const debounced = useDebounced(query.trim(), DEBOUNCE_MS);
  const enabled = debounced.length >= MIN_QUERY_LENGTH;

  const result = useQuery({
    queryKey: trackSearchKeys.query(provider, debounced),
    queryFn: () => searchTracks(provider, debounced),
    enabled,
    staleTime: SEARCH_STALE_MS,
    gcTime: SEARCH_GC_MS,
    // Every retry and every focus-refetch is another 100 quota units spent on a
    // result we already showed. One retry for a flaky connection, nothing more.
    retry: 1,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    // Keep the last query's results on screen while the next one loads, so the
    // list does not flash empty between keystrokes.
    placeholderData: keepPreviousData,
  });

  const results = result.data ?? [];
  return {
    results,
    provider,
    isSearching: enabled && result.isFetching,
    isIdle: !enabled,
    isEmpty: enabled && !result.isFetching && results.length === 0 && !result.error,
    error: result.error,
    refetch: () => {
      void result.refetch();
    },
  };
}

/** Imperative search, for callers outside React. */
export async function searchTracks(
  provider: MusicProvider,
  query: string
): Promise<TrackSearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LENGTH) return [];

  const { data, error } = await supabase.functions.invoke<unknown>('search-tracks', {
    body: { provider, query: trimmed, limit: RESULT_LIMIT },
  });

  if (error) throw await edgeFunctionError(error, 'Search is unavailable right now.');
  return parseResults(data);
}

// ------------------------------------------------------------------- plumbing

function useDebounced(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const PROVIDERS: readonly MusicProvider[] = ['spotify', 'youtube'];

/**
 * Normalises whatever the function sent into the shape the list renders. A row
 * missing an id, a title, or a duration is dropped rather than rendered as a
 * broken card — it could never be queued anyway.
 */
function parseResults(data: unknown): TrackSearchResult[] {
  const rows: unknown[] = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.results)
      ? data.results
      : [];

  const out: TrackSearchResult[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;

    const provider = PROVIDERS.find((candidate) => candidate === row.provider);
    const providerId = typeof row.providerId === 'string' ? row.providerId : '';
    const title = typeof row.title === 'string' ? row.title : '';
    const durationMs =
      typeof row.durationMs === 'number' && Number.isFinite(row.durationMs)
        ? row.durationMs
        : 0;

    if (!provider || !providerId || !title || durationMs <= 0) continue;

    out.push({
      provider,
      providerId,
      title,
      artist: typeof row.artist === 'string' ? row.artist : '',
      album: typeof row.album === 'string' ? row.album : null,
      durationMs,
      artworkUrl: typeof row.artworkUrl === 'string' ? row.artworkUrl : null,
      isrc: typeof row.isrc === 'string' ? row.isrc : null,
    });
  }
  return out;
}
