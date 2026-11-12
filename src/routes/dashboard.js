// Dashboard: recent average, lifetime average, recent nights (timeline rows), sleep quality history.
// Uses renderDashboardContent() and shared helpers from nightly.js.
// Includes 7-day graphs: bed/sleep-start and wake time (left column), duration chart (right).
// Requires: time-utils.js (timeToMinutes, formatDuration, formatTime) + sleep-utils.js (getDateFromString, calculateTotalSleep)
//
// Lifecycle (SPA prep): mount / unmount on #dashboard-container — see docs/lifecycle-contract.md

// --- 7-day graph helpers ---
function regressionDegree(pointCount) {
  return Math.min(2, Math.max(0, pointCount - 1));
}

/** For last-7-days charts: most recent day uses two-line "Last" / "night" (see append7DayXAxisTickLabel); else weekday (Mon, …). */
function get7DayAxisLabel(point, index, total) {
  if (index === total - 1) return null;
  const d = new Date(point.date);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return days[d.getDay()];
}

function append7DayXAxisTickLabel(g, ns, x, graphHeight, point, index, total) {
  const label = ns('text');
  label.setAttribute('x', x);
  label.setAttribute('text-anchor', 'middle');
  const weekday = get7DayAxisLabel(point, index, total);
  if (weekday === null) {
    label.setAttribute('class', 'axis-label axis-label--last-night');
    label.setAttribute('y', graphHeight + 10);
    const t1 = ns('tspan');
    t1.setAttribute('x', x);
    t1.textContent = 'Last';
    const t2 = ns('tspan');
    t2.setAttribute('x', x);
    t2.setAttribute('dy', '1em');
    t2.textContent = 'night';
    label.appendChild(t1);
    label.appendChild(t2);
  } else {
    label.setAttribute('class', 'axis-label');
    label.setAttribute('y', graphHeight + 14);
    label.textContent = weekday;
  }
  g.appendChild(label);
}

function buildPoints(days) {
  return days.map(day => {
    const rawBed = timeToMinutes(day.bed);
    const rawSleepStart = timeToMinutes(day.sleepStart);
    const rawGetUp = timeToMinutes(day.sleepEnd);
    const sleepDuration = calculateTotalSleep(day);
    const sleepStart = timeToMinutes(day.sleepStart);
    const sleepEnd = timeToMinutes(day.sleepEnd);
    const mainSleep = sleepEnd >= sleepStart ? sleepEnd - sleepStart : sleepEnd + 1440 - sleepStart;
    let napDuration = 0;
    if (day.nap && day.nap.start && day.nap.end) {
      const ns = timeToMinutes(day.nap.start), ne = timeToMinutes(day.nap.end);
      napDuration = ne >= ns ? ne - ns : ne + 1440 - ns;
    }
    return {
      date: getDateFromString(day.date),
      bedTimeMinutes: normalizeTimeForYAxis(rawBed),
      bedTimeString: day.bed,
      sleepStartMinutes: normalizeTimeForYAxis(rawSleepStart),
      sleepStartString: day.sleepStart,
      getUpMinutes: normalizeTimeForYAxis(rawGetUp),
      getUpString: day.sleepEnd,
      dateString: day.date,
      sleepDurationMinutes: sleepDuration,
      mainSleepMinutes: mainSleep,
      napMinutes: napDuration,
      fragmentation: normalizeFragmentationLevel(day),
      naturalWake: isNoAlarmWakeDay(day)
    };
  });
}

/**
 * Chart point for tonight's unpromoted draft. Only bed / sleep start can exist before wake;
 * missing series are null (getUpMinutes is always null).
 * @param {{ key: string, bed: string, sleepStart: string } | null} pending
 */
function buildTonightPoint(pending) {
  if (!pending || !pending.key) return null;
  const date = getDateFromString(pending.key);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const bedRaw = pending.bed ? timeToMinutes(pending.bed) : NaN;
  const ssRaw = pending.sleepStart ? timeToMinutes(pending.sleepStart) : NaN;
  return {
    isTonight: true,
    date,
    dateString: pending.key,
    bedTimeMinutes: Number.isFinite(bedRaw) ? normalizeTimeForYAxis(bedRaw) : null,
    bedTimeString: pending.bed || '',
    sleepStartMinutes: Number.isFinite(ssRaw) ? normalizeTimeForYAxis(ssRaw) : null,
    sleepStartString: pending.sleepStart || '',
    getUpMinutes: null
  };
}

function tonightSeriesSuffix(key) {
  if (key === 'bedTimeMinutes') return 'bedtime';
  if (key === 'sleepStartMinutes') return 'sleep-start';
  return 'getup';
}

/** SVG width for 7-day dashboard charts: never wider than the container (avoids horizontal micro-scroll). */
function getResponsiveDashboardChartWidth(container, pointCount) {
  const fallbackWidth = Math.max(320, pointCount * 36);
  const cw = container ? Math.floor(container.clientWidth || 0) : 0;
  if (cw > 0) {
    return Math.max(1, cw - 1);
  }
  return fallbackWidth;
}

