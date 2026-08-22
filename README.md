# Aux

**Pass the aux.**

Aux is a Discord-style social music party app. You join a **Lounge**, see who is listening to what in
real time, and tap in to listen *together* — perfectly in sync, down to the fraction of a second.

It is not a streaming service. No audio ever passes through the backend. Every listener plays the
song on their own device, from their own account, and the server only ever says *"this track,
starting at this instant."* That single design decision is why Aux runs on free tiers and why a
Spotify Premium listener and a free YouTube listener can sit in the same Session and hear the same
chorus at the same moment.

---

## Features

**Lounges — the community layer**
- Public lounges you can discover, or private ones you join with an 8-character invite code
- `owner` / `mod` / `member` roles, enforced in the database, not in the app
- Lounge chat with emoji reactions

**Sessions — the live layer**
- Anyone in a lounge can start a Session. The host is *on aux*.
- A real-time presence roster: who is in, who is synced, who is drifting
- Server-authoritative playback — play / pause / seek / skip are database RPCs, not client messages
- A **shared queue** that anyone in the Session can add to. That is the whole point.
- Session chat, scoped to the Session, separate from the lounge

**Sync — the hard part**
- Sub-second alignment across devices, networks and providers
- NTP-style clock offset sampling, because device clocks are routinely seconds wrong
- A three-rung drift ladder: ignore, inaudibly nudge the playback rate, or hard-seek
- Late joiners land mid-song at the right second with no special-casing
- Drift telemetry written back to `sync_metrics`, so "it feels synced" is a measurement, not a vibe

**Playback — the provider layer**
- Spotify Premium listeners play through Spotify. Everyone else transparently falls back to YouTube.
- One source-agnostic track catalog with per-provider links, so both listeners are playing *the same
  song*, not two different uploads that happen to share a title
- A single `PlaybackAdapter` seam, so a third provider never touches sync code

---

## Stack

| Layer | Choice |
| --- | --- |
| App framework | Expo SDK 57, React Native 0.86.2, React 19.2.3 |
| Routing | `expo-router` 57 — file-based, from `src/app/` |
| Language | TypeScript 6, `strict`, no `any` |
| Backend | Supabase — Postgres, Row Level Security, Realtime, Edge Functions |
| Server state | `@tanstack/react-query` |
| Client state | `zustand` |
| Styling | `StyleSheet.create` + design tokens from `@/lib/theme`. No Tailwind, no NativeWind. |
| Animation | `react-native-reanimated` 4 (150–300ms, reduced-motion aware) |
| Icons | `lucide-react-native` only |
| Type | Righteous (display) + Poppins (body), via `@expo-google-fonts/*` |
| Images | `expo-image` with `cachePolicy="memory-disk"` |
| Spotify playback | Spotify Web API, driven through an Edge Function proxy |
| YouTube playback | `react-native-youtube-iframe` (`react-native-webview`) |
| Auth | Google OAuth via Supabase; Spotify linked separately with PKCE (`expo-auth-session`) |
| Secrets on device | `expo-secure-store` |

---

## Quick start

```powershell
# 1. Install dependencies (they are already pinned — never add to package.json casually)
npm install

# 2. Create your local env file and fill in the three values (see docs/SETUP.md)
copy .env.example .env

# 3. Link the Supabase project you created, then push the schema
npx supabase link --project-ref <your-project-ref>

# 4. Apply all three migrations
npx supabase db push

# 5. Run it
npx expo start
```

Then press `w` for web, `a` for Android, or scan the QR code with a development build on your phone.

**A full, zero-assumptions walkthrough — Supabase project, Edge Functions, Spotify app, YouTube API
key, Google OAuth — lives in [`docs/SETUP.md`](docs/SETUP.md).**
For how and why any of it works, read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Project layout

