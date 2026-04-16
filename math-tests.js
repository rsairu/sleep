#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadSleepUtils() {
  const filePath = path.join(__dirname, 'sleep-utils.js');
  const code = fs.readFileSync(filePath, 'utf8');
  const context = {
    console,
    Math,
    Date,
    JSON,
    setInterval: () => {},
    clearInterval: () => {},
    window: undefined
  };
  vm.createContext(context);
  vm.runInContext(code, context, { filename: 'sleep-utils.js' });
  const aggPath = path.join(__dirname, 'stats-aggregates.js');
  vm.runInContext(fs.readFileSync(aggPath, 'utf8'), context, { filename: 'stats-aggregates.js' });
  return context;
}

function runTests() {
  const u = loadSleepUtils();
  const failures = [];
  let passed = 0;

  function expectEqual(actual, expected, label) {
    if (actual !== expected) {
      failures.push(`${label}: expected ${expected}, got ${actual}`);
      return;
    }
    passed += 1;
  }

  function expectTruthy(value, label) {
    if (!value) {
      failures.push(`${label}: expected truthy, got ${value}`);
      return;
    }
    passed += 1;
  }

  // Core rollover + conversion math
  expectEqual(u.timeToMinutes('00:00'), 0, 'timeToMinutes midnight');
  expectEqual(u.timeToMinutes('23:59'), 1439, 'timeToMinutes late night');
  expectEqual(u.timeToMinutes('11:00 PM'), 23 * 60, 'timeToMinutes 11 PM');
  expectEqual(u.timeToMinutes('10:40 PM'), 22 * 60 + 40, 'timeToMinutes 12h with space');
  expectEqual(u.timeToMinutes('12:00 AM'), 0, 'timeToMinutes midnight 12h');
  expectEqual(u.timeToMinutes('12:30 PM'), 12 * 60 + 30, 'timeToMinutes noon 12h');
  expectEqual(u.normalizeTimeStringForSupabase('10:40 PM'), '22:40', 'normalizeTimeStringForSupabase 12h');
  expectEqual(u.normalizeTimeStringForSupabase('22:45'), '22:45', 'normalizeTimeStringForSupabase already 24h');
  expectEqual(u.durationMinutes(23 * 60 + 30, 7 * 60 + 15), 465, 'durationMinutes crosses midnight');
  expectEqual(u.durationMinutes(9 * 60, 17 * 60), 480, 'durationMinutes same day');
  expectEqual(u.modMinutes1440(-1), 1439, 'modMinutes1440 negative input');
  expectEqual(u.modMinutes1440(1445), 5, 'modMinutes1440 overflow input');

  expectEqual(
    JSON.stringify(u.normalizeSleepDayLabels(['🍺', '👶', 'nope'])),
    JSON.stringify(['👶', '🍺']),
    'normalizeSleepDayLabels filters and orders'
  );

  // Sleep totals + nap handling
  const napCrossingMidnightDay = {
    sleepStart: '23:30',
    sleepEnd: '07:00',
    nap: { start: '23:50', end: '00:10' }
  };
  expectEqual(u.calculateTotalSleep(napCrossingMidnightDay), 470, 'calculateTotalSleep with crossing nap');

  // Signed and unsigned alarm behavior
  const normalAlarmDay = { alarm: ['07:00'], sleepEnd: '07:25' };
  expectEqual(u.calculateFirstAlarmToWake(normalAlarmDay), 25, 'signed alarm delta positive');
  expectEqual(u.calculateWakeDelay(normalAlarmDay), 25, 'wake delay positive');

  const negativeSignedAlarmDay = { alarm: ['07:05'], sleepEnd: '07:04' };
  expectEqual(u.calculateFirstAlarmToWake(negativeSignedAlarmDay), -1, 'signed alarm delta negative preserved');
  expectEqual(u.calculateWakeDelay(negativeSignedAlarmDay), null, 'wake delay rejects negative morning ordering');

  const eveningAlarmRollDay = { alarm: ['23:50'], sleepEnd: '00:20' };
  expectEqual(u.calculateFirstAlarmToWake(eveningAlarmRollDay), -1410, 'signed alarm delta raw overnight');
  expectEqual(u.calculateWakeDelay(eveningAlarmRollDay), 30, 'wake delay rolls over for evening alarms');

  const wakeAtAlarmDay = { alarm: ['07:00'], sleepEnd: '07:00' };
  expectEqual(u.calculateFirstAlarmToWake(wakeAtAlarmDay), 0, 'signed alarm delta zero at wake');
  expectEqual(u.calculateWakeDelay(wakeAtAlarmDay), 0, 'wake delay zero when wake at first alarm');

  // Delay + uninterrupted calculations
  const bedDelayDay = { bed: '23:50', sleepStart: '00:20' };
  expectEqual(u.calculateSleepDelay(bedDelayDay), 30, 'bed to sleep delay across midnight');

  const interruptionsDay = {
    sleepStart: '23:00',
    sleepEnd: '07:00',
    alarm: ['01:00', '04:00']
  };
  expectEqual(u.calculateLongestUninterrupted(interruptionsDay), 180, 'longest uninterrupted span');

  expectEqual(u.isNaturalWakeDay({ alarm: [], sleepEnd: '07:00' }), true, 'isNaturalWakeDay no alarms');
  expectEqual(u.isNaturalWakeDay(normalAlarmDay), false, 'isNaturalWakeDay after single alarm');
  expectEqual(u.isNaturalWakeDay(negativeSignedAlarmDay), true, 'isNaturalWakeDay before single alarm');
  expectEqual(u.isNaturalWakeDay({ alarm: ['07:00'], sleepEnd: '07:00' }), false, 'isNaturalWakeDay wake at alarm (delta 0)');
  expectEqual(u.isNaturalWakeDay(interruptionsDay), false, 'isNaturalWakeDay multi-alarm');
  expectEqual(u.isNaturalWakeDay(eveningAlarmRollDay), true, 'isNaturalWakeDay single alarm negative delta overnight');

  // Averaging normalization around midnight
  const normalizedAvg = Math.round(
    (u.normalizeTimeForAveraging(u.timeToMinutes('23:50')) +
      u.normalizeTimeForAveraging(u.timeToMinutes('00:10'))) / 2
  );
  expectEqual(u.denormalizeTimeForAveraging(normalizedAvg), 0, 'average of 23:50 and 00:10 is 00:00');

  const lateNightToAfternoonWakeStart = u.timeToMinutes('23:10');
  const lateNightToAfternoonWakeEnd = u.timeToMinutes('13:10');
  expectEqual(
    u.normalizeWakeTimeForAveraging(lateNightToAfternoonWakeStart, lateNightToAfternoonWakeEnd),
    lateNightToAfternoonWakeEnd + 1440,
    'afternoon wake after evening sleep is later than morning wake on averaging scale'
  );
  expectEqual(
    u.normalizeWakeTimeForAveraging(lateNightToAfternoonWakeStart, u.timeToMinutes('07:13')) >
      u.normalizeWakeTimeForAveraging(lateNightToAfternoonWakeStart, lateNightToAfternoonWakeEnd),
    false,
    '1:10 PM wake sorts after 7:13 AM wake when paired with same sleep start'
  );

  // Remaining wake basis and conversion
  const basisDays = [
    { sleepStart: '23:00', sleepEnd: '07:00' },
    { sleepStart: '23:00', sleepEnd: '07:00' },
    { sleepStart: '23:00', sleepEnd: '07:00' }
  ];
  const basis = u.computeRecentSevenDayWakeBasis(basisDays);
  expectTruthy(basis, 'computeRecentSevenDayWakeBasis returns basis');
  expectEqual(basis.avgSleepStart, 1380, 'basis avg sleep start');
  expectEqual(basis.avgSleepEnd, 420, 'basis avg wake end');
  expectEqual(basis.totalWakeMins, 960, 'basis total wake minutes');
  expectEqual(u.wakePercentToClockMinutes(basis, 50), 900, 'wakePercentToClockMinutes 50 percent');

  // Projection window wrap behavior near midnight
  const sleepTargetNearMidnight = 10; // 00:10
  const low = u.modMinutes1440(sleepTargetNearMidnight - 30);
  const high = u.modMinutes1440(sleepTargetNearMidnight + 30);
  expectEqual(low, 1420, 'projection lower bound wraps to previous day');
  expectEqual(high, 40, 'projection upper bound wraps forward');

  // Wake record date: finish prior wake-day row when clock rolls to next calendar morning
  const avgWake = 7 * 60;
  const wakeDays = [
    { date: '2026-04-08', bed: '23:00', sleepStart: '23:30', sleepEnd: '07:00' },
    { date: '2026-04-07', bed: '22:10', sleepStart: '23:05', sleepEnd: '07:00' }
  ];
  const apr8Morning = new Date(2026, 3, 8, 8, 0, 0, 0);
  expectEqual(
    u.resolveRecordDateMdForWake(apr8Morning, avgWake, wakeDays),
    '2026-04-07',
    'resolveRecordDateMdForWake prefers prior day open night in early-morning band'
  );
  const apr8Afternoon = new Date(2026, 3, 8, 14, 0, 0, 0);
  expectEqual(
    u.resolveRecordDateMdForWake(apr8Afternoon, avgWake, wakeDays),
    '2026-04-09',
    'resolveRecordDateMdForWake uses sleep-period key outside early-morning band'
  );

  // stats-aggregates: mid-sleep geometry (must match stats.js)
  const SA = u.StatsAggregates;
  expectTruthy(SA, 'StatsAggregates is attached');
  expectEqual(SA.perNightMidSleepClockMinutes({ sleepStart: '23:00', sleepEnd: '07:00' }), 180, 'mid-sleep overnight wrap → 03:00');
  expectEqual(SA.perNightMidSleepClockMinutes({ sleepStart: '01:00', sleepEnd: '08:30' }), 285, 'mid-sleep same segment → 04:45');
  expectEqual(SA.perNightMidSleepClockMinutes({ sleepStart: '22:30', sleepEnd: '06:15' }), 143, 'mid-sleep 22:30–06:15 → 02:23');
  const midAvgTwo = SA.averageMidSleepClockMinutes([
    { sleepStart: '23:00', sleepEnd: '07:00' },
    { sleepStart: '00:15', sleepEnd: '07:45' }
  ]);
  expectEqual(midAvgTwo, 210, 'average mid-sleep nights 03:00 + 04:00 → 03:30 (normalize path)');

  expectEqual(SA.isScheduledDay({ date: '2026-01-05' }), true, 'isScheduledDay Mon non-holiday');
  expectEqual(SA.isScheduledDay({ date: '2026-01-03' }), false, 'isScheduledDay Saturday');
  expectEqual(SA.isScheduledDay({ date: '2026-01-01' }), false, 'isScheduledDay New Year holiday');

  const social = SA.socialLagMinutes(
    [{ sleepStart: '00:00', sleepEnd: '08:00' }],
    [{ sleepStart: '02:00', sleepEnd: '08:30' }]
  );
  expectEqual(social, 75, 'social lag |05:15 − 04:00| = 75 min on shortest arc');

  const wakeLag = SA.wakeLagMinutes([
    { sleepStart: '23:00', sleepEnd: '07:30', alarm: [] },
    { sleepStart: '23:00', sleepEnd: '07:00', alarm: ['06:40'] }
  ]);
  expectEqual(wakeLag, 30, 'wake lag natural 07:30 vs alarm-assisted 07:00 → +30 min');

  const filtered7 = SA.filterDaysByPeriod(
    [
      { date: '2026-04-10', sleepStart: '23:00', sleepEnd: '07:00' },
      { date: '2026-04-01', sleepStart: '23:00', sleepEnd: '07:00' }
    ],
    '7',
    new Date(2026, 3, 10)
  );
  expectEqual(filtered7.length, 1, 'filterDaysByPeriod 7-day window inclusive end');

  // Dataset invariants on current data (guardrails for regressions)
  const dataPath = path.join(__dirname, 'data', 'sleep-data.json');
  if (fs.existsSync(dataPath)) {
    const days = JSON.parse(fs.readFileSync(dataPath, 'utf8')).days || [];
    if (process.env.STATS_MID_VERIFY === '1' && u.StatsAggregates) {
      let n = 0;
      for (let i = 0; i < days.length && n < 5; i++) {
        const d = days[i];
        if (!d || !d.sleepStart || !d.sleepEnd) continue;
        const m = u.StatsAggregates.perNightMidSleepClockMinutes(d);
        if (m === null) continue;
        const hh = String(Math.floor(m / 60)).padStart(2, '0');
        const mm = String(m % 60).padStart(2, '0');
        console.log(
          '[STATS_MID_VERIFY] ' +
            d.date +
            ' sleepStart=' +
            d.sleepStart +
            ' sleepEnd=' +
            d.sleepEnd +
            ' → midClock=' +
            m +
            ' min (' +
            hh +
            ':' +
            mm +
            ')'
        );
        n++;
      }
    }
    days.forEach((d, idx) => {
      const wakeDelay = u.calculateWakeDelay(d);
      if (wakeDelay !== null && wakeDelay < 0) {
        failures.push(`dataset invariant day ${idx} (${d.date}): wakeDelay must be >= 0 or null`);
      } else {
        passed += 1;
      }
      const delta = u.calculateFirstAlarmToWake(d);
      if (delta !== null && !Number.isFinite(delta)) {
        failures.push(`dataset invariant day ${idx} (${d.date}): signed alarm delta must be finite`);
      } else {
        passed += 1;
      }
      if (typeof d.WASO !== 'number' || !Number.isFinite(d.WASO) || d.WASO < 0 || d.WASO !== Math.floor(d.WASO)) {
        failures.push(`dataset invariant day ${idx} (${d.date}): WASO must be a non-negative integer`);
      } else {
        passed += 1;
      }
    });
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} test(s) failed:`);
    failures.forEach((f) => console.error(`- ${f}`));
    process.exit(1);
  }

  console.log(`All math tests passed (${passed} checks).`);
}

runTests();
