/**
 * Direct-message data layer.
 *
 * A sibling of `@/features/chat/queries`, not a rewrite of it: the same
 * optimistic-send / realtime-echo / keyset-pagination machinery, applied to a
 * schema that carries six message kinds, private attachments and a read cursor
 * instead of one plain `body`.
 *
 * Three things here are load-bearing and worth reading before changing them:
 *
 *  1. **Unread is derived, not stored.** A message is unread when its
 *     `created_at` is after the viewer's `conversation_participants.last_read_at`
 *     and it is not their own. There is no per-message flag to read, so the
 *     inbox prunes with `last_message_at > last_read_at` — which is exact,
 *     because the `bump_conversation` trigger keeps `last_message_at` equal to
 *     the newest message — and only then asks the server for a count.
 *
 *  2. **Every kind must satisfy `dm_payload_matches_kind`.** `text` carries a
 *     non-empty body and nothing else; `track` carries a track id; everything
 *     else carries an attachment id (and may carry a body, which is the photo
 *     caption). `buildInsert` is the single place that encodes that, so an
 *     insert cannot be built that the database will reject.
 *
 *  3. **`dm-media` is private.** Nothing renders an attachment straight from a
 *     path — `useSignedUrl` mints and rotates a signed URL per path.
 */

import type {
  RealtimePostgresInsertPayload,
  RealtimePostgresUpdatePayload,
} from '@supabase/supabase-js';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useToast } from '@/components/ui';
import { useViewerId } from '@/features/chat/queries';
import { serverNow } from '@/lib/clock';
import type {
  AttachmentKind,
  AttachmentRow,
  DirectMessageRow,
  DmKind,
  ProfileRow,
  TablesInsert,
  TrackRow,
} from '@/lib/database.types';
import { supabase } from '@/lib/supabase';

/** Newest 30 fills more than a phone screen, so the first page never looks short. */
const PAGE_SIZE = 30;

/**
 * How far apart an optimistic message and its realtime echo may be and still be
 * considered the same message. Generous on purpose: the window only ever
 * compares against entries still marked pending, and a pending message with an
 * identical payload from the same sender IS the echo.
 */
const ECHO_WINDOW_MS = 15_000;

/**
 * How many conversations the inbox holds. A 1:1 DM inbox is small by nature and
 * the design shows it as one scroll; a cap keeps the unread pass bounded even
 * for an account that has messaged everybody.
 */
const INBOX_LIMIT = 50;

/** Realtime bursts arrive one row at a time; coalesce the inbox refresh. */
const INBOX_REFRESH_DEBOUNCE_MS = 400;

const DM_MEDIA_BUCKET = 'dm-media';

/** One hour of validity, rotated at 50 minutes so a URL never expires on screen. */
const SIGNED_URL_TTL_SECONDS = 60 * 60;
const SIGNED_URL_REFRESH_MS = 50 * 60_000;

// ---------------------------------------------------------------- types

export type DmAuthor = Pick<
  ProfileRow,
  'id' | 'username' | 'display_name' | 'avatar_url' | 'last_seen_at' | 'show_activity' | 'is_premium'
>;

export type DmAttachment = Pick<
  AttachmentRow,
  | 'id'
  | 'kind'
  | 'storage_path'
  | 'mime_type'
  | 'size_bytes'
  | 'duration_ms'
  | 'width'
  | 'height'
  | 'waveform'
>;

export type DmTrack = Pick<
  TrackRow,
  'id' | 'title' | 'artist' | 'album' | 'artwork_url' | 'duration_ms'
>;

export type DmMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  kind: DmKind;
  /** Text body, or the caption on a photo. Empty string for most other kinds. */
  body: string;
  /** ISO timestamp. Server-stamped once confirmed; clock-corrected while pending. */
  createdAt: string;
  /**
   * Soft-delete marker. Deleted rows are filtered out of every fetch and removed
   * from the cache the moment `useDeleteMessage` fires, so in practice this is
   * always null — it is on the type so a tombstone bubble can be added later
   * without changing the shape every consumer binds to.
   */
  deletedAt: string | null;
  author: DmAuthor | null;
  /** Present for `image` / `video` / `file` / `voice`. */
  attachment: DmAttachment | null;
  /** Present for `track` — the shared-track card. */
  track: DmTrack | null;
  /** True when the viewer sent it — the accent-filled, right-aligned bubble. */
  mine: boolean;
  /** In flight — rendered dimmed and excluded from actions until confirmed. */
  pending: boolean;
};

export type InboxRow = {
  conversationId: string;
  /** Sort key. Kept current by the `bump_conversation` trigger. */
  lastMessageAt: string;
  /** The viewer's read cursor for this thread. */
  lastReadAt: string;
  /** The person on the other side. Null only if their profile row vanished. */
  other: DmAuthor | null;
  /** Rendered per kind: a photo reads "Photo", a voice note "Voice note", a track its title. */
  preview: string;
  /** Null when the thread has no messages yet. */
  previewKind: DmKind | null;
  /** `created_at` of the previewed message — the row's timestamp column. */
  previewAt: string | null;
  /** True when the last message is the viewer's, so the row can prefix "You:". */
  previewIsMine: boolean;
  /** Messages from the other person after `lastReadAt`. Drives the badge and the bright row. */
  unreadCount: number;
};

export type SendDmInput = {
  kind: DmKind;
  /** Required for `text`; optional caption on an attachment kind. */
  body?: string;
  /** Required for `image` / `video` / `file` / `voice`. */
  attachmentId?: string;
  /** Required for `track`. */
  trackId?: string;
  /**
   * Optional, purely cosmetic: the rows behind `attachmentId` / `trackId`, used
   * to paint the optimistic bubble fully-formed instead of as an empty well.
   * `useUploadAttachment` primes the attachment cache automatically, so this is
   * only needed for a track the app has not fetched through this module.
   */
  attachment?: DmAttachment;
  track?: DmTrack;
};

