import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
const env = Object.fromEntries(readFileSync('.env.local','utf8').split('\n')
  .map(l=>l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)).filter(Boolean).map(m=>[m[1],m[2].trim()]));
const c = createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.EXPO_PUBLIC_SUPABASE_ANON_KEY, { auth:{persistSession:false} });

const time = async (label, fn, n = 8) => {
  const t = [];
  for (let i = 0; i < n; i++) { const s = Date.now(); await fn(); t.push(Date.now() - s); }
  t.sort((a,b)=>a-b);
  console.log(`  ${label.padEnd(30)} min ${String(t[0]).padStart(4)}ms   median ${String(t[Math.floor(n/2)]).padStart(4)}ms   max ${String(t[n-1]).padStart(4)}ms`);
};

console.log('\n  Region: ap-southeast-2 (Sydney). Measuring from this machine.\n');
await time('server_time_ms RPC', () => c.rpc('server_time_ms'));
await time('SELECT on lounges (RLS)', () => c.from('lounges').select('id').limit(1));

// Realtime is what actually governs how fast a play/pause reaches everyone.
const t0 = Date.now();
const ch = c.channel('latency-probe');
await new Promise((res) => ch.subscribe((s) => { if (String(s)==='SUBSCRIBED') res(); }));
console.log(`  ${'realtime channel connect'.padEnd(30)} ${Date.now()-t0}ms`);
await c.removeChannel(ch);
console.log('');
