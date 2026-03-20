// Shared utility functions for sleep tracking application

// Holiday calendar: { year: { month: [day, ...] } }. Exposed on window for pages that need the reference.
const HOLIDAYS_BY_YEAR = {
  2026: {
    1: [1, 2, 3, 12],
    2: [11, 23],
    3: [20],
    4: [29],
    5: [3, 4, 5, 6],
    6: [],
    7: [20],
    8: [11],
    9: [21, 22, 23],
    10: [12],
    11: [3, 23],
    12: [31]
  }
};
if (typeof window !== 'undefined') window.HOLIDAYS_BY_YEAR = HOLIDAYS_BY_YEAR;

// Convert HH:MM to minutes from midnight
function timeToMinutes(time) {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

// Minutes between start and end, handling midnight crossover
function durationMinutes(startMinutes, endMinutes) {
  return endMinutes >= startMinutes ? endMinutes - startMinutes : endMinutes + 1440 - startMinutes;
}

// Format minutes as "Xh Ym" or "Xh" or "Ym"
function formatDuration(minutes) {
  const m = Math.round(minutes);
  const hours = Math.floor(m / 60);
  const mins = m % 60;
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

// Format minutes from midnight as "HH:MM"
// Optionally return "00" for midnight (for graph display)
function formatTime(minutes, shortMidnight = false) {
  const total = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (shortMidnight && hours === 0) {
    return `00`;
  }
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

// Calculate sleep duration (including naps)
function calculateTotalSleep(day) {
  const sleepStart = timeToMinutes(day.sleepStart);
  const sleepEnd = timeToMinutes(day.sleepEnd);
  let total = durationMinutes(sleepStart, sleepEnd);
  if (day.nap && day.nap.start && day.nap.end) {
    total += durationMinutes(timeToMinutes(day.nap.start), timeToMinutes(day.nap.end));
  }
  return total;
}

// Parse date string to month and day array
function parseDateString(dateString) {
  return dateString.split('/').map(Number);
}

// Get date object from date string
function getDateFromString(dateString, year = 2026) {
  const [month, day] = parseDateString(dateString);
  return new Date(year, month - 1, day);
}

// Check if a date is a weekend (Saturday or Sunday)
// Accepts either a Date object or dateString
function isWeekend(dateOrString, year = 2026) {
  let date;
  if (dateOrString instanceof Date) {
    date = dateOrString;
  } else {
    date = getDateFromString(dateOrString, year);
  }
  return date.getDay() % 6 === 0; // 0 = Sunday, 6 = Saturday
}

// Check if a date is a holiday
// Accepts either a Date object or dateString. holidays is optional (defaults to HOLIDAYS_BY_YEAR).
function isHoliday(dateOrString, holidays, year = 2026) {
  const h = holidays ?? HOLIDAYS_BY_YEAR;
  let month, day;
  if (dateOrString instanceof Date) {
    month = dateOrString.getMonth() + 1; // getMonth() returns 0-11
    day = dateOrString.getDate();
  } else {
    [month, day] = parseDateString(dateOrString);
  }
  const yearHolidays = h[year];
  if (!yearHolidays) return false;
  return yearHolidays[month] && yearHolidays[month].includes(day);
}

// Normalize time for averaging (handles times that cross midnight)
// Times before noon (00:00-11:59) are treated as next day (add 1440)
// This ensures early morning fell asleep times are averaged correctly with late night times
function normalizeTimeForAveraging(minutes) {
  if (minutes < 720) { // Before noon (12:00)
    return minutes + 1440; // Add 24 hours
  }
  return minutes;
}

// Denormalize time back to 0-1440 range
function denormalizeTimeForAveraging(normalizedMinutes) {
  return normalizedMinutes % 1440;
}

// Normalize time for comparison (handles times that cross midnight)
// For bed times: times at/after noon (12:00-23:59) are normalized to negative values
// This allows correct comparison with times after midnight (00:00-11:59)
function normalizeTimeForComparison(minutes) {
  // If time is at or after noon (720 minutes), it's before midnight
  // Normalize by subtracting 1440 to make it negative for comparison
  if (minutes >= 720) {
    return minutes - 1440;
  }
  return minutes;
}

// Normalize time for Y-axis positioning where chart starts at 17:00.
function normalizeTimeForYAxis(minutes) {
  if (minutes < 1020) {
    return minutes + 1440;
  }
  return minutes;
}

// Calculate longest uninterrupted sleep (ignoring bathroom, including alarms and sick)
function calculateLongestUninterrupted(day) {
  const sleepStart = timeToMinutes(day.sleepStart);
  const sleepEnd = timeToMinutes(day.sleepEnd);
  const normalizedSleepEnd = sleepEnd >= sleepStart ? sleepEnd : sleepEnd + 1440;
  const sleepDuration = durationMinutes(sleepStart, sleepEnd);

  const normalizeInterruption = (m) => {
    if (sleepEnd < sleepStart && m < sleepStart) {
      return m + 1440;
    }
    return m;
  };

  const alarmInterruptions = (day.alarm || [])
    .map(timeToMinutes)
    .map(normalizeInterruption)
    .filter(m => m >= sleepStart && m <= normalizedSleepEnd);

  const sickInterruptions = (day.sick || [])
    .map(timeToMinutes)
    .map(normalizeInterruption)
    .filter(m => m >= sleepStart && m <= normalizedSleepEnd);

  const interruptions = [...alarmInterruptions, ...sickInterruptions];
  interruptions.sort((a, b) => a - b);

  if (interruptions.length === 0) {
    return sleepDuration;
  }

  let longest = 0;
  let start = sleepStart;
  for (const interrupt of interruptions) {
    const duration = interrupt - start;
    if (duration > longest) longest = duration;
    start = interrupt;
  }

  const lastDuration = normalizedSleepEnd - start;
  if (lastDuration > longest) longest = lastDuration;
  return longest;
}

// Calculate time from first alarm to get up
function calculateFirstAlarmToWake(day) {
  if (!day.alarm || day.alarm.length === 0) {
    return null;
  }
  const firstAlarm = Math.min(...day.alarm.map(timeToMinutes));
  const wakeTime = timeToMinutes(day.sleepEnd);
  return wakeTime - firstAlarm;
}

// Calculate delay from bed time to falling asleep
function calculateSleepDelay(day) {
  const bedTime = timeToMinutes(day.bed);
  const sleepStart = timeToMinutes(day.sleepStart);
  let delay = sleepStart - bedTime;
  if (delay < 0) delay += 1440;
  return delay;
}

// Calculate delay from first alarm to wake time (snooze delay)
function calculateWakeDelay(day) {
  if (!day.alarm || day.alarm.length === 0) {
    return null;
  }
  const firstAlarm = Math.min(...day.alarm.map(timeToMinutes));
  const wakeTime = timeToMinutes(day.sleepEnd);
  let delay = wakeTime - firstAlarm;
  if (delay < 0 && firstAlarm >= 1080) {
    delay = (wakeTime + 1440) - firstAlarm;
  }
  return delay > 0 ? delay : null;
}

function calculateBedToSleepDelay(day) {
  return calculateSleepDelay(day);
}

function calculateNapDuration(day) {
  if (!day.nap || !day.nap.start || !day.nap.end) return null;
  return durationMinutes(timeToMinutes(day.nap.start), timeToMinutes(day.nap.end));
}

function solveLinearSystem(A, b) {
  const n = A.length;
  const augmented = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < n; i++) {
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(augmented[k][i]) > Math.abs(augmented[maxRow][i])) {
        maxRow = k;
      }
    }
    [augmented[i], augmented[maxRow]] = [augmented[maxRow], augmented[i]];
    for (let k = i + 1; k < n; k++) {
      const factor = augmented[k][i] / augmented[i][i];
      for (let j = i; j <= n; j++) {
        augmented[k][j] -= factor * augmented[i][j];
      }
    }
  }
  const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    x[i] = augmented[i][n];
    for (let j = i + 1; j < n; j++) x[i] -= augmented[i][j] * x[j];
    x[i] /= augmented[i][i];
  }
  return x;
}

