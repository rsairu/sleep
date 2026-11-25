#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { pathToFileURL } = require('url');

async function loadSleepUtils() {
  const filePath = path.join(__dirname, '..', 'src', 'lib', 'sleep-utils.js');
  const code = fs.readFileSync(filePath, 'utf8');
  const lsStore = Object.create(null);
  const context = {
    console,
    Math,
    Date,
    JSON,
    fetch: () => Promise.resolve({ ok: false }),
    setInterval: () => {},
    clearInterval: () => {},
    localStorage: {
      getItem(k) {
        return Object.prototype.hasOwnProperty.call(lsStore, k) ? lsStore[k] : null;
      },
      setItem(k, v) {
        lsStore[k] = String(v);
      },
      removeItem(k) {
        delete lsStore[k];
      }
    }
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  const { installRoutesData } = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'routes-data.mjs')));
  installRoutesData(context);
  const timeUtilsPath = path.join(__dirname, '..', 'src', 'lib', 'time-utils.js');
  vm.runInContext(fs.readFileSync(timeUtilsPath, 'utf8'), context, { filename: 'src/lib/time-utils.js' });
  // Same load order as index.html: time-utils → i18n → sleep-utils (sleep-utils reads LANGUAGE_KEY etc. from i18n).
  const i18nPath = path.join(__dirname, '..', 'src', 'lib', 'i18n.js');
  vm.runInContext(fs.readFileSync(i18nPath, 'utf8'), context, { filename: 'src/lib/i18n.js' });
  vm.runInContext(code, context, { filename: 'src/lib/sleep-utils.js' });
  const aggPath = path.join(__dirname, '..', 'src', 'lib', 'stats-aggregates.js');
  vm.runInContext(fs.readFileSync(aggPath, 'utf8'), context, { filename: 'src/lib/stats-aggregates.js' });
  // nightly.js: averages + deviation-flag math (no `document` in this context, so its DOM init is skipped).
  const nightlyPath = path.join(__dirname, '..', 'src', 'lib', 'nightly.js');
  vm.runInContext(fs.readFileSync(nightlyPath, 'utf8'), context, { filename: 'src/lib/nightly.js' });
  // stats.js: Stats page aggregates (columnExtras, calculateMonthlyAverages); DOM code only runs on mount.
  const statsPath = path.join(__dirname, '..', 'src', 'routes', 'stats.js');
  vm.runInContext(fs.readFileSync(statsPath, 'utf8'), context, { filename: 'src/routes/stats.js' });
  return context;
}

