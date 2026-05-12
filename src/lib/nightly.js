// Configuration constants
const ALARM_TO_WAKE_WARNING_THRESHOLD = 60; // minutes
/** Prior nights required before timing flags or heatmap colors apply. */
const LOOKBACK_DAYS = 7;
/** Minimum logged nights before Tonight matrix shows natural / guidance cells (same window as weekly averages). */
const TONIGHT_MATRIX_MIN_NATURAL_DAYS = 7;
const DAY_MINUTES = 1440;
/** Weight when blending sleep-relative vs day-relative variation (internal only). */
const BLEND_ALPHA = 0.75;
/** Total sleep (main + nap) below these minute thresholds adds a duration flag (absolute floor; combined with relative short-sleep via max severity, not stacked). */
const ABS_DURATION_SLIGHT_LT_MIN = 360; // < 6h → slight
const ABS_DURATION_MODERATE_LT_MIN = 300; // < 5h → moderate
const ABS_DURATION_SEVERE_LT_MIN = 240; // < 4h → severe
const DATA_FILES = {
  sleep: 'data/sleep-data.json'
};

/** Internal nav href (MPA or SPA) from routes-data.mjs. */
function restoreMpaHref(key) {
  const g = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : null;
  const d = g && g.__restoreRoutesData;
  if (d && typeof d.internalNavHref === 'function') return d.internalNavHref(key);
  if (d && typeof d.mpaHref === 'function') return d.mpaHref(key);
  return '#';
}

// Time constants
const MILLISECONDS_PER_DAY = 86400000;
// Timeline runs 21:00 to 21:00 (24 hours). Ticks: 21 (start), 0, 4, 8, 12, 16, 21 (end)
// In timeline minutes: 0, 180, 420, 660, 900, 1140, 1440
const TIME_TICKS = [0, 180, 420, 660, 900, 1140, 1440]; // 21, 0, 4, 8, 12, 16, 21 hours
const TIMELINE_START_MINUTES = 1260; // 21:00 in minutes
const PREVIOUS_DAY_DURATION = 180; // 3 hours from 21:00 to 00:00

// Holidays data (from sleep-utils.js HOLIDAYS_BY_YEAR)
let holidays = typeof window !== 'undefined' && window.HOLIDAYS_BY_YEAR ? window.HOLIDAYS_BY_YEAR : {};

// Note: parseDateString, getDateFromString, isHoliday, and isWeekend are in sleep-utils.js (ISO `YYYY-MM-DD` sleep keys).

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
  const currentMonday = getMondayOfWeek(getAppDate());
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

// Note: timeToMinutes lives in time-utils.js (global).

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

// Note: formatDuration and formatTime are in time-utils.js (global).

// Note: calculateTotalSleep is now in sleep-utils.js