function polynomialRegression(xValues, yValues, degree = 2) {
  const n = xValues.length;
  const X = [];
  for (let i = 0; i < n; i++) {
    const row = [];
    for (let d = degree; d >= 0; d--) row.push(Math.pow(xValues[i], d));
    X.push(row);
  }
  const XTX = [];
  const XTY = [];
  for (let i = 0; i <= degree; i++) {
    XTX[i] = [];
    XTY[i] = 0;
    for (let j = 0; j <= degree; j++) {
      let sum = 0;
      for (let k = 0; k < n; k++) sum += X[k][i] * X[k][j];
      XTX[i][j] = sum;
    }
    for (let k = 0; k < n; k++) XTY[i] += X[k][i] * yValues[k];
  }
  return solveLinearSystem(XTX, XTY);
}

function evaluatePolynomial(coefficients, x) {
  let result = 0;
  for (let i = 0; i < coefficients.length; i++) {
    result += coefficients[i] * Math.pow(x, coefficients.length - 1 - i);
  }
  return result;
}

// Project repo (used in nav bar)
const GITHUB_REPO_URL = 'https://github.com/rsairu/sleep/';

// Day/night mode: sunrise and sunset in local time (hours 0-23, minutes 0-59)
const SUNRISE_MINUTES = 6 * 60;
const SUNSET_MINUTES = 18 * 60;

const THEME_OVERRIDE_KEY = 'sleep-app-theme-override';
const REMAINING_WAKE_THRESHOLDS_KEY = 'sleep-app-remaining-wake-thresholds';

// Default remaining wake phase thresholds (percent of wake time remaining): open >= openMin, winding >= windingMin, presleep < windingMin.
const DEFAULT_REMAINING_WAKE_OPEN_MIN = 30;
const DEFAULT_REMAINING_WAKE_WINDING_MIN = 10;

// Returns { openMin, windingMin } from localStorage or defaults. Values are in 0–100, step 5.
function getRemainingWakeThresholds() {
  try {
    const raw = localStorage.getItem(REMAINING_WAKE_THRESHOLDS_KEY);
    if (raw) {
      const o = JSON.parse(raw);
      const openMin = clampThresholdStep5(typeof o.openMin === 'number' ? o.openMin : DEFAULT_REMAINING_WAKE_OPEN_MIN);
      const windingMin = clampThresholdStep5(typeof o.windingMin === 'number' ? o.windingMin : DEFAULT_REMAINING_WAKE_WINDING_MIN);
      if (openMin > windingMin) return { openMin, windingMin };
    }
  } catch (_) {}
  return { openMin: DEFAULT_REMAINING_WAKE_OPEN_MIN, windingMin: DEFAULT_REMAINING_WAKE_WINDING_MIN };
}

function clampThresholdStep5(n) {
  const step = 5;
  const v = Math.round(n / step) * step;
  return Math.min(100, Math.max(0, v));
}

// Saves thresholds to localStorage. openMin and windingMin must satisfy openMin > windingMin.
function setRemainingWakeThresholds(openMin, windingMin) {
  openMin = clampThresholdStep5(openMin);
  windingMin = clampThresholdStep5(windingMin);
  if (openMin <= windingMin) return;
  try {
    localStorage.setItem(REMAINING_WAKE_THRESHOLDS_KEY, JSON.stringify({ openMin, windingMin }));
  } catch (_) {}
}

