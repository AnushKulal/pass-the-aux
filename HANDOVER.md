# Continuing Aux from anywhere

Written so that this project can be picked up on a phone, a tablet, or a
different machine without the context that produced it.

`docs/ARCHITECTURE.md` explains how the app works, `docs/SETUP.md` how to stand
it up from zero, and `TESTING.md` what to check. This file is the other thing:
**where the project currently stands, what is deliberately the way it is, and
what is still owed.**

---

## 1. You do not need a laptop to ship

Everything that changes the app on a phone runs in GitHub Actions, and every
workflow is `workflow_dispatch` — which means it has a **Run workflow** button
in the GitHub mobile app and in any phone browser.

| Workflow | What it does | When you need it |
|---|---|---|
| **Ship OTA update** | Publishes JavaScript straight to installed apps | Almost everything |
| **Build Android APK** | Full rebuild, publishes to the `latest` release | Only when something native changed |
| **Apply database migrations** | Runs new SQL against Supabase and regenerates types | New migration files |
| **Build dev client** | A debuggable build | Rarely |

### The rule: OTA unless it cannot be

An OTA moves JavaScript and assets. It **cannot** move native code. Check
before building:

```bash
git diff <last-build-sha>..HEAD -- package.json app.json assets/
```

Empty, or only `extra.changelog` in `app.json`? **OTA.** A rebuild would produce
an identical native shell and cost sixteen minutes for nothing.

Needs a real build:

- a new dependency containing native code
- an Android permission, or an `app.json` plugin
- icons or the splash — those are baked at build time
- an Expo SDK bump

When several native things are pending, **batch them into one build** rather
than building per change.

### Reading the result

`build-info.json` is published beside the APK on the `latest` release and is
what the in-app updater reads. It names the `versionCode`, the `patch`, and the
commit — so you can always tell what is actually on a phone.

**Verify an OTA actually reaches devices** rather than trusting the green tick.
This asks the server the same question the app asks:

```bash
curl -s "https://u.expo.dev/3c252219-3619-434b-9ab4-f0931d09722a" \
  -H "expo-channel-name: production" \
  -H "expo-runtime-version: 1.0.0" \
  -H "expo-platform: android" \
  -H "expo-protocol-version: 1" -H "expo-api-version: 1" \
  -H "Accept: multipart/mixed" | grep -oE '"id":"[^"]*"'
```

A new id means the update is live. `runtimeVersion` must match the installed
build's `versionName`, or the update exists and no device will ever be offered
it.

---

## 2. The rules the UI is built on

These are enforced by convention, not by the compiler, so they are easy to break
without anything going red.

### The accent rule

- **CORAL** (`C.live` family) — **state and live-entry.** Live, playing, in
  sync, on aux, unread, PREMIUM. Also the **Join** and **Solo** buttons, because
  entering something that is already happening is the one action the state
  colour owns.
- **BLUE** (`C.pill`, gradient `C.priTint → C.pill`) — **create and control.**
  Start a session, submit a form, play, skip, a selected segment, a link.
- **PINK-RED** (`C.danger` family) — **destruction and failure.** Errors are
  never coral.

No element carries two accents. The one deliberate exception is `BrandRule`, a
decorative bar that carries no meaning — see its own comment.

Blue was briefly given to Join on the reasoning that "blue is action". That was
wrong and is recorded at the top of `live` in `src/lib/theme.ts`. If a comment
anywhere argues Join should be blue, it predates the correction.

### Motion

`src/lib/entrance.ts` owns every entrance. Two systems live there and the user
can switch between them in **Settings → Appearance → Motion**:

- **Spring** — the current one. Things settle rather than finish, and arrive by
  *surfacing* (scale) rather than sliding up.
- **Classic** — the previous one, kept whole rather than approximated, so
  reverting genuinely returns the app to how it behaved.

Entrances key off **focus, not mount**. A tab navigator never unmounts its
screens, so a mount-driven entrance plays once per app launch and is silent from
the second tab switch onward.

### Reserving room for the floating nav

The navigation capsule floats and occupies **no layout space**. Every scroll
container inside `(tabs)` must call `useDockReserve()` from `@/lib/dock`.

Do not reach for `Dock.reserveBase` — it is the reservation *minus* the device
inset and is always wrong alone. It used to be public, ten screens used it, and
nine of them forgot to add the inset.

---

