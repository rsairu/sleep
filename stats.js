// Sleep statistics calculations

// Group days by month
function groupDaysByMonth(days) {
  const months = new Map();
  
  days.forEach(day => {
    const [month] = parseDateString(day.date);
    
    if (!months.has(month)) {
      months.set(month, []);
    }
    months.get(month).push(day);
  });
  
  // Convert to array and sort by month (descending - most recent first)
  return Array.from(months.entries())
    .map(([month, days]) => ({ month, days }))
    .sort((a, b) => b.month - a.month);
}

// Calculate monthly averages
function calculateMonthlyAverages(monthDays) {
  if (monthDays.length === 0) {
    return null;
  }
  
  let bedTimeSum = 0;
  let sleepStartSum = 0;
  let sleepEndSum = 0;
  let bedToSleepDelaySum = 0;
  let longestUninterruptedSum = 0;
  let firstAlarmToWakeSum = 0;
  let firstAlarmToWakeCount = 0;
  let sleepDurationSum = 0;
  let napDurationSum = 0;
  let napCount = 0;
  
  monthDays.forEach(day => {
    // Bed time - normalize for averaging
    const bedTime = timeToMinutes(day.bed);
    bedTimeSum += normalizeTimeForAveraging(bedTime);
    
    // Sleep start time - normalize for averaging
    const sleepStart = timeToMinutes(day.sleepStart);
    sleepStartSum += normalizeTimeForAveraging(sleepStart);
    
    // Sleep end (wake-up) time - normalize for averaging
    // Wake-up times should be normalized based on sleep start time
    // If wake-up is before sleep start, it's definitely next day (add 1440)
    // If sleep start is late (after 18:00), wake-up is likely next day (add 1440)
    // If sleep start is very early (before 6:00 AM) and wake-up is after 10:00 AM, it's likely next day
    // Otherwise, use standard normalization (before noon = next day)
    const sleepEnd = timeToMinutes(day.sleepEnd);
    let normalizedSleepEnd;
    if (sleepEnd < sleepStart) {
      // Wake-up is before sleep start, definitely next day
      normalizedSleepEnd = sleepEnd + 1440;
    } else if (sleepStart >= 1080) {
      // Sleep start is at/after 18:00 (1080 minutes), wake-up is likely next day
      normalizedSleepEnd = sleepEnd + 1440;
    } else if (sleepStart < 360 && sleepEnd >= 600) {
      // Sleep start is before 6:00 AM (360 minutes) and wake-up is at/after 10:00 AM (600 minutes)
      // This indicates sleep started very early and wake-up is next day
      normalizedSleepEnd = sleepEnd + 1440;
    } else {
      // Use standard normalization (before noon = next day)
      normalizedSleepEnd = normalizeTimeForAveraging(sleepEnd);
    }
    sleepEndSum += normalizedSleepEnd;
    
    // Bed-to-sleep delay
    bedToSleepDelaySum += calculateBedToSleepDelay(day);
    
    // Longest uninterrupted sleep
    longestUninterruptedSum += calculateLongestUninterrupted(day);
    
    // Alarm to wake
    const firstAlarmToWake = calculateFirstAlarmToWake(day);
    if (firstAlarmToWake !== null) {
      firstAlarmToWakeSum += firstAlarmToWake;
      firstAlarmToWakeCount++;
    }
    
    // Sleep duration
    sleepDurationSum += calculateTotalSleep(day);
    
    // Nap duration
    const napDuration = calculateNapDuration(day);
    if (napDuration !== null) {
      napDurationSum += napDuration;
      napCount++;
    }
  });
  
  const avgBedTime = denormalizeTimeForAveraging(Math.round(bedTimeSum / monthDays.length));
  const avgSleepStart = denormalizeTimeForAveraging(Math.round(sleepStartSum / monthDays.length));
  const avgSleepEnd = denormalizeTimeForAveraging(Math.round(sleepEndSum / monthDays.length));
  const avgBedToSleepDelay = Math.round(bedToSleepDelaySum / monthDays.length);
  const avgLongestUninterrupted = Math.round(longestUninterruptedSum / monthDays.length);
  const avgFirstAlarmToWake = firstAlarmToWakeCount > 0 
    ? Math.round(firstAlarmToWakeSum / firstAlarmToWakeCount) 
    : null;
  const avgSleepDuration = Math.round(sleepDurationSum / monthDays.length);
  const avgNapDuration = napCount > 0 ? Math.round(napDurationSum / napCount) : null;
  
  // Nap frequency: days with naps / total days
  const napFrequency = napCount / monthDays.length;
  // Convert to "once per X days" format
  const napFrequencyText = napFrequency > 0 
    ? `once per ${Math.round(1 / napFrequency)} days` 
    : 'no naps';
  
  // Calculate ultimates (earliest/latest times)
  let earliestBed = null;
  let latestBed = null;
  let earliestSleep = null;
  let latestSleep = null;
  let earliestWake = null;
  let latestWake = null;
  
  monthDays.forEach(day => {
    const bedTime = timeToMinutes(day.bed);
    const sleepStart = timeToMinutes(day.sleepStart);
    const sleepEnd = timeToMinutes(day.sleepEnd);
    
    // Normalize times for comparison (to handle midnight crossover)
    const normalizedBed = normalizeTimeForComparison(bedTime);
    const normalizedSleep = normalizeTimeForComparison(sleepStart);
    const normalizedWake = normalizeTimeForComparison(sleepEnd);
    
    // Track earliest/latest (using normalized values for comparison)
    if (earliestBed === null || normalizedBed < normalizeTimeForComparison(earliestBed)) {
      earliestBed = bedTime;
    }
    if (latestBed === null || normalizedBed > normalizeTimeForComparison(latestBed)) {
      latestBed = bedTime;
    }
    
    if (earliestSleep === null || normalizedSleep < normalizeTimeForComparison(earliestSleep)) {
      earliestSleep = sleepStart;
    }
    if (latestSleep === null || normalizedSleep > normalizeTimeForComparison(latestSleep)) {
      latestSleep = sleepStart;
    }
    
    if (earliestWake === null || normalizedWake < normalizeTimeForComparison(earliestWake)) {
      earliestWake = sleepEnd;
    }
    if (latestWake === null || normalizedWake > normalizeTimeForComparison(latestWake)) {
      latestWake = sleepEnd;
    }
  });
  
  return {
    avgBedTime,
    avgSleepStart,
    avgSleepEnd,
    avgBedToSleepDelay,
    avgLongestUninterrupted,
    avgFirstAlarmToWake,
    avgSleepDuration,
    avgNapDuration,
    napFrequency,
    napFrequencyText,
    napCount,
    totalDays: monthDays.length,
    earliestBed,
    latestBed,
    earliestSleep,
    latestSleep,
    earliestWake,
    latestWake
  };
}

