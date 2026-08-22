/**
 * Chat data layer.
 *
 * One `messages` table backs both surfaces: `room_id IS NULL` is lounge chat,
 * `room_id` set is Session chat. Every hook here takes the same `ChatScope`, so
 * the two surfaces share one implementation and one cache shape.
 *
 * The defining constraint is that sending must feel instant. A chat that waits
 * on a round-trip before painting your own message reads as broken even when it
 * is only 200ms — so every send lands in the cache immediately as a pending
 * message, and the network is reconciliation, not the source of truth.
 */

import type { RealtimePostgresInsertPayload } from '@supabase/supabase-js';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useToast } from '@/components/ui';
import { serverNow } from '@/lib/clock';
import type { MessageRow, ProfileRow } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';

/** Newest 30 fills more than a phone screen, so the first page never looks short. */
const PAGE_SIZE = 30;

/**
 * How far apart an optimistic message and its realtime echo may be and still be
 * considered the same message. Generous on purpose: the window only ever
 * compares against messages still marked pending, and a pending message with an
 * identical body from the same author IS the echo. Sending "lol" twice is safe
 * because the first is no longer pending by the time the second echo lands.
 */
const ECHO_WINDOW_MS = 15_000;

const MESSAGE_COLUMNS = 'id, lounge_id, room_id, user_id, body, created_at';

export type ChatScope = {
  loungeId: string;
  /** Omit or pass null for lounge chat; a room id scopes to that Session. */
  roomId?: string | null;
};

export type ChatAuthor = Pick<ProfileRow, 'id' | 'username' | 'display_name' | 'avatar_url'>;

export type ReactionSummary = {
  emoji: string;
  count: number;
  /** True when the viewer is one of the reactors — drives the toggle. */
  mine: boolean;
};

export type ChatMessage = {
  id: string;
  loungeId: string;
  roomId: string | null;
  userId: string;
  body: string;
  /** ISO timestamp. Server-stamped once confirmed; clock-corrected while pending. */
  createdAt: string;
  author: ChatAuthor | null;
  reactions: ReactionSummary[];
  /** In flight — rendered dimmed and excluded from actions until confirmed. */
  pending: boolean;
};

type MessagesPage = {
  messages: ChatMessage[];
  /** `created_at` of the oldest row in this page, or null when fully drained. */
  nextCursor: string | null;
};

type MessagesData = InfiniteData<MessagesPage, string | null>;

export const chatKeys = {
  all: ['chat'] as const,
  viewer: ['chat', 'viewer'] as const,
  messages: (loungeId: string, roomId: string | null) =>
    ['chat', 'messages', loungeId, roomId ?? 'lounge'] as const,
};

const scopeKey = (scope: ChatScope) => chatKeys.messages(scope.loungeId, scope.roomId ?? null);

// ---------------------------------------------------------------- viewer

/**
 * The signed-in user's id.
 *
 * Deliberately not read from `@/lib/auth`: chat only needs the id, and going
 * straight to the Supabase session keeps this feature compilable and testable
 * on its own instead of coupled to whatever shape the auth context settles on.
 */
