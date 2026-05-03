/**
 * Pure time/date helpers (no DOM, no storage). Loaded before sleep-utils.js.
 */
(function (root) {
  'use strict';

  /**
   * Parse a wall-clock string to minutes from midnight (0–1439).
   * Accepts 24-hour "HH:MM" / "H:MM" and 12-hour "h:mm AM/PM" (case-insensitive).
   */
  function parseWallClockToMinutes(timeStr) {
    if (timeStr == null || timeStr === '') return NaN;
    const s = String(timeStr).trim();
    const m12 = s.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/);
    if (m12) {
      let h = parseInt(m12[1], 10);
      const min = parseInt(m12[2], 10);
      const ap = m12[3].toUpperCase();
      if (h < 1 || h > 12 || min < 0 || min > 59) return NaN;
      if (ap === 'AM') {
        h = h === 12 ? 0 : h;
      } else {
        h = h === 12 ? 12 : h + 12;
      }
      return h * 60 + min;
    }
    const m24 = s.match(/^(\d{1,2}):(\d{2})$/);
    if (m24) {
      const h = parseInt(m24[1], 10);
      const min = parseInt(m24[2], 10);
      if (h < 0 || h > 23 || min < 0 || min > 59) return NaN;
      return h * 60 + min;
    }
    return NaN;
  }

  function formatMinutesTo24hString(minutes) {
    const total = ((Math.round(Number(minutes)) % 1440) + 1440) % 1440;
    const hours = Math.floor(total / 60);
    const mins = total % 60;
    return String(hours).padStart(2, '0') + ':' + String(mins).padStart(2, '0');
  }

  function timeToMinutes(time) {
    return parseWallClockToMinutes(time);
  }

  function durationMinutes(startMinutes, endMinutes) {
    return endMinutes >= startMinutes ? endMinutes - startMinutes : endMinutes + 1440 - startMinutes;
  }

  function formatDuration(minutes) {
    const m = Math.round(minutes);
    const hours = Math.floor(m / 60);
    const mins = m % 60;
    if (hours === 0) return `${mins}m`;
    if (mins === 0) return `${hours}h`;
    return `${hours}h ${mins}m`;
  }

  /** Uses root.getClockFormatPreference when present (defined in sleep-utils.js after load). */
  function formatTime(minutes, shortMidnight = false) {
    const total = ((Math.round(minutes) % 1440) + 1440) % 1440;
    const hours = Math.floor(total / 60);
    const mins = total % 60;
    const clockFormat =
      typeof root.getClockFormatPreference === 'function' ? root.getClockFormatPreference() : '24h';
    if (clockFormat === '24h' && shortMidnight && hours === 0) {
      return `00`;
    }
    if (clockFormat === '12h') {
      const hour12 = hours % 12 || 12;
      const ampm = hours < 12 ? 'AM' : 'PM';
      return `${hour12}:${String(mins).padStart(2, '0')} ${ampm}`;
    }
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  }

  function isIsoSleepDateString(s) {
    return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.trim());
  }

  function parseIsoLocalDate(iso) {
    const m = String(iso)
      .trim()
      .match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const y = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10);
    const d = parseInt(m[3], 10);
    const dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
    return dt;
  }

  function formatIsoDateFromLocalDate(d) {
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + mo + '-' + day;
  }

  /**
   * Canonical sleep row key YYYY-MM-DD. Strict ISO calendar dates only (`YYYY-MM-DD`).
   * @param {string} input
   */
  function normalizeSleepDateKey(input) {
    if (input == null || input === '') return '';
    const s = String(input).trim();
    if (!s) return '';
    if (!isIsoSleepDateString(s)) return '';
    const d = parseIsoLocalDate(s);
    return d ? formatIsoDateFromLocalDate(d) : '';
  }

  /** Local midnight Date from sleep night key (ISO `YYYY-MM-DD` only). */
  function parseSleepDateToLocalDate(dateString) {
    if (!dateString) return new Date(NaN);
    const iso = normalizeSleepDateKey(dateString);
    if (!iso) return new Date(NaN);
    const d = parseIsoLocalDate(iso);
    return d || new Date(NaN);
  }

  /** Month/day display (e.g. `4/8`) for tooltips and headers; `isoOrKey` must be ISO `YYYY-MM-DD`. */
  function formatSleepDateMonthDay(isoOrKey) {
    const d = parseSleepDateToLocalDate(isoOrKey);
    if (Number.isNaN(d.getTime())) return String(isoOrKey || '');
    return d.getMonth() + 1 + '/' + d.getDate();
  }

  /** Advance ISO sleep night key by whole local calendar days (±). */
  function addCalendarDaysToSleepDateKey(isoKey, deltaDays) {
    const iso = normalizeSleepDateKey(isoKey);
    if (!iso || !Number.isFinite(deltaDays)) return '';
    const d = parseIsoLocalDate(iso);
    if (!d) return '';
    d.setDate(d.getDate() + deltaDays);
    return formatIsoDateFromLocalDate(d);
  }

  function normalizeTimeForAveraging(minutes) {
    if (minutes < 720) {
      return minutes + 1440;
    }
    return minutes;
  }

  /**
   * Wake clock (sleepEnd) on the same extended timeline as fell-asleep averaging.
   */
  function normalizeWakeTimeForAveraging(sleepStartMinutes, wakeMinutes) {
    if (wakeMinutes < sleepStartMinutes) {
      return wakeMinutes + 1440;
    }
    if (sleepStartMinutes < 360 && wakeMinutes >= 600) {
      return wakeMinutes + 1440;
    }
    return normalizeTimeForAveraging(wakeMinutes);
  }

  function denormalizeTimeForAveraging(normalizedMinutes) {
    return normalizedMinutes % 1440;
  }

  function normalizeTimeForComparison(minutes) {
    if (minutes >= 720) {
      return minutes - 1440;
    }
    return minutes;
  }

  function normalizeTimeForYAxis(minutes) {
    if (minutes < 1020) {
      return minutes + 1440;
    }
    return minutes;
  }

  function modMinutes1440(n) {
    return ((n % 1440) + 1440) % 1440;
  }

  function isValidClockMinute(n) {
    return Number.isInteger(n) && n >= 0 && n <= 1439;
  }

  /** Shortest signed difference `to − from` on the 24h circle, in [-720, 720]. */
  function shortestSignedClockDelta(fromMin, toMin) {
    const f = modMinutes1440(fromMin);
    const t = modMinutes1440(toMin);
    let d = t - f;
    if (d > 720) d -= 1440;
    if (d < -720) d += 1440;
    return d;
  }

  /** Shortest distance between two clock times on the 24h circle, in minutes ∈ [0, 720]. */
  function shortestClockGapMinutes(a, b) {
    return Math.abs(shortestSignedClockDelta(a, b));
  }

  root.parseWallClockToMinutes = parseWallClockToMinutes;
  root.formatMinutesTo24hString = formatMinutesTo24hString;
  root.timeToMinutes = timeToMinutes;
  root.durationMinutes = durationMinutes;
  root.formatDuration = formatDuration;
  root.formatTime = formatTime;
  root.isIsoSleepDateString = isIsoSleepDateString;
  root.parseIsoLocalDate = parseIsoLocalDate;
  root.formatIsoDateFromLocalDate = formatIsoDateFromLocalDate;
  root.normalizeSleepDateKey = normalizeSleepDateKey;
  root.parseSleepDateToLocalDate = parseSleepDateToLocalDate;
  root.formatSleepDateMonthDay = formatSleepDateMonthDay;
  root.addCalendarDaysToSleepDateKey = addCalendarDaysToSleepDateKey;
  root.normalizeTimeForAveraging = normalizeTimeForAveraging;
  root.normalizeWakeTimeForAveraging = normalizeWakeTimeForAveraging;
  root.denormalizeTimeForAveraging = denormalizeTimeForAveraging;
  root.normalizeTimeForComparison = normalizeTimeForComparison;
  root.normalizeTimeForYAxis = normalizeTimeForYAxis;
  root.modMinutes1440 = modMinutes1440;
  root.isValidClockMinute = isValidClockMinute;
  root.shortestSignedClockDelta = shortestSignedClockDelta;
  root.shortestClockGapMinutes = shortestClockGapMinutes;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
