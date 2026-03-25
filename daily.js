// Configuration constants
const YEAR = 2026;
const ALARM_TO_WAKE_WARNING_THRESHOLD = 60; // minutes
/** Prior nights required before timing flags or heatmap colors apply. */
const LOOKBACK_DAYS = 7;
const DAY_MINUTES = 1440;
/** Weight when blending sleep-relative vs day-relative variation (internal only). */
const BLEND_ALPHA = 0.75;
/** Total sleep (main + nap) below these minute thresholds adds a duration flag (absolute floor; combined with relative short-sleep via max severity, not stacked). */
const ABS_DURATION_SLIGHT_LT_MIN = 360; // < 6h → slight
const ABS_DURATION_MODERATE_LT_MIN = 300; // < 5h → moderate
const ABS_DURATION_SEVERE_LT_MIN = 240; // < 4h → severe
const DATA_FILES = {
  sleep: 'sleep-data.json'
};

// Time constants
const MILLISECONDS_PER_DAY = 86400000;
// Timeline runs 21:00 to 21:00 (24 hours). Ticks: 21 (start), 0, 4, 8, 12, 16, 21 (end)
// In timeline minutes: 0, 180, 420, 660, 900, 1140, 1440
const TIME_TICKS = [0, 180, 420, 660, 900, 1140, 1440]; // 21, 0, 4, 8, 12, 16, 21 hours
const TIMELINE_START_MINUTES = 1260; // 21:00 in minutes
const PREVIOUS_DAY_DURATION = 180; // 3 hours from 21:00 to 00:00

// Holidays data (from sleep-utils.js HOLIDAYS_BY_YEAR)
let holidays = typeof window !== 'undefined' && window.HOLIDAYS_BY_YEAR ? window.HOLIDAYS_BY_YEAR : {};

// Note: parseDateString, getDateFromString, isHoliday, and isWeekend are now in sleep-utils.js

// Get Monday of the week for a given date (Monday-Sunday weeks)
function getMondayOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
  d.setDate(diff);
  return d;
}

// Get week number (ISO week number)
function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / MILLISECONDS_PER_DAY) + 1) / 7);
}

// Group days by week (Monday-Sunday)
function groupDaysByWeek(days) {
  const weeks = new Map();
  
  days.forEach(day => {
    const date = getDateFromString(day.date);
    const monday = getMondayOfWeek(new Date(date));
    const weekKey = monday.getTime();
    
    if (!weeks.has(weekKey)) {
      weeks.set(weekKey, {
        monday: monday,
        days: []
      });
    }
    weeks.get(weekKey).days.push(day);
  });
  
  // Convert to array and sort by date (most recent first)
  return Array.from(weeks.values()).sort((a, b) => b.monday.getTime() - a.monday.getTime());
}

// True if the week is current or the week immediately before (both shown expanded by default)
function isCurrentOrPreviousWeek(monday) {
  const currentMonday = getMondayOfWeek(new Date());
  currentMonday.setHours(0, 0, 0, 0);
  const weekMon = new Date(monday);
  weekMon.setHours(0, 0, 0, 0);
  const prevMonday = new Date(currentMonday);
  prevMonday.setDate(prevMonday.getDate() - 7);
  return weekMon.getTime() === currentMonday.getTime() || weekMon.getTime() === prevMonday.getTime();
}

// Format date range for week header
function formatWeekRange(monday) {
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  
  const formatDate = (date) => {
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `${month}/${day}`;
  };
  
  return `${formatDate(monday)} - ${formatDate(sunday)}`;
}

// Note: timeToMinutes is now in sleep-utils.js

// Convert time (minutes from midnight) to timeline position
// Timeline runs 21:00 to 21:00 (24h). Times >= 21:00 (1260) → 0–179; times < 21:00 → 180–1439
function timeToTimelinePosition(minutesFromMidnight) {
  if (minutesFromMidnight >= TIMELINE_START_MINUTES) {
    // 21:00–23:59
    return minutesFromMidnight - TIMELINE_START_MINUTES;
  } else {
    // 00:00–20:59 (next day on timeline)
    return minutesFromMidnight + PREVIOUS_DAY_DURATION;
  }
}

// Bed time uses same timeline position as everything else (timeline now starts at 21:00)
function bedMinutesForTimeline(bedMinutes) {
  return timeToTimelinePosition(bedMinutes);
}

// Note: formatDuration and formatTime are now in sleep-utils.js

// Note: calculateTotalSleep is now in sleep-utils.js

// Note: normalizeTimeForComparison, normalizeTimeForAveraging, and denormalizeTimeForAveraging 
// are now in sleep-utils.js

function blendedVariationPercent(diffMinutes, avgSleepDurationMinutes) {
  const sleepBase = Math.max(avgSleepDurationMinutes, 1);
  const pctSleep = (diffMinutes / sleepBase) * 100;
  const pctDay = (diffMinutes / DAY_MINUTES) * 100;
  return BLEND_ALPHA * pctSleep + (1 - BLEND_ALPHA) * pctDay;
}

/** @returns {'slight'|'moderate'|'severe'|null} */
function severityFromBlendedPercent(p) {
  if (p < 5) return null;
  if (p < 10) return 'slight';
  if (p < 19) return 'moderate';
  return 'severe';
}

const SEVERITY_RANK = { slight: 1, moderate: 2, severe: 3 };