export function useViewerId(): string | null {
  const client = useQueryClient();

  const { data } = useQuery({
    queryKey: chatKeys.viewer,
    queryFn: async () => {
      /*
        getSession(), not getUser(): getUser() round-trips to /auth/v1/user, and
        chat would sit on a skeleton until that returned — or forever, offline.
        The session is read from local storage and is all we need for an id.
      */
      const { data: auth } = await supabase.auth.getSession();
      return auth.session?.user.id ?? null;
    },
    staleTime: Infinity,
  });

  useEffect(() => {
    // Sign-out must not leave the previous user's id driving "can I delete this".
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      client.setQueryData(chatKeys.viewer, session?.user.id ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, [client]);

  return data ?? null;
}

// ---------------------------------------------------------------- fetching

/**
 * Display names and avatars, cached for the process lifetime.
 *
 * Chat repeats the same handful of authors hundreds of times, and realtime
 * INSERT payloads carry only `user_id` — without a cache, every arriving
 * message would cost a profile round-trip before it could render a name.
 * A renamed user stays stale until the app restarts, which is the right trade
 * for a chat log.
 */
const authorCache = new Map<string, ChatAuthor>();

async function ensureAuthors(ids: readonly string[]): Promise<Map<string, ChatAuthor>> {
  const missing = [...new Set(ids)].filter((id) => !authorCache.has(id));

  if (missing.length > 0) {
    const { data } = await supabase
      .from('profiles')
      .select('id, username, display_name, avatar_url')
      .in('id', missing);

    for (const profile of data ?? []) {
      authorCache.set(profile.id, profile);
    }
  }

  return authorCache;
}

async function fetchReactions(
  messageIds: readonly string[],
  viewerId: string | null,
): Promise<Map<string, ReactionSummary[]>> {
  const byMessage = new Map<string, ReactionSummary[]>();
  if (messageIds.length === 0) return byMessage;

  const { data, error } = await supabase
    .from('reactions')
    .select('message_id, user_id, emoji')
    .in('message_id', [...messageIds]);

  // An RLS denial or a dropped connection is not "nobody reacted". Swallowing
  // it here would render every chip as absent, which nobody would ever report
  // as a bug — so let the caller's query surface the failure instead.
  if (error) throw new Error(error.message);

  for (const row of data ?? []) {
    const list = byMessage.get(row.message_id) ?? [];
    const existing = list.find((entry) => entry.emoji === row.emoji);

    if (existing) {
      existing.count += 1;
      existing.mine = existing.mine || row.user_id === viewerId;
    } else {
      list.push({ emoji: row.emoji, count: 1, mine: row.user_id === viewerId });
    }

    byMessage.set(row.message_id, list);
  }

  return byMessage;
}

function toChatMessage(
  row: MessageRow,
  authors: Map<string, ChatAuthor>,
  reactions: Map<string, ReactionSummary[]>,
): ChatMessage {
  return {
    id: row.id,
    loungeId: row.lounge_id,
    roomId: row.room_id,
    userId: row.user_id,
    body: row.body,
    createdAt: row.created_at,
    author: authors.get(row.user_id) ?? null,
    reactions: reactions.get(row.id) ?? [],
    pending: false,
  };
}

async function fetchMessagesPage(
  scope: ChatScope,
  cursor: string | null,
  viewerId: string | null,
): Promise<MessagesPage> {
  let filter = supabase.from('messages').select(MESSAGE_COLUMNS).eq('lounge_id', scope.loungeId);

  // Two partial indexes back these two shapes; never let a room query fall
  // through to a full lounge scan by leaving room_id unconstrained.
  filter = scope.roomId ? filter.eq('room_id', scope.roomId) : filter.is('room_id', null);
  if (cursor) filter = filter.lt('created_at', cursor);

  const { data, error } = await filter
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE);

  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const [authors, reactions] = await Promise.all([
    ensureAuthors(rows.map((row) => row.user_id)),
    fetchReactions(
      rows.map((row) => row.id),
      viewerId,
    ),
  ]);

  const oldest = rows.length > 0 ? rows[rows.length - 1] : undefined;

  return {
    messages: rows.map((row) => toChatMessage(row, authors, reactions)),
    /*
      Keyset pagination on created_at rather than range offsets: new messages
      arrive constantly, and an offset-based second page would re-serve rows
      that page one already showed. timestamptz is microsecond-precision, so a
      tie that would skip a row is not reachable in practice.
    */
    nextCursor: rows.length === PAGE_SIZE ? (oldest?.created_at ?? null) : null,
  };
}

// ---------------------------------------------------------------- cache edits

const timeOf = (iso: string) => new Date(iso).getTime();

function mapPages(data: MessagesData | undefined, fn: (m: ChatMessage[]) => ChatMessage[]) {
  if (!data) return data;
  return { ...data, pages: data.pages.map((page) => ({ ...page, messages: fn(page.messages) })) };
}

const hasMessage = (data: MessagesData, id: string) =>
  data.pages.some((page) => page.messages.some((message) => message.id === id));

/**
 * Insert into page zero at its timestamp position.
 *
 * Page zero is the newest page, so an arriving message almost always lands at
 * index 0 — but a message that crosses the wire out of order (or a confirmed
 * row whose server timestamp predates a pending one) still sorts correctly
 * instead of jumping to the bottom of the log.
 */
function insertNewest(data: MessagesData, message: ChatMessage): MessagesData {
  const [first, ...rest] = data.pages;
  if (!first) return data;

  const arrivedAt = timeOf(message.createdAt);
  const at = first.messages.findIndex((existing) => timeOf(existing.createdAt) <= arrivedAt);
  const index = at === -1 ? first.messages.length : at;
  const messages = [...first.messages];
  messages.splice(index, 0, message);

  return { ...data, pages: [{ ...first, messages }, ...rest] };
}

/** Swap a message in place, matched by id, preserving position. */
function replaceMessage(data: MessagesData, id: string, next: ChatMessage): MessagesData {
  return (
    mapPages(data, (messages) =>
      messages.map((message) => (message.id === id ? next : message)),
    ) ?? data
  );
}

function removeMessage(data: MessagesData, id: string): MessagesData {
  return (
    mapPages(data, (messages) => messages.filter((message) => message.id !== id)) ?? data
  );
}

/**
 * Find the optimistic message a confirmed row is the echo of.
 *
 * Matches on author + exact body + a close timestamp, and only ever considers
 * still-pending entries, which is what keeps a genuine repeat of the same text
 * from being swallowed. Searched oldest-first so two rapid identical sends
 * reconcile in the order they were made.
 */
function findPendingEcho(data: MessagesData, row: MessageRow): string | null {
  const at = timeOf(row.created_at);

  for (const page of data.pages) {
    for (let i = page.messages.length - 1; i >= 0; i -= 1) {
      const candidate = page.messages[i];
      if (!candidate?.pending) continue;
      if (candidate.userId !== row.user_id || candidate.body !== row.body) continue;
      if (Math.abs(timeOf(candidate.createdAt) - at) > ECHO_WINDOW_MS) continue;
      return candidate.id;
    }
  }

  return null;
}

/** Land a confirmed row in the cache exactly once, whichever path it arrives by. */
function commitRow(
  client: QueryClient,
  scope: ChatScope,
  row: MessageRow,
  author: ChatAuthor | null,
) {
  client.setQueryData<MessagesData>(scopeKey(scope), (data) => {
    if (!data) return data;
    if (hasMessage(data, row.id)) return data;

    const confirmed: ChatMessage = {
      id: row.id,
      loungeId: row.lounge_id,
      roomId: row.room_id,
      userId: row.user_id,
      body: row.body,
      createdAt: row.created_at,
      author: author ?? authorCache.get(row.user_id) ?? null,
      reactions: [],
      pending: false,
    };

    const echoOf = findPendingEcho(data, row);
    // Keep the reactions the optimistic entry never had but a slow echo might.
    return echoOf ? replaceMessage(data, echoOf, confirmed) : insertNewest(data, confirmed);
  });
}

/**
 * Replay whatever landed while nothing was subscribed.
 *
 * The subscription's lifetime is not the room's: the Session's bottom sheet
 * tears this list down every time someone looks at the Queue, and a reconnect
 * leaves the same hole. `staleTime` deliberately keeps the cached log, so
 * without this pass those messages would simply never appear.
 *
 * One keyset query for rows newer than the newest *confirmed* message, replayed
 * through `commitRow` so the echo and duplicate rules still decide what lands.
 */
async function fillGapSince(client: QueryClient, scope: ChatScope): Promise<void> {
  const key = scopeKey(scope);
  const data = client.getQueryData<MessagesData>(key);
  // A pending entry is stamped with our own clock, so it can never be the cursor.
  const newest = data?.pages[0]?.messages.find((message) => !message.pending);

  if (!newest) {
    // No confirmed message to measure from. If we have never fetched, the first
    // fetch is itself the catch-up; if we have, the log was empty when we went
    // deaf and refetching one page is the cheapest way to find out if it still is.
    if (data) void client.invalidateQueries({ queryKey: key });
    return;
  }

  let filter = supabase
    .from('messages')
    .select(MESSAGE_COLUMNS)
    .eq('lounge_id', scope.loungeId)
    .gt('created_at', newest.createdAt);
  filter = scope.roomId ? filter.eq('room_id', scope.roomId) : filter.is('room_id', null);

  const { data: rows, error } = await filter
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE);

  // This pass runs once per SUBSCRIBED and is never retried, so a swallowed
  // error is a permanent hole in the log. Throwing is not an option — the only
  // caller is fire-and-forget — so fall back to the refetch used below.
  if (error) {
    void client.invalidateQueries({ queryKey: key });
    return;
  }

  if (!rows || rows.length === 0) return;

  // A full page means the gap may be wider than we can see. Splicing that in
  // would leave a hole in the middle of the log, so refetch it properly.
  if (rows.length === PAGE_SIZE) {
    void client.invalidateQueries({ queryKey: key });
    return;
  }

  const authors = await ensureAuthors(rows.map((row) => row.user_id));
  for (const row of rows) {
    commitRow(client, scope, row, authors.get(row.user_id) ?? null);
  }
}