// Get month name
function getMonthName(monthNumber) {
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return monthNames[monthNumber - 1];
}

// Format delta in human-readable format (e.g., "1 hour and 8 minutes earlier")
function formatDelta(minutes, labelText, lowerIsBetter) {
  const absMinutes = Math.abs(minutes);
  const hours = Math.floor(absMinutes / 60);
  const mins = absMinutes % 60;
  
  let timeStr = '';
  if (hours > 0 && mins > 0) {
    timeStr = `${hours} hour${hours > 1 ? 's' : ''} and ${mins} minute${mins > 1 ? 's' : ''}`;
  } else if (hours > 0) {
    timeStr = `${hours} hour${hours > 1 ? 's' : ''}`;
  } else {
    timeStr = `${mins} minute${mins > 1 ? 's' : ''}`;
  }
  
  // Determine direction text based on stat type
  let direction = '';
  const isPositive = minutes > 0;
  
  if (labelText.includes('Time to bed') || labelText.includes('Fell asleep') || labelText.includes('Time to wake')) {
    // For times: show whether it's earlier or later
    direction = isPositive ? 'later' : 'earlier';
  } else if (labelText.includes('delay')) {
    // For delays: shorter is better
    direction = isPositive ? 'longer' : 'shorter';
  } else if (labelText.includes('sleep duration') || labelText.includes('uninterrupted') || labelText.includes('nap')) {
    // For durations: longer is better
    direction = isPositive ? 'longer' : 'shorter';
  } else {
    // Default: use lowerIsBetter flag
    direction = lowerIsBetter 
      ? (isPositive ? 'more' : 'less')
      : (isPositive ? 'more' : 'less');
  }
  
  return `${timeStr} ${direction}`;
}

