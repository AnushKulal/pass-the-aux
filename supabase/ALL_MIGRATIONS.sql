-- Aux — complete schema, all four migrations concatenated IN ORDER.
-- Paste this whole file into the Supabase SQL editor and run it once.
-- Generated from supabase/migrations/ — edit those files, not this one.

-- ============================================================
-- 20260821000100_init_core.sql
-- ============================================================

-- Aux — core schema: profiles, lounges, membership
-- Everything denies by default; policies below grant the minimum.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- profiles
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  username      text unique not null check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name  text not null default '',
  avatar_url    text,
  spotify_linked boolean not null default false,
  is_premium    boolean not null default false,
  created_at    timestamptz not null default now()
);

comment on table public.profiles is 'Public-facing user identity. Mirrors auth.users 1:1.';

-- Auto-create a profile on signup. Username defaults to a slug of the email,
-- de-duplicated with a short random suffix; the user can claim a real one later.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
-- `extensions` is on the path because gen_random_bytes() below is pgcrypto's,
-- and Supabase installs pgcrypto there rather than into public. Without it the
-- dedupe loop throws — but ONLY on a username collision, so a fresh database
-- signs up its first user fine and dies on the second.
security definer set search_path = public, extensions
as $$
declare
  base text;
  candidate text;
begin
  base := lower(regexp_replace(split_part(new.email, '@', 1), '[^a-z0-9_]', '', 'g'));
  if length(base) < 3 then base := 'user'; end if;
  base := left(base, 14);
  candidate := base;
  while exists (select 1 from public.profiles where username = candidate) loop
    candidate := base || '_' || substr(encode(gen_random_bytes(3), 'hex'), 1, 5);
  end loop;

  insert into public.profiles (id, username, display_name, avatar_url)
  values (
    new.id,
    candidate,
    coalesce(new.raw_user_meta_data->>'full_name', candidate),
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Invite codes need pgcrypto, which lives in the `extensions` schema. Wrapping
-- the call in its own function pins the search_path once, so the column default
-- below cannot break depending on who is inserting.
create or replace function public.new_invite_code()
returns text
language sql
volatile
security definer set search_path = public, extensions
as $$
  select upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8));
$$;

-- ---------------------------------------------------------------- lounges
create table public.lounges (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(name) between 2 and 50),
  slug         text unique not null,
  description  text not null default '',
  icon_url     text,
  owner_id     uuid not null references public.profiles(id) on delete cascade,
  is_public    boolean not null default true,
  invite_code  text unique not null default public.new_invite_code(),
  created_at   timestamptz not null default now()
);

create index lounges_public_idx on public.lounges (is_public, created_at desc);
create index lounges_owner_idx  on public.lounges (owner_id);

create type public.member_role as enum ('owner', 'mod', 'member');

