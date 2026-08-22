/**
 * The drift ladder, as the Session draws it.
 *
 * Three rungs, and the only thing that separates them visually is HOW MUCH RED
 * IS LEFT:
 *
 *   ≤ 40ms   LOCKED    accent   — nothing to do
 *   ≤ 220ms  NUDGING   ink      — playback rate is absorbing it at ±2%, inaudible
 *   > 220ms  SEEKING   ink2     — the correction is a hard seek and you hear it
 *
 * Losing sync is shown by LOSING THE RED, never by turning amber. There is no
 * warn colour in this palette, deliberately: an amber "warning" state reads as
 * an error, and being 300ms out is not an error, it is a measurement.
 *
 * NOTE FOR WHOEVER TOUCHES THE SYNC ENGINE NEXT: these are the *presentation*
 * thresholds from the design (README §9 and §"Sync"), and they are one order of
 * magnitude tighter than `Drift.IGNORE` (250ms) and `Drift.SEEK` (1500ms) in
 * `src/playback/types.ts`, which is what `SyncController` actually acts on. The
 * ladder shown here is therefore honest about the *magnitude* but ahead of the
 * controller about the *action* — a listener reading `NUDGING` at 120ms is
 * inside the controller's ignore band. Reconciling the two is a sync-engine
 * change, not a UI one, so it is left alone here and called out in the handoff.
 */

import type { TextStyle } from 'react-native';

import { Type, type Palette } from '@/lib/theme';

/**
 * `Type.readout()` in `src/lib/theme.ts` freezes its `fontVariant` tuple with
 * `as const`, and React Native's `TextStyle` wants a mutable `FontVariant[]`.
 * A readonly tuple anywhere inside a `StyleSheet.create` call makes the whole
 * sheet fall back to `ViewStyle | TextStyle | ImageStyle`, and then EVERY style
 * in that sheet fails to typecheck at its use site — including the plain View
 * ones. Re-stating the array keeps the token and satisfies the type.
 *
 * The real fix is one `as const` removed in the shared theme file, which is
 * outside this pass's remit. Called out in the handoff.
 */
export const readout = (size?: number): TextStyle => ({
  ...Type.readout(size),
  fontVariant: ['tabular-nums'],
});

/** Tabular figures on their own, for a numeral inside a non-readout run. */
export const TABULAR: TextStyle = { fontVariant: ['tabular-nums'] };

/** At or under this, the controller leaves it alone. */
export const DRIFT_LOCKED_MS = 40;
/** Past this, the correction stops being inaudible. */
export const DRIFT_SEEK_MS = 220;
/** Full scale of every drift plot on this screen: ±400ms. */
export const DRIFT_PLOT_MS = 400;

export type DriftRung = 'locked' | 'nudging' | 'seeking';

export function driftRung(driftMs: number): DriftRung {
  const magnitude = Math.abs(driftMs);
  if (magnitude <= DRIFT_LOCKED_MS) return 'locked';
  if (magnitude <= DRIFT_SEEK_MS) return 'nudging';
  return 'seeking';
}

export const RUNG_LABEL: Record<DriftRung, string> = {
  locked: 'LOCKED',
  nudging: 'NUDGING',
  seeking: 'SEEKING',
};

/**
 * The one place the ladder's colour is decided. Accent is reserved for `locked`
 * because that is the only rung that means "in sync" — the other two step down
 * through the neutral ramp rather than across to a second hue.
 */
export function rungColor(rung: DriftRung, colors: Palette): string {
  if (rung === 'locked') return colors.liveText;
  return rung === 'nudging' ? colors.ink : colors.ink2;
}

/**
 * U+2212 MINUS SIGN, not a hyphen. It is the same width as a digit in a tabular
 * face, so `−412ms` and `+412ms` occupy identical space and a ticking readout
 * does not jitter. Archivo carries it (GF Latin Core), unlike the arrows and
 * transport glyphs — those are Lucide icons everywhere in this design.
 */
const MINUS = '−';

/** Signed, tabular, always in ms: the unit the sync engine actually measures in. */
export function formatDrift(driftMs: number): string {
  const rounded = Math.round(driftMs);
  return `${rounded < 0 ? MINUS : '+'}${Math.abs(rounded)}ms`;
}

/** Same signing, for the clock offset readout. */
export const formatOffset = formatDrift;

/** `1:44`. Never negative; a position before zero is a bug, not a display case. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${(total % 60).toString().padStart(2, '0')}`;
}

/** `−1:44` — time left, which is a countdown and therefore signed. */
export function formatRemaining(ms: number): string {
  return `${MINUS}${formatClock(ms)}`;
}

/**
 * Album art, avatars and every other well in this design are typographic
 * placeholders: one letter in a ruled box. Real artwork drops straight over it.
 */
export function initialFor(text: string | null | undefined): string {
  const trimmed = (text ?? '').trim();
  return trimmed.length > 0 ? trimmed[0].toUpperCase() : '?';
}

/** First name only — the drift chart's name column is 46px wide. */
export function firstNameOf(name: string): string {
  const first = name.trim().split(/\s+/)[0];
  return first && first.length > 0 ? first : name;
}