// Calculate percentage difference and determine if it's better
// Returns { percentage, isBetter, color, deltaMinutes, deltaText, arrow }
function calculateDifference(current, comparison, lowerIsBetter = false, labelText = '') {
  if (!comparison || comparison === 0) {
    return null;
  }
  
  // Normalize time-based values for comparison (handles midnight crossover)
  const timeBasedStats = ['Time to bed:', 'Fell asleep:', 'Time to wake:'];
  let normalizedCurrent = current;
  let normalizedComparison = comparison;
  
  if (timeBasedStats.includes(labelText)) {
    // Normalize both values for proper comparison across midnight
    normalizedCurrent = normalizeTimeForComparison(current);
    normalizedComparison = normalizeTimeForComparison(comparison);
  }
  
  // Calculate difference using normalized values to get correct direction
  const normalizedDiff = normalizedCurrent - normalizedComparison;
  
  // Calculate percentage
  let percentage;
  if (timeBasedStats.includes(labelText)) {
    // Calculate actual time difference (handle wrap-around)
    let actualDiffMinutes = normalizedDiff;
    if (actualDiffMinutes > 720) actualDiffMinutes -= 1440;
    if (actualDiffMinutes < -720) actualDiffMinutes += 1440;
    
    // Calculate percentage based on 24 hours (1440 minutes) as reference
    percentage = Math.round((Math.abs(actualDiffMinutes) / 1440) * 100);
  } else {
    // For non-time stats, use standard percentage calculation
    percentage = Math.round((Math.abs(normalizedDiff) / Math.abs(comparison || 1)) * 100);
  }
  
  // Determine if change is better based on normalized difference
  const isBetter = lowerIsBetter ? normalizedDiff < 0 : normalizedDiff > 0;
  
  // Calculate delta in minutes for human-readable format
  let deltaMinutes = normalizedDiff;
  if (timeBasedStats.includes(labelText)) {
    // Handle wrap-around for delta
    if (deltaMinutes > 720) deltaMinutes -= 1440;
    if (deltaMinutes < -720) deltaMinutes += 1440;
  }
  
  const deltaText = formatDelta(deltaMinutes, labelText, lowerIsBetter);
  const arrow = isBetter ? '↑' : '↓';
  
  return {
    percentage,
    isBetter,
    color: isBetter ? 'green' : 'red',
    sign: normalizedDiff > 0 ? '+' : '',
    deltaMinutes: Math.abs(deltaMinutes),
    deltaText,
    arrow
  };
}

// Render a stat row with comparison
function renderStatRow(label, keyword, currentValue, comparisonData, lowerIsBetter = false) {
  const comparison = comparisonData ? comparisonData.value : null;
  const diff = comparison ? calculateDifference(currentValue, comparison, lowerIsBetter, label) : null;
  
  let comparisonHtml = '';
  if (comparison && diff) {
    const comparisonDisplay = typeof currentValue === 'number' && currentValue < 1440 
      ? formatTime(comparison)
      : formatDuration(comparison);
    comparisonHtml = `
      <span class="stat-comparison">${comparisonDisplay}</span>
      <span class="stat-diff ${diff.color}"><span class="stat-percentage">${diff.sign}${diff.percentage}%</span> <span class="stat-arrow">${diff.arrow}</span> ${diff.deltaText}</span>
    `;
  }
  
  // Split label to highlight only the keyword
  const keywordLower = keyword.toLowerCase();
  const labelLower = label.toLowerCase();
  const keywordIndex = labelLower.indexOf(keywordLower);
  
  if (keywordIndex === -1) {
    // Fallback if keyword not found
    return `
      <div class="stat-row">
        <span class="stat-label">${label}</span>
        <span class="stat-value">${typeof currentValue === 'number' && currentValue < 1440 ? formatTime(currentValue) : formatDuration(currentValue)}</span>
        ${comparisonHtml}
      </div>
    `;
  }
  
  const beforeKeyword = label.substring(0, keywordIndex);
  const keywordText = label.substring(keywordIndex, keywordIndex + keyword.length);
  const afterKeyword = label.substring(keywordIndex + keyword.length);
  
  return `
    <div class="stat-row">
      <span class="stat-label">${beforeKeyword}<span class="keyword ${keywordLower}">${keywordText}</span>${afterKeyword}</span>
      <span class="stat-value">${typeof currentValue === 'number' && currentValue < 1440 ? formatTime(currentValue) : formatDuration(currentValue)}</span>
      ${comparisonHtml}
    </div>
  `;
}

