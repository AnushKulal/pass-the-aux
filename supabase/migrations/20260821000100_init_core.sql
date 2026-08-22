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
security definer set search_path = public
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

-- ---------------------------------------------------------------- lounges
create table public.lounges (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(name) between 2 and 50),
  slug         text unique not null,
  description  text not null default '',
  icon_url     text,
  owner_id     uuid not null references public.profiles(id) on delete cascade,
  is_public    boolean not null default true,
  invite_code  text unique not null default upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8)),
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
create policy "public lounges or own lounges are readable"
  on public.lounges for select to authenticated
  using (is_public or public.is_lounge_member(id));
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
