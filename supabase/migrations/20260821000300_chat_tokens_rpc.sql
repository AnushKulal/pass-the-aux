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
