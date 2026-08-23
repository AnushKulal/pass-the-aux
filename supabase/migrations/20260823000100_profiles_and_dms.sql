-- Aux — profile presentation, and direct messages.
--
-- Closes two rows of the handoff's "Schema gaps" table:
--   Profiles                 bio, presence, activity flag, photo + video URLs
--   Messages / DM threads    conversations, direct_messages, attachments
--
-- Everything denies by default; the policies below grant the minimum.

-- ============================================================ profiles
-- The profile gate currently lives in AsyncStorage, which makes it per-device:
-- finish setup on one phone and the next one asks again. These columns move it
-- to the account where it belongs.
alter table public.profiles
  add column bio               text        not null default '',
  add column photo_url         text,
  add column profile_video_url text,
  -- "Show when I'm active" — governs the live dot and Feed presence.
  add column show_activity     boolean     not null default true,
  add column last_seen_at      timestamptz not null default now(),
  add column profile_done      boolean     not null default false;

alter table public.profiles
  add constraint profiles_bio_length check (char_length(bio) <= 300);

-- Presence is read constantly by the Feed and every roster; the partial index
-- keeps that cheap and skips the users who opted out of being shown at all.
create index profiles_active_idx on public.profiles (last_seen_at desc)
  where show_activity;

-- The gate is satisfied by a photo AND a bio, per the handoff's checklist. It
-- is computed here rather than trusted from the client so the two cannot drift.
create or replace function public.mark_profile_done()
returns public.profiles
language plpgsql security definer set search_path = public
as $$
declare
  v_row public.profiles;
begin
  update public.profiles
  set profile_done = true
  where id = auth.uid()
    and photo_url is not null
    and char_length(trim(bio)) > 0
  returning * into v_row;

  if v_row.id is null then
    raise exception 'profile_incomplete' using
      errcode = '22023',
      hint = 'A photo and a one-line bio are both required.';
  end if;

  return v_row;
end;
$$;

-- Cheap heartbeat for the presence dot. Its own function so the client never
-- needs UPDATE on profiles for something this routine.
create or replace function public.touch_last_seen()
returns void
language sql security definer set search_path = public
as $$
  update public.profiles set last_seen_at = now() where id = auth.uid();
$$;

-- `bio`, `photo_url` and `profile_video_url` join the writable set; the flags
-- the server owns (profile_done, last_seen_at) deliberately do not.
grant update (username, display_name, avatar_url, bio, photo_url, profile_video_url, show_activity)
  on public.profiles to authenticated;

-- ========================================================= attachments
-- Photos, files and voice notes. Rows here are metadata; the bytes live in the
-- `dm-media` storage bucket created at the end of this file.
create type public.attachment_kind as enum ('image', 'video', 'file', 'voice');

create table public.attachments (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references public.profiles(id) on delete cascade,
  kind         public.attachment_kind not null,
  /** Path within the `dm-media` bucket. */
  storage_path text not null,
  mime_type    text not null,
  size_bytes   integer not null check (size_bytes > 0),
  /** Voice notes and video only. */
  duration_ms  integer check (duration_ms is null or duration_ms > 0),
  width        integer,
  height       integer,
  /**
   * The 12-bar waveform the design draws on a voice note. Precomputed on upload
   * so a bubble never has to decode audio to render — small ints, 0..100.
   */
  waveform     smallint[],
  created_at   timestamptz not null default now(),

  constraint attachments_voice_has_duration
    check (kind <> 'voice' or duration_ms is not null)
);

create index attachments_owner_idx on public.attachments (owner_id, created_at desc);

-- ======================================================== conversations
create table public.conversations (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  /**
   * Denormalised so the inbox can sort without touching direct_messages.
   * Maintained by a trigger on insert.
   */
  last_message_at timestamptz not null default now()
);

create table public.conversation_participants (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  joined_at       timestamptz not null default now(),
  /** Everything after this instant is unread. Cheaper than a per-message flag. */
  last_read_at    timestamptz not null default 'epoch',
  primary key (conversation_id, user_id)
);

create index conversation_participants_user_idx
  on public.conversation_participants (user_id);

create type public.dm_kind as enum ('text', 'image', 'video', 'file', 'voice', 'track');

create table public.direct_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id       uuid not null references public.profiles(id) on delete cascade,
  kind            public.dm_kind not null default 'text',
  /** Text body, or the caption on a photo. */
  body            text not null default '',
  attachment_id   uuid references public.attachments(id) on delete set null,
  /** A shared-track card, with its ADD TO THE QUEUE action. */
  track_id        uuid references public.tracks(id) on delete set null,
  created_at      timestamptz not null default now(),
  /** Soft delete: the row survives so replies above it keep their context. */
  deleted_at      timestamptz,

  -- Each kind carries exactly the payload it is supposed to.
  constraint dm_payload_matches_kind check (
    case kind
      when 'text'  then attachment_id is null and track_id is null and char_length(body) > 0
      when 'track' then track_id is not null and attachment_id is null
      else attachment_id is not null and track_id is null
    end
  ),
  constraint dm_body_length check (char_length(body) <= 4000)
);

-- The thread query: newest-first within one conversation.
create index direct_messages_thread_idx
  on public.direct_messages (conversation_id, created_at desc);

-- ------------------------------------------------------- RLS helpers
-- SECURITY DEFINER so a policy on conversation_participants can call this
-- without re-entering that table's own RLS and recursing into itself. The
-- lounge tables use the same pattern for the same reason.
create or replace function public.is_conversation_participant(p_conversation_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.conversation_participants
    where conversation_id = p_conversation_id and user_id = auth.uid()
  );
$$;

