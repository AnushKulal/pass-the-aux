# aux — UI Brief

**A design and wiring reference for generating the interface.**
Everything below describes one app: *aux*, a social music party app where you see what your people are listening to and drop in to listen together, in sync, to the same second.

Vocabulary used consistently throughout, and in the UI itself:

| Term | Meaning |
|---|---|
| **Lounge** | A community. Has members, a chat, and any number of live Sessions. |
| **Session** | A live listening room inside a Lounge. This is "the party". |
| **On aux** | Whoever currently controls playback. The DJ. |
| **The Feed** | Live presence — who is listening to what, right now. |

---

## 1. Design direction — "Patchbay"

The look is **studio hardware, not consumer streaming app**. Think a patchbay, a mixing desk, a rack unit: hard rules, right angles, dense type, one alarm-red accent used sparingly.

Six rules that define it. Breaking any one of them stops it looking like aux:

1. **`border-radius: 0` everywhere.** No rounded corners on anything — not cards, not buttons, not inputs, not avatars, not the artwork. The single exception is a fully circular element (`border-radius: 999px`) where roundness is the point, such as a live status dot.
2. **No shadows. No blur. No glassmorphism. No gradients.** Separation comes from **rules** (1px and 2px lines) and from flat surface steps. If two things need separating, draw a line.
3. **One typeface: Archivo.** Three weights only — 400, 600, 800. Nothing else.
4. **Red is reserved.** `#ec3013` means exactly one family of things: *live, playing, joinable, in sync, on aux, unread, your own message*. It is never decoration, never a generic "primary button" colour, never an ornament. If red appears, something is happening right now.
5. **No emoji as icons.** Line icons only (Lucide), 1.5–2px stroke.
6. **Numbers are tabular.** Anything that measures — timestamps, drift, queue counts, positions — uses tabular figures so columns do not shift as digits change.

Underlying everything is a **25px grid**, occasionally drawn as a faint background lattice at ~4.5% opacity.

---

## 2. Design tokens

### Colour — dark (the default; aux was designed for this)

```
bg           #0a0908     app background, near-black warm
bgRecessed   #0f0e0d     wells, insets, recessed panels
surface      #141312     cards, sheets, elevated blocks
surface2     #1c1a19     a step above surface
surface3     #211f1e     a step above that
avatar       #2d2b2b     avatar placeholder fill
artwork      #3a3736     album-art placeholder fill

ink          #f3f2f2     primary text
ink2         #9b9797     secondary text
ink3         #8a8686     tertiary text, kickers, metadata

live         #ec3013     THE ACCENT — live/playing/joinable/on aux
liveText     #ff563c     the accent as text (lifted for contrast)
onLive       #0a0908     text on top of an accent fill
danger       #f2657e     destructive, leave, mic muted

ruleSoft     rgba(243,242,242,.10)    faintest divider
rule         rgba(243,242,242,.16)    standard hairline
rule2        rgba(243,242,242,.24)    emphasised
rule3        rgba(243,242,242,.30)    strongest
track        rgba(243,242,242,.12)    progress-bar trough
grid         rgba(243,242,242,.045)   the 25px lattice
liveWash     rgba(236,48,19,.14)      accent at low opacity
liveMid      rgba(236,48,19,.28)      accent at mid opacity
scrim        rgba(10,9,8,.86)         behind modals
```

### Colour — light

```
bg  #f3f2f2   bgRecessed #eae9e9   surface #eae7e7   surface2 #e2dfdf   surface3 #d7d3d3
ink #201e1d   ink2 #444141   ink3 #605d5d
live #ae1800  liveText #ae1800  onLive #f3f2f2  danger #a4152c
rule rgba(32,30,29,.20)   rule2 rgba(32,30,29,.32)   rule3 rgba(32,30,29,.42)
scrim rgba(32,30,29,.55)
```

Light mode is a real, supported theme, not an afterthought. Both must be designed.

### Type — Archivo, three weights

| Role | Weight | Tracking | Used for |
|---|---|---|---|
| **display** | 800 | tight negative (−2% to −4.5%, tighter as size grows) | screen titles, track titles, the wordmark. Line height 1.06 |
| **heading** | 800 | open (+4.5%) | section titles, button labels. Line height 1.25 |
| **body** | 400 | normal | all prose. Line height 1.5 |
| **label** | 600 | wide (+12%), **UPPERCASE** | metadata, section kickers. Line height 1.35 |
| **readout** | 800 | tabular figures | every number that measures. Line height 1.2 |

Typical sizes: display 20–64, heading 11–14, body 13–16, label 10–11, readout 12–14.

### Spacing, rules, motion

