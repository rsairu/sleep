#!/usr/bin/env node
// Quick-action scenarios: runs the real quick-actions.js render and click paths against a fixed
// app clock, a minimal fake DOM, and a fake Supabase (drafts in, saves recorded).
// Spec: docs/wake-day-key.md (open night, night key) and docs/quick-actions.md.
// Run: npm run test:qa
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath, pathToFileURL } from 'url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
async function makeWorld({ nowLocal, days, drafts }) {
  const fixedMs = nowLocal.getTime();
  const RealDate = Date;
  class FakeDate extends RealDate { constructor(...a) { if (a.length === 0) super(fixedMs); else super(...a); } static now() { return fixedMs; } }
  const ls = {}; const writes = [];
  const mount = { innerHTML: '' };
  const noopEl = () => ({ getAttribute(){ return null; }, style: {}, classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } }, setAttribute(){}, appendChild(){}, removeChild(){}, remove(){}, click(){}, querySelector(){ return null; }, querySelectorAll(){ return []; }, addEventListener(){} });
  const listeners = {};
  mount.contains = () => true;
  const document = { getElementById: id => id === 'dashboard-quick-actions-buttons' ? mount : null, querySelector: () => null, querySelectorAll: () => [], addEventListener(t, f){ (listeners[t] = listeners[t] || []).push(f); }, removeEventListener(){}, createElement: noopEl, body: noopEl(), documentElement: noopEl() };
  const rowOf = d => ({ user_id: 'u', sleep_date: d.date, bed: d.bed || null, sleep_start: d.sleepStart || null, sleep_end: d.sleepEnd || null, bathroom: d.bathroom || [], alarm: d.alarm || [], nap_start: d.nap ? d.nap.start : null, nap_end: d.nap ? d.nap.end : null, waso: 0, labels: [] });
  const json = x => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(x), text: () => Promise.resolve(JSON.stringify(x)) });
  const fetch = (url, opts) => {
    url = String(url);
    if (opts && opts.method === 'POST') { writes.push({ url, body: JSON.parse(opts.body) }); return json({ promoted: false }); }
    if (url.includes('sleep_day_drafts')) {
      const m = url.match(/sleep_date=eq\.([0-9-]+)/);
      const sorted = drafts.slice().sort((a, b) => a.date < b.date ? 1 : -1);
      if (m) return json(sorted.filter(d => d.date === m[1]).map(rowOf));
      return json(sorted.map(rowOf));
    }
    return json([]);
  };
  const c = { console, Math, JSON, Date: FakeDate, Promise, URLSearchParams, fetch, setInterval: () => 0, clearInterval(){}, setTimeout: (f) => 0, clearTimeout(){}, requestAnimationFrame(){},
    localStorage: { getItem: k => k in ls ? ls[k] : null, setItem: (k, v) => { ls[k] = String(v); }, removeItem: k => { delete ls[k]; } },
    sessionStorage: { getItem(){ return null; }, setItem(){}, removeItem(){} },
    document, location: { search: '', hostname: 'restore.example', pathname: '/dashboard' } };
  c.window = c; c.globalThis = c; c.RESTORE_SUPABASE_URL = 'https://x.supabase.co'; c.RESTORE_SUPABASE_ANON_KEY = 'anon';
  vm.createContext(c);
  const { installRoutesData } = await import(pathToFileURL(path.join(ROOT, 'src', 'routes-data.mjs')).href); installRoutesData(c);
  for (const f of ['lib/time-utils', 'lib/i18n', 'lib/sleep-utils', 'lib/nightly', 'routes/quick-actions'])
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', f + '.js'), 'utf8'), c, { filename: f });
  c.showAppToast = () => {}; c.refreshSleepDataStore = () => Promise.resolve(); c.invalidateSleepDataStore = () => {};
  const settle = () => new Promise(r => setImmediate(() => setImmediate(() => setImmediate(r))));
  return {
    c, writes,
    async render() { c.refreshDashboardQuickActions(days, () => Promise.resolve()); for (let i = 0; i < 6; i++) await settle(); return mount.innerHTML; },
    async click(qa) {
      c.initDashboardQuickActions(() => days, () => Promise.resolve());
      const btn = { getAttribute: k => k === 'data-qa' ? qa : null };
      const ev = { target: { closest: () => btn }, preventDefault(){} };
      for (const f of listeners.click || []) { try { f(ev); } catch (_) { /* other modules' document listeners */ } }
      for (let i = 0; i < 8; i++) await settle();
      return writes.map(w => w.body.p_sleep_date + ' ' + JSON.stringify(w.body.p_patch));
    },
    buttons(html) { return [...html.matchAll(/data-qa="([^"]+)"[^>]*>(.*?)<\/button>/g)].map(m => m[1] + (m[2].includes('quick-action-note') ? '+note' : '')); },
  };
}