create table public.lounge_members (
  lounge_id  uuid not null references public.lounges(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role       public.member_role not null default 'member',
  joined_at  timestamptz not null default now(),
  primary key (lounge_id, user_id)
);

create index lounge_members_user_idx on public.lounge_members (user_id);

-- The owner is a member from the moment the lounge exists.
create or replace function public.handle_new_lounge()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.lounge_members (lounge_id, user_id, role)
  values (new.id, new.owner_id, 'owner');
  return new;
end;
$$;

create trigger on_lounge_created
  after insert on public.lounges
  for each row execute function public.handle_new_lounge();

-- ------------------------------------------------------- RLS helper (no recursion)
-- SECURITY DEFINER so that policies on lounge_members can call it without
-- re-entering lounge_members' own RLS check and deadlocking on itself.
create or replace function public.is_lounge_member(p_lounge_id uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.lounge_members
    where lounge_id = p_lounge_id and user_id = auth.uid()
  );
$$;

create or replace function public.lounge_role(p_lounge_id uuid)
returns public.member_role
language sql
stable
security definer set search_path = public
as $$
  select role from public.lounge_members
  where lounge_id = p_lounge_id and user_id = auth.uid();
$$;

-- ---------------------------------------------------------------- policies
alter table public.profiles       enable row level security;
alter table public.lounges        enable row level security;
alter table public.lounge_members enable row level security;

-- Profiles are public reads (needed to render avatars in feeds), self-writes only.
create policy "profiles are readable by authenticated users"
  on public.profiles for select to authenticated using (true);
create policy "users update their own profile"
  on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Public lounges are discoverable; private ones only to members.
-- `owner_id = auth.uid()` is not redundant with membership: the owner's
-- lounge_members row is added by an AFTER INSERT trigger, which has not fired
-- when INSERT ... RETURNING evaluates this policy. Without it, creating a
-- private lounge succeeds but fails to return the row it just created.
create policy "public lounges or own lounges are readable"
  on public.lounges for select to authenticated
  using (is_public or owner_id = auth.uid() or public.is_lounge_member(id));
create policy "authenticated users create lounges they own"
  on public.lounges for insert to authenticated with check (owner_id = auth.uid());
create policy "owners and mods update their lounge"
  on public.lounges for update to authenticated
  using (public.lounge_role(id) in ('owner', 'mod'))
  with check (public.lounge_role(id) in ('owner', 'mod'));
create policy "owners delete their lounge"
  on public.lounges for delete to authenticated using (owner_id = auth.uid());

-- Membership is visible to fellow members only.
create policy "members read the roster"
  on public.lounge_members for select to authenticated
  using (public.is_lounge_member(lounge_id));
-- Three conditions, and all three matter:
--
--   user_id = auth.uid()   you may only add YOURSELF.
--   role = 'member'        you may not hand yourself a rank. Without this, any
--                          user could insert role 'owner' for a lounge they
--                          just found in Explore; `lounge_role()` would then
--                          return 'owner' and every mod-gated policy in the
--                          schema would open up to them.
--   the lounge is public   you may not walk into a private lounge by knowing
--                          its UUID. RLS hiding the lounge row from SELECT does
--                          NOT stop an INSERT that merely references its id, so
--                          without this the invite code would be decorative.
--
-- Private lounges are joined through `join_lounge_by_code`, which is SECURITY
-- DEFINER, checks the code, and hard-codes role 'member'.
create policy "users join public lounges as themselves"
  on public.lounge_members for insert to authenticated
  with check (
    user_id = auth.uid()
    and role = 'member'
    and exists (
      select 1 from public.lounges l
      where l.id = lounge_id and l.is_public
    )
  );
create policy "users leave lounges themselves; owners/mods can remove"
  on public.lounge_members for delete to authenticated
  using (user_id = auth.uid() or public.lounge_role(lounge_id) in ('owner', 'mod'));

-- Note there is deliberately NO update policy on lounge_members: a role change
-- must go through `set_member_role` below, so promotion is always an explicit,
-- owner-only act rather than a column a member can write to.

-- ------------------------------------------------- column-level privileges
-- RLS decides WHICH ROWS a user may update. It cannot decide which COLUMNS.
-- The lounge update policy admits owners and mods, so without this a mod could
-- set `owner_id = auth.uid()`, which then satisfies the owner-only DELETE
-- policy and lets them destroy the lounge and everything cascading from it.
-- Ownership transfer is intentionally not a client-writable operation.
revoke update on public.lounges from authenticated;
grant update (name, description, icon_url, is_public, invite_code)
  on public.lounges to authenticated;

-- Profiles need the same treatment for the same reason: the self-update policy
-- is row-scoped, so on its own it lets a user write ANY column of their own row
-- — including `is_premium` and `spotify_linked`, which only the `spotify-auth`
-- Edge Function may set, from the `product` field Spotify itself returns.
-- A self-granted Premium flag is not a harmless lie: it routes the user to the
-- Spotify playback adapter, which then 403s on every playback call, so the app
-- fails for them everywhere instead of falling back to YouTube.
revoke update on public.profiles from authenticated;
grant update (username, display_name, avatar_url) on public.profiles to authenticated;

-- ------------------------------------------------------- role management
-- Only the owner may change ranks, and the owner's own rank is immutable —
-- otherwise a lounge could be left with no owner at all.
create or replace function public.set_member_role(
  p_lounge_id uuid,
  p_user_id   uuid,
  p_role      public.member_role
)
returns public.lounge_members
language plpgsql security definer set search_path = public
as $$
declare
  v_row public.lounge_members;
begin
  if public.lounge_role(p_lounge_id) <> 'owner' then
    raise exception 'not_lounge_owner' using errcode = '42501';
  end if;

  if p_role = 'owner' then
    raise exception 'ownership_transfer_unsupported' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.lounges
    where id = p_lounge_id and owner_id = p_user_id
  ) then
    raise exception 'cannot_demote_owner' using errcode = '22023';
  end if;

  update public.lounge_members
  set role = p_role
  where lounge_id = p_lounge_id and user_id = p_user_id
  returning * into v_row;

  if v_row.user_id is null then
    raise exception 'not_a_member' using errcode = 'P0002';
  end if;

  return v_row;
