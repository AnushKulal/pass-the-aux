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
