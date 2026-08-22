# Handoff: Aux — mobile app ("Patchbay" direction)

## Overview

Aux is a community app built entirely around listening to music together. You join a **Lounge**, see who is
listening to what right now, and tap into a **Session** to hear the same track at the same second. This handoff
covers the full mobile design: onboarding, auth, the Feed, Lounges, Sessions (music / movie / screen-share /
game-table modes), voice, direct messages, calls, profiles and settings.

The visual direction is called **Patchbay**: flat, gridded, zero corner radius, hard 2px rules, Archivo
throughout, near-mono red on near-black. Red is reserved — it means *live, playing, joinable, in sync, on aux*
and nothing else.

## About the design files

`prototype.dc.html` in this bundle is a **design reference created in HTML** — a working prototype showing intended
look and behaviour. It is **not production code to copy**. The task is to recreate these designs in the target
codebase's existing environment using its established patterns and libraries.

The target codebase already exists: **Expo / React Native** (`AnushKulal/pass-the-aux`), with Supabase for data
and realtime. Implement against that — `src/lib/theme.ts` for tokens, `src/playback/` for the sync engine,
`supabase/migrations/` for schema. Where this design needs tables that don't exist yet, they are called out
under **Schema gaps** below.

## Fidelity

**High-fidelity.** Final colours, type, spacing and interaction states. Recreate pixel-perfectly using the
codebase's own primitives. Every value in **Design tokens** is exact.

Canvas: **402 × 874** (iPhone), status bar ~58px at top, home indicator 34px at bottom. Content column caps at
720px and centres on web.

## Non-negotiable floors

| Constraint | Value |
|---|---|
| Touch targets | **44 × 44 minimum**, ≥8px between adjacent targets |
| Body text | **≥16px**; nothing readable below 10px |
| Contrast | **4.5:1** minimum for text, measured against the actual surface |
| Motion | 200–320ms; must respect `prefers-reduced-motion` |
| Icons | **Lucide**, inline SVG, `viewBox 0 0 24 24`, `stroke-width 2`, round caps, `currentColor`. Never emoji as an icon, never a Unicode symbol character as an icon |
| Radius | **0 everywhere** |

The icon rule matters: Archivo has no glyphs for `❚❚ ⏭ ← ↑ ■ □`, so those fall back to a system font and some
resolve to colour emoji. All icons in this design are inline Lucide SVG.

---

## Design tokens

Two themes. Every colour is a CSS custom property; the app switches by swapping the token block. Theme choice
is **Dark / Light / System**, System following `prefers-color-scheme` live.

### Dark (default)

| Token | Value | Role |
|---|---|---|
| `--aux-bg` | `#0a0908` | App ground |
| `--aux-bg2` | `#0f0e0d` | Recessed — artwork wells, composer fields |
| `--aux-surf` | `#141312` | Raised — row hover, docked bar |
| `--aux-surf2` | `#1c1a19` | Nested surface |
| `--aux-surf3` | `#211f1e` | Pressed, inactive toggle track |
| `--aux-av` | `#2d2b2b` | Avatar fill |
| `--aux-art` | `#3a3736` | Artwork stand-in glyph |
| `--aux-ink` | `#f3f2f2` | Primary text |
| `--aux-ink2` | `#9b9797` | Secondary text (6.9:1) |
| `--aux-ink3` | `#8a8686` | Tertiary labels (5.7:1) |
| `--aux-live` | `#ec3013` | **Reserved** — accent fills |
| `--aux-live-t` | `#ff563c` | **Reserved** — accent text on dark |
| `--aux-on-live` | `#0a0908` | Text on accent fill |
| `--aux-danger` | `#f2657e` | Destructive |
| `--aux-rule-s` | `rgba(243,242,242,.10)` | Hairline between list rows |
| `--aux-rule` | `rgba(243,242,242,.16)` | Standard rule |
| `--aux-rule-2` | `rgba(243,242,242,.24)` | Control border |
| `--aux-rule-3` | `rgba(243,242,242,.30)` | Strong border |
| `--aux-track` | `rgba(243,242,242,.12)` | Progress track |
| `--aux-grid` | `rgba(243,242,242,.045)` | 25px modular grid overlay |
| `--aux-live-w` | `rgba(236,48,19,.14)` | Accent hover wash |
| `--aux-live-m` | `rgba(236,48,19,.28)` | Accent mid rule |
| `--aux-danger-b` | `rgba(242,101,126,.50)` | Destructive border |
| `--aux-danger-w` | `rgba(242,101,126,.12)` | Destructive hover |
| `--aux-scrim` | `rgba(10,9,8,.86)` | Sheet backdrop |

