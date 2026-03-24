/**
 * One-off style report: compare duration + calendar severity before vs after
 * absolute short-sleep thresholds (matches daily.js logic).
 * Run: node scripts/report-duration-flag-impact.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const LOOKBACK = 7;
const DAY_MINUTES = 1440;
const BLEND_ALPHA = 0.75;
const ABS_SLIGHT = 360;
const ABS_MOD = 300;
const ABS_SEV = 240;

function timeToMinutes(time) {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function durationMinutes(startMinutes, endMinutes) {
  return endMinutes >= startMinutes ? endMinutes - startMinutes : endMinutes + 1440 - startMinutes;
}

function calculateTotalSleep(day) {
  const sleepStart = timeToMinutes(day.sleepStart);
  const sleepEnd = timeToMinutes(day.sleepEnd);
  let total = durationMinutes(sleepStart, sleepEnd);
  if (day.nap && day.nap.start && day.nap.end) {
    total += durationMinutes(timeToMinutes(day.nap.start), timeToMinutes(day.nap.end));
  }
  return total;
}

function normalizeTimeForAveraging(minutes) {
  if (minutes < 720) return minutes + 1440;
  return minutes;
}

function normalizeWakeTimeForAveraging(sleepStartMinutes, wakeMinutes) {
  if (wakeMinutes < sleepStartMinutes) {
    return wakeMinutes + 1440;
  }
  if (sleepStartMinutes < 360 && wakeMinutes >= 600) {
    return wakeMinutes + 1440;
  }
  return normalizeTimeForAveraging(wakeMinutes);
}

function blendedVariationPercent(diffMinutes, avgSleepDurationMinutes) {
  const sleepBase = Math.max(avgSleepDurationMinutes, 1);
  const pctSleep = (diffMinutes / sleepBase) * 100;
  const pctDay = (diffMinutes / DAY_MINUTES) * 100;
  return BLEND_ALPHA * pctSleep + (1 - BLEND_ALPHA) * pctDay;
}

function severityFromBlendedPercent(p) {
  if (p < 5) return null;
  if (p < 10) return 'slight';
  if (p < 19) return 'moderate';
  return 'severe';
}

const RANK = { slight: 1, moderate: 2, severe: 3 };

function maxSeverity(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return RANK[a] >= RANK[b] ? a : b;
}

function severityFromAbsoluteTotalSleepMinutes(totalMinutes) {
  if (totalMinutes >= ABS_SLIGHT) return null;
  if (totalMinutes < ABS_SEV) return 'severe';
  if (totalMinutes < ABS_MOD) return 'moderate';
  return 'slight';
}

function normalizeFragmentationLevel(day) {
  const n = day && day.WASO;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const w = Math.floor(n);
  if (w < 1) return null;
  if (w === 1) return 'mild';
  if (w === 2) return 'moderate';
  return 'severe';
}

function wasoQualitySeverity(day) {
  const frag = normalizeFragmentationLevel(day);
  if (!frag) return null;
  if (frag === 'mild') return 'slight';
  if (frag === 'moderate') return 'moderate';
  return 'severe';
}

function calculateRecentAverages(days, currentIndex) {
  const startIndex = Math.max(0, currentIndex + 1);
  const endIndex = Math.min(days.length, currentIndex + 1 + LOOKBACK);
  const recentDays = days.slice(startIndex, endIndex);
  if (recentDays.length < LOOKBACK) return { insufficient: true };

  let fellAsleepTimeSum = 0;
  let wakeTimeSum = 0;
  let sleepDurationSum = 0;
  recentDays.forEach((day) => {
    const fellAsleepTime = timeToMinutes(day.sleepStart);
    fellAsleepTimeSum += normalizeTimeForAveraging(fellAsleepTime);
    const wakeTime = timeToMinutes(day.sleepEnd);
    wakeTimeSum += normalizeWakeTimeForAveraging(fellAsleepTime, wakeTime);
    sleepDurationSum += calculateTotalSleep(day);
  });

  return {
    insufficient: false,
    avgFellAsleepTime: fellAsleepTimeSum / recentDays.length,
    avgWakeTime: wakeTimeSum / recentDays.length,
    avgSleepDuration: sleepDurationSum / recentDays.length
  };
}

function analyzeDay(day, ra, durationMode) {
  const avgSleep = ra.avgSleepDuration;
  const fellAsleepTime = timeToMinutes(day.sleepStart);
  const normalizedFellAsleep = normalizeTimeForAveraging(fellAsleepTime);
  const asleepLaterThanAvg = normalizedFellAsleep > ra.avgFellAsleepTime;
  const asleepDiff = asleepLaterThanAvg ? normalizedFellAsleep - ra.avgFellAsleepTime : 0;
  const asleepSeverity = asleepLaterThanAvg
    ? severityFromBlendedPercent(blendedVariationPercent(asleepDiff, avgSleep))
    : null;

  const sleepDuration = calculateTotalSleep(day);
  const durationShorterThanAvg = sleepDuration < ra.avgSleepDuration;
  const durDiff = durationShorterThanAvg ? ra.avgSleepDuration - sleepDuration : 0;
  const relativeDurationSeverity = durationShorterThanAvg
    ? severityFromBlendedPercent(blendedVariationPercent(durDiff, avgSleep))
    : null;
  const absoluteDurationSeverity = severityFromAbsoluteTotalSleepMinutes(sleepDuration);
  const durationSeverity =
    durationMode === 'relative-only'
      ? relativeDurationSeverity
      : maxSeverity(relativeDurationSeverity, absoluteDurationSeverity);

  return { asleepSeverity, durationSeverity, relativeDurationSeverity, absoluteDurationSeverity };
}

function worstCalendarSeverity(day, ra, durationMode) {
  const t = analyzeDay(day, ra, durationMode);
  let worst = maxSeverity(t.asleepSeverity, t.durationSeverity);
  worst = maxSeverity(worst, wasoQualitySeverity(day));
  return worst || 'none';
}

const dataPath = path.join(__dirname, '..', 'sleep-data.json');
const days = JSON.parse(fs.readFileSync(dataPath, 'utf8')).days;

let newDurationFlagDays = 0;
let durationOnlySeverityChanged = 0;
let calendarCellChanged = 0;
const durationChangeDates = [];

for (let i = 0; i < days.length; i++) {
  const ra = calculateRecentAverages(days, i);
  if (ra.insufficient) continue;

  const day = days[i];
  const oldT = analyzeDay(day, ra, 'relative-only');
  const newT = analyzeDay(day, ra, 'combined');

  const oldDur = oldT.durationSeverity;
  const newDur = newT.durationSeverity;
  if (oldDur !== newDur) {
    durationOnlySeverityChanged += 1;
    durationChangeDates.push({
      date: day.date,
      old: oldDur || '—',
      new: newDur || '—',
      totalH: (calculateTotalSleep(day) / 60).toFixed(2),
      abs: newT.absoluteDurationSeverity || '—',
      rel: newT.relativeDurationSeverity || '—'
    });
  }

  if (!oldDur && newDur) {
    newDurationFlagDays += 1;
  }

  const oldCell = worstCalendarSeverity(day, ra, 'relative-only');
  const newCell = worstCalendarSeverity(day, ra, 'combined');
  if (oldCell !== newCell) {
    calendarCellChanged += 1;
  }
}

const withLookback = days.reduce((n, _, i) => n + (calculateRecentAverages(days, i).insufficient ? 0 : 1), 0);

console.log(JSON.stringify({
  daysWithSevenNightLookback: withLookback,
  newDurationFlagDays_noRelativeButNowFlagged: newDurationFlagDays,
  durationSeverityChangedDays_oldVsNew: durationOnlySeverityChanged,
  calendarCellWorstSeverityChangedDays: calendarCellChanged,
  sampleDurationChanges: durationChangeDates.slice(0, 20)
}, null, 2));