// ---------------------------------------------------------------- hooks

export type UseMessagesResult = {
  /** Newest first — the order an `inverted` FlatList wants. */
  messages: ChatMessage[];
  isPending: boolean;
  isError: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
  refetch: () => void;
};

export function useMessages(scope: ChatScope): UseMessagesResult {
  const viewerId = useViewerId();
  const { loungeId } = scope;
  const roomId = scope.roomId ?? null;

  const query = useInfiniteQuery({
    queryKey: chatKeys.messages(loungeId, roomId),
    queryFn: ({ pageParam }) => fetchMessagesPage({ loungeId, roomId }, pageParam, viewerId),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    /*
      Realtime keeps this list current *and* `useMessageSubscription` fills the
      gap left by any window where nothing was subscribed, so refetching on
      remount would only re-render a log the user is already looking at. Older
      pages stay cached for the session; scrolling back up is free.
    */
    staleTime: 5 * 60_000,
    /*
      Waits for the viewer id rather than keying on it. Reactions are marked
      `mine` at fetch time, so fetching before the id is known would render
      every one of the viewer's own reactions as somebody else's — and tapping
      one would then try to insert a row that already exists.
    */
    enabled: Boolean(loungeId) && viewerId !== null,
  });

  const messages = useMemo(
    () => query.data?.pages.flatMap((page) => page.messages) ?? [],
    [query.data],
  );

  const { fetchNextPage, refetch } = query;
  const loadMore = useCallback(() => {
    void fetchNextPage();
  }, [fetchNextPage]);
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);

  return {
    messages,
    isPending: query.isPending,
    isError: query.isError,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: loadMore,
    refetch: retry,
  };
}

