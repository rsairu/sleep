// Sleep statistics: period-scoped matrix (see stats-aggregates.js for shared helpers).

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

  monthDays.forEach(function (day) {
    const bedTime = timeToMinutes(day.bed);
    bedTimeSum += normalizeTimeForAveraging(bedTime);

    const sleepStart = timeToMinutes(day.sleepStart);
    sleepStartSum += normalizeTimeForAveraging(sleepStart);

    const sleepEnd = timeToMinutes(day.sleepEnd);
    sleepEndSum += normalizeWakeTimeForAveraging(sleepStart, sleepEnd);

    bedToSleepDelaySum += calculateBedToSleepDelay(day);
    longestUninterruptedSum += calculateLongestUninterrupted(day);

    const firstAlarmToWake = calculateFirstAlarmToWake(day);
    if (firstAlarmToWake !== null) {
      firstAlarmToWakeSum += firstAlarmToWake;
      firstAlarmToWakeCount++;
    }

    sleepDurationSum += calculateTotalSleep(day);

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
  const avgFirstAlarmToWake =
    firstAlarmToWakeCount > 0 ? Math.round(firstAlarmToWakeSum / firstAlarmToWakeCount) : null;
  const avgSleepDuration = Math.round(sleepDurationSum / monthDays.length);
  const avgNapDuration = napCount > 0 ? Math.round(napDurationSum / napCount) : null;

  const napFrequency = napCount / monthDays.length;
  const napFrequencyText =
    napFrequency > 0 ? 'once per ' + Math.round(1 / napFrequency) + ' days' : 'no naps';

  let earliestBed = null;
  let latestBed = null;
  let earliestSleep = null;
  let latestSleep = null;
  let earliestWake = null;
  let earliestWakeSleepStart = null;
  let latestWake = null;
  let latestWakeSleepStart = null;

  monthDays.forEach(function (day) {
    const bedTime = timeToMinutes(day.bed);
    const sleepStart = timeToMinutes(day.sleepStart);
    const sleepEnd = timeToMinutes(day.sleepEnd);

    const normalizedBed = normalizeTimeForComparison(bedTime);
    const normalizedSleep = normalizeTimeForComparison(sleepStart);
    const normalizedWake = normalizeWakeTimeForAveraging(sleepStart, sleepEnd);

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

    if (
      earliestWake === null ||
      normalizedWake < normalizeWakeTimeForAveraging(earliestWakeSleepStart, earliestWake)
    ) {
      earliestWake = sleepEnd;
      earliestWakeSleepStart = sleepStart;
    }
    if (
      latestWake === null ||
      normalizedWake > normalizeWakeTimeForAveraging(latestWakeSleepStart, latestWake)
    ) {
      latestWake = sleepEnd;
      latestWakeSleepStart = sleepStart;
    }
  });

  return {
    avgBedTime: avgBedTime,
    avgSleepStart: avgSleepStart,
    avgSleepEnd: avgSleepEnd,
    avgBedToSleepDelay: avgBedToSleepDelay,
    avgLongestUninterrupted: avgLongestUninterrupted,
    avgFirstAlarmToWake: avgFirstAlarmToWake,
    avgSleepDuration: avgSleepDuration,
    avgNapDuration: avgNapDuration,
    napFrequency: napFrequency,
    napFrequencyText: napFrequencyText,
    napCount: napCount,
    totalDays: monthDays.length,
    earliestBed: earliestBed,
    latestBed: latestBed,
    earliestSleep: earliestSleep,
    latestSleep: latestSleep,
    earliestWake: earliestWake,
    latestWake: latestWake
  };
}

function formatSignedDurationStats(minutes) {
  if (minutes === null || minutes === undefined) return '—';
  return minutes < 0 ? '-' + formatDuration(-minutes) : formatDuration(minutes);
}

function dashCell(text) {
  return text === null || text === undefined || text === '' ? '—' : text;
}

function nightlyTotalSleepBounds(days) {
  if (!days || !days.length) return { min: null, max: null };
  let minM = Infinity;
  let maxM = -Infinity;
  for (let i = 0; i < days.length; i++) {
    const t = calculateTotalSleep(days[i]);
    if (!Number.isFinite(t)) continue;
    if (t < minM) minM = t;
    if (t > maxM) maxM = t;
  }
  if (minM === Infinity) return { min: null, max: null };
  return { min: minM, max: maxM };
}

function columnExtras(days) {
  if (!days.length) {
    return {
      sumTotalSleep: null,
      sumNap: null,
      naturalWakePct: null,
      avgMidSleep: null,
      longestNightly: null,
      shortestNightly: null
    };
  }
  let sumTotal = 0;
  let sumNap = 0;
  let natural = 0;
  for (let i = 0; i < days.length; i++) {
    sumTotal += calculateTotalSleep(days[i]);
    const n = calculateNapDuration(days[i]);
    if (n !== null) sumNap += n;
    if (isNaturalWakeDay(days[i])) natural++;
  }
  const bounds = nightlyTotalSleepBounds(days);
  return {
    sumTotalSleep: sumTotal,
    sumNap: sumNap,
    naturalWakePct: (natural / days.length) * 100,
    avgMidSleep: StatsAggregates.averageMidSleepClockMinutes(days),
    longestNightly: bounds.max,
    shortestNightly: bounds.min
  };
}

function formatTotalSleepCell(ex) {
  if (ex.sumTotalSleep === null) return '—';
  const total = formatDuration(ex.sumTotalSleep);
  if (ex.sumNap > 0) {
    return total + ' <span class="stats-matrix-sub">(' + formatDuration(ex.sumNap) + ' nap)</span>';
  }
  return total;
}

function formatNapCell(av) {
  if (!av) return '—';
  if (av.avgNapDuration !== null) {
    return formatDuration(av.avgNapDuration) + ', ' + av.napFrequencyText;
  }
  return av.napFrequencyText;
}

/** `which` — 'earliest' | 'latest': clock times only (no bed/sleep/wake labels). */
function ultimatesTimesOnly(av, which) {
  if (!av) return '—';
  const bed = which === 'latest' ? av.latestBed : av.earliestBed;
  const sleep = which === 'latest' ? av.latestSleep : av.earliestSleep;
  const wake = which === 'latest' ? av.latestWake : av.earliestWake;
  return (
    '<div class="stats-matrix-times-only">' +
    '<div>' +
    formatTime(bed) +
    '</div>' +
    '<div>' +
    formatTime(sleep) +
    '</div>' +
    '<div>' +
    formatTime(wake) +
    '</div></div>'
  );
}

function ultimateKeysHeaderTh(title) {
  return (
    '<th scope="row" class="stats-matrix-ultimate-th">' +
    '<div class="stats-matrix-ultimate-title">' +
    escapeHtml(title) +
    '</div>' +
    '<div class="stats-matrix-ultimate-keys" aria-hidden="true">' +
    '<div><span class="keyword bed">Bed</span></div>' +
    '<div><span class="keyword sleep">Sleep</span></div>' +
    '<div><span class="keyword wake">Wake</span></div>' +
    '</div></th>'
  );
}

function buildColumnBundle(days) {
  if (!days.length) {
    return { av: null, ex: columnExtras([]) };
  }
  return {
    av: calculateMonthlyAverages(days),
    ex: columnExtras(days)
  };
}

function renderStatsMatrix(periodDays) {
  const split = StatsAggregates.splitAllWorkFree(periodDays);
  const colAll = buildColumnBundle(split.all);
  const colWork = buildColumnBundle(split.work);
  const colFree = buildColumnBundle(split.free);

  const social = StatsAggregates.socialLagMinutes(split.work, split.free);
  const wakeLag = StatsAggregates.wakeLagMinutes(periodDays);

  const TOOLTIP_SOCIAL =
    'How much the middle of your sleep shifts between workdays and free days (weekends and holidays). A bigger gap often means your weekday schedule and your days off are asking your body for different sleep times.';
  const TOOLTIP_WAKE =
    'Compares mornings with an alarm to mornings without one. A positive value means you tend to wake later on your own than when the alarm gets you up.';

  const rows = [];

  function section(title) {
    rows.push(
      '<tr class="stats-matrix-section"><th colspan="4" scope="colgroup">' +
        escapeHtml(title) +
        '</th></tr>'
    );
  }

  function metricRow(labelHtml, a, w, f) {
    rows.push(
      '<tr class="stats-matrix-metric">' +
        '<th scope="row">' +
        labelHtml +
        '</th>' +
        '<td class="stats-matrix-cell">' +
        a +
        '</td>' +
        '<td class="stats-matrix-cell">' +
        w +
        '</td>' +
        '<td class="stats-matrix-cell">' +
        f +
        '</td></tr>'
    );
  }

  function ultimateRow(kind, colA, colW, colF) {
    const title = kind === 'latest' ? 'Latest' : 'Earliest';
    rows.push(
      '<tr class="stats-matrix-metric">' +
        ultimateKeysHeaderTh(title) +
        '<td class="stats-matrix-cell">' +
        (colA.av ? ultimatesTimesOnly(colA.av, kind) : '—') +
        '</td>' +
        '<td class="stats-matrix-cell">' +
        (colW.av ? ultimatesTimesOnly(colW.av, kind) : '—') +
        '</td>' +
        '<td class="stats-matrix-cell">' +
        (colF.av ? ultimatesTimesOnly(colF.av, kind) : '—') +
        '</td></tr>'
    );
  }

  section('Sleep Duration');
  metricRow(
    'Total <span class="keyword sleep">sleep</span>',
    colAll.ex.sumTotalSleep === null ? '—' : formatTotalSleepCell(colAll.ex),
    colWork.ex.sumTotalSleep === null ? '—' : formatTotalSleepCell(colWork.ex),
    colFree.ex.sumTotalSleep === null ? '—' : formatTotalSleepCell(colFree.ex)
  );
  metricRow(
    'Average <span class="keyword sleep">sleep</span> duration',
    dashCell(colAll.av ? formatDuration(colAll.av.avgSleepDuration) : null),
    dashCell(colWork.av ? formatDuration(colWork.av.avgSleepDuration) : null),
    dashCell(colFree.av ? formatDuration(colFree.av.avgSleepDuration) : null)
  );
  metricRow(
    'Average <span class="keyword nap">nap</span>',
    dashCell(colAll.av ? formatNapCell(colAll.av) : null),
    dashCell(colWork.av ? formatNapCell(colWork.av) : null),
    dashCell(colFree.av ? formatNapCell(colFree.av) : null)
  );
  metricRow(
    'Longest <span class="keyword sleep">sleep</span> (one night)',
    dashCell(
      colAll.ex.longestNightly !== null ? formatDuration(colAll.ex.longestNightly) : null
    ),
    dashCell(
      colWork.ex.longestNightly !== null ? formatDuration(colWork.ex.longestNightly) : null
    ),
    dashCell(
      colFree.ex.longestNightly !== null ? formatDuration(colFree.ex.longestNightly) : null
    )
  );
  metricRow(
    'Shortest <span class="keyword sleep">sleep</span> (one night)',
    dashCell(
      colAll.ex.shortestNightly !== null ? formatDuration(colAll.ex.shortestNightly) : null
    ),
    dashCell(
      colWork.ex.shortestNightly !== null ? formatDuration(colWork.ex.shortestNightly) : null
    ),
    dashCell(
      colFree.ex.shortestNightly !== null ? formatDuration(colFree.ex.shortestNightly) : null
    )
  );

  section('Uninterrupted');
  metricRow(
    'Longest uninterrupted <span class="keyword sleep">sleep</span> (avg)',
    dashCell(colAll.av ? formatDuration(colAll.av.avgLongestUninterrupted) : null),
    dashCell(colWork.av ? formatDuration(colWork.av.avgLongestUninterrupted) : null),
    dashCell(colFree.av ? formatDuration(colFree.av.avgLongestUninterrupted) : null)
  );

  section('Natural Wake');
  function pctCell(ex) {
    if (ex.naturalWakePct === null) return '—';
    return Math.round(ex.naturalWakePct) + '%';
  }
  metricRow(
    'Natural wake %',
    pctCell(colAll.ex),
    pctCell(colWork.ex),
    pctCell(colFree.ex)
  );

  section('Timing');
  metricRow(
    'Time to <span class="keyword bed">bed</span>',
    dashCell(colAll.av ? formatTime(colAll.av.avgBedTime) : null),
    dashCell(colWork.av ? formatTime(colWork.av.avgBedTime) : null),
    dashCell(colFree.av ? formatTime(colFree.av.avgBedTime) : null)
  );
  metricRow(
    'Fell <span class="keyword asleep">asleep</span>',
    dashCell(colAll.av ? formatTime(colAll.av.avgSleepStart) : null),
    dashCell(colWork.av ? formatTime(colWork.av.avgSleepStart) : null),
    dashCell(colFree.av ? formatTime(colFree.av.avgSleepStart) : null)
  );
  metricRow(
    'Time to <span class="keyword wake">wake</span>',
    dashCell(colAll.av ? formatTime(colAll.av.avgSleepEnd) : null),
    dashCell(colWork.av ? formatTime(colWork.av.avgSleepEnd) : null),
    dashCell(colFree.av ? formatTime(colFree.av.avgSleepEnd) : null)
  );
  metricRow(
    'Mid-sleep time',
    dashCell(colAll.ex.avgMidSleep !== null ? formatTime(colAll.ex.avgMidSleep) : null),
    dashCell(colWork.ex.avgMidSleep !== null ? formatTime(colWork.ex.avgMidSleep) : null),
    dashCell(colFree.ex.avgMidSleep !== null ? formatTime(colFree.ex.avgMidSleep) : null)
  );

  section('Delays');
  metricRow(
    '<span class="keyword sleep">Sleep</span> delay',
    dashCell(colAll.av ? formatDuration(colAll.av.avgBedToSleepDelay) : null),
    dashCell(colWork.av ? formatDuration(colWork.av.avgBedToSleepDelay) : null),
    dashCell(colFree.av ? formatDuration(colFree.av.avgBedToSleepDelay) : null)
  );
  metricRow(
    '<span class="keyword wake">Wake</span> delay',
    dashCell(colAll.av ? formatSignedDurationStats(colAll.av.avgFirstAlarmToWake) : null),
    dashCell(colWork.av ? formatSignedDurationStats(colWork.av.avgFirstAlarmToWake) : null),
    dashCell(colFree.av ? formatSignedDurationStats(colFree.av.avgFirstAlarmToWake) : null)
  );

  section('Lags');
  rows.push(
    '<tr class="stats-matrix-metric stats-matrix-lag-row">' +
      '<th scope="row"><span class="stats-matrix-lag-label" title="' +
      escapeHtml(TOOLTIP_SOCIAL) +
      '">Social lag</span></th>' +
      '<td class="stats-matrix-cell stats-matrix-lag-value" colspan="3">' +
      (social === null ? '—' : formatDuration(social)) +
      '</td></tr>'
  );
  rows.push(
    '<tr class="stats-matrix-metric stats-matrix-lag-row">' +
      '<th scope="row"><span class="stats-matrix-lag-label" title="' +
      escapeHtml(TOOLTIP_WAKE) +
      '">Wake lag</span></th>' +
      '<td class="stats-matrix-cell stats-matrix-lag-value" colspan="3">' +
      (wakeLag === null ? '—' : formatSignedDurationStats(wakeLag)) +
      '</td></tr>'
  );

  section('Ultimates');
  ultimateRow('earliest', colAll, colWork, colFree);
  ultimateRow('latest', colAll, colWork, colFree);

  return (
    '<div class="stats-matrix-panel">' +
      '<table class="stats-matrix-table">' +
      '<thead><tr>' +
      '<th class="stats-matrix-corner"></th>' +
      '<th scope="col">All days</th>' +
      '<th scope="col">Work days</th>' +
      '<th scope="col">Free days</th>' +
      '</tr></thead><tbody>' +
      rows.join('') +
      '</tbody></table></div>'
  );
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderPeriodScopeBar() {
  const el = document.getElementById('stats-period-scope');
  if (!el) return;
  el.innerHTML =
    '<div class="stats-period-scope__inner">' +
    '<label class="stats-period-scope__label" for="stats-period-select">Time period</label>' +
    '<select id="stats-period-select" class="stats-period-select" aria-label="Time period for statistics">' +
    '<option value="7">Past 7 days</option>' +
    '<option value="30">Past 30 days</option>' +
    '<option value="90">Past 90 days</option>' +
    '<option value="year">This year</option>' +
    '</select></div>';
}

function getStatsEndDate() {
  return typeof getAppDate === 'function' ? getAppDate() : new Date();
}

function renderStatsPage(allDays) {
  const container = document.getElementById('stats-container');
  const select = document.getElementById('stats-period-select');
  if (!container || !select) return;

  const periodKey = select.value || '7';
  const end = getStatsEndDate();
  const periodDays = StatsAggregates.filterDaysByPeriod(allDays, periodKey, end);

  if (!periodDays.length) {
    container.innerHTML =
      '<p class="stats-matrix-empty">No sleep data in this period. Choose another range or add nights.</p>';
    return;
  }

  container.innerHTML = renderStatsMatrix(periodDays);
}

function initStatsPageWithData(allDays) {
  renderPeriodScopeBar();
  const select = document.getElementById('stats-period-select');
  if (select) {
    select.addEventListener('change', function () {
      renderStatsPage(allDays);
    });
  }
  renderStatsPage(allDays);
}

Promise.all([loadSleepData()])
  .then(function (results) {
    const data = results[0];
    const days = (data && data.days) || [];
    initStatsPageWithData(days);
  })
  .catch(function (error) {
    console.error('Error loading data:', error);
    const c = document.getElementById('stats-container');
    if (c) c.innerHTML = '<p>Error loading data</p>';
  });
