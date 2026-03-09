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

// Project repo (used in nav bar)
const GITHUB_REPO_URL = 'https://github.com/rsairu/sleep/';

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

  const githubIcon = `<svg class="nav-github-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>`;
  const githubLink = `<a href="${GITHUB_REPO_URL}" class="nav-github-link" target="_blank" rel="noopener noreferrer" title="View on GitHub">${githubIcon}</a>`;

  return `<div class="nav-bar"><div class="nav-tabs">${navItems}</div>${githubLink}</div>`;
}