export type UploadAttachmentInput = {
  /** A local `file://` / `content://` / `blob:` URI from the picker or recorder. */
  uri: string;
  kind: AttachmentKind;
  mimeType: string;
  /** Only used to pick the stored extension; the stored name is always a fresh uuid. */
  fileName?: string;
  /** Required for `voice` (the schema enforces it); also meaningful for `video`. */
  durationMs?: number;
  width?: number;
  height?: number;
  /** The 12 bars a voice note draws, 0..100. Clamped here; precomputed by the recorder. */
  waveform?: number[];
};

type ThreadPage = {
  messages: DmMessage[];
  /** `created_at` of the oldest row in this page, or null when fully drained. */
  nextCursor: string | null;
};

type ThreadData = InfiniteData<ThreadPage, string | null>;

// ---------------------------------------------------------------- keys

/**
 * One root, `['dm']`, so `invalidateQueries({ queryKey: dmKeys.all })` refreshes
 * the inbox, the badge and every open thread in a single call.
 */
export const dmKeys = {
  all: ['dm'] as const,
  /** The inbox and the rail badge share this key — one fetch, one truth. */
  inbox: () => ['dm', 'inbox'] as const,
  thread: (conversationId: string) => ['dm', 'thread', conversationId] as const,
  signedUrl: (storagePath: string) => ['dm', 'signed-url', storagePath] as const,
};

// ---------------------------------------------------------------- columns

const PROFILE_COLUMNS =
  'id, username, display_name, avatar_url, last_seen_at, show_activity, is_premium';

const ATTACHMENT_COLUMNS =
  'id, kind, storage_path, mime_type, size_bytes, duration_ms, width, height, waveform';

const TRACK_COLUMNS = 'id, title, artist, album, artwork_url, duration_ms';

const DM_ROW_COLUMNS =
  'id, conversation_id, sender_id, kind, body, attachment_id, track_id, created_at, deleted_at';

/**
 * The thread select, joins included.
 *
 * `profiles!direct_messages_sender_id_fkey` is spelled out rather than left to
 * PostgREST's inference: `attachments` also points at `profiles`, and naming the
 * constraint means a future second profile reference on this table cannot turn
 * the join ambiguous and 300 the whole thread.
 */
const THREAD_SELECT =
  `${DM_ROW_COLUMNS},` +
  `sender:profiles!direct_messages_sender_id_fkey(${PROFILE_COLUMNS}),` +
  `attachment:attachments(${ATTACHMENT_COLUMNS}),` +
  `track:tracks(${TRACK_COLUMNS})`;

/**
 * The inbox select.
 *
 * `latest` is the newest surviving message, ordered and limited to one *on the
 * embedded resource* so one request returns every preview — the alternative is
 * a query per row, which is the shape that makes an inbox feel slow at 30
 * conversations and unusable at 100.
 */
const INBOX_SELECT =
  'id, last_message_at,' +
  `participants:conversation_participants(user_id, last_read_at, profile:profiles(${PROFILE_COLUMNS})),` +
  'latest:direct_messages(id, kind, body, sender_id, created_at, attachment:attachments(kind), track:tracks(title))';

type ThreadSelectRow = DirectMessageRow & {
  sender: DmAuthor | null;
  attachment: DmAttachment | null;
  track: DmTrack | null;
};

type InboxSelectRow = {
  id: string;
  last_message_at: string;
  participants: {
    user_id: string;
    last_read_at: string;
    profile: DmAuthor | null;
  }[];
  latest: {
    id: string;
    kind: DmKind;
    body: string;
    sender_id: string;
    created_at: string;
    attachment: { kind: AttachmentKind } | null;
    track: { title: string } | null;
  }[];
};

// ---------------------------------------------------------------- caches

/**
 * Senders, attachments and tracks, cached for the process lifetime.
 *
 * Realtime payloads carry foreign keys, never the joined rows, so without these
 * every arriving message would cost up to three round trips before it could
 * render. All three are effectively immutable for the life of a session — a
 * renamed sender staying stale until restart is the right trade for a chat log,
 * and an attachment row never changes at all.
 */
const authorCache = new Map<string, DmAuthor>();
const attachmentCache = new Map<string, DmAttachment>();
const trackCache = new Map<string, DmTrack>();

async function ensureAuthors(ids: readonly string[]): Promise<Map<string, DmAuthor>> {
  const missing = [...new Set(ids)].filter((id) => !authorCache.has(id));

  if (missing.length > 0) {
    const { data } = await supabase.from('profiles').select(PROFILE_COLUMNS).in('id', missing);
    for (const profile of (data ?? []) as DmAuthor[]) authorCache.set(profile.id, profile);
  }

  return authorCache;
}

async function ensureAttachments(ids: readonly string[]): Promise<Map<string, DmAttachment>> {
  const missing = [...new Set(ids)].filter((id) => !attachmentCache.has(id));

  if (missing.length > 0) {
    const { data } = await supabase
      .from('attachments')
      .select(ATTACHMENT_COLUMNS)
      .in('id', missing);
    for (const row of (data ?? []) as DmAttachment[]) attachmentCache.set(row.id, row);
  }

  return attachmentCache;
}

async function ensureTracks(ids: readonly string[]): Promise<Map<string, DmTrack>> {
  const missing = [...new Set(ids)].filter((id) => !trackCache.has(id));

  if (missing.length > 0) {
    const { data } = await supabase.from('tracks').select(TRACK_COLUMNS).in('id', missing);
    for (const row of (data ?? []) as DmTrack[]) trackCache.set(row.id, row);
  }

  return trackCache;
}

const rememberJoins = (row: ThreadSelectRow) => {
  if (row.sender) authorCache.set(row.sender.id, row.sender);
  if (row.attachment) attachmentCache.set(row.attachment.id, row.attachment);
  if (row.track) trackCache.set(row.track.id, row.track);
};

// ---------------------------------------------------------------- previews