```
Space     xs 4 · sm 8 · md 12 · lg 16 · xl 20 · xxl 24 · xxxl 32 · huge 44
Radius    0
Rule      hairline 1px · major 2px
Grid      25px
Touch     44px minimum, 8px minimum between adjacent targets

Motion    press 160ms · enter 280ms · sheet 300ms · scrim 200ms
Easing    cubic-bezier(.2,.8,.2,1)
Stagger   list entrances 55ms per row (feed), 50ms (messages)
```

**Navigation transitions:** everything **fades**. The only exception is a Session, which **rises from the bottom** — it is the one destination you drop *into* rather than move *across* to.

All motion must respect reduced-motion.

---

## 3. App shell

Every signed-in screen sits in this frame:

```
┌────┬────────────────────────────────────────┐
│    │  [ stale-version strip, when present ] │
│ 58 │                                        │
│ px │            SCREEN CONTENT              │
│    │                                        │
│rail│                                        │
│    ├────────────────────────────────────────┤
│    │  FEED  │  EXPLORE  │  YOU     54px     │
└────┴────────────────────────────────────────┘
```

**Left rail — 58px, full height.** Vertical strip of Lounge tiles. Each tile is a 2-letter monogram in a square, radius 0. The active Lounge carries a red left edge. Above the tiles: the aux logo (a neon aux-jack mark). Below: a Messages tile with an unread count, then a `+` tile to create a Lounge. A 1px rule separates the rail from the column.

**Bottom bar — 54px + safe area, inside the column only** (it starts where the rail ends; it does not run underneath it). Three cells: **FEED · EXPLORE · YOU**, separated by hairlines, labels in `label` style. The active cell shows a **22px × 2px red bar** beneath its label. Top border is 2px. No elevation, no shadow.

Note: Lounges deliberately have **no** tab cell — the rail is their home.

---

## 4. Screens

### 4.1 Intro
First launch only. Full-bleed. Oversized display wordmark, one line of positioning copy, a single primary action. Sets the tone: this is a piece of equipment, not a social network.

### 4.2 Sign in
Email + password, Google. Fields are **rectangular, 1px ruled, zero radius, no fill**, with an uppercase `label` above each. Errors appear inline beneath the field in `danger`. "Continue with Spotify" is deliberately **not** a sign-in method — Spotify is a *link*, made later, from Settings.

### 4.3 Claim username
One large input, live availability check. A taken handle shows immediately in `danger`; an available one shows a red tick. The handle is displayed at `display` size as you type.

### 4.4 Profile setup — the gate
Cannot be skipped. Two required items shown as a checklist:
- **A photo** — square tile, radius 0
- **A bio** — one short line

Optional: a **2–6 second looping video** that plays behind the photo on your profile. Plus a **"Show when I'm active"** toggle governing whether you appear in the Feed at all.
Primary action reads **SAVE PROFILE & ENTER AUX** and stays disabled until both required items are satisfied.

### 4.5 The Feed — the hook screen
The most important screen in the app. A vertical list of **now-playing cards**, one per person currently listening, entering with a 55ms stagger.

Each card, roughly 78px tall:

```
┌──────────────────────────────────────────────┐
│ ▉▉  anushkulalm            ● LIVE     [JOIN] │
│ ▉▉  Midnight City — M83                      │
│     ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬░░░░░░░░░░  1:44 / 4:03  │
└──────────────────────────────────────────────┘
```

- square album art, radius 0
- handle in `heading`, track in `display` (small), artist in `body`
- a **live dot** — the only circle in the design — pulsing slowly in red
- a **progress bar that actually moves**, ticking in real time
- a **JOIN** button in red, present only when that person is in a Session
- a small provider mark (Spotify / YouTube)

Empty state: not a shrug. A ruled panel explaining nobody is listening yet, with **FIND A LOUNGE** as the action.

### 4.6 Explore
Discover public Lounges. Ruled list rows: monogram tile, name, member count as a `readout`, a one-line description, and a **JOIN** action. Plus a **join-by-invite-code** field at the top.

### 4.7 Lounges
Your Lounges as a ruled list, each with member count and how many Sessions are live right now.

### 4.8 Lounge detail
Header: Lounge name at `display`, member count, invite code with a copy affordance.
Then three blocks:
- **LIVE SESSIONS** — cards with what is playing, who is on aux, participant count, and a **JOIN** action
- **MEMBERS** — avatar rows, owner/mod/member role as an uppercase label
- **CHAT** — the Lounge's chat

The primary action, **START A SESSION**, is a full-width red block.

### 4.9 Create Lounge
Name, description, icon, public/private. **Must keep the rail and bottom bar visible** — it is not a modal takeover.

### 4.10 The Session — the centrepiece
The screen the whole app exists for. Arrives by **rising from the bottom**.