function timeSeriesLineClass(key) {
  if (key === 'bedTimeMinutes') return { data: 'data-line bedtime', reg: 'regression-line bedtime-regression', point: 'data-point bedtime' };
  if (key === 'sleepStartMinutes') return { data: 'data-line sleep-start', reg: 'regression-line sleep-start-regression', point: 'data-point sleep-start' };
  return { data: 'data-line getup', reg: 'regression-line getup-regression', point: 'data-point getup' };
}

/** Outside-click handlers for day panel; cleared on dashboard unmount */
let dashboardDayPanelDocCloses = [];
function clearDashboardDayPanelDocCloses() {
  dashboardDayPanelDocCloses.forEach((fn) => {
    document.removeEventListener('click', fn);
  });
  dashboardDayPanelDocCloses = [];
  if (typeof hideDayPanel === 'function') hideDayPanel();
}
function scheduleDashboardChartDayPanelOutsideClose(container) {
  setTimeout(() => {
    const dayPanel = document.getElementById('day-panel');
    const close = (e2) => {
      if (dayPanel && !dayPanel.contains(e2.target) && !container.contains(e2.target)) {
        if (typeof hideDayPanel === 'function') hideDayPanel();
        document.removeEventListener('click', close);
        const ix = dashboardDayPanelDocCloses.indexOf(close);
        if (ix !== -1) dashboardDayPanelDocCloses.splice(ix, 1);
      }
    };
    dashboardDayPanelDocCloses.push(close);
    document.addEventListener('click', close);
  }, 0);
}

/**
 * @param {string[]} seriesKeys subset of bedTimeMinutes, sleepStartMinutes, getUpMinutes
 * @param {object | null} [tonightPoint] from buildTonightPoint — adds a "Tonight" column after "Last night".
 *   Series with a value get a dotted connector + hollow point; it is excluded from the trend fit.
 */
