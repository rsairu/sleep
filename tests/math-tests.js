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

  // Signed and unsigned alarm behavior
  const normalAlarmDay = { alarm: ['07:00'], sleepEnd: '07:25' };
  expectEqual(u.calculateFirstAlarmToWake(normalAlarmDay), 25, 'signed alarm delta positive');
  expectEqual(u.calculateWakeDelay(normalAlarmDay), 25, 'wake delay positive');

  const negativeSignedAlarmDay = { alarm: ['07:05'], sleepEnd: '07:04' };
  expectEqual(u.calculateFirstAlarmToWake(negativeSignedAlarmDay), -1, 'signed alarm delta negative preserved');
  expectEqual(u.calculateWakeDelay(negativeSignedAlarmDay), -1, 'wake delay preserves negative morning ordering');

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

  expectEqual(u.isNoAlarmWakeDay({ alarm: [], sleepEnd: '07:00' }), true, 'isNoAlarmWakeDay empty alarms');
  expectEqual(u.isNoAlarmWakeDay({ alarm: ['07:00'], sleepEnd: '07:00' }), false, 'isNoAlarmWakeDay with alarm');

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
  expectEqual(ca7.avgBedToSleepDelay, 25, 'averageSleepNights avgBedToSleepDelay');
  expectEqual(ca7.avgFirstAlarmToWake, 6, 'averageSleepNights avgFirstAlarmToWake (alarm nights only)');
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
  expectEqual(caTwo.avgFirstAlarmToWake, null, 'no alarm nights → avgFirstAlarmToWake null');
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
      const wakeDelay = u.calculateWakeDelay(d);
      if (wakeDelay !== null && !Number.isFinite(wakeDelay)) {
        failures.push(`dataset invariant day ${idx} (${d.date}): wakeDelay must be finite or null`);
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

runTests().catch(function (err) {
  console.error(err);
  process.exit(1);
});