/**
 * The one-line summary the inbox row shows.
 *
 * Per §13 a photo previews as "Photo", a voice note as "Voice note" and a
 * shared track as its title — the body is only ever shown for `text`, so a
 * photo caption never leaks into a row that is supposed to read "Photo".
 */
export function previewForKind(
  kind: DmKind,
  body: string,
  trackTitle?: string | null,
): string {
  switch (kind) {
    case 'text':
      return body;
    case 'image':
      return 'Photo';
    case 'video':
      return 'Video';
    case 'voice':
      return 'Voice note';
    case 'file':
      return 'File';
    case 'track':
      return trackTitle?.trim() || 'Track';
    default:
      return '';
  }
}

// ---------------------------------------------------------------- inbox

type UnreadCandidate = { conversationId: string; lastReadAt: string };

/**
 * Exact unread counts, computed by the server.
 *
 * The caller has already dropped every conversation whose `last_message_at` is
 * at or before the viewer's `last_read_at` — because `last_message_at` IS the
 * newest message's timestamp, that prune is exact, and on a mostly-read inbox
 * it leaves nothing to ask about. What survives gets a `head: true` count, so
 * no message body crosses the wire to produce a number.
 *
 * Counting in JS over fetched rows was the alternative and is the thing to
 * avoid: a thread nobody has opened has `last_read_at = 'epoch'`, so "fetch
 * everything newer than the cursor and tally" would pull the entire history.
 */
async function fetchUnreadCounts(
  candidates: readonly UnreadCandidate[],
  viewerId: string,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (candidates.length === 0) return counts;

  const results = await Promise.all(
    candidates.map(async ({ conversationId, lastReadAt }) => {
      const { count, error } = await supabase
        .from('direct_messages')
        .select('id', { count: 'exact', head: true })
        .eq('conversation_id', conversationId)
        .gt('created_at', lastReadAt)
        // Your own messages are never unread to you.
        .neq('sender_id', viewerId)
        .is('deleted_at', null);

      if (error) throw new Error(error.message);
      return [conversationId, count ?? 0] as const;
    }),
  );

  for (const [id, count] of results) counts.set(id, count);
  return counts;
}

async function fetchInbox(viewerId: string): Promise<InboxRow[]> {
  const { data, error } = await supabase
    .from('conversations')
    .select(INBOX_SELECT)
    // A soft-deleted last message must not be what the row previews. Filtering
    // the embed (rather than `!inner`) trims the preview without dropping the
    // conversation, which should still be listed with the message before it.
    .is('latest.deleted_at', null)
    .order('last_message_at', { ascending: false })
    .order('created_at', { referencedTable: 'latest', ascending: false })
    .limit(1, { referencedTable: 'latest' })
    .limit(INBOX_LIMIT)
    .returns<InboxSelectRow[]>();

  if (error) throw new Error(error.message);

  const conversations = data ?? [];
  const candidates: UnreadCandidate[] = [];

  const partial = conversations.map((conversation) => {
    const mine = conversation.participants.find((p) => p.user_id === viewerId);
    const other = conversation.participants.find((p) => p.user_id !== viewerId);
    const lastReadAt = mine?.last_read_at ?? new Date(0).toISOString();
    const latest = conversation.latest[0] ?? null;

    if (other?.profile) authorCache.set(other.profile.id, other.profile);

    // Exact prune: `last_message_at` is the newest message's `created_at`, so
    // nothing can be newer than the cursor when the cursor is newer than it.
    if (new Date(conversation.last_message_at).getTime() > new Date(lastReadAt).getTime()) {
      candidates.push({ conversationId: conversation.id, lastReadAt });
    }

    return {
      conversationId: conversation.id,
      lastMessageAt: conversation.last_message_at,
      lastReadAt,
      other: other?.profile ?? null,
      preview: latest ? previewForKind(latest.kind, latest.body, latest.track?.title) : '',
      previewKind: latest?.kind ?? null,
      previewAt: latest?.created_at ?? null,
      previewIsMine: latest ? latest.sender_id === viewerId : false,
      unreadCount: 0,
    } satisfies InboxRow;
  });

  const counts = await fetchUnreadCounts(candidates, viewerId);

  return partial.map((row) => ({
    ...row,
    unreadCount: counts.get(row.conversationId) ?? 0,
  }));
}

export type UseInboxResult = {
  /** Newest `last_message_at` first — the order §13 lists them in. */
  rows: InboxRow[];
  isPending: boolean;
  isError: boolean;
  isRefetching: boolean;
  refetch: () => void;
};

/**
 * The Messages inbox.
 *
 * Realtime keeps this current (see `useDmSubscription`), so the stale window is
 * generous — a tab switch back into Messages should not repaint the list.
 */
export function useInbox(): UseInboxResult {
  const viewerId = useViewerId();

  const query = useQuery({
    queryKey: dmKeys.inbox(),
    queryFn: () => fetchInbox(viewerId as string),
    // Waits for the viewer id rather than keying on it: "the other participant"
    // and "not my own message" are both decided at fetch time, and fetching
    // before the id is known would pick the wrong person for every row.
    enabled: viewerId !== null,
    staleTime: 60_000,
  });

  const { refetch } = query;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);

  return {
    rows: query.data ?? [],
    isPending: query.isPending,
    isError: query.isError,
    isRefetching: query.isRefetching,
    refetch: retry,
  };
}

/**
 * The single number on the rail's DM tile.
 *
 * Shares the inbox query key on purpose. React Query dedupes by key, so the
 * rail and the Messages screen cost one fetch between them, the badge can never
 * disagree with the rows it summarises, and a rail that is always mounted keeps
 * the inbox warm so opening Messages paints instantly.
 */
export function useTotalUnread(): number {
  const viewerId = useViewerId();

  const { data } = useQuery({
    queryKey: dmKeys.inbox(),
    queryFn: () => fetchInbox(viewerId as string),
    enabled: viewerId !== null,
    staleTime: 60_000,
    select: (rows) => rows.reduce((total, row) => total + row.unreadCount, 0),
  });

  return data ?? 0;
}

