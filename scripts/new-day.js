/**
 * Prepends a new day to sleep-data.json (newest-first order).
 * Run: node scripts/new-day.js   or   make new-day
 */
const fs = require('fs');
const path = require('path');

const dataPath = path.join(__dirname, '..', 'sleep-data.json');

function parseMD(s) {
  const [m, d] = s.split('/').map(Number);
  if (!m || !d) throw new Error(`Bad date string: ${s}`);
  return { m, d };
}

function formatMD(date) {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function nextDateString(latestMd) {
  const { m, d } = parseMD(latestMd);
  const y = new Date().getFullYear();
  const next = new Date(y, m - 1, d);
  next.setDate(next.getDate() + 1);
  return formatMD(next);
}

function templateFromPrevious(prev) {
  if (!prev) {
    return {
      bed: '22:30',
      sleepStart: '22:45',
      sleepEnd: '7:00',
      bathroom: [],
      alarm: [],
      sick: [],
      nap: null
    };
  }
  return {
    bed: prev.bed,
    sleepStart: prev.sleepStart,
    sleepEnd: prev.sleepEnd,
    bathroom: [...(prev.bathroom || [])],
    alarm: [...(prev.alarm || [])],
    sick: [],
    nap: null
  };
}

function main() {
  const raw = fs.readFileSync(dataPath, 'utf8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data.days)) {
    console.error('sleep-data.json: expected top-level { days: [...] }');
    process.exit(1);
  }

  const days = data.days;
  let dateStr;
  if (days.length === 0) {
    dateStr = formatMD(new Date());
  } else {
    dateStr = nextDateString(days[0].date);
  }

  if (days.length && days[0].date === dateStr) {
    console.error(`Latest entry is already ${dateStr}. Nothing to add.`);
    process.exit(1);
  }

  const entry = { date: dateStr, ...templateFromPrevious(days[0]) };
  days.unshift(entry);

  const out = JSON.stringify(data, null, 2) + '\n';
  fs.writeFileSync(dataPath, out, 'utf8');
  console.log(`Added ${dateStr} at the top of days (edit ${path.basename(dataPath)} to fill in).`);
}

main();
