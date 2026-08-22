-- Aux — source-agnostic tracks, provider links, live Sessions, and the queue.

-- ---------------------------------------------------------------- tracks
-- A track is stored ONCE, independent of where it can be played. The links
-- table maps it to Spotify / YouTube so a Premium listener and a free listener
-- in the same Session hear the same song from different providers.
create table public.tracks (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  artist       text not null,
  album        text,
  duration_ms  integer not null check (duration_ms > 0),
  isrc         text,
  artwork_url  text,
  created_at   timestamptz not null default now()
);

-- ISRC is the industry identifier; when Spotify gives us one it is the
-- strongest possible dedupe key. Partial index so NULLs do not collide.
create unique index tracks_isrc_key on public.tracks (isrc) where isrc is not null;
create index tracks_search_idx on public.tracks
  using gin (to_tsvector('simple', title || ' ' || artist));

create type public.music_provider as enum ('spotify', 'youtube');

create table public.track_links (
  track_id    uuid not null references public.tracks(id) on delete cascade,
  provider    public.music_provider not null,
  provider_id text not null,
  confidence  real not null default 1.0 check (confidence between 0 and 1),
  created_at  timestamptz not null default now(),
  primary key (track_id, provider)
);

create unique index track_links_provider_key on public.track_links (provider, provider_id);

-- ---------------------------------------------------------------- rooms (Sessions)
-- ONE ROW IS THE ENTIRE TRUTH about what a Session is playing.
-- started_at_ms is the server-clock instant at which position 0 of the current
-- track played. Every client derives its own position from it:
--   expected = server_now  - started_at_ms     while playing
--   expected = paused_at_ms - started_at_ms    while paused
-- No audio ever passes through the backend.
create table public.rooms (
  id            uuid primary key default gen_random_uuid(),
  lounge_id     uuid not null references public.lounges(id) on delete cascade,
  name          text not null default 'Session' check (char_length(name) between 1 and 50),
  host_id       uuid not null references public.profiles(id) on delete cascade,
  track_id      uuid references public.tracks(id) on delete set null,
  started_at_ms bigint,
  paused_at_ms  bigint,
  is_playing    boolean not null default false,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),

  -- A playing room must know what it is playing and since when.
  constraint rooms_playing_needs_track check (
    not is_playing or (track_id is not null and started_at_ms is not null)
  )
);

create index rooms_lounge_idx on public.rooms (lounge_id, is_active, created_at desc);

create table public.room_participants (
  room_id   uuid not null references public.rooms(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  is_synced boolean not null default true,
  primary key (room_id, user_id)
);

create index room_participants_user_idx on public.room_participants (user_id);

-- ---------------------------------------------------------------- queue
create table public.queue_items (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references public.rooms(id) on delete cascade,
  track_id   uuid not null references public.tracks(id) on delete cascade,
  added_by   uuid not null references public.profiles(id) on delete cascade,
  position   double precision not null,
  played_at  timestamptz,
  created_at timestamptz not null default now()
);

-- Fractional positions so a reorder is a single UPDATE (drop the row in at
-- (prev + next) / 2) instead of renumbering the whole queue.
create index queue_items_room_idx on public.queue_items (room_id, position)
  where played_at is null;

-- ------------------------------------------------------- room RLS helpers
create or replace function public.can_access_room(p_room_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.rooms r
    join public.lounge_members m on m.lounge_id = r.lounge_id
    where r.id = p_room_id and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_room_host(p_room_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.rooms where id = p_room_id and host_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------- policies
alter table public.tracks            enable row level security;
alter table public.track_links       enable row level security;
alter table public.rooms             enable row level security;
alter table public.room_participants enable row level security;
alter table public.queue_items       enable row level security;

-- The catalog is shared MUTABLE state: one `tracks` row and one `track_links`
-- row are what EVERY user in the app plays from. And a link is write-once by
-- construction — unique on (provider, provider_id), primary key on
-- (track_id, provider), with deliberately no update or delete policy — so the
-- first writer of a mapping is the only writer, permanently. A client insert
-- would therefore be a one-shot, irreversible way to point "Song A" at Song B's
-- audio for everyone. Reads stay open to any signed-in user; writes are
-- server-owned, done by the `resolve-track` Edge Function under the service
-- role, which bypasses RLS.
create policy "catalog is readable" on public.tracks
  for select to authenticated using (true);

create policy "links are readable" on public.track_links
  for select to authenticated using (true);

-- Sessions are scoped to their lounge.
create policy "lounge members see sessions" on public.rooms
  for select to authenticated using (public.is_lounge_member(lounge_id));
create policy "lounge members start sessions" on public.rooms
  for insert to authenticated
  with check (public.is_lounge_member(lounge_id) and host_id = auth.uid());
-- Only whoever is on aux may move playback.
create policy "the host controls playback" on public.rooms
  for update to authenticated
  using (host_id = auth.uid()) with check (host_id = auth.uid());
create policy "host or lounge mods close a session" on public.rooms
  for delete to authenticated
  using (host_id = auth.uid() or public.lounge_role(lounge_id) in ('owner', 'mod'));

create policy "participants are visible in-session" on public.room_participants
  for select to authenticated using (public.can_access_room(room_id));
create policy "users join sessions as themselves" on public.room_participants
  for insert to authenticated
  with check (user_id = auth.uid() and public.can_access_room(room_id));
create policy "users update their own sync flag" on public.room_participants
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "users leave; host can remove" on public.room_participants
  for delete to authenticated
  using (user_id = auth.uid() or public.is_room_host(room_id));

-- Anyone in the Session can add to the queue. That is the whole point.
create policy "queue is visible in-session" on public.queue_items
  for select to authenticated using (public.can_access_room(room_id));
create policy "anyone in-session queues a track" on public.queue_items
  for insert to authenticated
  with check (added_by = auth.uid() and public.can_access_room(room_id));
create policy "host reorders the queue" on public.queue_items
  for update to authenticated
  using (public.is_room_host(room_id)) with check (public.is_room_host(room_id));
create policy "adder or host removes from queue" on public.queue_items
  for delete to authenticated
  using (added_by = auth.uid() or public.is_room_host(room_id));