function render7DayTimeGraph(container, points, seriesKeys, tonightPoint) {
  if (!points.length) return;
  const keys = Array.isArray(seriesKeys) && seriesKeys.length
    ? seriesKeys
    : ['bedTimeMinutes', 'sleepStartMinutes', 'getUpMinutes'];
  const tonight =
    tonightPoint && tonightPoint.date > points[points.length - 1].date ? tonightPoint : null;
  const tonightKeys = tonight ? keys.filter((k) => Number.isFinite(tonight[k])) : [];
  const margin = { top: 24, right: 40, bottom: 36, left: 48 };
  const width = getResponsiveDashboardChartWidth(container, points.length + (tonight ? 1 : 0));
  const height = 280;
  const graphWidth = width - margin.left - margin.right;
  const graphHeight = height - margin.top - margin.bottom;

  // Dynamic Y range: min/max of selected series only (incl. tonight's values), plus 1 hour on each side
  const allTimes = points.flatMap(p => keys.map(k => p[k]));
  tonightKeys.forEach((k) => allTimes.push(tonight[k]));
  const dataMin = Math.min(...allTimes), dataMax = Math.max(...allTimes);
  const hourPad = 60;
  const finalYMin = Math.floor((dataMin - hourPad) / 60) * 60;
  const finalYMax = Math.ceil((dataMax + hourPad) / 60) * 60;
  const range = Math.max(finalYMax - finalYMin, 120);

  const minDate = points[0].date;
  const maxDate = tonight ? tonight.date : points[points.length - 1].date;
  const dateRange = maxDate - minDate || 1;
  const xScale = (date) => ((date - minDate) / dateRange) * graphWidth;
  const yScale = (minutes) => graphHeight - ((minutes - finalYMin) / range) * graphHeight;

  const yTicks = [];
  for (let m = finalYMin; m <= finalYMax; m += 60) yTicks.push(m);
  if (yTicks.length === 0) yTicks.push(finalYMin, finalYMax);

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('transform', `translate(${margin.left},${margin.top})`);
  svg.appendChild(g);

  const ns = (tag) => document.createElementNS('http://www.w3.org/2000/svg', tag);
  const addLine = (x1, y1, x2, y2, cls) => {
    const line = ns('line');
    line.setAttribute('x1', x1); line.setAttribute('y1', y1);
    line.setAttribute('x2', x2); line.setAttribute('y2', y2);
    if (cls) line.setAttribute('class', cls);
    g.appendChild(line);
  };
  const addText = (x, y, text, anchor = 'middle') => {
    const el = ns('text');
    el.setAttribute('x', x); el.setAttribute('y', y);
    el.setAttribute('class', 'axis-label');
    el.setAttribute('text-anchor', anchor);
    el.textContent = text;
    g.appendChild(el);
  };

  yTicks.forEach(tick => {
    const y = yScale(tick);
    addLine(0, y, graphWidth, y, 'grid-line');
  });

  addLine(0, graphHeight, graphWidth, graphHeight, 'axis');
  addLine(0, 0, 0, graphHeight, 'axis');
  addLine(graphWidth, 0, graphWidth, graphHeight, 'axis');

  // Left Y-axis labels only
  yTicks.forEach(tick => {
    const y = yScale(tick);
    addLine(-5, y, 0, y, 'axis');
    const label = ns('text');
    label.setAttribute('x', -8);
    label.setAttribute('y', y + 4);
    label.setAttribute('class', 'axis-label');
    label.setAttribute('text-anchor', 'end');
    label.textContent = tick >= 1440 ? String(Math.floor((tick - 1440) / 60)).padStart(2, '0') : String(Math.floor(tick / 60)).padStart(2, '0');
    g.appendChild(label);
  });

  points.forEach((point, index) => {
    const x = xScale(point.date);
    const tickLine = ns('line');
    tickLine.setAttribute('x1', x); tickLine.setAttribute('y1', graphHeight);
    tickLine.setAttribute('x2', x); tickLine.setAttribute('y2', graphHeight + 5);
    tickLine.setAttribute('class', 'axis');
    g.appendChild(tickLine);
    append7DayXAxisTickLabel(g, ns, x, graphHeight, point, index, points.length);
  });
  if (tonight) {
    const tx = xScale(tonight.date);
    const tickLine = ns('line');
    tickLine.setAttribute('x1', tx); tickLine.setAttribute('y1', graphHeight);
    tickLine.setAttribute('x2', tx); tickLine.setAttribute('y2', graphHeight + 5);
    tickLine.setAttribute('class', 'axis');
    g.appendChild(tickLine);
    appendTonightXAxisTickLabel(g, ns, tx, graphHeight, tonightKeys.length > 0);
  }

  const path = (pts, key) => {
    let d = '';
    pts.forEach((p, i) => {
      const x = xScale(p.date), y = yScale(p[key]);
      d += (i ? ' L ' : 'M ') + x + ' ' + y;
    });
    return d;
  };

  keys.forEach((key) => {
    const cls = timeSeriesLineClass(key);
    const pathEl = ns('path');
    pathEl.setAttribute('d', path(points, key));
    pathEl.setAttribute('class', cls.data);
    g.appendChild(pathEl);
  });

  // Tonight: dotted connector from last night's point to tonight's (per series that has a value).
  if (tonight) {
    const last = points[points.length - 1];
    tonightKeys.forEach((key) => {
      if (!Number.isFinite(last[key])) return;
      const conn = ns('line');
      conn.setAttribute('x1', xScale(last.date));
      conn.setAttribute('y1', yScale(last[key]));
      conn.setAttribute('x2', xScale(tonight.date));
      conn.setAttribute('y2', yScale(tonight[key]));
      conn.setAttribute('class', `tonight-connector tonight-connector--${tonightSeriesSuffix(key)}`);
      g.appendChild(conn);
    });
  }

  // Match charts page behavior: break get-up line behind no-alarm wake bullseye markers.
  if (keys.includes('getUpMinutes')) {
    const breakMasksG = ns('g');
    breakMasksG.setAttribute('class', 'getup-line-break-masks');
    points.forEach((point) => {
      if (!point.naturalWake) return;
      const mask = ns('circle');
      mask.setAttribute('cx', String(xScale(point.date)));
      mask.setAttribute('cy', String(yScale(point.getUpMinutes)));
      mask.setAttribute('r', '7.5');
      mask.setAttribute('class', 'getup-break-mask');
      breakMasksG.appendChild(mask);
    });
    g.appendChild(breakMasksG);
  }

  const deg = regressionDegree(points.length);
  const regPath = (coeffs, key) => {
    let d = '';
    points.forEach((p, i) => {
      const x = xScale(p.date), y = yScale(evaluatePolynomial(coeffs, i));
      d += (i ? ' L ' : 'M ') + x + ' ' + y;
    });
    return d;
  };
  keys.forEach((key) => {
    const coeffs = polynomialRegression(points.map((_, i) => i), points.map(p => p[key]), deg);
    const cls = timeSeriesLineClass(key);
    const regEl = ns('path');
    regEl.setAttribute('d', regPath(coeffs, key));
    regEl.setAttribute('class', cls.reg);
    regEl.setAttribute('fill', 'none');
    g.appendChild(regEl);
  });

  points.forEach(p => {
    keys.forEach((key) => {
      const x = xScale(p.date);
      const y = yScale(p[key]);

      if (key === 'getUpMinutes' && p.naturalWake) {
        const ng = ns('g');
        ng.setAttribute('class', 'getup-natural-wake-group');

        const ringOuter = ns('circle');
        ringOuter.setAttribute('cx', String(x));
        ringOuter.setAttribute('cy', String(y));
        ringOuter.setAttribute('r', '7.5');
        ringOuter.setAttribute('class', 'getup-natural-ring-outer getup-marker--natural');

        const ringInner = ns('circle');
        ringInner.setAttribute('cx', String(x));
        ringInner.setAttribute('cy', String(y));
        ringInner.setAttribute('r', '5.5');
        ringInner.setAttribute('class', 'getup-natural-ring-inner getup-marker--natural');

        const core = ns('circle');
        core.setAttribute('cx', String(x));
        core.setAttribute('cy', String(y));
        core.setAttribute('r', '3');
        core.setAttribute('class', 'data-point getup getup-point getup-marker--natural getup-natural-core');

        ng.appendChild(ringOuter);
        ng.appendChild(ringInner);
        ng.appendChild(core);
        g.appendChild(ng);
        return;
      }

      const circle = ns('circle');
      circle.setAttribute('cx', x);
      circle.setAttribute('cy', y);
      circle.setAttribute('r', 3);
      if (key === 'getUpMinutes') {
        circle.setAttribute('class', 'data-point getup getup-point getup-marker--alarm');
      } else {
        circle.setAttribute('class', timeSeriesLineClass(key).point);
      }
      g.appendChild(circle);
    });
  });

  // Tonight: hollow points (in progress, not part of the trend fit).
  if (tonight) {
    tonightKeys.forEach((key) => {
      const ring = ns('circle');
      ring.setAttribute('cx', String(xScale(tonight.date)));
      ring.setAttribute('cy', String(yScale(tonight[key])));
      ring.setAttribute('r', '4');
      ring.setAttribute('class', `data-point-tonight data-point-tonight--${tonightSeriesSuffix(key)}`);
      g.appendChild(ring);
    });
  }

  // Invisible tap/click areas per day: tap a day to show daily values popup (same as charts.js)
  const slotCount = points.length + (tonight ? 1 : 0);
  const dayWidth = graphWidth / Math.max(1, slotCount);
  const tonightLeft = tonight ? xScale(tonight.date) - dayWidth / 2 : graphWidth;
  points.forEach((point, index) => {
    const x = xScale(point.date);
    const left = index === 0 ? 0 : x - dayWidth / 2;
    const w = index === 0 ? dayWidth / 2 + x - left
      : index === points.length - 1 ? tonightLeft - left
      : dayWidth;
    const dayRect = ns('rect');
    dayRect.setAttribute('x', left);
    dayRect.setAttribute('y', 0);
    dayRect.setAttribute('width', w);
    dayRect.setAttribute('height', graphHeight);
    dayRect.style.fill = 'transparent';
    dayRect.style.cursor = 'pointer';
    dayRect.style.pointerEvents = 'all';
    dayRect.addEventListener('click', (e) => {
      const rect = container.getBoundingClientRect();
      const clientX = rect.left + margin.left + x;
      const clientY = rect.top + margin.top + graphHeight / 2;
      showDayPanel(point, clientX, clientY);
      scheduleDashboardChartDayPanelOutsideClose(container);
    });
    g.appendChild(dayRect);
  });

  // Tonight slot: hover title only (no day panel — the night is not complete yet).
  if (tonight && tonightKeys.length) {
    const tonightRect = ns('rect');
    tonightRect.setAttribute('x', tonightLeft);
    tonightRect.setAttribute('y', 0);
    tonightRect.setAttribute('width', Math.max(0, graphWidth - tonightLeft));
    tonightRect.setAttribute('height', graphHeight);
    tonightRect.style.fill = 'transparent';
    tonightRect.style.pointerEvents = 'all';
    const title = ns('title');
    title.textContent = formatTonightChartTitle(tonight, tonightKeys);
    tonightRect.appendChild(title);
    g.appendChild(tonightRect);
  }

  container.innerHTML = '';
  container.appendChild(svg);
}

