// Sleep statistics: period-scoped matrix (see stats-aggregates.js for shared helpers).
// Lifecycle (SPA prep): mount / unmount on #stats-page-root — see docs/lifecycle-contract.md

function calculateMonthlyAverages(monthDays) {
  if (monthDays.length === 0) {
    return null;
  }

  let bedTimeSum = 0;
  let sleepStartSum = 0;
  let sleepEndSum = 0;
  let sleepLagSum = 0;
  let longestUninterruptedSum = 0;
  let wakeLagSum = 0;
  let wakeLagCount = 0;
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

    sleepLagSum += sleepLagMin(day);
    longestUninterruptedSum += calculateLongestUninterrupted(day);

    const wakeLag = wakeLagMin(day);
    if (wakeLag !== null) {
      wakeLagSum += wakeLag;
      wakeLagCount++;
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
  const avgSleepLag = Math.round(sleepLagSum / monthDays.length);
  const avgLongestUninterrupted = Math.round(longestUninterruptedSum / monthDays.length);
  const avgWakeLag = wakeLagCount > 0 ? Math.round(wakeLagSum / wakeLagCount) : null;
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
    avgSleepLag: avgSleepLag,
    avgLongestUninterrupted: avgLongestUninterrupted,
    avgWakeLag: avgWakeLag,
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
      sumSleepLag: null,
      sumWakeLag: null,
      avgMidSleep: null,
      longestNightly: null,
      shortestNightly: null
    };
  }
  let sumTotal = 0;
  let sumNap = 0;
  let natural = 0;
  let sumSleepLag = 0;
  let sumWakeLag = 0;
  let wakeLagNights = 0;
  for (let i = 0; i < days.length; i++) {
    sumTotal += calculateTotalSleep(days[i]);
    const n = calculateNapDuration(days[i]);
    if (n !== null) sumNap += n;
    const wake = classifyWake(days[i]);
    if (wake.natural) natural++;
    if (wake.wakeLagMin !== null) {
      sumWakeLag += wake.wakeLagMin;
      wakeLagNights++;
    }
    sumSleepLag += sleepLagMin(days[i]);
  }
  const bounds = nightlyTotalSleepBounds(days);
  return {
    sumTotalSleep: sumTotal,
    sumNap: sumNap,
    naturalWakePct: (natural / days.length) * 100,
    sumSleepLag: sumSleepLag,
    sumWakeLag: wakeLagNights > 0 ? sumWakeLag : null,
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

// x̄ is drawn as "x" + CSS overline: the combining macron (U+0304) renders as a separate glyph in many fonts.
const STATS_SYM_AVG =
  '<span class="stats-matrix-sym" aria-label="average"><span class="stats-matrix-xbar" aria-hidden="true">x</span></span>';
const STATS_SYM_SUM = '<span class="stats-matrix-sym" aria-label="total">Σ</span>';
const STATS_SYM_PCT = '<span class="stats-matrix-sym" aria-label="percent">%</span>';
const STATS_SYM_NONE = '<span class="stats-matrix-sym" aria-hidden="true"></span>';

function statsKeyword(kind, text) {
  return '<span class="keyword ' + kind + '">' + escapeHtml(text) + '</span>';
}

function renderStatsMatrix(periodDays) {
  const split = StatsAggregates.splitAllWorkFree(periodDays);
  const colAll = buildColumnBundle(split.all);
  const colWork = buildColumnBundle(split.work);
  const colFree = buildColumnBundle(split.free);
  const cols = [colAll, colWork, colFree];

  const social = StatsAggregates.socialLagMinutes(split.work, split.free);

  const TOOLTIP_SOCIAL =
    'How far the middle of your sleep shifts between work days and free days (weekends and holidays). This is the MCTQ social jetlag measure. A bigger gap means your weekday and day-off rhythms are pulling apart.';

  const rows = [];

  /** `titleHtml` is trusted markup (may carry a keyword span). */
  function section(titleHtml) {
    rows.push(
      '<tr class="stats-matrix-section"><th colspan="4" scope="colgroup">' +
        titleHtml +
        '</th></tr>'
    );
  }

  function labelTh(symHtml, labelHtml, tooltip) {
    return (
      '<th scope="row">' +
      symHtml +
      (tooltip
        ? '<span class="stats-matrix-label" title="' + escapeHtml(tooltip) + '">' + labelHtml + '</span>'
        : '<span class="stats-matrix-label">' + labelHtml + '</span>') +
      '</th>'
    );
  }

  function metricRow(symHtml, labelHtml, a, w, f, tooltip) {
    rows.push(
      '<tr class="stats-matrix-metric stats-matrix-metric--sym">' +
        labelTh(symHtml, labelHtml, tooltip) +
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

  /** One row from a per-column formatter `(bundle) => string|null`. */
  function colRow(symHtml, labelHtml, fmt, tooltip) {
    const cells = cols.map(function (c) {
      return dashCell(fmt(c));
    });
    metricRow(symHtml, labelHtml, cells[0], cells[1], cells[2], tooltip);
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

  function avDuration(field) {
    return function (c) {
      return c.av ? formatDuration(c.av[field]) : null;
    };
  }
  function avTime(field) {
    return function (c) {
      return c.av ? formatTime(c.av[field]) : null;
    };
  }
  function exDuration(field) {
    return function (c) {
      return c.ex[field] !== null ? formatDuration(c.ex[field]) : null;
    };
  }

  // ----- Sleep -----
  section(statsKeyword('sleep', 'Sleep'));
  colRow(
    STATS_SYM_SUM,
    statsKeyword('sleep', 'Sleep') + ' (duration)',
    function (c) {
      return c.ex.sumTotalSleep === null ? null : formatTotalSleepCell(c.ex);
    },
    'All sleep in this period, naps included.'
  );
  colRow(
    STATS_SYM_AVG,
    statsKeyword('sleep', 'Sleep') + ' (duration)',
    avDuration('avgSleepDuration'),
    'Average sleep per night.'
  );
  colRow(
    STATS_SYM_AVG,
    statsKeyword('nap', 'Nap'),
    function (c) {
      return c.av ? formatNapCell(c.av) : null;
    },
    'Average nap length and how often you nap.'
  );
  colRow(
    STATS_SYM_NONE,
    'Longest ' + statsKeyword('sleep', 'sleep') + ' (one night)',
    exDuration('longestNightly'),
    'Your longest single night in this period.'
  );
  colRow(
    STATS_SYM_NONE,
    'Shortest ' + statsKeyword('sleep', 'sleep') + ' (one night)',
    exDuration('shortestNightly'),
    'Your shortest single night in this period.'
  );
  colRow(
    STATS_SYM_AVG,
    'Uninterrupted ' + statsKeyword('sleep', 'sleep'),
    avDuration('avgLongestUninterrupted'),
    'Your longest unbroken stretch each night, averaged.'
  );
  colRow(
    STATS_SYM_AVG,
    statsKeyword('bed', 'Bed') + ' (time)',
    avTime('avgBedTime'),
    'When you went to bed, on average.'
  );
  colRow(
    STATS_SYM_AVG,
    statsKeyword('sleep', 'Sleep') + ' (time)',
    avTime('avgSleepStart'),
    'When you fell asleep, on average.'
  );
  colRow(
    STATS_SYM_AVG,
    statsKeyword('bed', 'Sleep lag'),
    avDuration('avgSleepLag'),
    'Time in bed before falling asleep, on average.'
  );
  colRow(
    STATS_SYM_SUM,
    statsKeyword('bed', 'Sleep lag'),
    exDuration('sumSleepLag'),
    'All time in bed before falling asleep, added up for this period.'
  );
  colRow(
    STATS_SYM_AVG,
    statsKeyword('sleep', 'Mid-sleep'),
    function (c) {
      return c.ex.avgMidSleep !== null ? formatTime(c.ex.avgMidSleep) : null;
    },
    'Halfway between falling asleep and waking, on average.'
  );
  rows.push(
    '<tr class="stats-matrix-metric stats-matrix-metric--sym stats-matrix-lag-row">' +
      labelTh(STATS_SYM_NONE, 'Social lag', TOOLTIP_SOCIAL) +
      '<td class="stats-matrix-cell stats-matrix-lag-value" colspan="3">' +
      (social === null ? '—' : formatDuration(social)) +
      '</td></tr>'
  );

  // ----- Wake -----
  section(statsKeyword('wake', 'Wake'));
  colRow(
    STATS_SYM_AVG,
    statsKeyword('wake', 'Wake') + ' (time)',
    avTime('avgSleepEnd'),
    'When you woke up, on average.'
  );
  colRow(
    STATS_SYM_PCT,
    statsKeyword('wake', 'Natural wake'),
    function (c) {
      return c.ex.naturalWakePct === null ? null : Math.round(c.ex.naturalWakePct) + '%';
    },
    'Mornings you woke on your own: no alarm, or before the first one.'
  );
  colRow(
    STATS_SYM_AVG,
    statsKeyword('wake', 'Wake lag') + ' (snooze)',
    function (c) {
      return c.av ? formatSignedDurationStats(c.av.avgWakeLag) : null;
    },
    'Time from your first alarm to waking, on mornings with an alarm. Negative when you woke before it.'
  );
  colRow(
    STATS_SYM_SUM,
    statsKeyword('wake', 'Wake lag') + ' (snooze)',
    function (c) {
      return formatSignedDurationStats(c.ex.sumWakeLag);
    },
    'Wake lag added up for this period. Early wakes subtract.'
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

// Lifecycle (SPA prep): mount / unmount on #stats-page-root — see docs/lifecycle-contract.md
let statsMountGeneration = 0;
/** @type {HTMLElement | null} */
let statsMountedRoot = null;
/** @type {AbortController | null} */
let statsLifecycleController = null;
let statsStoreUnsubscribe = null;

function initStatsPageWithData(allDays) {
  renderPeriodScopeBar();
  const select = document.getElementById('stats-period-select');
  const listenOpts = statsLifecycleController ? { signal: statsLifecycleController.signal } : {};
  if (select) {
    select.addEventListener(
      'change',
      function () {
        renderStatsPage(allDays);
      },
      listenOpts
    );
  }
  renderStatsPage(allDays);
}

function startStatsPageLoad(gen) {
  const store = window.__restoreSleepDataStore;
  const loadPromise = store && typeof store.ensureLoaded === 'function'
    ? store.ensureLoaded()
    : loadSleepData();
  loadPromise
    .then(function (data) {
      if (gen !== statsMountGeneration || statsMountedRoot == null) return;
      if (statsLifecycleController) {
        try {
          statsLifecycleController.abort();
        } catch (e) {
          /* ignore */
        }
        statsLifecycleController = null;
      }
      statsLifecycleController = new AbortController();
      const snap = store && typeof store.getSnapshot === 'function' ? store.getSnapshot() : null;
      const days = snap && snap.data ? snap.data.days || [] : (data && data.days) || [];
      initStatsPageWithData(days);
    })
    .catch(function (error) {
      console.error('Error loading data:', error);
      if (gen !== statsMountGeneration || statsMountedRoot == null) return;
      const c = document.getElementById('stats-container');
      if (c) c.innerHTML = '<p>Error loading data</p>';
    });
}

/**
 * @param {HTMLElement} root
 * @param {Record<string, unknown>} [_ctx]
 */
function mountStatsPage(root, _ctx) {
  if (!root) return;
  if (statsLifecycleController) {
    try {
      statsLifecycleController.abort();
    } catch (e) {
      /* ignore */
    }
    statsLifecycleController = null;
  }
  statsMountGeneration++;
  const gen = statsMountGeneration;
  statsMountedRoot = root;
  if (statsStoreUnsubscribe) {
    statsStoreUnsubscribe();
    statsStoreUnsubscribe = null;
  }
  const scopeEl = root.querySelector('#stats-period-scope');
  const matrix = root.querySelector('#stats-container');
  if (scopeEl) scopeEl.innerHTML = '';
  if (matrix) matrix.innerHTML = '';
  const store = window.__restoreSleepDataStore;
  if (store && typeof store.subscribe === 'function') {
    statsStoreUnsubscribe = store.subscribe(function (snapshot) {
      if (gen !== statsMountGeneration || statsMountedRoot == null) return;
      if (!snapshot || !snapshot.data) return;
      initStatsPageWithData(snapshot.data.days || []);
    });
  }
  void startStatsPageLoad(gen);
}

function unmountStatsPage() {
  statsMountGeneration++;
  if (statsStoreUnsubscribe) {
    statsStoreUnsubscribe();
    statsStoreUnsubscribe = null;
  }
  if (statsLifecycleController) {
    try {
      statsLifecycleController.abort();
    } catch (e) {
      /* ignore */
    }
    statsLifecycleController = null;
  }
  if (statsMountedRoot) {
    const scopeEl = statsMountedRoot.querySelector('#stats-period-scope');
    const matrix = statsMountedRoot.querySelector('#stats-container');
    if (scopeEl) scopeEl.innerHTML = '';
    if (matrix) matrix.innerHTML = '';
  }
  statsMountedRoot = null;
}

window.__restoreStatsLifecycle = {
  mount: mountStatsPage,
  unmount: unmountStatsPage,
};