// Returns 'day' if current local time is between sunrise and sunset, else 'night'
function getThemeFromTime() {
  const now = new Date();
  const minutesSinceMidnight = now.getHours() * 60 + now.getMinutes();
  return minutesSinceMidnight >= SUNRISE_MINUTES && minutesSinceMidnight < SUNSET_MINUTES ? 'day' : 'night';
}

// Returns current theme override from localStorage ('day' | 'night' | null)
function getThemeOverride() {
  try {
    const v = localStorage.getItem(THEME_OVERRIDE_KEY);
    return v === 'day' || v === 'night' ? v : null;
  } catch (_) {
    return null;
  }
}

// Sets theme override and saves to localStorage (null = auto)
function setThemeOverride(theme) {
  try {
    if (theme === null) localStorage.removeItem(THEME_OVERRIDE_KEY);
    else localStorage.setItem(THEME_OVERRIDE_KEY, theme);
  } catch (_) {}
}

// Effective theme: override if set, otherwise from time
function getEffectiveTheme() {
  const override = getThemeOverride();
  return override !== null ? override : getThemeFromTime();
}

// Applies day or night theme to the document; uses override if set. Returns effective theme.
function applyDayNightTheme() {
  const theme = getEffectiveTheme();
  document.documentElement.dataset.theme = theme;
  return theme;
}

const SUN_ICON = '<svg xmlns="http://www.w3.org/2000/svg" class="nav-daynight-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.25a.75.75 0 01.75.75v2.25a.75.75 0 01-1.5 0V3a.75.75 0 01.75-.75zM7.5 12a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM18.894 6.166a.75.75 0 00-1.06-1.06l-1.591 1.59a.75.75 0 101.06 1.061l1.591-1.59zM21.75 12a.75.75 0 01-.75.75h-2.25a.75.75 0 010-1.5H21a.75.75 0 01.75.75zM17.834 18.894a.75.75 0 001.06-1.06l-1.59-1.591a.75.75 0 10-1.061 1.06l1.59 1.591zM12 18a.75.75 0 01.75.75V21a.75.75 0 01-1.5 0v-2.25A.75.75 0 0112 18zM5.106 18.894a.75.75 0 001.06 1.06l1.591-1.59a.75.75 0 10-1.06-1.061l-1.591 1.59zM6 12a.75.75 0 01-.75.75H3a.75.75 0 010-1.5h2.25A.75.75 0 016 12zM6.697 7.757l-1.59-1.591a.75.75 0 00-1.061 1.06l1.59 1.591a.75.75 0 001.061-1.06z"/></svg>';
const MOON_ICON = '<svg class="nav-daynight-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z"/></svg>';

function getDayNightTitle(theme, isOverride) {
  const mode = theme.charAt(0).toUpperCase() + theme.slice(1);
  return `${mode} mode (${isOverride ? 'manual' : 'auto'})`;
}

// Returns HTML for the day/night toggle (sun | moon, active state highlighted)
function getDayNightToggleHTML(theme) {
  const isOverride = getThemeOverride() !== null;
  const dayActive = theme === 'day';
  const nightActive = theme === 'night';
  const dayTitle = getDayNightTitle('day', isOverride);
  const nightTitle = getDayNightTitle('night', isOverride);
  return (
    '<div id="nav-daynight" class="nav-daynight-toggle" role="group" aria-label="Theme">' +
      '<button type="button" class="nav-daynight-option' + (dayActive ? ' active' : '') + '" data-theme="day" title="Light mode" aria-label="Light mode" aria-pressed="' + dayActive + '">' + SUN_ICON + '</button>' +
      '<button type="button" class="nav-daynight-option' + (nightActive ? ' active' : '') + '" data-theme="night" title="Dark mode" aria-label="Dark mode" aria-pressed="' + nightActive + '">' + MOON_ICON + '</button>' +
    '</div>'
  );
}

// Returns HTML for the animated sun/moon toggle (used in nav menu and config page). clipPathIdSuffix must be unique per page (e.g. 'nav', 'config').
function getThemeToggleHTML(nightActive, buttonId, clipPathIdSuffix) {
  buttonId = buttonId || 'nav-menu-theme-toggle';
  clipPathIdSuffix = clipPathIdSuffix || 'nav';
  const cutoutId = 'theme-toggle__classic__cutout__' + clipPathIdSuffix;
  return (
    '<button type="button" class="theme-toggle' + (nightActive ? ' theme-toggle--toggled' : '') + '" id="' + buttonId + '" title="Toggle theme" aria-label="Toggle theme" aria-pressed="' + nightActive + '">' +
      '<span class="theme-toggle-sr">Toggle theme</span>' +
      '<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" width="1em" height="1em" fill="currentColor" stroke-linecap="round" class="theme-toggle__classic" viewBox="0 0 32 32">' +
        '<clipPath id="' + cutoutId + '"><path d="M0-5h30a1 1 0 0 0 9 13v24H0Z"/></clipPath>' +
        '<g clip-path="url(#' + cutoutId + ')">' +
          '<circle cx="16" cy="16" r="9.34"/>' +
          '<g stroke="currentColor" stroke-width="1.5">' +
            '<path d="M16 5.5v-4"/><path d="M16 30.5v-4"/><path d="M1.5 16h4"/><path d="M26.5 16h4"/>' +
            '<path d="m23.4 8.6 2.8-2.8"/><path d="m5.7 26.3 2.9-2.9"/><path d="m5.8 5.8 2.8 2.8"/><path d="m23.4 23.4 2.9 2.9"/>' +
          '</g>' +
        '</g>' +
      '</svg>' +
    '</button>'
  );
}

