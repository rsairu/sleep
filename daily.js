// Configuration constants
const YEAR = 2026;
const ALARM_TO_WAKE_WARNING_THRESHOLD = 60; // minutes
const DEVIATION_FLAG_THRESHOLD = 20; // minutes - flags only show if deviation is >= this
const WAKE_DEVIATION_FLAG_THRESHOLD = 30; // minutes - wake-up time deviation (display only, does not affect sleep quality)
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

// Calculate recent averages for deviation detection (excluding current day)
function calculateRecentAverages(days, currentIndex, lookbackDays = 7) {
  // Get recent days excluding the current day
  const startIndex = Math.max(0, currentIndex + 1);
  const endIndex = Math.min(days.length, currentIndex + 1 + lookbackDays);
  const recentDays = days.slice(startIndex, endIndex);
  
  if (recentDays.length === 0) {
    return null;
  }
  
  let bedTimeSum = 0;
  let fellAsleepTimeSum = 0;
  let wakeTimeSum = 0;
  let sleepDurationSum = 0;
  
  recentDays.forEach(day => {
    // Normalize bed time before averaging to handle times that cross midnight
    const bedTime = timeToMinutes(day.bed);
    const normalizedBedTime = normalizeTimeForComparison(bedTime);
    bedTimeSum += normalizedBedTime;
    
    // Normalize fell asleep before averaging to handle times that cross midnight
    const fellAsleepTime = timeToMinutes(day.sleepStart);
    const normalizedFellAsleepTime = normalizeTimeForAveraging(fellAsleepTime);
    fellAsleepTimeSum += normalizedFellAsleepTime;
    
    const wakeTime = timeToMinutes(day.sleepEnd);
    wakeTimeSum += normalizeTimeForAveraging(wakeTime);
    
    sleepDurationSum += calculateTotalSleep(day);
  });
  
  return {
    avgBedTime: bedTimeSum / recentDays.length, // This is normalized
    avgFellAsleepTime: fellAsleepTimeSum / recentDays.length, // This is normalized
    avgWakeTime: wakeTimeSum / recentDays.length, // Normalized for comparison
    avgSleepDuration: sleepDurationSum / recentDays.length
  };
}

// Check for deviations and return warning messages
function checkDeviations(day, recentAverages) {
  if (!recentAverages) return [];
  
  const warnings = [];
  
  // Check bed time (later than average)
  const bedTime = timeToMinutes(day.bed);
  const normalizedBedTime = normalizeTimeForComparison(bedTime);
  // avgBedTime is already normalized from calculateRecentAverages
  if (normalizedBedTime > recentAverages.avgBedTime) {
    const diff = normalizedBedTime - recentAverages.avgBedTime;
    if (diff >= DEVIATION_FLAG_THRESHOLD) {
      warnings.push(`⚠️🛌 <strong>Bed Time</strong>: ${formatDuration(Math.round(diff))} later than recent average`);
    }
  }
  
  // Check fell asleep (later than average)
  const fellAsleepTime = timeToMinutes(day.sleepStart);
  const normalizedFellAsleepTime = normalizeTimeForAveraging(fellAsleepTime);
  // avgFellAsleepTime is already normalized from calculateRecentAverages
  if (normalizedFellAsleepTime > recentAverages.avgFellAsleepTime) {
    const diff = normalizedFellAsleepTime - recentAverages.avgFellAsleepTime;
    if (diff >= DEVIATION_FLAG_THRESHOLD) {
      warnings.push(`⚠️😴 <strong>Asleep</strong>: ${formatDuration(Math.round(diff))} later than recent average`);
    }
  }
  
  // Check sleep duration (shorter than average)
  const sleepDuration = calculateTotalSleep(day);
  if (sleepDuration < recentAverages.avgSleepDuration) {
    const diff = recentAverages.avgSleepDuration - sleepDuration;
    if (diff >= DEVIATION_FLAG_THRESHOLD) {
      warnings.push(`⚠️⌛ <strong>Duration</strong>: ${formatDuration(Math.round(diff))} shorter than recent average`);
    }
  }
  
  // Check wake-up time deviation (earlier or later than average; display only, does not affect sleep quality)
  const wakeTime = timeToMinutes(day.sleepEnd);
  const normalizedWakeTime = normalizeTimeForAveraging(wakeTime);
  const wakeDiff = Math.abs(normalizedWakeTime - recentAverages.avgWakeTime);
  if (wakeDiff >= WAKE_DEVIATION_FLAG_THRESHOLD) {
    const later = normalizedWakeTime > recentAverages.avgWakeTime;
    warnings.push(`⚠️🌅 <strong>Wake</strong>: ${formatDuration(Math.round(wakeDiff))} ${later ? 'later' : 'earlier'} than recent average`);
  }
  
  return warnings;
}