```
┌──────────────────────────────────────────────┐
│  ← LOUNGE NAME                    ● 5 LIVE   │
├──────────────────────────────────────────────┤
│                                              │
│              [ ALBUM ART, square ]           │
│                                              │
├──────────────────────────────────────────────┤
│  Midnight City                               │
│  M83                                         │
│  ▬▬▬▬▬▬▬▬▬▬▬▬▬░░░░░░░░░  1:44 / 4:03        │
├──────────────────────────────────────────────┤
│  ON AUX  ▉ anushkulalm          [TAKE AUX]   │
├──────────────────────────────────────────────┤
│  ▉ ▉ ▉ ▉ ▉   participants, in-sync marked    │
├──────────────────────────────────────────────┤
│         QUEUE / 5    │    CHAT                │
└──────────────────────────────────────────────┘
```

- Only the person **on aux** sees transport controls. Everyone else sees **TAKE THE AUX**.
- Each participant avatar carries a **sync state**: in sync (red), catching up, or drifting.
- A bottom section **switches between QUEUE and CHAT** — two hard-ruled tabs, not a floating sheet.
- Queue rows: position `readout`, artwork, title/artist, who added it, and a remove affordance for the host.
- A **drift readout** (e.g. `−412ms`) in tabular figures — this is the app showing its working, and it belongs in the design.

### 4.11 Messages — inbox
Conversation rows: avatar, handle, last-message preview, timestamp, and an **unread count in red**. A **PEOPLE** section above for starting a new conversation.

### 4.12 Messages — thread
Message bubbles, radius 0.
- **Your messages: red fill, dark text, right-aligned.**
- Theirs: surface fill, ink text, left-aligned.
- Day separators are ruled lines with a centred `label`.
- Mentions render in the accent.
- A composer pinned at the bottom: 1px ruled input, an attach affordance, and a send button that turns red once there is something to send.
- Header shows presence — a live dot and last-seen.

Attachment sheet (photo, file, voice note, **share a track**) rises from the bottom. A shared track renders as a card with **ADD TO THE QUEUE**.

### 4.13 You (profile)
Large square avatar (the looping video plays here if set), handle at `display`, `@handle` beneath, provider badge, member-since. An **EDIT** action. Then ruled rows into Settings and Connections, then **YOUR LOUNGES**, then a **SIGN OUT** block outlined in `danger`.

### 4.14 Settings
Ruled sections, each opened by an uppercase `label` kicker:

- **SOFTWARE UPDATE** — which patch you are on, how many fixes are waiting, what they are, an **UPDATE NOW**, and an **APK** row that checks for and installs a new build
- **APPEARANCE** — a three-cell segmented control: DARK · LIGHT · SYSTEM, active cell filled red
- **MUSIC ACCOUNTS** — Spotify and YouTube rows with link state
- **VOICE & VIDEO**
- **ACCOUNT** — edit profile, about

Sections close with a 2px rule. Explanatory captions sit beneath in `ink3`.

### 4.15 Update sheet
Rises from the bottom edge. Kicker **UPDATE READY** in red, title at `display`, then **IN THIS PATCH** (or **IN THE LAST N PATCHES**) listing what changed — each line marked by an 8×2px rule, never a bullet glyph. Two actions split the footer: **NOT NOW** (ghost) and **UPDATE NOW** (red fill), with an **✕** in the corner.

---

## 5. Component inventory

| Component | Notes |
|---|---|
| `NowPlayingCard` | 78px, artwork + live dot + real-time progress + JOIN |
| `LoungeCard` | monogram tile, member count, join action |
| `LoungeRail` / `RailTile` | 58px vertical strip, active red edge |
| `PatchbayTabBar` | 3 cells, red active bar |
| `TrackRow` | queue and search results |
| `MessageBubble` | own = red fill, radius 0 |
| `ConversationRow` | preview + unread badge |
| `Composer` | ruled input + attach + send |
| `Sheet` | rises from bottom, hard top rule, no radius |
| `Toast` | ruled block, no radius |
| `Skeleton` | flat rectangles, no shimmer gradient |
| `Avatar` | **square**, radius 0 |
| `LiveDot` | the only circle in the app |
| `Segmented` | ruled cells, active filled red |
| `Row` | one settings/list row: leading, title, detail, trailing |
| `Kicker` / `Caption` | uppercase section label / explanatory text |
| `AccentChip` | small red action pill (still radius 0) |

**Every screen needs four states designed: loading (skeleton), empty, error, and populated.** Empty states must say what to do next and offer an action — never a bare shrug.

---

## 6. Feature status

### Working now
- Email/Google auth, username claim, profile gate
- Create/join Lounges, public browse, invite codes, roles
- Sessions with **server-authoritative sync** and drift correction
- Queue: add, reorder, remove, auto-advance
- Lounge chat, realtime
- **The Feed** — live presence with real-time progress
- **Direct messages** — inbox, threads, composer, mentions
- Track search and Spotify↔YouTube matching
- Light/dark/system theming
- Over-the-air updates + in-app APK updates