// Note: normalizeTimeForComparison, normalizeTimeForAveraging, and denormalizeTimeForAveraging
// are in time-utils.js (global).

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
      plainSummary: 'Learning your sleep habits (Based on your last 7 nights)',
      bodyHtml: 'Learning your sleep habits<br><span class="deviation-flag-chip-note">(Based on your last 7 nights)</span>'
    }];
  }

  const warnings = [];
  const t = analyzeTimingDeviations(day, recentAverages);

  if (t.asleepSeverity) {
    const detail = `${formatDuration(Math.round(t.asleepDiff))} later than recent average`;
    warnings.push({
      severity: t.asleepSeverity,
      emoji: '😴',
      plainSummary: `Sleep: ${detail}`,
      bodyHtml: `<strong>Sleep</strong>: ${detail}`
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
      emoji: '👁️',
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

function sleepDayUserLabelsMarkup(day) {
  const normalized =
    typeof normalizeSleepDayLabels === 'function'
      ? normalizeSleepDayLabels(day && day.labels)
      : Array.isArray(day && day.labels)
        ? day.labels
        : [];
  if (!normalized.length) return '';
  const defs = typeof SLEEP_DAY_LABEL_OPTIONS !== 'undefined' ? SLEEP_DAY_LABEL_OPTIONS : [];
  function titleFor(emoji) {
    for (let i = 0; i < defs.length; i++) {
      if (defs[i].emoji === emoji) return defs[i].title;
    }
    return '';
  }
  const chips = normalized
    .map(function (emoji) {
      const tit = titleFor(emoji);
      const aria = escapeHtmlAttr(tit || emoji);
      return `<span class="sleep-day-user-label" role="img" aria-label="${aria}" title="${aria}">${emoji}</span>`;
    })
    .join('');
  return `<div class="sleep-day-user-labels" aria-label="Night notes">${chips}</div>`;
}

function deviationWarningMarkup(w) {
  function slotify(buttonHtml) {
    return `<span class="deviation-flag-chip-slot">${buttonHtml}</span>`;
  }
  if (typeof w === 'string') {
    return slotify(
      `<button type="button" class="deviation-flag-chip deviation-flag-chip--insufficient" aria-expanded="false" aria-label="${escapeHtmlAttr(w)}"><span class="deviation-flag-chip-icon" aria-hidden="true">🌱</span><span class="deviation-flag-chip-text">${escapeHtmlText(w)}</span></button>`
    );
  }
  const label = w.plainSummary || '';
  const aria = escapeHtmlAttr(label);
  if (w.severity === 'insufficient') {
    return slotify(
      `<button type="button" class="deviation-flag-chip deviation-flag-chip--insufficient" aria-expanded="false" aria-label="${aria}"><span class="deviation-flag-chip-icon" aria-hidden="true">🌱</span><span class="deviation-flag-chip-text">${w.bodyHtml}</span></button>`
    );
  }
  const sevClass = `deviation-flag-chip--${w.severity}`;
  return slotify(
    `<button type="button" class="deviation-flag-chip ${sevClass}" aria-expanded="false" aria-label="${aria}"><span class="deviation-flag-chip-icon" aria-hidden="true">${w.emoji}</span><span class="deviation-flag-chip-text">${w.bodyHtml}</span></button>`
  );
}

// Flag emojis for calendar tooltip (timing uses blended % thresholds; 👁️ when WASO ≥ 1)
function getFlagTypes(day, recentAverages) {
  if (!recentAverages || recentAverages.insufficient) return [];

  const t = analyzeTimingDeviations(day, recentAverages);
  const flagTypes = [];
  if (t.asleepSeverity) flagTypes.push('😴');
  if (t.durationSeverity) flagTypes.push('⌛');
  if (t.wakeSeverity) flagTypes.push('🌅');
  if (normalizeFragmentationLevel(day)) flagTypes.push('👁️');
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

/** Inline 🛌 +Xm after sleep time (bed→sleep latency; SKP bed-colored via CSS). */
function bedToSleepStatSuffixHtml(delayMinutes) {
  const dur = formatDuration(Math.round(delayMinutes));
  const title = `Time from bed to sleep: ${dur}`;
  return (
    ' <span class="stat-bed-to-sleep-emoji" role="img" aria-label="' +
    escapeHtmlAttr(title) +
    '" title="' +
    escapeHtmlAttr(title) +
    '">🛌</span> <span class="stat-bed-to-sleep-delay">+' +
    dur +
    '</span>'
  );
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
  
  const dayOfWeek = getDateFromString(day.date).toLocaleDateString('en-US', { weekday: 'short' });
  
  // Check for deviations from recent averages
  const recentAverages = calculateRecentAverages(days, dayIndex);
  const deviations = checkDeviations(day, recentAverages);
  const deviationWarnings = deviations.length > 0
    ? `<div class="deviation-warnings deviation-warnings--chips">${deviations.map(deviationWarningMarkup).join('')}</div>`
    : '';
  const userLabelsBlock = sleepDayUserLabelsMarkup(day);
  const dayFlagsRow = `<div class="day-flags-row"><div class="day-flags-content">${deviationWarnings}${userLabelsBlock}</div></div>`;
  const hasAlarms = day.alarm && day.alarm.length > 0;
  let wakeValueSuffix = '';
  if (!hasAlarms) {
    wakeValueSuffix =
      ' <span class="stat-natural-wake-emoji" role="img" aria-label="Natural wake" title="Natural wake">🌄</span>';
  } else if (firstAlarmToWake !== null && firstAlarmToWake < 0) {
    const earlyBy = formatDuration(-firstAlarmToWake);
    const parenInner = `⏰-${earlyBy}`;
    const parenTitle = `Before alarm by ${earlyBy}`;
    wakeValueSuffix =
      ' <span class="stat-natural-wake-emoji" role="img" aria-label="Woke before alarm" title="Woke before alarm">🌄</span>' +
      ` <span class="stat-wake-before-alarm-paren" role="img" aria-label="${escapeHtmlAttr(parenTitle)}" title="${escapeHtmlAttr(parenTitle)}">(${parenInner})</span>`;
  } else if (firstAlarmToWake !== null && firstAlarmToWake >= 0) {
    const delayWarn =
      firstAlarmToWake > ALARM_TO_WAKE_WARNING_THRESHOLD ? ' stat-warning' : '';
    wakeValueSuffix =
      ' <span class="stat-wake-alarm-emoji" role="img" aria-label="Alarm wake" title="Alarm wake">⏰</span>' +
      `<span class="stat-wake-after-alarm-delay${delayWarn}">+${formatDuration(firstAlarmToWake)}</span>`;
  } else {
    wakeValueSuffix =
      ' <span class="stat-wake-alarm-emoji" role="img" aria-label="Alarm set" title="Alarm">⏰</span>';
  }

  const sleepValueSuffix = bedToSleepStatSuffixHtml(calculateSleepDelay(day));

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
        <div class="day-row day-row--data">
          <div class="day-date">${formatSleepDateMonthDay(day.date)} ${dayOfWeek}${isHolidayDay ? ' 🏝️' : ''}</div>
          ${dayFlagsRow}
          <div class="day-metrics">
            <div class="day-metrics-phases day-stats">
              <div class="stat-row"><span class="stat-label">${highlightKeyword('sleep:', 'sleep')}</span><span class="stat-value">${day.sleepStart}${sleepValueSuffix}</span></div>
              <div class="stat-row"><span class="stat-label">${highlightKeyword('wake:', 'wake')}</span><span class="stat-value">${day.sleepEnd}${wakeValueSuffix}</span></div>
            </div>
            <div class="day-metrics-calcs day-stats">
              <div class="stat-row"><span class="stat-label">${highlightKeyword('duration:', 'duration')}</span><span class="stat-value">${formatDuration(sleepDuration)}</span></div>
              <div class="stat-row"><span class="stat-label">uninterrupted:</span><span class="stat-value">${formatDuration(longestUninterrupted)}</span></div>
            </div>
          </div>
        </div>
        <div class="day-row day-row--viz">
          <div class="day-bar-container">
            <div class="${barClass}">
            <!-- Faded overlay for previous day section (21:00-00:00) -->
            <div class="previous-day-overlay"></div>
            <div class="span sleep" style="--start:${sleepStartPos}; --end:${sleepEndPos}" data-tooltip="duration: ${formatDuration(sleepDuration)}">${sleepFragmentationOverlayHtml(day)}</div>
            <!-- Time tick marks -->
            ${TIME_TICKS.map((minutes, i) => `<div class="time-tick" style="--m:${minutes}"><span class="tick-label">${tickLabels[i]}</span></div>`).join('')}
  `;
  
  if (day.nap && day.nap.start && day.nap.end) {
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
  
  (day.alarm || []).forEach(time => {
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
      </div>
    </div>`;
  return html;
}

// Note: normalizeTimeForAveraging and denormalizeTimeForAveraging are in time-utils.js (global).

// Calculate average stats
function calculateAverages(days) {
  let sleepDurationSum = 0;
  let longestUninterruptedSum = 0;
  let firstAlarmToWakeSum = 0;
  let firstAlarmToWakeCount = 0;
  let sleepStartSum = 0;
  let sleepEndSum = 0;
  let bedToSleepDelaySum = 0;
  
  days.forEach(day => {
    sleepDurationSum += calculateTotalSleep(day);
    longestUninterruptedSum += calculateLongestUninterrupted(day);
    bedToSleepDelaySum += calculateSleepDelay(day);
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
  
  const n = days.length;
  return {
    sampleSize: n,
    avgSleepStart: denormalizeTimeForAveraging(Math.round(sleepStartSum / n)),
    avgSleepEnd: denormalizeTimeForAveraging(Math.round(sleepEndSum / n)),
    avgSleepDuration: Math.round(sleepDurationSum / n),
    avgLongestUninterrupted: Math.round(longestUninterruptedSum / n),
    avgBedToSleepDelay: n > 0 ? Math.round(bedToSleepDelaySum / n) : 0,
    avgFirstAlarmToWake: firstAlarmToWakeCount > 0 ? Math.round(firstAlarmToWakeSum / firstAlarmToWakeCount) : null
  };
}

// Render averages stats HTML (inner content only)
function renderAveragesStats(averages) {
  const sleepAvgSuffix = bedToSleepStatSuffixHtml(averages.avgBedToSleepDelay);
  return `
        <div class="stat-row"><span class="stat-label">${highlightKeyword('sleep:', 'sleep')}</span><span class="stat-value">${formatTime(averages.avgSleepStart)}${sleepAvgSuffix}</span></div>
    <div class="stat-row"><span class="stat-label">${highlightKeyword('duration:', 'duration')}</span><span class="stat-value">${formatDuration(averages.avgSleepDuration)}</span></div>
    <div class="stat-row"><span class="stat-label">uninterrupted:</span><span class="stat-value">${formatDuration(averages.avgLongestUninterrupted)}</span></div>
    ${averages.avgFirstAlarmToWake !== null ? `<div class="stat-row"><span class="stat-label">${highlightKeyword('Wake delay (avg):', 'wake')}</span><span class="stat-value ${averages.avgFirstAlarmToWake > ALARM_TO_WAKE_WARNING_THRESHOLD ? 'stat-warning' : ''}">${averages.avgFirstAlarmToWake < 0 ? '−' + formatDuration(-averages.avgFirstAlarmToWake) : formatDuration(averages.avgFirstAlarmToWake)}</span></div>` : ''}
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

// Heatmap cell color = worst severity among 😴, ⌛, and 👁️ (WASO); 🌅 is tooltip-only.
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

// Format a Date as month/day for display (e.g. 4/8).
function formatDateShort(date) {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

// Latest calendar date present in sleep data (local midnight).
function getLatestDataDate(days) {
  if (!days || days.length === 0) return null;
  let latest = null;
  for (let i = 0; i < days.length; i++) {
    const d = getDateFromString(days[i].date);
    if (Number.isNaN(d.getTime())) continue;
    if (!latest || d > latest) latest = d;
  }
  if (!latest) return null;
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
  const today = getAppDate();
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
      if (date > today) {
        flatDays.push({
          isFuture: true,
          date: date,
          dateStr: formatDateShort(date),
          day: day,
          insufficient: false,
          qualitySeverity: 'none',
          flagTypes: []
        });
      } else if (date > cutoff) {
        flatDays.push({
          isNoData: true,
          date: date,
          dateStr: formatDateShort(date),
          day: day,
          insufficient: false,
          qualitySeverity: 'none',
          flagTypes: []
        });
      } else {
        const dateStr = formatIsoDateFromLocalDate(date);
        const flagData = flagMap.get(dateStr) || { insufficient: false, qualitySeverity: 'none', types: [] };
        flatDays.push({
          date: date,
          dateStr: formatDateShort(date),
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

    const flagCounts = { '😴': 0, '⌛': 0, '🌅': 0, '👁️': 0 };
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
  if (dayCell.isFuture) return 'calendar-square--future';
  if (dayCell.isNoData) return 'calendar-square--no-data';
  if (dayCell.insufficient) return 'flag-insufficient';
  const s = dayCell.qualitySeverity || 'none';
  if (s === 'none') return 'flag-none';
  if (s === 'slight') return 'flag-one';
  if (s === 'moderate') return 'flag-two';
  return 'flag-three-plus';
}

function calendarSquareTooltip(dayCell) {
  if (dayCell.isFuture) return '';
  if (dayCell.isNoData) return `${dayCell.dateStr}: no data recorded`;
  if (dayCell.insufficient) return `${dayCell.dateStr}: not enough data`;
  if (dayCell.flagTypes && dayCell.flagTypes.length > 0) {
    return `${dayCell.dateStr}: ${dayCell.flagTypes.join(' ')}`;
  }
  return `${dayCell.dateStr}: normal`;
}

/** Aria hint per heatmap flag emoji (matches legend wording). */
const CALENDAR_FLAG_FILTER_ARIA = {
  '😴': 'sleep late vs average',
  '⌛': 'shorter duration vs average',
  '🌅': 'wake vs average',
  '👁️': 'WASO'
};

const calendarHeatmapActiveFlagByRoot = new WeakMap();

function syncCalendarHeatmapFlagFilters(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  const active = calendarHeatmapActiveFlagByRoot.get(root) || null;
  root.querySelectorAll('.calendar-square:not(.empty)').forEach((sq) => {
    const raw = sq.getAttribute('data-flag-types');
    if (raw == null) {
      sq.classList.remove('calendar-square--flag-filter-match');
      return;
    }
    let types = [];
    try {
      types = JSON.parse(raw);
    } catch (e) {
      types = [];
    }
    const match = active != null && Array.isArray(types) && types.indexOf(active) !== -1;
    sq.classList.toggle('calendar-square--flag-filter-match', Boolean(match));
  });
  root.querySelectorAll('.calendar-flag-slot--filter').forEach((b) => {
    const f = b.getAttribute('data-flag-filter');
    const pressed = active != null && f === active;
    b.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    b.classList.toggle('calendar-flag-slot--filter-active', pressed);
  });
}

function onCalendarHeatmapFlagFilterClick(root, e) {
  const btn = e.target && e.target.closest && e.target.closest('.calendar-flag-slot--filter');
  if (!btn || !root.contains(btn)) return;
  const flag = btn.getAttribute('data-flag-filter');
  if (!flag) return;
  const current = calendarHeatmapActiveFlagByRoot.get(root) || null;
  const next = current === flag ? null : flag;
  calendarHeatmapActiveFlagByRoot.set(root, next);
  syncCalendarHeatmapFlagFilters(root);
}

function bindCalendarHeatmapFlagFilters(root, abortSignal) {
  if (!root || !abortSignal) return;
  const handler = (e) => {
    onCalendarHeatmapFlagFilterClick(root, e);
  };
  root.addEventListener('click', handler, { signal: abortSignal });
}

function clearCalendarHeatmapFlagFilterState(root) {
  if (root) calendarHeatmapActiveFlagByRoot.delete(root);
}

if (typeof window !== 'undefined') {
  window.__restoreBindCalendarHeatmapFlagFilters = bindCalendarHeatmapFlagFilters;
  window.__restoreSyncCalendarHeatmapFlagFilters = syncCalendarHeatmapFlagFilters;
  window.__restoreClearCalendarHeatmapFlagFilterState = clearCalendarHeatmapFlagFilterState;
}

// Render a single month block (for heatmap). large: true adds --large class for 2x size on dashboard.
/** @param {{ interactiveFlagFilters?: boolean }} [options] */
function renderMonthBlock(month, large, options) {
  const interactive = Boolean(options && options.interactiveFlagFilters);
  const flagSlots = [
    { emoji: '😴', count: month.flagCounts['😴'] },
    { emoji: '⌛', count: month.flagCounts['⌛'] },
    { emoji: '🌅', count: month.flagCounts['🌅'] },
    { emoji: '👁️', count: month.flagCounts['👁️'] }
  ];
  const flagHtml = interactive
    ? flagSlots
        .map((f) => {
          const hint = CALENDAR_FLAG_FILTER_ARIA[f.emoji] || 'this flag';
          const aria = escapeHtmlAttr(`Highlight days: ${hint}. ${f.count} in this month.`);
          const emojiAttr = escapeHtmlAttr(f.emoji);
          return `<button type="button" class="calendar-flag-slot calendar-flag-slot--filter" data-flag-filter="${emojiAttr}" aria-pressed="false" aria-label="${aria}"><span class="calendar-flag-emoji" aria-hidden="true">${f.emoji}</span><span class="calendar-flag-num">${f.count}</span></button>`;
        })
        .join('')
    : flagSlots
        .map((f) => `<span class="calendar-flag-slot"><span class="calendar-flag-emoji">${f.emoji}</span><span class="calendar-flag-num">${f.count}</span></span>`)
        .join('');
  const weekdayLabels = ['Su', 'M', 'T', 'W', 'R', 'F', 'Sa'].map(w => `<div class="calendar-weekday-label">${w}</div>`).join('');
  const blockClass = 'calendar-month-block' + (large ? ' calendar-month-block--large' : '');
  const monthTitleHtml = `<div class="calendar-month-name">${month.name}</div>`;
  return `
    <div class="${blockClass}">
      <div class="calendar-month-header">
        ${monthTitleHtml}
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
              const typesAttr = interactive
                ? ` data-flag-types="${escapeHtmlAttr(JSON.stringify(day.isFuture || day.isNoData ? [] : (day.flagTypes || [])))}"`
                : '';
              const tipAttr = tooltip ? ` data-tooltip="${escapeHtmlAttr(tooltip)}" title="${escapeHtmlAttr(tooltip)}"` : '';
              const inner = `<div class="calendar-square ${colorClass}"${typesAttr}${tipAttr}><span class="calendar-square-day">${day.day}</span></div>`;
              return `<div class="calendar-day-slot">${inner}</div>`;
            }).join('')}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

/** @param {{ qualityPage?: boolean }} [options] */
function renderCalendarHeatmapHeader(options) {
  const qualityPage = Boolean(options && options.qualityPage);
  const swatchLegend = qualityPage
    ? `
      <ul class="calendar-heatmap-swatch-legend" aria-label="Daily flag severity">
        <li><span class="quality-swatch quality-swatch--rested" aria-hidden="true"></span> <span><strong>Rested</strong> — on your recent pattern; no flag.</span></li>
        <li><span class="quality-swatch quality-swatch--slight" aria-hidden="true"></span> <span><strong>Slightly</strong> off pattern.</span></li>
        <li><span class="quality-swatch quality-swatch--moderate" aria-hidden="true"></span> <span><strong>Moderately</strong> off pattern.</span></li>
        <li><span class="quality-swatch quality-swatch--severe" aria-hidden="true"></span> <span><strong>Severely</strong> off pattern.</span></li>
      </ul>`
    : '';
  const aboutLink = qualityPage
    ? `<p class="calendar-heatmap-about"><a class="content-link" href="${restoreMpaHref('about.dailyFlags')}">About daily flags</a></p>`
    : '';
  return `
    <div class="calendar-heatmap-header${qualityPage ? ' calendar-heatmap-header--quality-page' : ''}">
      <div class="calendar-heatmap-header-titles">
        <h3 class="calendar-heatmap-title">Sleep Quality history</h3>
        ${aboutLink}
      </div>
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
          <span class="legend-meaning-item">😴 sleep late vs avg</span>
          <span class="legend-meaning-item">⌛ shorter duration vs avg</span>
          <span class="legend-meaning-item">🌅 wake vs avg</span>
          <span class="legend-meaning-item">👁️ WASO</span>
        </div>
        <span class="legend-explanation legend-explanation--inline">(cell color from worst of 😴 ⌛ 👁️; 🌅 icon only)</span>
      </div>
      ${swatchLegend}
    </div>
  `;
}

// Dashboard inline: Sleep quality section title + current month calendar (no heatmap legend)
function renderCalendarCurrentMonthOnlyBlock(year, flagMap, latestDataDate) {
  const months = generateCalendarHeatmap(year, flagMap, latestDataDate);
  const now = getAppDate();
  const isCurrentYear = year === now.getFullYear();
  const currentMonthIndex = isCurrentYear ? now.getMonth() : null;
  const currentMonthBlock =
    currentMonthIndex !== null ? renderMonthBlock(months[currentMonthIndex], true, { interactiveFlagFilters: true }) : '';
  if (!currentMonthBlock) return '';
  return `
    <div class="calendar-heatmap calendar-heatmap--inline calendar-heatmap--dashboard-month">
      <h2 class="dashboard-section-title"><a class="dashboard-section-title__link" href="${restoreMpaHref('tab.quality')}"><span class="dashboard-section-title__emoji" aria-hidden="true">📅</span> <span data-i18n="dashboard.sectionSleepQuality">Sleep quality</span></a></h2>
      <div class="calendar-current-month-row">${currentMonthBlock}</div>
    </div>
  `;
}

// Quality history page: all months in grid (no separate current-month row)
function renderCalendarHeatmapFullHistory(year, flagMap, latestDataDate) {
  const months = generateCalendarHeatmap(year, flagMap, latestDataDate);

  return `
    <div class="calendar-heatmap-container calendar-heatmap-container--quality-page">
      ${renderCalendarHeatmapHeader({ qualityPage: true })}
      <div class="calendar-heatmap">
        <div class="calendar-month-grid">
          ${months.map((month) => renderMonthBlock(month, false, { interactiveFlagFilters: true })).join('')}
        </div>
      </div>
    </div>
  `;
}

/** One or more calendar years (newest first); each year gets its own month grid when multiple. */
function renderCalendarHeatmapFullHistoryMulti(years, flagMap, latestDataDate) {
  const yList =
    years && years.length ? years.slice() : [getAppDate().getFullYear()];
  const sections = yList
    .map(function (year) {
      const months = generateCalendarHeatmap(year, flagMap, latestDataDate);
      const yearHeading =
        yList.length > 1 ? `<h3 class="calendar-heatmap-year-heading">${year}</h3>` : '';
      const gridInner = months.map((m) => renderMonthBlock(m, false, { interactiveFlagFilters: true })).join('');
      return `<div class="calendar-heatmap-year-block">${yearHeading}<div class="calendar-month-grid">${gridInner}</div></div>`;
    })
    .join('');
  return `
    <div class="calendar-heatmap-container calendar-heatmap-container--quality-page">
      ${renderCalendarHeatmapHeader({ qualityPage: true })}
      <div class="calendar-heatmap calendar-heatmap--multi-year">
        ${sections}
      </div>
    </div>
  `;
}

// Recommended sleep/wake window: sleep band ±30 min; wake band ±15 min (wake consistency is more important).
const PROJECTION_BAND_MINUTES = 30;
const WAKE_PROJECTION_BAND_MINUTES = 15;
const TONIGHT_ADJUST_SCOPE_PAD_MINUTES = 180;
const TONIGHT_ADJUST_MIN_GAP_MINUTES = 1;
/** Painted width of Tonight emoji knobs (px); must match CSS range thumb width for fill inset math. */
const TONIGHT_KNOB_OUTER_PX = 40;

function normalizeClockMinutesNearReference(clockMinutes, referenceMinutes) {
  let value = modMinutes1440(clockMinutes);
  while (value - referenceMinutes > 720) value -= 1440;
  while (referenceMinutes - value > 720) value += 1440;
  return value;
}

function getTonightProjectionBaseState(recentAverages) {
  if (!recentAverages) {
    return getTonightProjectionBaseState(QUICK_ADD_FALLBACK_AVERAGES);
  }
  const sampleSize =
    recentAverages && typeof recentAverages.sampleSize === 'number' ? recentAverages.sampleSize : 0;
  const tonightNaturalReliable = sampleSize >= TONIGHT_MATRIX_MIN_NATURAL_DAYS;
  const avgSleep = recentAverages.avgSleepStart;
  const avgWake = recentAverages.avgSleepEnd;
  const sleepByLow = modMinutes1440(avgSleep - PROJECTION_BAND_MINUTES);
  const sleepByHigh = modMinutes1440(avgSleep + PROJECTION_BAND_MINUTES);
  const wakeByLow = modMinutes1440(avgWake - WAKE_PROJECTION_BAND_MINUTES);
  const wakeByHigh = modMinutes1440(avgWake + WAKE_PROJECTION_BAND_MINUTES);
  const recommendedDurationMins = durationMinutes(avgSleep, avgWake);

  const recommendedSleepNorm = normalizeTimeForAveraging(avgSleep);
  const recommendedWakeNorm = normalizeWakeTimeForAveraging(avgSleep, avgWake);

  let committedSleep = avgSleep;
  let committedWake = avgWake;
  const savedTw = typeof getTonightTargetWindow === 'function' ? getTonightTargetWindow() : null;
  /** @type {'none'|'target'|'guided'} */
  let tonightGuidanceMode = 'none';
  let savedTargetSleep = null;
  let savedTargetWake = null;
  let savedTargetSleepNorm = null;
  let savedTargetWakeNorm = null;
  if (savedTw) {
    if (savedTw.sleep != null && typeof isValidClockMinute === 'function' && isValidClockMinute(savedTw.sleep)) {
      savedTargetSleep = modMinutes1440(savedTw.sleep);
    }
    if (savedTw.wake != null && typeof isValidClockMinute === 'function' && isValidClockMinute(savedTw.wake)) {
      savedTargetWake = modMinutes1440(savedTw.wake);
    }
    const resolved =
      typeof resolveTonightScheduledWindow === 'function'
        ? resolveTonightScheduledWindow(avgSleep, avgWake, savedTw)
        : {
            sleep: savedTargetSleep != null ? savedTargetSleep : avgSleep,
            wake: savedTargetWake != null ? savedTargetWake : avgWake,
            mode: 'target'
          };
    committedSleep = resolved.sleep;
    committedWake = resolved.wake;
    if (resolved.mode === 'guided') tonightGuidanceMode = 'guided';
    else if (resolved.mode === 'target') tonightGuidanceMode = 'target';
    else tonightGuidanceMode = 'none';
  }
  const committedSleepNorm = normalizeTimeForAveraging(committedSleep);
  const committedWakeNorm = normalizeWakeTimeForAveraging(committedSleep, committedWake);

  let scopeStartNorm = Math.min(recommendedSleepNorm, committedSleepNorm) - TONIGHT_ADJUST_SCOPE_PAD_MINUTES;
  let scopeEndNorm = Math.max(recommendedWakeNorm, committedWakeNorm) + TONIGHT_ADJUST_SCOPE_PAD_MINUTES;
  if (savedTw) {
    if (savedTargetSleep != null) {
      savedTargetSleepNorm = normalizeTimeForAveraging(savedTargetSleep);
      scopeStartNorm = Math.min(scopeStartNorm, savedTargetSleepNorm - TONIGHT_ADJUST_SCOPE_PAD_MINUTES);
    }
    if (savedTargetWake != null) {
      savedTargetWakeNorm = normalizeWakeTimeForAveraging(committedSleep, savedTargetWake);
      scopeEndNorm = Math.max(scopeEndNorm, savedTargetWakeNorm + TONIGHT_ADJUST_SCOPE_PAD_MINUTES);
    }
  }

  const adj = typeof getTonightProjectionAdjustment === 'function' ? getTonightProjectionAdjustment() : null;
  if (adj) {
    let sn = normalizeClockMinutesNearReference(adj.sleep, committedSleepNorm);
    let wn = normalizeClockMinutesNearReference(adj.wake, committedWakeNorm);
    if (wn <= sn) wn += 1440;
    scopeStartNorm = Math.min(scopeStartNorm, sn - TONIGHT_ADJUST_SCOPE_PAD_MINUTES);
    scopeEndNorm = Math.max(scopeEndNorm, wn + TONIGHT_ADJUST_SCOPE_PAD_MINUTES);
  }

  const paceId =
    typeof getTonightGuidancePaceId === 'function' ? getTonightGuidancePaceId() : 'gentle';
  const guidanceSleepEnabled =
    typeof getTonightGuidanceSleepEnabled === 'function' ? getTonightGuidanceSleepEnabled() : false;
  const guidanceWakeEnabled =
    typeof getTonightGuidanceWakeEnabled === 'function' ? getTonightGuidanceWakeEnabled() : false;
  const naturalSleepMinutes = tonightNaturalReliable ? avgSleep : null;
  const naturalWakeMinutes = tonightNaturalReliable ? avgWake : null;

  return {
    sampleSize,
    tonightNaturalReliable,
    naturalSleepMinutes,
    naturalWakeMinutes,
    paceId,
    guidanceSleepEnabled,
    guidanceWakeEnabled,
    avgSleepStart: avgSleep,
    avgSleepEnd: avgWake,
    sleepTarget: committedSleep,
    wakeTarget: committedWake,
    committedSleep,
    committedWake,
    committedSleepNorm,
    committedWakeNorm,
    hasSavedTonightTarget: Boolean(savedTw),
    sleepByLow,
    sleepByHigh,
    wakeByLow,
    wakeByHigh,
    recommendedDurationMins,
    recommendedSleepNorm,
    recommendedWakeNorm,
    scopeStartNorm,
    scopeEndNorm,
    tonightGuidanceMode,
    savedTargetSleep,
    savedTargetWake,
    savedTargetSleepNorm,
    savedTargetWakeNorm
  };
}

const TONIGHT_MATRIX_EM = '\u2014';

function tonightMatrixFormatCell(minutes) {
  if (minutes == null || !Number.isFinite(Number(minutes))) return TONIGHT_MATRIX_EM;
  return formatTime(modMinutes1440(Number(minutes)));
}

function tonightInterpolateTemplate(str, vars) {
  return String(str).replace(/\{(\w+)\}/g, function (_, k) {
    return Object.prototype.hasOwnProperty.call(vars, k) && vars[k] != null ? String(vars[k]) : '';
  });
}

function buildTonightMatrixCalloutParts(vm, tdT) {
  if (!vm || !vm.callout || vm.rowMode !== 'full_guidance') return null;
  const c = vm.callout;
  const phaseDefaults = {
    initiating: 'initiating',
    transitioning: 'transitioning',
    locking_in: 'locking in',
    on_target: 'on target'
  };
  const phaseWord = tdT('dashboard.tonight.phaseCallout.phase.' + vm.phase, phaseDefaults[vm.phase] || vm.phase);
  const verb =
    vm.phase === 'on_target'
      ? tdT('dashboard.tonight.phaseCallout.verbHolding', 'holding')
      : tdT('dashboard.tonight.phaseCallout.verbNudging', 'nudging');
  const dirWord = c.directionEarlier
    ? tdT('dashboard.tonight.phaseCallout.dirEarlier', 'earlier')
    : tdT('dashboard.tonight.phaseCallout.dirLater', 'later');
  const delta = formatDuration(c.deltaMins);
  const gap = formatDuration(c.gapMins);
  const target = formatTime(c.targetMins);
  const vars = { verb: verb, dir: dirWord, delta: delta, gap: gap, target: target };
  let detail;
  if (vm.pole === 'sleep') {
    const key =
      vm.phase === 'on_target'
        ? 'dashboard.tonight.phaseCallout.sleepHoldingDetail'
        : 'dashboard.tonight.phaseCallout.sleepNudgingDetail';
    const fallback =
      vm.phase === 'on_target'
        ? '{verb} at target bedtime {target} (gap {gap}).'
        : '{verb} bedtime {dir} by {delta} toward target {target} (gap {gap}).';
    detail = tonightInterpolateTemplate(tdT(key, fallback), vars);
  } else {
    const keyW =
      vm.phase === 'on_target'
        ? 'dashboard.tonight.phaseCallout.wakeHoldingDetail'
        : 'dashboard.tonight.phaseCallout.wakeNudgingDetail';
    const fallbackW =
      vm.phase === 'on_target'
        ? '{verb} at target wake {target} (gap {gap}).'
        : '{verb} wake {dir} by {delta} toward target {target} (gap {gap}).';
    detail = tonightInterpolateTemplate(tdT(keyW, fallbackW), vars);
  }
  return { phaseWord: phaseWord, detail: detail };
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
  sampleSize: 0,
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
  const sleepNorm = base.committedSleepNorm;
  const wakeNorm = base.committedWakeNorm;
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

/** @param {'drawer'|'page'} layout — drawer: dashboard strip; page: full log screen, advanced fields always visible */
function renderQuickAddDrawer(recentAverages, recentDays, layout = 'drawer') {
  const proj = getQuickAddSliderProjection(recentAverages, recentDays);
  const bedVal = formatMinutesTo24hString(proj.bedClock);
  const sleepVal = formatMinutesTo24hString(proj.sleepClock);
  const wakeVal = formatMinutesTo24hString(proj.wakeClock);
  const isPage = layout === 'page';
  const mainBedVal = isPage ? '' : bedVal;
  const mainSleepVal = isPage ? '' : sleepVal;
  const mainWakeVal = isPage ? '' : wakeVal;
  const initialBedAttr = isPage ? '' : bedVal;
  const initialSleepAttr = isPage ? '' : sleepVal;
  const initialWakeAttr = isPage ? '' : wakeVal;

  const mainTimeSpin = (suffix) =>
    `<div class="quick-add-time-spin">
                          <button type="button" class="quick-add-time-spin-btn quick-add-time-spin-btn--up" aria-label="${suffix} one minute later">▲</button>
                          <button type="button" class="quick-add-time-spin-btn quick-add-time-spin-btn--down" aria-label="${suffix} one minute earlier">▼</button>
                        </div>`;

  const bathAlarmActions = isPage
    ? `<div class="quick-add-time-inline-actions">
                      <button type="button" class="quick-add-time-add-btn" id="quick-add-bathroom-add" data-i18n-aria-label="log.addTimeAria" aria-label="Add time">+</button>
                    </div>`
    : `<button type="button" class="quick-add-time-add-btn" id="quick-add-bathroom-add" data-i18n-aria-label="log.addTimeAria" aria-label="Add time">+</button>`;

  const alarmActions = isPage
    ? `<div class="quick-add-time-inline-actions">
                      <button type="button" class="quick-add-time-add-btn" id="quick-add-alarm-add" data-i18n-aria-label="log.addTimeAria" aria-label="Add time">+</button>
                    </div>`
    : `<button type="button" class="quick-add-time-add-btn" id="quick-add-alarm-add" data-i18n-aria-label="log.addTimeAria" aria-label="Add time">+</button>`;

  const labelsRow = `<div class="quick-add-adv-row quick-add-labels-row quick-add-log-pair">
                    <span class="quick-add-label quick-add-label--emoji-line" id="quick-add-labels-legend"><span class="quick-add-log-emoji" aria-hidden="true">🏷️</span><span class="quick-add-label-text" data-i18n="log.nightLabels">Night notes</span></span>
                    <div class="quick-add-label-chips-wrap">
                      <div class="quick-add-label-chips" id="quick-add-label-chips" role="group" aria-labelledby="quick-add-labels-legend" data-i18n-aria-label="log.nightLabelsAria" aria-label="Optional emoji labels for this night"></div>
                    </div>
                  </div>`;

  const advancedBlocks = `
                <div class="quick-add-advanced-blocks">
                  <div class="quick-add-adv-row quick-add-log-pair">
                    <button type="button" class="quick-add-label quick-add-label--emoji-line quick-add-label--bathroom quick-add-label-hit" id="quick-add-bathroom-legend" data-i18n-aria-label="log.bathroomLabelNowAria" aria-label="Add bathroom time now"><span class="quick-add-log-emoji" aria-hidden="true">🧻</span><span class="quick-add-label-text" data-i18n="log.bathroom">Bathroom</span></button>
                    <div class="quick-add-log-pair__right quick-add-log-pair__right--with-add${isPage ? ' quick-add-log-pair__right--inline-actions' : ''}">
                      <div class="quick-add-time-list" id="quick-add-bathroom-list" aria-labelledby="quick-add-bathroom-legend"></div>
                      ${bathAlarmActions}
                    </div>
                  </div>
                  <div class="quick-add-adv-row quick-add-log-pair">
                    <button type="button" class="quick-add-label quick-add-label--emoji-line quick-add-label--alarm quick-add-label-hit" id="quick-add-alarm-legend" data-i18n-aria-label="log.alarmLabelNowAria" aria-label="Add alarm time now"><span class="quick-add-log-emoji" aria-hidden="true">🕐</span><span class="quick-add-label-text" data-i18n="log.alarms">Alarm(s)</span></button>
                    <div class="quick-add-log-pair__right quick-add-log-pair__right--with-add${isPage ? ' quick-add-log-pair__right--inline-actions' : ''}">
                      <div class="quick-add-time-list" id="quick-add-alarm-list" aria-labelledby="quick-add-alarm-legend"></div>
                      ${alarmActions}
                    </div>
                  </div>
                  <div class="quick-add-adv-row quick-add-log-pair">
                    <button type="button" class="quick-add-label quick-add-label--emoji-line quick-add-label--nap quick-add-label-hit" id="quick-add-nap-start-legend" data-i18n-aria-label="log.napStartNowAria" aria-label="Set nap start to current time"><span class="quick-add-log-emoji" aria-hidden="true">😴</span><span class="quick-add-label-text" data-i18n="log.napStartLine">Nap start</span></button>
                    <div class="quick-add-time-row quick-add-time-row--nap">
                      <input class="quick-add-input quick-add-time-native" id="quick-add-nap-start" type="time" step="60" value="" aria-labelledby="quick-add-nap-start-legend" data-i18n-aria-label="log.napStartAria" aria-label="Nap start">
                      <div class="quick-add-time-spin">
                        <button type="button" class="quick-add-time-spin-btn quick-add-time-spin-btn--up" data-i18n-aria-label="log.napStartLaterAria" aria-label="Nap start one minute later">▲</button>
                        <button type="button" class="quick-add-time-spin-btn quick-add-time-spin-btn--down" data-i18n-aria-label="log.napStartEarlierAria" aria-label="Nap start one minute earlier">▼</button>
                      </div>
                    </div>
                  </div>
                  <div class="quick-add-adv-row quick-add-log-pair">
                    <button type="button" class="quick-add-label quick-add-label--emoji-line quick-add-label--nap quick-add-label--nap-end quick-add-label-hit" id="quick-add-nap-end-legend" data-i18n-aria-label="log.napEndNowAria" aria-label="Set nap end to current time"><span class="quick-add-log-emoji" aria-hidden="true">🥱</span><span class="quick-add-label-text" data-i18n="log.napEndLine">Nap end</span></button>
                    <div class="quick-add-time-row quick-add-time-row--nap">
                      <input class="quick-add-input quick-add-time-native" id="quick-add-nap-end" type="time" step="60" value="" aria-labelledby="quick-add-nap-end-legend" data-i18n-aria-label="log.napEndAria" aria-label="Nap end">
                      <div class="quick-add-time-spin">
                        <button type="button" class="quick-add-time-spin-btn quick-add-time-spin-btn--up" data-i18n-aria-label="log.napEndLaterAria" aria-label="Nap end one minute later">▲</button>
                        <button type="button" class="quick-add-time-spin-btn quick-add-time-spin-btn--down" data-i18n-aria-label="log.napEndEarlierAria" aria-label="Nap end one minute earlier">▼</button>
                      </div>
                    </div>
                  </div>
                  <div class="quick-add-adv-row quick-add-adv-row--waso quick-add-log-pair">
                    <span class="quick-add-label quick-add-label--emoji-line quick-add-label--waso" id="quick-add-waso-legend"><span class="quick-add-log-emoji" aria-hidden="true">👁️</span><span class="quick-add-label-text" data-i18n="log.wasoCount">WASO count</span></span>
                    <div class="quick-add-time-row quick-add-time-row--nap quick-add-waso-row" aria-labelledby="quick-add-waso-legend">
                      <input class="quick-add-input quick-add-waso-value" id="quick-add-waso" type="number" min="0" step="1" value="0" inputmode="numeric" aria-labelledby="quick-add-waso-legend">
                      <div class="quick-add-time-spin quick-add-waso-spin">
                        <button type="button" class="quick-add-time-spin-btn quick-add-time-spin-btn--up" data-i18n-aria-label="log.wasoUpAria" aria-label="Increase WASO count">▲</button>
                        <button type="button" class="quick-add-time-spin-btn quick-add-time-spin-btn--down" data-i18n-aria-label="log.wasoDownAria" aria-label="Decrease WASO count">▼</button>
                      </div>
                    </div>
                  </div>
                  ${isPage ? '' : labelsRow}
                </div>`;
  const advancedSection =
    layout === 'drawer'
      ? `<details class="quick-add-advanced">
                <summary>Advanced fields (optional)</summary>
                ${advancedBlocks}
              </details>`
      : `<div class="quick-add-advanced quick-add-advanced--page" data-i18n-aria-label="log.advancedAria" aria-label="Additional fields">
                ${advancedBlocks}
              </div>`;

  const undoConfirmDialog = `<dialog class="dashboard-tonight-clear-target-dialog" id="quick-add-undo-confirm-dialog" aria-labelledby="quick-add-undo-confirm-title">
      <div class="dashboard-tonight-clear-target-dialog-inner">
        <p class="dashboard-tonight-clear-target-dialog-message" id="quick-add-undo-confirm-title" data-i18n="log.undoConfirmTitle">Discard your unsaved changes?</p>
        <div class="dashboard-tonight-clear-target-dialog-actions">
          <button type="button" class="about-theme-option dashboard-tonight-confirm-dialog-btn-primary" id="quick-add-undo-confirm-yes" data-i18n="log.undoConfirmYes">Discard</button>
          <button type="button" class="about-theme-option" id="quick-add-undo-confirm-no" data-i18n="log.undoConfirmNo">Keep editing</button>
        </div>
      </div>
    </dialog>`;

  const pageTopToolbar = layout === 'page'
    ? `<div class="quick-add-page-toolbar">
              <div class="quick-add-page-toolbar__bar" id="quick-add-toolbar-bar" data-i18n-aria-label="log.commitBarAria" aria-label="Save, undo, or review changes">
                <div class="quick-add-toolbar-changes-head" data-i18n-aria-label="log.changesPanelAria" aria-label="Unsaved edits">
                  <p class="quick-add-changes-caption" data-i18n="log.changesCaption">Changes</p>
                  <p class="quick-add-save-dirty-hint" id="quick-add-save-dirty-hint" aria-live="polite" data-i18n-aria-label="log.dirtyHintAria" aria-label="Which parts of the form have unsaved edits"></p>
                </div>
                <div class="quick-add-page-toolbar__commit">
                  <button type="button" class="quick-add-toolbar-btn quick-add-toolbar-btn--undo" id="quick-add-cancel" data-i18n="log.undoCancel" data-i18n-title="log.cancelHint" title="Restore the default night and clear your edits.">Undo / Cancel</button>
                  <button type="submit" class="quick-add-toolbar-btn quick-add-toolbar-btn--save" id="quick-add-save" data-i18n="log.save">Save</button>
                </div>
              </div>
            </div>`
    : '';
  const actionsInner =
    layout === 'page'
      ? ''
      : `
                <button type="submit" class="about-theme-option" id="quick-add-save" data-i18n="log.save">Save</button>
                <button type="button" class="about-theme-option" id="quick-add-cancel" data-i18n="log.undoCancel">Undo / Cancel</button>`;

  const dateFieldRow = isPage
    ? `<div class="quick-add-date-row quick-add-date-row--page" role="group" data-i18n-aria-label="log.dateRowAria" aria-label="Wake date">
                <span class="quick-add-date-context" data-i18n="log.dateContext">Waking on</span>
                <div class="quick-add-date-controls">
                  <button type="button" class="quick-add-date-step quick-add-date-step--prev" id="quick-add-date-prev" data-i18n-aria-label="log.datePrevAria" aria-label="Previous day">◀</button>
                  <input class="quick-add-input quick-add-input--date" id="quick-add-date" type="date" data-i18n-aria-label="log.dateInputAria" aria-label="Wake date">
                  <button type="button" class="quick-add-date-step quick-add-date-step--next" id="quick-add-date-next" data-i18n-aria-label="log.dateNextAria" aria-label="Next day">▶</button>
                </div>
              </div>`
    : `<div class="quick-add-field-compact quick-add-log-pair">
                <label class="quick-add-label" for="quick-add-date"><span data-i18n="log.date">Date</span></label>
                <input class="quick-add-input quick-add-input--date" id="quick-add-date" type="date">
              </div>`;

  const formActionsRow = isPage
    ? ''
    : `<div class="quick-add-actions">
                ${actionsInner}
              </div>`;

  const formHtml = `
            <form id="quick-add-form" class="quick-add-form" data-initial-bed="${initialBedAttr}" data-initial-sleep="${initialSleepAttr}" data-initial-wake="${initialWakeAttr}">
              ${pageTopToolbar}
              ${dateFieldRow}
              ${isPage ? labelsRow : ''}
              <div class="quick-add-main-times" role="group" data-i18n-aria-label="log.mainTimesAria" aria-label="Bed, sleep, and wake">
                <div class="quick-add-adv-row quick-add-log-pair">
                  <button type="button" class="quick-add-label quick-add-label--emoji-line quick-add-label--bed quick-add-label-hit" id="quick-add-bed-legend" data-i18n-aria-label="log.bedNowAria" aria-label="Set bed time to current time"><span class="quick-add-log-emoji" aria-hidden="true">🛏️</span><span class="quick-add-label-text" data-i18n="log.bed">Bed</span></button>
                  <div class="quick-add-time-row quick-add-time-row--nap">
                    <input class="quick-add-input quick-add-time-native" id="quick-add-bed" type="time" step="60" value="${mainBedVal}" aria-labelledby="quick-add-bed-legend" aria-label="Bed time">
                    ${mainTimeSpin('Bed time')}
                  </div>
                </div>
                <div class="quick-add-adv-row quick-add-log-pair">
                  <button type="button" class="quick-add-label quick-add-label--emoji-line quick-add-label--sleep quick-add-label-hit" id="quick-add-sleep-legend" data-i18n-aria-label="log.sleepNowAria" aria-label="Set sleep time to current time"><span class="quick-add-log-emoji" aria-hidden="true">🌙</span><span class="quick-add-label-text" data-i18n="log.sleep">Sleep</span></button>
                  <div class="quick-add-time-row quick-add-time-row--nap">
                    <input class="quick-add-input quick-add-time-native" id="quick-add-sleep" type="time" step="60" value="${mainSleepVal}" aria-labelledby="quick-add-sleep-legend" aria-label="Fell asleep">
                    ${mainTimeSpin('Fell asleep')}
                  </div>
                </div>
                <div class="quick-add-adv-row quick-add-log-pair">
                  <button type="button" class="quick-add-label quick-add-label--emoji-line quick-add-label--wake quick-add-label-hit" id="quick-add-wake-legend" data-i18n-aria-label="log.wakeNowAria" aria-label="Set wake time to current time"><span class="quick-add-log-emoji" aria-hidden="true">🌅</span><span class="quick-add-label-text" data-i18n="log.wake">Wake</span></button>
                  <div class="quick-add-time-row quick-add-time-row--nap">
                    <input class="quick-add-input quick-add-time-native" id="quick-add-wake" type="time" step="60" value="${mainWakeVal}" aria-labelledby="quick-add-wake-legend" aria-label="Wake up">
                    ${mainTimeSpin('Wake up')}
                  </div>
                </div>
              </div>
              ${advancedSection}
              <p class="quick-add-status" id="quick-add-status"></p>
              ${formActionsRow}
            </form>`;

  if (layout === 'page') {
    return `
    <div class="quick-add-drawer quick-add-drawer--page" id="quick-add-drawer">
      <div class="quick-add-drawer-body-inner quick-add-drawer-body-inner--page">
        ${undoConfirmDialog}
        ${formHtml}
      </div>
    </div>`;
  }

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
            ${undoConfirmDialog}
            ${formHtml}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderQuickActionsSection() {
  const showHint =
    typeof getHintQuickActionsAbout === 'function' ? getHintQuickActionsAbout() : true;
  const quickActionsInfoHtml = showHint
    ? `<a class="dashboard-quick-actions-info-link content-link" href="${restoreMpaHref('about.quickActions')}" data-i18n-aria-label="dashboard.quickActions.aboutAria" aria-label="About quick actions"><span class="dashboard-quick-actions-info-letter" aria-hidden="true">i</span></a>`
    : '';
  return `
    <div class="dashboard-quick-actions quick-add-drawer" aria-label="Quick actions">
      <div class="dashboard-quick-actions-inner">
        <div class="dashboard-quick-actions-label-row">
          <p class="dashboard-quick-actions-label"><span class="dashboard-quick-actions-label-sparkle" aria-hidden="true">✨</span> Quick actions</p>
          ${quickActionsInfoHtml}
        </div>
        <div class="dashboard-quick-actions-row" id="dashboard-quick-actions-buttons" role="group" aria-label="Suggested actions"></div>
      </div>
    </div>
  `;
}

/** Brief non-blocking message (e.g. after resetting Tonight targets). */
function showAppToast(message) {
  if (typeof document === 'undefined') return;
  let host = document.getElementById('app-toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'app-toast-host';
    host.className = 'app-toast-host';
    host.setAttribute('aria-live', 'polite');
    host.setAttribute('aria-atomic', 'true');
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = 'app-toast';
  el.textContent = message;
  host.appendChild(el);
  requestAnimationFrame(function () {
    el.classList.add('app-toast--visible');
  });
  window.setTimeout(function () {
    el.classList.remove('app-toast--visible');
    window.setTimeout(function () {
      el.remove();
    }, 280);
  }, 2600);
}

function getTonightProjectionState(recentAverages) {
  const base = getTonightProjectionBaseState(recentAverages);
  const override = typeof getTonightProjectionAdjustment === 'function' ? getTonightProjectionAdjustment() : null;

  let sleepNorm = base.committedSleepNorm;
  let wakeNorm = base.committedWakeNorm;
  if (override) {
    sleepNorm = normalizeClockMinutesNearReference(override.sleep, base.committedSleepNorm);
    wakeNorm = normalizeClockMinutesNearReference(override.wake, base.committedWakeNorm);
    if (wakeNorm <= sleepNorm) wakeNorm += 1440;
  }

  const clamped = clampTonightProjectionNorms(base, sleepNorm, wakeNorm);
  const sleepClock = modMinutes1440(clamped.sleepNorm);
  const wakeClock = modMinutes1440(clamped.wakeNorm);
  const isAdjusted = sleepClock !== base.committedSleep || wakeClock !== base.committedWake;
  const scopeSpan = base.scopeEndNorm - base.scopeStartNorm;
  const sleepPct = ((clamped.sleepNorm - base.scopeStartNorm) / scopeSpan) * 100;
  const wakePct = ((clamped.wakeNorm - base.scopeStartNorm) / scopeSpan) * 100;
  const recStartPct = ((base.recommendedSleepNorm - base.scopeStartNorm) / scopeSpan) * 100;
  const recEndPct = ((base.recommendedWakeNorm - base.scopeStartNorm) / scopeSpan) * 100;
  const committedSleepPct = ((base.committedSleepNorm - base.scopeStartNorm) / scopeSpan) * 100;
  const committedWakePct = ((base.committedWakeNorm - base.scopeStartNorm) / scopeSpan) * 100;
  let savedTargetSleepPct = null;
  let savedTargetWakePct = null;
  if (base.hasSavedTonightTarget) {
    if (base.savedTargetSleepNorm != null) {
      savedTargetSleepPct = ((base.savedTargetSleepNorm - base.scopeStartNorm) / scopeSpan) * 100;
    }
    if (base.savedTargetWakeNorm != null) {
      savedTargetWakePct = ((base.savedTargetWakeNorm - base.scopeStartNorm) / scopeSpan) * 100;
    }
  }
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
    recEndPct,
    committedSleepPct,
    committedWakePct,
    savedTargetSleepPct,
    savedTargetWakePct
  };
}

function renderDashboardProjection(recentAverages) {
  const projection = getTonightProjectionState(recentAverages);
  const base = projection.base;
  const durationMins = durationMinutes(projection.sleepClock, projection.wakeClock);
  const trackWaveBars = Array.from({ length: 160 }, (_, i) => {
    const x = i * 5;
    return `<rect class="dashboard-tonight-track-wave-bar" x="${x}" y="6" width="2" height="12" rx="1" style="--i:${i}"></rect>`;
  }).join('');
  const trackWaveSvg = `<svg class="dashboard-tonight-track-wave-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 24" preserveAspectRatio="xMinYMid slice" aria-hidden="true"><defs><linearGradient id="dashboardTonightTrackWaveGradient" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="200" y2="0"><stop class="dashboard-tonight-track-wave-stop dashboard-tonight-track-wave-stop--sleep" offset="0"></stop><stop class="dashboard-tonight-track-wave-stop dashboard-tonight-track-wave-stop--wake" offset="1"></stop></linearGradient></defs>${trackWaveBars}</svg>`;
  const savedSleepPct =
    projection.savedTargetSleepPct != null ? `${projection.savedTargetSleepPct}%` : `${projection.committedSleepPct}%`;
  const savedWakePct =
    projection.savedTargetWakePct != null ? `${projection.savedTargetWakePct}%` : `${projection.committedWakePct}%`;
  const showTonightHint = typeof getHintTonightAbout === 'function' ? getHintTonightAbout() : true;
  const tonightInfoHtml = showTonightHint
    ? `<a class="dashboard-quick-actions-info-link content-link" href="${restoreMpaHref('about.tonightBarSymbols')}" data-i18n-aria-label="dashboard.tonight.aboutSectionAria" aria-label="About Tonight on the Dashboard"><span class="dashboard-quick-actions-info-letter" aria-hidden="true">i</span></a>`
    : '';
  return `
    <div class="dashboard-projection" id="dashboard-tonight-projection" data-rec-sleep="${base.avgSleepStart}" data-rec-wake="${base.avgSleepEnd}">
      <div class="dashboard-projection-title-row">
        <h2 class="dashboard-section-title"><span class="dashboard-section-title__static"><span class="dashboard-section-title__emoji" aria-hidden="true">🛌</span> <span data-i18n="dashboard.sectionTonight">Tonight</span></span></h2>
        ${tonightInfoHtml}
      </div>
      <p class="dashboard-tonight-estimated-sleep" id="dashboard-tonight-estimated-sleep">
        <span class="dashboard-tonight-estimated-sleep-ico" aria-hidden="true">⏳</span>
        <span class="dashboard-tonight-estimated-sleep-label" data-i18n="dashboard.tonight.sleepDurationLabel">Sleep duration:</span>
        <span class="dashboard-tonight-estimated-sleep-value" id="dashboard-tonight-estimated-sleep-value">~${formatDuration(durationMins)}</span>
      </p>
      <div class="dashboard-tonight-adjust">
        <div class="dashboard-tonight-adjust-panel" id="dashboard-tonight-adjust-panel">
          <div
            class="dashboard-tonight-adjust-slider dashboard-tonight-adjust-slider--main"
            id="dashboard-tonight-adjust-slider"
            role="group"
            aria-label="Tonight sleep and wake schedule."
            style="--tonight-sleep-pct:${projection.sleepPct}%;--tonight-wake-pct:${projection.wakePct}%;--tonight-mid-pct:${(projection.sleepPct + projection.wakePct) / 2}%;--tonight-rec-start-pct:${projection.recStartPct}%;--tonight-rec-end-pct:${projection.recEndPct}%;--tonight-committed-sleep-pct:${projection.committedSleepPct}%;--tonight-committed-wake-pct:${projection.committedWakePct}%;--tonight-saved-target-sleep-pct:${savedSleepPct};--tonight-saved-target-wake-pct:${savedWakePct};">
            <div class="dashboard-tonight-adjust-top-band">
              <div
                class="dashboard-tonight-adjust-committed-ghost dashboard-tonight-adjust-committed-ghost--sleep dashboard-tonight-adjust-committed-ghost--hidden"
                id="dashboard-tonight-committed-sleep-top"></div>
              <div
                class="dashboard-tonight-adjust-committed-ghost dashboard-tonight-adjust-committed-ghost--wake dashboard-tonight-adjust-committed-ghost--hidden"
                id="dashboard-tonight-committed-wake-top"></div>
              <button
                type="button"
                class="dashboard-tonight-saved-target-btn dashboard-tonight-saved-target-btn--sleep dashboard-tonight-saved-target-btn--hidden"
                id="dashboard-tonight-saved-target-sleep-btn"
                data-i18n-aria-label="dashboard.tonight.savedTargetSleepAria"
                aria-label="Saved sleep target. Tap to clear."></button>
              <button
                type="button"
                class="dashboard-tonight-saved-target-btn dashboard-tonight-saved-target-btn--wake dashboard-tonight-saved-target-btn--hidden"
                id="dashboard-tonight-saved-target-wake-btn"
                data-i18n-aria-label="dashboard.tonight.savedTargetWakeAria"
                aria-label="Saved wake target. Tap to clear."></button>
            </div>
            <div class="dashboard-tonight-adjust-slider-core">
              <div class="dashboard-tonight-adjust-track">
                <div class="dashboard-tonight-adjust-range-fill" aria-hidden="true">${trackWaveSvg}</div>
                <div class="dashboard-tonight-adjust-recommended-window" aria-hidden="true"></div>
              </div>
              <input type="range" id="dashboard-tonight-sleep-slider" min="${base.scopeStartNorm}" max="${base.scopeEndNorm}" step="1" value="${projection.sleepNorm}" aria-label="Tonight sleep target" title="Sleep" data-i18n-title="dashboard.tonight.sleepKnobTooltip">
              <input type="range" id="dashboard-tonight-wake-slider" min="${base.scopeStartNorm}" max="${base.scopeEndNorm}" step="1" value="${projection.wakeNorm}" aria-label="Tomorrow wake target" title="Wake" data-i18n-title="dashboard.tonight.wakeKnobTooltip">
              <div class="dashboard-tonight-adjust-overlay" id="dashboard-tonight-adjust-overlay" aria-hidden="true"></div>
              <div class="dashboard-tonight-adjust-thumb-pack dashboard-tonight-adjust-thumb-pack--sleep" id="dashboard-tonight-sleep-thumb-pack">
                <button
                  type="button"
                  class="dashboard-tonight-adjust-minute-step"
                  id="dashboard-tonight-sleep-minus"
                  data-i18n-aria-label="dashboard.tonight.sleepMinuteEarlierAria"
                  aria-label="Sleep time one minute earlier"
                >
                  ‹
                </button>
                <div class="dashboard-tonight-adjust-thumb-inner">
                  <span class="dashboard-tonight-adjust-thumb-emoji" id="dashboard-tonight-sleep-thumb-icon" aria-hidden="true">🍃</span>
                  <div class="dashboard-tonight-adjust-thumb-label dashboard-tonight-adjust-thumb-label--sleep" id="dashboard-tonight-sleep-thumb-label">${formatTime(projection.sleepClock)}</div>
                  <span class="dashboard-tonight-pace-arrows dashboard-tonight-pace-arrows--sleep dashboard-tonight-pace-arrows--hidden" id="dashboard-tonight-pace-arrows-sleep" aria-hidden="true">
                    <svg class="dashboard-tonight-pace-arrows-svg" viewBox="0 0 38 12" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" focusable="false">
                      <polygon class="dashboard-tonight-pace-arrow" data-index="0" points="0,0 11,6 0,12 3,6" />
                      <polygon class="dashboard-tonight-pace-arrow" data-index="1" points="13,0 24,6 13,12 16,6" />
                      <polygon class="dashboard-tonight-pace-arrow" data-index="2" points="26,0 37,6 26,12 29,6" />
                    </svg>
                  </span>
                </div>
                <button
                  type="button"
                  class="dashboard-tonight-adjust-minute-step"
                  id="dashboard-tonight-sleep-plus"
                  data-i18n-aria-label="dashboard.tonight.sleepMinuteLaterAria"
                  aria-label="Sleep time one minute later"
                >
                  ›
                </button>
              </div>
              <div class="dashboard-tonight-adjust-thumb-pack dashboard-tonight-adjust-thumb-pack--wake" id="dashboard-tonight-wake-thumb-pack">
                <button
                  type="button"
                  class="dashboard-tonight-adjust-minute-step"
                  id="dashboard-tonight-wake-minus"
                  data-i18n-aria-label="dashboard.tonight.wakeMinuteEarlierAria"
                  aria-label="Wake time one minute earlier"
                >
                  ‹
                </button>
                <div class="dashboard-tonight-adjust-thumb-inner">
                  <span class="dashboard-tonight-adjust-thumb-emoji" id="dashboard-tonight-wake-thumb-icon" aria-hidden="true">🍃</span>
                  <div class="dashboard-tonight-adjust-thumb-label dashboard-tonight-adjust-thumb-label--wake" id="dashboard-tonight-wake-thumb-label">${formatTime(projection.wakeClock)}</div>
                  <span class="dashboard-tonight-pace-arrows dashboard-tonight-pace-arrows--wake dashboard-tonight-pace-arrows--hidden" id="dashboard-tonight-pace-arrows-wake" aria-hidden="true">
                    <svg class="dashboard-tonight-pace-arrows-svg" viewBox="0 0 38 12" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" focusable="false">
                      <polygon class="dashboard-tonight-pace-arrow" data-index="0" points="0,0 11,6 0,12 3,6" />
                      <polygon class="dashboard-tonight-pace-arrow" data-index="1" points="13,0 24,6 13,12 16,6" />
                      <polygon class="dashboard-tonight-pace-arrow" data-index="2" points="26,0 37,6 26,12 29,6" />
                    </svg>
                  </span>
                </div>
                <button
                  type="button"
                  class="dashboard-tonight-adjust-minute-step"
                  id="dashboard-tonight-wake-plus"
                  data-i18n-aria-label="dashboard.tonight.wakeMinuteLaterAria"
                  aria-label="Wake time one minute later"
                >
                  ›
                </button>
              </div>
              <div class="dashboard-tonight-knob-actions dashboard-tonight-knob-actions--sleep" id="dashboard-tonight-knob-actions-sleep">
                <button type="button" class="dashboard-tonight-knob-action-btn dashboard-tonight-knob-save-inline" id="dashboard-tonight-sleep-save-target" data-i18n="dashboard.tonight.saveTargetInline">🎯 Set target</button>
                <button type="button" class="dashboard-tonight-knob-action-btn dashboard-tonight-knob-save-inline dashboard-tonight-knob-save-guided" id="dashboard-tonight-sleep-save-guided" data-i18n="dashboard.tonight.saveGuidedInline">🧭 Set guided target</button>
                <button type="button" class="dashboard-tonight-knob-action-btn dashboard-tonight-knob-undo-pole" id="dashboard-tonight-sleep-undo" data-i18n="dashboard.tonight.undoPlain">Undo</button>
              </div>
              <div class="dashboard-tonight-knob-actions dashboard-tonight-knob-actions--wake" id="dashboard-tonight-knob-actions-wake">
                <button type="button" class="dashboard-tonight-knob-action-btn dashboard-tonight-knob-save-inline" id="dashboard-tonight-wake-save-target" data-i18n="dashboard.tonight.saveTargetInline">🎯 Set target</button>
                <button type="button" class="dashboard-tonight-knob-action-btn dashboard-tonight-knob-save-inline dashboard-tonight-knob-save-guided" id="dashboard-tonight-wake-save-guided" data-i18n="dashboard.tonight.saveGuidedInline">🧭 Set guided target</button>
                <button type="button" class="dashboard-tonight-knob-action-btn dashboard-tonight-knob-undo-pole" id="dashboard-tonight-wake-undo" data-i18n="dashboard.tonight.undoPlain">Undo</button>
              </div>
            </div>
          </div>
          <div class="dashboard-tonight-matrix">
            <div
              class="dashboard-tonight-matrix-grid"
              role="grid"
              data-i18n-aria-label="dashboard.tonight.matrix.ariaGrid"
              aria-label="Tonight schedule matrix: natural average, guided time, and saved target per pole."
            >
              <div class="dashboard-tonight-matrix-corner" aria-hidden="true"></div>
              <div class="dashboard-tonight-matrix-h" data-i18n="dashboard.tonight.matrix.headerNatural"><span class="dashboard-tonight-matrix-h-ico" aria-hidden="true">🍃</span> Natural</div>
              <div class="dashboard-tonight-matrix-h" data-i18n="dashboard.tonight.matrix.headerGuided"><span class="dashboard-tonight-matrix-h-ico" aria-hidden="true">🧭</span> Guided</div>
              <div class="dashboard-tonight-matrix-h" data-i18n="dashboard.tonight.matrix.headerTarget"><span class="dashboard-tonight-matrix-h-ico" aria-hidden="true">🎯</span> Target</div>
              <div class="dashboard-tonight-matrix-rh dashboard-tonight-matrix-rh--sleep">
                <span class="dashboard-tonight-matrix-rh-emoji" aria-hidden="true">🌙</span>
                <span class="proj-keyword proj-sleep" data-i18n="dashboard.tonight.sleepKnobTooltip">Sleep</span>
              </div>
              <div class="dashboard-tonight-matrix-cell" id="dashboard-tonight-matrix-sleep-natural"></div>
              <div class="dashboard-tonight-matrix-cell" id="dashboard-tonight-matrix-sleep-guided"></div>
              <div class="dashboard-tonight-matrix-cell" id="dashboard-tonight-matrix-sleep-target"></div>
              <div class="dashboard-tonight-matrix-rh dashboard-tonight-matrix-rh--wake">
                <span class="dashboard-tonight-matrix-rh-emoji" aria-hidden="true">🌅</span>
                <span class="proj-keyword proj-wake" data-i18n="dashboard.tonight.wakeKnobTooltip">Wake</span>
              </div>
              <div class="dashboard-tonight-matrix-cell" id="dashboard-tonight-matrix-wake-natural"></div>
              <div class="dashboard-tonight-matrix-cell" id="dashboard-tonight-matrix-wake-guided"></div>
              <div class="dashboard-tonight-matrix-cell" id="dashboard-tonight-matrix-wake-target"></div>
            </div>
            <div class="dashboard-tonight-matrix-callouts" id="dashboard-tonight-matrix-callouts"></div>
          </div>
        </div>
      </div>
      <dialog class="dashboard-tonight-clear-target-dialog" id="dashboard-tonight-clear-target-dialog" aria-labelledby="dashboard-tonight-confirm-dialog-title">
        <div class="dashboard-tonight-clear-target-dialog-inner" id="dashboard-tonight-clear-target-dialog-inner">
          <p class="dashboard-tonight-clear-target-dialog-message" id="dashboard-tonight-confirm-dialog-title"></p>
          <div class="dashboard-tonight-confirm-dialog-skp" id="dashboard-tonight-confirm-dialog-skp" hidden></div>
          <div class="dashboard-tonight-clear-target-dialog-actions dashboard-tonight-clear-target-dialog-actions--stack" id="dashboard-tonight-clear-target-actions">
            <button type="button" class="about-theme-option dashboard-tonight-confirm-dialog-btn-primary" id="dashboard-tonight-dlg-clear-yes" hidden></button>
            <button type="button" class="about-theme-option" id="dashboard-tonight-clear-target-cancel"></button>
          </div>
        </div>
      </dialog>
    </div>
  `;
}

function initDashboardTonightAdjuster(recentAverages, onChange) {
  function tdT(key, fallback) {
    return typeof t === 'function' ? t(key, fallback) : fallback;
  }

  const root = document.getElementById('dashboard-tonight-projection');
  const panel = document.getElementById('dashboard-tonight-adjust-panel');
  const sliderWrap = document.getElementById('dashboard-tonight-adjust-slider');
  const sliderOverlay = document.getElementById('dashboard-tonight-adjust-overlay');
  const sleepSlider = document.getElementById('dashboard-tonight-sleep-slider');
  const wakeSlider = document.getElementById('dashboard-tonight-wake-slider');
  const sleepLabel = document.getElementById('dashboard-tonight-sleep-thumb-label');
  const wakeLabel = document.getElementById('dashboard-tonight-wake-thumb-label');
  const sleepThumbIcon = document.getElementById('dashboard-tonight-sleep-thumb-icon');
  const wakeThumbIcon = document.getElementById('dashboard-tonight-wake-thumb-icon');
  const sleepThumbPack = document.getElementById('dashboard-tonight-sleep-thumb-pack');
  const wakeThumbPack = document.getElementById('dashboard-tonight-wake-thumb-pack');
  const sleepMinusBtn = document.getElementById('dashboard-tonight-sleep-minus');
  const sleepPlusBtn = document.getElementById('dashboard-tonight-sleep-plus');
  const wakeMinusBtn = document.getElementById('dashboard-tonight-wake-minus');
  const wakePlusBtn = document.getElementById('dashboard-tonight-wake-plus');
  const estimatedSleepValueEl = document.getElementById('dashboard-tonight-estimated-sleep-value');
  const trackWaveGradientEl = document.getElementById('dashboardTonightTrackWaveGradient');
  const trackRangeFillEl = document.querySelector('#dashboard-tonight-adjust-slider .dashboard-tonight-adjust-range-fill');
  const knobActionsSleep = document.getElementById('dashboard-tonight-knob-actions-sleep');
  const knobActionsWake = document.getElementById('dashboard-tonight-knob-actions-wake');
  const sleepSaveTargetBtn = document.getElementById('dashboard-tonight-sleep-save-target');
  const sleepSaveGuidedBtn = document.getElementById('dashboard-tonight-sleep-save-guided');
  const sleepUndoBtn = document.getElementById('dashboard-tonight-sleep-undo');
  const wakeSaveTargetBtn = document.getElementById('dashboard-tonight-wake-save-target');
  const wakeSaveGuidedBtn = document.getElementById('dashboard-tonight-wake-save-guided');
  const wakeUndoBtn = document.getElementById('dashboard-tonight-wake-undo');
  const matrixCallouts = document.getElementById('dashboard-tonight-matrix-callouts');
  const clearTargetDialogInner = document.getElementById('dashboard-tonight-clear-target-dialog-inner');
  const committedSleepTop = document.getElementById('dashboard-tonight-committed-sleep-top');
  const committedWakeTop = document.getElementById('dashboard-tonight-committed-wake-top');
  const savedTargetSleepBtn = document.getElementById('dashboard-tonight-saved-target-sleep-btn');
  const savedTargetWakeBtn = document.getElementById('dashboard-tonight-saved-target-wake-btn');
  const clearTargetDialog = document.getElementById('dashboard-tonight-clear-target-dialog');
  const dlgClearYes = document.getElementById('dashboard-tonight-dlg-clear-yes');
  const clearTargetCancel = document.getElementById('dashboard-tonight-clear-target-cancel');
  const confirmDialogTitle = document.getElementById('dashboard-tonight-confirm-dialog-title');
  const confirmDialogSkp = document.getElementById('dashboard-tonight-confirm-dialog-skp');
  const paceArrowsSleep = document.getElementById('dashboard-tonight-pace-arrows-sleep');
  const paceArrowsWake = document.getElementById('dashboard-tonight-pace-arrows-wake');
  if (
    !root ||
    !panel ||
    !sliderWrap ||
    !sliderOverlay ||
    !sleepSlider ||
    !wakeSlider ||
    !sleepLabel ||
    !wakeLabel ||
    !sleepThumbPack ||
    !wakeThumbPack ||
    !sleepMinusBtn ||
    !sleepPlusBtn ||
    !wakeMinusBtn ||
    !wakePlusBtn ||
    !knobActionsSleep ||
    !knobActionsWake ||
    !sleepSaveTargetBtn ||
    !sleepSaveGuidedBtn ||
    !sleepUndoBtn ||
    !wakeSaveTargetBtn ||
    !wakeSaveGuidedBtn ||
    !wakeUndoBtn ||
    !committedSleepTop ||
    !committedWakeTop ||
    !savedTargetSleepBtn ||
    !savedTargetWakeBtn ||
    !clearTargetDialog ||
    !dlgClearYes ||
    !clearTargetCancel ||
    !confirmDialogTitle ||
    !confirmDialogSkp
  ) {
    return;
  }

  let base = getTonightProjectionBaseState(recentAverages);
  let state = getTonightProjectionState(recentAverages);
  /** @type {'clearPole'|null} */
  let pendingConfirmKind = null;
  /** @type {'sleep'|'wake'|null} */
  let pendingClearPole = null;

  function previewPoleMinuteChange(pole, delta) {
    let sleepNorm = state.sleepNorm;
    let wakeNorm = state.wakeNorm;
    if (pole === 'sleep') sleepNorm += delta;
    else wakeNorm += delta;
    if (pole === 'sleep' && sleepNorm >= wakeNorm) {
      sleepNorm = wakeNorm - TONIGHT_ADJUST_MIN_GAP_MINUTES;
    } else if (pole === 'wake' && wakeNorm <= sleepNorm) {
      wakeNorm = sleepNorm + TONIGHT_ADJUST_MIN_GAP_MINUTES;
    }
    const clamped = clampTonightProjectionNorms(base, sleepNorm, wakeNorm);
    return pole === 'sleep' ? clamped.sleepNorm !== state.sleepNorm : clamped.wakeNorm !== state.wakeNorm;
  }

  function applySliderBoundsFromBase() {
    sleepSlider.min = String(base.scopeStartNorm);
    sleepSlider.max = String(base.scopeEndNorm);
    wakeSlider.min = String(base.scopeStartNorm);
    wakeSlider.max = String(base.scopeEndNorm);
  }

  const TONIGHT_PACE_ARROW_OFF = 0.12;
  const TONIGHT_PACE_ARROW_RESTING = 0.55;
  const TONIGHT_PACE_ARROW_PEAK = 1.0;
  const TONIGHT_PACE_BEAT_FAST = 280;
  const TONIGHT_PACE_BEAT_MED = TONIGHT_PACE_BEAT_FAST * 2;
  const TONIGHT_PACE_BEAT_SLOW = TONIGHT_PACE_BEAT_FAST * 3;
  const TONIGHT_PACE_FRAMES = {
    gentle: [
      { states: [TONIGHT_PACE_ARROW_PEAK, TONIGHT_PACE_ARROW_OFF, TONIGHT_PACE_ARROW_OFF], hold: TONIGHT_PACE_BEAT_SLOW },
      { states: [TONIGHT_PACE_ARROW_RESTING, TONIGHT_PACE_ARROW_OFF, TONIGHT_PACE_ARROW_OFF], hold: TONIGHT_PACE_BEAT_SLOW }
    ],
    normal: [
      { states: [TONIGHT_PACE_ARROW_PEAK, TONIGHT_PACE_ARROW_OFF, TONIGHT_PACE_ARROW_OFF], hold: TONIGHT_PACE_BEAT_MED },
      { states: [TONIGHT_PACE_ARROW_RESTING, TONIGHT_PACE_ARROW_PEAK, TONIGHT_PACE_ARROW_OFF], hold: TONIGHT_PACE_BEAT_MED },
      { states: [TONIGHT_PACE_ARROW_RESTING, TONIGHT_PACE_ARROW_RESTING, TONIGHT_PACE_ARROW_OFF], hold: TONIGHT_PACE_BEAT_MED * 1.6 },
      { states: [TONIGHT_PACE_ARROW_OFF, TONIGHT_PACE_ARROW_OFF, TONIGHT_PACE_ARROW_OFF], hold: TONIGHT_PACE_BEAT_MED * 0.9 }
    ],
    steady: [
      { states: [TONIGHT_PACE_ARROW_PEAK, TONIGHT_PACE_ARROW_OFF, TONIGHT_PACE_ARROW_OFF], hold: TONIGHT_PACE_BEAT_FAST },
      { states: [TONIGHT_PACE_ARROW_RESTING, TONIGHT_PACE_ARROW_PEAK, TONIGHT_PACE_ARROW_OFF], hold: TONIGHT_PACE_BEAT_FAST },
      { states: [TONIGHT_PACE_ARROW_RESTING, TONIGHT_PACE_ARROW_RESTING, TONIGHT_PACE_ARROW_PEAK], hold: TONIGHT_PACE_BEAT_FAST },
      { states: [TONIGHT_PACE_ARROW_RESTING, TONIGHT_PACE_ARROW_RESTING, TONIGHT_PACE_ARROW_RESTING], hold: TONIGHT_PACE_BEAT_FAST * 1.6 },
      { states: [TONIGHT_PACE_ARROW_OFF, TONIGHT_PACE_ARROW_OFF, TONIGHT_PACE_ARROW_OFF], hold: TONIGHT_PACE_BEAT_FAST * 0.9 }
    ]
  };

  let tonightPaceArrowTimer = null;
  let tonightPaceArrowFrameIdx = 0;
  let tonightPaceArrowActivePace = null;

  function getTonightPaceArrowGroups() {
    const groups = [];
    if (paceArrowsSleep && !paceArrowsSleep.classList.contains('dashboard-tonight-pace-arrows--hidden')) {
      groups.push(paceArrowsSleep.querySelectorAll('.dashboard-tonight-pace-arrow'));
    }
    if (paceArrowsWake && !paceArrowsWake.classList.contains('dashboard-tonight-pace-arrows--hidden')) {
      groups.push(paceArrowsWake.querySelectorAll('.dashboard-tonight-pace-arrow'));
    }
    return groups;
  }

  function applyTonightPaceArrowFrame(frame) {
    const groups = getTonightPaceArrowGroups();
    for (let g = 0; g < groups.length; g++) {
      const arrows = groups[g];
      for (let i = 0; i < arrows.length && i < frame.states.length; i++) {
        arrows[i].style.opacity = String(frame.states[i]);
      }
    }
  }

  function tickTonightPaceArrows() {
    const sleepConnected = paceArrowsSleep && paceArrowsSleep.isConnected;
    const wakeConnected = paceArrowsWake && paceArrowsWake.isConnected;
    if (!sleepConnected && !wakeConnected) {
      stopTonightPaceArrowAnimator();
      return;
    }
    const cfg = TONIGHT_PACE_FRAMES[tonightPaceArrowActivePace] || TONIGHT_PACE_FRAMES.gentle;
    const frame = cfg[tonightPaceArrowFrameIdx % cfg.length];
    applyTonightPaceArrowFrame(frame);
    tonightPaceArrowFrameIdx++;
    tonightPaceArrowTimer = setTimeout(tickTonightPaceArrows, frame.hold);
  }

  function stopTonightPaceArrowAnimator() {
    if (tonightPaceArrowTimer) {
      clearTimeout(tonightPaceArrowTimer);
      tonightPaceArrowTimer = null;
    }
    tonightPaceArrowActivePace = null;
  }

  function syncTonightPaceArrowAnimator(paceId) {
    const anyVisible =
      (paceArrowsSleep && !paceArrowsSleep.classList.contains('dashboard-tonight-pace-arrows--hidden')) ||
      (paceArrowsWake && !paceArrowsWake.classList.contains('dashboard-tonight-pace-arrows--hidden'));
    if (!anyVisible) {
      stopTonightPaceArrowAnimator();
      return;
    }
    const pid = paceId === 'normal' || paceId === 'steady' ? paceId : 'gentle';
    if (tonightPaceArrowActivePace === pid && tonightPaceArrowTimer) return;
    if (tonightPaceArrowTimer) {
      clearTimeout(tonightPaceArrowTimer);
      tonightPaceArrowTimer = null;
    }
    tonightPaceArrowActivePace = pid;
    tonightPaceArrowFrameIdx = 0;
    tickTonightPaceArrows();
  }

  function updateTonightPaceArrowIndicator(host, mergeDirty, poleGuided, savedTargetMinutes, guidedClockMinutes) {
    if (!host) return;
    const show =
      !mergeDirty &&
      poleGuided &&
      savedTargetMinutes != null &&
      guidedClockMinutes != null &&
      typeof shortestSignedClockDelta === 'function';
    if (!show) {
      host.classList.add('dashboard-tonight-pace-arrows--hidden');
      host.classList.remove('dashboard-tonight-pace-arrows--earlier', 'dashboard-tonight-pace-arrows--later');
      const arrows = host.querySelectorAll('.dashboard-tonight-pace-arrow');
      for (let i = 0; i < arrows.length; i++) arrows[i].style.opacity = '';
      return;
    }
    const signed = shortestSignedClockDelta(guidedClockMinutes, savedTargetMinutes);
    if (signed === 0) {
      host.classList.add('dashboard-tonight-pace-arrows--hidden');
      host.classList.remove('dashboard-tonight-pace-arrows--earlier', 'dashboard-tonight-pace-arrows--later');
      const arrows = host.querySelectorAll('.dashboard-tonight-pace-arrow');
      for (let i = 0; i < arrows.length; i++) arrows[i].style.opacity = '';
      return;
    }
    host.classList.remove('dashboard-tonight-pace-arrows--hidden');
    if (signed < 0) {
      host.classList.add('dashboard-tonight-pace-arrows--earlier');
      host.classList.remove('dashboard-tonight-pace-arrows--later');
    } else {
      host.classList.add('dashboard-tonight-pace-arrows--later');
      host.classList.remove('dashboard-tonight-pace-arrows--earlier');
    }
  }

  function syncTonightMatrix() {
    if (typeof buildTonightMatrixViewModel !== 'function' || !matrixCallouts) return;
    const elSleepNat = document.getElementById('dashboard-tonight-matrix-sleep-natural');
    if (!elSleepNat) return;

    const paceIdLive = base.paceId || 'gentle';
    const sleepVm = buildTonightMatrixViewModel({
      pole: 'sleep',
      naturalMinutes: base.naturalSleepMinutes,
      savedTargetMinutes: base.savedTargetSleep,
      guidanceEnabled: base.guidanceSleepEnabled,
      guidedMinutes: state.sleepClock,
      paceId: paceIdLive
    });
    const wakeVm = buildTonightMatrixViewModel({
      pole: 'wake',
      naturalMinutes: base.naturalWakeMinutes,
      savedTargetMinutes: base.savedTargetWake,
      guidanceEnabled: base.guidanceWakeEnabled,
      guidedMinutes: state.wakeClock,
      paceId: paceIdLive
    });

    function applyTonightMatrixTimeHighlight(vm, natEl, guidedEl, tgtEl) {
      const ac = vm.activeColumn === 'guided' || vm.activeColumn === 'target' ? vm.activeColumn : 'natural';
      const poleSleep = vm.pole === 'sleep';
      const cols = [natEl, guidedEl, tgtEl];
      const keys = ['natural', 'guided', 'target'];
      for (let i = 0; i < 3; i++) {
        const el = cols[i];
        const isActive = keys[i] === ac;
        el.classList.toggle('dashboard-tonight-matrix-cell--active', isActive);
        el.classList.toggle('dashboard-tonight-matrix-cell--muted', !isActive);
        el.classList.toggle('dashboard-tonight-matrix-cell--pole-sleep', isActive && poleSleep);
        el.classList.toggle('dashboard-tonight-matrix-cell--pole-wake', isActive && !poleSleep);
      }
    }

    function fillRow(vm, ids) {
      const nat = document.getElementById(ids.nat);
      const guided = document.getElementById(ids.guided);
      const tgt = document.getElementById(ids.target);
      if (!nat || !guided || !tgt) return;

      if (vm.rowMode === 'empty') {
        nat.textContent = TONIGHT_MATRIX_EM;
        guided.textContent = TONIGHT_MATRIX_EM;
        tgt.textContent = TONIGHT_MATRIX_EM;
        applyTonightMatrixTimeHighlight(vm, nat, guided, tgt);
        return;
      }
      nat.textContent = tonightMatrixFormatCell(vm.cellNatural);
      if (vm.rowMode === 'no_target') {
        guided.textContent = TONIGHT_MATRIX_EM;
        tgt.textContent = TONIGHT_MATRIX_EM;
        applyTonightMatrixTimeHighlight(vm, nat, guided, tgt);
        return;
      }
      if (vm.rowMode === 'target_no_guidance') {
        guided.textContent = TONIGHT_MATRIX_EM;
        tgt.textContent = tonightMatrixFormatCell(vm.cellTarget);
        applyTonightMatrixTimeHighlight(vm, nat, guided, tgt);
        return;
      }
      guided.textContent = tonightMatrixFormatCell(vm.cellGuided);
      tgt.textContent = tonightMatrixFormatCell(vm.cellTarget);
      applyTonightMatrixTimeHighlight(vm, nat, guided, tgt);
    }

    fillRow(sleepVm, {
      nat: 'dashboard-tonight-matrix-sleep-natural',
      guided: 'dashboard-tonight-matrix-sleep-guided',
      target: 'dashboard-tonight-matrix-sleep-target'
    });
    fillRow(wakeVm, {
      nat: 'dashboard-tonight-matrix-wake-natural',
      guided: 'dashboard-tonight-matrix-wake-guided',
      target: 'dashboard-tonight-matrix-wake-target'
    });

    matrixCallouts.textContent = '';
    [sleepVm, wakeVm].forEach(function (vm) {
      if (!vm.callout || vm.rowMode !== 'full_guidance') return;
      const parts = buildTonightMatrixCalloutParts(vm, tdT);
      if (!parts) return;
      const row = document.createElement('div');
      row.className = 'dashboard-tonight-matrix-callout dashboard-tonight-matrix-callout--' + vm.pole;
      const dot = document.createElement('span');
      dot.className = 'dashboard-tonight-matrix-callout-dot';
      dot.setAttribute('aria-hidden', 'true');
      const body = document.createElement('p');
      body.className = 'dashboard-tonight-matrix-callout-body';
      const phaseSpan = document.createElement('span');
      phaseSpan.className = 'dashboard-tonight-matrix-callout-phase';
      phaseSpan.textContent = parts.phaseWord;
      const sep = document.createElement('span');
      sep.className = 'dashboard-tonight-matrix-callout-sep';
      sep.textContent = ' \u2014 ';
      const rest = document.createElement('span');
      rest.className = 'dashboard-tonight-matrix-callout-rest';
      rest.textContent = parts.detail;
      body.appendChild(phaseSpan);
      body.appendChild(sep);
      body.appendChild(rest);
      row.appendChild(dot);
      row.appendChild(body);
      matrixCallouts.appendChild(row);
    });
  }

  function updateVisualState(persistOverride) {
    const scopeSpan = base.scopeEndNorm - base.scopeStartNorm;
    const sleepPct = ((state.sleepNorm - base.scopeStartNorm) / scopeSpan) * 100;
    const wakePct = ((state.wakeNorm - base.scopeStartNorm) / scopeSpan) * 100;
    const midPct = (sleepPct + wakePct) / 2;
    sliderWrap.style.setProperty('--tonight-sleep-pct', `${sleepPct}%`);
    sliderWrap.style.setProperty('--tonight-wake-pct', `${wakePct}%`);
    sliderWrap.style.setProperty('--tonight-mid-pct', `${midPct}%`);

    const wrapW = sliderWrap.getBoundingClientRect().width;
    const loPct = Math.min(sleepPct, wakePct);
    const hiPct = Math.max(sleepPct, wakePct);
    let fillStartPct = loPct;
    let fillEndPct = hiPct;
    const recStartRaw = ((base.recommendedSleepNorm - base.scopeStartNorm) / scopeSpan) * 100;
    const recEndRaw = ((base.recommendedWakeNorm - base.scopeStartNorm) / scopeSpan) * 100;
    let recLo = Math.min(recStartRaw, recEndRaw);
    let recHi = Math.max(recStartRaw, recEndRaw);
    if (wrapW > 0) {
      const insetPct = (TONIGHT_KNOB_OUTER_PX / 2 / wrapW) * 100;
      const spanPct = hiPct - loPct;
      const half = spanPct / 2;
      const eps = 0.02;
      const insetLeft = Math.min(insetPct, Math.max(0, half - eps));
      const insetRight = Math.min(insetPct, Math.max(0, half - eps));
      if (spanPct > 0) {
        fillStartPct = loPct + insetLeft;
        fillEndPct = hiPct - insetRight;
        recLo = Math.max(recLo, fillStartPct);
        recHi = Math.min(recHi, fillEndPct);
        if (recLo >= recHi) {
          recHi = recLo + 0.05;
        }
      }
    }
    sliderWrap.style.setProperty('--tonight-fill-start-pct', `${fillStartPct}%`);
    sliderWrap.style.setProperty('--tonight-fill-end-pct', `${fillEndPct}%`);

    sliderWrap.style.setProperty('--tonight-rec-start-pct', `${recLo}%`);
    sliderWrap.style.setProperty('--tonight-rec-end-pct', `${recHi}%`);

    const committedSleepPct = ((base.committedSleepNorm - base.scopeStartNorm) / scopeSpan) * 100;
    const committedWakePct = ((base.committedWakeNorm - base.scopeStartNorm) / scopeSpan) * 100;
    sliderWrap.style.setProperty('--tonight-committed-sleep-pct', `${committedSleepPct}%`);
    sliderWrap.style.setProperty('--tonight-committed-wake-pct', `${committedWakePct}%`);

    if (base.savedTargetSleepNorm != null) {
      const stSp = ((base.savedTargetSleepNorm - base.scopeStartNorm) / scopeSpan) * 100;
      sliderWrap.style.setProperty('--tonight-saved-target-sleep-pct', `${stSp}%`);
    } else {
      sliderWrap.style.setProperty('--tonight-saved-target-sleep-pct', `${sleepPct}%`);
    }
    if (base.savedTargetWakeNorm != null) {
      const stWp = ((base.savedTargetWakeNorm - base.scopeStartNorm) / scopeSpan) * 100;
      sliderWrap.style.setProperty('--tonight-saved-target-wake-pct', `${stWp}%`);
    } else {
      sliderWrap.style.setProperty('--tonight-saved-target-wake-pct', `${wakePct}%`);
    }

    sleepSlider.value = String(state.sleepNorm);
    wakeSlider.value = String(state.wakeNorm);

    const sleepGuidanceOn =
      typeof getTonightGuidanceSleepEnabled === 'function' ? getTonightGuidanceSleepEnabled() : false;
    const wakeGuidanceOn =
      typeof getTonightGuidanceWakeEnabled === 'function' ? getTonightGuidanceWakeEnabled() : false;
    const sleepPoleGuided =
      sleepGuidanceOn &&
      base.savedTargetSleep != null &&
      modMinutes1440(base.committedSleep) !== modMinutes1440(base.savedTargetSleep);
    const wakePoleGuided =
      wakeGuidanceOn &&
      base.savedTargetWake != null &&
      modMinutes1440(base.committedWake) !== modMinutes1440(base.savedTargetWake);
    const sleepTxt = formatTime(state.sleepClock);
    const wakeTxt = formatTime(state.wakeClock);
    const sleepFromAverage = base.savedTargetSleep == null;
    const wakeFromAverage = base.savedTargetWake == null;
    sleepLabel.textContent = sleepTxt;
    wakeLabel.textContent = wakeTxt;
    const sleepThumbCompass = base.savedTargetSleep != null && base.guidanceSleepEnabled;
    const wakeThumbCompass = base.savedTargetWake != null && base.guidanceWakeEnabled;
    if (sleepThumbIcon) sleepThumbIcon.textContent = sleepThumbCompass ? '🧭' : '🍃';
    if (wakeThumbIcon) wakeThumbIcon.textContent = wakeThumbCompass ? '🧭' : '🍃';
    syncTonightMatrix();

    let scheduleAria = tdT('dashboard.tonight.ariaScheduleBase', 'Tonight sleep and wake schedule.');
    if (base.tonightGuidanceMode === 'guided') {
      scheduleAria +=
        ' ' +
        tdT(
          'dashboard.tonight.ariaGuidedHint',
          'Compass on a time is tonight’s guided schedule. Lighter markers above the bar show saved targets where they still differ.'
        );
    }
    if (sleepFromAverage || wakeFromAverage) {
      const naturalBits = [];
      if (sleepFromAverage) {
        naturalBits.push(
          tdT('dashboard.tonight.ariaSleepFromAverage', 'Sleep time follows your recent average (no saved sleep target).')
        );
      }
      if (wakeFromAverage) {
        naturalBits.push(
          tdT('dashboard.tonight.ariaWakeFromAverage', 'Wake time follows your recent average (no saved wake target).')
        );
      }
      if (naturalBits.length) scheduleAria += ' ' + naturalBits.join(' ');
    }
    sliderWrap.setAttribute('aria-label', scheduleAria);

    const duration = durationMinutes(state.sleepClock, state.wakeClock);
    const durationLabel = `~${formatDuration(duration)}`;
    if (estimatedSleepValueEl) {
      estimatedSleepValueEl.textContent = durationLabel;
    }

    if (trackWaveGradientEl && trackRangeFillEl) {
      const fillW = Math.round(trackRangeFillEl.getBoundingClientRect().width);
      if (fillW > 0) trackWaveGradientEl.setAttribute('x2', String(fillW));
    }

    root.classList.toggle('dashboard-tonight-projection--adjusted', state.isAdjusted);

    const sleepMergeDirty = modMinutes1440(state.sleepClock) !== modMinutes1440(base.committedSleep);
    const wakeMergeDirty = modMinutes1440(state.wakeClock) !== modMinutes1440(base.committedWake);
    const mergeDirty = sleepMergeDirty || wakeMergeDirty;

    if (committedSleepTop && committedWakeTop) {
      const showSleepCommittedGhost = sleepMergeDirty && base.savedTargetSleep == null;
      const showWakeCommittedGhost = wakeMergeDirty && base.savedTargetWake == null;
      committedSleepTop.innerHTML = showSleepCommittedGhost
        ? '<span class="dashboard-tonight-committed-ghost-time">' + formatTime(base.committedSleep) + '</span>'
        : '';
      committedWakeTop.innerHTML = showWakeCommittedGhost
        ? '<span class="dashboard-tonight-committed-ghost-time">' + formatTime(base.committedWake) + '</span>'
        : '';
      committedSleepTop.classList.toggle('dashboard-tonight-adjust-committed-ghost--hidden', !showSleepCommittedGhost);
      committedWakeTop.classList.toggle('dashboard-tonight-adjust-committed-ghost--hidden', !showWakeCommittedGhost);
    }

    const canTapTargets = !state.isAdjusted;
    const showSleepSavedBtn = base.savedTargetSleep != null;
    const showWakeSavedBtn = base.savedTargetWake != null;
    if (savedTargetSleepBtn && savedTargetWakeBtn) {
      savedTargetSleepBtn.innerHTML = showSleepSavedBtn
        ? '<span class="dashboard-tonight-saved-target-ico" aria-hidden="true">🎯</span><span class="dashboard-tonight-saved-target-time">' +
          formatTime(base.savedTargetSleep) +
          '</span>'
        : '';
      savedTargetWakeBtn.innerHTML = showWakeSavedBtn
        ? '<span class="dashboard-tonight-saved-target-ico" aria-hidden="true">🎯</span><span class="dashboard-tonight-saved-target-time">' +
          formatTime(base.savedTargetWake) +
          '</span>'
        : '';
      savedTargetSleepBtn.classList.toggle('dashboard-tonight-saved-target-btn--hidden', !showSleepSavedBtn);
      savedTargetWakeBtn.classList.toggle('dashboard-tonight-saved-target-btn--hidden', !showWakeSavedBtn);
      savedTargetSleepBtn.disabled = !canTapTargets;
      savedTargetWakeBtn.disabled = !canTapTargets;
      savedTargetSleepBtn.classList.toggle('dashboard-tonight-saved-target-btn--dim', !canTapTargets && showSleepSavedBtn);
      savedTargetWakeBtn.classList.toggle('dashboard-tonight-saved-target-btn--dim', !canTapTargets && showWakeSavedBtn);
    }

    knobActionsSleep.classList.toggle('dashboard-tonight-knob-actions--visible', sleepMergeDirty);
    knobActionsWake.classList.toggle('dashboard-tonight-knob-actions--visible', wakeMergeDirty);
    if (sleepMergeDirty) knobActionsSleep.removeAttribute('inert');
    else knobActionsSleep.setAttribute('inert', '');
    if (wakeMergeDirty) knobActionsWake.removeAttribute('inert');
    else knobActionsWake.setAttribute('inert', '');
    sleepUndoBtn.disabled = !sleepMergeDirty;
    wakeUndoBtn.disabled = !wakeMergeDirty;

    sleepThumbPack.classList.toggle('dashboard-tonight-adjust-thumb-pack--dirty', sleepMergeDirty);
    wakeThumbPack.classList.toggle('dashboard-tonight-adjust-thumb-pack--dirty', wakeMergeDirty);
    sleepMinusBtn.disabled = !sleepMergeDirty || !previewPoleMinuteChange('sleep', -1);
    sleepPlusBtn.disabled = !sleepMergeDirty || !previewPoleMinuteChange('sleep', 1);
    wakeMinusBtn.disabled = !wakeMergeDirty || !previewPoleMinuteChange('wake', -1);
    wakePlusBtn.disabled = !wakeMergeDirty || !previewPoleMinuteChange('wake', 1);

    sleepSaveGuidedBtn.hidden = sleepGuidanceOn;
    wakeSaveGuidedBtn.hidden = wakeGuidanceOn;
    if (sleepGuidanceOn) sleepSaveGuidedBtn.setAttribute('inert', '');
    else sleepSaveGuidedBtn.removeAttribute('inert');
    if (wakeGuidanceOn) wakeSaveGuidedBtn.setAttribute('inert', '');
    else wakeSaveGuidedBtn.removeAttribute('inert');

    updateTonightPaceArrowIndicator(
      paceArrowsSleep,
      sleepMergeDirty,
      sleepPoleGuided,
      base.savedTargetSleep,
      state.sleepClock
    );
    updateTonightPaceArrowIndicator(
      paceArrowsWake,
      wakeMergeDirty,
      wakePoleGuided,
      base.savedTargetWake,
      state.wakeClock
    );
    syncTonightPaceArrowAnimator(base.paceId);

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
    if (changedSide !== 'both') {
      if (changedSide === 'sleep' && sleepNorm >= wakeNorm) {
        sleepNorm = wakeNorm - TONIGHT_ADJUST_MIN_GAP_MINUTES;
      } else if (changedSide === 'wake' && wakeNorm <= sleepNorm) {
        wakeNorm = sleepNorm + TONIGHT_ADJUST_MIN_GAP_MINUTES;
      }
    }
    const clamped = clampTonightProjectionNorms(base, sleepNorm, wakeNorm);
    state = {
      ...state,
      sleepNorm: clamped.sleepNorm,
      wakeNorm: clamped.wakeNorm,
      sleepClock: modMinutes1440(clamped.sleepNorm),
      wakeClock: modMinutes1440(clamped.wakeNorm)
    };
    state.isAdjusted = state.sleepClock !== base.committedSleep || state.wakeClock !== base.committedWake;
    updateVisualState(true);
  }

  function applyPoleMinuteDelta(pole, delta) {
    let sleepNorm = state.sleepNorm;
    let wakeNorm = state.wakeNorm;
    if (pole === 'sleep') sleepNorm += delta;
    else wakeNorm += delta;
    if (pole === 'sleep' && sleepNorm >= wakeNorm) {
      sleepNorm = wakeNorm - TONIGHT_ADJUST_MIN_GAP_MINUTES;
    } else if (pole === 'wake' && wakeNorm <= sleepNorm) {
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
    state.isAdjusted = state.sleepClock !== base.committedSleep || state.wakeClock !== base.committedWake;
    sleepSlider.value = String(state.sleepNorm);
    wakeSlider.value = String(state.wakeNorm);
    updateVisualState(true);
  }

  function getNormFromPointer(e) {
    const rect = sliderWrap.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.round(base.scopeStartNorm + frac * (base.scopeEndNorm - base.scopeStartNorm));
  }

  const TONIGHT_OVERLAY_THUMB_PAD_PX = 16;
  let dragging = null;
  let panDragStartNorm = 0;
  let panDragStartSleepNorm = 0;
  let panDragStartWakeNorm = 0;

  function onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    if (e.touches && e.touches.length > 1) return;
    if (e.cancelable) e.preventDefault();
    const rect = sliderWrap.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const x = clientX - rect.left;
    const scopeSpan = base.scopeEndNorm - base.scopeStartNorm;
    let usePan = false;
    if (rect.width > 0 && scopeSpan > 0) {
      const sleepX = ((state.sleepNorm - base.scopeStartNorm) / scopeSpan) * rect.width;
      const wakeX = ((state.wakeNorm - base.scopeStartNorm) / scopeSpan) * rect.width;
      const lo = Math.min(sleepX, wakeX);
      const hi = Math.max(sleepX, wakeX);
      const innerLeft = lo + TONIGHT_OVERLAY_THUMB_PAD_PX;
      const innerRight = hi - TONIGHT_OVERLAY_THUMB_PAD_PX;
      if (innerLeft <= innerRight && x >= innerLeft && x <= innerRight) {
        usePan = true;
      }
    }
    if (usePan) {
      dragging = 'both';
      panDragStartNorm = getNormFromPointer(e);
      panDragStartSleepNorm = state.sleepNorm;
      panDragStartWakeNorm = state.wakeNorm;
      sliderOverlay.style.cursor = 'grabbing';
      return;
    }
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
    if (dragging === 'both') {
      const deltaNorm = getNormFromPointer(e) - panDragStartNorm;
      const nextSleep = panDragStartSleepNorm + deltaNorm;
      const nextWake = panDragStartWakeNorm + deltaNorm;
      sleepSlider.value = String(nextSleep);
      wakeSlider.value = String(nextWake);
      updateFromSliders('both');
      return;
    }
    const norm = getNormFromPointer(e);
    if (dragging === 'sleep') {
      sleepSlider.value = String(norm);
    } else {
      wakeSlider.value = String(norm);
    }
    updateFromSliders(dragging);
  }

  function onPointerUp() {
    if (dragging === 'both') {
      sliderOverlay.style.cursor = '';
    }
    dragging = null;
  }

  sleepSlider.addEventListener('input', function () {
    updateFromSliders('sleep');
  });
  wakeSlider.addEventListener('input', function () {
    updateFromSliders('wake');
  });

  function revertPoleToCommitted(pole) {
    if (typeof clearTonightProjectionAdjustment === 'function') clearTonightProjectionAdjustment();
    const sleepNorm = pole === 'sleep' ? base.committedSleepNorm : state.sleepNorm;
    const wakeNorm = pole === 'wake' ? base.committedWakeNorm : state.wakeNorm;
    const clamped = clampTonightProjectionNorms(base, sleepNorm, wakeNorm);
    state = {
      ...state,
      sleepNorm: clamped.sleepNorm,
      wakeNorm: clamped.wakeNorm,
      sleepClock: modMinutes1440(clamped.sleepNorm),
      wakeClock: modMinutes1440(clamped.wakeNorm)
    };
    state.isAdjusted = state.sleepClock !== base.committedSleep || state.wakeClock !== base.committedWake;
    updateVisualState(true);
  }

  function saveTonightDirtyAdjustments(mode) {
    const sleepMergeDirty = modMinutes1440(state.sleepClock) !== modMinutes1440(base.committedSleep);
    const wakeMergeDirty = modMinutes1440(state.wakeClock) !== modMinutes1440(base.committedWake);
    if (!sleepMergeDirty && !wakeMergeDirty) return;
    const prevSleepG =
      typeof getTonightGuidanceSleepEnabled === 'function' ? getTonightGuidanceSleepEnabled() : false;
    const prevWakeG =
      typeof getTonightGuidanceWakeEnabled === 'function' ? getTonightGuidanceWakeEnabled() : false;
    if (mode === 'enable') {
      if (sleepMergeDirty && typeof setTonightGuidanceSleepEnabled === 'function') setTonightGuidanceSleepEnabled(true);
      if (wakeMergeDirty && typeof setTonightGuidanceWakeEnabled === 'function') setTonightGuidanceWakeEnabled(true);
    }
    runTonightMergeSave(sleepMergeDirty, wakeMergeDirty);
    if (mode === 'preserve') {
      if (sleepMergeDirty && typeof setTonightGuidanceSleepEnabled === 'function') setTonightGuidanceSleepEnabled(prevSleepG);
      if (wakeMergeDirty && typeof setTonightGuidanceWakeEnabled === 'function') setTonightGuidanceWakeEnabled(prevWakeG);
    }
    requestAnimationFrame(function () {
      updateVisualState(false);
    });
    sleepSlider.focus();
  }

  function refreshAfterTonightStorageChange() {
    if (typeof clearTonightProjectionAdjustment === 'function') clearTonightProjectionAdjustment();
    base = getTonightProjectionBaseState(recentAverages);
    state = getTonightProjectionState(recentAverages);
    applySliderBoundsFromBase();
    updateVisualState(false);
  }

  function performClearPole(pole) {
    if (pole === 'sleep' && typeof clearTonightTargetPole === 'function') clearTonightTargetPole('sleep');
    else if (pole === 'wake' && typeof clearTonightTargetPole === 'function') clearTonightTargetPole('wake');
    refreshAfterTonightStorageChange();
    showAppToast(tdT('dashboard.tonight.toastCleared', 'Tonight target cleared'));
  }

  function hideAllDialogActions() {
    dlgClearYes.hidden = true;
    if (clearTargetDialogInner) clearTargetDialogInner.classList.remove('dashboard-tonight-clear-target-dialog-inner--save-menu');
  }

  function openTonightClearPoleDialog(pole) {
    pendingConfirmKind = 'clearPole';
    pendingClearPole = pole;
    hideAllDialogActions();
    confirmDialogSkp.hidden = true;
    confirmDialogSkp.innerHTML = '';
    while (confirmDialogTitle.firstChild) confirmDialogTitle.removeChild(confirmDialogTitle.firstChild);
    const lead = tdT('dashboard.tonight.clearPoleLead', 'Clear your ');
    confirmDialogTitle.appendChild(document.createTextNode(lead));
    const skpSpan = document.createElement('span');
    skpSpan.className = pole === 'sleep' ? 'proj-keyword proj-sleep' : 'proj-keyword proj-wake';
    skpSpan.textContent =
      pole === 'sleep' ? tdT('dashboard.tonight.sleepTargetSkp', '🌙 Sleep') : tdT('dashboard.tonight.wakeTargetSkp', '🌅 Wake');
    confirmDialogTitle.appendChild(skpSpan);
    confirmDialogTitle.appendChild(document.createTextNode(tdT('dashboard.tonight.clearPoleTrail', ' target?')));
    dlgClearYes.hidden = false;
    dlgClearYes.textContent = tdT('dashboard.tonight.clearTargetYesShort', 'Yes, clear my target');
    clearTargetCancel.textContent = tdT('dashboard.tonight.clearLeaveSingle', 'No, leave my target');
    clearTargetDialog.removeAttribute('aria-label');
    clearTargetDialog.setAttribute('aria-labelledby', 'dashboard-tonight-confirm-dialog-title');
    clearTargetDialog.showModal();
  }

  clearTargetDialog.addEventListener('close', function () {
    pendingConfirmKind = null;
    pendingClearPole = null;
    clearTargetDialog.removeAttribute('aria-label');
    clearTargetDialog.setAttribute('aria-labelledby', 'dashboard-tonight-confirm-dialog-title');
  });

  function finishTonightSave(toastKey, toastFallback) {
    refreshAfterTonightStorageChange();
    showAppToast(tdT(toastKey, toastFallback));
  }

  function runTonightMergeSave(sleepPole, wakePole) {
    const partial = {};
    if (sleepPole) partial.sleep = state.sleepClock;
    if (wakePole) partial.wake = state.wakeClock;
    if (typeof mergeTonightTargetWindow === 'function') {
      mergeTonightTargetWindow(partial);
    } else if (typeof setTonightTargetWindow === 'function' && sleepPole && wakePole) {
      setTonightTargetWindow(state.sleepClock, state.wakeClock);
    }
    const hadTarget = base.hasSavedTonightTarget;
    const isUpdate = hadTarget && (sleepPole || wakePole);
    finishTonightSave(
      isUpdate ? 'dashboard.tonight.toastUpdated' : 'dashboard.tonight.toastSaved',
      isUpdate ? 'Tonight target updated' : 'Tonight target saved'
    );
  }

  dlgClearYes.addEventListener('click', function () {
    if (pendingConfirmKind !== 'clearPole' || !pendingClearPole) return;
    const pole = pendingClearPole;
    performClearPole(pole);
    clearTargetDialog.close();
    if (pole === 'sleep' && savedTargetSleepBtn) savedTargetSleepBtn.focus();
    else if (savedTargetWakeBtn) savedTargetWakeBtn.focus();
  });

  clearTargetCancel.addEventListener('click', function () {
    clearTargetDialog.close();
  });

  function bindTargetClearClick(btn, pole) {
    function tryOpenClear(e) {
      if (state.isAdjusted) return;
      if (pole === 'sleep' && base.savedTargetSleep == null) return;
      if (pole === 'wake' && base.savedTargetWake == null) return;
      if (e.type === 'keydown') e.preventDefault();
      openTonightClearPoleDialog(pole);
    }
    btn.addEventListener('click', tryOpenClear);
    btn.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      tryOpenClear(e);
    });
  }
  if (!savedTargetSleepBtn.dataset.tonightClearClickBound) {
    savedTargetSleepBtn.dataset.tonightClearClickBound = '1';
    bindTargetClearClick(savedTargetSleepBtn, 'sleep');
  }
  if (!savedTargetWakeBtn.dataset.tonightClearClickBound) {
    savedTargetWakeBtn.dataset.tonightClearClickBound = '1';
    bindTargetClearClick(savedTargetWakeBtn, 'wake');
  }

  sleepSaveTargetBtn.addEventListener('click', function () {
    saveTonightDirtyAdjustments('preserve');
  });
  sleepSaveTargetBtn.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    saveTonightDirtyAdjustments('preserve');
  });
  sleepSaveGuidedBtn.addEventListener('click', function () {
    if (typeof getTonightGuidanceSleepEnabled === 'function' && getTonightGuidanceSleepEnabled()) return;
    saveTonightDirtyAdjustments('enable');
  });
  sleepSaveGuidedBtn.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    if (typeof getTonightGuidanceSleepEnabled === 'function' && getTonightGuidanceSleepEnabled()) return;
    saveTonightDirtyAdjustments('enable');
  });
  sleepUndoBtn.addEventListener('click', function () {
    revertPoleToCommitted('sleep');
  });
  sleepUndoBtn.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    revertPoleToCommitted('sleep');
  });
  wakeSaveTargetBtn.addEventListener('click', function () {
    saveTonightDirtyAdjustments('preserve');
  });
  wakeSaveTargetBtn.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    saveTonightDirtyAdjustments('preserve');
  });
  wakeSaveGuidedBtn.addEventListener('click', function () {
    if (typeof getTonightGuidanceWakeEnabled === 'function' && getTonightGuidanceWakeEnabled()) return;
    saveTonightDirtyAdjustments('enable');
  });
  wakeSaveGuidedBtn.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    if (typeof getTonightGuidanceWakeEnabled === 'function' && getTonightGuidanceWakeEnabled()) return;
    saveTonightDirtyAdjustments('enable');
  });
  wakeUndoBtn.addEventListener('click', function () {
    revertPoleToCommitted('wake');
  });
  wakeUndoBtn.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    revertPoleToCommitted('wake');
  });

  function bindMinuteStep(btn, pole, delta) {
    btn.addEventListener('mousedown', function (e) {
      e.stopPropagation();
    });
    btn.addEventListener('click', function () {
      const mergeDirty =
        pole === 'sleep'
          ? modMinutes1440(state.sleepClock) !== modMinutes1440(base.committedSleep)
          : modMinutes1440(state.wakeClock) !== modMinutes1440(base.committedWake);
      if (!mergeDirty) return;
      applyPoleMinuteDelta(pole, delta);
    });
  }
  bindMinuteStep(sleepMinusBtn, 'sleep', -1);
  bindMinuteStep(sleepPlusBtn, 'sleep', 1);
  bindMinuteStep(wakeMinusBtn, 'wake', -1);
  bindMinuteStep(wakePlusBtn, 'wake', 1);

  sliderOverlay.addEventListener('mousedown', onPointerDown);
  var tonightPointerTouchStartOpts = { passive: false };
  sliderOverlay.addEventListener('touchstart', onPointerDown, tonightPointerTouchStartOpts);
  document.addEventListener('mousemove', onPointerMove);
  var tonightPointerTouchMoveOpts = { passive: false };
  document.addEventListener('touchmove', onPointerMove, tonightPointerTouchMoveOpts);
  document.addEventListener('mouseup', onPointerUp);
  document.addEventListener('touchend', onPointerUp);
  document.addEventListener('touchcancel', onPointerUp);

  window.__dashboardTonightAdjusterTeardown = function () {
    document.removeEventListener('mousemove', onPointerMove);
    document.removeEventListener('touchmove', onPointerMove, tonightPointerTouchMoveOpts);
    document.removeEventListener('mouseup', onPointerUp);
    document.removeEventListener('touchend', onPointerUp);
    document.removeEventListener('touchcancel', onPointerUp);
    sliderOverlay.removeEventListener('mousedown', onPointerDown);
    sliderOverlay.removeEventListener('touchstart', onPointerDown, tonightPointerTouchStartOpts);
    onPointerUp();
  };

  applySliderBoundsFromBase();
  updateVisualState(false);
  requestAnimationFrame(function () {
    updateVisualState(false);
  });
}