// Render monthly stats table
function renderMonthlyStats(monthData, allMonthStats, monthIndex) {
  const { month, averages } = monthData;
  
  if (!averages) {
    return '';
  }
  
  // Get available months for comparison (exclude current month)
  const availableMonths = allMonthStats
    .map((m, idx) => ({ month: m.month, name: getMonthName(m.month), index: idx }))
    .filter(m => m.month !== month);
  
  const monthId = `month-${month}`;
  
  return `
    <div class="month-stats" data-month="${month}">
      <div class="month-header">
        <h2>${getMonthName(month)}</h2>
      </div>
      <div class="stats-table" id="${monthId}">
        <div class="comparison-control">
          <label for="comparison-${monthId}" class="comparison-label">Compare to:</label>
          <select id="comparison-${monthId}" class="month-comparison-select" data-month-id="${monthId}" data-month-index="${monthIndex}">
            <option value="">None</option>
            ${availableMonths.map(m => `<option value="${m.index}">${m.name}</option>`).join('')}
          </select>
        </div>
        ${renderStatRow('Time to bed:', 'bed', averages.avgBedTime, null, true)}
        ${renderStatRow('Fell asleep:', 'asleep', averages.avgSleepStart, null, true)}
        ${renderStatRow('Time to wake:', 'wake', averages.avgSleepEnd, null, true)}
        <hr>
        ${renderStatRow('Sleep delay:', 'sleep', averages.avgBedToSleepDelay, null, true)}
        ${averages.avgFirstAlarmToWake !== null ? renderStatRow('Wake delay:', 'wake', averages.avgFirstAlarmToWake, null, true) : ''}
        <hr>
        ${renderStatRow('Average sleep duration:', 'sleep', averages.avgSleepDuration, null, false)}
        ${renderStatRow('Longest uninterrupted:', 'sleep', averages.avgLongestUninterrupted, null, false)}
        ${averages.avgNapDuration !== null ? `
        <div class="stat-row">
          <span class="stat-label">Average <span class="keyword nap">nap</span>:</span>
          <span class="stat-value">${averages.avgNapDuration} minutes, ${averages.napFrequencyText}</span>
        </div>
        ` : `
        <div class="stat-row">
          <span class="stat-label">Average <span class="keyword nap">nap</span>:</span>
          <span class="stat-value">${averages.napFrequencyText}</span>
        </div>
        `}
        <hr>
        <div class="stat-row">
          <span class="stat-label">Earliest:</span>
          <span class="stat-value ultimates-value">
            <span class="ultimate-item"><span class="keyword bed">Bed</span> <span class="ultimate-time">${formatTime(averages.earliestBed)}</span></span>
            <span class="ultimate-item"><span class="keyword sleep">Sleep</span> <span class="ultimate-time">${formatTime(averages.earliestSleep)}</span></span>
            <span class="ultimate-item"><span class="keyword wake">Wake</span> <span class="ultimate-time">${formatTime(averages.earliestWake)}</span></span>
          </span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Latest:</span>
          <span class="stat-value ultimates-value">
            <span class="ultimate-item"><span class="keyword bed">Bed</span> <span class="ultimate-time">${formatTime(averages.latestBed)}</span></span>
            <span class="ultimate-item"><span class="keyword sleep">Sleep</span> <span class="ultimate-time">${formatTime(averages.latestSleep)}</span></span>
            <span class="ultimate-item"><span class="keyword wake">Wake</span> <span class="ultimate-time">${formatTime(averages.latestWake)}</span></span>
          </span>
        </div>
      </div>
    </div>
  `;
}