type SendContext = { tempId: string; previous: MessagesData | undefined };

/**
 * The viewer's id, waiting on the session if the hook has not resolved yet.
 *
 * The optimistic entry must carry the real user id: echo matching compares it
 * against the confirmed row's `user_id`, and a placeholder would fail to match,
 * leaving the sender looking at their own message twice.
 */
async function requireUserId(hint: string | null): Promise<string> {
  if (hint) return hint;

  const { data } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new Error('You are signed out.');
  return id;
}

/**
 * Send a message, optimistically.
 *
 * The scope is a hook argument rather than a mutation variable so the caller
 * (a composer that already knows where it lives) passes it once and the cache
 * key is fixed for the lifetime of the mutation.
 */
export function useSendMessage(scope: ChatScope) {
  const client = useQueryClient();
  const toast = useToast();
  const viewerId = useViewerId();
  const key = scopeKey(scope);

  useEffect(() => {
    /*
      Warm the viewer's own profile. The author cache is otherwise filled only
      by messages that already exist, so a user's very first message in a
      lounge would render optimistically with no name and no avatar, then pop
      into place when the echo landed.
    */
    if (viewerId) void ensureAuthors([viewerId]);
  }, [viewerId]);

  return useMutation<MessageRow, Error, string, SendContext>({
    mutationFn: async (body) => {
      const userId = await requireUserId(viewerId);

      const { data, error } = await supabase
        .from('messages')
        .insert({
          lounge_id: scope.loungeId,
          room_id: scope.roomId ?? null,
          user_id: userId,
          body,
        })
        .select(MESSAGE_COLUMNS)
        .single();

      if (error) throw new Error(error.message);
      return data;
    },

    onMutate: async (body) => {
      // Throwing here aborts before mutationFn runs and before anything is
      // painted, so a signed-out send surfaces as a toast and nothing else.
      const userId = await requireUserId(viewerId);

      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<MessagesData>(key);
      const tempId = `pending:${Crypto.randomUUID()}`;

      const optimistic: ChatMessage = {
        id: tempId,
        loungeId: scope.loungeId,
        roomId: scope.roomId ?? null,
        userId,
        body,
        /*
          serverNow(), not Date.now(): the echo-matching window compares this
          against a server-stamped created_at, and a device clock that is minutes
          off would push every optimistic message outside the window and show
          each one twice.
        */
        createdAt: new Date(serverNow()).toISOString(),
        author: authorCache.get(userId) ?? null,
        reactions: [],
        pending: true,
      };

      client.setQueryData<MessagesData>(key, (data) =>
        data ? insertNewest(data, optimistic) : data,
      );

      return { tempId, previous };
    },

    onSuccess: (row, _body, context) => {
      client.setQueryData<MessagesData>(key, (data) => {
        if (!data) return data;

        // The realtime echo can beat the insert response back. If it already
        // reconciled this send, drop the placeholder and keep the confirmed row.
        if (hasMessage(data, row.id)) {
          return context ? removeMessage(data, context.tempId) : data;
        }

        const confirmed = toChatMessage(row, authorCache, new Map());
        if (!context) return insertNewest(data, confirmed);

        const stillPending = data.pages.some((page) =>
          page.messages.some((message) => message.id === context.tempId),
        );

        return stillPending
          ? replaceMessage(data, context.tempId, confirmed)
          : insertNewest(data, confirmed);
      });
    },

    onError: (error, _body, context) => {
      // Roll the optimistic entry back rather than leaving a message on screen
      // that no other member can see.
      if (context) {
        client.setQueryData<MessagesData>(key, (data) =>
          data ? removeMessage(data, context.tempId) : data,
        );
      }
      toast.show(error.message || 'Message failed to send.', 'error');
    },
  });
}