// ---------------------------------------------------------------- thread

function toDmMessage(row: ThreadSelectRow, viewerId: string | null): DmMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    kind: row.kind,
    body: row.body,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
    author: row.sender ?? authorCache.get(row.sender_id) ?? null,
    attachment: row.attachment ?? (row.attachment_id ? attachmentCache.get(row.attachment_id) ?? null : null),
    track: row.track ?? (row.track_id ? trackCache.get(row.track_id) ?? null : null),
    mine: row.sender_id === viewerId,
    pending: false,
  };
}

/**
 * Turn a bare row (a realtime payload, or an insert response) into a message,
 * fetching whatever joins the caches are missing.
 */
async function hydrateRow(row: DirectMessageRow, viewerId: string | null): Promise<DmMessage> {
  const [authors, attachments, tracks] = await Promise.all([
    ensureAuthors([row.sender_id]),
    row.attachment_id ? ensureAttachments([row.attachment_id]) : Promise.resolve(attachmentCache),
    row.track_id ? ensureTracks([row.track_id]) : Promise.resolve(trackCache),
  ]);

  return toDmMessage(
    {
      ...row,
      sender: authors.get(row.sender_id) ?? null,
      attachment: row.attachment_id ? attachments.get(row.attachment_id) ?? null : null,
      track: row.track_id ? tracks.get(row.track_id) ?? null : null,
    },
    viewerId,
  );
}

async function fetchThreadPage(
  conversationId: string,
  cursor: string | null,
  viewerId: string | null,
): Promise<ThreadPage> {
  let filter = supabase
    .from('direct_messages')
    .select(THREAD_SELECT)
    .eq('conversation_id', conversationId)
    // Soft-deleted rows are dropped here rather than rendered as tombstones;
    // §13 has no tombstone bubble, and an empty bubble is worse than a gap.
    .is('deleted_at', null);

  if (cursor) filter = filter.lt('created_at', cursor);

  const { data, error } = await filter
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE)
    .returns<ThreadSelectRow[]>();

  if (error) throw new Error(error.message);

  const rows = data ?? [];
  for (const row of rows) rememberJoins(row);

  const oldest = rows.length > 0 ? rows[rows.length - 1] : undefined;

  return {
    messages: rows.map((row) => toDmMessage(row, viewerId)),
    /*
      Keyset pagination on created_at rather than range offsets: messages arrive
      while you scroll, and an offset-based second page would re-serve rows page
      one already showed. timestamptz is microsecond-precision, so a tie that
      would skip a row is not reachable in practice.
    */
    nextCursor: rows.length === PAGE_SIZE ? (oldest?.created_at ?? null) : null,
  };
}

// ---------------------------------------------------------------- cache edits

const timeOf = (iso: string) => new Date(iso).getTime();

function mapPages(data: ThreadData | undefined, fn: (m: DmMessage[]) => DmMessage[]) {
  if (!data) return data;
  return { ...data, pages: data.pages.map((page) => ({ ...page, messages: fn(page.messages) })) };
}

const hasMessage = (data: ThreadData, id: string) =>
  data.pages.some((page) => page.messages.some((message) => message.id === id));

/**
 * Insert into page zero at its timestamp position.
 *
 * Page zero is the newest page, so an arriving message almost always lands at
 * index 0 — but a row that crosses the wire out of order (or a confirmed row
 * whose server timestamp predates a pending one) still sorts correctly instead
 * of jumping to the bottom of the log.
 */
function insertNewest(data: ThreadData, message: DmMessage): ThreadData {
  const [first, ...rest] = data.pages;
  if (!first) return data;

  const arrivedAt = timeOf(message.createdAt);
  const at = first.messages.findIndex((existing) => timeOf(existing.createdAt) <= arrivedAt);
  const index = at === -1 ? first.messages.length : at;
  const messages = [...first.messages];
  messages.splice(index, 0, message);

  return { ...data, pages: [{ ...first, messages }, ...rest] };
}

function replaceMessage(data: ThreadData, id: string, next: DmMessage): ThreadData {
  return (
    mapPages(data, (messages) => messages.map((message) => (message.id === id ? next : message))) ??
    data
  );
}

function removeMessage(data: ThreadData, id: string): ThreadData {
  return mapPages(data, (messages) => messages.filter((message) => message.id !== id)) ?? data;
}

/**
 * The identity of a send, for echo matching.
 *
 * Not the body alone: a voice note and a photo both have an empty body, so
 * matching on text would let one attachment's echo swallow another's bubble.
 * Each kind is keyed by the column its check constraint requires.
 */
function payloadKey(
  kind: DmKind,
  body: string,
  attachmentId: string | null,
  trackId: string | null,
): string {
  if (kind === 'text') return `text:${body}`;
  if (kind === 'track') return `track:${trackId ?? ''}`;
  return `attachment:${attachmentId ?? ''}`;
}

/**
 * Find the optimistic message a confirmed row is the echo of.
 *
 * Matches sender + payload + a close timestamp, and only ever considers
 * still-pending entries — which is what keeps a genuine repeat of the same text
 * from being swallowed, since the first is no longer pending by the time the
 * second echo lands. Searched oldest-first so two rapid identical sends
 * reconcile in the order they were made.
 */
function findPendingEcho(data: ThreadData, row: DirectMessageRow): string | null {
  const at = timeOf(row.created_at);
  const key = payloadKey(row.kind, row.body, row.attachment_id, row.track_id);

  for (const page of data.pages) {
    for (let i = page.messages.length - 1; i >= 0; i -= 1) {
      const candidate = page.messages[i];
      if (!candidate?.pending) continue;
      if (candidate.senderId !== row.sender_id) continue;
      if (
        payloadKey(
          candidate.kind,
          candidate.body,
          candidate.attachment?.id ?? null,
          candidate.track?.id ?? null,
        ) !== key
      ) {
        continue;
      }
      if (Math.abs(timeOf(candidate.createdAt) - at) > ECHO_WINDOW_MS) continue;
      return candidate.id;
    }
  }

  return null;
}