// Check for deviations and return flag types with icons
function getFlagTypes(day, recentAverages) {
  if (!recentAverages) return [];
  
  const flagTypes = [];
  
  // Check bed time (later than average)
  const bedTime = timeToMinutes(day.bed);
  const normalizedBedTime = normalizeTimeForComparison(bedTime);
  if (normalizedBedTime > recentAverages.avgBedTime) {
    const diff = normalizedBedTime - recentAverages.avgBedTime;
    if (diff >= DEVIATION_FLAG_THRESHOLD) {
      flagTypes.push('🛌');
    }
  }
  
  // Check fell asleep (later than average)
  const fellAsleepTime = timeToMinutes(day.sleepStart);
  const normalizedFellAsleepTime = normalizeTimeForAveraging(fellAsleepTime);
  if (normalizedFellAsleepTime > recentAverages.avgFellAsleepTime) {
    const diff = normalizedFellAsleepTime - recentAverages.avgFellAsleepTime;
    if (diff >= DEVIATION_FLAG_THRESHOLD) {
      flagTypes.push('😴');
    }
  }
  
  // Check sleep duration (shorter than average)
  const sleepDuration = calculateTotalSleep(day);
  if (sleepDuration < recentAverages.avgSleepDuration) {
    const diff = recentAverages.avgSleepDuration - sleepDuration;
    if (diff >= DEVIATION_FLAG_THRESHOLD) {
      flagTypes.push('⌛');
    }
  }
  
  // Check wake-up time deviation (display only, does not affect sleep quality)
  const wakeTime = timeToMinutes(day.sleepEnd);
  const normalizedWakeTime = normalizeTimeForAveraging(wakeTime);
  if (Math.abs(normalizedWakeTime - recentAverages.avgWakeTime) >= WAKE_DEVIATION_FLAG_THRESHOLD) {
    flagTypes.push('🌅');
  }
  
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
    ? `<div class="deviation-warnings">${deviations.map(w => `<div class="deviation-warning">${w}</div>`).join('')}</div>`
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
            <div class="span sleep" style="--start:${sleepStartPos}; --end:${sleepEndPos}" data-tooltip="duration: ${formatDuration(sleepDuration)}"></div>
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
  
  (day.sick || []).forEach(time => {
    const minutes = timeToTimelinePosition(timeToMinutes(time));
    html += `<div class="event sick" style="--m:${minutes}" data-tooltip="${time} sick"></div>`;
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
    sleepStartSum += normalizeTimeForAveraging(timeToMinutes(day.sleepStart));
    sleepEndSum += normalizeTimeForAveraging(timeToMinutes(day.sleepEnd));
  });
  
  return {
    avgBedtime: denormalizeTimeForAveraging(Math.round(sleepStartSum / days.length)),
    avgSleepEnd: denormalizeTimeForAveraging(Math.round(sleepEndSum / days.length)),
    avgSleepDuration: Math.round(sleepDurationSum / days.length),
    avgLongestUninterrupted: Math.round(longestUninterruptedSum / days.length),
    avgFirstAlarmToWake: firstAlarmToWakeCount > 0 ? Math.round(firstAlarmToWakeSum / firstAlarmToWakeCount) : null
  };
}

