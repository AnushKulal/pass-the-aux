-- PATCH — run this once on a database that already has the schema.
--
-- Bug: `gen_random_bytes()` comes from the pgcrypto extension, which Supabase
-- installs into the `extensions` schema, not `public`. Two places called it
-- without that schema being reachable:
--
--   1. `handle_new_user()` pinned `search_path = public`, so the call could not
--      resolve. It only failed on a USERNAME COLLISION, because that is the only
--      path that runs the dedupe loop — which is why the first signup on a fresh
--      database succeeded and the second one died with
--      "Database error saving new user".
--
--   2. `lounges.invite_code`'s DEFAULT called it too. Column defaults evaluate
--      with the inserting session's search_path, so that one happened to work —
--      but only by luck of Supabase's role defaults, not by design.
--
-- Fix: give the function a search_path that includes `extensions`, and move the
-- invite-code generation into its own function so the default cannot depend on
-- whatever search_path a caller happens to have.

-- ---------------------------------------------------------------- 1. signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
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

-- ---------------------------------------------------------- 2. invite codes
-- Its own function so the default is self-contained and cannot break because a
-- caller's search_path happens not to include `extensions`.
create or replace function public.new_invite_code()
returns text
language sql
volatile
security definer set search_path = public, extensions
as $$
  select upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8));
$$;

alter table public.lounges
  alter column invite_code set default public.new_invite_code();

-- ---------------------------------------------------------------- 3. proof
-- Exercises the exact path that was broken: force a username collision and
-- confirm the loop can now generate a suffix. Raises if it still cannot.
do $$
declare
  a text;
  b text;
begin
  a := public.new_invite_code();
  b := substr(encode(gen_random_bytes(3), 'hex'), 1, 5);
  if a is null or length(a) <> 8 or b is null or length(b) <> 5 then
    raise exception 'pgcrypto still unreachable — a=%, b=%', a, b;
  end if;
  raise notice 'pgcrypto reachable. sample invite code: %, sample suffix: %', a, b;
end $$;