/** Land a confirmed message in the thread cache exactly once, whichever path it arrives by. */
function commitMessage(client: QueryClient, message: DmMessage, row: DirectMessageRow) {
  client.setQueryData<ThreadData>(dmKeys.thread(message.conversationId), (data) => {
    if (!data) return data;
    if (hasMessage(data, message.id)) return data;

    const echoOf = findPendingEcho(data, row);
    return echoOf ? replaceMessage(data, echoOf, message) : insertNewest(data, message);
  });
}

/**
 * Coalesced inbox refresh.
 *
 * A burst of arriving messages would otherwise fire one invalidation per row,
 * and each inbox refetch costs a conversations query plus a count per unread
 * thread. Module-scoped rather than per-hook so the rail's inbox-wide
 * subscription and an open thread's subscription share one timer.
 */
let inboxRefreshTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleInboxRefresh(client: QueryClient) {
  if (inboxRefreshTimer) clearTimeout(inboxRefreshTimer);
  inboxRefreshTimer = setTimeout(() => {
    inboxRefreshTimer = null;
    void client.invalidateQueries({ queryKey: dmKeys.inbox() });
  }, INBOX_REFRESH_DEBOUNCE_MS);
}

/**
 * Replay whatever landed while nothing was subscribed.
 *
 * The subscription's lifetime is not the thread's: navigating away and back, or
 * a reconnect after a tunnel, both leave a hole. `staleTime` deliberately keeps
 * the cached log, so without this pass those messages would simply never appear.
 *
 * One keyset query for rows newer than the newest *confirmed* message, replayed
 * through `commitMessage` so the echo and duplicate rules still decide what lands.
 */
async function fillThreadGap(
  client: QueryClient,
  conversationId: string,
  viewerId: string | null,
): Promise<void> {
  const key = dmKeys.thread(conversationId);
  const data = client.getQueryData<ThreadData>(key);
  // A pending entry is stamped with our own clock, so it can never be the cursor.
  const newest = data?.pages[0]?.messages.find((message) => !message.pending);

  if (!newest) {
    // No confirmed message to measure from. If we have never fetched, the first
    // fetch is itself the catch-up; if we have, the thread was empty when we
    // went deaf and one refetch is the cheapest way to find out if it still is.
    if (data) void client.invalidateQueries({ queryKey: key });
    return;
  }

  const { data: rows, error } = await supabase
    .from('direct_messages')
    .select(THREAD_SELECT)
    .eq('conversation_id', conversationId)
    .is('deleted_at', null)
    .gt('created_at', newest.createdAt)
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE)
    .returns<ThreadSelectRow[]>();

  // This pass runs once per SUBSCRIBED and is never retried, so a swallowed
  // error is a permanent hole in the log. Throwing is not an option — the only
  // caller is fire-and-forget — so fall back to the refetch used below.
  if (error || !rows) {
    void client.invalidateQueries({ queryKey: key });
    return;
  }

  if (rows.length === 0) return;

  // A full page means the gap may be wider than we can see. Splicing that in
  // would leave a hole in the middle of the log, so refetch it properly.
  if (rows.length === PAGE_SIZE) {
    void client.invalidateQueries({ queryKey: key });
    return;
  }

  for (const row of rows) {
    rememberJoins(row);
    commitMessage(client, toDmMessage(row, viewerId), row);
  }
}

// ---------------------------------------------------------------- thread hook

export type UseThreadResult = {
  /** Newest first — the order an `inverted` FlatList wants. */
  messages: DmMessage[];
  isPending: boolean;
  isError: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
  refetch: () => void;
};