// Render dashboard content: projection, recent average, lifetime average, recent nightlies (timeline rows), sleep quality history.
// Used by dashboard.html; kept here to share calculation/render helpers.
function renderDashboardContent(days) {
  const quickActionsHtml = renderQuickActionsSection();

  if (!days || days.length === 0) {
    return `
    <div class="dashboard-content">
      ${quickActionsHtml}
      <p class="dashboard-empty-msg">No sleep data yet.</p>
    </div>`;
  }

  const recentDays = days.slice(0, Math.min(7, days.length));
  const recentAverages = calculateAverages(recentDays);
  const flagMap = buildFlagCountMap(days);
  const latestDataDate = getLatestDataDate(days);
  const dashboardYear = getAppDate().getFullYear();
  const calendarBlockOnly = renderCalendarCurrentMonthOnlyBlock(dashboardYear, flagMap, latestDataDate);

  const recentNightsCount = Math.min(3, days.length);
  const recentNightsHtml = recentNightsCount > 0
    ? `
    <h2 class="dashboard-section-title"><a class="dashboard-section-title__link" href="${restoreMpaHref('tab.timeline')}"><span class="dashboard-section-title__emoji" aria-hidden="true">⏱️</span> Recent timelines</a></h2>
    <section class="dashboard-past-nights">
      <div class="week-days">
        ${Array.from({ length: recentNightsCount }, (_, i) => renderDay(days[i], days, i, { showTicks: true })).join('')}
      </div>
    </section>
    `
    : '';

  const sevenDaySectionHtml = `
    <h2 class="dashboard-section-title"><a class="dashboard-section-title__link" href="${restoreMpaHref('tab.charts')}"><span class="dashboard-section-title__emoji" aria-hidden="true">📊</span> Recent charts</a></h2>
    <div class="dashboard-7d-row">
      <div class="dashboard-7d-col">
        <div class="dashboard-7d-time-stack">
          <div>
            <h3 class="dashboard-7d-subtitle dashboard-7d-subtitle--skp-time">
              <a class="dashboard-7d-subtitle__link" href="${restoreMpaHref('charts.bedAsleepWake')}">Bed &amp; sleep start</a>
            </h3>
            <div class="dashboard-7d-graph-container" id="dashboard-7d-bed-sleep-graph"></div>
          </div>
          <div>
            <h3 class="dashboard-7d-subtitle dashboard-7d-subtitle--skp-wake">
              <a class="dashboard-7d-subtitle__link" href="${restoreMpaHref('charts.bedAsleepWake')}">Wake time</a>
            </h3>
            <div class="dashboard-7d-graph-container" id="dashboard-7d-wake-graph"></div>
          </div>
        </div>
      </div>
      <div class="dashboard-7d-col">
        <h3 class="dashboard-7d-subtitle dashboard-7d-subtitle--skp-sleep">
          <a class="dashboard-7d-subtitle__link" href="${restoreMpaHref('charts.sleepDuration')}">Total sleep time</a>
        </h3>
        <div class="dashboard-7d-graph-container" id="dashboard-7d-duration-graph"></div>
      </div>
    </div>
  `;

  return `
    <div class="dashboard-content">
      ${quickActionsHtml}
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
  document.querySelectorAll('.day-flags-content').forEach(el => {
    el.classList.toggle('hidden', !show);
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

// Nightly timeline page: mount / unmount on #timeline-section — see docs/lifecycle-contract.md
// initDeviationFlagChips() below is an app singleton (document-level); not tied to timeline mount.
(function () {
  var nightlyTimelineMountGen = 0;
  /** @type {HTMLElement | null} */
  var nightlyTimelineSection = null;
  /** @type {AbortController | null} */
  var nightlyTimelineAbort = null;
  var nightlyTimelineStoreUnsubscribe = null;

  function renderNightlyTimelineFromData(sectionRoot, sig, sleepData) {
    var daysContainer = sectionRoot.querySelector('#days-container');
    var legendControlsEl = sectionRoot.querySelector('#timeline-legend-controls');
    if (!daysContainer) return;
    if (legendControlsEl) legendControlsEl.innerHTML = renderTimelineLegendControls();

    var weeks = groupDaysByWeek((sleepData && sleepData.days) || []);
    daysContainer.innerHTML = weeks.map(function (week, index) {
      return renderWeek(week, index, (sleepData && sleepData.days) || []);
    }).join('');

    document.querySelectorAll('.week-header').forEach(function (header) {
      header.addEventListener(
        'click',
        function () {
          var weekId = header.getAttribute('data-week-id');
          toggleWeek(weekId);
        },
        { signal: sig }
      );
    });

    function setupCheckbox(id, toggleFn) {
      var checkbox = document.getElementById(id);
      if (checkbox) {
        checkbox.addEventListener(
          'change',
          function (e) {
            toggleFn(e.target.checked);
          },
          { signal: sig }
        );
        toggleFn(checkbox.checked);
      }
    }
    setupCheckbox('show-time-ticks', toggleTimeTicks);
    setupCheckbox('show-daily-details', toggleDailyDetails);
    setupCheckbox('show-flags', toggleFlags);
  }

  function mountNightlyTimeline(sectionRoot, _ctx) {
    if (!sectionRoot) return;
    nightlyTimelineMountGen++;
    var g = nightlyTimelineMountGen;
    nightlyTimelineSection = sectionRoot;
    if (nightlyTimelineAbort) {
      try {
        nightlyTimelineAbort.abort();
      } catch (e) {
        /* ignore */
      }
      nightlyTimelineAbort = null;
    }
    nightlyTimelineAbort = new AbortController();
    var sig = nightlyTimelineAbort.signal;

    var daysContainer = sectionRoot.querySelector('#days-container');
    var legendControlsEl = sectionRoot.querySelector('#timeline-legend-controls');
    if (!daysContainer) return;

    if (legendControlsEl) legendControlsEl.innerHTML = '';
    daysContainer.innerHTML = '';

    if (nightlyTimelineStoreUnsubscribe) {
      nightlyTimelineStoreUnsubscribe();
      nightlyTimelineStoreUnsubscribe = null;
    }
    var store = window.__restoreSleepDataStore;
    if (store && typeof store.subscribe === 'function') {
      nightlyTimelineStoreUnsubscribe = store.subscribe(function (snapshot) {
        if (g !== nightlyTimelineMountGen || nightlyTimelineSection !== sectionRoot) return;
        if (snapshot && snapshot.data) {
          if (legendControlsEl) legendControlsEl.innerHTML = '';
          daysContainer.innerHTML = '';
          renderNightlyTimelineFromData(sectionRoot, sig, snapshot.data);
        }
      });
    }

    var loadPromise = store && typeof store.ensureLoaded === 'function'
      ? store.ensureLoaded()
      : loadSleepData();
    loadPromise
      .then(function (sleepData) {
        if (g !== nightlyTimelineMountGen || nightlyTimelineSection !== sectionRoot) return;
        renderNightlyTimelineFromData(sectionRoot, sig, sleepData);
      })
      .catch(function (error) {
        console.error('Error loading data:', error);
        if (g !== nightlyTimelineMountGen || nightlyTimelineSection !== sectionRoot) return;
        daysContainer.innerHTML = '<p>Error loading data</p>';
      });
  }

  function unmountNightlyTimeline() {
    nightlyTimelineMountGen++;
    if (nightlyTimelineStoreUnsubscribe) {
      nightlyTimelineStoreUnsubscribe();
      nightlyTimelineStoreUnsubscribe = null;
    }
    if (nightlyTimelineAbort) {
      try {
        nightlyTimelineAbort.abort();
      } catch (e) {
        /* ignore */
      }
      nightlyTimelineAbort = null;
    }
    if (nightlyTimelineSection) {
      var leg = nightlyTimelineSection.querySelector('#timeline-legend-controls');
      var days = nightlyTimelineSection.querySelector('#days-container');
      if (leg) leg.innerHTML = '';
      if (days) days.innerHTML = '';
    }
    nightlyTimelineSection = null;
  }

  window.__restoreNightlyTimelineLifecycle = {
    mount: mountNightlyTimeline,
    unmount: unmountNightlyTimeline,
  };
})();

initDeviationFlagChips();