### Light

Same names, these values. Note the accent **darkens** to `#ae1800` — white on `#ec3013` only reaches 3.8:1,
which fails on small labels like the PREMIUM chip; `#ae1800` reaches 6.5:1 and reads stronger on a light ground.

```
--aux-bg:#f3f2f2  --aux-bg2:#eae9e9  --aux-surf:#eae7e7  --aux-surf2:#e2dfdf  --aux-surf3:#d7d3d3
--aux-av:#d7d3d3  --aux-art:#bab6b6  --aux-ink:#201e1d   --aux-ink2:#444141   --aux-ink3:#605d5d
--aux-live:#ae1800  --aux-live-t:#ae1800  --aux-on-live:#f3f2f2  --aux-danger:#a4152c
--aux-rule-s:rgba(32,30,29,.12)  --aux-rule:rgba(32,30,29,.20)  --aux-rule-2:rgba(32,30,29,.32)
--aux-rule-3:rgba(32,30,29,.42)  --aux-track:rgba(32,30,29,.14)  --aux-grid:rgba(32,30,29,.05)
--aux-live-w:rgba(236,48,19,.10) --aux-live-m:rgba(236,48,19,.24)
--aux-danger-b:rgba(164,21,44,.45)  --aux-danger-w:rgba(164,21,44,.10)  --aux-scrim:rgba(32,30,29,.55)
```

### Type — Archivo only, three jobs by weight

| Role | Spec | Used for |
|---|---|---|
| Display | 800, 22–88px, `letter-spacing:-0.02 … -0.045em` | Screen titles, track titles, the wordmark |
| Heading | 800, 11–15px, `letter-spacing:.03–.06em` | Section titles, button labels |
| Body | 400, 14–16px, `line-height:1.45–1.55` | All prose |
| Label | 600, 10–12px, `letter-spacing:.09–.14em`, uppercase | Metadata, section kickers |
| Readout | 800, 10–22px, `font-variant-numeric:tabular-nums` | Every number that measures: `−412ms`, `3/5`, `QUEUE/5`, `1:44` |

There is no second typeface. The measuring voice is a **weight plus tabular figures**, not a mono font.

### Spacing / shape

Spacing: 4, 8, 12, 16, 20, 24, 32, 44. Radius: **0** everywhere. Rules: 1px hairline within a group, **2px**
between major sections. Elevation: none — no shadows; separation is done with rules and ground steps.

---

## Screens

### 1. Intro (4 pages) — pre-auth
Full-bleed, `padding:66px 26px 40px`. Header row: `01 / 04` (600/10px/`.14em`, ink3) left, **SKIP** right
(44×48 target). Footer: four equal 3px bars as progress, then a 52px accent button — **NEXT**, becoming
**GET STARTED** on page 4.

1. **Pass the aux.** 46px/800 display over two lines, 2px accent rule bleeding off the right edge, then the
   pitch. Logo bleeds top-right.
2. **No audio passes through Aux.** Kicker `NOT A STREAMING SERVICE`. A bordered block quotes
   `this track, starting at this instant` in accent.
3. **Synced to the fraction of a second.** Kicker `THE HARD PART`. Three ruled rows: `±40ms` solid accent bar
   / `±220ms` 45° hatched bar / `BEYOND` outlined bar.
4. **Spotify or YouTube. Same chorus.** Two side-by-side bordered cards; the YouTube card carries the accent
   border.

### 2. Sign in
Wordmark AUX at 88px/800/`-0.045em` with a 2px accent rule through it, bleeding both edges. Tagline
`PASS THE AUX.` (600/12px/`.22em`). Segmented **SIGN IN / CREATE ACCOUNT** (46px cells, active = accent fill).
Email + password fields (46px, `--aux-surf`, 1px `--aux-rule-2`). 52px accent primary, then a bordered
"Continue with Google". Below a 2px rule, the honest note: *"No Spotify needed. Aux plays through YouTube by
default — link Premium later from Settings if you have it."*

### 3. Claim username
`STEP 2 OF 2`. Title "Claim your handle" 40px/800. Handle field framed in accent: a 46px `@` block in accent
fill, the input at 22px/800, and a live `AVAILABLE` chip in accent. 76px avatar block + display-name field.
States needed: checking / available / taken / invalid characters.