// Updates the nav day/night toggle active state (e.g. after theme tick or click)
function updateDayNightIcon() {
  const theme = getEffectiveTheme();
  const pillWrap = document.getElementById('nav-daynight');
  if (pillWrap) {
    pillWrap.querySelectorAll('.nav-daynight-option').forEach(btn => {
      const isActive = btn.getAttribute('data-theme') === theme;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', isActive);
    });
  }
  const menuToggle = document.getElementById('nav-menu-theme-toggle');
  if (menuToggle) {
    menuToggle.classList.toggle('theme-toggle--toggled', theme === 'night');
    menuToggle.setAttribute('aria-pressed', theme === 'night');
  }
  const configToggle = document.getElementById('config-theme-toggle');
  if (configToggle) {
    configToggle.classList.toggle('theme-toggle--toggled', theme === 'night');
    configToggle.setAttribute('aria-pressed', theme === 'night');
  }
}

// Toggle theme: click sets theme to the chosen option (day or night)
function handleDayNightClick(e) {
  const btn = e.target.closest('.nav-daynight-option');
  if (!btn) return;
  const theme = btn.getAttribute('data-theme');
  if (theme !== 'day' && theme !== 'night') return;
  setThemeChoice(theme);
}

// Set theme from a choice: 'day' | 'night' | 'auto'. Updates override, applies theme, nav toggle, and config selector.
function setThemeChoice(choice) {
  if (choice !== 'auto' && choice !== 'day' && choice !== 'night') return;
  setThemeOverride(choice === 'auto' ? null : choice);
  applyDayNightTheme();
  updateDayNightIcon();
  updateThemeSelectors();
}

// Updates theme selector active state on Config page (Auto button; Light/Dark row state is in the toggle).
function updateThemeSelectors() {
  const wrap = document.getElementById('config-theme');
  if (!wrap) return;
  const override = getThemeOverride();
  wrap.querySelectorAll('.about-theme-option').forEach(btn => {
    const isActive = btn.getAttribute('data-theme') === 'auto' && override === null;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', isActive);
  });
}

// Initializes the Config page theme selector: inject Light/Dark toggle, attach row and Auto handlers.
function initConfigThemeSelector() {
  const wrap = document.getElementById('config-theme');
  if (!wrap) return;
  const toggleWrap = document.getElementById('config-theme-toggle-wrap');
  if (toggleWrap) {
    const theme = getEffectiveTheme();
    toggleWrap.innerHTML = getThemeToggleHTML(theme === 'night', 'config-theme-toggle', 'config');
  }
  updateDayNightIcon();
  updateThemeSelectors();

  const lightDarkRow = document.getElementById('config-theme-light-dark-row');
  if (lightDarkRow) {
    lightDarkRow.addEventListener('click', function (e) {
      e.preventDefault();
      const current = getEffectiveTheme();
      setThemeChoice(current === 'day' ? 'night' : 'day');
    });
    lightDarkRow.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const current = getEffectiveTheme();
        setThemeChoice(current === 'day' ? 'night' : 'day');
      }
    });
  }

  wrap.addEventListener('click', function (e) {
    const btn = e.target.closest('.about-theme-option');
    if (!btn) return;
    const choice = btn.getAttribute('data-theme');
    if (choice !== 'auto') return;
    setThemeChoice('auto');
  });
}

// 0–1440 modular arithmetic (JavaScript % can be negative).
function modMinutes1440(n) {
  return ((n % 1440) + 1440) % 1440;
}

/** Last 7 days in `days`: average get-up, average fell-asleep, and wake-window length (minutes between them). */
function computeRecentSevenDayWakeBasis(days) {
  if (!days || days.length === 0) return null;
  const recent = days.slice(0, Math.min(7, days.length));
  let sleepStartSum = 0;
  let sleepEndSum = 0;
  for (let i = 0; i < recent.length; i++) {
    const d = recent[i];
    sleepStartSum += normalizeTimeForAveraging(timeToMinutes(d.sleepStart));
    sleepEndSum += normalizeTimeForAveraging(timeToMinutes(d.sleepEnd));
  }
  const n = recent.length;
  const avgSleepStart = denormalizeTimeForAveraging(Math.round(sleepStartSum / n));
  const avgSleepEnd = denormalizeTimeForAveraging(Math.round(sleepEndSum / n));
  const totalWakeMins = durationMinutes(avgSleepEnd, avgSleepStart);
  return { avgSleepStart, avgSleepEnd, totalWakeMins };
}

/** Wall-clock minute (0–1439) when only `percentWakeRemaining` of the average wake window remains before average sleep. */
function wakePercentToClockMinutes(basis, percentWakeRemaining) {
  if (!basis || basis.totalWakeMins <= 0) return null;
  const rem = (percentWakeRemaining / 100) * basis.totalWakeMins;
  return Math.round(modMinutes1440(basis.avgSleepStart - rem));
}

// Filled when config page loads sleep data (for threshold clock labels under sliders).
let configRemainingWakeBasis = null;

