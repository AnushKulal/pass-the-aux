# aux — test plan

What to run, in what order, and what counts as a pass. Ordered so that a failure early
tells you not to bother with what follows.

**Before anything:** turn OFF email confirmation, or nothing that creates an account will work.
[Authentication → Sign In / Providers](https://supabase.com/dashboard/project/atdusjfidswqrkuefgvr/auth/providers)
→ Email → uncheck **Confirm email** → **Save**. The free tier allows only **2 auth emails per
hour**, so with confirmation on you get two signups and then an hour of silence.

---

## 0. Automated — run these first

Four scripts, no device needed. If any fails, fix it before touching the app.

```bash
node scripts/verify-backend.mjs
```
**Pass: 7/7.** Project reachable · schema applied · clock RPC · playback RPCs · RLS on ·
Spotify tokens unreachable · Edge Functions deployed. This is the fastest way to know the
backend is sane.

```bash
node scripts/e2e-backend.mjs
```
**Pass: 15/15.** Creates two real users and walks the whole flow — signup, profile trigger,
lounge creation, RLS denials, invite codes, sessions, queue, playback, realtime, chat. The
single most valuable test in the repo. Needs email confirmation off.

```bash
node scripts/measure-latency.mjs
```
**Pass: median under 100ms** from India on `ap-south-1`. Was ~412ms on Sydney; expect ~65ms now.
A regression here means the project moved or the network is degraded.

```bash
node scripts/check-sql.mjs supabase/migrations
```
**Pass: every migration parses.** Run before pushing any schema change — a typo costs a
20-second job instead of a half-applied schema.

Plus, on every change:

```bash
npx tsc --noEmit && npx eslint src
```
**Pass: both exit 0.**

---

## 1. Auth

| # | Test | Pass |
|---|---|---|
| 1.1 | Fresh install → Intro appears | one screen, not a carousel |
| 1.2 | "Get started" → Sign in | Intro never appears again |
| 1.3 | Sign up with a new email | lands in the app, no email needed |
| 1.4 | Claim a username | taken handles rejected live |
| 1.5 | Profile gate | cannot skip; SAVE disabled until photo + bio |
| 1.6 | Sign out, sign back in | goes straight to the Feed, no gate |
| 1.7 | Google sign-in | works, and bypasses email entirely |
| 1.8 | Kill the app mid-signup, reopen | recovers — no dead end |

**1.8 matters most.** A gate that traps someone is unrecoverable without reinstalling, and
this app has had that bug before.

---

## 2. Lounges

| # | Test | Pass |
|---|---|---|
| 2.1 | Create a public lounge | appears in Lounges and in Explore |
| 2.2 | Create a private one | appears for you, NOT in Explore |
| 2.3 | Copy the invite code, join from a second account | member count rises |
| 2.4 | Join a public lounge from Explore | one tap, no code |
| 2.5 | Wrong invite code | says so, does not hang |
| 2.6 | Lounge chat, two accounts | message appears on the other device without refreshing |

---

## 3. The Session — the core

| # | Test | Pass |
|---|---|---|
| 3.1 | Start a Session | you are on aux |
| 3.2 | Search a track | real results within ~2s |
| 3.3 | Queue it | appears for everyone in the Session |
| 3.4 | Play | audio starts |
| 3.5 | Second device joins mid-song | **lands at the right second, not at 0:00** |
| 3.6 | Pause on the host | everyone pauses |
| 3.7 | Skip | everyone advances to the same track |
| 3.8 | Seek | everyone follows |
| 3.9 | Track ends | auto-advances |
| 3.10 | Non-host tries transport | cannot; sees "Take the aux" |
| 3.11 | Take the aux | control transfers |
| 3.12 | Leave and rejoin | music stops on leave, resumes in sync on rejoin |

**3.5 is the demo.** If a late joiner lands mid-song at the right position, the sync engine
works. If it fails, nothing else in this section matters.

---

## 4. Sync accuracy — the number for your report

Two devices minimum, three is better (Android phone, second phone, laptop web).

1. Join the same Session on all devices
2. Play a track for 3 minutes
3. Read the drift readout on each device — it's on the Session screen
4. Record the value every 30s

| Metric | Target |
|---|---|
| p50 drift | **< 200ms** |
| p95 drift | **< 500ms** |
| Recovery after backgrounding 60s | **resyncs within 2s** |
| Recovery after 30s offline | **resyncs without a reload** |

Also test: force-background a phone for a minute, bring it back. Kill wifi for 30s, restore.
Both must self-heal — the app resyncs on foreground and on reconnect.

**This is the headline technical claim of the project.** Measure it properly and put the
numbers in the report.

---

## 5. Direct messages

| # | Test | Pass |
|---|---|---|
| 5.1 | Open a conversation from the Feed | thread opens |
| 5.2 | Send a message | appears immediately (optimistic) |
| 5.3 | Second account receives it | without refreshing |
| 5.4 | Unread badge | appears, and clears on read |
| 5.5 | Attachments | photo/file/voice say "not built yet" — **expected, not a bug** |

---

## 6. The Feed and presence

| # | Test | Pass |
|---|---|---|
| 6.1 | Second account plays in a Session | card appears in your Feed within ~10s |
| 6.2 | Progress bar | moves in real time |
| 6.3 | Join from a card | lands in their Session, in sync |
| 6.4 | They leave | card disappears within ~30s |
| 6.5 | Play in the **Spotify app** (not aux), Spotify linked | card appears within ~30s |
| 6.6 | Empty Feed | says what to do next and offers an action |

**6.5 is capped at 5 users** by Spotify's Development Mode, and the owner must hold Premium.

---

## 7. Updates

| # | Test | Pass |
|---|---|---|
| 7.1 | Publish an OTA, open the app | sheet rises from the bottom within ~4s |
| 7.2 | Notes | lists what changed, across every patch you skipped |
| 7.3 | "Not now" | dismisses, and Settings still offers it |
| 7.4 | Settings → Update now | applies |
| 7.5 | Settings → APK → Check | reports a build number |
| 7.6 | Offline | no error, no prompt |

---

## 8. Theme

Every screen, in both. Switch in Settings → Appearance.

| # | Test | Pass |
|---|---|---|
| 8.1 | Dark on every screen | no light flashes, no invisible text |
| 8.2 | Light on every screen | same |
| 8.3 | System | follows the OS |
| 8.4 | Switch while a Session plays | audio does not stop |

**Look specifically for invisible text.** Correct colour, correct size, and nothing on screen
is a real failure mode here — it has happened twice.

---

## 9. Security

| # | Test | Pass |
|---|---|---|
| 9.1 | Read a private lounge you are not in | 0 rows |
| 9.2 | Write to a lounge you are not in | rejected |
| 9.3 | Force yourself in as owner | rejected |
| 9.4 | Read `provider_tokens` | 0 rows, always |
| 9.5 | Write to `tracks` directly | rejected — catalog is server-owned |

`e2e-backend.mjs` covers all five. Run it rather than doing these by hand.

---

## 10. Accessibility

| # | Test | Pass |
|---|---|---|
| 10.1 | Every tappable ≥ 44px | nothing smaller without hitSlop |
| 10.2 | Screen reader on the Session | every control has a name |
| 10.3 | Reduce Motion on | no animation, nothing invisible |
| 10.4 | Text size at max | no clipped labels |

---

## 11. The real test

Three people, three phones, one Session, one hour. Nothing else finds what this finds:
someone's screen locking, a call interrupting, a phone dropping to 2G, two people taking the
aux at once.

Do this before the demo, not on the day.

---

## Known limitations — expected, not bugs

- **Attachments** in DMs are UI-only
- **Voice, deafen and per-person mute** are UI-only — no voice transport in this build
- **Screen share, movie night, game table** are placeholders
- **Spotify is capped at 5 users**, and the owner must hold Premium
- **Android 7–9** renders surfaces flat — the paired shadows need Android 9+, insets Android 10+
- **iOS** has no build pipeline