function dashboardT(key, fallback) {
  return typeof t === 'function' ? t(key, fallback) : fallback;
}

/** "Tonight" x-axis label; muted when this chart has no tonight values (e.g. wake chart). */
function appendTonightXAxisTickLabel(g, ns, x, graphHeight, hasValues) {
  const label = ns('text');
  label.setAttribute('x', x);
  label.setAttribute('y', graphHeight + 14);
  label.setAttribute('text-anchor', 'middle');
  label.setAttribute(
    'class',
    hasValues ? 'axis-label axis-label--tonight' : 'axis-label axis-label--tonight axis-label--tonight-empty'
  );
  label.textContent = dashboardT('dashboard.sectionTonight', 'Tonight');
  g.appendChild(label);
}

function formatTonightChartTitle(tonight, tonightKeys) {
  const parts = [];
  if (tonightKeys.includes('bedTimeMinutes') && tonight.bedTimeString) {
    parts.push(`${dashboardT('dashboard.tonight.logged.bed', 'Bed')} ${formatTime(timeToMinutes(tonight.bedTimeString))}`);
  }
  if (tonightKeys.includes('sleepStartMinutes') && tonight.sleepStartString) {
    parts.push(`${dashboardT('dashboard.tonight.logged.asleep', 'Asleep')} ${formatTime(timeToMinutes(tonight.sleepStartString))}`);
  }
  return `${dashboardT('dashboard.sectionTonight', 'Tonight')} (${dashboardT('dashboard.tonight.logged.inProgress', 'in progress')}): ${parts.join(' · ')}`;
}

