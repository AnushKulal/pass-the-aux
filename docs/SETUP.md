# Setting up Aux from zero

This guide assumes you have **nothing** set up: no Supabase project, no Spotify app, no Google Cloud
project. It is written for **Windows**, and every command is meant to be pasted into **PowerShell**
from the repository root.

You will need, before you start:

- **Node.js 20 or newer** — `node --version`
- **Git**
- A **GitHub or email account** to sign into Supabase with
- A **Spotify account** (free is fine to *create* the app; Premium is needed to actually test the
  Spotify playback path)
- A **Google account** for the YouTube API key and Google sign-in

You do *not* need Docker for this guide. Docker Desktop is only required if you want to run Supabase
locally (`npx supabase start`), which we are deliberately not doing — we push straight to a hosted
project.

Total time: about 40 minutes, most of it waiting on dashboards.

> **A note on PowerShell.** `&&` does not work in Windows PowerShell 5.1. Run the commands one line
> at a time, exactly as written.

---

## Step 0 — Install the project

```powershell
git clone <your-fork-url> aux
cd aux
npm install
```

`npm install` takes a few minutes. **Do not run `npx expo install` or add packages** — every
dependency this project needs is already pinned in `package.json`, and Expo SDK 57 is fussy about
version drift.

---

## Step 1 — Create the Supabase project and wire up `.env`

### 1a. Create the project

1. Go to <https://supabase.com/dashboard> and sign in.
2. Click **New project**.
3. Fill in:
   - **Name** — `aux`
   - **Database password** — click *Generate a password* and **save it in your password manager
     right now**. You cannot see it again, and you will want it in step 2.
   - **Region** — pick the one physically closest to you. This matters more than usual for Aux:
     every clock sample is a round trip to this database, and a shorter round trip is a more precise
     clock offset.
   - **Plan** — Free.
4. Click **Create new project** and wait ~2 minutes while it provisions.

### 1b. Copy the URL and anon key

1. In the left sidebar, click the **gear icon (Project Settings)**.
2. Go to **API Keys** (on some dashboard versions this is **API**).
3. You want two values:

| Dashboard label | Looks like | Goes into |
| --- | --- | --- |
| **Project URL** | `https://abcdefghijklm.supabase.co` | `EXPO_PUBLIC_SUPABASE_URL` |
| **anon / public** key | a very long `eyJhbGci...` string | `EXPO_PUBLIC_SUPABASE_ANON_KEY` |

The middle chunk of the URL (`abcdefghijklm`) is your **project ref**. Write it down — steps 2 and 3
need it.

> **Do not copy the `service_role` key into `.env`.** It bypasses every Row Level Security policy in
> the database. It belongs only in Edge Function secrets, where Supabase injects it for you
> automatically. Anything prefixed `EXPO_PUBLIC_` is compiled into the app bundle and is readable by
> anyone who installs it.

### 1c. Create `.env`

In the repository root:

```powershell
copy .env.example .env
notepad .env
```

If `.env.example` does not exist yet, just create the file directly:

```powershell
notepad .env
```

Paste this in and fill in your two values:

```ini
# Supabase — from Project Settings > API Keys
EXPO_PUBLIC_SUPABASE_URL=https://abcdefghijklm.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Spotify — the *public* client id only. Filled in during step 4.
# The client SECRET never appears in this file; it lives in Edge Function secrets.
EXPO_PUBLIC_SPOTIFY_CLIENT_ID=
```

Save and close.

Three things to know about `.env` in Expo:

- Only variables prefixed **`EXPO_PUBLIC_`** are visible to app code. A variable without that prefix
  is silently `undefined` at runtime.
- The values are **inlined at bundle time**, not read at startup. If you change `.env`, you must
  restart Metro with a cleared cache: `npx expo start -c`.
- `.env` is gitignored. Never commit it.

`src/lib/supabase.ts` throws on startup if either Supabase variable is missing, so a typo here fails
loudly and immediately rather than mysteriously later.

---

## Step 2 — Run the migrations