async function runTests() {
  const u = await loadSleepUtils();
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

  expectEqual(u.normalizeSleepDateKey('2026-03-15'), '2026-03-15', 'normalizeSleepDateKey ISO passthrough');
  expectEqual(u.normalizeSleepDateKey('  2026-03-15  '), '2026-03-15', 'normalizeSleepDateKey trims ISO');
  expectEqual(u.normalizeSleepDateKey('3/15/2026'), '', 'normalizeSleepDateKey rejects M/D');
  expectEqual(u.normalizeSleepDateKey('2026-13-40'), '', 'normalizeSleepDateKey rejects invalid calendar');

  // Sleep totals + nap handling
  const napCrossingMidnightDay = {
    sleepStart: '23:30',
    sleepEnd: '07:00',
    nap: { start: '23:50', end: '00:10' }
  };
  expectEqual(u.calculateTotalSleep(napCrossingMidnightDay), 470, 'calculateTotalSleep with crossing nap');

  // Wake classification and lags (docs/wake-and-lags.md). All alarm math is anchored to sleep start.
  const wl = (day) => u.classifyWake(day);
  const wlCase = (label, day, natural, lag, firstAlarm) => {
    const r = wl(day);
    expectEqual(r.natural, natural, `classifyWake ${label}: natural`);
    expectEqual(r.wakeLagMin, lag, `classifyWake ${label}: wakeLagMin`);
    if (firstAlarm !== undefined) expectEqual(r.firstAlarm, firstAlarm, `classifyWake ${label}: firstAlarm`);
    expectEqual(u.wakeLagMin(day), lag, `wakeLagMin ${label}`);
  };
  wlCase('11/20', { sleepStart: '00:39', sleepEnd: '09:33', alarm: ['09:42'] }, true, -9, '09:42');
  wlCase('1 min early', { sleepStart: '23:00', sleepEnd: '07:04', alarm: ['07:05'] }, true, -1);
  wlCase('at alarm', { sleepStart: '23:00', sleepEnd: '07:00', alarm: ['07:00'] }, false, 0);
  wlCase('multi, all beaten', { sleepStart: '23:00', sleepEnd: '06:50', alarm: ['07:00', '07:10'] }, true, -10, '07:00');
  wlCase('out of order', { sleepStart: '23:35', sleepEnd: '10:25', alarm: ['09:50', '08:30', '07:30'] }, false, 175, '07:30');
  wlCase('daytime sleep (8/24)', { sleepStart: '06:01', sleepEnd: '15:05', alarm: ['09:30', '11:30', '13:30'] }, false, 335, '09:30');
  wlCase('evening alarm, post-midnight wake', { sleepStart: '22:00', sleepEnd: '00:20', alarm: ['23:50'] }, false, 30, '23:50');
  // Known edge (not in data): an alarm logged before sleep start is treated as next-day
  // (offset 1420), so wake (offset 450) reads as 970 min early → natural.
  wlCase('alarm before sleep start (edge)', { sleepStart: '00:30', sleepEnd: '08:00', alarm: ['00:10'] }, true, -970, '00:10');
  wlCase('no alarm', { sleepStart: '23:00', sleepEnd: '07:00', alarm: [] }, true, null, null);
  wlCase('alarm field missing', { sleepStart: '23:00', sleepEnd: '07:00' }, true, null, null);
  wlCase('alarm after wake (multi)', { sleepStart: '23:00', sleepEnd: '07:00', alarm: ['01:00', '04:00'] }, false, 360, '01:00');
  // sleepStart missing (fixtures only): min clock alarm, shortest signed clock delta.
  wlCase('no sleepStart, after alarm', { sleepEnd: '07:25', alarm: ['07:00'] }, false, 25);
  wlCase('no sleepStart, before alarm', { sleepEnd: '07:04', alarm: ['07:05'] }, true, -1);
  wlCase('no sleepStart, across midnight', { sleepEnd: '00:20', alarm: ['23:50'] }, false, 30);

  expectEqual(u.minutesFromSleepStart(9 * 60 + 33, 39), 534, 'minutesFromSleepStart same day');
  expectEqual(u.minutesFromSleepStart(30, 23 * 60), 90, 'minutesFromSleepStart across midnight');
  expectTruthy(Number.isNaN(u.minutesFromSleepStart(NaN, 0)), 'minutesFromSleepStart missing → NaN');
  expectEqual(
    JSON.stringify(u.sortAlarmsForNight(['01:30', '23:30'], '23:00')),
    JSON.stringify(['23:30', '01:30']),
    'sortAlarmsForNight by sleep-start offset'
  );
  expectEqual(
    JSON.stringify(u.sortAlarmsForNight(['09:50', '08:30', '07:30'], '23:35')),
    JSON.stringify(['07:30', '08:30', '09:50']),
    'sortAlarmsForNight morning alarms'
  );
  expectEqual(
    JSON.stringify(u.sortAlarmsForNight(['09:00', '07:00', '07:00'], null)),
    JSON.stringify(['07:00', '07:00', '09:00']),
    'sortAlarmsForNight no sleepStart → clock order'
  );
  expectEqual(
    JSON.stringify(u.mapDayToSupabaseRow({ date: '2026-11-12', bed: '23:20', sleepStart: '23:35', sleepEnd: '10:25', alarm: ['09:50', '08:30', '07:30'], bathroom: [], WASO: 0 }).alarm),
    JSON.stringify(['07:30', '08:30', '09:50']),
    'mapDayToSupabaseRow stores alarms sorted by sleep-start offset'
  );
  expectEqual(
    JSON.stringify(u.mapPartialDayToDraftPatch({ sleepStart: '23:00', alarm: ['01:30', '23:30'] }).alarm),
    JSON.stringify(['23:30', '01:30']),
    'mapPartialDayToDraftPatch sorts alarms with partial sleepStart'
  );
  expectEqual(
    JSON.stringify(u.mapPartialDayToDraftPatch({ alarm: ['09:00', '07:00'] }).alarm),
    JSON.stringify(['07:00', '09:00']),
    'mapPartialDayToDraftPatch without sleepStart → clock order'
  );

  // Sleep lag (bed → asleep) + uninterrupted calculations
  const bedLagDay = { bed: '23:50', sleepStart: '00:20' };
  expectEqual(u.sleepLagMin(bedLagDay), 30, 'sleep lag across midnight');

  const interruptionsDay = {
    sleepStart: '23:00',
    sleepEnd: '07:00',
    alarm: ['01:00', '04:00']
  };
  expectEqual(u.calculateLongestUninterrupted(interruptionsDay), 180, 'longest uninterrupted span');

  ['isNaturalWakeDay', 'isNoAlarmWakeDay', 'calculateWakeDelay', 'calculateAlarmToWakeDelta', 'calculateFirstAlarmToWake', 'calculateBedToSleepDelay', 'calculateSleepDelay', 'getFirstAlarmMinutes'].forEach((name) => {
    expectEqual(typeof u[name], 'undefined', `${name} removed (use classifyWake / sleepLagMin / wakeLagMin)`);
  });

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
  const basis = u.computeRecentWakeBasis(basisDays);
  expectTruthy(basis, 'computeRecentWakeBasis returns basis');
  expectEqual(basis.avgSleepStart, 1380, 'basis avg sleep start');
  expectEqual(basis.avgSleepEnd, 420, 'basis avg wake end');
  expectEqual(basis.totalWakeMins, 960, 'basis total wake minutes');
  expectEqual(u.wakePercentToClockMinutes(basis, 50), 900, 'wakePercentToClockMinutes 50 percent');

  const defaultPhaseBasis = u.getTonightWakePhaseBasisFromDays(basisDays);
  expectEqual(defaultPhaseBasis.avgSleepStart, 1380, 'getTonightWakePhaseBasisFromDays matches seven-day when no target');
  expectEqual(defaultPhaseBasis.totalWakeMins, 960, 'getTonightWakePhaseBasisFromDays wake window without target');

  u.localStorage.setItem('sleep-app-tonight-target-window', JSON.stringify({ sleep: 1320, wake: 420 }));
  const withTarget = u.getTonightWakePhaseBasisFromDays(basisDays);
  expectEqual(withTarget.avgSleepStart, 1320, 'saved Tonight target replaces sleep in phase basis');
  expectEqual(withTarget.avgSleepEnd, 420, 'saved Tonight target preserves wake in phase basis');
  expectEqual(withTarget.totalWakeMins, u.durationMinutes(420, 1320), 'saved Tonight target recomputes wake window');

  expectEqual(u.shortestSignedClockDelta(60, 120), 60, 'shortestSignedClockDelta forward');
  expectEqual(u.shortestSignedClockDelta(120, 60), -60, 'shortestSignedClockDelta backward');
  const rOff = u.resolveTonightScheduledWindow(1380, 420, { sleep: 1320, wake: 420 });
  expectEqual(rOff.mode, 'target', 'resolveTonightScheduledWindow guidance off uses target');
  expectEqual(rOff.sleep, 1320, 'resolve target sleep');
  u.localStorage.setItem('sleep-app-tonight-guidance-sleep-enabled', '1');
  u.localStorage.setItem('sleep-app-tonight-guidance-wake-enabled', '1');
  u.localStorage.setItem('sleep-app-tonight-guidance-pace', 'normal');
  const rOn = u.resolveTonightScheduledWindow(1380, 420, { sleep: 1320, wake: 420 });
  expectEqual(rOn.mode, 'guided', 'resolveTonightScheduledWindow both poles guided when gap');
  expectEqual(rOn.sleep, 1370, 'normal pace nudges sleep 10m toward earlier target');
  expectEqual(rOn.wake, 420, 'wake unchanged when already at target');
  // Guidance needs the taking-shape stage (7+ nights); with 3 nights it is held and the target applies directly.
  const basisDays7 = basisDays.concat(basisDays, basisDays).slice(0, 7);
  const guidedBasis = u.getTonightWakePhaseBasisFromDays(basisDays7);
  expectEqual(guidedBasis.avgSleepStart, 1370, 'getTonightWakePhaseBasisFromDays uses guided sleep (7 nights)');
  expectEqual(guidedBasis.avgSleepEnd, 420, 'guided basis wake');
  expectEqual(u.getTonightWakePhaseBasisFromDays(basisDays).avgSleepStart, 1320, 'phase basis with 3 nights: guidance held, target directly');
  u.localStorage.setItem('sleep-app-tonight-guidance-pace', 'steady');
  const rSteady = u.resolveTonightScheduledWindow(1380, 420, { sleep: 1320, wake: 420 });
  expectEqual(rSteady.sleep, 1365, 'steady pace nudges sleep 15m toward earlier target');
  u.localStorage.removeItem('sleep-app-tonight-guidance-pace');
  const rGentleDefault = u.resolveTonightScheduledWindow(1380, 420, { sleep: 1320, wake: 420 });
  expectEqual(rGentleDefault.sleep, 1374, 'default gentle pace nudges sleep 6m toward earlier target');
  u.localStorage.removeItem('sleep-app-tonight-guidance-sleep-enabled');
  u.localStorage.removeItem('sleep-app-tonight-guidance-wake-enabled');
  u.localStorage.removeItem('sleep-app-tonight-guidance-pace');

  u.localStorage.setItem('sleep-app-tonight-projection-adjustment', JSON.stringify({ sleep: 1350, wake: 400 }));
  const withAdj = u.getTonightWakePhaseBasisFromDays(basisDays);
  expectEqual(withAdj.avgSleepStart, 1350, 'session adjustment overlays sleep in phase basis');
  expectEqual(withAdj.avgSleepEnd, 400, 'session adjustment overlays wake in phase basis');
  expectEqual(withAdj.totalWakeMins, u.durationMinutes(400, 1350), 'session adjustment recomputes wake window');
  u.localStorage.removeItem('sleep-app-tonight-projection-adjustment');
  u.localStorage.removeItem('sleep-app-tonight-target-window');

  u.localStorage.setItem('sleep-app-tonight-target-window', JSON.stringify({ sleep: null, wake: 420 }));
  const wakeOnly = u.getTonightTargetWindow();
  expectTruthy(wakeOnly && wakeOnly.wake === 420 && wakeOnly.sleep == null, 'getTonightTargetWindow wake-only');
  const rWakeOnly = u.resolveTonightScheduledWindow(1380, 420, wakeOnly);
  expectEqual(rWakeOnly.wake, 420, 'resolve wake-only keeps saved wake');
  expectEqual(rWakeOnly.sleep, 1380, 'resolve wake-only uses avg sleep');
  u.localStorage.setItem('sleep-app-tonight-guidance-wake-enabled', '1');
  u.localStorage.removeItem('sleep-app-tonight-guidance-sleep-enabled');
  u.localStorage.setItem('sleep-app-tonight-guidance-pace', 'gentle');
  const rWakeOnlyG = u.resolveTonightScheduledWindow(1380, 440, wakeOnly);
  expectEqual(rWakeOnlyG.mode, 'guided', 'wake-only with wake guidance on when wake still differs from target');
  expectEqual(rWakeOnlyG.wake, 434, 'wake-only gentle nudge is pace-capped (no snap to saved wake)');
  u.localStorage.removeItem('sleep-app-tonight-guidance-wake-enabled');
  u.localStorage.removeItem('sleep-app-tonight-guidance-pace');
  u.localStorage.removeItem('sleep-app-tonight-target-window');

  u.mergeTonightTargetWindow({ sleep: 1320 });
  const tw1 = u.getTonightTargetWindow();
  expectTruthy(tw1 && tw1.sleep === 1320 && tw1.wake == null, 'mergeTonightTargetWindow sleep-only');
  u.mergeTonightTargetWindow({ wake: 400 });
  const tw2 = u.getTonightTargetWindow();
  expectTruthy(tw2 && tw2.sleep === 1320 && tw2.wake === 400, 'mergeTonightTargetWindow adds wake');

  u.userSettingsRowToLocalStorage({
    language: 'en',
    clock_format: '24h',
    quality_palette: 'auto',
    remaining_wake_open_min: 35,
    remaining_wake_winding_min: 15,
    remaining_wake_phase_heads_up_mins: 30,
    tonight_target_sleep_min: null,
    tonight_target_wake_min: null,
    tonight_guidance_sleep_enabled: false,
    tonight_guidance_wake_enabled: false,
    tonight_guidance_pace: 'gentle'
  });
  const twAfterNullServer = u.getTonightTargetWindow();
  expectTruthy(
    twAfterNullServer && twAfterNullServer.sleep === 1320 && twAfterNullServer.wake === 400,
    'userSettingsRowToLocalStorage does not wipe local Tonight target when server has both null'
  );

  u.userSettingsRowToLocalStorage({
    language: 'en',
    clock_format: '24h',
    quality_palette: 'auto',
    remaining_wake_open_min: 35,
    remaining_wake_winding_min: 15,
    remaining_wake_phase_heads_up_mins: 30,
    tonight_target_sleep_min: 1320,
    tonight_target_wake_min: null,
    tonight_guidance_sleep_enabled: false,
    tonight_guidance_wake_enabled: false,
    tonight_guidance_pace: 'gentle'
  });
  const twMergedWake = u.getTonightTargetWindow();
  expectTruthy(
    twMergedWake && twMergedWake.sleep === 1320 && twMergedWake.wake === 400,
    'userSettingsRowToLocalStorage fills missing wake from local when server sends sleep only'
  );

  u.clearTonightTargetPole('sleep');
  const tw3 = u.getTonightTargetWindow();
  expectTruthy(tw3 && tw3.wake === 400 && tw3.sleep == null, 'clearTonightTargetPole sleep');
  u.clearTonightTargetWindow();

  // Tonight matrix view model (phase boundaries, modes, snap removal behavior)
  const mEmpty = u.buildTonightMatrixViewModel({
    pole: 'sleep',
    naturalMinutes: null,
    savedTargetMinutes: 1320,
    guidanceEnabled: true,
    guidedMinutes: 1320,
    paceId: 'gentle'
  });
  expectEqual(mEmpty.rowMode, 'empty', 'no natural → empty row');
  expectEqual(mEmpty.phase, 'none', 'no natural → phase none');
  expectEqual(mEmpty.activeColumn, 'natural', 'empty row → highlight natural');

  const mNoTgt = u.buildTonightMatrixViewModel({
    pole: 'wake',
    naturalMinutes: 420,
    savedTargetMinutes: null,
    guidanceEnabled: true,
    guidedMinutes: 420,
    paceId: 'normal'
  });
  expectEqual(mNoTgt.rowMode, 'no_target', 'no saved target → no_target');
  expectEqual(mNoTgt.activeColumn, 'natural', 'no target → highlight natural');

  const mTgtOff = u.buildTonightMatrixViewModel({
    pole: 'sleep',
    naturalMinutes: 1380,
    savedTargetMinutes: 1320,
    guidanceEnabled: false,
    guidedMinutes: 1320,
    paceId: 'steady'
  });
  expectEqual(mTgtOff.rowMode, 'target_no_guidance', 'target with guidance off');
  expectEqual(mTgtOff.activeColumn, 'target', 'target only → highlight target');

  const mOnTarget = u.buildTonightMatrixViewModel({
    pole: 'wake',
    naturalMinutes: 420,
    savedTargetMinutes: 400,
    guidanceEnabled: true,
    guidedMinutes: 400,
    paceId: 'gentle'
  });
  expectEqual(mOnTarget.phase, 'on_target', 'guided equals target → on_target MAINTAIN');
  expectEqual(mOnTarget.activeColumn, 'guided', 'MAINTAIN → highlight guided');
  expectTruthy(mOnTarget.callout != null, 'on_target still emits callout vars');

  const mFullGuidanceNoGuidedClock = u.buildTonightMatrixViewModel({
    pole: 'sleep',
    naturalMinutes: 1380,
    savedTargetMinutes: 1320,
    guidanceEnabled: true,
    guidedMinutes: null,
    paceId: 'gentle'
  });
  expectEqual(mFullGuidanceNoGuidedClock.rowMode, 'full_guidance', 'guidance on, no guided clock yet');
  expectEqual(mFullGuidanceNoGuidedClock.activeColumn, 'target', 'full guidance without guided minute → target');

  const mInitBoundary = u.buildTonightMatrixViewModel({
    pole: 'sleep',
    naturalMinutes: 0,
    savedTargetMinutes: 100,
    guidanceEnabled: true,
    guidedMinutes: 30,
    paceId: 'gentle'
  });
  expectEqual(mInitBoundary.remainingRatio, 0.7, 'remainingRatio boundary 70%');
  expectEqual(mInitBoundary.phase, 'initiating', 'exactly 0.70 remaining → initiating');
  expectEqual(mInitBoundary.activeColumn, 'guided', 'guided clock set → highlight guided');

  const mLockBoundary = u.buildTonightMatrixViewModel({
    pole: 'sleep',
    naturalMinutes: 1380,
    savedTargetMinutes: 1320,
    guidanceEnabled: true,
    guidedMinutes: 1326,
    paceId: 'gentle'
  });
  expectEqual(mLockBoundary.initialGap, 60, 'fixture initial gap 60');
  expectEqual(mLockBoundary.currentGap, 6, 'fixture current gap 6');
  expectEqual(mLockBoundary.remainingRatio, 0.1, 'remaining ratio 0.1');
  expectEqual(mLockBoundary.phase, 'locking_in', 'exactly below 0.15 → locking_in');
  expectEqual(mLockBoundary.activeColumn, 'guided', 'locking in still guided column');

  const mSnapNoJump = u.buildTonightMatrixViewModel({
    pole: 'sleep',
    naturalMinutes: 100,
    savedTargetMinutes: 88,
    guidanceEnabled: true,
    guidedMinutes: 94,
    paceId: 'gentle'
  });
  expectEqual(mSnapNoJump.currentGap, 6, '12m gap closed by 6m step leaves 6m to target');
  expectEqual(mSnapNoJump.phase, 'transitioning', '6/12 ratio mid-band (not snap-jumped to on_target)');

  const mDrift = u.buildTonightMatrixViewModel({
    pole: 'sleep',
    naturalMinutes: 1330,
    savedTargetMinutes: 1320,
    guidanceEnabled: true,
    guidedMinutes: 1324,
    paceId: 'gentle'
  });
  expectEqual(mDrift.phase, 'transitioning', 'after natural drift, guided off target re-enters mid phase');

  const mSleepDir = u.buildTonightMatrixViewModel({
    pole: 'sleep',
    naturalMinutes: 1380,
    savedTargetMinutes: 1320,
    guidanceEnabled: true,
    guidedMinutes: 1370,
    paceId: 'normal'
  });
  expectTruthy(mSleepDir.callout && mSleepDir.callout.directionEarlier === true, 'sleep natural→guided signed earlier');

  const mWakeDir = u.buildTonightMatrixViewModel({
    pole: 'wake',
    naturalMinutes: 420,
    savedTargetMinutes: 400,
    guidanceEnabled: true,
    guidedMinutes: 430,
    paceId: 'normal'
  });
  expectTruthy(mWakeDir.callout && mWakeDir.callout.directionEarlier === false, 'wake guided later than natural');

  // Clock offsets wrap around midnight
  const nearMidnight = 10; // 00:10
  expectEqual(u.modMinutes1440(nearMidnight - 30), 1420, 'offset before midnight wraps to previous day');
  expectEqual(u.modMinutes1440(nearMidnight + 30), 40, 'offset after midnight wraps forward');

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

  // Wake-day cutover (docs/wake-day-key.md): taps up to avg wake + 120 min → today's row; later → tomorrow's.
  const cut = (mo, d, h, mi) => u.recordDateMdForSleepPeriod(new Date(2026, mo, d, h, mi, 0, 0), 7 * 60);
  expectEqual(cut(10, 18, 23, 0), '2026-11-19', 'cutover: 23:00 Nov 18 bed → Nov 19 row');
  expectEqual(cut(10, 19, 2, 0), '2026-11-19', 'cutover: 02:00 Nov 19 bed → Nov 19 row');
  expectEqual(cut(10, 19, 9, 0), '2026-11-19', 'cutover: 09:00 (avg wake + 120) still today (inclusive)');
  expectEqual(cut(10, 19, 9, 1), '2026-11-20', 'cutover: 09:01 rolls to tomorrow');

  // Night key: saves and lookups anchor the cutover on the natural (recent-average) wake.
  const nkDays = [
    { date: '2026-11-18', bed: '23:00', sleepStart: '23:20', sleepEnd: '07:40', alarm: [], bathroom: [], WASO: 0 },
    { date: '2026-11-17', bed: '23:00', sleepStart: '23:20', sleepEnd: '07:20', alarm: [], bathroom: [], WASO: 0 }
  ];
  expectEqual(u.getNightKeyWakeMinutes(nkDays), 451, 'night-key wake = natural weighted average (07:31; newest 07:40 weighs more)');
  expectEqual(u.getNightKeyWakeMinutes([]), 420, 'night-key wake falls back to 07:00 with no history');
  expectEqual(u.getCurrentNightKey(new Date(2026, 10, 19, 9, 31), nkDays), '2026-11-19', 'night key: 09:31 within natural cutover (09:31)');
  expectEqual(u.getCurrentNightKey(new Date(2026, 10, 19, 9, 32), nkDays), '2026-11-20', 'night key: 09:32 past natural cutover');

  // "Is tonight logged?" lookups read only the night-key row. A previous row still awaiting wake
  // (forgotten wake) must not count as tonight's bed / sleep.
  {
    const qaKey = 'restore_qa_sleep_logged_v1';
    const eve = new Date(2026, 10, 19, 21, 0);
    const tonightKey = u.getCurrentNightKey(eve, nkDays);
    expectEqual(tonightKey, '2026-11-20', 'lookup: 21:00 Nov 19 night key is Nov 20');
    u.localStorage.setItem(qaKey, JSON.stringify({ '2026-11-19': { bed: true, sleep: true } }));
    expectEqual(u.isNightBedOrSleepLogged(tonightKey, nkDays, null), false, 'lookup: forgotten wake on Nov 19 is not tonight\'s bed/sleep');
    expectEqual(u.isNightBedLogged(tonightKey, nkDays, null), false, 'lookup: forgotten wake is not tonight\'s bed');
    expectEqual(u.isNightSleepOrIntentLoggedNav(tonightKey, nkDays, eve, null), false, 'lookup: forgotten wake is not tonight\'s sleep');
    u.localStorage.setItem(qaKey, JSON.stringify({ '2026-11-20': { bed: true } }));
    expectEqual(u.isNightBedOrSleepLogged(tonightKey, nkDays, null), true, 'lookup: bed saved on tonight\'s key counts');
    expectEqual(u.isNightBedLogged(tonightKey, nkDays, null), true, 'lookup: bed only on tonight\'s key');
    expectEqual(u.isNightSleepOrIntentLoggedNav(tonightKey, nkDays, eve, null), false, 'lookup: bed only is not sleep');
    u.localStorage.removeItem(qaKey);
  }

  // Night clock → instant: evening clocks fall the day before the wake date.
  const ms = (mo, d, h, mi) => new Date(2026, mo, d, h, mi, 0, 0).getTime();
  expectEqual(u.nightClockToInstantMs('2026-11-19', '23:10'), ms(10, 18, 23, 10), 'night clock 23:10 → Nov 18');
  expectEqual(u.nightClockToInstantMs('2026-11-19', '02:00'), ms(10, 19, 2, 0), 'night clock 02:00 → Nov 19');
  expectEqual(u.minutesPastNaturalWake('2026-11-19', 420, ms(10, 19, 10, 30)), 210, 'late wake: 10:30 is 210 min past 07:00');
  expectEqual(u.minutesPastNaturalWake('2026-11-19', 420, ms(10, 18, 23, 30)), -450, 'evening before: negative');

  // Open night: newest night with bed/sleep and no wake; abandoned after 24h from sleep or when superseded.
  const draft = (date, bed, sleepStart, sleepEnd, nap) => ({ date, bed, sleepStart, sleepEnd, nap: nap || null });
  const openNov19 = [draft('2026-11-19', '22:50', '23:10', null)];
  const on1 = u.resolveOpenNight(openNov19, '2026-11-18', ms(10, 19, 10, 30));
  expectEqual(on1 && on1.date, '2026-11-19', 'open night: sleep logged, no wake');
  expectEqual(u.resolveOpenNight(openNov19, '2026-11-18', ms(10, 19, 23, 10)) && 'open', 'open', 'open night: exactly 24h after sleep still open');
  expectEqual(u.resolveOpenNight(openNov19, '2026-11-18', ms(10, 19, 23, 11)), null, 'open night: abandoned 24h after sleep');
  expectEqual(u.resolveOpenNight(openNov19, '2026-11-19', ms(10, 19, 10, 30)), null, 'open night: completed row for same night → none');
  expectEqual(u.resolveOpenNight([draft('2026-11-19', '22:50', '23:10', '07:00')], null, ms(10, 19, 10, 30)), null, 'open night: wake already logged → none');
  const superseded = [draft('2026-11-20', '', '23:40', null), draft('2026-11-19', '22:50', '23:10', null)];
  const on2 = u.resolveOpenNight(superseded, null, ms(10, 19, 23, 45));
  expectEqual(on2 && on2.date, '2026-11-20', 'open night: newer sleep supersedes older open night');
  expectEqual(u.resolveOpenNight([draft('2026-11-20', '', '', null, { start: '14:00', end: '14:30' })].concat(openNov19), null, ms(10, 19, 15, 0)).date, '2026-11-19', 'open night: nap-only draft is not a new sleep');
  const bedOnly = u.resolveOpenNight([draft('2026-11-19', '23:30', '', null)], null, ms(10, 19, 1, 0));
  expectEqual(bedOnly && bedOnly.anchorMs, ms(10, 18, 23, 30), 'open night: bed-only night anchors on bed');
  expectEqual(u.resolveOpenNight([], null, ms(10, 19, 10, 0)), null, 'open night: no drafts → none');

  // averageSleepNights on a fixed list (week summaries, lifetime) is an equal-weight mean. Values recorded
  // from the pre-refactor nightly.js calculateAverages (flat 7-night mean) and still reproduced.
  const avgFixture = [
    { date: '2026-11-16', bed: '23:20', sleepStart: '23:40', sleepEnd: '07:05', alarm: ['07:00'], bathroom: [], WASO: 0 },
    { date: '2026-11-15', bed: '00:05', sleepStart: '00:30', sleepEnd: '08:10', alarm: [], bathroom: ['03:10'], WASO: 1 },
    { date: '2026-11-14', bed: '23:45', sleepStart: '00:10', sleepEnd: '07:40', alarm: [], bathroom: [], WASO: 0 },
    { date: '2026-11-13', bed: '22:50', sleepStart: '23:15', sleepEnd: '06:50', alarm: ['06:45'], bathroom: [], WASO: 0 },
    { date: '2026-11-12', bed: '23:30', sleepStart: '23:55', sleepEnd: '07:15', alarm: ['07:00', '07:10'], bathroom: [], WASO: 2 },
    { date: '2026-11-11', bed: '00:40', sleepStart: '01:15', sleepEnd: '07:30', alarm: ['07:30'], bathroom: [], WASO: 0 },
    { date: '2026-11-10', bed: '23:10', sleepStart: '23:30', sleepEnd: '07:00', alarm: [], bathroom: [], WASO: 0 },
    { date: '2026-11-09', bed: '22:30', sleepStart: '22:45', sleepEnd: '06:30', alarm: ['06:30'], bathroom: [], WASO: 0 },
    { date: '2026-11-08', bed: '23:00', sleepStart: '23:20', sleepEnd: '07:50', alarm: [], bathroom: [], WASO: 0 },
    { date: '2026-11-07', bed: '00:20', sleepStart: '00:45', sleepEnd: '09:00', alarm: [], bathroom: [], WASO: 1 }
  ];
  const ca7 = u.averageSleepNights(avgFixture.slice(0, 7));
  expectEqual(ca7.sampleSize, 7, 'averageSleepNights sampleSize');
  expectEqual(ca7.avgSleepStart, 2, 'averageSleepNights avgSleepStart 00:02 across midnight');
  expectEqual(ca7.avgSleepEnd, 441, 'averageSleepNights avgSleepEnd 07:21');
  expectEqual(ca7.avgSleepDuration, 439, 'averageSleepNights avgSleepDuration');
  expectEqual(ca7.avgLongestUninterrupted, 436, 'averageSleepNights avgLongestUninterrupted');
  expectEqual(ca7.avgSleepLag, 25, 'averageSleepNights avgSleepLag');
  expectEqual(ca7.avgWakeLag, 6, 'averageSleepNights avgWakeLag (alarm nights only)');
  // Bed = fell-asleep − sleep lag on the extended axis (docs/math.md § Clock axis): (1442.14 − 25) → 1417 = 23:37.
  expectEqual(ca7.avgBed, 1417, 'averageSleepNights avgBed 23:37 (beds straddle midnight)');
  expectEqual(Math.round((ca7.exact.sleepStartNorm - ca7.exact.bedNorm) * 1000) / 1000, 25, 'exact bedNorm = sleepStartNorm − exact sleep lag');
  expectEqual(ca7.exact.wakeLag, 6.25, 'exact wakeLag unrounded (+5 +5 +15 0 over 4 alarm nights)');
  expectEqual(ca7.avgBedToSleepDelay, undefined, 'averageSleepNights old field avgBedToSleepDelay gone');
  expectEqual(ca7.avgFirstAlarmToWake, undefined, 'averageSleepNights old field avgFirstAlarmToWake gone');
  // Recent average (docs/recent-average.md): newest 14 logged entries, weight 0.5^(i/5).
  // Expected clock values computed independently (Python) from the same rule.
  const rw = u.recentAverageWeights(14);
  expectEqual(rw[0], 1, 'recent weights: newest = 1');
  expectEqual(rw[5], 0.5, 'recent weights: 5 entries back = 1/2 (half-life)');
  expectEqual(rw[10], 0.25, 'recent weights: 10 entries back = 1/4');
  const rwSum = rw.reduce((a, b) => a + b, 0);
  expectEqual(Math.round((rw[0] / rwSum) * 1000) / 10, 15.1, 'recent weights: newest ≈15.1% of 14');
  expectEqual(Math.round((rw[13] / rwSum) * 1000) / 10, 2.5, 'recent weights: oldest ≈2.5% of 14');
  const cr = u.computeRecentAverages(avgFixture);
  expectEqual(cr.sampleSize, 10, 'computeRecentAverages uses all 10 entries (window 14)');
  expectEqual(cr.avgSleepStart, 1436, 'weighted recent fell-asleep 23:56');
  expectEqual(cr.avgSleepEnd, 446, 'weighted recent wake 07:26');
  expectEqual(
    JSON.stringify(cr),
    JSON.stringify(u.averageSleepNights(avgFixture, u.recentAverageWeights(10))),
    'computeRecentAverages = averageSleepNights with recent weights'
  );
  expectEqual(u.computeRecentAverages([]), null, 'computeRecentAverages empty → null');
  expectEqual(u.computeRecentAverages(avgFixture.slice(0, 3)).sampleSize, 3, 'computeRecentAverages partial window');
  const twentyNights = [];
  for (let i = 0; i < 20; i++) twentyNights.push(avgFixture[i % avgFixture.length]);
  expectEqual(u.computeRecentAverages(twentyNights).sampleSize, 14, 'window counts the newest 14 logged entries');
  // endBeforeIndex: per-night baseline excludes the night itself.
  const crBefore0 = u.computeRecentAverages(avgFixture, { endBeforeIndex: 0 });
  expectEqual(crBefore0.sampleSize, 9, 'endBeforeIndex 0 uses nights 1–9');
  expectEqual(crBefore0.avgSleepStart, 1439, 'endBeforeIndex 0 weighted fell-asleep 23:59');
  expectEqual(crBefore0.avgSleepEnd, 451, 'endBeforeIndex 0 weighted wake 07:31');
  // Catch-up: bedtime moves from 23:00 to 22:00 for the newest k of 14 nights.
  const stepNights = (k) => {
    const out = [];
    for (let i = 0; i < 14; i++) {
      out.push(i < k
        ? { date: '2026-11-01', bed: '21:40', sleepStart: '22:00', sleepEnd: '06:00', alarm: [], bathroom: [], WASO: 0 }
        : { date: '2026-11-01', bed: '22:40', sleepStart: '23:00', sleepEnd: '07:00', alarm: [], bathroom: [], WASO: 0 });
    }
    return out;
  };
  expectEqual(u.computeRecentAverages(stepNights(1)).avgSleepStart, 1371, 'catch-up: 1 night in → 9 min (22:51)');
  expectEqual(u.computeRecentAverages(stepNights(3)).avgSleepStart, 1356, 'catch-up: 3 nights in → 24 min (22:36)');
  expectEqual(u.computeRecentAverages(stepNights(7)).avgSleepStart, 1336, 'catch-up: 7 nights in → 44 min (22:16)');
  expectEqual(u.computeRecentAverages(stepNights(14)).avgSleepStart, 1320, 'catch-up: 14 nights in → full hour (22:00)');
  const rb = u.computeRecentWakeBasis(avgFixture);
  expectEqual(rb.avgSleepStart, cr.avgSleepStart, 'wake basis sleep matches recent average');
  expectEqual(rb.avgSleepEnd, cr.avgSleepEnd, 'wake basis wake matches recent average');
  const caTwo = u.averageSleepNights([
    { date: '2026-11-02', bed: '23:00', sleepStart: '23:30', sleepEnd: '07:00', alarm: [], bathroom: [], WASO: 0 },
    { date: '2026-11-01', bed: '00:00', sleepStart: '00:30', sleepEnd: '08:00', alarm: [], bathroom: [], WASO: 0 }
  ]);
  expectEqual(caTwo.avgSleepStart, 0, '23:30 + 00:30 average to 00:00');
  expectEqual(caTwo.avgSleepEnd, 450, '07:00 + 08:00 average to 07:30');
  expectEqual(caTwo.avgWakeLag, null, 'no alarm nights → avgWakeLag null');
  // Deviation-flag baseline: recent average of the entries before the night (night excluded), unrounded.
  const db0 = u.getDeviationBaseline(avgFixture, 0);
  expectEqual(db0.insufficient, false, 'flag baseline sufficient with 9 prior nights');
  expectEqual(db0.sampleSize, 9, 'flag baseline uses nights 1–9');
  expectEqual(Math.round(db0.avgFellAsleepTime * 100) / 100, 1439.35, 'flag baseline fell-asleep: weighted, extended axis, unrounded');
  expectEqual(Math.round(db0.avgWakeTime * 100) / 100, 1890.84, 'flag baseline wake: weighted, extended axis, unrounded');
  expectEqual(
    db0.avgSleepDuration,
    u.computeRecentAverages(avgFixture, { endBeforeIndex: 0 }).exact.sleepDuration,
    'flag baseline duration = helper exact duration'
  );
  const db2 = u.getDeviationBaseline(avgFixture, 2);
  expectEqual(db2.insufficient, false, 'flag baseline sufficient with exactly 7 prior nights');
  const db3 = u.getDeviationBaseline(avgFixture, 3);
  expectEqual(db3.insufficient, true, 'flag baseline learning with only 6 prior nights');
  expectEqual(db3.sampleSize, 6, 'flag baseline learning sampleSize');
  expectEqual(u.getDeviationBaseline(twentyNights, 0).sampleSize, 14, 'flag baseline caps at 14 prior nights');
  // Flags on a night far from its baseline: 03:00 sleep / 13:00 wake after the fixture's ~00:00 / 07:30.
  const lateNight = { date: '2026-11-17', bed: '02:40', sleepStart: '03:00', sleepEnd: '13:00', alarm: [], bathroom: [], WASO: 0 };
  const flagDays = [lateNight].concat(avgFixture);
  expectEqual(JSON.stringify(u.getFlagTypes(lateNight, u.getDeviationBaseline(flagDays, 0))), JSON.stringify(['😴', '🌅']), 'late night flags 😴 and 🌅 against weighted baseline');

  // Recent stats (docs/math.md § Recent stats): last 7 calendar days vs the 7 before, equal weights,
  // blended % against the previous week's average total sleep; expected values worked by hand.
  const rsNight = (date, bed, sleepStart, sleepEnd, alarm) => ({ date, bed, sleepStart, sleepEnd, alarm: alarm || [], bathroom: [], WASO: 0 });
  const rsWeek = (dates, bed, sleepStart, sleepEnd, alarm) => dates.map((d) => rsNight(d, bed, sleepStart, sleepEnd, alarm));
  const rsPrevDates = ['2026-11-06', '2026-11-05', '2026-11-04', '2026-11-03'];
  const rsCurDates = ['2026-11-13', '2026-11-12', '2026-11-11', '2026-11-10'];
  const rsPrev = rsWeek(rsPrevDates, '23:00', '23:20', '07:20', ['07:15']); // 480m sleep, lag 20, snooze +5
  const rs1 = u.computeRecentStatsComparison(rsWeek(rsCurDates, '23:30', '23:55', '07:20', ['07:15']).concat(rsPrev));
  expectEqual(rs1.endKey, '2026-11-13', 'recent stats: anchored on the newest night key');
  expectEqual(`${rs1.currentCount}/${rs1.previousCount}`, '4/4', 'recent stats: calendar windows 11/07–13 and 10/31–11/06');
  expectEqual(rs1.comparable, true, 'recent stats: 4 nights each → comparable');
  expectEqual(rs1.metrics.bed.current, 1410, 'recent stats: bed this week 23:30');
  expectEqual(rs1.metrics.bed.previous, 1380, 'recent stats: bed last week 23:00');
  // +30m: 0.75·30/480 + 0.25·30/1440 = 4.6875% + 0.5208% = 5.21% → slight
  expectEqual(Math.round(rs1.metrics.bed.percent * 100) / 100, 5.21, 'recent stats: bed +30m → 5.21% blended');
  expectEqual(rs1.metrics.bed.severity, 'slight', 'recent stats: bed later past 5% → slight');
  expectEqual(u.recentStatsDisplayPercent(rs1.metrics.bed.percent), 5, 'recent stats: displayed % rounds down');
  expectEqual(rs1.metrics.asleep.severity, 'slight', 'recent stats: asleep +35m (6.08%) → slight');
  expectEqual(rs1.metrics.wake.delta, 0, 'recent stats: wake unchanged');
  expectEqual(rs1.metrics.wake.severity, null, 'recent stats: unchanged wake neutral');
  expectEqual(rs1.metrics.totalSleep.delta, -35, 'recent stats: total sleep −35m');
  expectEqual(rs1.metrics.totalSleep.severity, 'slight', 'recent stats: less sleep past 5% → slight');
  expectEqual(rs1.metrics.sleepLag.severity, null, 'recent stats: sleep lag +5m (0.87%) neutral');
  expectEqual(rs1.metrics.wakeLag.current, 5, 'recent stats: snooze average +5m');
  // Earlier bedtime and more sleep are never colored; wake is colored both ways.
  const rs2 = u.computeRecentStatsComparison(rsWeek(rsCurDates, '22:00', '22:20', '06:20', ['06:15']).concat(rsPrev));
  expectEqual(rs2.metrics.bed.severity, null, 'recent stats: bed 1h earlier → neutral');
  expectEqual(rs2.metrics.asleep.severity, null, 'recent stats: asleep 1h earlier → neutral');
  // −60m: 0.75·60/480 + 0.25·60/1440 = 9.375% + 1.042% = 10.42% → moderate
  expectEqual(rs2.metrics.wake.severity, 'moderate', 'recent stats: wake 1h earlier (10.42%) → moderate');
  expectEqual(rs2.metrics.totalSleep.severity, null, 'recent stats: unchanged total sleep neutral');
  // Under-6h floor on this week's average applies even with no change; all-natural week has no snooze average.
  const rsShortPrev = rsWeek(rsPrevDates, '23:10', '23:30', '05:00', ['05:00']);
  const rs3 = u.computeRecentStatsComparison(rsWeek(rsCurDates, '23:10', '23:30', '05:00').concat(rsShortPrev));
  expectEqual(rs3.metrics.totalSleep.delta, 0, 'recent stats: 5h30 both weeks');
  expectEqual(rs3.metrics.totalSleep.absoluteSeverity, 'slight', 'recent stats: average under 6h → slight floor');
  expectEqual(rs3.metrics.totalSleep.severity, 'slight', 'recent stats: floor colors an unchanged average');
  expectEqual(rs3.metrics.wakeLag.status, 'noAlarmCurrent', 'recent stats: all natural wakes this week');
  expectEqual(rs3.metrics.wakeLag.current, null, 'recent stats: no snooze average this week');
  // Fewer than 4 nights in a window → not compared (fixture: 7 nights this week, 3 the week before).
  const rs4 = u.computeRecentStatsComparison(avgFixture);
  expectEqual(`${rs4.currentCount}/${rs4.previousCount}`, '7/3', 'recent stats: fixture windows 7/3');
  expectEqual(rs4.comparable, false, 'recent stats: 3 nights last week → not comparable');
  expectEqual(rs4.metrics.asleep.status, 'insufficient', 'recent stats: insufficient status');
  expectEqual(rs4.metrics.asleep.current, ca7.avgSleepStart, 'recent stats: this week still averaged (= fixed 7-night mean)');
  expectEqual(u.computeRecentStatsComparison([]), null, 'recent stats: no data → null');

  // Learning stages (docs/recent-average.md § Learning stages)
  expectEqual(u.getRecentAverageStage(0), 'empty', 'stage: 0 nights empty');
  expectEqual(u.getRecentAverageStage(1), 'learning', 'stage: 1 night learning');
  expectEqual(u.getRecentAverageStage(6), 'learning', 'stage: 6 nights learning');
  expectEqual(u.getRecentAverageStage(7), 'forming', 'stage: 7 nights taking shape');
  expectEqual(u.getRecentAverageStage(13), 'forming', 'stage: 13 nights taking shape');
  expectEqual(u.getRecentAverageStage(14), 'established', 'stage: 14 nights established');
  expectEqual(u.isTonightGuidanceHeld(6), true, 'guidance held below 7 nights');
  expectEqual(u.isTonightGuidanceHeld(7), false, 'guidance active from 7 nights');
  expectEqual(u.getDeviationBaseline(avgFixture, 2).stage, 'forming', 'flag baseline with 7 earlier nights is taking shape');
  expectEqual(u.getDeviationBaseline(twentyNights, 0).stage, 'established', 'flag baseline with 14 earlier nights is established');
  const fm = u.buildFlagCountMap(avgFixture);
  expectEqual(fm.get('2026-11-14').forming, true, 'calendar: night with 7 earlier nights marked forming');
  expectEqual(fm.get('2026-11-13').insufficient, true, 'calendar: night with 6 earlier nights stays learning');
  expectEqual(fm.get('2026-11-13').forming, false, 'calendar: learning night is not forming');
  // 0 nights: nav shows learning instead of a countdown from default times.
  const learnNav = u.getRemainingWakeDisplayFromDays([]);
  expectEqual(learnNav.phase, 'learning', 'nav with no nights: learning phase');
  expectEqual(learnNav.percentRemaining, null, 'nav with no nights: no progress bar');
  // Overnight limbo is measured forward around the clock (sleep -> wake), so post-midnight sleepers stay covered.
  expectEqual(u.shouldShowGoToBedSoonWakeNav(180, 420, 1350), true, 'limbo 22:30->07:00: 03:00 inside');
  expectEqual(u.shouldShowGoToBedSoonWakeNav(420, 420, 1350), false, 'limbo 22:30->07:00: ends at wake');
  expectEqual(u.shouldShowGoToBedSoonWakeNav(900, 420, 1350), false, 'limbo 22:30->07:00: afternoon outside');
  expectEqual(u.shouldShowGoToBedSoonWakeNav(277, 570, 36), true, 'limbo 00:36->09:30: 04:37 inside (was false)');
  expectEqual(u.shouldShowGoToBedSoonWakeNav(569, 570, 36), true, 'limbo 00:36->09:30: 09:29 inside');
  expectEqual(u.shouldShowGoToBedSoonWakeNav(1380, 570, 36), false, 'limbo 00:36->09:30: 23:00 before sleep');
  expectEqual(u.shouldShowGoToBedSoonWakeNav(600, 600, 600), false, 'limbo: empty when sleep equals wake');
  // Phase wallpaper preference (user_settings.phase_wallpaper).
  expectEqual(u.getPhaseWallpaperEnabled(), false, 'phase wallpaper: off by default');
  expectEqual(u.localUserSettingsToRow().phase_wallpaper, false, 'phase wallpaper: row carries false by default');
  u.localStorage.setItem('sleep-app-dev-phase-wallpaper', '1');
  expectEqual(u.getPhaseWallpaperEnabled(), true, 'phase wallpaper: legacy dev key carried over');
  expectEqual(u.localStorage.getItem('sleep-app-dev-phase-wallpaper'), null, 'phase wallpaper: legacy dev key removed');
  expectEqual(u.localUserSettingsToRow().phase_wallpaper, true, 'phase wallpaper: row carries true when on');
  expectEqual(u.isSeedDefaultUserSettingsRow(u.localUserSettingsToRow()), false, 'phase wallpaper on: row is not the seed default');
  u.setPhaseWallpaperEnabled(false);
  expectEqual(u.localStorage.getItem('sleep-app-phase-wallpaper'), null, 'phase wallpaper: off removes key');
  // Guidance held while learning: a saved target applies directly.
  u.localStorage.setItem('sleep-app-tonight-target-window', JSON.stringify({ sleep: 1320, wake: 420 }));
  u.localStorage.setItem('sleep-app-tonight-guidance-sleep-enabled', '1');
  u.localStorage.setItem('sleep-app-tonight-guidance-wake-enabled', '1');
  const rHeld = u.resolveTonightScheduledWindow(1380, 450, { sleep: 1320, wake: 420 }, { holdGuidance: true });
  expectEqual(rHeld.mode, 'target', 'held guidance: mode target');
  expectEqual(rHeld.sleep, 1320, 'held guidance: target sleep applied directly');
  expectEqual(rHeld.wake, 420, 'held guidance: target wake applied directly');
  const rLive = u.resolveTonightScheduledWindow(1380, 450, { sleep: 1320, wake: 420 });
  expectEqual(rLive.mode, 'guided', 'not held: guidance steps toward target');
  const threeNights = avgFixture.slice(0, 3);
  const heldBasis = u.getTonightWakePhaseBasisFromDays(threeNights);
  expectEqual(heldBasis.avgSleepStart, 1320, 'phase basis while learning: target sleep directly');
  expectEqual(heldBasis.avgSleepEnd, 420, 'phase basis while learning: target wake directly');
  const learnBase = u.getTonightProjectionBaseState(u.computeRecentAverages(threeNights));
  expectEqual(learnBase.recentStage, 'learning', 'Tonight base: learning with 3 nights');
  expectEqual(learnBase.guidanceHeld, true, 'Tonight base: guidance held with 3 nights');
  expectEqual(learnBase.guidanceSleepEnabled, true, 'Tonight base: saved preference kept');
  expectEqual(learnBase.guidanceSleepActive, false, 'Tonight base: guidance not active while held');
  expectEqual(learnBase.naturalSleepMinutes, u.computeRecentAverages(threeNights).avgSleepStart, 'Tonight base: Natural shown from early nights');
  expectEqual(learnBase.committedSleep, 1320, 'Tonight base: schedule uses target directly while held');
  const formingBase = u.getTonightProjectionBaseState(u.computeRecentAverages(avgFixture));
  expectEqual(formingBase.recentStage, 'forming', 'Tonight base: taking shape with 10 nights');
  expectEqual(formingBase.guidanceSleepActive, true, 'Tonight base: guidance active once taking shape');
  u.localStorage.removeItem('sleep-app-tonight-target-window');
  u.localStorage.removeItem('sleep-app-tonight-guidance-sleep-enabled');
  u.localStorage.removeItem('sleep-app-tonight-guidance-wake-enabled');

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

  expectEqual(SA.wakeLagMinutes, undefined, 'legacy StatsAggregates.wakeLagMinutes removed');

  // Stats page column extras: Σ sleep lag (all nights), Σ wake lag (alarm nights, signed, net), % natural.
  const exFixture = [
    { date: '2026-11-20', bed: '00:20', sleepStart: '00:39', sleepEnd: '09:33', alarm: ['09:42'], bathroom: [], WASO: 0 },
    { date: '2026-11-19', bed: '23:00', sleepStart: '23:30', sleepEnd: '07:30', alarm: ['07:00'], bathroom: [], WASO: 0 },
    { date: '2026-11-18', bed: '22:50', sleepStart: '23:00', sleepEnd: '07:00', alarm: [], bathroom: [], WASO: 0 }
  ];
  const ex = u.columnExtras(exFixture);
  expectEqual(ex.sumSleepLag, 19 + 30 + 10, 'columnExtras sumSleepLag all nights');
  expectEqual(ex.sumWakeLag, -9 + 30, 'columnExtras sumWakeLag net of early wakes');
  expectEqual(Math.round(ex.naturalWakePct), 67, 'columnExtras natural wake % (11/20 early wake counts)');
  expectEqual(u.columnExtras([exFixture[2]]).sumWakeLag, null, 'columnExtras sumWakeLag null without alarm nights');
  expectEqual(u.columnExtras([]).sumSleepLag, null, 'columnExtras empty → sumSleepLag null');
  const mav = u.calculateMonthlyAverages(exFixture);
  expectEqual(mav.avgSleepLag, 20, 'stats calculateMonthlyAverages avgSleepLag');
  expectEqual(mav.avgWakeLag, 11, 'stats calculateMonthlyAverages avgWakeLag (alarm nights, signed)');

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
  const dataPath = path.join(__dirname, '..', 'data', 'sleep-data.json');
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
      const lag = u.wakeLagMin(d);
      if (lag !== null && !Number.isFinite(lag)) {
        failures.push(`dataset invariant day ${idx} (${d.date}): wake lag must be finite or null`);
      } else {
        passed += 1;
      }
      const wake = u.classifyWake(d);
      if (wake.natural !== (wake.wakeLagMin === null ? true : wake.wakeLagMin < 0)) {
        failures.push(`dataset invariant day ${idx} (${d.date}): natural must equal (no alarm or wake lag < 0)`);
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

runTests().catch(function (err) {
  console.error(err);
  process.exit(1);
});