// Bar uses position from left: 0 = 100% remaining (open), 100 = 0% remaining. pos1 = open/winding boundary, pos2 = winding/presleep.
function applyRemainingWakeThresholdsUI(pos1, pos2) {
  const segOpen = document.getElementById('config-rw-seg-open');
  const segWinding = document.getElementById('config-rw-seg-winding');
  const segPresleep = document.getElementById('config-rw-seg-presleep');
  const iconOpen = document.getElementById('config-rw-icon-open');
  const iconWinding = document.getElementById('config-rw-icon-winding');
  const iconPresleep = document.getElementById('config-rw-icon-presleep');
  const inputOpen = document.getElementById('config-open-min');
  const inputWinding = document.getElementById('config-winding-min');
  if (!segOpen || !segWinding || !segPresleep || !iconOpen || !iconWinding || !iconPresleep || !inputOpen || !inputWinding) return;

  const p1 = Math.min(95, Math.max(5, pos1));
  const p2 = Math.min(100, Math.max(p1 + 5, pos2));

  segOpen.style.flex = '0 0 ' + p1 + '%';
  segWinding.style.flex = '0 0 ' + (p2 - p1) + '%';
  segPresleep.style.flex = '0 0 ' + (100 - p2) + '%';
  iconOpen.style.flex = '0 0 ' + p1 + '%';
  iconWinding.style.flex = '0 0 ' + (p2 - p1) + '%';
  iconPresleep.style.flex = '0 0 ' + (100 - p2) + '%';
  inputOpen.value = p1;
  inputWinding.value = p2;

  const openMin = 100 - p1;
  const windingMin = 100 - p2;
  const basis = configRemainingWakeBasis;
  const clockOpen = basis ? wakePercentToClockMinutes(basis, openMin) : null;
  const clockWinding = basis ? wakePercentToClockMinutes(basis, windingMin) : null;
  const timeOpen = clockOpen != null ? formatTime(clockOpen) : '—';
  const timeWinding = clockWinding != null ? formatTime(clockWinding) : '—';

  const percentLeft = document.getElementById('config-rw-percent-left');
  const percentRight = document.getElementById('config-rw-percent-right');
  if (percentLeft) {
    percentLeft.style.left = p1 + '%';
    const pct = percentLeft.querySelector('.config-rw-thumb-pct');
    const tim = percentLeft.querySelector('.config-rw-thumb-time');
    if (pct) pct.textContent = openMin + '%';
    if (tim) tim.textContent = timeOpen;
    percentLeft.setAttribute(
      'aria-label',
      'Active until ' + openMin + '% wake time remains, around ' + timeOpen + ' with your 7-day averages'
    );
  }
  if (percentRight) {
    percentRight.style.left = p2 + '%';
    const pct = percentRight.querySelector('.config-rw-thumb-pct');
    const tim = percentRight.querySelector('.config-rw-thumb-time');
    if (pct) pct.textContent = windingMin + '%';
    if (tim) tim.textContent = timeWinding;
    percentRight.setAttribute(
      'aria-label',
      'Winding down until ' + windingMin + '% wake time remains, around ' + timeWinding + ' with your 7-day averages'
    );
  }
}

// Snap value to 0, 5, 10, ... 100
function snapPercentTo5(frac) {
  const v = Math.round(frac * 20) * 5;
  return Math.min(100, Math.max(0, v));
}

/** Markup for the default-values control + bar/sliders (Settings and About). `ariaLabelledBy` is the id of the visible section heading. */
function getRemainingWakeThresholdsControlHTML(ariaLabelledBy) {
  const labelId = ariaLabelledBy || 'remaining-wake-thresholds';
  return (
    '<p class="config-remaining-wake-default-row">' +
      '<button type="button" class="config-rw-defaults-button" id="config-rw-use-defaults">Use default values <span class="config-rw-default-values"></span></button>' +
    '</p>' +
    '<div class="config-remaining-wake" id="config-remaining-wake" role="group" aria-labelledby="' +
    labelId +
    '">' +
    '<div class="config-remaining-wake-icons" aria-hidden="true">' +
    '<span class="config-remaining-wake-icon-seg" id="config-rw-icon-open"><span class="config-rw-icon-emoji">☀️</span><span class="config-rw-icon-label">Active</span></span>' +
    '<span class="config-remaining-wake-icon-seg" id="config-rw-icon-winding"><span class="config-rw-icon-emoji">🌇</span><span class="config-rw-icon-label">Winding</span></span>' +
    '<span class="config-remaining-wake-icon-seg" id="config-rw-icon-presleep"><span class="config-rw-icon-emoji">🛏️</span><span class="config-rw-icon-label">Pre-sleep</span></span>' +
    '</div>' +
    '<div class="config-remaining-wake-bar-wrap">' +
    '<div class="config-remaining-wake-bar">' +
    '<div class="config-remaining-wake-seg config-remaining-wake-seg--open" id="config-rw-seg-open"></div>' +
    '<div class="config-remaining-wake-seg config-remaining-wake-seg--winding" id="config-rw-seg-winding"></div>' +
    '<div class="config-remaining-wake-seg config-remaining-wake-seg--presleep" id="config-rw-seg-presleep"></div>' +
    '</div>' +
    '<input type="range" id="config-open-min" min="0" max="100" step="5" value="70" aria-label="Active / Winding boundary (percent remaining)" tabindex="0">' +
    '<input type="range" id="config-winding-min" min="0" max="100" step="5" value="90" aria-label="Winding / Pre-sleep boundary (percent remaining)" tabindex="0">' +
    '<div class="config-remaining-wake-bar-overlay" id="config-rw-bar-overlay" aria-hidden="true"></div>' +
    '</div>' +
    '<div class="config-remaining-wake-labels">' +
    '<span>Wake</span><span>Sleep</span>' +
    '</div>' +
    '<div class="config-remaining-wake-percent-under" id="config-rw-percent-under" aria-live="polite">' +
    '<span class="config-rw-percent-thumb" id="config-rw-percent-left">' +
    '<span class="config-rw-thumb-pct">30%</span><span class="config-rw-thumb-time" aria-hidden="true">—</span>' +
    '</span>' +
    '<span class="config-rw-percent-thumb" id="config-rw-percent-right">' +
    '<span class="config-rw-thumb-pct">10%</span><span class="config-rw-thumb-time" aria-hidden="true">—</span>' +
    '</span>' +
    '</div>' +
    '</div>'
  );
}