function render7DayDurationChart(container, points) {
  if (!points.length) return;
  const margin = { top: 24, right: 40, bottom: 36, left: 48 };
  const width = getResponsiveDashboardChartWidth(container, points.length);
  const height = 280;
  const graphWidth = width - margin.left - margin.right;
  const graphHeight = height - margin.top - margin.bottom;
  const slotWidth = graphWidth / Math.max(1, points.length);
  const xScaleByIndex = (index) => slotWidth * (index + 0.5);

  // Dynamic Y range: min/max sleep duration in 7 days plus 1 hour on each side
  const allDurations = points.map(p => p.sleepDurationMinutes);
  const dataMin = Math.min(...allDurations), dataMax = Math.max(...allDurations);
  const hourPad = 60;
  const sleepYMin = Math.floor((dataMin - hourPad) / 60) * 60;
  const sleepYMax = Math.ceil((dataMax + hourPad) / 60) * 60;
  const sleepRange = Math.max(sleepYMax - sleepYMin, 120);
  const sleepYScale = (minutes) => graphHeight - ((minutes - sleepYMin) / sleepRange) * graphHeight;

  const sleepYTicks = [];
  for (let m = sleepYMin; m <= sleepYMax; m += 60) sleepYTicks.push(m);
  if (sleepYTicks.length === 0) sleepYTicks.push(sleepYMin, sleepYMax);

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('transform', `translate(${margin.left},${margin.top})`);
  svg.appendChild(g);

  const ns = (tag) => document.createElementNS('http://www.w3.org/2000/svg', tag);

  sleepYTicks.forEach(tick => {
    const y = sleepYScale(tick);
    const line = ns('line');
    line.setAttribute('x1', 0); line.setAttribute('y1', y);
    line.setAttribute('x2', graphWidth); line.setAttribute('y2', y);
    line.setAttribute('class', 'grid-line');
    g.appendChild(line);
  });

  const addLine = (x1, y1, x2, y2, cls) => {
    const line = ns('line');
    line.setAttribute('x1', x1); line.setAttribute('y1', y1);
    line.setAttribute('x2', x2); line.setAttribute('y2', y2);
    if (cls) line.setAttribute('class', cls);
    g.appendChild(line);
  };
  addLine(0, graphHeight, graphWidth, graphHeight, 'axis');
  addLine(0, 0, 0, graphHeight, 'axis');
  addLine(graphWidth, 0, graphWidth, graphHeight, 'axis');

  // Left Y-axis labels only
  sleepYTicks.forEach(tick => {
    const y = sleepYScale(tick);
    addLine(-5, y, 0, y, 'axis');
    const label = ns('text');
    label.setAttribute('x', -8); label.setAttribute('y', y + 4);
    label.setAttribute('class', 'axis-label'); label.setAttribute('text-anchor', 'end');
    label.textContent = `${tick / 60}h`;
    g.appendChild(label);
  });

  points.forEach((point, index) => {
    const x = xScaleByIndex(index);
    const tickLine = ns('line');
    tickLine.setAttribute('x1', x); tickLine.setAttribute('y1', graphHeight);
    tickLine.setAttribute('x2', x); tickLine.setAttribute('y2', graphHeight + 5);
    tickLine.setAttribute('class', 'axis');
    g.appendChild(tickLine);
    append7DayXAxisTickLabel(g, ns, x, graphHeight, point, index, points.length);
  });

  const tooltip = document.getElementById('tooltip');
  const barWidth = Math.max(2, slotWidth * 0.72);
  points.forEach((point, index) => {
    const x = xScaleByIndex(index);
    const mainSleepBarY = sleepYScale(point.mainSleepMinutes);
    const mainRect = ns('rect');
    mainRect.setAttribute('x', x - barWidth / 2);
    mainRect.setAttribute('y', mainSleepBarY);
    mainRect.setAttribute('width', barWidth);
    mainRect.setAttribute('height', graphHeight - mainSleepBarY);
    mainRect.setAttribute('class', 'sleep-bar');
    mainRect.style.cursor = 'pointer';
    mainRect.addEventListener('mouseenter', () => {
      if (!tooltip) return;
      const napText = point.napMinutes > 0 ? ` (${formatDuration(point.mainSleepMinutes)} + ${formatDuration(point.napMinutes)} nap)` : '';
      tooltip.textContent = `${formatSleepDateMonthDay(point.dateString)}: ${formatDuration(point.sleepDurationMinutes)}${napText}`;
      tooltip.classList.add('visible');
    });
    mainRect.addEventListener('mousemove', (e) => {
      if (tooltip) {
        tooltip.style.left = (e.clientX + 10) + 'px';
        tooltip.style.top = (e.clientY - 10) + 'px';
      }
    });
    mainRect.addEventListener('mouseleave', () => { if (tooltip) tooltip.classList.remove('visible'); });
    mainRect.addEventListener('click', (e) => {
      const rect = container.getBoundingClientRect();
      showDayPanel(point, e.clientX, e.clientY);
      scheduleDashboardChartDayPanelOutsideClose(container);
    });
    g.appendChild(mainRect);
    const mainBarH = graphHeight - mainSleepBarY;
    appendSvgSleepBarFragmentation(g, x - barWidth / 2, mainSleepBarY, barWidth, mainBarH, point.fragmentation);
    if (point.napMinutes > 0) {
      const napBarY = sleepYScale(point.sleepDurationMinutes);
      const napRect = ns('rect');
      napRect.setAttribute('x', x - barWidth / 2);
      napRect.setAttribute('y', napBarY);
      napRect.setAttribute('width', barWidth);
      napRect.setAttribute('height', mainSleepBarY - napBarY);
      napRect.setAttribute('class', 'sleep-bar nap-bar');
      napRect.style.cursor = 'pointer';
      napRect.addEventListener('mouseenter', () => {
        if (tooltip) {
          tooltip.textContent = `${formatSleepDateMonthDay(point.dateString)}: ${formatDuration(point.sleepDurationMinutes)} (${formatDuration(point.mainSleepMinutes)} + ${formatDuration(point.napMinutes)} nap)`;
          tooltip.classList.add('visible');
        }
      });
      napRect.addEventListener('mousemove', (e) => {
        if (tooltip) {
          tooltip.style.left = (e.clientX + 10) + 'px';
          tooltip.style.top = (e.clientY - 10) + 'px';
        }
      });
        napRect.addEventListener('mouseleave', () => { if (tooltip) tooltip.classList.remove('visible'); });
        napRect.addEventListener('click', (e) => {
          showDayPanel(point, e.clientX, e.clientY);
          scheduleDashboardChartDayPanelOutsideClose(container);
        });
        g.appendChild(napRect);
        const napBarH = mainSleepBarY - napBarY;
        appendSvgSleepBarFragmentation(g, x - barWidth / 2, napBarY, barWidth, napBarH, point.fragmentation);
      }
  });

  const sleepReg = polynomialRegression(
    points.map((_, i) => i),
    points.map(p => p.sleepDurationMinutes),
    regressionDegree(points.length)
  );
  let trendD = '';
  points.forEach((p, i) => {
    const x = xScaleByIndex(i), y = sleepYScale(evaluatePolynomial(sleepReg, i));
    trendD += (i ? ' L ' : 'M ') + x + ' ' + y;
  });
  const trendPath = ns('path');
  trendPath.setAttribute('d', trendD);
  trendPath.setAttribute('class', 'regression-line sleep-trend');
  trendPath.setAttribute('fill', 'none');
  g.appendChild(trendPath);

  container.innerHTML = '';
  container.appendChild(svg);
}