export function useThread(conversationId: string | null | undefined): UseThreadResult {
  const viewerId = useViewerId();

  const query = useInfiniteQuery({
    queryKey: dmKeys.thread(conversationId ?? 'none'),
    queryFn: ({ pageParam }) => fetchThreadPage(conversationId as string, pageParam, viewerId),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    /*
      Realtime keeps this list current *and* `useDmSubscription` fills the gap
      left by any window where nothing was subscribed, so refetching on remount
      would only repaint a log the user is already looking at. Older pages stay
      cached for the session; scrolling back up is free.
    */
    staleTime: 5 * 60_000,
    // `mine` is decided at map time, so fetching before the viewer id resolves
    // would right-align nothing and colour every bubble as the other person's.
    enabled: Boolean(conversationId) && viewerId !== null,
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

// ---------------------------------------------------------------- sending

type SendContext = { tempId: string; previous: ThreadData | undefined };

/**
 * The viewer's id, waiting on the session if the hook has not resolved yet.
 *
 * The optimistic entry must carry the real sender id: echo matching compares it
 * against the confirmed row's `sender_id`, and a placeholder would fail to
 * match, leaving the sender looking at their own message twice.
 */
async function requireUserId(hint: string | null): Promise<string> {
  if (hint) return hint;

  const { data } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new Error('You are signed out.');
  return id;
}

/**
 * Encode a send so `dm_payload_matches_kind` cannot reject it.
 *
 * The constraint is a `case` on kind, and the failure mode if the client gets
 * it wrong is a 400 *after* the optimistic bubble is already on screen — so the
 * shape is decided in one place, and anything malformed throws before a bubble
 * is painted rather than rolling one back a moment later.
 */
function buildInsert(
  input: SendDmInput,
  conversationId: string,
  senderId: string,
): TablesInsert<'direct_messages'> {
  const body = (input.body ?? '').trim();

  if (input.kind === 'text') {
    if (body.length === 0) throw new Error('Type something first.');
    return { conversation_id: conversationId, sender_id: senderId, kind: input.kind, body };
  }

  if (input.kind === 'track') {
    if (!input.trackId) throw new Error('That track could not be shared.');
    return {
      conversation_id: conversationId,
      sender_id: senderId,
      kind: input.kind,
      body,
      track_id: input.trackId,
    };
  }

  if (!input.attachmentId) throw new Error('That attachment did not finish uploading.');
  return {
    conversation_id: conversationId,
    sender_id: senderId,
    kind: input.kind,
    // A photo's caption rides along in `body`; the constraint permits it.
    body,
    attachment_id: input.attachmentId,
  };
}

/**
 * Send a direct message, optimistically.
 *
 * The conversation id is a hook argument rather than a mutation variable so the
 * composer passes it once and the cache key is fixed for the mutation's life.
 */
export function useSendMessage(
  conversationId: string,
): UseMutationResult<DirectMessageRow, Error, SendDmInput, SendContext> {
  const client = useQueryClient();
  const toast = useToast();
  const viewerId = useViewerId();
  const key = useMemo(() => dmKeys.thread(conversationId), [conversationId]);

  useEffect(() => {
    /*
      Warm the viewer's own profile. The author cache is otherwise filled only
      by messages that already exist, so the first thing you ever say to someone
      would render optimistically with no name and no avatar, then pop into
      place when the echo landed.
    */
    if (viewerId) void ensureAuthors([viewerId]);
  }, [viewerId]);

  return useMutation<DirectMessageRow, Error, SendDmInput, SendContext>({
    mutationFn: async (input) => {
      const senderId = await requireUserId(viewerId);

      const { data, error } = await supabase
        .from('direct_messages')
        .insert(buildInsert(input, conversationId, senderId))
        .select(DM_ROW_COLUMNS)
        .single();

      if (error) throw new Error(error.message);
      return data;
    },

    onMutate: async (input) => {
      // Throwing here aborts before mutationFn runs and before anything is
      // painted, so a malformed or signed-out send surfaces as a toast alone.
      const senderId = await requireUserId(viewerId);
      buildInsert(input, conversationId, senderId);

      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<ThreadData>(key);
      const tempId = `pending:${Crypto.randomUUID()}`;

      if (input.attachment) attachmentCache.set(input.attachment.id, input.attachment);
      if (input.track) trackCache.set(input.track.id, input.track);

      const optimistic: DmMessage = {
        id: tempId,
        conversationId,
        senderId,
        kind: input.kind,
        body: (input.body ?? '').trim(),
        /*
          serverNow(), not Date.now(): the echo-matching window compares this
          against a server-stamped created_at, and a device clock that is minutes
          off would push every optimistic message outside the window and show
          each one twice.
        */
        createdAt: new Date(serverNow()).toISOString(),
        deletedAt: null,
        author: authorCache.get(senderId) ?? null,
        attachment: input.attachmentId
          ? input.attachment ?? attachmentCache.get(input.attachmentId) ?? null
          : null,
        track: input.trackId ? input.track ?? trackCache.get(input.trackId) ?? null : null,
        mine: true,
        pending: true,
      };

      client.setQueryData<ThreadData>(key, (data) => (data ? insertNewest(data, optimistic) : data));

      return { tempId, previous };
    },

    onSuccess: (row, _input, context) => {
      client.setQueryData<ThreadData>(key, (data) => {
        if (!data) return data;

        // The realtime echo can beat the insert response back. If it already
        // reconciled this send, drop the placeholder and keep the confirmed row.
        if (hasMessage(data, row.id)) {
          return context ? removeMessage(data, context.tempId) : data;
        }

        const confirmed = toDmMessage(
          {
            ...row,
            sender: authorCache.get(row.sender_id) ?? null,
            attachment: row.attachment_id
              ? attachmentCache.get(row.attachment_id) ?? null
              : null,
            track: row.track_id ? trackCache.get(row.track_id) ?? null : null,
          },
          // This is our own send by definition, so `mine` is decided here
          // rather than read from a viewer id that may still be resolving.
          row.sender_id,
        );

        if (!context) return insertNewest(data, confirmed);

        const stillPending = data.pages.some((page) =>
          page.messages.some((message) => message.id === context.tempId),
        );

        return stillPending
          ? replaceMessage(data, context.tempId, confirmed)
          : insertNewest(data, confirmed);
      });

      // Your own send reorders the inbox and rewrites its preview.
      scheduleInboxRefresh(client);
    },

    onError: (error, _input, context) => {
      // Roll the optimistic entry back rather than leaving a bubble on screen
      // that the other person can never see.
      if (context) {
        client.setQueryData<ThreadData>(key, (data) =>
          data ? removeMessage(data, context.tempId) : data,
        );
      }
      toast.show(error.message || 'Message failed to send.', 'error');
    },
  });
}

// ---------------------------------------------------------------- realtime

/**
 * Stream direct messages into the cache.
 *
 * Pass a conversation id to watch one thread; pass `null` to subscribe
 * inbox-wide, which is what the rail's DM tile mounts so its badge is live
 * without the Messages screen ever having been opened. RLS filters the
 * replication stream, so the unfiltered subscription still only ever delivers
 * rows the viewer is a participant of.
 *
 * `direct_messages` is `replica identity full`, so UPDATE payloads carry the
 * whole row and a soft delete can be reconciled here instead of waiting for a
 * refetch.
 */
export function useDmSubscription(conversationId: string | null) {
  const client = useQueryClient();
  const viewerId = useViewerId();

  // A stable per-mount suffix: two components watching the same conversation
  // would otherwise collide on one channel topic and one would go silent.
  // A lazy initialiser, not `useRef(Crypto.randomUUID())`: a useRef argument is
  // evaluated on every render and thrown away on all but the first, which burns
  // entropy on a list that re-renders with every arriving message.
  const [channelSuffix] = useState(() => Crypto.randomUUID());

  useEffect(() => {
    const handleInsert = (payload: RealtimePostgresInsertPayload<DirectMessageRow>) => {
      const row = payload.new;
      if (row.deleted_at) return;
      if (conversationId && row.conversation_id !== conversationId) return;

      void hydrateRow(row, viewerId).then((message) => {
        // Commit unconditionally: `commitMessage` is a no-op when that thread
        // has no cache, so the inbox-wide subscription keeps an open thread
        // current without needing to know which one is on screen.
        commitMessage(client, message, row);
      });

      scheduleInboxRefresh(client);
    };

    const handleUpdate = (payload: RealtimePostgresUpdatePayload<DirectMessageRow>) => {
      const row = payload.new;
      if (conversationId && row.conversation_id !== conversationId) return;

      // `deleted_at` is the only column the client may write, so an UPDATE is
      // always a soft delete. Drop it from the log the way the fetch would.
      if (row.deleted_at) {
        client.setQueryData<ThreadData>(dmKeys.thread(row.conversation_id), (data) =>
          data ? removeMessage(data, row.id) : data,
        );
        scheduleInboxRefresh(client);
      }
    };

    const filter = conversationId ? `conversation_id=eq.${conversationId}` : undefined;

    const channel = supabase
      .channel(`dm:${conversationId ?? 'inbox'}:${channelSuffix}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'direct_messages', ...(filter ? { filter } : {}) },
        handleInsert,
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'direct_messages', ...(filter ? { filter } : {}) },
        handleUpdate,
      )
      .subscribe((status) => {
        // Fill the hole only once the socket is actually listening, so anything
        // arriving mid-fill is delivered here too and deduped by `commitMessage`.
        // `status` is a string enum realtime-js does not re-export, hence String().
        if (String(status) !== 'SUBSCRIBED') return;
        if (conversationId) void fillThreadGap(client, conversationId, viewerId);
        scheduleInboxRefresh(client);
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [channelSuffix, client, conversationId, viewerId]);
}

// ---------------------------------------------------------------- open / read

/**
 * Open (or reuse) the 1:1 thread with someone, and get its id.
 *
 * There is deliberately no INSERT policy on `conversations`; the RPC is the only
 * way in, and it returns the existing thread for a pair, so tapping MESSAGE
 * twice cannot split the history into two threads.
 */
export function useOpenConversation(): UseMutationResult<string, Error, string> {
  const client = useQueryClient();
  const toast = useToast();

  return useMutation<string, Error, string>({
    mutationFn: async (otherUserId) => {
      const { data, error } = await supabase.rpc('open_direct_conversation', {
        p_other: otherUserId,
      });

      if (error) throw new Error(error.message);
      if (!data) throw new Error('Could not open that conversation.');
      return data;
    },
    onSuccess: () => {
      // A brand-new thread has to appear in the inbox behind the screen you
      // just pushed, or backing out of it lands on a list that has never heard
      // of the person you were talking to.
      void client.invalidateQueries({ queryKey: dmKeys.inbox() });
    },
    onError: (error) => {
      toast.show(error.message || 'Could not open that conversation.', 'error');
    },
  });
}

/**
 * Move the read cursor.
 *
 * Returns a stable callback rather than the mutation object: this is called from
 * an effect on open and from an `onEndReached`-style handler at the bottom of
 * the thread, and react-query hands back a fresh result object every render.
 *
 * The inbox row is zeroed immediately so the badge clears the instant the thread
 * opens — the RPC is reconciliation, and a failed one is silent because a stale
 * badge is not worth a toast over the conversation you are already reading.
 */
export function useMarkRead(conversationId: string | null | undefined): () => void {
  const client = useQueryClient();

  const { mutate } = useMutation<void, Error, string>({
    mutationFn: async (id) => {
      const { error } = await supabase.rpc('mark_conversation_read', {
        p_conversation_id: id,
      });
      if (error) throw new Error(error.message);
    },
    onMutate: async (id) => {
      client.setQueryData<InboxRow[]>(dmKeys.inbox(), (rows) =>
        rows?.map((row) =>
          row.conversationId === id
            ? { ...row, unreadCount: 0, lastReadAt: new Date(serverNow()).toISOString() }
            : row,
        ),
      );
    },
    onSettled: () => {
      scheduleInboxRefresh(client);
    },
  });

  return useCallback(() => {
    if (!conversationId) return;
    mutate(conversationId);
  }, [conversationId, mutate]);
}

// ---------------------------------------------------------------- deleting

type DeleteContext = { previous: ThreadData | undefined };

/**
 * Soft-delete a message.
 *
 * `deleted_at` is the only column `authenticated` may update on this table, and
 * only on rows they sent — the row survives so the messages around it keep the
 * context they were written in, while every read path filters it out.
 *
 * Takes the message rather than an id because the conversation it belongs to is
 * what names the cache to edit, and every caller (a row, a long-press sheet)
 * already has the whole object in hand.
 */
export function useDeleteMessage(): (
  message: Pick<DmMessage, 'id' | 'conversationId'>,
) => void {
  const client = useQueryClient();
  const toast = useToast();

  const { mutate } = useMutation<
    void,
    Error,
    Pick<DmMessage, 'id' | 'conversationId'>,
    DeleteContext
  >({
    mutationFn: async ({ id }) => {
      const { error } = await supabase
        .from('direct_messages')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw new Error(error.message);
    },
    onMutate: async ({ id, conversationId }) => {
      const key = dmKeys.thread(conversationId);
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<ThreadData>(key);
      client.setQueryData<ThreadData>(key, (data) => (data ? removeMessage(data, id) : data));
      return { previous };
    },
    onError: (error, { conversationId }, context) => {
      // Restoring the whole snapshot rather than re-inserting keeps the message
      // at its original position in the log.
      if (context?.previous) {
        client.setQueryData(dmKeys.thread(conversationId), context.previous);
      }
      toast.show(error.message || 'Could not delete that message.', 'error');
    },
    onSuccess: () => {
      // The inbox may have been previewing the message that just vanished.
      scheduleInboxRefresh(client);
    },
  });

  return useCallback(
    (message: Pick<DmMessage, 'id' | 'conversationId'>) => mutate(message),
    [mutate],
  );
}

// ---------------------------------------------------------------- uploads

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
  'application/pdf': 'pdf',
};

/** Lowercase, alphanumeric, at most five characters — never a path fragment. */
function extensionFor(input: UploadAttachmentInput): string {
  const fromName = input.fileName?.split('.').pop();
  const fromUri = input.uri.split('?')[0]?.split('#')[0]?.split('.').pop();

  for (const candidate of [fromName, fromUri]) {
    const cleaned = candidate?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? '';
    if (cleaned.length > 0 && cleaned.length <= 5) return cleaned;
  }

  return EXTENSION_BY_MIME[input.mimeType.toLowerCase()] ?? 'bin';
}

/**
 * Read a local picker/recorder URI into something the storage client can send.
 *
 * `fetch` on a `file://` or `content://` URI is handled natively by React
 * Native's networking stack, so this needs no filesystem dependency. ArrayBuffer
 * is the reliable body on native — a Blob from the RN registry is a handle
 * rather than bytes — with a Blob fallback for web, where `arrayBuffer()` on a
 * `blob:` response is occasionally the thing that is missing instead.
 */
async function readLocalFile(uri: string): Promise<ArrayBuffer | Blob> {
  try {
    const buffer = await (await fetch(uri)).arrayBuffer();
    // An empty buffer is the quiet failure mode, not an exception — treat it as
    // "this path did not work" rather than reporting an empty file.
    if (buffer.byteLength > 0) return buffer;
  } catch {
    // Fall through to the Blob path.
  }

  return await (await fetch(uri)).blob();
}

const sizeOf = (body: ArrayBuffer | Blob) =>
  body instanceof ArrayBuffer ? body.byteLength : body.size;

/** smallint, and the design draws the bars as a 0..100 percentage. */
const clampWaveform = (waveform: number[]) =>
  waveform.map((value) => Math.max(0, Math.min(100, Math.round(value))));

/**
 * Upload one attachment and register it.
 *
 * Two steps that must both land: the bytes go to `dm-media/<user-id>/<uuid>.<ext>`
 * — the folder is what the storage policy checks — and then the `attachments`
 * row is inserted. If the row insert fails the object is removed again, because
 * an orphaned object in a private bucket is unreachable by anything and would
 * just sit against the user's quota forever.
 *
 * Resolves to the attachment id, which is what `useSendMessage` wants. The row
 * is also cached, so the optimistic bubble for the message that carries it can
 * render the real waveform and dimensions immediately.
 */
export function useUploadAttachment(): UseMutationResult<string, Error, UploadAttachmentInput> {
  const toast = useToast();
  const viewerId = useViewerId();

  return useMutation<string, Error, UploadAttachmentInput>({
    mutationFn: async (input) => {
      const ownerId = await requireUserId(viewerId);

      // The schema's `attachments_voice_has_duration` check, caught before a
      // 25MB upload is spent finding out.
      if (input.kind === 'voice' && !input.durationMs) {
        throw new Error('That recording has no length.');
      }

      const body = await readLocalFile(input.uri);
      const sizeBytes = sizeOf(body);
      if (sizeBytes <= 0) throw new Error('That file is empty.');

      const storagePath = `${ownerId}/${Crypto.randomUUID()}.${extensionFor(input)}`;

      const { error: uploadError } = await supabase.storage
        .from(DM_MEDIA_BUCKET)
        .upload(storagePath, body, { contentType: input.mimeType, upsert: false });

      if (uploadError) throw new Error(uploadError.message);

      const { data, error } = await supabase
        .from('attachments')
        .insert({
          owner_id: ownerId,
          kind: input.kind,
          storage_path: storagePath,
          mime_type: input.mimeType,
          size_bytes: sizeBytes,
          duration_ms: input.durationMs ?? null,
          width: input.width ?? null,
          height: input.height ?? null,
          waveform: input.waveform ? clampWaveform(input.waveform) : null,
        })
        .select(ATTACHMENT_COLUMNS)
        .single<DmAttachment>();

      if (error) {
        await supabase.storage.from(DM_MEDIA_BUCKET).remove([storagePath]);
        throw new Error(error.message);
      }

      attachmentCache.set(data.id, data);
      return data.id;
    },

    onError: (error) => {
      toast.show(error.message || 'That attachment did not upload.', 'error');
    },
  });
}

// ---------------------------------------------------------------- signed URLs

/**
 * A readable URL for a private `dm-media` object.
 *
 * The bucket is private, so a public URL 400s — every photo, video, file and
 * voice note has to be signed before it can be rendered or played. Keyed by
 * path so a thread that shows the same attachment twice signs it once, and
 * refreshed ten minutes before the hour is up so a URL cannot expire under a
 * bubble that is still on screen.
 *
 * Returns the URL, or null while it is being minted.
 */
export function useSignedUrl(storagePath: string | null | undefined): string | null {
  const { data } = useQuery({
    queryKey: dmKeys.signedUrl(storagePath ?? 'none'),
    queryFn: async () => {
      const { data: signed, error } = await supabase.storage
        .from(DM_MEDIA_BUCKET)
        .createSignedUrl(storagePath as string, SIGNED_URL_TTL_SECONDS);

      if (error) throw new Error(error.message);
      return signed.signedUrl;
    },
    enabled: Boolean(storagePath),
    staleTime: SIGNED_URL_REFRESH_MS,
    gcTime: SIGNED_URL_TTL_SECONDS * 1000,
    refetchInterval: SIGNED_URL_REFRESH_MS,
    // A signature that failed to mint is almost always a permissions answer,
    // and retrying it per bubble in a long thread is a lot of noise for a
    // result that will not change.
    retry: 1,
  });

  return data ?? null;
}
