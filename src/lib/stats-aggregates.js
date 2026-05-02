/**
 * Pure stats helpers for the matrix page (and math-tests).
 * Depends on globals from sleep-utils.js: timeToMinutes, normalizeTimeForAveraging,
 * denormalizeTimeForAveraging, normalizeWakeTimeForAveraging, isWeekend, isHoliday,
 * parseSleepDateToLocalDate, isNaturalWakeDay.
 */
(function (root) {
  'use strict';

  function isScheduledDay(day) {
    return !root.isWeekend(day.date) && !root.isHoliday(day.date);
  }

  /** @param {string} periodKey '7' | '30' | '90' | 'year' */
  function filterDaysByPeriod(days, periodKey, endDate) {
    if (!days || !days.length) return [];
    const end = new Date(endDate);
    end.setHours(0, 0, 0, 0);
    let start;
    if (periodKey === 'year') {
      start = new Date(end.getFullYear(), 0, 1);
    } else {
      const n = parseInt(periodKey, 10);
      const span = Number.isFinite(n) && n > 0 ? n : 7;
      start = new Date(end);
      start.setDate(start.getDate() - (span - 1));
    }
    return days.filter(function (day) {
      const d = root.parseSleepDateToLocalDate(day.date);
      if (Number.isNaN(d.getTime())) return false;
      d.setHours(0, 0, 0, 0);
      return d >= start && d <= end;
    });
  }

  function splitAllWorkFree(days) {
    const work = [];
    const free = [];
    for (let i = 0; i < days.length; i++) {
      const day = days[i];
      if (isScheduledDay(day)) work.push(day);
      else free.push(day);
    }
    return { all: days.slice(), work: work, free: free };
  }

  /** Shortest distance between two clock faces on a 24h circle (minutes). */
  function absClockDiffMinutes(a, b) {
    const d = Math.abs(a - b) % 1440;
    return Math.min(d, 1440 - d);
  }

  /** Signed difference from `from` to `to` on circle, range (-720, 720]. */
  function signedClockDiffMinutes(to, from) {
    let d = to - from;
    if (d > 720) d -= 1440;
    if (d <= -720) d += 1440;
    return d;
  }

  /**
   * Per-night mid-sleep clock (0–1439) after overnight adjustment; null if unusable.
   * Canonical with stats.js: mid = (ss + seAdj) / 2, midClock = round(mid) mod 1440.
   */
  function perNightMidSleepClockMinutes(day) {
    const ss = root.timeToMinutes(day.sleepStart);
    const se = root.timeToMinutes(day.sleepEnd);
    if (!Number.isFinite(ss) || !Number.isFinite(se)) return null;
    const seAdj = se < ss ? se + 1440 : se;
    const mid = (ss + seAdj) / 2;
    return ((Math.round(mid) % 1440) + 1440) % 1440;
  }

  /** Average mid-sleep clock using normalizeTimeForAveraging / denormalizeTimeForAveraging. */
  function averageMidSleepClockMinutes(days) {
    if (!days || !days.length) return null;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < days.length; i++) {
      const m = perNightMidSleepClockMinutes(days[i]);
      if (m === null) continue;
      sum += root.normalizeTimeForAveraging(m);
      n++;
    }
    if (!n) return null;
    return root.denormalizeTimeForAveraging(Math.round(sum / n));
  }

  /** |free − work| on circle (Roenneberg-style magnitude in minutes). */
  function socialLagMinutes(workDays, freeDays) {
    const w = averageMidSleepClockMinutes(workDays);
    const f = averageMidSleepClockMinutes(freeDays);
    if (w === null || f === null) return null;
    if (!workDays.length || !freeDays.length) return null;
    return absClockDiffMinutes(f, w);
  }

  function averageWakeClockMinutes(filtered) {
    if (!filtered || !filtered.length) return null;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < filtered.length; i++) {
      const day = filtered[i];
      const ss = root.timeToMinutes(day.sleepStart);
      const we = root.timeToMinutes(day.sleepEnd);
      if (!Number.isFinite(ss) || !Number.isFinite(we)) continue;
      sum += root.normalizeWakeTimeForAveraging(ss, we);
      n++;
    }
    if (!n) return null;
    return root.denormalizeTimeForAveraging(Math.round(sum / n));
  }

  /** Natural average minus alarm average (signed); positive ⇒ natural wake clock is later. */
  function wakeLagMinutes(periodDays) {
    if (!periodDays || !periodDays.length) return null;
    const natural = periodDays.filter(function (d) {
      return root.isNaturalWakeDay(d);
    });
    const alarm = periodDays.filter(function (d) {
      return !root.isNaturalWakeDay(d);
    });
    if (!natural.length || !alarm.length) return null;
    const avgN = averageWakeClockMinutes(natural);
    const avgA = averageWakeClockMinutes(alarm);
    if (avgN === null || avgA === null) return null;
    return signedClockDiffMinutes(avgN, avgA);
  }

  root.StatsAggregates = {
    isScheduledDay: isScheduledDay,
    filterDaysByPeriod: filterDaysByPeriod,
    splitAllWorkFree: splitAllWorkFree,
    perNightMidSleepClockMinutes: perNightMidSleepClockMinutes,
    averageMidSleepClockMinutes: averageMidSleepClockMinutes,
    absClockDiffMinutes: absClockDiffMinutes,
    signedClockDiffMinutes: signedClockDiffMinutes,
    socialLagMinutes: socialLagMinutes,
    wakeLagMinutes: wakeLagMinutes
  };
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
