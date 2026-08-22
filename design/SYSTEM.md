# Aux — "Signal Afterglow"

The chosen direction: **C's precision fused with D's atmosphere.** The technical layer
(playhead, drift readouts, hairlines, mono numerals) sits *inside* a warm, art-driven glow rather
than on cold black. Precision you can feel warm in.

The governing idea: **the artwork lights the room, and one line runs through everyone in it.**

---

## Tokens — copy these values exactly

```css
/* Ground — deep indigo-plum. Warm-leaning, never neutral grey, never pure black. */
--ground:          #0E0A16;
--ground-2:        #140F1E;   /* raised blocks, list rows */

/* Glass — D's translucency, always over the bloom so it picks up colour */
--panel:           rgba(255, 255, 255, 0.055);
--panel-strong:    rgba(255, 255, 255, 0.09);
--hairline:        rgba(255, 255, 255, 0.10);
--hairline-bright: rgba(255, 255, 255, 0.18);
--grid:            rgba(255, 255, 255, 0.028);   /* C's grid, dialled almost out */

/* Ink */
--ink:             #F2EDF7;   /* warm white */
--ink-2:           #A79FB8;   /* secondary — 7.1:1 on ground */
--ink-3:           #6E6681;   /* PLACEHOLDERS AND DIVIDERS ONLY — fails 4.5:1 */

/* Semantic. --live is the ONE reserved colour: playing, live, joinable, in sync.
   It is also the playhead. Nothing decorative may use it. */
--live:            #57E2D5;
--live-dim:        rgba(87, 226, 213, 0.14);
--warn:            #E8B15C;   /* buffering, adjusting, linked-but-free */
--stop:            #F2657E;   /* out of sync, leave, destructive */

/* Atmosphere — derived from album art, DECORATIVE ONLY, never carries meaning.
   Vary these per track; they are why every Session looks slightly different. */
--bloom-a:         #C77FA8;
--bloom-b:         #8B5FB0;
--bloom-c:         #4A6BA0;
```

## Type — three faces, three jobs

```html
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Figtree:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
```

| Face | Job | Never |
|---|---|---|
| **Instrument Serif** | Track titles, screen titles, the wordmark. The feeling. | UI controls, labels |
| **Figtree** | All UI text, buttons, body, labels. The reading. | Numbers that measure |
| **IBM Plex Mono** | Timecodes, drift, counts, invite codes. The measurement. | Prose |

```
display     32px / 1.15   Instrument Serif 400      screen + track titles
title       24px / 1.2    Instrument Serif 400
heading     17px / 1.35   Figtree 600
body        16px / 1.5    Figtree 400               floor for readable copy
bodyStrong  16px / 1.5    Figtree 500
label       13.5px / 1.4  Figtree 500
caption     12.5px / 1.4  Figtree 400
mono        11.5px / 1.3  IBM Plex Mono 500   letter-spacing .04em
monoLabel   10px / 1.3    IBM Plex Mono 500   letter-spacing .09em  UPPERCASE
```

## Space, shape

Spacing: **4, 8, 12, 16, 20, 24, 32, 44**
Radius: **6** data chips · **12** controls · **18** cards · **26** sheets · **999** pills

---

## The five signature elements

Every screen must use at least one. They are what make this direction *this* direction.

1. **The bloom.** A large blurred radial gradient in the `--bloom-*` colours sitting behind the
   album art and bleeding upward off the top of the screen.
   `radial-gradient(circle, rgba(199,127,168,.40) 0%, rgba(139,95,176,.22) 42%, transparent 70%)`
   with `filter: blur(30px)`. On screens with no artwork, a much fainter version, or none.

2. **The playhead.** A 1px `--live` vertical line with
   `box-shadow: 0 0 10px rgba(87,226,213,.6)`, running *through* content rather than beside it.
   On the Session screen it crosses every participant row — that is the whole point of the
   direction.

3. **The grid.** 25px hairline grid at `--grid`, on Session and Feed only.
   `linear-gradient(var(--grid) 1px, transparent 1px)` both axes.

4. **Mono readouts.** Every number that measures — `1:47`, `±40ms`, `QUEUE/6`, `4 LISTENING` —
   is IBM Plex Mono. This is the single strongest signal of the direction.

5. **Glass panels.** `--panel` fill, 1px `--hairline` border, radius 18–26. Always over the bloom
   so they tint.

## Non-negotiable

- Minimum **44×44** touch targets, **8px** between adjacent ones.
- Body text **≥16px**. Nothing readable below 12.5px. `--ink-3` is placeholders and dividers only.
- `--live` means live/playing/joinable/in-sync. **Nowhere else.** Not an icon tint, not a
  selected form row, not a success celebration.
- Icons: inline SVG, stroke-based, 1.6 stroke width, 20 or 24px grid. **No emoji.**
- No fake iOS status bar and no fake keyboard — the real ones render on top.
- Screen frame is exactly **375 × 812**.