### Partly built
- **DM attachments** — photo, file, voice note and track-share UI exists; upload is not wired
- **Spotify presence** — polling works, but capped at **5 users** by Spotify policy (Feb 2026), and the "show when I'm active" toggle is not yet honoured

### Not built — design these anyway
- **Push-to-talk voice** — hold-to-talk, speaking rings on avatars, music ducking to ~25% while someone talks
- **Voice and video calls**
- **Screen share**
- **Movie mode** — co-watching, sync-only
- **Lobby games**
- **Friends** — requests, list, presence

---

## 7. The wiring, briefly

Frontend is **Expo / React Native** (iOS, Android, web from one codebase). Backend is **Supabase** — Postgres with row-level security, Realtime, Storage, and Edge Functions.

**No audio ever passes through the backend.** A Session row stores *what* track and *when it started*; every device computes where it should be and tells its own player to go there. That is what makes it free to run and what makes it scale.

```
Session row:  track_id · started_at_ms · paused_at_ms · is_playing
Each client:  expected = serverNow − started_at_ms
              drift    = expected − actual
              ≤40ms ignore · 40–220ms nudge rate ±2% · >220ms hard seek
```

Device clocks are not trusted: each client samples a server-time RPC five times and keeps the lowest round-trip.

Playback runs behind one interface, so a Spotify Premium listener and a YouTube listener sit in the same Session hearing the same song from different sources. Tracks are stored source-agnostically and linked to both providers.

Presence rides Supabase Realtime, broadcasting `{track, artist, artwork, position, isPlaying}`.

**What each screen reads:**

| Screen | Data |
|---|---|
| Feed | Realtime Presence across your Lounges |
| Explore | public Lounges |
| Lounge | members, live Sessions, chat |
| Session | the Session row + queue + participants + chat, all realtime |
| Messages | conversations, direct messages, realtime |
| You / Settings | your profile, link state, update state |

---

## 8. Prompt for Figma Make

> Design a mobile app called **aux** — a social music party app where you see what your friends are listening to and join them to listen together in perfect sync.
>
> **Visual direction: studio hardware, not a consumer streaming app.** Think a patchbay or mixing desk — hard rules, right angles, dense type, one alarm-red accent used sparingly.
>
> **Non-negotiable rules:**
> - `border-radius: 0` on everything — cards, buttons, inputs, avatars, artwork. The only circle is a live status dot.
> - No shadows, no blur, no glassmorphism, no gradients. Separation comes from 1px and 2px rules and flat surface steps.
> - One typeface: **Archivo**, weights 400 / 600 / 800 only.
> - Red `#ec3013` means *live, playing, joinable, in sync, unread* — never decoration.
> - Line icons only, no emoji. Numbers use tabular figures.
>
> **Dark palette:** bg `#0a0908`, surface `#141312`, text `#f3f2f2`, secondary `#9b9797`, tertiary `#8a8686`, accent `#ec3013`, rules `rgba(243,242,242,.16)`.
> **Light palette:** bg `#f3f2f2`, surface `#eae7e7`, text `#201e1d`, accent `#ae1800`.
>
> **Type:** display 800 with tight negative tracking for titles; heading 800 with open tracking for section titles and buttons; body 400 for prose; label 600 uppercase with wide tracking for metadata.
>
> **Layout:** a 58px vertical rail of square Lounge tiles down the left edge (active tile has a red left border), and a 54px bottom bar inside the remaining column with three cells — FEED · EXPLORE · YOU — the active one marked by a 22×2px red bar. 25px grid, 44px minimum touch targets.
>
> **Screens to design, in both dark and light:**
> 1. **The Feed** — vertical list of 78px now-playing cards: square album art, handle, track title, artist, a pulsing red live dot, a real-time progress bar, and a red JOIN button
> 2. **The Session** — large square album art, track title and artist, scrubber, an "ON AUX" row showing who is in control with a TAKE THE AUX action, participant avatars marked with sync state, and a bottom area that switches between QUEUE and CHAT
> 3. **Lounge detail** — live Sessions, member list, chat, and a full-width red START A SESSION block
> 4. **Explore** — public Lounges as ruled rows with member counts and JOIN actions
> 5. **Messages** — inbox with unread counts, and a thread where your own bubbles are red-filled and square
> 6. **Profile** — large square avatar, handle, your Lounges, sign out outlined in pink-red
> 7. **Settings** — ruled sections with uppercase kickers, and a three-cell DARK/LIGHT/SYSTEM segmented control
> 8. **Sign in and profile setup** — rectangular unfilled inputs with 1px rules and uppercase labels
>
> Design loading, empty, error and populated states for each. Empty states must say what to do next and offer an action.