// Initializes remaining wake thresholds UI: bar, sliders, localStorage (Settings and About).
function initRemainingWakeThresholdsConfig() {
  const inputOpen = document.getElementById('config-open-min');
  const inputWinding = document.getElementById('config-winding-min');
  const barWrap = document.getElementById('config-rw-bar-overlay') && document.getElementById('config-rw-bar-overlay').parentElement;
  const overlay = document.getElementById('config-rw-bar-overlay');
  if (!inputOpen || !inputWinding || !barWrap || !overlay) return;

  fetch('sleep-data.json')
    .then(function (r) {
      return r.json();
    })
    .then(function (data) {
      configRemainingWakeBasis = computeRecentSevenDayWakeBasis(data.days);
      const { openMin, windingMin } = getRemainingWakeThresholds();
      applyRemainingWakeThresholdsUI(100 - openMin, 100 - windingMin);
    })
    .catch(function () {
      configRemainingWakeBasis = null;
      const { openMin, windingMin } = getRemainingWakeThresholds();
      applyRemainingWakeThresholdsUI(100 - openMin, 100 - windingMin);
    });

  const { openMin, windingMin } = getRemainingWakeThresholds();
  const pos1 = 100 - openMin;
  const pos2 = 100 - windingMin;
  applyRemainingWakeThresholdsUI(pos1, pos2);

  function syncFromInputs() {
    let p1 = parseInt(inputOpen.value, 10) || 70;
    let p2 = parseInt(inputWinding.value, 10) || 90;
    if (p1 >= p2) {
      p2 = Math.min(100, p1 + 5);
      p1 = Math.max(0, p2 - 5);
    }
    applyRemainingWakeThresholdsUI(p1, p2);
    const openMinNew = 100 - p1;
    const windingMinNew = 100 - p2;
    if (openMinNew > windingMinNew) setRemainingWakeThresholds(openMinNew, windingMinNew);
  }

  inputOpen.addEventListener('input', syncFromInputs);
  inputWinding.addEventListener('input', syncFromInputs);

  // Overlay: decide which slider to move from pointer x, then update that slider so right thumb is grabbable
  let dragging = null; // 'open' | 'winding'

  function getValueFromEvent(e) {
    const rect = barWrap.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const frac = (clientX - rect.left) / rect.width;
    return snapPercentTo5(frac);
  }

  function onPointerDown(e) {
    if (e.button !== 0 && !e.touches) return;
    if (e.touches && e.touches.length > 1) return;
    e.preventDefault();
    const val = getValueFromEvent(e);
    const p1 = parseInt(inputOpen.value, 10);
    const p2 = parseInt(inputWinding.value, 10);
    const mid = (p1 + p2) / 2;
    if (val <= mid) {
      dragging = 'open';
      inputOpen.value = String(Math.min(p2 - 5, val));
    } else {
      dragging = 'winding';
      inputWinding.value = String(Math.max(p1 + 5, val));
    }
    syncFromInputs();
  }

  function onPointerMove(e) {
    if (!dragging) return;
    if (e.cancelable) e.preventDefault();
    const val = getValueFromEvent(e);
    const p1 = parseInt(inputOpen.value, 10);
    const p2 = parseInt(inputWinding.value, 10);
    if (dragging === 'open') {
      inputOpen.value = String(Math.min(p2 - 5, val));
    } else {
      inputWinding.value = String(Math.max(p1 + 5, val));
    }
    syncFromInputs();
  }

  function onPointerUp() {
    dragging = null;
  }

  overlay.addEventListener('mousedown', onPointerDown);
  overlay.addEventListener('touchstart', onPointerDown, { passive: false });
  document.addEventListener('mousemove', onPointerMove);
  document.addEventListener('mouseup', onPointerUp);
  document.addEventListener('touchmove', onPointerMove, { passive: false });
  document.addEventListener('touchend', onPointerUp);
  document.addEventListener('touchcancel', onPointerUp);

  const defaultsBtn = document.getElementById('config-rw-use-defaults');
  if (defaultsBtn) {
    const defaultsLabel = `(${DEFAULT_REMAINING_WAKE_OPEN_MIN}%, ${DEFAULT_REMAINING_WAKE_WINDING_MIN}%)`;
    const span = defaultsBtn.querySelector('.config-rw-default-values');
    if (span) span.textContent = defaultsLabel;
    defaultsBtn.setAttribute(
      'aria-label',
      'Reset remaining wake thresholds to defaults: ' +
        DEFAULT_REMAINING_WAKE_OPEN_MIN +
        '% and ' +
        DEFAULT_REMAINING_WAKE_WINDING_MIN +
        '%'
    );
    defaultsBtn.addEventListener('click', function () {
      setRemainingWakeThresholds(DEFAULT_REMAINING_WAKE_OPEN_MIN, DEFAULT_REMAINING_WAKE_WINDING_MIN);
      const pos1 = 100 - DEFAULT_REMAINING_WAKE_OPEN_MIN;
      const pos2 = 100 - DEFAULT_REMAINING_WAKE_WINDING_MIN;
      applyRemainingWakeThresholdsUI(pos1, pos2);
    });
  }
}

// Initializes day/night theme, click handler, and timer to re-check (when in auto mode)
function initDayNightTheme() {
  applyDayNightTheme();
  updateDayNightIcon();
  const pillWrap = document.getElementById('nav-daynight');
  if (pillWrap) pillWrap.addEventListener('click', handleDayNightClick);
  initNavMenu();
  setInterval(function () {
    applyDayNightTheme();
    updateDayNightIcon();
  }, 60000);
}

