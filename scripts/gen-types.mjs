/**
 * Regenerates src/lib/database.types.ts from the live schema WITHOUT losing the
 * hand-written alias block at the bottom.
 *
 *   node scripts/gen-types.mjs
 *
 * `supabase gen types` overwrites the file wholesale, and 19 files import the
 * aliases rather than the raw `Tables<'...'>` helper — so a plain regeneration
 * breaks the build. This lifts the alias block off the existing file first and
 * puts it back afterwards, which also means the aliases can never drift from
 * whatever is currently committed.
 *
 * Requires SUPABASE_ACCESS_TOKEN in the environment.
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const TYPES_PATH = 'src/lib/database.types.ts';
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF ?? 'atdusjfidswqrkuefgvr';

/** The first line of the banner that opens the hand-written half. */
const MARKER = 'Aux convenience aliases.';

const current = readFileSync(TYPES_PATH, 'utf8');
const lines = current.split('\n');
const markerAt = lines.findIndex((line) => line.includes(MARKER));

if (markerAt === -1) {
  console.error(`Could not find the "${MARKER}" banner in ${TYPES_PATH}.`);
  console.error('Refusing to regenerate — doing so would silently drop the aliases.');
  process.exit(1);
}

// The banner's rule line sits directly above the marker; keep it with the block.
const aliases = lines.slice(markerAt - 1).join('\n');

console.log(`Preserving ${lines.length - markerAt + 1} lines of aliases.`);

// The ref reaches a shell on Windows (Node refuses to spawn a .cmd otherwise),
// so it is checked against the format Supabase actually issues rather than
// trusted. Anything else is a typo or an injection attempt; both stop here.
if (!/^[a-z]{20}$/.test(PROJECT_REF)) {
  console.error(`SUPABASE_PROJECT_REF "${PROJECT_REF}" is not a valid project ref.`);
  process.exit(1);
}

const command = `npx supabase gen types typescript --project-id ${PROJECT_REF}`;

const generated = execSync(command, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

if (!generated.includes('export type Database')) {
  console.error('Generation produced no Database type — leaving the file untouched.');
  process.exit(1);
}

writeFileSync(TYPES_PATH, `${generated.trimEnd()}\n\n${aliases}`);
console.log(`Wrote ${TYPES_PATH}.`);