The schema lives in three ordered files in `supabase/migrations/`:

| File | What it creates |
| --- | --- |
| `20260821000100_init_core.sql` | `profiles`, `lounges`, `lounge_members`, the signup trigger, the RLS helper functions |
| `20260821000200_music_and_rooms.sql` | `tracks`, `track_links`, `rooms`, `room_participants`, `queue_items` |
| `20260821000300_chat_tokens_rpc.sql` | `messages`, `reactions`, `provider_tokens`, `sync_metrics`, all the playback RPCs, and the Realtime publication |

**Order matters.** File 2 references types and functions from file 1; file 3 references both.

Pick either route below. The CLI route is better if you will be changing the schema; the SQL editor
route is faster if you just want it running.

### Route A — the CLI (recommended)

```powershell
npx supabase login
```

This opens a browser to authorize the CLI. Then link the local repo to your hosted project:

```powershell
npx supabase link --project-ref abcdefghijklm
```

It will prompt for the **database password** you saved in step 1a. Then push:

```powershell
npx supabase db push
```

You should see all three migrations listed and applied. Verify:

```powershell
npx supabase migration list
```

Every migration should show a timestamp in both the *Local* and *Remote* columns.

### Route B — the SQL editor (no CLI, no login)

1. In the Supabase dashboard, open **SQL Editor** in the left sidebar.
2. Click **New query**.
3. Open `supabase/migrations/20260821000100_init_core.sql` in your editor, select all, copy, paste
   into the SQL editor, and click **Run**.
4. Repeat for `20260821000200_music_and_rooms.sql`.
5. Repeat for `20260821000300_chat_tokens_rpc.sql`.

Run them **one file at a time and in order**, waiting for each to report success. If you paste all
three at once and one fails mid-way, you get a half-applied schema that is annoying to unpick.

### Verify either route worked