end;
$$;

-- ============================================================
-- 20260821000200_music_and_rooms.sql
-- ============================================================

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

-- ============================================================
-- 20260821000300_chat_tokens_rpc.sql
-- ============================================================

-- Aux — chat, provider tokens, and the server-authoritative playback RPCs.

-- ---------------------------------------------------------------- chat
-- One table serves both lounge chat (room_id null) and session chat (room_id set).
create table public.messages (
  id         uuid primary key default gen_random_uuid(),
  lounge_id  uuid not null references public.lounges(id) on delete cascade,
  room_id    uuid references public.rooms(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index messages_lounge_idx on public.messages (lounge_id, created_at desc)
  where room_id is null;
create index messages_room_idx on public.messages (room_id, created_at desc)
  where room_id is not null;

create table public.reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  emoji      text not null check (char_length(emoji) <= 8),
  primary key (message_id, user_id, emoji)
);

-- ---------------------------------------------------------------- provider tokens
-- OAuth tokens live here and are NEVER exposed to a client. There are no RLS
-- policies on this table at all: with RLS enabled and zero policies, every
-- request through the anon/authenticated roles sees nothing. Only Edge
-- Functions using the service role key (which bypasses RLS) can read it.
create table public.provider_tokens (
  user_id       uuid not null references public.profiles(id) on delete cascade,
  provider      public.music_provider not null,
  access_token  text not null,
  refresh_token text,
  scope         text,
  expires_at    timestamptz not null,
  updated_at    timestamptz not null default now(),
  primary key (user_id, provider)
);

-- ---------------------------------------------------------------- sync telemetry
-- Drift samples, used to prove the sync engine works. Write-only for clients.
create table public.sync_metrics (
  id         bigserial primary key,
  room_id    uuid not null references public.rooms(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  provider   public.music_provider not null,
  drift_ms   integer not null,
  platform   text,
  created_at timestamptz not null default now()
);

create index sync_metrics_room_idx on public.sync_metrics (room_id, created_at desc);

-- ================================================================ RPCs
-- The client cannot be trusted with the clock. Every mutation that establishes
-- a playback timeline is computed HERE, from the database clock, so all
-- listeners are anchored to the same instant no matter how wrong their device
-- clock is.

create or replace function public.server_time_ms()
returns bigint
language sql stable
as $$
  select (extract(epoch from clock_timestamp()) * 1000)::bigint;
$$;

comment on function public.server_time_ms is
  'Authoritative clock. Clients sample this to compute their offset.';

-- Join a lounge with an invite code. SECURITY DEFINER because the caller is not
-- yet a member and therefore cannot see a private lounge to join it.
create or replace function public.join_lounge_by_code(p_code text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_lounge_id uuid;
begin
  select id into v_lounge_id
  from public.lounges
  where invite_code = upper(trim(p_code));

  if v_lounge_id is null then
    raise exception 'invalid_invite_code' using errcode = 'P0002';
  end if;

  insert into public.lounge_members (lounge_id, user_id, role)
  values (v_lounge_id, auth.uid(), 'member')
  on conflict (lounge_id, user_id) do nothing;

  return v_lounge_id;
end;
$$;

-- Start a track at a given offset. started_at_ms is stamped from the DB clock,
-- so "position 0 happened at T" is a fact every client agrees on.
create or replace function public.room_play(
  p_room_id     uuid,
  p_track_id    uuid,
  p_position_ms integer default 0
)
returns public.rooms
language plpgsql security definer set search_path = public
as $$
declare
  v_room public.rooms;
begin
  if not public.is_room_host(p_room_id) then
    raise exception 'not_on_aux' using errcode = '42501';
  end if;

  update public.rooms
  set track_id      = p_track_id,
      started_at_ms = public.server_time_ms() - greatest(p_position_ms, 0),
      paused_at_ms  = null,
      is_playing    = true
  where id = p_room_id
  returning * into v_room;

  return v_room;
end;
$$;

create or replace function public.room_pause(p_room_id uuid)
returns public.rooms
language plpgsql security definer set search_path = public
as $$
declare
  v_room public.rooms;
begin
  if not public.is_room_host(p_room_id) then
    raise exception 'not_on_aux' using errcode = '42501';
  end if;

  update public.rooms
  set paused_at_ms = public.server_time_ms(),
      is_playing   = false
  where id = p_room_id and is_playing
  returning * into v_room;

  -- Already paused: return the row unchanged rather than erroring, so a
  -- double-tap on pause is a no-op instead of a failure.
  if v_room.id is null then
    select * into v_room from public.rooms where id = p_room_id;
  end if;

  return v_room;
end;
$$;

-- Resume preserves the position held at pause by sliding started_at_ms forward
-- by exactly how long the room sat paused.
create or replace function public.room_resume(p_room_id uuid)
returns public.rooms
language plpgsql security definer set search_path = public
as $$
declare
  v_room public.rooms;
begin
  if not public.is_room_host(p_room_id) then
    raise exception 'not_on_aux' using errcode = '42501';
  end if;

  update public.rooms
  set started_at_ms = started_at_ms + (public.server_time_ms() - paused_at_ms),
      paused_at_ms  = null,
      is_playing    = true
  where id = p_room_id and not is_playing and paused_at_ms is not null
  returning * into v_room;

  if v_room.id is null then
    select * into v_room from public.rooms where id = p_room_id;
  end if;

  return v_room;
end;
$$;

create or replace function public.room_seek(p_room_id uuid, p_position_ms integer)
returns public.rooms
language plpgsql security definer set search_path = public
as $$
declare
  v_room public.rooms;
begin
  if not public.is_room_host(p_room_id) then
    raise exception 'not_on_aux' using errcode = '42501';
  end if;

  update public.rooms
  set started_at_ms = public.server_time_ms() - greatest(p_position_ms, 0),
      paused_at_ms  = case when is_playing then null else public.server_time_ms() end
  where id = p_room_id
  returning * into v_room;

  return v_room;
end;
$$;

-- Pop the next unplayed queue item and start it. Called by the host client when
-- the current track ends, and by the skip button.
create or replace function public.room_advance(p_room_id uuid)
returns public.rooms
language plpgsql security definer set search_path = public
as $$
declare
  v_next  public.queue_items;
  v_room  public.rooms;
begin
  if not public.is_room_host(p_room_id) then
    raise exception 'not_on_aux' using errcode = '42501';
  end if;

  select * into v_next
  from public.queue_items
  where room_id = p_room_id and played_at is null
  order by position
  limit 1;

  if v_next.id is null then
    -- Queue is empty: stop cleanly rather than looping the last track.
    update public.rooms
    set is_playing = false, paused_at_ms = public.server_time_ms()
    where id = p_room_id
    returning * into v_room;
    return v_room;
  end if;

  update public.queue_items set played_at = now() where id = v_next.id;

  update public.rooms
  set track_id      = v_next.track_id,
      started_at_ms = public.server_time_ms(),
      paused_at_ms  = null,
      is_playing    = true
  where id = p_room_id
  returning * into v_room;

  return v_room;
end;
$$;

-- Append to the end of the queue without a read-modify-write race: take the
-- current max position and add a whole step, leaving room to insert between.
create or replace function public.queue_append(p_room_id uuid, p_track_id uuid)
returns public.queue_items
language plpgsql security definer set search_path = public
as $$
declare
  v_item public.queue_items;
begin
  if not public.can_access_room(p_room_id) then
    raise exception 'not_in_session' using errcode = '42501';
  end if;

  insert into public.queue_items (room_id, track_id, added_by, position)
  select p_room_id, p_track_id, auth.uid(),
         coalesce(max(position), 0) + 1024
  from public.queue_items
  where room_id = p_room_id and played_at is null
  returning * into v_item;

  return v_item;
end;
$$;

-- ---------------------------------------------------------------- policies
alter table public.messages        enable row level security;
alter table public.reactions       enable row level security;
alter table public.provider_tokens enable row level security;  -- no policies: deny all
alter table public.sync_metrics    enable row level security;

create policy "lounge members read chat" on public.messages
  for select to authenticated using (public.is_lounge_member(lounge_id));
create policy "lounge members post chat" on public.messages
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_lounge_member(lounge_id));
create policy "authors delete their messages" on public.messages
  for delete to authenticated
  using (user_id = auth.uid() or public.lounge_role(lounge_id) in ('owner', 'mod'));

create policy "reactions readable with the message" on public.reactions
  for select to authenticated using (
    exists (select 1 from public.messages m
            where m.id = message_id and public.is_lounge_member(m.lounge_id))
  );
-- The same membership test as the select policy, and it has to be repeated here:
-- RLS hiding the message row does NOT stop an insert that merely references its
-- id, so without it anyone who learns a message UUID could react into a lounge
-- they were never in.
create policy "users react as themselves" on public.reactions
  for insert to authenticated with check (
    user_id = auth.uid()
    and exists (select 1 from public.messages m
                where m.id = message_id and public.is_lounge_member(m.lounge_id))
  );
create policy "users remove their own reaction" on public.reactions
  for delete to authenticated using (user_id = auth.uid());

-- Telemetry: clients write their own samples, nobody reads them from the app.
create policy "clients report their own drift" on public.sync_metrics
  for insert to authenticated with check (user_id = auth.uid());

-- ---------------------------------------------------------------- realtime
-- Only these tables stream row changes. rooms is the important one: every
-- playback change is a single UPDATE that fans out to every listener.
alter publication supabase_realtime add table public.rooms;
alter publication supabase_realtime add table public.room_participants;
alter publication supabase_realtime add table public.queue_items;
alter publication supabase_realtime add table public.messages;

-- The queue subscription in `useQueue` filters on room_id, and under the
-- default replica identity a DELETE writes ONLY the primary key (id) to the
-- WAL. Realtime therefore has no room_id to test the filter against and drops
-- the event, so removing a track updates the remover's screen and nobody
-- else's. Full replica identity puts the whole old row in the WAL so the
-- filter matches.
--
-- Deliberately not applied to the other three: `rooms` and `messages` are only
-- subscribed for UPDATE/INSERT, whose payloads already carry the full new row,
-- and `room_participants` filters on room_id, which is part of ITS composite
-- primary key and so is in the WAL on delete regardless. Full replica identity
-- costs WAL volume; it is not a default worth spreading.
alter table public.queue_items replica identity full;

-- ============================================================
-- 20260821000400_realtime_authorization.sql
-- ============================================================

-- Aux — Realtime Authorization for the Feed's presence channels.
--
-- The Feed rides on Realtime PRESENCE, one channel per lounge, topic
-- `lounge:<uuid>` (see src/features/presence/presence-client.ts). Postgres
-- tables are protected by RLS, but a Realtime topic is not a table: until a
-- topic is joined as a PRIVATE channel, Realtime performs no authorization at
-- all. The publishable anon key ships inside the app bundle, so without this
-- migration anyone who extracts it can join `lounge:<any-uuid>` and read who is
-- listening to what inside a lounge they were never invited to — and track()
-- fake presence into it.
--
-- Lives in its own migration because it is the only thing here that touches the
-- `realtime` schema.
--
-- ASSUMPTIONS, written blind against a Supabase version we cannot exercise
-- locally. If presence goes quiet after deploying, start here:
--   1. Realtime gates PRIVATE channels through RLS on `realtime.messages`.
--      `select` authorizes reading a topic (i.e. joining and receiving),
--      `insert` authorizes writing to it (broadcast and presence track()).
--   2. `realtime.topic()` returns the channel topic as the client named it,
--      un-prefixed — `lounge:<uuid>`.
--   3. RLS is already enabled on `realtime.messages` by the platform. We do not
--      enable it here: the migration role does not own that table, and with RLS
--      off these policies would be inert rather than wrong.
-- The client side of this is `config: { private: true }` on the presence
-- channel; the policies below do nothing for a channel that joins as public.

-- Topic parsing is factored out so the read and write policies cannot drift.
-- Returns NULL for any topic that is not exactly `lounge:<uuid>`, and the regex
-- guard matters: a bare `::uuid` cast on an attacker-chosen topic raises, and a
-- raising policy is a broken policy, not a denying one.
create or replace function public.realtime_lounge_topic()
returns uuid
language sql
stable
set search_path = public
as $$
  select case
    when realtime.topic() ~
      '^lounge:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then substring(realtime.topic() from 8)::uuid
  end;
$$;

-- `is_lounge_member(null)` is false, so every non-lounge topic falls through to
-- a plain deny — there is no policy granting anything else, which is what keeps
-- some future private channel from being open by accident.
create policy "lounge members read the lounge feed" on realtime.messages
  for select to authenticated
  using (public.is_lounge_member(public.realtime_lounge_topic()));

create policy "lounge members publish to the lounge feed" on realtime.messages
  for insert to authenticated
  with check (public.is_lounge_member(public.realtime_lounge_topic()));
