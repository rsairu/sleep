/**
 * Import local sleep-data.json into Supabase table sleep_days.
 *
 * Usage:
 *   SUPABASE_URL="https://project.supabase.co" SUPABASE_ANON_KEY="..." node supabase/migrate-json-to-supabase.js
 */
const fs = require('fs');
const path = require('path');

const dataPath = path.join(__dirname, '..', 'sleep-data.json');
const supabaseUrl = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const supabaseAnonKey = (process.env.SUPABASE_ANON_KEY || '').trim();

function mapDayToRow(day) {
  return {
    date_md: day.date,
    bed: day.bed,
    sleep_start: day.sleepStart,
    sleep_end: day.sleepEnd,
    bathroom: Array.isArray(day.bathroom) ? day.bathroom : [],
    alarm: Array.isArray(day.alarm) ? day.alarm : [],
    nap_start: day.nap && day.nap.start ? day.nap.start : null,
    nap_end: day.nap && day.nap.end ? day.nap.end : null,
    waso: Number.isFinite(day.WASO) ? day.WASO : 0
  };
}

async function main() {
  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variable.');
    process.exit(1);
  }

  const raw = fs.readFileSync(dataPath, 'utf8');
  const parsed = JSON.parse(raw);
  const days = Array.isArray(parsed.days) ? parsed.days : [];
  const rows = days.map(mapDayToRow);

  const res = await fetch(supabaseUrl + '/rest/v1/sleep_days?on_conflict=date_md', {
    method: 'POST',
    headers: {
      apikey: supabaseAnonKey,
      Authorization: 'Bearer ' + supabaseAnonKey,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates'
    },
    body: JSON.stringify(rows)
  });

  if (!res.ok) {
    const body = await res.text();
    console.error('Migration failed:', res.status, body);
    process.exit(1);
  }

  console.log('Migrated', rows.length, 'rows to Supabase.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
