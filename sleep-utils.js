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
function isWeekend(dateOrString, year = 2026, holidays = null) {
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

// Render navigation bar
function renderNavBar(currentPage) {
  const pages = [
    { id: 'dashboard', name: 'Dashboard', url: 'dashboard.html', icon: '🛌' },
    { id: 'timeline', name: 'Daily Timeline', url: 'sleep.html', icon: '📅' },
    { id: 'graph', name: 'Graphs', url: 'graph.html', icon: '📊' },
    { id: 'stats', name: 'Stats', url: 'stats.html', icon: '🔢' }
  ];
  
  const navItems = pages.map(page => {
    const isActive = page.id === currentPage;
    return `<a href="${page.url}" class="nav-tab ${isActive ? 'active' : ''}"><span class="nav-icon">${page.icon}</span> ${page.name}</a>`;
  }).join('');
  
  return `<div class="nav-bar">${navItems}</div>`;
}