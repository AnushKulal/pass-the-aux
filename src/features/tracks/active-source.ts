/**
 * Where the audio is actually coming from, and why.
 *
 * THE PROBLEM THIS SOLVES IS NOT TECHNICAL, IT IS THAT NOTHING SAYS ANYTHING.
 *
 * A Session stores a provider-agnostic track and every listener plays it from
 * whatever service *their* account can drive — that is the whole point of the
 * adapter seam, and it is what lets a Spotify Premium listener and a free
 * YouTube listener hear the same song at the same second. It works. It is also
 * completely invisible: audio comes out of Spotify or it does not, and when it
 * does not, nothing distinguishes "you never linked Spotify" from "Spotify is
 * linked but you are not Premium" from "you are Premium but nothing is open for
 * Aux to steer".
 *
 * The result is a design that looks unimplemented because its most common
 * outcome is a silent fallback. This hook is the fix: it does not change any
 * routing, it reports it.
 *
 * `describeAvailability()` on the Spotify adapter reads the SAME snapshot the
 * routing decision reads, so this cannot drift from what is really happening.
 */

import { useQuery } from '@tanstack/react-query';

import type { MusicProvider } from '@/lib/database.types';
import { spotifyAdapter, type SpotifyAvailability } from '@/playback/spotify-adapter';
import { usePlayback } from '@/playback/store';

export type ActiveSource = {
  /** What will actually play. */
  provider: MusicProvider;
  /** One short line for the UI. Never blank — silence is the bug. */
  label: string;
  /**
   * Why it is not Spotify, when it is not. `null` when Spotify IS playing, or
   * when the reason is simply that the user chose YouTube.
   */
  reason: string | null;
  /** True when the fallback is something the user could act on. */
  actionable: boolean;
};

/**
 * Re-checked on the same cadence the adapter trusts its own snapshot for.
 *
 * Shorter would mean asking Spotify about devices more often than the routing
 * code itself does, which is both wasteful and a way to display a state the
 * player is not yet acting on.
 */
const SOURCE_STALE_MS = 30_000;

export const activeSourceKeys = { all: ['active-source'] as const };

function describe(
  availability: SpotifyAvailability,
  forcedYouTube: boolean,
): ActiveSource {
  /*
    The user's own choice is checked FIRST and reported without a "reason".
    Everything else in this function explains a fallback the user did not ask
    for; choosing YouTube deliberately is not a fallback and should not be
    presented as one — telling somebody why they cannot have the thing they
    turned off reads as a malfunction.
  */
  if (forcedYouTube) {
    return {
      provider: 'youtube',
      label: 'Playing through YouTube',
      reason: null,
      actionable: false,
    };
  }

  if (availability === 'ready') {
    return {
      provider: 'spotify',
      label: 'Playing through Spotify',
      reason: null,
      actionable: false,
    };
  }

  const REASONS: Record<Exclude<SpotifyAvailability, 'ready'>, [string, boolean]> = {
    // Actionable: linking is a thing they can go and do.
    'not-linked': ['Link Spotify to play from it instead', true],
    // Not actionable by us. Saying "get Premium" would be the app selling
    // somebody a subscription to fix a problem it is handling perfectly well.
    'not-premium': ['Spotify needs Premium to be controlled', false],
    // The most actionable of the three, and the one people hit most: they ARE
    // set up, Spotify just is not open.
    'no-device': ['Open Spotify on a device to play from it', true],
  };

  const [reason, actionable] = REASONS[availability];
  return { provider: 'youtube', label: 'Playing through YouTube', reason, actionable };
}

/**
 * The source that will actually be used, with a line explaining it.
 *
 * Safe to call from anywhere — it never throws, and a failed probe resolves to
 * the YouTube answer, which is what the player would do anyway.
 */
export function useActiveSource(): ActiveSource {
  const preference = usePlayback((s) => s.sourcePreference);
  const forcedYouTube = preference === 'youtube';

  const { data } = useQuery({
    queryKey: [...activeSourceKeys.all, preference],
    // Skipped entirely when the user has chosen YouTube: the answer cannot
    // change the outcome, and asking Spotify about devices to display a line
    // that will say "YouTube" regardless is a round-trip for nothing.
    enabled: !forcedYouTube,
    queryFn: () => spotifyAdapter.describeAvailability(),
    staleTime: SOURCE_STALE_MS,
  });

  return describe(data ?? 'not-linked', forcedYouTube);
}