### 4. Profile setup — **the gate**
Title "How people see you". A 92px photo slot (tap to fill) beside a dashed **ADD A PROFILE VIDEO** slot
(2–6s loop shown behind the avatar). Display name + `@handle`. Bio textarea. A **"Show when I'm active"**
switch (44×26 visual inside a 44×44 target) governing your live dot and Feed presence. Two provider cards
(Spotify LINKED · FREE / YouTube SIGNED IN · PREMIUM).

**Gate:** a bordered `BEFORE YOU CAN LOOK AROUND` checklist — *Add a photo*, *Write a one-line bio* — with 12px
squares filling accent as each is satisfied. Until both pass, the **SAVE PROFILE & ENTER AUX** button renders
disabled at 55% opacity, **and the lounge rail and bottom tab bar do not render at all**. On save:
`profileDone = true`, navigate to the Feed.

### 5. App shell
- **Lounge rail** — 58px, right border 2px. Top to bottom: the 46×46 AUX mark (38px black tile, 2px accent
  border), a 46×46 **DM tile** with a Lucide `message-circle` and an unread count badge inset at its top-right,
  a 24×2 divider, then one 46×46 tile per lounge (38px visual, 3px pulsing accent bar on the left edge when
  live), then a dashed `+` tile. Empty state: a two-line `NO LOUNGES` marker.
- **Bottom tabs** — 54px, three flush-left cells FEED / EXPLORE / YOU, active cell marked by a 22×2 accent bar.
- Both hidden until `profileDone`.

### 6. The Feed (home)
Title "The Feed" + live count in accent. Rows, 78px, staggered in at 55ms intervals:
`[64px artwork well | 1px rule] [title 15px/600 · "artist · LOUNGE" 12px ink2 · person chip + provider badge] [1px rule | 70px right column: JOIN/SOLO, "N IN"/"ALONE", elapsed]`
plus a 2px progress track pinned to the row's bottom edge, accent fill, **advancing in real time**.
The person chip (avatar + handle) is its own 44px target opening that profile; the rest of the row joins.
Rows are filtered to lounges you're actually a member of. Empty state: header reads
`NOBODY IS LISTENING YET` and the end block becomes `YOUR FEED IS QUIET` + a START A SESSION action.

### 7. Explore
Join-by-code field (44px, 800/13px/`.14em`) with a 60px accent JOIN cell; then a search field. Rows carry tag,
name, description, member and live counts, and a JOIN / OPEN cell. Joining **adds a real lounge record** and
selects it. Unmatched codes report *"No lounge with that code"*.

### 8. Lounge
Header: name 20px/800, chips (`128 MEMBERS`, `PUBLIC`, `4 LIVE` in accent), an **INVITE** button and a `···`
overflow. Tabs **SESSIONS / CHAT / MEMBERS** (44px, active underlined 2px accent).
- **Sessions** — cards: 64px artwork well, pulsing dot + session name, `track — artist`, `@host ON AUX` and
  `4/6 LOCKED`, and an `IN` cell.
- **Chat** — message rows: 30px avatar (own 44px target → profile), name (44px target → profile) + timestamp,
  body with **@mentions in accent** (600 weight), reaction chips (44px) and a dashed `+`.
- **Members** — avatar with presence dot, name + PREMIUM chip, `@handle · since`, and an OWNER (accent fill) /
  MOD (accent outline) role chip. Rows open profiles.
- `···` sheet: **Invite people**, and **LEAVE THIS LOUNGE** for members/mods, or — if you own it — a warned
  **DELETE THIS LOUNGE** block naming the member count, with no leave option. Either removes it from the rail.
- Non-members get a **"Join to see inside"** state, not an error.

### 9. Session — the centrepiece
Top bar: 44px back, session name + lounge, and a tappable `3/5 LOCKED · 6 LISTENING` readout opening
diagnostics. Four modes, switched from the drawer.

**Music mode** — a `NOW PLAYING / SYNC ORBIT` toggle, then:
- *Now playing*: 250px artwork well with the 25px modular grid and a horizontal accent rule; title 26px/800;
  6px progress track with a 2px playhead overhanging ±5px; **lyrics panel** (four-line window, current line
  19px/800 with a 2px accent bar, neighbours 15px/400 in ink3 — falls back to *"No timed lyrics for this
  one"*); a sync block (`YOU ARE LOCKED` + drift, clock offset, best RTT, RE-ANCHOR); transport (−15 / play-pause
  / skip) with **PASS THE AUX** for the host or a `@mira is on aux` + REQUEST row for passengers; then the
  **drift chart** — one 44px row per listener: avatar, first name, a ±400ms deviation plot against a centre
  axis, drift readout, rung label. Tapping a row opens that person's voice controls.