In the SQL editor, run:

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
order by table_name;
```

You should get exactly eleven tables: `lounge_members`, `lounges`, `messages`, `profiles`,
`provider_tokens`, `queue_items`, `reactions`, `room_participants`, `rooms`, `sync_metrics`,
`tracks`, `track_links`.

And confirm the clock RPC — the single most important function in the app — answers:

```sql
select public.server_time_ms();
```

It should return a 13-digit epoch-milliseconds number.

Finally, confirm Realtime is publishing. Under **Database > Publications > supabase_realtime**, the
tables `rooms`, `room_participants`, `queue_items` and `messages` should be enabled. The migration
does this, but it is worth eyeballing, because if `rooms` is not published, playback changes never
reach anyone and the app looks broken in a very confusing way.

---

## Step 3 — Deploy the Edge Functions and set their secrets

Aux uses four Edge Functions. They exist for one reason: **OAuth tokens must never touch a client.**
The `provider_tokens` table has RLS enabled and *zero policies*, which means no app-side request can
read it at all. Only these functions, running with the service role, can.

| Function | What it does | Secrets it needs |
| --- | --- | --- |
| `spotify-auth` | Exchanges the PKCE authorization code for tokens, refreshes them when they expire, and writes them to `provider_tokens`. Also records `spotify_linked` and `is_premium` on the profile. | `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` |
| `spotify-api` | The only thing that talks to the Spotify Web API on a user's behalf: search, and the `/me/player/*` playback commands. Loads the caller's token server-side, refreshes it if stale. | `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` |
| `search-tracks` | Searches Spotify or YouTube for the track picker. Uses the caller's own Spotify token so every result is one they can actually play, and answers from YouTube when they have no Spotify link. | `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `YOUTUBE_API_KEY` |
| `resolve-track` | Given a track from one provider, finds the matching recording on the other and writes `tracks` + `track_links`. This is what makes a mixed-provider Session possible. | `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `YOUTUBE_API_KEY` |

### 3a. Set the secrets

Do this **before** deploying, so the first invocation already has them. From the repository root
(you must have run `npx supabase link` in step 2 — Route B users need to do that now):

```powershell
npx supabase secrets set SPOTIFY_CLIENT_ID=your_client_id_here
npx supabase secrets set SPOTIFY_CLIENT_SECRET=your_client_secret_here
npx supabase secrets set YOUTUBE_API_KEY=your_youtube_key_here
```

You will get these three values in steps 4 and 5. If you are working front-to-back, **do step 4 and
step 5 first, then come back here.**

Or set them all in one go from a file:

```powershell
npx supabase secrets set --env-file .\supabase\.env.functions
```

If you use that form, make sure `supabase/.env.functions` is gitignored. It contains a real secret.

Check what is set:

```powershell
npx supabase secrets list
```

Secrets are shown by name with a hash, never in plaintext. You cannot read a secret back out — if
you lose one, rotate it at the source.

> `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected into every Edge
> Function automatically. Do not set them yourself.

### 3b. Deploy

```powershell
npx supabase functions deploy spotify-auth
npx supabase functions deploy spotify-api
npx supabase functions deploy search-tracks
npx supabase functions deploy resolve-track
```

Or all at once:

```powershell
npx supabase functions deploy
```

Confirm in the dashboard under **Edge Functions** that all four show as deployed, and tail the logs
of one while you test:

```powershell
npx supabase functions logs spotify-api
```

---

## Step 4 — Create the Spotify app

1. Go to <https://developer.spotify.com/dashboard> and log in with your Spotify account.
2. Accept the Developer Terms if prompted.
3. Click **Create app**.
4. Fill in:
   - **App name** — `Aux` (or `Aux Dev`)
   - **App description** — anything, e.g. "Social listening app"
   - **Redirect URIs** — this is the part people get wrong. Add **both** of these, one at a time,
     clicking **Add** after each:

     ```
     aux://spotify-callback
     http://localhost:8081/spotify-callback
     ```

     - `aux://spotify-callback` is the **native** callback. `aux` is the app scheme declared in
       `app.json`, which is why the URI looks like that and why it must not be changed casually.
     - `http://localhost:8081/spotify-callback` is the **web** callback. `8081` is Metro's default
       port. If Metro ever starts on a different port, this URI will not match and web linking will
       fail.

     Spotify matches redirect URIs **exactly** — character for character, including the scheme and
     any trailing slash. `http://localhost:8081/spotify-callback/` (with a trailing slash) is a
     *different* URI and will be rejected.
   - **Which API/SDKs are you planning to use?** — tick **Web API**.
5. Click **Save**.

### 4a. Copy the credentials

On the app page, click **Settings**.

- **Client ID** — copy it into **two** places:
  - `EXPO_PUBLIC_SPOTIFY_CLIENT_ID` in your `.env` (the app needs it to start the PKCE flow)
  - the `SPOTIFY_CLIENT_ID` Edge Function secret in step 3a
- **Client secret** — click **View client secret**. This goes **only** into the
  `SPOTIFY_CLIENT_SECRET` Edge Function secret. It must never appear in `.env`, in app code, or in
  a commit.

### 4b. Whitelist your test users

This is the constraint that surprises everyone.

Your app is in **Development Mode**. In that mode, **only explicitly whitelisted Spotify accounts can
authorize it — at most 25 of them.**

1. On the app page, go to **User Management**.
2. For each tester, enter their **full name** and the **email address on their Spotify account** —
   not any email, the one their Spotify account uses.
3. Click **Add user**.

Add yourself first. If you skip this, your own login will fail with a generic-looking error.

Two consequences worth internalizing:

- A user who is not whitelisted **cannot link Spotify at all.** Aux does not treat this as an error —
  it routes them to the YouTube adapter and they keep listening.
- A whitelisted user on a **free** Spotify account can link and can see their library, but every
  playback command returns `403`. Playback control is Premium-only. They also fall back to YouTube.

Getting out of Development Mode requires a quota extension request to Spotify, which needs a real
user base and a business justification. For development and for a demo, 25 whitelisted Premium users
is the ceiling. Plan your demo around it.

---

## Step 5 — Get a YouTube Data API v3 key

1. Go to <https://console.cloud.google.com/> and sign in.
2. Click the project dropdown at the top, then **New Project**. Name it `aux` and click **Create**.
   Wait for it to switch to the new project — check the dropdown actually says `aux` before
   continuing, or you will enable the API on the wrong project.
3. In the search bar, type **YouTube Data API v3**, open it, and click **Enable**.
4. Go to **APIs & Services > Credentials**.
5. Click **Create credentials > API key**. The key appears immediately. Copy it.
6. Click **Edit API key** and restrict it — an unrestricted key that leaks gets abused:
   - **API restrictions** → *Restrict key* → tick only **YouTube Data API v3**.
   - **Application restrictions** → leave as *None*. The key is used from an Edge Function, whose
     outbound IP is not stable, so an IP restriction will break it.
7. Put the key into the `YOUTUBE_API_KEY` Edge Function secret (step 3a). It does **not** go in
   `.env` — the key is only ever used server-side.

### About the quota

The YouTube Data API gives you **10,000 quota units per day**, resetting at midnight Pacific Time.
It is not a request count — different calls cost different amounts:

| Call | Cost | Used for |
| --- | --- | --- |
| `search.list` | **100 units** | Finding the YouTube video for a Spotify track |
| `videos.list` | 1 unit | Reading the exact duration and embeddability of a candidate |

So a cold resolution — one search plus one details fetch — costs about **101 units**, which means
roughly **95–99 brand-new tracks per day**.

That sounds tight and mostly is not, because the result is written to `track_links` and cached
forever. Playing an already-resolved track costs **zero** quota. The budget is spent on *new* songs,
not on plays. A single lounge that has been running for a week is almost entirely cache hits.

You can watch usage under **APIs & Services > YouTube Data API v3 > Quotas**. When you exceed it, the
API returns `403 quotaExceeded` and resolution fails until the reset — the app surfaces this as a
"couldn't find this track" state rather than a crash.

---

## Step 6 — Enable Google sign-in

Aux signs users in with Google. Supabase brokers it, so you need a Google OAuth client whose
redirect points at Supabase, not at your app.

### 6a. Get the Supabase callback URL

1. Supabase dashboard → **Authentication > Sign In / Providers**.
2. Find **Google** and expand it.
3. Copy the **Callback URL (for OAuth)** shown there. It looks like:

   ```
   https://abcdefghijklm.supabase.co/auth/v1/callback
   ```

   Leave this tab open.

### 6b. Create the Google OAuth client

Back in Google Cloud Console, in the **same `aux` project** from step 5:

1. Go to **APIs & Services > OAuth consent screen**.
   - **User Type**: *External*. Click **Create**.
   - **App name**: `Aux`. **User support email**: your email. **Developer contact**: your email.
   - **Save and continue** through Scopes (add none) and Test users.
   - Under **Test users**, click **Add users** and add every Google account you will sign in with.
     While the consent screen is unpublished, only these accounts can sign in — the same shape of
     restriction as Spotify's Development Mode.
2. Go to **Credentials > Create credentials > OAuth client ID**.
   - **Application type**: **Web application**. (Yes, *Web* — even for the mobile app. The OAuth
     exchange happens on Supabase's servers, not on the device.)
   - **Name**: `Aux Supabase`
   - Under **Authorized redirect URIs**, click **Add URI** and paste the Supabase callback URL from
     6a *exactly*.
   - Click **Create**.
3. Copy the **Client ID** and **Client secret** from the dialog.

### 6c. Turn it on in Supabase

1. Back in the Supabase **Google** provider panel, toggle **Enable Sign in with Google** on.
2. Paste the **Client ID** into *Client IDs* and the **Client secret** into *Client Secret*.
3. Click **Save**.

### 6d. Register the app's own redirect URLs

Supabase will refuse to redirect back to a URL it does not know.

1. Go to **Authentication > URL Configuration**.
2. Set **Site URL** to `http://localhost:8081`.
3. Under **Redirect URLs**, add both:

   ```
   aux://**
   http://localhost:8081/**
   ```

The `**` wildcard covers every route in the app, which saves you re-editing this every time a new
screen needs to be an OAuth destination.

When Google auth succeeds, the `on_auth_user_created` trigger from migration 1 fires and creates a
`profiles` row automatically, with a username slugged from the email address. You do not need to
create profiles yourself.

---

## Step 7 — Run it

```powershell
npx expo start
```

Metro starts and prints a QR code plus a menu of single-key shortcuts.

### On a phone

The scheme-based Spotify callback (`aux://spotify-callback`) only resolves in a build that owns the
`aux` scheme — which **Expo Go does not**. Expo Go registers `exp://`.

- **Everything except Spotify linking** works in Expo Go: install it from the App Store or Play
  Store, make sure the phone is on the **same Wi-Fi** as your PC, and scan the QR code from the
  terminal (Camera app on iOS, the Expo Go app's scanner on Android).
- **To test Spotify linking on a device** you need a development build:

  ```powershell
  npx expo run:android
  ```

  (Requires Android Studio and a JDK. The build takes a while the first time.)

If the QR code connects but never loads, your PC and phone are probably on different networks, or
Windows Firewall is blocking Metro. Fall back to a tunnel:

```powershell
npx expo start --tunnel
```

### On Android (emulator or USB device)

```powershell
npx expo start --android
```

For an emulator, start it from Android Studio's **Device Manager** first. For a physical device,
enable **Developer options > USB debugging** and confirm `adb devices` lists it.

### On web

```powershell
npx expo start --web
```

This opens `http://localhost:8081`. Web is the fastest loop for building UI, and it is the target
that the `http://localhost:8081/spotify-callback` redirect URI exists for. Note that
`react-native-youtube-iframe` behaves differently on web (it renders a real iframe rather than a
WebView), so always sanity-check playback on a device before believing it works.

### First run checklist

1. Sign in with Google. You should land in the app and, in the Supabase dashboard under **Table
   Editor > profiles**, see exactly one row with your username.
2. Create a lounge. Check **lounges** has a row and **lounge_members** has you as `owner` — that is
   the `on_lounge_created` trigger doing its job.
3. Start a Session and queue a track. Watch the **rooms** row: `started_at_ms` should be a 13-digit
   number and `is_playing` should be `true`.
4. Open the app in a second browser tab, join the same Session, and confirm it lands mid-song at the
   right position. That is the whole product working.

---

## Troubleshooting

Errors you will actually hit on a first setup, and what they mean.

| Symptom | Cause | Fix |
| --- | --- | --- |
| App crashes instantly: `Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY` | `.env` missing, misnamed (`.env.txt` — Notepad does this), or Metro started before you saved it | Confirm the file is exactly `.env` at the repo root, then restart with `npx expo start -c` |
| You edited `.env` but nothing changed | Env values are inlined at bundle time, not read at runtime | `npx expo start -c` — a plain restart is not enough |
| `relation "public.profiles" does not exist` | Migrations never ran, or ran against a different project | Re-run step 2 and verify with the `information_schema` query |
| Migration 2 fails on `type "public.music_provider" does not exist` | Files run out of order | Run the three migration files strictly in filename order |
| `npx supabase db push` → `Cannot find project ref` | Repo is not linked | `npx supabase link --project-ref <ref>` |
| `npx supabase link` → wrong-password loop | You are typing the dashboard login password, not the **database** password from step 1a | Reset it under **Project Settings > Database > Database password** |
| Any `supabase` CLI command complains about Docker | Local-stack commands (`supabase start`, `supabase db reset`) need Docker Desktop | Use `db push` against the linked hosted project instead — this guide never needs Docker |
| `new row violates row-level security policy` on insert | You are inserting as a user the policy does not allow — usually `user_id` / `owner_id` is not `auth.uid()` | Every insert policy requires the row's owner column to equal the caller. Check you are signed in. |
| `permission denied for table ...` / SQLSTATE `42501` on select | RLS is doing its job: you are not a member of that lounge | Join the lounge (`join_lounge_by_code`) first |
| RPC fails with `not_on_aux` | Only the Session host can call `room_play` / `room_pause` / `room_resume` / `room_seek` / `room_advance` | Take over the Session, or call it as the host |
| RPC fails with `not_in_session` | `queue_append` requires you to be a member of the lounge that owns the room | Join first |
| `join_lounge_by_code` → `invalid_invite_code` | Codes are stored uppercase; the RPC uppercases and trims, so this really is a wrong code | Re-copy the 8-character code from the lounge |
| Playback changes never reach other clients | `rooms` not in the `supabase_realtime` publication, or the subscriber cannot `select` the row | Check **Database > Publications**; remember Realtime respects RLS, so a non-member gets silence, not an error |
| Realtime works, then silently dies after the phone is backgrounded | Token expired while iOS suspended the refresh timer | Already handled by the `AppState` listener in `src/lib/supabase.ts` — if you see it, that listener was removed |
| Spotify: `INVALID_CLIENT: Invalid redirect URI` | The URI the app sent does not byte-match a registered one | Re-check step 4 for trailing slashes, `http` vs `https`, and the port |
| Spotify login opens but returns to Expo Go and nothing happens | Expo Go owns `exp://`, not `aux://` | Use `npx expo run:android` (dev build) or test linking on web |
| Spotify: `User not registered in the Developer Dashboard` | Development Mode whitelist | Add that exact Spotify account email under **User Management** (step 4b) |
| Spotify playback returns `403 Player command failed: Premium required` | Free account | Expected. The user falls back to YouTube. |
| Spotify playback returns `404 NO_ACTIVE_DEVICE` | Spotify has no device to send audio to | Open the Spotify app on any device and play a second of anything, then retry |
| Spotify calls start failing after an hour | Access token expired | The `spotify-api` function refreshes it. If it does not, check `SPOTIFY_CLIENT_SECRET` is set — refresh needs the secret. |
| Edge Function returns `500` immediately | A secret is missing, so the function throws on startup | `npx supabase secrets list`, then `npx supabase functions logs <name>` |
| YouTube: `403 quotaExceeded` | You spent 10,000 units; a search costs 100 | Wait for the midnight-Pacific reset, or use a second Cloud project's key |
| YouTube: `403 accessNotConfigured` | YouTube Data API v3 not enabled on the project the key belongs to | Enable it (step 5.3) — check you are in the right Cloud project |
| YouTube player shows "Video unavailable" / error `101` or `150` | The uploader disabled embedding, or it is region-locked | Nothing to fix client-side; the resolver should score that candidate out and pick another |
| Google sign-in: `redirect_uri_mismatch` | Google's authorized redirect URI is not the Supabase callback | It must be `https://<ref>.supabase.co/auth/v1/callback`, not your app URL |
| Google sign-in succeeds but the app never comes back | App redirect URL not allow-listed in Supabase | Add `aux://**` and `http://localhost:8081/**` under **Authentication > URL Configuration** |
| Google: `Access blocked: Aux has not completed verification` | Consent screen unpublished and the account is not a test user | Add the account under **OAuth consent screen > Test users** |
| Metro: `Unable to resolve "@/lib/theme"` | Stale Metro cache after a `tsconfig.json` path change | `npx expo start -c` |
| `Port 8081 is running another process` | A previous Metro is still alive | Accept the offered alternate port — but then the Spotify **web** redirect URI no longer matches, so prefer killing the old process: `npx kill-port 8081` |
| Everyone is a second or two out of sync, consistently | The clock offset was measured on a bad network sample, or `server_time_ms` is unreachable so the offset defaulted to `0` | Run `select public.server_time_ms();` in the SQL editor to confirm the RPC exists; `syncClock()` re-samples on foreground and reconnect |
| A single listener drifts while others are fine | That listener is mid-ad on YouTube | Expected. Sync resumes when the ad ends and the controller hard-seeks them back. |

---

## What to read next

[`docs/ARCHITECTURE.md`](ARCHITECTURE.md) — how the sync engine, the adapter seam, the track matcher
and the RLS model actually work.