```
aux/
├─ src/
│  ├─ app/                      expo-router routes — the file tree IS the navigation
│  ├─ components/
│  │  ├─ ui/                    the shared kit: GlassCard, AuxButton, Avatar, Skeleton,
│  │  │                         LivePulse, EmptyState, TextField, Screen, ProgressBar, SheetTabs
│  │  ├─ feed/                  the "who is listening to what" lounge feed
│  │  └─ room/                  Session surfaces: now-playing, queue, roster, chat
│  ├─ lib/
│  │  ├─ theme.ts               Colors, Fonts, Space, Radius, Type, Duration, shadow()
│  │  ├─ supabase.ts            the typed client (+ AppState token-refresh handling)
│  │  ├─ clock.ts               server clock offset sampling — syncClock / serverNow
│  │  └─ database.types.ts      hand-authored mirror of the SQL schema
│  ├─ playback/
│  │  ├─ types.ts               PlaybackAdapter, PlayableRef, PlaybackError, Drift constants
│  │  ├─ sync-controller.ts     the sync engine — expectedPositionMs + the drift ladder
│  │  └─ adapters/              spotify + youtube implementations of PlaybackAdapter
│  └─ hooks/
├─ supabase/
│  ├─ migrations/               the whole schema, in three ordered files
│  └─ functions/                the three Edge Functions (see docs/SETUP.md step 3)
├─ docs/
│  ├─ SETUP.md
│  └─ ARCHITECTURE.md
└─ assets/
```

Imports always use the `@/` alias (`@/lib/theme`), never relative `../../` climbing.

---

## Known limits

These are real constraints, not TODOs we are pretending do not exist.

### Spotify apps sit in Development Mode

A newly created Spotify app is capped at **25 users, each one manually whitelisted by email in the
Spotify Developer Dashboard**. There is no self-serve way around this; lifting it requires a quota
extension request that Spotify only grants to apps with a real user base and a business case. Until
then, anyone whose email is not on that list cannot link Spotify at all.

On top of that, **Spotify playback control is Premium-only**. The `/me/player/*` endpoints return
`403` for free accounts. Even a whitelisted free user cannot be driven by the sync engine.

Aux handles both by falling back to YouTube transparently. A listener who cannot use Spotify is not
shown an error — they are routed to the YouTube adapter and keep listening. But it does mean the
"Spotify path" is, in practice, a path for a small whitelist of Premium subscribers.

### YouTube ads cannot be removed

YouTube playback runs inside YouTube's own IFrame player. Ads are served by that player, and there
is no API, parameter or configuration that suppresses them. Anything that did would violate the
YouTube Terms of Service.

What we can do is bias the resolver: it strongly prefers **"Artist - Topic"** channels — the
auto-generated, label-uploaded channels that carry the official audio. Those are usually clean, and
they are also the most likely to have a duration that actually matches the Spotify master. "Usually"
is the honest word. **Ad-free is only guaranteed on the Spotify path.**

An ad also breaks sync while it plays, because the player is not on the track. The controller sees
this as drift and hard-seeks the listener back into position when the ad ends — correct, but
audible.

### Not built yet

The following are later phases and do not exist in this codebase:

- **Voice / push-to-talk.** The `PlaybackAdapter` already carries a `canSetVolume` capability
  specifically so music can be ducked under a speaker later, but there is no voice transport.
- **Screen share.**
- **Co-watching** (synced video rather than synced audio).

The `speaking` prop on `Avatar` and the ducking hook are seams left open on purpose. They are not
wired to anything.

### Smaller things worth knowing

- **Dark theme only.** There is no light mode and no theme switch. This is a design decision, not an
  omission.
- **The host must stay.** A Session's timeline is owned by its host row. Host handoff when the host
  leaves is not implemented — the Session simply stops advancing.
- **The web build cannot use the `aux://` deep link.** Spotify linking on web goes through
  `http://localhost:8081/spotify-callback` instead, which is why both URIs must be registered.
- **YouTube Data API is capped at 10,000 quota units per day** and a search costs 100. That is
  ~100 cold track resolutions per day per key. Resolved tracks are cached in `track_links` forever,
  so the cost is per *new* track, not per play.

---

## License

See [`LICENSE`](LICENSE).