- *Sync orbit*: header strip `DISTANCE FROM CENTRE = DRIFT · ±400ms`; a 340px dial with rings at ±40 (2px
  accent) and ±220 (dashed), listeners plotted by |drift|, the track at centre with elapsed time; a footer
  strip of three 9×9 swatches — solid / hatched / outlined — as the legend. **The legend is a normal-flow
  sibling, not absolutely positioned inside the dial**, or bottom-slot listeners collide with it.

**Movie mode** — 16:9 well, title/year/director, its own progress and drift readout, subtitle + audio-track
cells, transport, END MOVIE, and a "watching together" roster with mic state.

**Screen-share mode** — 16:10 frame with a pulsing LIVE chip; if you're sharing, a stop control and the note
that video is peer-to-peer; if someone else is, their name + a **VIEW SCREEN** button and a watching count.

**Game mode** — see Lobby games.

**Dock (all modes)** — a 44px grabber showing `<MODE> · SWIPE UP FOR MORE` over a five-cell bar, 58px:
**MIC** (toggles, icon follows state) · **QUEUE/N** · **CHAT** · **SHARE** · **LEAVE** (danger).

**Drawer** (swipe up) — a 2×2 grid: **CHANGE LOBBY**, **DEAFEN**, **CAMERA**, **LOBBY GAMES**; then Voice
settings, Add a track, and LEAVE THE LOBBY.

**Change the lobby** — three peer options, current one chipped: **Music**, **Movie night**, **Screen share**.
Only the person on aux can change it; everyone else follows and keeps their place.

### 10. Lobby games
Board games with seats and spectators: **Ludo** (4), **Chess** (2), **Checkers** (2), **Carrom** (4),
**Connect Four** (2), **Uno** (8). Each row: `2/4 SEATED`, `5 WATCHING`, and two 44px actions —
**TAKE A SEAT** (reads FULL and drops you to watching when taken) and **WATCH**.

**Game table** (Session mode `game`): a square board — CSS chequerboard for chess/checkers, ruled grid
otherwise — a whose-turn readout, `AT THE TABLE` seats with an accent ring and TO PLAY on the active player,
a viewers strip, and LEAVE TABLE. **You occupy a seat only when you actually hold one** — build the seated list
from the roster with the local user excluded unless `gameRole === 'player'`.

**Join queue** — while a game runs the table is tagged `GAME IN PROGRESS` and a spectator's only action is
**REQUEST A SEAT · NEXT GAME** → `REQUEST SENT · AWAITING HOST` → `YOU ARE #2 IN LINE`. A `NEXT UP · N IN LINE`
section shows the approved queue in order with free-seat count. The host sees `N WAITING ON YOU` with
ACCEPT / decline; accepting queues them rather than seating them. **END GAME · SEAT THE QUEUE** fills free seats
from the top of the list and reports who got in. Between games the tag flips to `BETWEEN GAMES`, TAKE THE FREE
SEAT appears, and the host gets **START THE NEXT GAME**. A game in progress is never interrupted.

### 11. Voice
- Dock MIC toggle; **DEAFEN** (also drops your mic); **CAMERA**.
- **Voice settings**: input mode — **ALWAYS ON** (voice activity) / **PUSH TO TALK** / **DIRECT TALK** (open
  mic, no gate); an input-sensitivity threshold with a live meter and a dB readout; noise suppression switch;
  and an audio-source picker — Phone microphone / Wired headset / Bluetooth (*"adds 120–200ms of latency"*).
- **Per person** (tap any roster row): their volume 0–200% **for you only**, **MUTE FOR EVERYONE** as a mod
  action cutting their mic server-side, **hard-seek them back**, message, or pass them the aux.
- Roster mic state: speaking = 2px accent ring; muted = struck-mic in danger.

### 12. Queue / Add a track / Session chat
Queue sheet: now-playing header, then rows with position, artwork well, `artist · duration · @adder`, and 44×44
bump / remove. Add-a-track: one search across providers, results showing `SPOTIFY + YOUTUBE` or `YOUTUBE ONLY`,
plus a **low-confidence match** case offering three candidates with match percentages. Session chat is scoped
to the Session and ends with it.

