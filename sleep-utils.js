// Shared utility functions for sleep tracking application

// Convert HH:MM to minutes from midnight
function timeToMinutes(time) {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

// Format minutes as "Xh Ym" or "Xh" or "Ym"
function formatDuration(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

// Format minutes from midnight as "HH:MM"
// Optionally return "00" for midnight (for graph display)
function formatTime(minutes, shortMidnight = false) {
  const hours = Math.floor(minutes / 60) % 24;
  const mins = minutes % 60;
  if (shortMidnight && hours === 0) {
    return `00`;
  }
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

// Calculate sleep duration (including naps)
function calculateTotalSleep(day) {
  const sleepStart = timeToMinutes(day.sleepStart);
  const sleepEnd = timeToMinutes(day.sleepEnd);
  
  // Handle sleep that crosses midnight (sleepStart before midnight, sleepEnd after midnight)
  let total = sleepEnd >= sleepStart 
    ? sleepEnd - sleepStart 
    : sleepEnd + 1440 - sleepStart; // Add 24 hours (1440 minutes) to sleepEnd
  
  // Add nap time if nap exists and has valid start/end times
  if (day.nap && day.nap.start && day.nap.end) {
    const napStart = timeToMinutes(day.nap.start);
    const napEnd = timeToMinutes(day.nap.end);
    const napDuration = napEnd >= napStart 
      ? napEnd - napStart 
      : napEnd + 1440 - napStart; // Handle naps that cross midnight
    total += napDuration;
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
  const dayOfWeek = date.getDay();
  // 0 = Sunday, 6 = Saturday
  return dayOfWeek === 0 || dayOfWeek === 6;
}

// Check if a date is a holiday
// Accepts either a Date object or dateString
function isHoliday(dateOrString, holidays, year = 2026) {
  let month, day;
  
  if (dateOrString instanceof Date) {
    month = dateOrString.getMonth() + 1; // getMonth() returns 0-11
    day = dateOrString.getDate();
  } else {
    [month, day] = parseDateString(dateOrString);
  }
  
  const yearHolidays = holidays[year];
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
  const sleepDuration = normalizedSleepEnd - sleepStart;

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
  if (!day.nap || !day.nap.start || !day.nap.end) {
    return null;
  }
  const napStart = timeToMinutes(day.nap.start);
  const napEnd = timeToMinutes(day.nap.end);
  return napEnd >= napStart ? napEnd - napStart : napEnd + 1440 - napStart;
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
const SUNRISE_HOUR = 6;
const SUNRISE_MINUTE = 0;
const SUNSET_HOUR = 18;
const SUNSET_MINUTE = 0;

const THEME_OVERRIDE_KEY = 'sleep-app-theme-override';

// Returns 'day' if current local time is between sunrise and sunset, else 'night'
function getThemeFromTime() {
  const now = new Date();
  const minutesSinceMidnight = now.getHours() * 60 + now.getMinutes();
  const sunriseMinutes = SUNRISE_HOUR * 60 + SUNRISE_MINUTE;
  const sunsetMinutes = SUNSET_HOUR * 60 + SUNSET_MINUTE;
  return minutesSinceMidnight >= sunriseMinutes && minutesSinceMidnight < sunsetMinutes ? 'day' : 'night';
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

// Sun icon: filled circle + rays (visible when filled)
const SUN_ICON = '<svg class="nav-daynight-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.25a.75.75 0 01.75.75v2.25a.75.75 0 01-1.5 0V3a.75.75 0 01.75-.75zM7.5 12a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM18.894 6.166a.75.75 0 00-1.06-1.06l-1.591 1.59a.75.75 0 101.06 1.061l1.591-1.59zM21.75 12a.75.75 0 01-.75.75h-2.25a.75.75 0 010-1.5H21a.75.75 0 01.75.75zM17.834 18.894a.75.75 0 001.06-1.06l-1.59-1.591a.75.75 0 10-1.061 1.06l1.59 1.591zM12 18a.75.75 0 01.75.75V21a.75.75 0 01-1.5 0v-2.25A.75.75 0 0112 18zM7.758 17.303l-1.591 1.59a.75.75 0 001.06-1.061l1.591-1.59a.75.75 0 00-1.06-1.06zM6 12a.75.75 0 01-.75.75H3a.75.75 0 010-1.5h2.25A.75.75 0 016 12zM6.697 7.757l-1.59-1.591a.75.75 0 00-1.061 1.06l1.59 1.591a.75.75 0 001.061-1.06z"/></svg>';
const MOON_ICON = '<svg class="nav-daynight-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z"/></svg>';

function getDayNightTitle(theme, isOverride) {
  if (theme === 'day') return isOverride ? 'Day mode (manual) — click to change' : 'Day mode (auto) — click to change';
  return isOverride ? 'Night mode (manual) — click to change' : 'Night mode (auto) — click to change';
}

// Returns HTML for the day/night indicator icon (sun or moon)
function getDayNightIconHTML(theme) {
  const isOverride = getThemeOverride() !== null;
  const title = getDayNightTitle(theme, isOverride);
  const svg = theme === 'day' ? SUN_ICON : MOON_ICON;
  return `<span id="nav-daynight" class="nav-daynight" role="button" title="${title}" aria-label="${title}">${svg}</span>`;
}

// Updates the nav daynight icon if the element exists (e.g. after theme tick or click)
function updateDayNightIcon() {
  const el = document.getElementById('nav-daynight');
  if (!el) return;
  const theme = getEffectiveTheme();
  const isOverride = getThemeOverride() !== null;
  el.title = getDayNightTitle(theme, isOverride);
  el.innerHTML = theme === 'day' ? SUN_ICON : MOON_ICON;
}

// Cycle theme on icon click: auto -> day -> night -> auto
function handleDayNightClick() {
  const override = getThemeOverride();
  const next = override === null ? 'day' : override === 'day' ? 'night' : null;
  if (next === null) setThemeOverride(null);
  else setThemeOverride(next);
  applyDayNightTheme();
  updateDayNightIcon();
}

// Initializes day/night theme, click handler, and timer to re-check (when in auto mode)
function initDayNightTheme() {
  applyDayNightTheme();
  updateDayNightIcon();
  const el = document.getElementById('nav-daynight');
  if (el) el.addEventListener('click', handleDayNightClick);
  setInterval(function () {
    applyDayNightTheme();
    updateDayNightIcon();
  }, 60000);
}

// Render navigation bar
function renderNavBar(currentPage) {
  applyDayNightTheme();
  const theme = getThemeFromTime();
  const dayNightIcon = getDayNightIconHTML(theme);

  const pages = [
    { id: 'dashboard', name: 'Dashboard', url: 'dashboard.html', icon: '🛌' },
    { id: 'quality', name: 'Quality', url: 'quality.html', icon: '🟩' },
    { id: 'timeline', name: 'Daily', url: 'sleep.html', icon: '📅' },
    { id: 'graph', name: 'Graphs', url: 'graph.html', icon: '📊' },
    { id: 'stats', name: 'Stats', url: 'stats.html', icon: '🔢' }
  ];

  const navItems = pages.map(page => {
    const isActive = page.id === currentPage;
    return `<a href="${page.url}" class="nav-tab ${isActive ? 'active' : ''}"><span class="nav-icon">${page.icon}</span> ${page.name}</a>`;
  }).join('');

  const githubIcon = `<svg class="nav-github-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>`;
  const githubLink = `<a href="${GITHUB_REPO_URL}" class="nav-github-link" target="_blank" rel="noopener noreferrer" title="View on GitHub">${githubIcon}</a>`;
  const navRight = `<div class="nav-right">${dayNightIcon}${githubLink}</div>`;

  return `<div class="nav-bar"><div class="nav-tabs">${navItems}</div>${navRight}</div>`;
}