// Seven completed nights Nov 11–17: natural sleep 23:20, natural wake 07:31.
const hist = [];
for (let i = 0; i < 7; i++) {
  const d = 17 - i;
  hist.push({ date: `2026-11-${String(d).padStart(2, '0')}`, bed: '23:00', sleepStart: '23:20', sleepEnd: i % 2 ? '07:20' : '07:40', alarm: [], bathroom: [], WASO: 0 });
}
const L = (d, h, m) => new Date(2026, 10, d, h, m);
const openNov18 = [{ date: '2026-11-18', bed: '22:50', sleepStart: '23:10' }];

const renders = [
  ['07:30, nothing open (wake phase)', L(18, 7, 30), [], 'wake'],
  ['10:30, open night (179 min past wake)', L(18, 10, 30), openNov18, 'wake'],
  ['10:45, open night (late) → note', L(18, 10, 45), openNov18, 'wake+note, nap-start'],
  ['14:00, open night (mid phase) → note', L(18, 14, 0), openNov18, 'wake+note, nap-start'],
  ['23:45, slept for Nov 19 (draft) → no bed/sleep buttons', L(18, 23, 45),
    [{ date: '2026-11-19', bed: '23:20', sleepStart: '23:40' }, { date: '2026-11-18', bed: '22:50', sleepStart: '23:10', sleepEnd: '07:30' }],
    'bathroom-trip, wake'],
  ['23:30, open night 24h+ after sleep → abandoned', L(18, 23, 30), openNov18, 'bed-now, sleep-0, sleep-10']
];
const saves = [
  ['Wake up 10:45, open night', 'wake', L(18, 10, 45), openNov18, '2026-11-18 {"sleep_end":"10:45"}'],
  ['Wake up 09:45 (past +2h cutover), open night', 'wake', L(18, 9, 45), openNov18, '2026-11-18 {"sleep_end":"09:45"}'],
  ['Wake up 07:30, nothing open', 'wake', L(18, 7, 30), [], '2026-11-18 {"sleep_end":"07:30"}'],
  ['Get in bed 23:10 (new night)', 'bed-now', L(18, 23, 10), [], '2026-11-19 {"bed":"23:10"}'],
  ['Bathroom 03:00, open night Nov 19', 'bathroom-trip', L(19, 3, 0), [{ date: '2026-11-19', bed: '23:20', sleepStart: '23:40' }], '2026-11-19 {"bathroom":["03:00"]}']
];

const failures = [];
let passed = 0;
for (const [name, now, drafts, expected] of renders) {
  const w = await makeWorld({ nowLocal: now, days: hist, drafts });
  const got = w.buttons(await w.render()).join(', ');
  if (got === expected) passed++; else failures.push(`${name}: expected [${expected}], got [${got}]`);
}
for (const [name, qa, now, drafts, expected] of saves) {
  const w = await makeWorld({ nowLocal: now, days: hist, drafts });
  const got = (await w.click(qa)).join(' | ');
  if (got === expected) passed++; else failures.push(`${name}: expected ${expected}, got ${got}`);
}
if (failures.length) {
  console.error(`\n${failures.length} quick-action scenario(s) failed:`);
  failures.forEach((f) => console.error('- ' + f));
  process.exit(1);
}
console.log(`All quick-action scenarios passed (${passed}).`);