### 13. Messages (DMs)
Inbox: `N UNREAD`, then conversation rows — 40px avatar with presence dot, name, status, preview, timestamp and
an unread badge, staggered at 50ms. **Unread rows render bright**: preview `--aux-ink` at 600, name at 800;
read rows `--aux-ink2` at 400, name 600. Avatar and name are their own targets opening the profile
(`stopPropagation`); the rest opens the thread. Below, a **PEOPLE** section with message / add actions.

Thread: header with avatar, presence and status (tap → profile), then search-this-conversation, call and video.
Bubbles: text (own = accent fill, right-aligned), **voice notes** (play glyph + 12-bar waveform + duration),
**photos** (180px well + caption), **files**, and **shared-track cards** with ADD TO THE QUEUE. Composer:
attach (paperclip) / input / mic / SEND. Attach sheet: Photo or video / File / Voice note / A track. Recording
sheet: pulsing dot, live waveform, timer, SEND VOICE NOTE.

**@mentions** — typing `@` opens a scoped picker above the composer: **IN THIS LOUNGE** (all members, with
roles) or **IN THIS SESSION** (only people in it, with providers). Each further character filters on handle *or*
display name from the first character. The count reflects the **full** filtered set and the list scrolls —
never truncate silently. Picking completes the handle with a trailing space. Mentions render in the body in
accent at 600, or `--aux-ink` at 800 inside your own accent bubble so they stay readable.

### 14. Calls
Voice: 132px pulsing accent avatar, name 30px/800, running timer in accent tabular figures, and the note that
the Session keeps playing and call audio ducks the music. Video: their camera 3:4 with your self-view inset.
Controls: **MUTE** (icon swaps mic ↔ mic-off, label swaps, turns accent while muted), **CAMERA**, **END**.

### 15. Profiles
Own profile (You tab): 72px avatar with presence dot, name, handle, provider + PREMIUM chips, bio, an **EDIT**
button (72×44), member-since line, then Settings, Connections, Your lounges, Recently heard together, Sign out.

Others: back bar, 84px avatar with dot, name 24px/800, handle, status + provider + PREMIUM chips, bio,
**LISTENING RIGHT NOW** card with a JOIN action, a four-up action row **MESSAGE / CALL / VIDEO / ADD**, and
`ON AUX SINCE` + `IN COMMON`.

### 16. Settings
**Appearance** — Dark / Light / System as three 52px cells with Lucide moon / sun / monitor, active cell in
accent fill. **Music accounts** — Spotify (linked · free — playing via YouTube) and YouTube with a real
signed-out state (*"Not signed in — tap to sign in"* + a SIGN IN chip). **Voice & video** — microphone & audio,
subtitled with the live mode, threshold and source. **Account** — Edit your profile, About the developer.

### 17. Connections
Spotify card with three distinct states — **not linked**, **linked (free)**, **linked (Premium)**. *Linked but
free is a normal state, not an error*: explain that Spotify only permits playback control on Premium and Aux
will use YouTube instead. Do **not** style it with the danger colour. Plus a playback-source preference:
**AUTO** or **ALWAYS YOUTUBE**.

### 18. About the developer
Aux's thesis, the developer card, VERSION / STACK cells, a "how sync works" note, and a repository link.

### 19. Not found
`404` at 72px/800 in accent over a 2px accent rule, "Dead cable.", and BACK TO THE FEED.

---

## Interactions & behaviour

**Module transitions** — every screen, tab and mode enters with `translateY(8px) → 0` + fade over **280ms**
`cubic-bezier(.2,.8,.2,1)`. Sheets slide up from the bottom over **300ms** while the scrim fades over 200ms.
List rows stagger: Feed 55ms steps, Messages 50ms steps. Hover/press eases background, colour and border over
160ms. All of it collapses under `prefers-reduced-motion`.

**Live behaviour** — playback position advances on a 250ms tick; per-listener drift mean-reverts toward each
person's characteristic offset with noise, so the three rungs are all visible at once; the progress bars on
Feed rows advance in real time. Three cards ticking simultaneously is the "oh, I get it" moment.

**States to cover** — every list needs loading (skeleton rows), empty and error. Named empty states in this
design: Feed quiet, no lounges, no sessions, no lyrics, no viewers, table full, not-a-member.

## State