// Hamburger menu: toggle dropdown, theme buttons, close on outside click
function initNavMenu() {
  const trigger = document.getElementById('nav-menu-trigger');
  const dropdown = document.getElementById('nav-menu-dropdown');
  if (!trigger || !dropdown) return;

  function closeMenu() {
    trigger.setAttribute('aria-expanded', 'false');
    dropdown.classList.remove('nav-menu-dropdown--open');
    dropdown.hidden = true;
  }

  function openMenu() {
    trigger.setAttribute('aria-expanded', 'true');
    dropdown.classList.add('nav-menu-dropdown--open');
    dropdown.hidden = false;
  }

  function toggleMenu() {
    const isOpen = dropdown.classList.contains('nav-menu-dropdown--open');
    if (isOpen) closeMenu();
    else openMenu();
  }

  trigger.addEventListener('click', function (e) {
    e.stopPropagation();
    toggleMenu();
  });

  const themeToggle = document.getElementById('nav-menu-theme-toggle');
  const themeRow = themeToggle ? themeToggle.closest('.nav-menu-theme-row') : null;
  if (themeRow) {
    themeRow.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      const current = getEffectiveTheme();
      setThemeChoice(current === 'day' ? 'night' : 'day');
    });
  }

  dropdown.querySelectorAll('a.nav-menu-item').forEach(link => {
    link.addEventListener('click', closeMenu);
  });

  document.addEventListener('click', function (e) {
    if (dropdown.classList.contains('nav-menu-dropdown--open') && !trigger.contains(e.target) && !dropdown.contains(e.target)) {
      closeMenu();
    }
  });
}

// Render navigation bar
function renderNavBar(currentPage) {
  applyDayNightTheme();

  const pages = [
    { id: 'dashboard', name: 'Dashboard', url: 'dashboard.html', icon: '🛌' },
    { id: 'quality', name: 'Quality', url: 'quality.html', icon: '🟢' },
    { id: 'timeline', name: 'Daily', url: 'daily.html', icon: '📅' },
    { id: 'graph', name: 'Graphs', url: 'graph.html', icon: '📊' },
    { id: 'stats', name: 'Stats', url: 'stats.html', icon: '🔢' }
  ];

  const navItems = pages.map(page => {
    const isActive = page.id === currentPage;
    return `<a href="${page.url}" class="nav-tab ${isActive ? 'active' : ''}" aria-label="${page.name}"><span class="nav-icon">${page.icon}</span><span class="nav-tab-label">${page.name}</span></a>`;
  }).join('');

  const theme = getEffectiveTheme();
  const nightActive = theme === 'night';
  const hamburgerIcon = '<svg class="nav-menu-trigger-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z"/></svg>';
  const menuTrigger = `<button type="button" class="nav-menu-trigger" id="nav-menu-trigger" aria-label="Options" aria-expanded="false" aria-haspopup="true">${hamburgerIcon}</button>`;
  const configIcon = `<svg class="nav-menu-item-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 15.5A3.5 3.5 0 0 1 8.5 12 3.5 3.5 0 0 1 12 8.5a3.5 3.5 0 0 1 3.5 3.5 3.5 3.5 0 0 1-3.5 3.5m7.43-2.53c.04-.32.07-.64.07-.97 0-.33-.03-.66-.07-1l2.11-1.63c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.31-.61-.22l-2.49 1c-.52-.39-1.06-.73-1.69-.98l-.37-2.65A.506.506 0 0 0 14 2h-4c-.25 0-.46.18-.5.42l-.37 2.65c-.63.25-1.17.59-1.69.98l-2.49-1c-.22-.09-.49 0-.61.22l-2 3.46c-.13.22-.08.49.12.64L4.57 11c-.04.34-.07.67-.07 1 0 .33.03.65.07.97l-2.11 1.66c-.19.15-.25.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1.01c.52.4 1.06.74 1.69.99l.37 2.65c.04.24.25.42.5.42h4c.25 0 .46-.18.5-.42l.37-2.65c.63-.26 1.17-.59 1.69-.99l2.49 1.01c.22.08.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.66z"/></svg>`;
  const aboutIcon = `<svg class="nav-menu-item-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>`;
  const githubIcon = `<svg class="nav-menu-item-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>`;
  // Theme toggle: animated sun/moon from toggles.dev by Alfie Jones (https://toggles.dev). clipPathIdSuffix avoids duplicate IDs when nav + config both have the toggle.
  const themeToggleHTML = getThemeToggleHTML(nightActive, 'nav-menu-theme-toggle', 'nav');
  const menuItems = (
    '<div class="nav-menu-dropdown" id="nav-menu-dropdown" role="menu" hidden>' +
      '<a href="about.html" class="nav-menu-item" role="menuitem"><span class="nav-menu-item-icon-wrap">' + aboutIcon + '</span><span>About</span></a>' +
      '<a href="config.html" class="nav-menu-item" role="menuitem"><span class="nav-menu-item-icon-wrap">' + configIcon + '</span><span>Settings</span></a>' +
      '<div class="nav-menu-item nav-menu-theme-row" role="none"><span class="nav-menu-item-icon-wrap">' + themeToggleHTML + '</span><span>Theme</span></div>' +
      '<a href="' + GITHUB_REPO_URL + '" class="nav-menu-item" role="menuitem" target="_blank" rel="noopener noreferrer"><span class="nav-menu-item-icon-wrap">' + githubIcon + '</span><span>GitHub</span></a>' +
    '</div>'
  );
  const navRight = `<div class="nav-right nav-menu-wrap">${menuTrigger}${menuItems}</div>`;

  const appIcon = '<img src="icon_512.png" alt="" class="nav-app-icon" width="36" height="36">';
  const appName = `<a href="dashboard.html" class="nav-app-block" title="Dashboard"><span class="nav-app-icon-wrap">${appIcon}</span><span class="nav-app-text"><span class="nav-app-name">Restore</span><span class="nav-app-subtitle">Sleep Tracker</span></span></a>`;
  const remainingWakeSlot = `<div class="nav-remaining-wake" id="nav-remaining-wake"></div>`;
  const headerRow = `<div class="nav-header nav-header--remaining-wake">${appName}${remainingWakeSlot}${navRight}</div>`;
  const tabsRow = `<div class="nav-tabs-row"><div class="nav-tabs">${navItems}</div></div>`;
  return `<div class="nav-wrapper nav-wrapper--remaining-wake">${headerRow}${tabsRow}</div>`;
}

