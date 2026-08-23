/**
 * Deciding which patch notes an update should announce.
 *
 * Kept apart from the prompt that renders it, and free of any import, because
 * this is the part with actual rules in it — which entries count as "newer",
 * what happens to a manifest that predates the changelog, how the cap falls —
 * and that is worth being able to test without a device or a React tree.
 *
 * See `src/components/shell/update-prompt.tsx` for why the notes travel inside
 * the manifest at all.
 */

/**
 * Past this the sheet stops being a prompt and becomes a changelog.
 *
 * Anything beyond is counted rather than listed — someone twelve patches behind
 * needs to know the update is substantial, not read all of it on a dialog.
 */
export const MAX_NOTES = 5;

export type Pending = {
  /** Notes to show, newest patch first, already capped at MAX_NOTES. */
  notes: string[];
  /** How many patches this update spans. Drives the heading. */
  patchCount: number;
  /** Notes that did not fit, so the sheet can say "+N more". */
  hidden: number;
};

export const NOTHING_PENDING: Pending = { notes: [], patchCount: 0, hidden: 0 };

/** Read a property without asserting the shape of anything above it. */
export function at(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function toNotes(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((note): note is string => typeof note === 'string' && note.trim().length > 0)
    : [];
}

/**
 * Everything fixed between the running bundle and the one on offer.
 *
 * Every level is checked rather than cast through, because this reads a document
 * fetched over the network: a manifest from an older publish will not have these
 * keys, and that has to degrade to "no notes" rather than throw inside the update
 * check and silently disable updating altogether.
 *
 * `currentPatch` of 0 is the useful default for a bundle with no patch number —
 * it predates the changelog, so it is older than every entry and its user sees
 * the whole history rather than nothing.
 */
export function readPendingNotes(manifest: unknown, currentPatch: number): Pending {
  const extra = at(at(at(manifest, 'extra'), 'expoClient'), 'extra');
  const changelog = at(extra, 'changelog');

  if (Array.isArray(changelog)) {
    const newer = changelog
      .map((entry) => ({ patch: at(entry, 'patch'), notes: toNotes(at(entry, 'notes')) }))
      .filter(
        (entry): entry is { patch: number; notes: string[] } =>
          typeof entry.patch === 'number' && entry.patch > currentPatch && entry.notes.length > 0
      )
      // Newest first, so the cap drops the oldest fixes rather than the newest.
      .sort((a, b) => b.patch - a.patch);

    const all = newer.flatMap((entry) => entry.notes);

    return {
      notes: all.slice(0, MAX_NOTES),
      patchCount: newer.length,
      hidden: Math.max(0, all.length - MAX_NOTES),
    };
  }

  /*
    Publishes that predate the changelog carried one flat list for one update.

    app.json still mirrors the newest patch into `extra.releaseNotes` for the
    same reason in reverse: a device running one of those older bundles reads
    THAT key, and dropping it would leave those users staring at a prompt with
    no notes — which is precisely the failure this whole feature exists to fix.
    Keep the mirror in step with the top changelog entry.
  */
  const flat = toNotes(at(extra, 'releaseNotes'));
  if (flat.length === 0) return NOTHING_PENDING;

  return {
    notes: flat.slice(0, MAX_NOTES),
    patchCount: 1,
    hidden: Math.max(0, flat.length - MAX_NOTES),
  };
}
