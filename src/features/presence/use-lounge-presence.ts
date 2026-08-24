/**
 * The read side of presence: everyone listening across every lounge I am in,
 * folded into one list the Feed can render directly.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import { loungeKeys } from '@/features/lounges/queries';
import {
  PRESENCE_STALE_MS,
  watchLoungePresence,
  type PresencePayload,
} from '@/features/presence/presence-client';
import { serverNow } from '@/lib/clock';
import { supabase } from '@/lib/supabase';

/** Just enough of a lounge to subscribe to it and label a Feed row. */
export type LoungeRef = {
  id: string;
  name: string;
  iconUrl: string | null;
};

/** A presence payload, tagged with the lounge it was seen in. */
export type FeedEntry = PresencePayload & {
  loungeId: string;
  loungeName: string;
};

export type LoungePresence = {
  entries: FeedEntry[];
  /**
   * False until every watched lounge has reported once. Presence is push-only,
   * so without this the screen has no way to tell "nobody is listening" apart
   * from "the socket has not answered yet" — and would flash an empty state at
   * every cold start.
   */
  ready: boolean;
};

/**
 * Under the `lounges` root rather than a root of its own: every join/leave
 * mutation invalidates `loungeKeys.all`, and this list decides which lounges
 * the Feed subscribes to. Outside that root the mutations never reached it, so
 * a lounge you just joined stayed silent until the next cold start.
 */
export const MY_LOUNGES_KEY = [...loungeKeys.all, 'feed'] as const;

/** A channel that never subscribes must not hold the Feed on skeletons forever. */
const READY_TIMEOUT_MS = 4_000;

/**
 * The lounges I belong to.
 *
 * Two round trips instead of one embedded `lounges(...)` select: the
 * hand-authored `Database` type declares `Relationships: []`, so PostgREST
 * embeds do not typecheck against it. Two typed queries beat one cast.
 */
export function useMyLounges(userId: string | null | undefined): UseQueryResult<LoungeRef[]> {
  return useQuery({
    queryKey: [...MY_LOUNGES_KEY, userId ?? null],
    enabled: Boolean(userId),
    queryFn: async (): Promise<LoungeRef[]> => {
      if (!userId) return [];

      const memberships = await supabase
        .from('lounge_members')
        .select('lounge_id')
        .eq('user_id', userId);
      if (memberships.error) throw memberships.error;

      const ids = (memberships.data ?? []).map((row) => row.lounge_id);
      if (ids.length === 0) return [];

      const lounges = await supabase
        .from('lounges')
        .select('id, name, icon_url')
        .in('id', ids)
        .order('name');
      if (lounges.error) throw lounges.error;

      return (lounges.data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        iconUrl: row.icon_url,
      }));
    },
  });
}

/** In a live Session first, then whoever updated most recently. */
function compareEntries(a: FeedEntry, b: FeedEntry): number {
  const aLive = a.roomId !== null ? 1 : 0;
  const bLive = b.roomId !== null ? 1 : 0;
  if (aLive !== bLive) return bLive - aLive;

  if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
  // Final tiebreak so the list order is stable across renders rather than
  // reshuffling two simultaneous beats on every sync.
  return a.userId.localeCompare(b.userId);
}

/**
 * Presence for a set of lounges, deduplicated by user.
 *
 * The same person shows up once per lounge we share, so a user in three of my
 * lounges would otherwise fill three Feed rows with the same song.
 */
export function useLoungePresence(
  lounges: LoungeRef[],
  excludeUserId?: string | null
): LoungePresence {
  const [byLounge, setByLounge] = useState<Record<string, PresencePayload[]>>({});
  /**
   * Which lounge set the readiness grace period has expired for.
   *
   * Storing the key rather than a boolean matters: a plain flag would still
   * read `true` for the one render between the lounge set changing and the
   * reset effect firing, flashing "nobody is listening" over a Feed that is
   * simply resubscribing.
   */
  const [graceFor, setGraceFor] = useState<string | null>(null);

  // A primitive dependency: `lounges` is a new array identity on every render
  // of the parent, and re-subscribing every socket on every render would make
  // the Feed permanently blank.
  const loungeKey = useMemo(
    () =>
      lounges
        .map((lounge) => lounge.id)
        .sort()
        .join(','),
    [lounges]
  );

  useEffect(() => {
    const ids = loungeKey === '' ? [] : loungeKey.split(',');

    const unsubscribes = ids.map((id) =>
      watchLoungePresence(id, (members) => {
        setByLounge((prev) => ({ ...prev, [id]: members }));
      })
    );

    return () => {
      for (const off of unsubscribes) off();

      // Drop the rosters we just stopped watching, so a lounge I left cannot
      // leave its members lingering in the Feed.
      //
      // In the teardown, not at the top of the effect: pruning up front is a
      // synchronous setState in an effect body, which cascades a second render
      // on every subscription change. Doing it here is also strictly more
      // correct — the rosters die with the sockets that fed them, in one pass,
      // instead of surviving until the next effect run.
      setByLounge((prev) => {
        let changed = false;
        const next: Record<string, PresencePayload[]> = {};

        for (const [id, members] of Object.entries(prev)) {
          if (ids.includes(id)) next[id] = members;
          else changed = true;
        }
        return changed ? next : prev;
      });
    };
  }, [loungeKey]);

  useEffect(() => {
    const timer = setTimeout(() => setGraceFor(loungeKey), READY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [loungeKey]);

  const entries = useMemo(() => {
    const nameById = new Map(lounges.map((lounge) => [lounge.id, lounge.name]));
    const now = serverNow();
    const bestByUser = new Map<string, FeedEntry>();

    for (const [loungeId, members] of Object.entries(byLounge)) {
      const loungeName = nameById.get(loungeId);
      // A lounge whose subscription outlived its row in the query cache.
      if (loungeName === undefined) continue;

      for (const member of members) {
        if (member.userId === excludeUserId) continue;
        // A frozen socket keeps publishing nothing; do not render a ghost.
        if (now - member.updatedAt > PRESENCE_STALE_MS) continue;
        // Online but idle. The Feed is about what people are hearing, and an
        // empty row would just be noise.
        if (member.trackTitle === null && member.roomId === null) continue;

        const candidate: FeedEntry = { ...member, loungeId, loungeName };
        const current = bestByUser.get(member.userId);
        if (!current || compareEntries(candidate, current) < 0) {
          bestByUser.set(member.userId, candidate);
        }
      }
    }

    return [...bestByUser.values()].sort(compareEntries);
  }, [byLounge, lounges, excludeUserId]);

  const ready =
    graceFor === loungeKey ||
    lounges.length === 0 ||
    lounges.every((lounge) => lounge.id in byLounge);

  return { entries, ready };
}