function renderDashboard7DayGraphs(days) {
  if (!days || days.length === 0) return;
  const points = buildPoints(days);
  points.sort((a, b) => a.date - b.date);
  const last7 = points.slice(-7);
  if (last7.length === 0) return;
  const bedSleepEl = document.getElementById('dashboard-7d-bed-sleep-graph');
  const wakeEl = document.getElementById('dashboard-7d-wake-graph');
  const durationEl = document.getElementById('dashboard-7d-duration-graph');
  // Tonight column: bed/sleep chart shows the draft values; the stacked wake chart gets an empty
  // Tonight slot so both charts keep the same x columns.
  const tonightPoint = buildTonightPoint(getActiveDashboardPendingNight());
  if (bedSleepEl) render7DayTimeGraph(bedSleepEl, last7, ['bedTimeMinutes', 'sleepStartMinutes'], tonightPoint);
  if (wakeEl) render7DayTimeGraph(wakeEl, last7, ['getUpMinutes'], tonightPoint);
  if (durationEl) render7DayDurationChart(durationEl, last7);
}

// --- Tonight (unpromoted draft) ---
// The store only holds promoted `sleep_days`. Tonight's in-progress night lives in `sleep_day_drafts`
// until bed + sleep start + wake are all present (`promote_draft_if_complete`). The dashboard fetches
// that draft separately and surfaces bed / sleep start only (chart "Tonight" column + Tonight panel).

/** @type {{ key: string, bed: string, sleepStart: string } | null} */
let dashboardPendingNight = null;
let dashboardPendingNightSig = '';
let dashboardPendingNightReq = 0;

function pendingNightTimeOrEmpty(v) {
  const s = v == null ? '' : String(v).trim();
  if (!s) return '';
  return Number.isFinite(timeToMinutes(s)) ? s : '';
}

/**
 * Current night key (ISO wake-date) — the same key bed / sleep quick actions save to
 * (`recordDateMdForSleepPeriod` with the recent-7 average wake).
 */
function getDashboardTonightNightKey(days) {
  if (typeof recordDateMdForSleepPeriod !== 'function' || typeof getAppDate !== 'function') return null;
  const recent = Array.isArray(days) ? days.slice(0, Math.min(7, days.length)) : [];
  let avgWake = 7 * 60;
  if (recent.length) {
    const avg = calculateAverages(recent);
    if (avg && Number.isFinite(avg.avgSleepEnd)) avgWake = avg.avgSleepEnd;
  } else if (typeof QUICK_ADD_FALLBACK_AVERAGES !== 'undefined') {
    avgWake = QUICK_ADD_FALLBACK_AVERAGES.avgSleepEnd;
  }
  const md = recordDateMdForSleepPeriod(getAppDate(), avgWake);
  return md ? normalizeSleepDateKey(md) : null;
}

/** Pending night is only valid while no promoted row holds its key (or anything newer). */
function isDashboardPendingNightKeyOpen(key, days) {
  if (!key) return false;
  const latestPromoted =
    typeof getLatestSleepDayDateKeyFromLoadedDays === 'function'
      ? getLatestSleepDayDateKeyFromLoadedDays(days)
      : null;
  return !latestPromoted || key > latestPromoted;
}

