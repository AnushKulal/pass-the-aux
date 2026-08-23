/**
 * Parses every migration with libpg_query — the same parser Postgres itself
 * uses — so a syntax error is caught before it reaches a database.
 *
 *   node scripts/check-sql.mjs supabase/migrations
 *
 * Exits non-zero if any file fails. Note the parser's WASM module trips a libuv
 * assertion on process teardown under Windows, which corrupts the exit code
 * there; the summary line is authoritative locally, the exit code in CI.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { parse } from 'pgsql-parser';

const dir = process.argv[2] ?? 'supabase/migrations';
let failed = 0;

for (const file of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
  const sql = readFileSync(`${dir}/${file}`, 'utf8');
  try {
    const ast = await parse(sql);
    const count = Array.isArray(ast) ? ast.length : (ast?.stmts?.length ?? '?');
    console.log(`OK   ${file}  (${count} statements)`);
  } catch (error) {
    failed++;
    console.log(`FAIL ${file}: ${error.message}`);
    if (error.cursorPosition) {
      const line = sql.slice(0, error.cursorPosition).split('\n').length;
      console.log(`     near line ${line}`);
    }
  }
}

console.log(failed ? `\n${failed} file(s) failed to parse` : '\nall migrations parse');
process.exitCode = failed ? 1 : 0;