// Update comparison for a specific month
function updateComparison(monthIndex, comparisonIndex, allMonthStats) {
  const currentMonth = allMonthStats[monthIndex];
  const comparisonMonth = allMonthStats[comparisonIndex];
  
  if (!currentMonth || !comparisonMonth || !currentMonth.averages || !comparisonMonth.averages) {
    return;
  }
  
  const current = currentMonth.averages;
  const comparison = comparisonMonth.averages;
  const monthId = `month-${currentMonth.month}`;
  const statsTable = document.getElementById(monthId);
  
  if (!statsTable) return;
  
  // Define comparison data for each stat
  const comparisons = {
    'Time to bed:': { value: comparison.avgBedTime, lowerIsBetter: true },
    'Fell asleep:': { value: comparison.avgSleepStart, lowerIsBetter: true },
    'Time to wake:': { value: comparison.avgSleepEnd, lowerIsBetter: true },
    'Sleep delay:': { value: comparison.avgBedToSleepDelay, lowerIsBetter: true },
    'Wake delay:': { value: comparison.avgFirstAlarmToWake, lowerIsBetter: true },
    'Longest uninterrupted:': { value: comparison.avgLongestUninterrupted, lowerIsBetter: false },
    'Average sleep duration:': { value: comparison.avgSleepDuration, lowerIsBetter: false },
    'Average nap:': { value: comparison.avgNapDuration, lowerIsBetter: false }
  };
  
  // Map of label text to current value getter
  const labelToCurrentValue = {
    'Time to bed:': () => current.avgBedTime,
    'Fell asleep:': () => current.avgSleepStart,
    'Time to wake:': () => current.avgSleepEnd,
    'Sleep delay:': () => current.avgBedToSleepDelay,
    'Wake delay:': () => current.avgFirstAlarmToWake,
    'Longest uninterrupted:': () => current.avgLongestUninterrupted,
    'Average sleep duration:': () => current.avgSleepDuration,
    'Average nap:': () => current.avgNapDuration
  };
  
  // Update each stat row
  const rows = statsTable.querySelectorAll('.stat-row');
  rows.forEach((row, idx) => {
    const labelElement = row.querySelector('.stat-label');
    if (!labelElement) return;
    
    // Get label text - need to extract it from the text content (ignoring HTML)
    const labelText = labelElement.textContent.trim();
    const comparisonData = comparisons[labelText];
    const getCurrentValue = labelToCurrentValue[labelText];
    
    if (comparisonData && comparisonData.value !== null && comparisonData.value !== undefined && getCurrentValue) {
      // Remove existing comparison elements
      const existingComparison = row.querySelector('.stat-comparison');
      const existingDiff = row.querySelector('.stat-diff');
      if (existingComparison) existingComparison.remove();
      if (existingDiff) existingDiff.remove();
      
      // Get current value directly from averages
      const currentValue = getCurrentValue();
      
      if (currentValue === null || currentValue === undefined) {
        return;
      }
      
      // Use calculateDifference to get all comparison data including delta text and arrow
      const diff = calculateDifference(currentValue, comparisonData.value, comparisonData.lowerIsBetter, labelText);
      
      if (diff) {
        let comparisonDisplay;
        // Special handling for nap duration - always show in minutes
        if (labelText === 'Average nap:') {
          comparisonDisplay = `${comparisonData.value} minutes`;
        } else {
          comparisonDisplay = typeof comparisonData.value === 'number' && comparisonData.value < 1440
            ? formatTime(comparisonData.value)
            : formatDuration(comparisonData.value);
        }
        
        const comparisonSpan = document.createElement('span');
        comparisonSpan.className = 'stat-comparison';
        comparisonSpan.textContent = comparisonDisplay;
        
        const diffSpan = document.createElement('span');
        diffSpan.className = `stat-diff ${diff.color}`;
        diffSpan.innerHTML = `<span class="stat-percentage">${diff.sign}${diff.percentage}%</span> <span class="stat-arrow">${diff.arrow}</span> ${diff.deltaText}`;
        
        const currentValueElement = row.querySelector('.stat-value');
        if (currentValueElement) {
          currentValueElement.after(comparisonSpan, diffSpan);
        }
      }
    }
  });
}

// Load and render stats
Promise.all([
  fetch('sleep-data.json').then(response => response.json())
])
  .then(([data]) => {
    const months = groupDaysByMonth(data.days);
    
    const monthStats = months.map(({ month, days }) => ({
      month,
      averages: calculateMonthlyAverages(days)
    }));
    
    const statsHtml = monthStats.map((monthData, index) => 
      renderMonthlyStats(monthData, monthStats, index)
    ).join('');
    
    const topAveragesHtml = typeof renderStatsTopAverages !== 'undefined'
      ? renderStatsTopAverages(data.days)
      : '';
    document.getElementById('stats-container').innerHTML = topAveragesHtml + statsHtml;
    
    // Set up comparison selectors
    document.querySelectorAll('.month-comparison-select').forEach(select => {
      select.addEventListener('change', (e) => {
        const monthIndex = parseInt(e.target.getAttribute('data-month-index'));
        const comparisonIndex = e.target.value ? parseInt(e.target.value) : null;
        
        if (comparisonIndex !== null) {
          updateComparison(monthIndex, comparisonIndex, monthStats);
        } else {
          // Remove comparison - reload the month stats
          const month = monthStats[monthIndex].month;
          const monthId = `month-${month}`;
          const statsTable = document.getElementById(monthId);
          if (statsTable) {
            // Remove comparison elements
            statsTable.querySelectorAll('.stat-comparison, .stat-diff').forEach(el => el.remove());
          }
        }
      });
    });
  })
  .catch(error => {
    console.error('Error loading data:', error);
    document.getElementById('stats-container').innerHTML = '<p>Error loading data</p>';
  });