/**
 * Fetch tonight's draft for the current night key. Resolves null when there is no cloud config,
 * no draft, the key is already promoted, or the draft has neither bed nor sleep start.
 */
function fetchDashboardPendingNight(days) {
  const key = getDashboardTonightNightKey(days);
  if (!key || typeof getSleepDraftByDate !== 'function') return Promise.resolve(null);
  if (!isDashboardPendingNightKeyOpen(key, days)) return Promise.resolve(null);
  return getSleepDraftByDate(key)
    .then((draft) => {
      if (!draft) return null;
      const bed = pendingNightTimeOrEmpty(draft.bed);
      const sleepStart = pendingNightTimeOrEmpty(draft.sleepStart);
      if (!bed && !sleepStart) return null;
      return { key, bed, sleepStart };
    })
    .catch(() => null);
}

/** Cached pending night, re-validated against the currently loaded days (drops it once promoted). */
function getActiveDashboardPendingNight() {
  const p = dashboardPendingNight;
  if (!p) return null;
  if (!isDashboardPendingNightKeyOpen(p.key, dashboardCurrentDays)) return null;
  return p;
}

function refreshDashboardPendingNight() {
  const req = ++dashboardPendingNightReq;
  const gen = dashboardMountGeneration;
  return fetchDashboardPendingNight(dashboardCurrentDays).then((pending) => {
    if (req !== dashboardPendingNightReq || gen !== dashboardMountGeneration || !dashboardMountedRoot) return;
    const sig = pending ? `${pending.key}|${pending.bed}|${pending.sleepStart}` : '';
    if (sig === dashboardPendingNightSig) return;
    dashboardPendingNight = pending;
    dashboardPendingNightSig = sig;
    renderDashboard7DayGraphs(dashboardCurrentDays);
    if (typeof window.__dashboardTonightAdjusterRefresh === 'function') {
      window.__dashboardTonightAdjusterRefresh();
    }
  });
}

function resetDashboardPendingNight() {
  dashboardPendingNightReq++;
  dashboardPendingNight = null;
  dashboardPendingNightSig = '';
}

let dashboardResizeRenderBound = false;
/** @type {(() => void) | null} */
let dashboardResizeHandler = null;
let dashboardCurrentDays = [];

let dashboardMountGeneration = 0;
/** @type {HTMLElement | null} */
let dashboardMountedRoot = null;
/** @type {(() => void) | null} */
let dashboardTonightGuidanceHandler = null;
let dashboardStoreUnsubscribe = null;
/** @type {AbortController | null} */
let dashboardCalendarFlagAbort = null;

function bindDashboardResponsiveRerender() {
  if (dashboardResizeRenderBound) return;
  dashboardResizeRenderBound = true;
  let resizeTimer = null;
  dashboardResizeHandler = () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      renderDashboard7DayGraphs(dashboardCurrentDays);
    }, 120);
  };
  window.addEventListener('resize', dashboardResizeHandler);
}

function unbindDashboardResponsiveRerender() {
  if (dashboardResizeHandler) {
    window.removeEventListener('resize', dashboardResizeHandler);
    dashboardResizeHandler = null;
  }
  dashboardResizeRenderBound = false;
}

function renderDashboardFromData(sleepData) {
  const root = dashboardMountedRoot;
  if (!root) return;
  if (typeof window.__dashboardTonightAdjusterTeardown === 'function') {
    try {
      window.__dashboardTonightAdjusterTeardown();
    } catch (e) {
      /* ignore */
    }
    window.__dashboardTonightAdjusterTeardown = null;
  }
  dashboardCurrentDays = Array.isArray(sleepData.days) ? sleepData.days : [];
  root.innerHTML = renderDashboardContent(dashboardCurrentDays);
  if (typeof applyTranslations === 'function') applyTranslations(root);
  if (typeof initDeviationFlagChips === 'function') initDeviationFlagChips();
  if (typeof window.__restoreSyncCalendarHeatmapFlagFilters === 'function') {
    window.__restoreSyncCalendarHeatmapFlagFilters(root);
  }
  renderDashboard7DayGraphs(dashboardCurrentDays);
  bindDashboardResponsiveRerender();

  const recentDays = dashboardCurrentDays.slice(0, Math.min(7, dashboardCurrentDays.length));
  if (recentDays.length > 0 && typeof initDashboardTonightAdjuster === 'function' && typeof updateRemainingWakeNav === 'function' && typeof getRemainingWakeDisplayFromDays === 'function') {
    const recentAverages = calculateAverages(recentDays);
    initDashboardTonightAdjuster(
      recentAverages,
      function () {
        updateRemainingWakeNav(getRemainingWakeDisplayFromDays(dashboardCurrentDays));
      },
      function () {
        return dashboardCurrentDays;
      },
      getActiveDashboardPendingNight
    );
  }

  void refreshDashboardPendingNight();

  if (typeof getRemainingWakeDisplayFromDays === 'function' && typeof updateRemainingWakeNav === 'function') {
    updateRemainingWakeNav(getRemainingWakeDisplayFromDays(dashboardCurrentDays));
  }

  if (typeof initDashboardQuickActions === 'function') {
    initDashboardQuickActions(
      function () {
        return dashboardCurrentDays;
      },
      loadDashboardData
    );
  }
}