## 3. Traps that have already cost time

Every one of these compiles, lints, and looks fine in review.

**The YouTube player's transport is an EDGE, not a command.**
`react-native-youtube-iframe` posts `playVideo`/`pauseVideo` from an effect keyed
on the `play` prop CHANGING, and its ref exposes only getters and `seekTo` —
there is no imperative pause. So `setPlaying(false)` when the state already reads
false is a React bail-out: nothing reaches the player, and pause becomes
unpressable. The player can get out of step on its own (a `pauseVideo` posted
during BUFFERING is dropped; `seekTo(s, true)` starts playback from any state
that is not PAUSED), so this is reachable in normal use. `youtube-player-host.tsx`
now holds the desired state in a ref, reconciles against what the player reports,
and — because a swallowed pause emits no event at all — polls `getCurrentTime`
every 2s while paused. Anything added there must keep BOTH halves.

**One `BlurTargetView` may have exactly ONE `BlurView` pointing at it.** Two of
them killed the process — a native `SIGSEGV` on the RenderThread, 512 frames of
`android::uirenderer::computeTransformImpl`, "likely stack overflow". Both blur
views sat inside the target and redrew from it, so each repaint dirtied the
target and the dirtied target repainted the other, growing hwui's damage chain
~58 times a second until its recursive walk ran out of stack. It took about six
seconds, and there is **nothing in the JavaScript log** — `tsc`, `eslint`, the
web export and a web render of the component were all clean. Reproduce and read
it with `adb logcat`, not with the bundler. Fixed in patch 15 by giving the nav
capsule the only target and letting the return bar fall back to a solid capsule
on Android.

**Android never blurs, whatever expo-blur is asked for.** Measured on the
device: body text crossing the nav capsule's edge is equally sharp inside and
outside it. The frost on Android is OPACITY — `C.dock`, painted on the view
itself — and `C.nav` is only correct where a real blur sits under it (iOS, web).

**`overflow: 'hidden'` turns `boxShadow` into a hard-edged rectangle** on
Android. The clip cuts the outset shadow instead of letting it fade, which is
why both bottom bars had a grey slab under them while the Feed's cards — same
shadow numbers, no clip — were soft. `floating()` returns `elevation` there
instead; it is drawn by the parent from the view's outline, so the child's clip
cannot reach it. Elevation needs a non-transparent background on the same view
or there is no outline and no shadow at all.

**Reanimated layout animations render invisible on web.** `entering={FadeIn}`
marks a view `visibility: hidden` until its animation runs, and on
react-native-web it never runs — leaving content that reports correct colour,
size and layout while being completely invisible. This shipped twice. Use
`useEntrance`.

**Percentage heights need a *definite* parent.** `flex: 1` and `minHeight` are
not definite. A `height: '100%'` inside one drew the update sheet's buttons as a
torn rectangle over the card.

**`overflow: 'hidden'` clips what children draw outside.** The nav's plus button
shipped with a flat lid because it was a child of the blurred capsule and lifted
past its edge.

**Android crops the outer sixth of an adaptive icon.** The launcher mark was
generated outside that safe zone, so most of it was cut away before it drew, and
the installer showed a broken logo.

**`getbbox()` counts the glow.** The dot's halo spreads right and down only, so
centring the bounding box pushed the letters up and left. Centre on solid ink —
alpha ≥ 200.

**`expo-blur` on Android does nothing without a `blurTarget`.** It silently
paints a flat tint. The nav accepted the prop for a while before anything passed
it, so the "glass" was a no-op.

**A full-bleed overlay with `pointerEvents: 'auto'` eats every tap.** A parked
update card once swallowed the whole bottom of the app. Use `box-none`, and
`display: none` to truly remove something from hit testing — `pointerEvents` in
a *style* does not reliably reach react-native-web.

**The React Compiler is on.** `react-hooks/immutability` rejects writing a
shared value inside an event handler. Use state plus an effect.

**Do not pipe a heredoc into python's stdin** (`python - <<EOF`). It hangs.
Write a script file, or use `python -c`.

---

## 4. What is still owed

### Needs you, not code

**Add-track is broken and one log line will say why.** `YOUTUBE_API_KEY` *is*
set, so it is present-but-failing: most likely stale (rotating it was flagged
earlier — rotated at Google and never updated here), quota-exhausted (the
default is 100 searches/day), or restricted. Look at **Supabase dashboard →
Edge Functions → `search-tracks` → Logs**, then search in the app.