-- Keeps the inbox ordered without the client having to write it.
create or replace function public.bump_conversation()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  update public.conversations
  set last_message_at = new.created_at
  where id = new.conversation_id;
  return new;
end;
$$;

create trigger on_direct_message_sent
  after insert on public.direct_messages
  for each row execute function public.bump_conversation();

-- ------------------------------------------------- open or reuse a thread
/**
 * Returns the existing 1:1 conversation with `p_other`, or creates one.
 *
 * Without this, tapping "Message" twice makes two threads between the same two
 * people and the history splits. SECURITY DEFINER because the caller cannot see
 * a conversation they are not yet in, so they could not find the existing one
 * to reuse.
 */
create or replace function public.open_direct_conversation(p_other uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_me    uuid := auth.uid();
  v_id    uuid;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_other = v_me then
    raise exception 'cannot_message_yourself' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_other) then
    raise exception 'no_such_user' using errcode = 'P0002';
  end if;

  -- A conversation whose participant set is EXACTLY the two of us. The count
  -- check is what stops a group thread being reused as a 1:1.
  select c.id into v_id
  from public.conversations c
  join public.conversation_participants a on a.conversation_id = c.id and a.user_id = v_me
  join public.conversation_participants b on b.conversation_id = c.id and b.user_id = p_other
  where (select count(*) from public.conversation_participants p where p.conversation_id = c.id) = 2
  limit 1;

  if v_id is not null then
    return v_id;
  end if;

  insert into public.conversations default values returning id into v_id;
  insert into public.conversation_participants (conversation_id, user_id)
  values (v_id, v_me), (v_id, p_other);

  return v_id;
end;
$$;

/** Moves the read cursor. Used when a thread is opened or scrolled to bottom. */
create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_conversation_participant(p_conversation_id) then
    raise exception 'not_a_participant' using errcode = '42501';
  end if;

  update public.conversation_participants
  set last_read_at = now()
  where conversation_id = p_conversation_id and user_id = auth.uid();
end;
$$;

-- ---------------------------------------------------------------- policies
alter table public.attachments               enable row level security;
alter table public.conversations             enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.direct_messages           enable row level security;

-- Conversations are visible only to their participants.
create policy "participants read their conversations" on public.conversations
  for select to authenticated using (public.is_conversation_participant(id));

-- No INSERT policy: threads are created only by open_direct_conversation, which
-- is what guarantees a 1:1 pair can never end up with two of them.

create policy "participants see the roster" on public.conversation_participants
  for select to authenticated using (public.is_conversation_participant(conversation_id));
create policy "users move their own read cursor" on public.conversation_participants
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "users leave a conversation" on public.conversation_participants
  for delete to authenticated using (user_id = auth.uid());

create policy "participants read the thread" on public.direct_messages
  for select to authenticated using (public.is_conversation_participant(conversation_id));
create policy "participants send as themselves" on public.direct_messages
  for insert to authenticated
  with check (sender_id = auth.uid() and public.is_conversation_participant(conversation_id));
-- Only the soft-delete path; editing history is deliberately not offered.
create policy "senders delete their own message" on public.direct_messages
  for update to authenticated
  using (sender_id = auth.uid()) with check (sender_id = auth.uid());

-- An attachment is readable by anyone in a conversation it was sent to, which
-- is what lets the recipient render the photo they were sent.
create policy "owners and recipients read attachments" on public.attachments
  for select to authenticated using (
    owner_id = auth.uid()
    or exists (
      select 1 from public.direct_messages m
      where m.attachment_id = attachments.id
        and public.is_conversation_participant(m.conversation_id)
    )
  );
create policy "users upload their own attachments" on public.attachments
  for insert to authenticated with check (owner_id = auth.uid());
create policy "owners delete their attachments" on public.attachments
  for delete to authenticated using (owner_id = auth.uid());

-- Column privileges: a participant may move only their own read cursor, and a
-- sender may only soft-delete. RLS picks the row; these pick the column.
revoke update on public.conversation_participants from authenticated;
grant update (last_read_at) on public.conversation_participants to authenticated;
revoke update on public.direct_messages from authenticated;
grant update (deleted_at) on public.direct_messages to authenticated;

-- ---------------------------------------------------------------- realtime
-- The inbox and every open thread update live.
alter publication supabase_realtime add table public.direct_messages;
alter publication supabase_realtime add table public.conversations;

-- direct_messages is filtered by conversation_id, which is not its primary key,
-- so a DELETE would otherwise carry only `id` and never match the filter. The
-- queue hit exactly this.
alter table public.direct_messages replica identity full;

-- ---------------------------------------------------------------- storage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'dm-media', 'dm-media', false, 26214400,  -- 25 MB
  array['image/jpeg','image/png','image/webp','image/gif',
        'video/mp4','video/quicktime',
        'audio/mpeg','audio/mp4','audio/aac','audio/ogg','audio/webm',
        'application/pdf']
)
on conflict (id) do nothing;

-- Objects are namespaced by uploader: `dm-media/<user-id>/<file>`. The owner
-- writes their own folder; readers are admitted by the attachment policy above,
-- so a file is reachable exactly when the message carrying it is.
create policy "users write their own dm media" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'dm-media' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "participants read dm media" on storage.objects
  for select to authenticated using (
    bucket_id = 'dm-media'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1
        from public.attachments a
        join public.direct_messages m on m.attachment_id = a.id
        where a.storage_path = storage.objects.name
          and public.is_conversation_participant(m.conversation_id)
      )
    )
  );

create policy "users delete their own dm media" on storage.objects
  for delete to authenticated
  using (bucket_id = 'dm-media' and (storage.foldername(name))[1] = auth.uid()::text);
