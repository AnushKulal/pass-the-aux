# Aux — Design Brief

> **"Pass the aux."**
> A Discord-shaped community app built entirely around listening to music together.

This brief is written to be handed to a designer or a design tool with **no other context**. It
covers the whole application: what it is, who it is for, the design system that already exists, and
every screen that needs to exist.

There are two lanes. Pick one, or run both:

- **Lane A — Ship-ready.** Design against the system in [Lane A](#lane-a--the-system-that-already-exists).
  Anything produced drops straight into the codebase.
- **Lane B — Open redesign.** Ignore the current palette and type entirely, keep the product.
  See [Lane B](#lane-b--the-open-redesign).

Everything in [The screens](#the-screens) applies to both lanes — that section describes *what each
screen must do*, never how it must look.

---

## 1. The product

### What it is

Music is social, but streaming is solitary. Spotify shows you a friend's activity in a cramped
desktop sidebar and gives you no way to join them. Discord has the community and voice layer but no
real music layer. Aux is the middle.

You join a **Lounge** (a community). You see a live feed of who is listening to what, *right now*.
You tap one of those cards and you are in a **Session** — hearing the exact same track at the exact
same second, with a shared queue anyone can add to and chat running alongside.

### The vocabulary — use these words in the UI

| Term | Meaning |
|---|---|
| **Lounge** | A community. Has members, a chat, and any number of live Sessions. |
| **Session** | A live listening room inside a Lounge. This is "the party". |
| **On aux** | The person who currently controls playback. The DJ. |
| **The Feed** | The home screen — who in your Lounges is listening to what, live. |

Never say "room", "server", "channel", or "host" in UI copy. The words above are the product.

### Who it is for

Friend groups aged roughly 16–25 who already share music constantly — in group chats, in stories, by
handing someone a phone. People who say "wait, put that on again" and "who is this?". The app should
feel like being in a room with your friends at 1am, not like a productivity tool with a music
feature bolted on.

### The single hardest design problem

**Make "we are hearing the same thing at the same second" legible.**

Everything else is a normal social app. The magic — and the entire engineering effort behind Aux — is
synchronised playback. If a user cannot *feel* that they are in sync with four other people, the
product has failed no matter how good the rest looks.

Things that carry that feeling, and are worth designing hard:

- A progress bar that visibly moves in real time on other people's cards
- Participant avatars that show who is actually in sync versus buffering
- The moment of joining: a card on the Feed becoming the full Session screen
- Seeing someone else add a track to the queue while you are looking at it

### The emotional register

Late-night, warm, unhurried. This is a *chill party*, not a rave and not a dashboard. Avoid anything
that reads as corporate SaaS, and avoid anything that reads as a hyperactive gaming UI. The reference
point is a dim room with good speakers.

---

## 2. Platform and constraints

**Built with Expo / React Native.** One codebase renders iOS, Android, and web. Design for
**mobile-first at 375 × 812**, then check the web layout at 1280 wide.

| Constraint | Requirement |
|---|---|
| Primary canvas | 375 × 812 (iPhone) |
| Web behaviour | Content column caps at **720 px** and centres. Never stretch edge-to-edge. |
| Theme | Dark only. There is no light mode and none is planned. |
| Touch targets | Minimum **44 × 44 px**, with at least **8 px** between adjacent targets. |
| Body text | Minimum **16 px**. Nothing readable below 13 px. |
| Contrast | 4.5:1 minimum — and check it against the *frosted glass* surface, not the flat background. |
| Motion | 150–300 ms. Anything looping must be disable-able for reduced-motion users. |
| Icons | Line icons, 24 px grid (the build uses Lucide). **Never emoji as an icon.** |

Two platform realities that affect the design:

- **Not everyone can use Spotify.** Playback control is Premium-only, so many users play through
  YouTube instead. The UI must show which source a person is on without making the YouTube path feel
  like a downgrade or an error state.
- **Only the person "on aux" gets transport controls.** Everyone else sees a *"Request the aux"*
  affordance. Design both states — the passenger view is the more common one.

---

## 3. Lane A — the system that already exists

Use this lane if the designs should drop into the running app. These are the real tokens from
`src/lib/theme.ts`.

### Colour

| Token | Hex | Use |
|---|---|---|
| `bg` | `#0F0F23` | App background. Near-black indigo — OLED-friendly without being flat black. |
| `surface` | `#1E1B4B` | Cards, sheets, blocks. |
| `surfaceRaised` | `#2A2563` | Pressed states, nested cards. |
| `primary` | `#4338CA` | Brand indigo — headers, active nav, selection. |
| `accent` | `#22C55E` | **Live / Play / Join only.** See the rule below. |
| `text` | `#F8FAFC` | Primary text. |
| `muted` | `#A5B4FC` | Secondary text, timestamps, metadata. |
| `faint` | `#6B7280` | Placeholders and dividers **only** — fails contrast for readable copy. |
| `danger` | `#F43F5E` | Leave, destructive, mic-muted. |

**The accent rule, which matters more than any other:** `#22C55E` green means **live, playing, or
joinable**. Nothing else. Not a decorative icon tint, not a passive form selection, not a success
celebration. The Feed is scannable precisely because green means "there is something happening here
you can join right now" — every decorative use dilutes that signal until the screen stops working.

**Frosted glass** is the signature surface: ~15 px backdrop blur, 10–16% white fill, 1 px white
hairline at ~20%. Used on the tab bar, the now-playing mini bar, and bottom sheets.

### Type

- **Righteous** — display face. Wordmark, screen titles, track titles. Music-poster energy.
- **Poppins** — everything else. Weights 400 / 500 / 600 / 700.

| Role | Size / line-height | Face |
|---|---|---|
| Hero | 34 / 40 | Righteous |
| Title | 24 / 30 | Righteous |
| Heading | 18 / 26 | Poppins SemiBold |
| Body | 16 / 24 | Poppins Regular |
| Body strong | 16 / 24 | Poppins Medium |
| Label | 14 / 20 | Poppins Medium |
| Caption | 13 / 18 | Poppins Regular |

### Spacing and shape

Spacing is a 4 px scale: **4, 8, 12, 16, 24, 32, 48**.
Radii: **8** (small), **12** (medium), **18** (large), **26** (extra large), **999** (pill).

---

## 4. Lane B — the open redesign

Use this lane to explore a better-looking Aux. Ignore Lane A's palette, typefaces, spacing and
shapes entirely. Invent a visual world.

### What must survive any redesign

These are product requirements, not style preferences:

1. **Dark.** The app is used at night, socially, often in bed. A light UI is the wrong product.
2. **One reserved "live" colour.** Whatever the palette, exactly one colour must mean *live / playing
   / joinable* and appear nowhere else. This is load-bearing.
3. **Album art is the hero.** It is the only rich imagery the app has, it is user-supplied, and it is
   unpredictable — the design must survive any artwork, including ugly ones and very bright ones.
4. **Identity must be readable at avatar size.** The Feed is a list of people. Avatars carry state
   (live, speaking, in-sync) and must stay legible at ~40 px.
5. **The 44 px / 16 px / 4.5:1 floors** in the constraints table are non-negotiable.

### Where to take real risk

- **The Session screen.** It is the centrepiece and currently the most conventional part of the
  design. It is a music player *with other people in it* — that second half is barely expressed.
  What does a shared listening surface look like if it is not just a player with avatars stapled on?
- **Expressing sync itself.** Right now sync state is a dot and a word ("In sync"). It is the most
  technically impressive thing in the product and the least visually present.
- **The wordmark and empty states.** The app is called Aux and its tagline is "Pass the aux". There
  is an obvious visual world there — cables, jacks, splitters, the physical act of handing something
  over — that the current design does not touch at all.

### Deliverables for Lane B

A cover/direction artboard, then the four hero screens — **Sign in, the Feed, a Lounge, a Session** —
plus the token sheet (palette, type scale, spacing) so the direction can be extended to the rest.

---

## 5. The screens

Twelve screens exist. For each: its job, what it contains, and the states that must be designed.

> **Designers forget states.** Every list screen needs *loading*, *empty*, and *error*. Empty states
> in a social app are the first thing a new user sees — treat them as real screens, not placeholders.

### 5.1 Sign in

**Job:** get someone in, and make clear that Spotify is not required.

Wordmark and tagline. Segmented toggle between *Sign in* and *Create account*. Email and password
fields. "Continue with Google". Below the fold, a short honest note: Aux plays through YouTube by
default, so no Spotify account is needed; Premium users can link Spotify later from Settings.

- **States:** idle, field-level validation errors, submitting, auth failure.
- Password placeholder changes between modes ("Your password" / "At least 8 characters").

### 5.2 Claim username

**Job:** replace the auto-generated username with a real one.

3–20 characters, lowercase letters, numbers and underscores. Live availability check as they type.
Also sets display name and avatar. Shown once after signup, and reachable later from Profile.

- **States:** checking, available, taken, invalid characters.

### 5.3 The Feed *(home tab)*

**The most important screen in the app.** This is where the product explains itself.

A live list of everyone across all your Lounges who is listening right now. Each row:

- Avatar with a **live ring**
- Album art
- Track title, then "artist · lounge name"
- A thin progress bar **that advances in real time**
- A small glyph showing Spotify or YouTube
- A **Join** button when that person is in a Session

Above the list, a compact strip of Sessions you are already in, so you can get back in one tap.

- **States:** loading (skeleton rows), empty ("Nobody is listening yet — start a Session and someone
  will join"), error, pull-to-refresh.
- **Design note:** three cards ticking along simultaneously is the "oh, I get it" moment. Make the
  liveness unmistakable.

### 5.4 Explore *(tab)*

**Job:** find a community to join.

Search over public Lounges. A join-by-code field at the top. Lounges the user is already in show a
"Joined" badge.

- **States:** browsing, searching, no results, loading, invalid code.

### 5.5 Lounges *(tab)*

**Job:** your communities at a glance.

List of the user's Lounges. Each card: name, member count, and — when that Lounge has live Sessions —
a pulse and "N listening". Header actions for *Create* and *Join with code*.

- **States:** loading, empty ("No lounges yet — create one or join with a code").

### 5.6 Profile *(tab)*

Avatar, display name, @username, member-since. The Lounges they belong to. Spotify connection status
linking through to Connections. Sign out, styled as destructive, with a confirm.

### 5.7 Lounge detail

**Job:** the home of one community.

Header with the Lounge name and a share action that copies the invite code. Three areas:

- **Active Sessions** — cards to tap into, or "Start a Session" when there are none
- **Members** — avatar, display name, @username, role chip (owner / mod / member)
- **Chat** — lounge-wide conversation

An invite code the user cannot find is a dead community; make it easy to reach.

- **States:** loading, not-a-member ("join to view" — *not* an error), empty sessions, empty chat.

### 5.8 Create lounge

Name, description, public/private toggle. On success, show the invite code prominently with a copy
button — this is a moment worth designing, it is how the community actually starts.

### 5.9 The Session *(the centrepiece)*

**Job:** be the party.

Top to bottom:

- Back, Lounge name, participant count
- **Now playing** — large album art with an ambient glow sampled from the artwork, track title,
  artist, and a progress bar
- A **sync indicator** — in sync / adjusting / out of sync, with a resync action when it drifts
- **Transport controls** — play, pause, skip, scrubber. *Host only.* Everyone else gets
  "Request the aux"
- **Participant strip** — avatars with sync state
- A **bottom sheet** switching between **Queue** and **Chat**

- **States:** loading, playing, paused, buffering, out-of-sync, empty queue, track unplayable
  (YouTube embedding is disabled on some videos — offer to skip), you-are-host vs you-are-passenger.

### 5.10 Create session

Name the Session, pick which Lounge it belongs to, start it.

### 5.11 Connections *(settings)*

Link or unlink Spotify. Show three distinct states clearly: **not linked**, **linked (free)**,
**linked (Premium)**.

Critical copy note: *linked but free* is a **normal state, not an error**. Explain plainly that
Spotify only permits playback control on Premium and that Aux will use YouTube instead. Do not style
it with the danger colour.

Also a "Playback source" preference: *Auto* or *Always YouTube*.

### 5.12 Spotify callback

A brief interstitial after returning from Spotify auth. "Connecting Spotify…", then success or a
clear failure with a *Try again* action.

### 5.13 Not found

The 404. Small, but it is a chance for personality — a dead aux cable, a track that does not exist.

---

## 6. Component inventory

Existing components, all of which need design coverage.

**Foundation** — Button (primary / accent / ghost / danger, in three sizes, with loading and disabled
states), Text field, Avatar (with live and speaking rings), Glass card, Progress bar, Skeleton, Empty
state, Toast, Segmented tabs, Screen shell with header.

**Feature** — Now-playing card (the Feed row), Lounge card, Session card, Member row, Now playing
(large), Transport controls, Participant strip, Queue list, Add-track sheet, Chat list, Chat
composer, Message row, Join-code modal.

Three that deserve unusual attention, because they carry the product:

- **Now-playing card** — the Feed row. Dense: avatar, art, two lines of text, a live progress bar,
  a provider glyph, and a Join button, all inside ~72 px of height on a 375 px screen.
- **Participant strip** — must communicate *who is here* and *who is actually in sync* without
  becoming noisy.
- **Add-track sheet** — search, results, and a low-confidence case where the resolver could not
  confidently match a track across providers and needs the user to pick between three candidates.

---

## 7. What to deliver

For a full application design:

1. **Direction / cover** — the visual thesis in one artboard
2. **Token sheet** — palette with roles, type scale, spacing, radii, elevation
3. **Component sheet** — every component above, in every state
4. **All 12 screens** at 375 × 812
5. **State coverage** — loading, empty, and error for every screen that fetches anything
6. **Web layout** — the Feed and a Session at 1280 wide, showing the 720 px content column
7. **One motion note** — how joining a Session transitions from the Feed card

If scope must be cut, cut in this order: web layouts, then the secondary screens (5.4, 5.6, 5.8,
5.10, 5.12, 5.13). **Never cut the state coverage** — a design that only shows the happy path cannot
be built from.

---

## 8. Copy guidance

- Write from the user's side of the screen. Nobody has a "room record"; they have a Session.
- Active voice on every control. A button says what happens: *Join*, *Start a Session*, *Take the aux*.
- Errors say what went wrong and what to do next. No apologies, no vagueness.
- Be honest about limits. Where the product cannot do something — Spotify Premium, YouTube ads — say
  so plainly and move on. The app's tone is a friend telling you how it is, not a brand managing you.

---

*Product and engineering detail: [`ARCHITECTURE.md`](./ARCHITECTURE.md).
Running the app: [`SETUP.md`](./SETUP.md).*