// Phase thresholds from getRemainingWakeThresholds(): open >= openMin%, winding openMin–windingMin%, pre-sleep < windingMin%.
// totalWakeMins = minutes from average get-up to average sleep (recent 7 days).
function getRemainingWakePhase(remainingMins, totalWakeMins) {
  if (totalWakeMins <= 0) return 'open';
  const percentRemaining = Math.min(100, (remainingMins / totalWakeMins) * 100);
  const { openMin, windingMin } = getRemainingWakeThresholds();
  if (percentRemaining >= openMin) return 'open';
  if (percentRemaining >= windingMin) return 'winding';
  return 'presleep';
}

function getRemainingWakeIcon(phase) {
  switch (phase) {
    case 'open': return '☀️';
    case 'winding': return '🌇';
    case 'presleep': return '🛏️';
    default: return '☀️';
  }
}

/** Returns { phase, icon, timeLabel } from raw days (used when daily.js not loaded).
 * Recent 7 days: average get-up and fell-asleep; phase uses minutes-until-sleep vs that wake-window length. */
function getRemainingWakeDisplayFromDays(days) {
  if (!days || days.length === 0) return null;
  const basis = computeRecentSevenDayWakeBasis(days);
  const { avgSleepStart, totalWakeMins } = basis;
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const remainingMins = avgSleepStart >= nowMins ? avgSleepStart - nowMins : 1440 - nowMins + avgSleepStart;
  const phase = getRemainingWakePhase(remainingMins, totalWakeMins);
  const icon = getRemainingWakeIcon(phase);
  const timeLabel = formatDuration(Math.round(remainingMins));
  return { phase, icon, timeLabel };
}

/** Injects remaining wake into nav and sets phase class on wrapper. Call with { phase, icon, timeLabel }. */
function updateRemainingWakeNav(display) {
  if (!display) return;
  const slot = document.getElementById('nav-remaining-wake');
  const wrapper = document.querySelector('.nav-wrapper');
  if (slot) {
    slot.innerHTML = `<a href="about.html#remaining-wake-time" class="nav-remaining-wake-link" title="Remaining wake time" aria-label="Remaining wake time"><span class="nav-remaining-wake-icon" aria-hidden="true">${display.icon}</span><span class="nav-remaining-wake-time">${display.timeLabel}</span></a>`;
  }
  if (wrapper) {
    wrapper.classList.remove('nav-wrapper--phase-open', 'nav-wrapper--phase-winding', 'nav-wrapper--phase-presleep');
    wrapper.classList.add('nav-wrapper--phase-' + display.phase);
  }
}

/** Fetches sleep data and fills remaining wake in nav. Call on every page so header is consistent. */
function initRemainingWakeNav() {
  fetch('sleep-data.json')
    .then(r => r.json())
    .then(data => {
      const display = getRemainingWakeDisplayFromDays(data.days);
      updateRemainingWakeNav(display);
    })
    .catch(() => {});
}

/**
 * Show the shared day-panel popup with bed, sleep, get up, and sleep duration.
 * point: { dateString, bedTimeString, sleepStartString, getUpString, sleepDurationMinutes, mainSleepMinutes?, napMinutes? }
 * Position is derived from clientX/clientY, flipping to stay on screen.
 */
function showDayPanel(point, clientX, clientY) {
  const dayPanel = document.getElementById('day-panel');
  if (!dayPanel) return;
  const sleepDuration = formatDuration(point.sleepDurationMinutes);
  const mainSleep = formatDuration(point.mainSleepMinutes != null ? point.mainSleepMinutes : point.sleepDurationMinutes);
  const napText = (point.napMinutes != null && point.napMinutes > 0) ? ` (${mainSleep} + ${formatDuration(point.napMinutes)} nap)` : '';
  dayPanel.innerHTML = `
    <div class="day-panel-header">${point.dateString}</div>
    <div class="day-panel-row">
      <span class="day-panel-label bedtime">bed:</span>
      <span class="day-panel-value">${point.bedTimeString}</span>
    </div>
    <div class="day-panel-row">
      <span class="day-panel-label sleep-start">sleep:</span>
      <span class="day-panel-value">${point.sleepStartString}</span>
    </div>
    <div class="day-panel-row">
      <span class="day-panel-label getup">get up:</span>
      <span class="day-panel-value">${point.getUpString}</span>
    </div>
    <div class="day-panel-row">
      <span class="day-panel-label">sleep duration:</span>
      <span class="day-panel-value">${sleepDuration}${napText}</span>
    </div>
  `;
  const panelWidth = 200;
  const panelHeight = 140;
  let left = clientX + 12;
  let top = clientY - 10;
  if (left + panelWidth > window.innerWidth - 20) left = clientX - panelWidth - 12;
  if (top < 20) top = 20;
  if (top + panelHeight > window.innerHeight - 20) top = window.innerHeight - panelHeight - 20;
  dayPanel.style.left = left + 'px';
  dayPanel.style.top = top + 'px';
  dayPanel.classList.add('visible');
}

function hideDayPanel() {
  const dayPanel = document.getElementById('day-panel');
  if (dayPanel) dayPanel.classList.remove('visible');
}