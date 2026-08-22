/**
 * The single app-wide React Query client.
 *
 * Lives outside the component tree so imperative code (deep links, realtime
 * handlers, the sync controller) can invalidate caches without a hook.
 */

import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      /**
       * Room and queue state arrives over Supabase realtime, so polling would
       * be redundant. 30s is long enough to make tab switches feel instant and
       * short enough that a missed realtime event self-heals on the next mount.
       */
      staleTime: 30_000,
      /**
       * One retry only. On a phone, a second failure almost always means the
       * network is genuinely down — retrying further just delays the error UI.
       */
      retry: 1,
      /**
       * Native has no meaningful "window focus"; leaving this on causes a
       * refetch storm every time the app returns from the Spotify auth browser.
       */
      refetchOnWindowFocus: false,
    },
  },
});