function loadDashboardData() {
  const root = dashboardMountedRoot;
  if (!root) return Promise.resolve();
  const genAtStart = dashboardMountGeneration;
  const store = window.__restoreSleepDataStore;
  if (store && typeof store.ensureLoaded === 'function') {
    return store.ensureLoaded()
      .then(() => {
        if (genAtStart !== dashboardMountGeneration || dashboardMountedRoot !== root) return;
        const snap = store.getSnapshot();
        if (snap && snap.data) {
          renderDashboardFromData(snap.data);
          return;
        }
        throw new Error('Missing sleep data snapshot');
      })
      .catch((error) => {
        console.error('Error loading dashboard data:', error);
        if (genAtStart !== dashboardMountGeneration || dashboardMountedRoot !== root) return;
        root.innerHTML = '<p>Error loading data.</p>';
      });
  }
  return loadSleepData()
    .then((sleepData) => {
      if (genAtStart !== dashboardMountGeneration || dashboardMountedRoot !== root) return;
      renderDashboardFromData(sleepData);
    })
    .catch((error) => {
      console.error('Error loading dashboard data:', error);
      if (genAtStart !== dashboardMountGeneration || dashboardMountedRoot !== root) return;
      root.innerHTML = '<p>Error loading data.</p>';
    });
}

/**
 * @param {HTMLElement} root
 * @param {Record<string, unknown>} [_ctx]
 */
function mountDashboard(root, _ctx) {
  if (!root) return;
  dashboardMountGeneration++;
  const gen = dashboardMountGeneration;
  dashboardMountedRoot = root;
  if (dashboardStoreUnsubscribe) {
    dashboardStoreUnsubscribe();
    dashboardStoreUnsubscribe = null;
  }
  root.innerHTML = '';
  if (dashboardTonightGuidanceHandler) {
    window.removeEventListener('tonight-guidance-changed', dashboardTonightGuidanceHandler);
    dashboardTonightGuidanceHandler = null;
  }
  dashboardTonightGuidanceHandler = function () {
    if (typeof loadDashboardData === 'function') void loadDashboardData();
  };
  window.addEventListener('tonight-guidance-changed', dashboardTonightGuidanceHandler);
  if (dashboardCalendarFlagAbort) {
    try {
      dashboardCalendarFlagAbort.abort();
    } catch (e) {
      /* ignore */
    }
    dashboardCalendarFlagAbort = null;
  }
  dashboardCalendarFlagAbort = new AbortController();
  if (typeof window.__restoreBindCalendarHeatmapFlagFilters === 'function') {
    window.__restoreBindCalendarHeatmapFlagFilters(root, dashboardCalendarFlagAbort.signal);
  }
  const store = window.__restoreSleepDataStore;
  if (store && typeof store.subscribe === 'function') {
    dashboardStoreUnsubscribe = store.subscribe((snapshot) => {
      if (gen !== dashboardMountGeneration || dashboardMountedRoot !== root) return;
      if (!snapshot) return;
      if (snapshot.data) {
        renderDashboardFromData(snapshot.data);
        return;
      }
      if (snapshot.status === 'error') {
        root.innerHTML = '<p>Error loading data.</p>';
      }
    });
  }
  void loadDashboardData();
}

function unmountDashboard() {
  dashboardMountGeneration++;
  if (dashboardCalendarFlagAbort) {
    try {
      dashboardCalendarFlagAbort.abort();
    } catch (e) {
      /* ignore */
    }
    dashboardCalendarFlagAbort = null;
  }
  if (dashboardStoreUnsubscribe) {
    dashboardStoreUnsubscribe();
    dashboardStoreUnsubscribe = null;
  }
  if (typeof window.__dashboardTonightAdjusterTeardown === 'function') {
    try {
      window.__dashboardTonightAdjusterTeardown();
    } catch (e) {
      /* ignore */
    }
    window.__dashboardTonightAdjusterTeardown = null;
  }
  if (typeof destroyDashboardQuickActions === 'function') {
    destroyDashboardQuickActions();
  }
  clearDashboardDayPanelDocCloses();
  unbindDashboardResponsiveRerender();
  if (dashboardTonightGuidanceHandler) {
    window.removeEventListener('tonight-guidance-changed', dashboardTonightGuidanceHandler);
    dashboardTonightGuidanceHandler = null;
  }
  if (dashboardMountedRoot) {
    if (typeof window.__restoreClearCalendarHeatmapFlagFilterState === 'function') {
      window.__restoreClearCalendarHeatmapFlagFilterState(dashboardMountedRoot);
    }
    dashboardMountedRoot.innerHTML = '';
  }
  dashboardMountedRoot = null;
  dashboardCurrentDays = [];
  resetDashboardPendingNight();
}

window.__restoreDashboardLifecycle = {
  mount: mountDashboard,
  unmount: unmountDashboard
};
