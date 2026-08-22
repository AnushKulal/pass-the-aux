/**
 * Proves a Supabase project is actually wired up correctly.
 *
 *   node scripts/verify-backend.mjs
 *
 * Reads EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY from .env.local.
 * Uses ONLY the anon key — the same credential the app ships with — so what it
 * proves is what a real client would actually experience, including RLS.
 */

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

// --------------------------------------------------------------- env
function readEnv() {
  let raw;
  try {
    raw = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
  } catch {
    fail('.env.local not found. Copy .env.example and fill in your project values.');
  }
  const env = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

function fail(msg) {
  console.error(`\n  FAILED  ${msg}\n`);
  process.exit(1);
}

const env = readEnv();
const url = env.EXPO_PUBLIC_SUPABASE_URL;
const key = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !key) fail('EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY missing from .env.local');
if (url.includes('placeholder') || key.includes('placeholder')) {
  fail('.env.local still holds placeholder values — paste your real project URL and anon key.');
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

const results = [];
const check = async (name, fn) => {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
  } catch (e) {
    results.push({ name, ok: false, detail: e.message });
  }
};

// --------------------------------------------------------------- checks
await check('Project reachable', async () => {
  const { error } = await supabase.from('lounges').select('id').limit(1);
  // An RLS denial still proves we reached Postgres. Only a transport error is fatal.
  if (error && /fetch|network|ENOTFOUND|ECONN/i.test(error.message)) throw new Error(error.message);
  return new URL(url).host;
});

/**
 * A table that does not exist and a table RLS is hiding look similar from the
 * client, and getting that backwards turns "you have no schema" into a green
 * tick. PostgREST distinguishes them:
 *   PGRST205 / 42P01  — the table is not in the schema cache: it does NOT exist
 *   PGRST301 / 42501  — the table exists and policy refused the read
 *   no error, 0 rows  — the table exists and policy returned nothing
 */
const TABLE_MISSING = (error) =>
  !!error && (error.code === 'PGRST205' || error.code === '42P01' ||
              /could not find the table|does not exist|schema cache/i.test(error.message));

await check('Schema applied — tables exist', async () => {
  const tables = ['profiles', 'lounges', 'lounge_members', 'tracks', 'track_links', 'rooms',
                  'room_participants', 'queue_items', 'messages', 'reactions', 'sync_metrics'];
  const missing = [];
  for (const t of tables) {
    const { error } = await supabase.from(t).select('*').limit(0);
    if (TABLE_MISSING(error)) missing.push(t);
  }
  if (missing.length === tables.length) {
    throw new Error('none of them exist — the migrations have not been run yet');
  }
  if (missing.length) throw new Error(`missing: ${missing.join(', ')}`);
  return `all ${tables.length} present`;
});

await check('Clock RPC works (the sync engine depends on it)', async () => {
  /**
   * A single reading conflates two different things: how wrong this device's
   * clock is, and how long the request took. Separate them the way the app does
   * — sample repeatedly, keep the reading with the lowest round-trip, and assume
   * that request's latency was symmetric. The naive one-shot number is reported
   * alongside so the difference is visible.
   */
  const samples = [];
  for (let i = 0; i < 7; i++) {
    const t0 = Date.now();
    const { data, error } = await supabase.rpc('server_time_ms');
    const t1 = Date.now();
    if (error) throw new Error(error.message);
    samples.push({ rtt: t1 - t0, offset: Number(data) - (t0 + (t1 - t0) / 2) });
  }
  const best = samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
  const naive = samples[0].offset + samples[0].rtt / 2;
  const dir = best.offset > 0 ? 'behind' : 'ahead of';

  return `this machine is ${Math.abs(Math.round(best.offset))}ms ${dir} the database ` +
         `(best RTT ${best.rtt}ms of ${samples.length} samples; a naive single read would have ` +
         `said ${Math.abs(Math.round(naive))}ms)`;
});

await check('Playback RPCs exist', async () => {
  // PostgREST resolves an RPC by NAME **AND ARGUMENT NAMES**. Calling with `{}`
  // asks for a zero-arg overload, so a function that takes parameters reports
  // "could not find ... without parameters" — which reads as missing when it is
  // merely being called wrong. Pass each real signature with throwaway values;
  // a permission or not-found error is still proof the function is there.
  const NIL = '00000000-0000-0000-0000-000000000000';
  const rpcs = [
    ['room_play',           { p_room_id: NIL, p_track_id: NIL, p_position_ms: 0 }],
    ['room_pause',          { p_room_id: NIL }],
    ['room_resume',         { p_room_id: NIL }],
    ['room_seek',           { p_room_id: NIL, p_position_ms: 0 }],
    ['room_advance',        { p_room_id: NIL }],
    ['queue_append',        { p_room_id: NIL, p_track_id: NIL }],
    ['join_lounge_by_code', { p_code: '__verify__' }],
  ];
  const missing = [];
  for (const [fn, args] of rpcs) {
    const { error } = await supabase.rpc(fn, args);
    if (error && (error.code === 'PGRST202' || /could not find the function/i.test(error.message))) {
      missing.push(fn);
    }
  }
  if (missing.length) throw new Error(`missing: ${missing.join(', ')}`);
  return `all ${rpcs.length} present and correctly signed`;
});

await check('RLS is ON — anonymous cannot read lounges', async () => {
  const { data, error } = await supabase.from('lounges').select('id');
  // A missing table is not proof of anything. Say so instead of scoring a pass.
  if (TABLE_MISSING(error)) throw new Error('cannot tell — the lounges table does not exist yet');
  if (error) return `policy refused the read (${error.code || 'error'}) — correct`;
  if (data && data.length > 0) {
    throw new Error(`anonymous read returned ${data.length} row(s) — RLS is NOT protecting this table`);
  }
  return 'exists, returns 0 rows to anonymous — correct';
});

await check('Spotify tokens are unreachable from any client', async () => {
  const { data, error } = await supabase.from('provider_tokens').select('*');
  if (TABLE_MISSING(error)) throw new Error('cannot tell — provider_tokens does not exist yet');
  if (data && data.length > 0) throw new Error('provider_tokens returned rows to an anon client');
  return error ? `policy refused the read (${error.code || 'error'}) — correct` : 'returns 0 rows — correct';
});

await check('Edge Functions deployed', async () => {
  const names = ['search-tracks', 'resolve-track', 'spotify-api', 'spotify-auth'];
  const found = [];
  for (const n of names) {
    const res = await fetch(`${url}/functions/v1/${n}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` },
      body: '{}',
    }).catch(() => null);
    // 404 from the gateway means not deployed. Any other status means it answered.
    if (res && res.status !== 404) found.push(n);
  }
  if (found.length === 0) throw new Error('none deployed yet (this is expected before you deploy them)');
  if (found.length < names.length) {
    throw new Error(`only ${found.join(', ')} — missing ${names.filter((n) => !found.includes(n)).join(', ')}`);
  }
  return `all ${names.length} responding`;
});

// --------------------------------------------------------------- report
console.log('');
for (const r of results) {
  console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`);
  console.log(`        ${r.detail}`);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n  ${results.length - failed}/${results.length} passed\n`);
process.exit(failed ? 1 : 0);