/**
 * Stream new messages into the cache, and catch up on every SUBSCRIBED.
 *
 * Only INSERT is subscribed. `messages` uses the default replica identity, so a
 * DELETE payload carries the primary key alone — it would never match the
 * `room_id`/`lounge_id` filter and would never be delivered. Deletes are
 * therefore reconciled locally by the delete mutation and on the next refetch.
 */
export function useMessageSubscription(scope: ChatScope) {
  const client = useQueryClient();
  const { loungeId } = scope;
  const roomId = scope.roomId ?? null;

  // A stable per-mount suffix: two components watching the same scope would
  // otherwise collide on one channel topic and one of them would go silent.
  // A lazy initialiser, not useRef(Crypto.randomUUID()): a useRef argument is
  // evaluated on every render and thrown away on all but the first, which burns
  // entropy on a list that re-renders with every arriving message.
  const [channelSuffix] = useState(() => Crypto.randomUUID());

  useEffect(() => {
    if (!loungeId) return;

    const handleInsert = (payload: RealtimePostgresInsertPayload<MessageRow>) => {
      const row = payload.new;

      // Realtime filters have no `is` operator, so lounge chat subscribes to the
      // whole lounge and discards the Session traffic here.
      if (roomId === null && row.room_id !== null) return;
      if (row.lounge_id !== loungeId) return;

      void ensureAuthors([row.user_id]).then((authors) => {
        commitRow(client, { loungeId, roomId }, row, authors.get(row.user_id) ?? null);
      });
    };

    const channel = supabase
      .channel(`chat:${loungeId}:${roomId ?? 'lounge'}:${channelSuffix}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: roomId ? `room_id=eq.${roomId}` : `lounge_id=eq.${loungeId}`,
        },
        handleInsert,
      )
      .subscribe((status) => {
        // Fill the hole only once the socket is actually listening, so anything
        // arriving mid-fill is delivered here too and deduped by `commitRow`.
        // `status` is a string enum realtime-js does not re-export, hence String().
        if (String(status) === 'SUBSCRIBED') void fillGapSince(client, { loungeId, roomId });
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [channelSuffix, client, loungeId, roomId]);
}

type RollbackContext = { previous: MessagesData | undefined };

/**
 * Delete a message.
 *
 * Returns a stable callback rather than the mutation object: this is handed to
 * memoised list rows, and react-query hands back a fresh result object every
 * render, which would defeat every `React.memo` in the list.
 */
export function useDeleteMessage(scope: ChatScope): (messageId: string) => void {
  const client = useQueryClient();
  const toast = useToast();
  const { loungeId } = scope;
  const roomId = scope.roomId ?? null;
  const key = useMemo(() => chatKeys.messages(loungeId, roomId), [loungeId, roomId]);

  const { mutate } = useMutation<void, Error, string, RollbackContext>({
    mutationFn: async (messageId) => {
      const { error } = await supabase.from('messages').delete().eq('id', messageId);
      if (error) throw new Error(error.message);
    },
    onMutate: async (messageId) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<MessagesData>(key);
      client.setQueryData<MessagesData>(key, (data) =>
        data ? removeMessage(data, messageId) : data,
      );
      return { previous };
    },
    onError: (error, _id, context) => {
      // Restoring the whole snapshot rather than re-inserting keeps the message
      // at its original position in the log.
      if (context?.previous) client.setQueryData(key, context.previous);
      toast.show(error.message || 'Could not delete that message.', 'error');
    },
  });

  return useCallback((messageId: string) => mutate(messageId), [mutate]);
}

export type ToggleReactionInput = { messageId: string; emoji: string; remove: boolean };

/**
 * Add or remove the viewer's reaction.
 *
 * `remove` is decided by the caller-facing wrapper and travels as a mutation
 * variable because `onMutate` runs BEFORE `mutationFn` — by the time the
 * network call is made the cache has already been flipped, so reading the
 * intent from the cache inside `mutationFn` would invert it every time.
 *
 * `reactions` is not in the realtime publication, so other members' reactions
 * surface on the next fetch of that page. The viewer's own toggle is applied
 * immediately, which is the part that has to feel live.
 */
export function useToggleReaction(scope: ChatScope): (messageId: string, emoji: string) => void {
  const client = useQueryClient();
  const toast = useToast();
  const viewerId = useViewerId();
  const { loungeId } = scope;
  const roomId = scope.roomId ?? null;
  const key = useMemo(() => chatKeys.messages(loungeId, roomId), [loungeId, roomId]);

  const { mutate } = useMutation<void, Error, ToggleReactionInput, RollbackContext>({
    mutationFn: async ({ messageId, emoji, remove }) => {
      if (!viewerId) throw new Error('You are signed out.');

      const { error } = remove
        ? await supabase
            .from('reactions')
            .delete()
            .eq('message_id', messageId)
            .eq('user_id', viewerId)
            .eq('emoji', emoji)
        : await supabase
            .from('reactions')
            .insert({ message_id: messageId, user_id: viewerId, emoji });

      if (error) throw new Error(error.message);
    },

    onMutate: async ({ messageId, emoji, remove }) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<MessagesData>(key);

      client.setQueryData<MessagesData>(key, (data) =>
        mapPages(data, (messages) =>
          messages.map((message) => {
            if (message.id !== messageId) return message;

            const existing = message.reactions.find((entry) => entry.emoji === emoji);

            const reactions = remove
              ? message.reactions
                  .map((entry) =>
                    entry.emoji === emoji
                      ? { ...entry, count: entry.count - 1, mine: false }
                      : entry,
                  )
                  // A chip nobody is on any more should disappear, not read "0".
                  .filter((entry) => entry.count > 0)
              : existing
                ? message.reactions.map((entry) =>
                    entry.emoji === emoji
                      ? { ...entry, count: entry.count + 1, mine: true }
                      : entry,
                  )
                : [...message.reactions, { emoji, count: 1, mine: true }];

            return { ...message, reactions };
          }),
        ),
      );

      return { previous };
    },

    onError: (error, _input, context) => {
      if (context?.previous) client.setQueryData(key, context.previous);
      toast.show(error.message || 'Could not save that reaction.', 'error');
    },
  });

  return useCallback(
    (messageId: string, emoji: string) => {
      const data = client.getQueryData<MessagesData>(key);
      const target = data?.pages
        .flatMap((page) => page.messages)
        .find((message) => message.id === messageId);

      const remove = target?.reactions.some((entry) => entry.emoji === emoji && entry.mine) ?? false;
      mutate({ messageId, emoji, remove });
    },
    [client, key, mutate],
  );
}