function maxSeverity(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

/** Total sleep minutes (including nap): absolute short-sleep tiers; null if ≥ 6h. */
function severityFromAbsoluteTotalSleepMinutes(totalMinutes) {
  if (totalMinutes >= ABS_DURATION_SLIGHT_LT_MIN) return null;
  if (totalMinutes < ABS_DURATION_SEVERE_LT_MIN) return 'severe';
  if (totalMinutes < ABS_DURATION_MODERATE_LT_MIN) return 'moderate';
  return 'slight';
}

/** Calendar / quality ramp: slight | moderate | severe from WASO count, or null if none. */
function wasoQualitySeverity(day) {
  const frag = normalizeFragmentationLevel(day);
  if (!frag) return null;
  if (frag === 'mild') return 'slight';
  if (frag === 'moderate') return 'moderate';
  return 'severe';
}

// Calculate recent averages for deviation detection (excluding current day)
function calculateRecentAverages(days, currentIndex, lookbackDays = LOOKBACK_DAYS) {
  const startIndex = Math.max(0, currentIndex + 1);
  const endIndex = Math.min(days.length, currentIndex + 1 + lookbackDays);
  const recentDays = days.slice(startIndex, endIndex);

  if (recentDays.length < lookbackDays) {
    return {
      insufficient: true,
      sampleSize: recentDays.length
    };
  }

  let fellAsleepTimeSum = 0;
  let wakeTimeSum = 0;
  let sleepDurationSum = 0;

  recentDays.forEach(day => {
    const fellAsleepTime = timeToMinutes(day.sleepStart);
    const normalizedFellAsleepTime = normalizeTimeForAveraging(fellAsleepTime);
    fellAsleepTimeSum += normalizedFellAsleepTime;

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

function analyzeTimingDeviations(day, recentAverages) {
  const avgSleep = recentAverages.avgSleepDuration;
  const fellAsleepTime = timeToMinutes(day.sleepStart);
  const normalizedFellAsleep = normalizeTimeForAveraging(fellAsleepTime);
  // Only flag asleep when later than average (earlier is not penalized).
  const asleepLaterThanAvg = normalizedFellAsleep > recentAverages.avgFellAsleepTime;
  const asleepDiff = asleepLaterThanAvg
    ? normalizedFellAsleep - recentAverages.avgFellAsleepTime
    : 0;
  const asleepSeverity = asleepLaterThanAvg
    ? severityFromBlendedPercent(blendedVariationPercent(asleepDiff, avgSleep))
    : null;

  const sleepDuration = calculateTotalSleep(day);
  // Relative: only when shorter than average. Absolute: < 6h / < 5h / < 4h. Worst of the two (not additive).
  const durationShorterThanAvg = sleepDuration < recentAverages.avgSleepDuration;
  const durDiff = durationShorterThanAvg
    ? recentAverages.avgSleepDuration - sleepDuration
    : 0;
  const relativeDurationSeverity = durationShorterThanAvg
    ? severityFromBlendedPercent(blendedVariationPercent(durDiff, avgSleep))
    : null;
  const absoluteDurationSeverity = severityFromAbsoluteTotalSleepMinutes(sleepDuration);
  const durationSeverity = maxSeverity(relativeDurationSeverity, absoluteDurationSeverity);

  const wakeTime = timeToMinutes(day.sleepEnd);
  const normalizedWake = normalizeWakeTimeForAveraging(fellAsleepTime, wakeTime);
  const wakeDiff = Math.abs(normalizedWake - recentAverages.avgWakeTime);
  const wakeSeverity = severityFromBlendedPercent(blendedVariationPercent(wakeDiff, avgSleep));

  return {
    normalizedFellAsleep,
    asleepDiff,
    asleepSeverity,
    sleepDuration,
    durDiff,
    durationSeverity,
    relativeDurationSeverity,
    absoluteDurationSeverity,
    normalizedWake,
    wakeDiff,
    wakeSeverity
  };
}

function computeWorstQualitySeverity(day, recentAverages) {
  if (!recentAverages || recentAverages.insufficient) return 'none';
  const t = analyzeTimingDeviations(day, recentAverages);
  let worst = maxSeverity(t.asleepSeverity, t.durationSeverity);
  worst = maxSeverity(worst, wasoQualitySeverity(day));
  return worst || 'none';
}

/** Prefer explaining whichever source sets combined duration severity (relative vs absolute). */
function durationDeviationCopy(t) {
  const abs = t.absoluteDurationSeverity;
  const rel = t.relativeDurationSeverity;
  if (!t.durationSeverity) return { html: '', plain: '' };
  const absDrives = abs && (!rel || SEVERITY_RANK[abs] >= SEVERITY_RANK[rel]);
  if (absDrives && abs) {
    if (abs === 'severe') {
      return { html: '<strong>Duration</strong>: under 4 hours total', plain: 'Duration: under 4 hours total' };
    }
    if (abs === 'moderate') {
      return { html: '<strong>Duration</strong>: under 5 hours total', plain: 'Duration: under 5 hours total' };
    }
    return { html: '<strong>Duration</strong>: under 6 hours total', plain: 'Duration: under 6 hours total' };
  }
  const d = formatDuration(Math.round(t.durDiff));
  const plain = `Duration: ${d} shorter than recent average`;
  return { html: `<strong>Duration</strong>: ${d} shorter than recent average`, plain };
}

function durationDeviationBodyHtml(t) {
  return durationDeviationCopy(t).html;
}

// Check for deviations and return warning objects (severity drives CSS; category emoji only, no yield/stop)
function checkDeviations(day, recentAverages) {
  if (!recentAverages || recentAverages.insufficient) {
    return [{
      severity: 'insufficient',
      plainSummary: 'Not enough data (need 7 prior nights in the log).',
      bodyHtml: 'Not enough data (need 7 prior nights in the log).'
    }];
  }

  const warnings = [];
  const t = analyzeTimingDeviations(day, recentAverages);

  if (t.asleepSeverity) {
    const detail = `${formatDuration(Math.round(t.asleepDiff))} later than recent average`;
    warnings.push({
      severity: t.asleepSeverity,
      emoji: '😴',
      plainSummary: `Asleep: ${detail}`,
      bodyHtml: `<strong>Asleep</strong>: ${detail}`
    });
  }

  if (t.durationSeverity) {
    const { html, plain } = durationDeviationCopy(t);
    warnings.push({
      severity: t.durationSeverity,
      emoji: '⌛',
      plainSummary: plain,
      bodyHtml: html
    });
  }

  if (t.wakeSeverity) {
    const later = t.normalizedWake > recentAverages.avgWakeTime;
    const detail = `${formatDuration(Math.round(t.wakeDiff))} ${later ? 'later' : 'earlier'} than recent average`;
    warnings.push({
      severity: t.wakeSeverity,
      emoji: '🌅',
      plainSummary: `Wake: ${detail}`,
      bodyHtml: `<strong>Wake</strong>: ${detail}`
    });
  }

  const fragLevel = normalizeFragmentationLevel(day);
  if (fragLevel) {
    const fragSeverity = fragLevel === 'mild' ? 'slight' : fragLevel === 'moderate' ? 'moderate' : 'severe';
    const label = fragSeverity === 'slight' ? 'Slight' : fragSeverity === 'moderate' ? 'Moderate' : 'Severe';
    warnings.push({
      severity: fragSeverity,
      emoji: '🧩',
      plainSummary: `${label} WASO`,
      bodyHtml: `<strong>${label}</strong> WASO`
    });
  }

  return warnings;
}

function escapeHtmlAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

function escapeHtmlText(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function deviationWarningMarkup(w) {
  if (typeof w === 'string') {
    return `<button type="button" class="deviation-flag-chip deviation-flag-chip--insufficient" aria-expanded="false" aria-label="${escapeHtmlAttr(w)}"><span class="deviation-flag-chip-icon" aria-hidden="true">⋯</span><span class="deviation-flag-chip-text">${escapeHtmlText(w)}</span></button>`;
  }
  const label = w.plainSummary || '';
  const aria = escapeHtmlAttr(label);
  if (w.severity === 'insufficient') {
    return `<button type="button" class="deviation-flag-chip deviation-flag-chip--insufficient" aria-expanded="false" aria-label="${aria}"><span class="deviation-flag-chip-icon" aria-hidden="true">⋯</span><span class="deviation-flag-chip-text">${w.bodyHtml}</span></button>`;
  }
  const sevClass = `deviation-flag-chip--${w.severity}`;
  return `<button type="button" class="deviation-flag-chip ${sevClass}" aria-expanded="false" aria-label="${aria}"><span class="deviation-flag-chip-icon" aria-hidden="true">${w.emoji}</span><span class="deviation-flag-chip-text">${w.bodyHtml}</span></button>`;
}

// Flag emojis for calendar tooltip (timing uses blended % thresholds; 🧩 when WASO ≥ 1)
function getFlagTypes(day, recentAverages) {
  if (!recentAverages || recentAverages.insufficient) return [];

  const t = analyzeTimingDeviations(day, recentAverages);
  const flagTypes = [];
  if (t.asleepSeverity) flagTypes.push('😴');
  if (t.durationSeverity) flagTypes.push('⌛');
  if (t.wakeSeverity) flagTypes.push('🌅');
  if (normalizeFragmentationLevel(day)) flagTypes.push('🧩');
  return flagTypes;
}

// Helper function to wrap keywords in spans with color classes
// Can handle multiple keywords by passing an array
function highlightKeyword(label, keywords) {
  if (typeof keywords === 'string') {
    keywords = [keywords]; // Convert single keyword to array
  }
  
  // Find all keyword positions and sort by index
  const keywordPositions = [];
  keywords.forEach(keyword => {
    const keywordLower = keyword.toLowerCase();
    const labelLower = label.toLowerCase();
    let searchIndex = 0;
    while (true) {
      const keywordIndex = labelLower.indexOf(keywordLower, searchIndex);
      if (keywordIndex === -1) break;
      keywordPositions.push({ 
        keyword, 
        keywordLower, 
        keywordIndex, 
        length: keyword.length,
        endIndex: keywordIndex + keyword.length
      });
      searchIndex = keywordIndex + 1;
    }
  });
  
  // Sort by position and remove overlaps (keep first occurrence)
  keywordPositions.sort((a, b) => a.keywordIndex - b.keywordIndex);
  const nonOverlapping = [];
  for (const pos of keywordPositions) {
    if (nonOverlapping.length === 0 || nonOverlapping[nonOverlapping.length - 1].endIndex <= pos.keywordIndex) {
      nonOverlapping.push(pos);
    }
  }
  
  // Build result by replacing from right to left to preserve indices
  let result = label;
  for (let i = nonOverlapping.length - 1; i >= 0; i--) {
    const { keywordLower, keywordIndex, length } = nonOverlapping[i];
    const beforeKeyword = result.substring(0, keywordIndex);
    const keywordText = result.substring(keywordIndex, keywordIndex + length);
    const afterKeyword = result.substring(keywordIndex + length);
    result = `${beforeKeyword}<span class="keyword ${keywordLower}">${keywordText}</span>${afterKeyword}`;
  }
  
  return result;
}

// Render a single day
// options: { showTicks } - when true (e.g. on dashboard), bar shows time tick labels
function renderDay(day, days, dayIndex, options) {
  const showTicks = options && options.showTicks;
  const sleepStart = timeToMinutes(day.sleepStart);
  const sleepEnd = timeToMinutes(day.sleepEnd);
  const sleepDuration = calculateTotalSleep(day);
  const longestUninterrupted = calculateLongestUninterrupted(day);
  const firstAlarmToWake = calculateFirstAlarmToWake(day);
  
  const isHolidayDay = isHoliday(day.date, holidays);
  const isWeekendDay = isWeekend(day.date);
  const dayClasses = [];
  if (isHolidayDay) dayClasses.push('holiday');
  if (isWeekendDay) dayClasses.push('weekend');
  
  const dayOfWeek = getDateFromString(day.date, YEAR).toLocaleDateString('en-US', { weekday: 'short' });
  
  // Check for deviations from recent averages
  const recentAverages = calculateRecentAverages(days, dayIndex);
  const deviations = checkDeviations(day, recentAverages);
  const deviationWarnings = deviations.length > 0
    ? `<div class="deviation-warnings deviation-warnings--chips">${deviations.map(deviationWarningMarkup).join('')}</div>`
    : '';
  
  // Convert times to timeline positions
  const sleepStartPos = timeToTimelinePosition(sleepStart);
  const sleepEndPos = timeToTimelinePosition(sleepEnd);
  const bedMinutes = timeToMinutes(day.bed);
  const bedPos = bedMinutesForTimeline(bedMinutes);
  
  // Time tick labels: 21 (start), 0, 4, 8, 12, 16, 21 (end)
  const tickLabels = [21, 0, 4, 8, 12, 16, 21];
  const barClass = 'bar' + (showTicks ? ' show-ticks' : '');
  
  let html = `
    <div class="day ${dayClasses.join(' ')}">
      <div class="day-content">
        <div class="day-date">${day.date} ${dayOfWeek}${isHolidayDay ? ' 🏝️' : ''}</div>
        <div class="day-stats">
          <div class="stat-row"><span class="stat-label">${highlightKeyword('asleep:', 'asleep')}</span><span class="stat-value">${day.sleepStart}</span></div>
          <div class="stat-row"><span class="stat-label">${highlightKeyword('duration:', 'duration')}</span><span class="stat-value">${formatDuration(sleepDuration)}</span></div>
          <div class="stat-row"><span class="stat-label">uninterrupted:</span><span class="stat-value">${formatDuration(longestUninterrupted)}</span></div>
          ${firstAlarmToWake !== null ? `<div class="stat-row"><span class="stat-label">${highlightKeyword('alarm to wake:', ['alarm', 'wake'])}</span><span class="stat-value ${firstAlarmToWake > ALARM_TO_WAKE_WARNING_THRESHOLD ? 'stat-warning' : ''}">${firstAlarmToWake < 0 ? '-' + formatDuration(-firstAlarmToWake) : formatDuration(firstAlarmToWake)}</span></div>` : ''}
        </div>
        <div class="day-bar-container">
          <div class="${barClass}">
            <!-- Faded overlay for previous day section (21:00-00:00) -->
            <div class="previous-day-overlay"></div>
            <div class="span sleep" style="--start:${sleepStartPos}; --end:${sleepEndPos}" data-tooltip="duration: ${formatDuration(sleepDuration)}">${sleepFragmentationOverlayHtml(day)}</div>
            <!-- Time tick marks -->
            ${TIME_TICKS.map((minutes, i) => `<div class="time-tick" style="--m:${minutes}"><span class="tick-label">${tickLabels[i]}</span></div>`).join('')}
  `;
  
  if (day.nap) {
    const napStart = timeToTimelinePosition(timeToMinutes(day.nap.start));
    const napEnd = timeToTimelinePosition(timeToMinutes(day.nap.end));
    if (napEnd >= napStart) {
      html += `<div class="span nap" style="--start:${napStart}; --end:${napEnd}"></div>`;
    } else {
      // Nap crosses timeline boundary (e.g. 20:30 -> 21:30 on a 21:00-21:00 timeline).
      // Split into two spans so CSS width never goes negative.
      html += `<div class="span nap" style="--start:${napStart}; --end:1440"></div>`;
      html += `<div class="span nap" style="--start:0; --end:${napEnd}"></div>`;
    }
  }
  
  html += `<div class="event bed" style="--m:${bedPos}" data-tooltip="${day.bed} bed"></div>`;
  
  day.alarm.forEach(time => {
    const minutes = timeToTimelinePosition(timeToMinutes(time));
    html += `<div class="event alarm" style="--m:${minutes}" data-tooltip="${time} alarm"></div>`;
  });
  
  day.bathroom.forEach(time => {
    const minutes = timeToTimelinePosition(timeToMinutes(time));
    html += `<div class="event bath" style="--m:${minutes}" data-tooltip="${time} bathroom"></div>`;
  });
  
  const upPos = timeToTimelinePosition(sleepEnd);
  html += `<div class="event up" style="--m:${upPos}" data-tooltip="${day.sleepEnd} get up"></div>`;
  
  html += `</div></div>
      </div>
      ${deviationWarnings}
    </div>`;
  return html;
}

// Note: normalizeTimeForAveraging and denormalizeTimeForAveraging are now in sleep-utils.js

// Calculate average stats
function calculateAverages(days) {
  let sleepDurationSum = 0;
  let longestUninterruptedSum = 0;
  let firstAlarmToWakeSum = 0;
  let firstAlarmToWakeCount = 0;
  let sleepStartSum = 0;
  let sleepEndSum = 0;
  
  days.forEach(day => {
    sleepDurationSum += calculateTotalSleep(day);
    longestUninterruptedSum += calculateLongestUninterrupted(day);
    const firstAlarmToWake = calculateFirstAlarmToWake(day);
    if (firstAlarmToWake !== null) {
      firstAlarmToWakeSum += firstAlarmToWake;
      firstAlarmToWakeCount++;
    }
    // Normalize times for averaging to handle midnight crossover
    const ss = timeToMinutes(day.sleepStart);
    sleepStartSum += normalizeTimeForAveraging(ss);
    sleepEndSum += normalizeWakeTimeForAveraging(ss, timeToMinutes(day.sleepEnd));
  });
  
  return {
    avgSleepStart: denormalizeTimeForAveraging(Math.round(sleepStartSum / days.length)),
    avgSleepEnd: denormalizeTimeForAveraging(Math.round(sleepEndSum / days.length)),
    avgSleepDuration: Math.round(sleepDurationSum / days.length),
    avgLongestUninterrupted: Math.round(longestUninterruptedSum / days.length),
    avgFirstAlarmToWake: firstAlarmToWakeCount > 0 ? Math.round(firstAlarmToWakeSum / firstAlarmToWakeCount) : null
  };
}

// Render averages stats HTML (inner content only)
function renderAveragesStats(averages) {
  return `
        <div class="stat-row"><span class="stat-label">${highlightKeyword('asleep:', 'asleep')}</span><span class="stat-value">${formatTime(averages.avgSleepStart)}</span></div>
    <div class="stat-row"><span class="stat-label">${highlightKeyword('duration:', 'duration')}</span><span class="stat-value">${formatDuration(averages.avgSleepDuration)}</span></div>
    <div class="stat-row"><span class="stat-label">uninterrupted:</span><span class="stat-value">${formatDuration(averages.avgLongestUninterrupted)}</span></div>
    ${averages.avgFirstAlarmToWake !== null ? `<div class="stat-row"><span class="stat-label">${highlightKeyword('alarm to wake:', ['alarm', 'wake'])}</span><span class="stat-value ${averages.avgFirstAlarmToWake > ALARM_TO_WAKE_WARNING_THRESHOLD ? 'stat-warning' : ''}">${averages.avgFirstAlarmToWake < 0 ? '-' + formatDuration(-averages.avgFirstAlarmToWake) : formatDuration(averages.avgFirstAlarmToWake)}</span></div>` : ''}
  `;
}

// Render averages column HTML
function renderAveragesColumn(averages, title) {
  return `
    <div class="averages-column">
      <div class="averages-title">${title}</div>
      <div class="averages">
        ${renderAveragesStats(averages)}
      </div>
    </div>
  `;
}

// Render top averages for stats page: recent (left) and lifetime (right) in split columns
function renderStatsTopAverages(days) {
  if (!days || days.length === 0) return '';
  const recentDays = days.slice(0, Math.min(7, days.length));
  const recentAverages = calculateAverages(recentDays);
  const lifetimeAverages = calculateAverages(days);
  return `
    <div class="dashboard-averages-panel stats-top-averages">
      <div class="averages-container">
        ${renderAveragesColumn(recentAverages, '🕒 Recent average (7 days)')}
        ${renderAveragesColumn(lifetimeAverages, '🌳 Lifetime average')}
      </div>
    </div>
  `;
}

// Render week summary stats (for collapsed state)
function renderWeekSummary(days) {
  const averages = calculateAverages(days);
  const avgSleepStart = averages.avgSleepStart;
  const avgSleepEnd = averages.avgSleepEnd;
  const avgSleepStartPos = timeToTimelinePosition(avgSleepStart);
  const avgSleepEndPos = timeToTimelinePosition(avgSleepEnd);
  const tickLabels = [21, 0, 4, 8, 12, 16, 21];
  
  return `
    <div class="week-summary">
      <div class="week-summary-spacer"></div>
      <div class="day-stats">
        ${renderAveragesStats(averages)}
      </div>
      <div class="week-summary-bar">
        <div class="bar">
          <div class="previous-day-overlay"></div>
          <div class="span sleep" style="--start:${avgSleepStartPos}; --end:${avgSleepEndPos}" data-tooltip="average sleep: ${formatTime(avgSleepStart)} - ${formatTime(avgSleepEnd)}"></div>
          ${TIME_TICKS.map((minutes, i) => `<div class="time-tick" style="--m:${minutes}"><span class="tick-label">${tickLabels[i]}</span></div>`).join('')}
        </div>
      </div>
    </div>
  `;
}

// Render a week container
function renderWeek(week, weekIndex, allDays) {
  const weekNumber = getWeekNumber(week.monday);
  const weekRange = formatWeekRange(week.monday);
  const weekId = `week-${weekIndex}`;
  const expandedByDefault = isCurrentOrPreviousWeek(week.monday);
  const collapsedClass = expandedByDefault ? '' : ' collapsed';
  const toggleIcon = expandedByDefault ? '▼' : '▶';
  
  const daysHtml = week.days.map(day => {
    // Find the index of this day in the full days array
    const dayIndex = allDays.findIndex(d => d.date === day.date);
    return renderDay(day, allDays, dayIndex);
  }).join('');
  
  return `
    <div class="week-container">
      <div class="week-header" data-week-id="${weekId}">
        <span class="week-header-text">
          Week ${weekNumber} (${weekRange})
          <span class="week-toggle-icon">${toggleIcon}</span>
        </span>
      </div>
      <div class="week-content${collapsedClass}" id="${weekId}">
        <div class="week-summary collapsed-only">${renderWeekSummary(week.days)}</div>
        <div class="week-days">${daysHtml}</div>
      </div>
    </div>
  `;
}

// Heatmap cell color = worst severity among 😴, ⌛, and 🧩 (WASO); 🌅 is tooltip-only.
function buildFlagCountMap(days) {
  const flagMap = new Map();
  days.forEach((day, index) => {
    const recentAverages = calculateRecentAverages(days, index);
    const insufficient = !recentAverages || recentAverages.insufficient;
    const types = getFlagTypes(day, recentAverages);
    const qualitySeverity = insufficient ? 'none' : computeWorstQualitySeverity(day, recentAverages);
    flagMap.set(day.date, { insufficient, qualitySeverity, types });
  });
  return flagMap;
}

// Format date as M/D for display
function formatDateShort(date) {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

// Get the latest date present in sleep data (as Date at midnight) for the given year
function getLatestDataDate(days, year) {
  if (!days || days.length === 0) return null;
  let latest = getDateFromString(days[0].date, year);
  for (let i = 1; i < days.length; i++) {
    const d = getDateFromString(days[i].date, year);
    if (d > latest) latest = d;
  }
  latest.setHours(0, 0, 0, 0);
  return latest;
}

// Inner HTML for the sleep-bar fragmentation texture (empty if none).
function sleepFragmentationOverlayHtml(day) {
  const level = normalizeFragmentationLevel(day);
  if (!level) return '';
  return `<span class="sleep-fragmentation sleep-fragmentation--${level}" aria-hidden="true"></span>`;
}

// Generate calendar heatmap data
// Returns array of months; each month has weeks (array of 7-cell rows, Sun-Sat aligned)
function generateCalendarHeatmap(year, flagMap, latestDataDate) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const cutoff = latestDataDate && latestDataDate < today ? latestDataDate : today;

  const monthLabels = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const months = [];

  for (let monthIndex = 0; monthIndex < 12; monthIndex++) {
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    const firstDay = new Date(year, monthIndex, 1);
    const startWeekday = firstDay.getDay(); // 0 = Sun, 6 = Sat

    // Build flat list of day entries (1..daysInMonth), then chunk into weeks (7 cells per row)
    const flatDays = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, monthIndex, day);
      date.setHours(0, 0, 0, 0);
      if (date > cutoff) {
        flatDays.push(null);
      } else {
        const dateStr = formatDateShort(date);
        const flagData = flagMap.get(dateStr) || { insufficient: false, qualitySeverity: 'none', types: [] };
        flatDays.push({
          date: date,
          dateStr: dateStr,
          day: day,
          insufficient: flagData.insufficient,
          qualitySeverity: flagData.qualitySeverity,
          flagTypes: flagData.types
        });
      }
    }

    // Pad start so day 1 is in correct weekday column (Su=0, Sa=6)
    const leadingBlanks = startWeekday;
    const padded = [...Array(leadingBlanks).fill(null), ...flatDays];

    // Chunk into rows of 7 (Su-Sa)
    const weeks = [];
    for (let i = 0; i < padded.length; i += 7) {
      weeks.push(padded.slice(i, i + 7));
    }
    // Ensure last row has exactly 7 cells
    if (weeks.length > 0) {
      const last = weeks[weeks.length - 1];
      while (last.length < 7) last.push(null);
    }

    const flagCounts = { '😴': 0, '⌛': 0, '🌅': 0, '🧩': 0 };
    flatDays.forEach(day => {
      if (day && day.flagTypes) {
        day.flagTypes.forEach(flagType => {
          if (flagCounts.hasOwnProperty(flagType)) flagCounts[flagType]++;
        });
      }
    });

    months.push({
      name: monthLabels[monthIndex],
      index: monthIndex,
      weeks: weeks,
      flagCounts: flagCounts
    });
  }

  return months;
}

function getCalendarSquareColorClass(dayCell) {
  if (!dayCell) return 'empty';
  if (dayCell.insufficient) return 'flag-insufficient';
  const s = dayCell.qualitySeverity || 'none';
  if (s === 'none') return 'flag-none';
  if (s === 'slight') return 'flag-one';
  if (s === 'moderate') return 'flag-two';
  return 'flag-three-plus';
}

function calendarSquareTooltip(dayCell) {
  if (dayCell.insufficient) return `${dayCell.dateStr}: not enough data`;
  if (dayCell.flagTypes && dayCell.flagTypes.length > 0) {
    return `${dayCell.dateStr}: ${dayCell.flagTypes.join(' ')}`;
  }
  return `${dayCell.dateStr}: normal`;
}

// Render a single month block (for heatmap). large: true adds --large class for 2x size on dashboard.
function renderMonthBlock(month, large) {
  const flagSlots = [
    { emoji: '😴', count: month.flagCounts['😴'] },
    { emoji: '⌛', count: month.flagCounts['⌛'] },
    { emoji: '🌅', count: month.flagCounts['🌅'] },
    { emoji: '🧩', count: month.flagCounts['🧩'] }
  ];
  const flagHtml = flagSlots.map(f => `<span class="calendar-flag-slot"><span class="calendar-flag-emoji">${f.emoji}</span><span class="calendar-flag-num">${f.count}</span></span>`).join('');
  const weekdayLabels = ['Su', 'M', 'T', 'W', 'R', 'F', 'Sa'].map(w => `<div class="calendar-weekday-label">${w}</div>`).join('');
  const blockClass = 'calendar-month-block' + (large ? ' calendar-month-block--large' : '');
  return `
    <div class="${blockClass}">
      <div class="calendar-month-header">
        <div class="calendar-month-name">${month.name}</div>
        <div class="calendar-month-flag-counter">${flagHtml}</div>
      </div>
      <div class="calendar-weekday-cells calendar-weekday-cells--in-block">${weekdayLabels}</div>
      ${month.weeks.map(weekRow => `
        <div class="calendar-month-row">
          <div class="calendar-days-row">
            ${weekRow.map((day) => {
              if (day === null) {
                return `<div class="calendar-square empty"></div>`;
              }
              const colorClass = getCalendarSquareColorClass(day);
              const tooltip = calendarSquareTooltip(day);
              return `<div class="calendar-square ${colorClass}" data-tooltip="${tooltip}" title="${tooltip}"><span class="calendar-square-day">${day.day}</span></div>`;
            }).join('')}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

// Shared header and legend for sleep quality calendar (used by dashboard and quality page)
function renderCalendarHeatmapHeader() {
  return `
    <div class="calendar-heatmap-header">
      <h3 class="calendar-heatmap-title">Sleep Quality history</h3>
      <div class="calendar-heatmap-legend calendar-heatmap-legend--compact">
        <div class="legend-colors-row">
          <span class="legend-label">need data</span>
          <div class="legend-colors">
            <div class="legend-square flag-insufficient" title="Fewer than 7 prior nights"></div>
          </div>
          <span class="legend-divider">·</span>
          <span class="legend-label">good</span>
          <div class="legend-colors">
            <div class="legend-square flag-none"></div>
          </div>
          <span class="legend-label">→</span>
          <div class="legend-colors">
            <div class="legend-square flag-one" title="Slightly"></div>
            <div class="legend-square flag-two" title="Moderately"></div>
            <div class="legend-square flag-three-plus" title="Severe"></div>
          </div>
          <span class="legend-label">off pattern</span>
        </div>
        <span class="legend-divider">·</span>
        <div class="legend-meaning legend-meaning--inline">
          <span class="legend-meaning-item">😴 asleep late vs avg</span>
          <span class="legend-meaning-item">⌛ shorter duration vs avg</span>
          <span class="legend-meaning-item">🌅 wake vs avg</span>
          <span class="legend-meaning-item">🧩 WASO</span>
        </div>
        <span class="legend-explanation legend-explanation--inline">(cell color from worst of 😴 ⌛ 🧩; 🌅 icon only; see Quality page for bands)</span>
      </div>
    </div>
  `;
}

// Dashboard inline: current month calendar only (no header, no legend)
function renderCalendarCurrentMonthOnlyBlock(year, flagMap, latestDataDate) {
  const months = generateCalendarHeatmap(year, flagMap, latestDataDate);
  const now = new Date();
  const isCurrentYear = year === now.getFullYear();
  const currentMonthIndex = isCurrentYear ? now.getMonth() : null;
  const currentMonthBlock = currentMonthIndex !== null ? renderMonthBlock(months[currentMonthIndex], true) : '';
  if (!currentMonthBlock) return '';
  return `
    <div class="calendar-heatmap calendar-heatmap--inline">
      <div class="calendar-current-month-row">${currentMonthBlock}</div>
    </div>
  `;
}

// Quality history page: all months in grid (no separate current-month row)
function renderCalendarHeatmapFullHistory(year, flagMap, latestDataDate) {
  const months = generateCalendarHeatmap(year, flagMap, latestDataDate);

  return `
    <div class="calendar-heatmap-container">
      ${renderCalendarHeatmapHeader()}
      <div class="calendar-heatmap">
        <div class="calendar-month-grid">
          ${months.map((month) => renderMonthBlock(month, false)).join('')}
        </div>
      </div>
    </div>
  `;
}

// Recommended sleep/wake window: sleep band ±30 min; wake band ±15 min (wake consistency is more important).
const PROJECTION_BAND_MINUTES = 30;
const WAKE_PROJECTION_BAND_MINUTES = 15;
const TONIGHT_ADJUST_SCOPE_PAD_MINUTES = 360;
const TONIGHT_ADJUST_MIN_GAP_MINUTES = 1;

/** Returns { phase, icon, timeLabel, percentRemaining } for remaining wake time (used by dashboard nav). */
function getRemainingWakeDisplay(recentAverages) {
  const sleepTarget = recentAverages.avgSleepStart;
  const wakeTarget = recentAverages.avgSleepEnd;
  const totalWakeMins = durationMinutes(wakeTarget, sleepTarget);
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const remainingMins = sleepTarget >= nowMins
    ? sleepTarget - nowMins
    : 1440 - nowMins + sleepTarget;
  const phase = getRemainingWakePhase(remainingMins, totalWakeMins);
  const icon = getRemainingWakeIcon(phase);
  const timeLabel = formatDuration(Math.round(remainingMins));
  const percentRemaining = totalWakeMins > 0
    ? Math.min(100, Math.max(0, (remainingMins / totalWakeMins) * 100))
    : 100;
  return { phase, icon, timeLabel, percentRemaining };
}

function normalizeClockMinutesNearReference(clockMinutes, referenceMinutes) {
  let value = modMinutes1440(clockMinutes);
  while (value - referenceMinutes > 720) value -= 1440;
  while (referenceMinutes - value > 720) value += 1440;
  return value;
}

function getTonightProjectionBaseState(recentAverages) {
  const sleepTarget = recentAverages.avgSleepStart;
  const wakeTarget = recentAverages.avgSleepEnd;
  const sleepByLow = modMinutes1440(sleepTarget - PROJECTION_BAND_MINUTES);
  const sleepByHigh = modMinutes1440(sleepTarget + PROJECTION_BAND_MINUTES);
  const wakeByLow = modMinutes1440(wakeTarget - WAKE_PROJECTION_BAND_MINUTES);
  const wakeByHigh = modMinutes1440(wakeTarget + WAKE_PROJECTION_BAND_MINUTES);
  const recommendedDurationMins = durationMinutes(sleepTarget, wakeTarget);

  const recommendedSleepNorm = normalizeTimeForAveraging(sleepTarget);
  const recommendedWakeNorm = normalizeWakeTimeForAveraging(sleepTarget, wakeTarget);
  const scopeStartNorm = recommendedSleepNorm - TONIGHT_ADJUST_SCOPE_PAD_MINUTES;
  const scopeEndNorm = recommendedWakeNorm + TONIGHT_ADJUST_SCOPE_PAD_MINUTES;

  return {
    sleepTarget,
    wakeTarget,
    sleepByLow,
    sleepByHigh,
    wakeByLow,
    wakeByHigh,
    recommendedDurationMins,
    recommendedSleepNorm,
    recommendedWakeNorm,
    scopeStartNorm,
    scopeEndNorm
  };
}

function clampTonightProjectionNorms(base, sleepNorm, wakeNorm) {
  const min = base.scopeStartNorm;
  const max = base.scopeEndNorm;
  let clampedSleep = Math.min(max - TONIGHT_ADJUST_MIN_GAP_MINUTES, Math.max(min, sleepNorm));
  let clampedWake = Math.max(min + TONIGHT_ADJUST_MIN_GAP_MINUTES, Math.min(max, wakeNorm));
  if (clampedSleep >= clampedWake) {
    if (sleepNorm <= wakeNorm) {
      clampedSleep = clampedWake - TONIGHT_ADJUST_MIN_GAP_MINUTES;
    } else {
      clampedWake = clampedSleep + TONIGHT_ADJUST_MIN_GAP_MINUTES;
    }
  }
  clampedSleep = Math.min(max - TONIGHT_ADJUST_MIN_GAP_MINUTES, Math.max(min, clampedSleep));
  clampedWake = Math.max(min + TONIGHT_ADJUST_MIN_GAP_MINUTES, Math.min(max, clampedWake));
  return { sleepNorm: clampedSleep, wakeNorm: clampedWake };
}

/** Default “recent average” when there is no history (minutes from midnight). */
const QUICK_ADD_FALLBACK_AVERAGES = {
  avgSleepStart: 22 * 60 + 30,
  avgSleepEnd: 7 * 60,
  avgSleepDuration: Math.round(8.5 * 60),
  avgLongestUninterrupted: Math.round(7.5 * 60),
  avgFirstAlarmToWake: null
};

/** Average bed time on the same extended axis as sleep (for slider init). */
function averageBedClockNormalizedMinutes(recentDays) {
  if (!recentDays || recentDays.length === 0) {
    return normalizeTimeForAveraging(22 * 60 + 8);
  }
  let sum = 0;
  recentDays.forEach(function (d) {
    sum += normalizeTimeForAveraging(timeToMinutes(d.bed));
  });
  return Math.round(sum / recentDays.length);
}

function getQuickAddInitialBedNorm(base, sleepNorm, recentDays) {
  const g = TONIGHT_ADJUST_MIN_GAP_MINUTES;
  const rec = averageBedClockNormalizedMinutes(recentDays);
  const maxBed = sleepNorm - g;
  let b = rec;
  if (b > maxBed) b = maxBed;
  if (b < base.scopeStartNorm) b = base.scopeStartNorm;
  return b;
}

function getQuickAddSliderProjection(recentAverages, recentDays) {
  const base = getTonightProjectionBaseState(recentAverages);
  const sleepNorm = base.recommendedSleepNorm;
  const wakeNorm = base.recommendedWakeNorm;
  const clamped = clampTonightProjectionNorms(base, sleepNorm, wakeNorm);
  const scopeSpan = base.scopeEndNorm - base.scopeStartNorm;
  const sleepPct = ((clamped.sleepNorm - base.scopeStartNorm) / scopeSpan) * 100;
  const wakePct = ((clamped.wakeNorm - base.scopeStartNorm) / scopeSpan) * 100;
  const bedNorm = getQuickAddInitialBedNorm(base, clamped.sleepNorm, recentDays || []);
  const bedPct = ((bedNorm - base.scopeStartNorm) / scopeSpan) * 100;
  const recStartPct = ((base.recommendedSleepNorm - base.scopeStartNorm) / scopeSpan) * 100;
  const recEndPct = ((base.recommendedWakeNorm - base.scopeStartNorm) / scopeSpan) * 100;
  const sleepClock = modMinutes1440(clamped.sleepNorm);
  const wakeClock = modMinutes1440(clamped.wakeNorm);
  const bedClock = modMinutes1440(bedNorm);
  return {
    base,
    bedNorm,
    sleepNorm: clamped.sleepNorm,
    wakeNorm: clamped.wakeNorm,
    bedClock,
    sleepClock,
    wakeClock,
    bedPct,
    sleepPct,
    wakePct,
    recStartPct,
    recEndPct,
    midPct: (sleepPct + wakePct) / 2
  };
}

function renderQuickAddDrawer(recentAverages, recentDays) {
  const proj = getQuickAddSliderProjection(recentAverages, recentDays);
  const base = proj.base;
  return `
    <div class="quick-add-drawer" id="quick-add-drawer">
      <div class="quick-add-drawer-shell">
        <button type="button" class="quick-add-drawer-handle" id="quick-add-drawer-handle" aria-expanded="false" aria-controls="quick-add-drawer-body">
          <span class="quick-add-drawer-grip" aria-hidden="true"></span>
          <span class="quick-add-drawer-label">Log night</span>
          <span class="quick-add-drawer-hint" aria-hidden="true">Pull down or tap</span>
        </button>
        <div class="quick-add-drawer-body" id="quick-add-drawer-body">
          <div class="quick-add-drawer-body-inner">
            <form id="quick-add-form" class="quick-add-form" data-initial-bed-norm="${proj.bedNorm}" data-initial-sleep-norm="${proj.sleepNorm}" data-initial-wake-norm="${proj.wakeNorm}">
              <div class="quick-add-field-compact">
                <label class="quick-add-label" for="quick-add-date">Date</label>
                <input class="quick-add-input quick-add-input--date" id="quick-add-date" type="date" required>
              </div>
              <div class="quick-add-dnd-pool" aria-hidden="false">
                <span class="quick-add-bathroom-chip" id="quick-add-bathroom-chip" role="img" aria-label="Bathroom wake">🧻</span>
                <span class="quick-add-alarm-chip" id="quick-add-alarm-chip" role="img" aria-label="Alarm">⏰</span>
                <span class="quick-add-alarm-hint-text">Drag 🧻 or ⏰ on / off the bar.</span>
              </div>
              <div
                class="dashboard-tonight-adjust-slider quick-add-adjust-slider"
                id="quick-add-adjust-slider"
                style="--tonight-bed-pct:${proj.bedPct}%;--tonight-sleep-pct:${proj.sleepPct}%;--tonight-wake-pct:${proj.wakePct}%;--tonight-mid-pct:${proj.midPct}%;--tonight-rec-start-pct:${proj.recStartPct}%;--tonight-rec-end-pct:${proj.recEndPct}%;--quick-add-alarm-pct:50%;">
                <div class="dashboard-tonight-adjust-track">
                  <div class="dashboard-tonight-adjust-range-fill" aria-hidden="true"></div>
                  <div class="dashboard-tonight-adjust-recommended-window quick-add-adjust-recommended-window" aria-hidden="true"></div>
                </div>
                <input type="range" id="quick-add-bed-slider" min="${base.scopeStartNorm}" max="${base.scopeEndNorm}" step="1" value="${proj.bedNorm}" aria-label="Bed time">
                <input type="range" id="quick-add-sleep-slider" min="${base.scopeStartNorm}" max="${base.scopeEndNorm}" step="1" value="${proj.sleepNorm}" aria-label="Fell asleep (saved as sleep start)">
                <input type="range" id="quick-add-wake-slider" min="${base.scopeStartNorm}" max="${base.scopeEndNorm}" step="1" value="${proj.wakeNorm}" aria-label="Wake up">
                <div class="dashboard-tonight-adjust-overlay" id="quick-add-adjust-overlay" aria-hidden="true"></div>
                <div class="quick-add-bathroom-markers" id="quick-add-bathroom-markers"></div>
                <div class="quick-add-alarm-marker" id="quick-add-alarm-marker" hidden>
                  <span class="quick-add-alarm-marker-icon" id="quick-add-alarm-marker-icon">⏰</span>
                  <span class="quick-add-alarm-marker-time" id="quick-add-alarm-marker-time"></span>
                </div>
                <div class="dashboard-tonight-adjust-thumb-icon dashboard-tonight-adjust-thumb-icon--bed quick-add-bed-thumb-icon" aria-hidden="true">🛏️</div>
                <div class="dashboard-tonight-adjust-thumb-icon dashboard-tonight-adjust-thumb-icon--sleep" aria-hidden="true">🌙</div>
                <div class="dashboard-tonight-adjust-thumb-icon dashboard-tonight-adjust-thumb-icon--wake" aria-hidden="true">🌅</div>
                <div class="dashboard-tonight-adjust-thumb-label quick-add-bed-thumb-label" id="quick-add-bed-thumb-label">${formatTime(proj.bedClock)}</div>
                <div class="dashboard-tonight-adjust-thumb-label dashboard-tonight-adjust-thumb-label--sleep" id="quick-add-sleep-thumb-label">${formatTime(proj.sleepClock)}</div>
                <div class="dashboard-tonight-adjust-thumb-label dashboard-tonight-adjust-thumb-label--wake" id="quick-add-wake-thumb-label">${formatTime(proj.wakeClock)}</div>
              </div>
              <details class="quick-add-advanced">
                <summary>Advanced fields (optional)</summary>
                <div class="quick-add-advanced-blocks">
                  <div class="quick-add-adv-row">
                    <span class="quick-add-label" id="quick-add-bathroom-legend">Bathroom wake times</span>
                    <div class="quick-add-time-list" id="quick-add-bathroom-list" aria-labelledby="quick-add-bathroom-legend"></div>
                    <button type="button" class="quick-add-time-add-btn" id="quick-add-bathroom-add">+ Add time</button>
                  </div>
                  <div class="quick-add-adv-row">
                    <span class="quick-add-label" id="quick-add-alarm-adv-legend">Alarm times</span>
                    <div class="quick-add-time-list" id="quick-add-alarm-adv-list" aria-labelledby="quick-add-alarm-adv-legend"></div>
                    <button type="button" class="quick-add-time-add-btn" id="quick-add-alarm-adv-add">+ Add time</button>
                  </div>
                  <div class="quick-add-adv-row">
                    <span class="quick-add-label" id="quick-add-nap-legend">Nap</span>
                    <div class="quick-add-nap-pair">
                      <div>
                        <span class="quick-add-sublabel">Start</span>
                        <div class="quick-add-time-row quick-add-time-row--nap">
                          <input class="quick-add-input quick-add-time-native" id="quick-add-nap-start" type="time" step="60" value="" aria-labelledby="quick-add-nap-legend" aria-label="Nap start">
                          <div class="quick-add-time-spin">
                            <button type="button" class="quick-add-time-spin-btn quick-add-time-spin-btn--up" aria-label="Nap start one minute later">▲</button>
                            <button type="button" class="quick-add-time-spin-btn quick-add-time-spin-btn--down" aria-label="Nap start one minute earlier">▼</button>
                          </div>
                        </div>
                      </div>
                      <div>
                        <span class="quick-add-sublabel">End</span>
                        <div class="quick-add-time-row quick-add-time-row--nap">
                          <input class="quick-add-input quick-add-time-native" id="quick-add-nap-end" type="time" step="60" value="" aria-labelledby="quick-add-nap-legend" aria-label="Nap end">
                          <div class="quick-add-time-spin">
                            <button type="button" class="quick-add-time-spin-btn quick-add-time-spin-btn--up" aria-label="Nap end one minute later">▲</button>
                            <button type="button" class="quick-add-time-spin-btn quick-add-time-spin-btn--down" aria-label="Nap end one minute earlier">▼</button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div class="quick-add-adv-row quick-add-adv-row--waso">
                    <label class="quick-add-label" for="quick-add-waso">WASO count</label>
                    <input class="quick-add-input quick-add-input--waso" id="quick-add-waso" type="number" min="0" step="1" value="0">
                  </div>
                </div>
              </details>
              <p class="quick-add-status" id="quick-add-status"></p>
              <div class="quick-add-actions">
                <button type="button" class="about-theme-option" id="quick-add-cancel">Cancel</button>
                <button type="submit" class="about-theme-option" id="quick-add-save">Save</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  `;
}

function getTonightProjectionState(recentAverages) {
  const base = getTonightProjectionBaseState(recentAverages);
  const override = typeof getTonightProjectionAdjustment === 'function' ? getTonightProjectionAdjustment() : null;

  let sleepNorm = base.recommendedSleepNorm;
  let wakeNorm = base.recommendedWakeNorm;
  if (override) {
    sleepNorm = normalizeClockMinutesNearReference(override.sleep, base.recommendedSleepNorm);
    wakeNorm = normalizeClockMinutesNearReference(override.wake, base.recommendedWakeNorm);
    if (wakeNorm <= sleepNorm) wakeNorm += 1440;
  }

  const clamped = clampTonightProjectionNorms(base, sleepNorm, wakeNorm);
  const sleepClock = modMinutes1440(clamped.sleepNorm);
  const wakeClock = modMinutes1440(clamped.wakeNorm);
  const isAdjusted = sleepClock !== base.sleepTarget || wakeClock !== base.wakeTarget;
  const scopeSpan = base.scopeEndNorm - base.scopeStartNorm;
  const sleepPct = ((clamped.sleepNorm - base.scopeStartNorm) / scopeSpan) * 100;
  const wakePct = ((clamped.wakeNorm - base.scopeStartNorm) / scopeSpan) * 100;
  const recStartPct = ((base.recommendedSleepNorm - base.scopeStartNorm) / scopeSpan) * 100;
  const recEndPct = ((base.recommendedWakeNorm - base.scopeStartNorm) / scopeSpan) * 100;
  return {
    base,
    scopeSpan,
    sleepNorm: clamped.sleepNorm,
    wakeNorm: clamped.wakeNorm,
    sleepClock,
    wakeClock,
    isAdjusted,
    sleepPct,
    wakePct,
    recStartPct,
    recEndPct
  };
}

function renderDashboardProjection(recentAverages) {
  const projection = getTonightProjectionState(recentAverages);
  const base = projection.base;
  const durationMins = durationMinutes(projection.sleepClock, projection.wakeClock);
  const targetClass = projection.isAdjusted ? ' dashboard-projection-target--adjusted' : '';
  const adjustButtonText = 'Adjust';
  const sleepRecommendedHiddenClass = projection.sleepClock === base.sleepTarget ? ' dashboard-projection-recommended--hidden' : '';
  const wakeRecommendedHiddenClass = projection.wakeClock === base.wakeTarget ? ' dashboard-projection-recommended--hidden' : '';
  const durationRecommendedHiddenClass = projection.isAdjusted ? '' : ' dashboard-projection-duration--hidden';

  return `
    <div class="dashboard-projection" id="dashboard-tonight-projection" data-rec-sleep="${base.sleepTarget}" data-rec-wake="${base.wakeTarget}">
      <h2 class="dashboard-projection-title">Tonight</h2>
      <div class="dashboard-projection-grid">
        <div class="dashboard-projection-item">
          <span class="dashboard-projection-label"><span class="proj-keyword proj-sleep">🌙 Sleep</span></span>
          <div class="dashboard-projection-row">
            <span class="dashboard-projection-bounds">${formatTime(base.sleepByLow)}</span>
            <span class="dashboard-projection-sep">—</span>
            <span class="dashboard-projection-target${targetClass}" id="dashboard-tonight-sleep-target">${formatTime(projection.sleepClock)}</span>
            <span class="dashboard-projection-sep">—</span>
            <span class="dashboard-projection-bounds">${formatTime(base.sleepByHigh)}</span>
          </div>
          <div class="dashboard-projection-recommended${sleepRecommendedHiddenClass}" id="dashboard-tonight-sleep-recommended">recent average: <span id="dashboard-tonight-sleep-rec">${formatTime(base.sleepTarget)}</span></div>
        </div>
        <div class="dashboard-projection-item dashboard-projection-item--wake">
          <span class="dashboard-projection-label"><span class="proj-keyword proj-wake">🌅 Wake</span></span>
          <div class="dashboard-projection-row">
            <span class="dashboard-projection-bounds">${formatTime(base.wakeByLow)}</span>
            <span class="dashboard-projection-sep">—</span>
            <span class="dashboard-projection-target${targetClass}" id="dashboard-tonight-wake-target">${formatTime(projection.wakeClock)}</span>
            <span class="dashboard-projection-sep">—</span>
            <span class="dashboard-projection-bounds">${formatTime(base.wakeByHigh)}</span>
          </div>
          <div class="dashboard-projection-recommended${wakeRecommendedHiddenClass}" id="dashboard-tonight-wake-recommended">recent average: <span id="dashboard-tonight-wake-rec">${formatTime(base.wakeTarget)}</span></div>
        </div>
      </div>
      <p class="dashboard-projection-duration" id="dashboard-tonight-duration">target: ~${formatDuration(durationMins)} sleep</p>
      <p class="dashboard-projection-duration dashboard-projection-duration--recommended${durationRecommendedHiddenClass}" id="dashboard-tonight-duration-recommended">recent average: ~${formatDuration(base.recommendedDurationMins)} sleep</p>
      <div class="dashboard-tonight-adjust">
        <button type="button" class="dashboard-tonight-adjust-toggle" id="dashboard-tonight-adjust-toggle" aria-expanded="false" aria-controls="dashboard-tonight-adjust-panel">${adjustButtonText}</button>
        <div class="dashboard-tonight-adjust-panel dashboard-tonight-adjust-panel--hidden" id="dashboard-tonight-adjust-panel">
          <div
            class="dashboard-tonight-adjust-slider"
            id="dashboard-tonight-adjust-slider"
            style="--tonight-sleep-pct:${projection.sleepPct}%;--tonight-wake-pct:${projection.wakePct}%;--tonight-mid-pct:${(projection.sleepPct + projection.wakePct) / 2}%;--tonight-rec-start-pct:${projection.recStartPct}%;--tonight-rec-end-pct:${projection.recEndPct}%;">
            <div class="dashboard-tonight-adjust-track">
              <div class="dashboard-tonight-adjust-range-fill" aria-hidden="true"></div>
              <div class="dashboard-tonight-adjust-recommended-window" aria-hidden="true">
                <span class="dashboard-tonight-adjust-recommended-text">recent average</span>
              </div>
            </div>
            <input type="range" id="dashboard-tonight-sleep-slider" min="${base.scopeStartNorm}" max="${base.scopeEndNorm}" step="1" value="${projection.sleepNorm}" aria-label="Tonight sleep target">
            <input type="range" id="dashboard-tonight-wake-slider" min="${base.scopeStartNorm}" max="${base.scopeEndNorm}" step="1" value="${projection.wakeNorm}" aria-label="Tomorrow wake target">
            <div class="dashboard-tonight-adjust-overlay" id="dashboard-tonight-adjust-overlay" aria-hidden="true"></div>
            <div class="dashboard-tonight-adjust-thumb-icon dashboard-tonight-adjust-thumb-icon--sleep" aria-hidden="true">🛏️</div>
            <div class="dashboard-tonight-adjust-thumb-icon dashboard-tonight-adjust-thumb-icon--wake" aria-hidden="true">🌅</div>
            <div class="dashboard-tonight-adjust-baseline-label dashboard-tonight-adjust-baseline-label--sleep dashboard-tonight-adjust-baseline-label--hidden" id="dashboard-tonight-sleep-baseline-label">${formatTime(base.sleepTarget)}</div>
            <div class="dashboard-tonight-adjust-baseline-label dashboard-tonight-adjust-baseline-label--wake dashboard-tonight-adjust-baseline-label--hidden" id="dashboard-tonight-wake-baseline-label">${formatTime(base.wakeTarget)}</div>
            <div class="dashboard-tonight-adjust-thumb-label dashboard-tonight-adjust-thumb-label--sleep" id="dashboard-tonight-sleep-thumb-label">${formatTime(projection.sleepClock)}</div>
            <div class="dashboard-tonight-adjust-thumb-label dashboard-tonight-adjust-thumb-label--wake" id="dashboard-tonight-wake-thumb-label">${formatTime(projection.wakeClock)}</div>
          </div>
          <div class="dashboard-tonight-adjust-actions">
            <button type="button" class="dashboard-tonight-adjust-reset" id="dashboard-tonight-adjust-reset">Use recent average</button>
            <button type="button" class="dashboard-tonight-adjust-set" id="dashboard-tonight-adjust-set">Set</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function initDashboardTonightAdjuster(recentAverages, onChange) {
  const root = document.getElementById('dashboard-tonight-projection');
  const toggleButton = document.getElementById('dashboard-tonight-adjust-toggle');
  const panel = document.getElementById('dashboard-tonight-adjust-panel');
  const sliderWrap = document.getElementById('dashboard-tonight-adjust-slider');
  const sliderOverlay = document.getElementById('dashboard-tonight-adjust-overlay');
  const sleepSlider = document.getElementById('dashboard-tonight-sleep-slider');
  const wakeSlider = document.getElementById('dashboard-tonight-wake-slider');
  const sleepLabel = document.getElementById('dashboard-tonight-sleep-thumb-label');
  const wakeLabel = document.getElementById('dashboard-tonight-wake-thumb-label');
  const sleepTargetEl = document.getElementById('dashboard-tonight-sleep-target');
  const wakeTargetEl = document.getElementById('dashboard-tonight-wake-target');
  const durationEl = document.getElementById('dashboard-tonight-duration');
  const sleepRecommendedEl = document.getElementById('dashboard-tonight-sleep-recommended');
  const wakeRecommendedEl = document.getElementById('dashboard-tonight-wake-recommended');
  const durationRecommendedEl = document.getElementById('dashboard-tonight-duration-recommended');
  const sleepBaselineLabelEl = document.getElementById('dashboard-tonight-sleep-baseline-label');
  const wakeBaselineLabelEl = document.getElementById('dashboard-tonight-wake-baseline-label');
  const resetButton = document.getElementById('dashboard-tonight-adjust-reset');
  const setButton = document.getElementById('dashboard-tonight-adjust-set');
  if (!root || !toggleButton || !panel || !sliderWrap || !sliderOverlay || !sleepSlider || !wakeSlider || !sleepLabel || !wakeLabel || !sleepTargetEl || !wakeTargetEl || !durationEl || !sleepRecommendedEl || !wakeRecommendedEl || !durationRecommendedEl || !sleepBaselineLabelEl || !wakeBaselineLabelEl || !resetButton || !setButton) {
    return;
  }

  const base = getTonightProjectionBaseState(recentAverages);
  let state = getTonightProjectionState(recentAverages);

  function closePanel() {
    panel.classList.add('dashboard-tonight-adjust-panel--hidden');
    toggleButton.setAttribute('aria-expanded', 'false');
  }

  function updateVisualState(persistOverride) {
    const sleepPct = ((state.sleepNorm - base.scopeStartNorm) / (base.scopeEndNorm - base.scopeStartNorm)) * 100;
    const wakePct = ((state.wakeNorm - base.scopeStartNorm) / (base.scopeEndNorm - base.scopeStartNorm)) * 100;
    const midPct = (sleepPct + wakePct) / 2;
    sliderWrap.style.setProperty('--tonight-sleep-pct', `${sleepPct}%`);
    sliderWrap.style.setProperty('--tonight-wake-pct', `${wakePct}%`);
    sliderWrap.style.setProperty('--tonight-mid-pct', `${midPct}%`);

    sleepSlider.value = String(state.sleepNorm);
    wakeSlider.value = String(state.wakeNorm);

    sleepTargetEl.textContent = formatTime(state.sleepClock);
    wakeTargetEl.textContent = formatTime(state.wakeClock);
    sleepLabel.textContent = formatTime(state.sleepClock);
    wakeLabel.textContent = formatTime(state.wakeClock);

    const duration = durationMinutes(state.sleepClock, state.wakeClock);
    durationEl.textContent = `target: ~${formatDuration(duration)} sleep`;

    const sleepAdjusted = state.sleepClock !== base.sleepTarget;
    const wakeAdjusted = state.wakeClock !== base.wakeTarget;
    sleepTargetEl.classList.toggle('dashboard-projection-target--adjusted', state.isAdjusted);
    wakeTargetEl.classList.toggle('dashboard-projection-target--adjusted', state.isAdjusted);
    sleepRecommendedEl.classList.toggle('dashboard-projection-recommended--hidden', !sleepAdjusted);
    wakeRecommendedEl.classList.toggle('dashboard-projection-recommended--hidden', !wakeAdjusted);
    durationRecommendedEl.classList.toggle('dashboard-projection-duration--hidden', !state.isAdjusted);
    sleepBaselineLabelEl.classList.toggle('dashboard-tonight-adjust-baseline-label--hidden', !sleepAdjusted);
    wakeBaselineLabelEl.classList.toggle('dashboard-tonight-adjust-baseline-label--hidden', !wakeAdjusted);
    toggleButton.textContent = 'Adjust';
    root.classList.toggle('dashboard-tonight-projection--adjusted', state.isAdjusted);

    if (persistOverride && typeof setTonightProjectionAdjustment === 'function' && typeof clearTonightProjectionAdjustment === 'function') {
      if (state.isAdjusted) {
        setTonightProjectionAdjustment(state.sleepClock, state.wakeClock);
      } else {
        clearTonightProjectionAdjustment();
      }
    }

    if (typeof onChange === 'function') {
      onChange({ sleepTarget: state.sleepClock, wakeTarget: state.wakeClock, isAdjusted: state.isAdjusted });
    }
  }

  function updateFromSliders(changedSide) {
    let sleepNorm = parseInt(sleepSlider.value, 10);
    let wakeNorm = parseInt(wakeSlider.value, 10);
    if (changedSide === 'sleep' && sleepNorm >= wakeNorm) {
      sleepNorm = wakeNorm - TONIGHT_ADJUST_MIN_GAP_MINUTES;
    } else if (changedSide === 'wake' && wakeNorm <= sleepNorm) {
      wakeNorm = sleepNorm + TONIGHT_ADJUST_MIN_GAP_MINUTES;
    }
    const clamped = clampTonightProjectionNorms(base, sleepNorm, wakeNorm);
    state = {
      ...state,
      sleepNorm: clamped.sleepNorm,
      wakeNorm: clamped.wakeNorm,
      sleepClock: modMinutes1440(clamped.sleepNorm),
      wakeClock: modMinutes1440(clamped.wakeNorm)
    };
    state.isAdjusted = state.sleepClock !== base.sleepTarget || state.wakeClock !== base.wakeTarget;
    updateVisualState(true);
  }

  function getNormFromPointer(e) {
    const rect = sliderWrap.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.round(base.scopeStartNorm + frac * (base.scopeEndNorm - base.scopeStartNorm));
  }

  let dragging = null;
  function onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    if (e.touches && e.touches.length > 1) return;
    if (e.cancelable) e.preventDefault();
    const norm = getNormFromPointer(e);
    const distToSleep = Math.abs(norm - state.sleepNorm);
    const distToWake = Math.abs(norm - state.wakeNorm);
    dragging = distToSleep <= distToWake ? 'sleep' : 'wake';
    if (dragging === 'sleep') {
      sleepSlider.value = String(norm);
    } else {
      wakeSlider.value = String(norm);
    }
    updateFromSliders(dragging);
  }

  function onPointerMove(e) {
    if (!dragging) return;
    if (e.cancelable) e.preventDefault();
    const norm = getNormFromPointer(e);
    if (dragging === 'sleep') {
      sleepSlider.value = String(norm);
    } else {
      wakeSlider.value = String(norm);
    }
    updateFromSliders(dragging);
  }

  function onPointerUp() {
    dragging = null;
  }

  sleepSlider.addEventListener('input', function () {
    updateFromSliders('sleep');
  });
  wakeSlider.addEventListener('input', function () {
    updateFromSliders('wake');
  });

  toggleButton.addEventListener('click', function () {
    const isHidden = panel.classList.contains('dashboard-tonight-adjust-panel--hidden');
    panel.classList.toggle('dashboard-tonight-adjust-panel--hidden', !isHidden);
    toggleButton.setAttribute('aria-expanded', isHidden ? 'true' : 'false');
  });

  resetButton.addEventListener('click', function () {
    state = {
      ...state,
      sleepNorm: base.recommendedSleepNorm,
      wakeNorm: base.recommendedWakeNorm,
      sleepClock: base.sleepTarget,
      wakeClock: base.wakeTarget,
      isAdjusted: false
    };
    if (typeof clearTonightProjectionAdjustment === 'function') clearTonightProjectionAdjustment();
    updateVisualState(false);
    closePanel();
  });

  setButton.addEventListener('click', function () {
    closePanel();
    updateVisualState(false);
  });

  sliderOverlay.addEventListener('mousedown', onPointerDown);
  sliderOverlay.addEventListener('touchstart', onPointerDown, { passive: false });
  document.addEventListener('mousemove', onPointerMove);
  document.addEventListener('touchmove', onPointerMove, { passive: false });
  document.addEventListener('mouseup', onPointerUp);
  document.addEventListener('touchend', onPointerUp);
  document.addEventListener('touchcancel', onPointerUp);

  updateVisualState(false);
}

// Render dashboard content: projection, recent average, lifetime average, recent nights (timeline rows), sleep quality history.
// Used by dashboard.html; kept here to share calculation/render helpers.
function renderDashboardContent(days) {
  const recentDays = days && days.length
    ? days.slice(0, Math.min(7, days.length))
    : [];
  const recentAverages = recentDays.length
    ? calculateAverages(recentDays)
    : QUICK_ADD_FALLBACK_AVERAGES;
  const quickAddDrawerHtml = renderQuickAddDrawer(recentAverages, recentDays);

  if (!days || days.length === 0) {
    return `
    <div class="dashboard-content">
      ${quickAddDrawerHtml}
      <p class="dashboard-empty-msg">No sleep data yet.</p>
    </div>`;
  }

  const flagMap = buildFlagCountMap(days);
  const latestDataDate = getLatestDataDate(days, YEAR);
  const calendarBlockOnly = renderCalendarCurrentMonthOnlyBlock(YEAR, flagMap, latestDataDate);

  const recentNightsCount = Math.min(3, days.length);
  const recentNightsHtml = recentNightsCount > 0
    ? `
    <h2 class="dashboard-section-title">Recent nights</h2>
    <section class="dashboard-past-nights">
      <div class="week-days">
        ${Array.from({ length: recentNightsCount }, (_, i) => renderDay(days[i], days, i, { showTicks: true })).join('')}
      </div>
    </section>
    `
    : '';

  const sevenDaySectionHtml = `
    <h2 class="dashboard-section-title">Past Week</h2>
    <div class="dashboard-7d-row">
      <div class="dashboard-7d-col">
        <h3 class="dashboard-7d-subtitle">Wake and sleep times</h3>
        <div class="dashboard-7d-graph-container" id="dashboard-7d-time-graph"></div>
      </div>
      <div class="dashboard-7d-col">
        <h3 class="dashboard-7d-subtitle">Total sleep time</h3>
        <div class="dashboard-7d-graph-container" id="dashboard-7d-duration-graph"></div>
      </div>
    </div>
  `;

  return `
    <div class="dashboard-content">
      ${quickAddDrawerHtml}
      <div class="dashboard-top-row">
        <div class="dashboard-top-col dashboard-top-col--tonight">
          ${renderDashboardProjection(recentAverages)}
        </div>
        <div class="dashboard-top-col dashboard-top-col--calendar">
          ${calendarBlockOnly}
        </div>
      </div>
      ${sevenDaySectionHtml}
      ${recentNightsHtml}
    </div>
  `;
}

// Render timeline legend and show/hide controls (full-width strip above weekly timelines)
function renderTimelineLegendControls() {
  return `
    <div class="timeline-legend-controls">
      <div class="timeline-legend-block">
        <div class="legend">
          <span class="sleep">sleep</span>
          <span class="nap">nap</span>
          <span class="bed">bed</span>
          <span class="alarm">alarm</span>
          <span class="bath">bathroom</span>
          <span class="up">get up</span>
        </div>
      </div>
      <div class="timeline-show-hide-block">
        <div class="show-hide-section">
          <div class="show-hide-title">show/hide</div>
          <label class="time-toggle">
            <input type="checkbox" id="show-time-ticks" checked>
            <span>time</span>
          </label>
          <label class="time-toggle">
            <input type="checkbox" id="show-daily-details" checked>
            <span>daily details</span>
          </label>
          <label class="time-toggle">
            <input type="checkbox" id="show-flags" checked>
            <span>flags</span>
          </label>
        </div>
      </div>
    </div>
  `;
}

// Toggle time tick visibility
function toggleTimeTicks(show) {
  document.querySelectorAll('.bar').forEach(bar => {
    bar.classList.toggle('show-ticks', show);
  });
}

// Toggle daily details visibility
function toggleDailyDetails(show) {
  document.querySelectorAll('.day-stats').forEach(stats => {
    stats.classList.toggle('hidden', !show);
  });
}

// Toggle deviation warnings/flags visibility
function toggleFlags(show) {
  document.querySelectorAll('.deviation-warnings').forEach(warnings => {
    warnings.classList.toggle('hidden', !show);
  });
}

let deviationFlagChipListenersBound = false;

function onDeviationFlagDocumentClick(e) {
  const chip = e.target.closest('.deviation-flag-chip');
  if (chip) {
    const wasOpen = chip.classList.contains('is-expanded');
    document.querySelectorAll('.deviation-flag-chip.is-expanded').forEach(c => {
      c.classList.remove('is-expanded');
      c.setAttribute('aria-expanded', 'false');
    });
    if (!wasOpen) {
      chip.classList.add('is-expanded');
      chip.setAttribute('aria-expanded', 'true');
    }
    return;
  }
  document.querySelectorAll('.deviation-flag-chip.is-expanded').forEach(c => {
    c.classList.remove('is-expanded');
    c.setAttribute('aria-expanded', 'false');
  });
}

function onDeviationFlagEscape(e) {
  if (e.key !== 'Escape') return;
  document.querySelectorAll('.deviation-flag-chip.is-expanded').forEach(c => {
    c.classList.remove('is-expanded');
    c.setAttribute('aria-expanded', 'false');
  });
}

/** Tap/click to expand chips; click outside or Escape closes. Safe to call multiple times. */
function initDeviationFlagChips() {
  if (deviationFlagChipListenersBound) return;
  if (typeof document === 'undefined') return;
  deviationFlagChipListenersBound = true;
  document.addEventListener('click', onDeviationFlagDocumentClick);
  document.addEventListener('keydown', onDeviationFlagEscape);
}

// Toggle week collapse/expand
function toggleWeek(weekId) {
  const weekContent = document.getElementById(weekId);
  const weekHeader = document.querySelector(`[data-week-id="${weekId}"]`);
  const toggleIcon = weekHeader.querySelector('.week-toggle-icon');
  
  if (weekContent.classList.contains('collapsed')) {
    weekContent.classList.remove('collapsed');
    toggleIcon.textContent = '▼';
  } else {
    weekContent.classList.add('collapsed');
    toggleIcon.textContent = '▶';
  }
}

// Load and render data (only on timeline page when #days-container exists)
const daysContainer = document.getElementById('days-container');
if (daysContainer) {
  loadSleepData()
    .then((sleepData) => {

      const legendControlsEl = document.getElementById('timeline-legend-controls');
      if (legendControlsEl) legendControlsEl.innerHTML = renderTimelineLegendControls();

      const weeks = groupDaysByWeek(sleepData.days);
      daysContainer.innerHTML = weeks.map((week, index) => renderWeek(week, index, sleepData.days)).join('');

      document.querySelectorAll('.week-header').forEach(header => {
        header.addEventListener('click', () => {
          const weekId = header.getAttribute('data-week-id');
          toggleWeek(weekId);
        });
      });

      function setupCheckbox(id, toggleFn) {
        const checkbox = document.getElementById(id);
        if (checkbox) {
          checkbox.addEventListener('change', (e) => toggleFn(e.target.checked));
          toggleFn(checkbox.checked);
        }
      }
      setupCheckbox('show-time-ticks', toggleTimeTicks);
      setupCheckbox('show-daily-details', toggleDailyDetails);
      setupCheckbox('show-flags', toggleFlags);
    })
    .catch(error => {
      console.error('Error loading data:', error);
      daysContainer.innerHTML = '<p>Error loading data</p>';
    });
}

initDeviationFlagChips();
