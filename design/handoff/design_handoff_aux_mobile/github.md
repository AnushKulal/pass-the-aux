repo: AnushKulal/pass-the-aux
branch: main

## Last sync

date: 2026-08-22T10:19:19Z
handoff: design_handoff_aux_mobile/README.md

### Updated in this project
- New "Patchbay" direction for Aux — the product from `docs/DESIGN_BRIEF.md` Lane B, executed in this project's bound Modernist design system (black ground, red as the one reserved live colour, zero radius, Archivo throughout).
- Built `prototype.dc.html`: a deep interactive mobile prototype covering all twelve screens, with live playback position, live per-listener drift and a working shared queue.
- Sync made "loud and proud" per the brief's hardest problem — a ±400ms drift chart, a Sync Orbit view, and a diagnostics sheet reading the real thresholds from `src/playback/sync-controller.ts`.
- Added a social layer beyond the current repo scope: DM inbox and threads (attachments, voice notes, message search), voice/video calls, viewable member profiles, and a dark/light/system theme.
- Nothing was written back to the repository. The repo's own `design/` direction ("Signal Afterglow") was left untouched.

## Screen map

| Screen in prototype.dc.html | Built from |
| --- | --- |
| Sign in | `src/app/(auth)/sign-in.tsx`, `docs/DESIGN_BRIEF.md` §5.1 |
| Claim username | `src/app/(auth)/claim-username.tsx`, §5.2 |
| The Feed | `src/app/(tabs)/index.tsx`, §5.3 |
| Explore + join by code | `src/app/(tabs)/explore.tsx`, `supabase/migrations/*` (`join_lounge_by_code`) |
| Lounge rail / Lounges | `src/app/(tabs)/lounges.tsx`, `src/app/(tabs)/_layout.tsx` |
| You / Profile | `src/app/(tabs)/profile.tsx`, §5.6 |
| Lounge detail (Sessions / Chat / Members) | `src/app/lounge/[id].tsx`, `src/lib/database.types.ts` (`lounge_members.role`) |
| Create lounge + invite code | `src/app/lounge/create.tsx`, §5.8 |
| Session — Now playing | `src/app/room/[id].tsx`, `src/playback/store.ts`, §5.9 |
| Session — Sync Orbit + drift chart | `src/playback/sync-controller.ts`, `src/lib/clock.ts` |
| Queue / Add a track sheets | `queue_append` RPC, `src/features/tracks/`, §6 |
| Session chat | `messages.room_id`, `src/components/chat/` |
| Pass the aux | `rooms.host_id`, `is_room_host` RPC |
| Sync diagnostics | `sync_metrics` table, `Drift` thresholds in `src/playback/types.ts` |
| Create session | `src/app/room/create.tsx` |
| Connections | `src/app/settings/connections.tsx`, §5.11 |
| Not found | `src/app/+not-found.tsx`, §5.13 |
| Messages (DM inbox) | **new** — no repo equivalent yet |
| DM thread + attachments / voice notes / search | **new** — no repo equivalent yet |
| Voice + video call | **new** — no repo equivalent yet |
| Member profile (other users) | extends `profiles` table (`bio`, presence, `is_premium`) |
| Profile creation / edit | extends `src/app/(auth)/claim-username.tsx` |
| Settings (appearance, accounts, about) | extends `src/app/settings/connections.tsx` |

A full implementation spec for everything below lives in `design_handoff_aux_mobile/README.md` — tokens, per-screen layout, interactions, state, the sync ladder and the schema gaps.

The six rows marked **new** have no backing tables in `supabase/migrations/` yet — they need `conversations`, `direct_messages`, `attachments`, and a `profiles.bio` / presence column before they can be built.
