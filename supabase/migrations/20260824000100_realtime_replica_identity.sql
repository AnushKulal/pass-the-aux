-- Aux — make filtered Realtime subscriptions actually deliver.
--
-- THE BUG THIS FIXES: every filtered `postgres_changes` subscription in the app
-- was silently receiving nothing. Not erroring — subscribing successfully and
-- then going quiet forever. That is the whole live layer:
--
--   src/features/rooms/use-room-sync.ts   rooms      filter id=eq.<room>
--   src/features/chat/queries.ts          messages   filter room_id / lounge_id
--   src/features/rooms/queries.ts         queue_items, room_participants
--
-- so playback sync, chat and the participant list all stopped propagating.
--
-- MEASURED, not guessed. On the same client, same row, same moment:
--   channel.on('postgres_changes', { table: 'rooms' })                  -> fires
--   channel.on('postgres_changes', { table: 'rooms', filter: 'id=…' })  -> silent
-- The only variable is the filter.
--
-- WHY: Postgres logical replication writes the OLD tuple for an UPDATE, and by
-- default that tuple contains only the replica identity — the primary key.
-- Realtime evaluates a subscription's filter against that old tuple, so with
-- default replica identity there is not enough of the row present for the filter
-- to match, and the change is dropped rather than delivered. `full` puts the
-- entire old row in the WAL, which is what the filter needs to see.
--
-- `queue_items` and `direct_messages` already had this, added for DELETE events
-- — the same underlying limitation, found from the other direction. The rest
-- were missed because an UPDATE looks like it should work: `rooms` is filtered
-- on its own primary key, which IS in the default replica identity, and it still
-- fails. That is the detail that makes this worth writing down.
--
-- COST: a wider WAL entry per update on these tables. On a project of this size
-- that is not measurable, and it is the price of the feature working at all.

alter table public.rooms replica identity full;
alter table public.room_participants replica identity full;
alter table public.messages replica identity full;
alter table public.conversations replica identity full;

-- Already full, restated so this migration is the single place to read the
-- realtime replica-identity story rather than three.
alter table public.queue_items replica identity full;
alter table public.direct_messages replica identity full;