**Spotify sign-in needs two secrets and a dashboard toggle.**
`SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` are absent, and Spotify has to
be enabled as an Auth provider with its redirect URIs allow-listed.

**Voice and screen share need a LiveKit Cloud project** (free tier: 5 GB
egress/month, 100 concurrent) and three secrets:

```bash
supabase secrets set LIVEKIT_URL=wss://YOUR.livekit.cloud \
  LIVEKIT_API_KEY=... LIVEKIT_API_SECRET=... --project-ref atdusjfidswqrkuefgvr
```

**Security, still outstanding:** the old Sydney project
(`figkjbunwqmbjisoajxe`) should be deleted, and legacy API keys disabled on the
current project — a `service_role` key was once printed into a transcript.

### Needs code

**Voice, screen share, host-kick.** `supabase/functions/livekit/index.ts` is
written and committed — token minting and kick, with the room derived
server-side from a membership check so a client cannot name someone else's
room. **Nothing in the app calls it yet.** The client work needs
`@livekit/react-native`, which is a **native dependency**, so it needs a real
build and cannot be OTA'd.

Screen share on Android additionally needs a foreground service and its
permissions. "Single app vs entire screen" is Android's own dialog and only
exists on **Android 14+**.

**"Pass the aux" is a permanently disabled button.** `onPassAux` is never
passed, and no host-transfer mutation exists. Pre-existing, not a regression:
the passenger can ask for the aux, the holder can never give it.

**Mic, deafen and per-member mute are UI-only.** The controls are real and
correctly related — deafen forces mic off and does not auto-restore it — but
there is no voice transport, so nobody hears anything.

**The transport swallows its own failures, and an audit found five ways.** All
verified against the files, none fixed yet — they are the reason a pause can go
missing for reasons that have nothing to do with the player:

- **No `onError` on any transport mutation** (`queries.ts` play/pause/resume/
  seek/advance). A `room_pause` that fails on network, an expired JWT, or the
  `not_on_aux` raise produces no toast and no log. The glyph just stays wrong.
  `requestAux` in `room/[id].tsx` does toast its error, so the pattern exists
  and was simply not applied here.
- **A passenger depends entirely on realtime.** `useRoom` is `staleTime:
  Infinity` with `refetchOnWindowFocus: false`, so a dropped `UPDATE` leaves a
  listener playing with no path back except a socket reconnect or a remount.
- **Last-writer-wins on `roomKeys.detail`.** The realtime echo, every RPC's
  `onSuccess`, and `handleEnded`'s advance all `setQueryData` unconditionally,
  ordered by network completion rather than server commit. A late echo can
  overwrite a newer pause. Needs a monotonic version on the row.
- **The `trackReady` gate in `session.tsx` drops transport updates** whenever
  the resolved-track query is failing — and it retries once, then holds the
  error for the rest of the Session. A pause does not need the track.
- **`resync()` replays the STORED timeline**, so a client that missed a pause
  has playback actively restarted rather than merely not stopped.

**A Session can park past the end of its own track.** Advancing with an empty
queue leaves `track_id` set and the timeline running, so every resume lands
after the end, the video ends instantly, `handleEnded` advances, and it loops.
Seen live while testing patch 18; it makes the Session unusable until a new
track is queued.

**Apple Music is not wired, and the reason is not "iOS only".** MusicKit JS runs
in an Android WebView, so sign-in is possible. What blocks it: minting a
developer token requires a **paid Apple Developer membership**, and Apple
publishes no way for a third-party Android app to *play* Apple Music audio — so
it would buy an identity, not a playback source.

---

## 5. Picking this up in a new session

Point a fresh session at the repo and give it this file. The house style is
worth stating explicitly because it is unusual and load-bearing:

**Comment the WHY, never the what.** Every non-obvious decision carries a short
note giving the reasoning, what it replaced, and what breaks if done the other
way. When you reverse a decision, say what it was — several bugs in this project
were found *because* a comment argued for something the code no longer did, and
several were caused by a confident comment that had become false.

Before finishing anything:

```bash
npx tsc --noEmit          # must be zero
npx eslint src            # must be zero
npx expo export --platform web    # proves it actually bundles
```

The third one matters. Typecheck and lint both pass on code that fails to
bundle.