// Render averages stats HTML (inner content only)
function renderAveragesStats(averages) {
  return `
        <div class="stat-row"><span class="stat-label">${highlightKeyword('asleep:', 'asleep')}</span><span class="stat-value">${formatTime(averages.avgBedtime)}</span></div>
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
  const avgSleepStart = averages.avgBedtime;
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

// Flags that affect sleep quality (heatmap color). Wake deviation is display-only.
const QUALITY_FLAG_TYPES = ['🛌', '😴', '⌛'];

// Count flags for a specific day (quality-affecting only; wake deviation excluded)
function countFlagsForDay(day, days, dayIndex) {
  const flagTypes = getFlagTypesForDay(day, days, dayIndex);
  return flagTypes.filter(t => QUALITY_FLAG_TYPES.includes(t)).length;
}

// Get flag types for a specific day
function getFlagTypesForDay(day, days, dayIndex) {
  const recentAverages = calculateRecentAverages(days, dayIndex);
  return getFlagTypes(day, recentAverages);
}

// Build flag count map for all days
function buildFlagCountMap(days) {
  const flagMap = new Map();
  days.forEach((day, index) => {
    const flagCount = countFlagsForDay(day, days, index);
    const flagTypes = getFlagTypesForDay(day, days, index);
    flagMap.set(day.date, { count: flagCount, types: flagTypes });
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
        const flagData = flagMap.get(dateStr) || { count: 0, types: [] };
        flatDays.push({
          date: date,
          dateStr: dateStr,
          day: day,
          flagCount: flagData.count,
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

    const flagCounts = { '🛌': 0, '😴': 0, '⌛': 0, '🌅': 0 };
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

// Get color class for flag count
function getFlagColorClass(flagCount) {
  if (flagCount === 0) return 'flag-none';
  if (flagCount === 1) return 'flag-one';
  if (flagCount === 2) return 'flag-two';
  return 'flag-three-plus';
}

// Render a single month block (for heatmap). large: true adds --large class for 2x size on dashboard.
function renderMonthBlock(month, large) {
  const flagSlots = [
    { emoji: '🛌', count: month.flagCounts['🛌'] },
    { emoji: '😴', count: month.flagCounts['😴'] },
    { emoji: '⌛', count: month.flagCounts['⌛'] },
    { emoji: '🌅', count: month.flagCounts['🌅'] }
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
              const colorClass = getFlagColorClass(day.flagCount);
              const hasAnyFlags = day.flagTypes && day.flagTypes.length > 0;
              const tooltip = hasAnyFlags
                ? `${day.dateStr}: ${day.flagTypes.join(' ')}`
                : `${day.dateStr}: normal`;
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
          <span class="legend-label">normal</span>
          <div class="legend-colors">
            <div class="legend-square flag-none"></div>
            <div class="legend-square flag-one"></div>
            <div class="legend-square flag-two"></div>
            <div class="legend-square flag-three-plus"></div>
          </div>
          <span class="legend-label">worse</span>
        </div>
        <span class="legend-divider">·</span>
        <div class="legend-meaning legend-meaning--inline">
          <span class="legend-meaning-item">🛌 bed late</span>
          <span class="legend-meaning-item">😴 asleep late</span>
          <span class="legend-meaning-item">⌛ short</span>
          <span class="legend-meaning-item">🌅 wake deviation</span>
        </div>
        <span class="legend-explanation legend-explanation--inline">(vs 7-day avg; bed/asleep/duration 20+ min, wake 30+ min; 🌅 display only)</span>
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

/** Returns { phase, icon, timeLabel } for remaining wake time (used by dashboard nav). */
function getRemainingWakeDisplay(recentAverages) {
  const sleepTarget = recentAverages.avgBedtime;
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const remainingMins = sleepTarget >= nowMins
    ? sleepTarget - nowMins
    : 1440 - nowMins + sleepTarget;
  const phase = getRemainingWakePhase(remainingMins, sleepTarget);
  const icon = getRemainingWakeIcon(phase);
  const timeLabel = formatDuration(Math.round(remainingMins));
  return { phase, icon, timeLabel };
}

function renderDashboardProjection(recentAverages) {
  const sleepByLow = Math.max(0, recentAverages.avgBedtime - PROJECTION_BAND_MINUTES);
  const sleepByHigh = Math.min(1440, recentAverages.avgBedtime + PROJECTION_BAND_MINUTES);
  const wakeByLow = Math.max(0, recentAverages.avgSleepEnd - WAKE_PROJECTION_BAND_MINUTES);
  const wakeByHigh = Math.min(1440, recentAverages.avgSleepEnd + WAKE_PROJECTION_BAND_MINUTES);

  const sleepTarget = recentAverages.avgBedtime;
  const wakeTarget = recentAverages.avgSleepEnd;
  const recommendedDurationMins = wakeTarget >= sleepTarget
    ? wakeTarget - sleepTarget
    : 1440 - sleepTarget + wakeTarget;

  return `
    <div class="dashboard-projection">
      <h2 class="dashboard-projection-title">Tonight</h2>
      <div class="dashboard-projection-grid">
        <div class="dashboard-projection-item">
          <span class="dashboard-projection-label"><span class="proj-keyword proj-sleep">🌙 Sleep</span></span>
          <div class="dashboard-projection-row">
            <span class="dashboard-projection-bounds">${formatTime(sleepByLow)}</span>
            <span class="dashboard-projection-sep">—</span>
            <span class="dashboard-projection-target">${formatTime(sleepTarget)}</span>
            <span class="dashboard-projection-sep">—</span>
            <span class="dashboard-projection-bounds">${formatTime(sleepByHigh)}</span>
          </div>
        </div>
        <div class="dashboard-projection-item dashboard-projection-item--wake">
          <span class="dashboard-projection-label"><span class="proj-keyword proj-wake">🌅 Wake</span></span>
          <div class="dashboard-projection-row">
            <span class="dashboard-projection-bounds">${formatTime(wakeByLow)}</span>
            <span class="dashboard-projection-sep">—</span>
            <span class="dashboard-projection-target">${formatTime(wakeTarget)}</span>
            <span class="dashboard-projection-sep">—</span>
            <span class="dashboard-projection-bounds">${formatTime(wakeByHigh)}</span>
          </div>
        </div>
      </div>
      <p class="dashboard-projection-duration">(~${formatDuration(recommendedDurationMins)} sleep)</p>
    </div>
  `;
}

// Render dashboard content: projection, recent average, lifetime average, recent nights (timeline rows), sleep quality history.
// Used by dashboard.html; kept here to share calculation/render helpers.
function renderDashboardContent(days) {
  if (!days || days.length === 0) {
    return '<p>No sleep data yet.</p>';
  }
  const recentDays = days.slice(0, Math.min(7, days.length));
  const recentAverages = calculateAverages(recentDays);

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
        <div class="dashboard-7d-graph-container" id="dashboard-7d-time-graph"></div>
      </div>
      <div class="dashboard-7d-col">
        <div class="dashboard-7d-graph-container" id="dashboard-7d-duration-graph"></div>
      </div>
    </div>
  `;

  return `
    <div class="dashboard-content">
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

// Render timeline legend and show/hide controls (placed next to weekly timelines)
function renderTimelineLegendControls() {
  return `
    <div class="timeline-legend-controls">
      <div class="legend">
        <span class="sleep">sleep</span>
        <span class="nap">nap</span>
        <span class="bed">bed</span>
        <span class="alarm">alarm</span>
        <span class="sick">sick</span>
        <span class="bath">bathroom</span>
        <span class="up">get up</span>
      </div>
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
  fetch(DATA_FILES.sleep).then(response => response.json())
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
