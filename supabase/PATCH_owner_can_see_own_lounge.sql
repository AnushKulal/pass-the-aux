-- PATCH 2 — owners must be able to see their own lounge.
--
-- Bug: creating a PRIVATE lounge from a client failed with 42501, but only when
-- the client asked for the row back (PostgREST's default `.select()` after an
-- insert). The row was created; the error came from RETURNING.
--
-- Why: the SELECT policy read `is_public or is_lounge_member(id)`. Membership is
-- added by an AFTER INSERT trigger, which has not fired when RETURNING evaluates
-- the row — so a brand-new private lounge is, for one instant, invisible to the
-- person who just created it. The old policy also meant an owner who left their
-- own lounge could no longer see it.
--
-- Ownership is the more fundamental claim than membership, so it belongs in the
-- policy directly rather than relying on the trigger having run.
drop policy if exists "public lounges or own lounges are readable" on public.lounges;

create policy "public lounges or own lounges are readable"
  on public.lounges for select to authenticated
  using (
    is_public
    or owner_id = auth.uid()
    or public.is_lounge_member(id)
  );