```
view · introStep · profileDone · tab · ltab · lounge · lounges[] · sheet
playing · posMs · nowId · onAux · queue[] · roster[] · lmsgs[] · smsgs[]
clockOffset · rtt · samples
theme · sysDark
dmWith · dmDraft · dmSearch · searchOpen · convos[] · dms{} · friends{}
call · callKind · callSecs · muted
mode · micOn · micMode · sensitivity · audioSource · noiseSup · deafened · camOn · sharing · sharedBy
voice{ [user]: { muted, vol, speaking } } · personSel
game · gameRole · gameLive · gameReqs[]
movie{} · myBio · hasPhoto · hasVideo · showActivity · ytLinked · spotify · playbackPref
```

Two ordering traps worth naming, both of which broke this prototype during development:

1. **Derive membership once, before dispatching.** Reading `this.state` after `setState` to decide a
   confirmation message gives you the *post*-update value — every join reported "Opened" instead of "Joined".
2. **Anything `lounges`-derived must be derived from state**, not a literal. The Feed, the rail, Explore's
   joined flags, Create Session's gate and the lounge header all read from the same array; a hardcoded copy
   silently keeps showing lounges you've left.

## Sync — the load-bearing part

Playback state is **one row**: which track, and the server instant at which position 0 played. No audio passes
through the backend. Each client answers *where should I be now?*:

```
expected = server_now   − started_at_ms     while playing
expected = paused_at_ms − started_at_ms     while paused
```

A late joiner needs no special handling: read the row, do the arithmetic, seek, play.

**Clock offset** — NTP-style, 5 samples, lowest round-trip wins outright (a clean sample beats a mean polluted
by one slow request). Re-measure when older than 60s.

**Drift ladder** — measured every tick, `drift = actual − expected`:

| Magnitude | Action | Shown as |
|---|---|---|
| ≤ 40ms | ignore | `LOCKED`, solid accent mark |
| 40–220ms | nudge playback rate ±2% (inaudible) | `NUDGING`, white mark |
| > 220ms | hard seek (audible, exact) | `SEEKING`, grey mark |

**Losing sync is shown by losing the red**, never by turning amber — the palette stays mono and the signal
stays honest. Every reading writes to `sync_metrics`.

Transport is **server-authoritative**: play / pause / seek / skip / advance / queue-append are database RPCs,
not client messages.

## Schema gaps

These screens have no backing tables in `supabase/migrations/` yet:

| Feature | Needs |
|---|---|
| Messages / DM threads | `conversations`, `direct_messages` |
| Attachments, voice notes | `attachments` (+ storage bucket) |
| Profiles | `profiles.bio`, presence/last-seen, activity-visibility flag, photo + profile-video URLs |
| Voice | per-room voice state (mic, deafen, server-mute), per-user volume is client-local |
| Screen share / camera | signalling for peer-to-peer media |
| Lobby games | `games`, `game_seats`, `game_requests` |
| Movie mode | a media source on the room timeline |
| Calls | call signalling |

## Assets

- `aux-logo.png` — the user's own mark: a red neon ¼″ jack on a **baked-in black background**, 1254×1254.
  It cannot be composited onto a light ground. In this design each instance sits on a plate painted with
  `--aux-bg` and blended `mix-blend-mode: screen`, so `screen(ground, black) = ground` and the plate is
  seamless; the four bleeding decorative instances are **dark-mode only**. **Recommendation: get a version with
  a transparent background** and this whole mechanism disappears.
- Album art, movie stills and screen-share frames are typographic/geometric **placeholders** — a letter in a
  ruled well. Real artwork drops straight in. The layout must survive any artwork, including bright and ugly.
- Icons: Lucide. Used here — message-circle, phone, video, video-off, search, x, arrow-left/right/up,
  chevron-right, plus, paperclip, mic, mic-off, headphones, headphones-off, image, file-text, user-plus,
  sliders, monitor, monitor-up, log-out, gamepad-2, film, music, play, pause, skip-forward, list, repeat,
  pencil, rotate-ccw, sun, moon.

## Copy guidance

Active voice on every control — *Join*, *Start a Session*, *Take the aux*. Errors say what went wrong and what
to do next. Be honest about limits: where the product can't do something (Spotify Premium, YouTube ads), say so
plainly and move on. The tone is a friend telling you how it is, not a brand managing you.

**Vocabulary — use these words in the UI.** Lounge (a community). Session (a live listening room; "the party").
On aux (whoever controls playback). The Feed (home). Never say *room*, *server*, *channel* or *host* in UI copy.

## Files

- `prototype.dc.html` — the complete design. Opens in a browser; tap through it.
- `aux-logo.png` — the mark.
- `github.md` — repo association and the screen → source map.
