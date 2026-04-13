// Dashboard: recent average, lifetime average, recent nights (timeline rows), sleep quality history.
// Uses renderDashboardContent() and shared helpers from daily.js.
// Includes 7-day graphs: bed/sleep-start and wake time (left column), duration chart (right).
// Requires: sleep-utils.js (timeToMinutes, getDateFromString, calculateTotalSleep, formatDuration, formatTime)

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
      naturalWake: isNaturalWakeDay(day)
    };
  });
}

function getResponsiveDashboardChartWidth(container, pointCount) {
  const minWidth = 320;
  const pointDrivenWidth = Math.max(minWidth, pointCount * 36);
  const containerWidth = container ? Math.floor(container.clientWidth || 0) : 0;
  return Math.max(pointDrivenWidth, containerWidth);
}

function timeSeriesLineClass(key) {
  if (key === 'bedTimeMinutes') return { data: 'data-line bedtime', reg: 'regression-line bedtime-regression', point: 'data-point bedtime' };
  if (key === 'sleepStartMinutes') return { data: 'data-line sleep-start', reg: 'regression-line sleep-start-regression', point: 'data-point sleep-start' };
  return { data: 'data-line getup', reg: 'regression-line getup-regression', point: 'data-point getup' };
}

/** @param {string[]} seriesKeys subset of bedTimeMinutes, sleepStartMinutes, getUpMinutes */
function render7DayTimeGraph(container, points, seriesKeys) {
  if (!points.length) return;
  const keys = Array.isArray(seriesKeys) && seriesKeys.length
    ? seriesKeys
    : ['bedTimeMinutes', 'sleepStartMinutes', 'getUpMinutes'];
  const margin = { top: 24, right: 24, bottom: 36, left: 48 };
  const width = getResponsiveDashboardChartWidth(container, points.length);
  const height = 280;
  const graphWidth = width - margin.left - margin.right;
  const graphHeight = height - margin.top - margin.bottom;

  // Dynamic Y range: min/max of selected series only, plus 1 hour on each side
  const allTimes = points.flatMap(p => keys.map(k => p[k]));
  const dataMin = Math.min(...allTimes), dataMax = Math.max(...allTimes);
  const hourPad = 60;
  const finalYMin = Math.floor((dataMin - hourPad) / 60) * 60;
  const finalYMax = Math.ceil((dataMax + hourPad) / 60) * 60;
  const range = Math.max(finalYMax - finalYMin, 120);

  const minDate = points[0].date, maxDate = points[points.length - 1].date;
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

  // Match graph page behavior: break get-up line behind natural wake bullseye markers.
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

  // Invisible tap/click areas per day: tap a day to show daily values popup (same as graph.js)
  const dayWidth = graphWidth / Math.max(1, points.length);
  points.forEach((point, index) => {
    const x = xScale(point.date);
    const left = index === 0 ? 0 : x - dayWidth / 2;
    const w = index === 0 ? dayWidth / 2 + x - left
      : index === points.length - 1 ? graphWidth - left
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
      setTimeout(() => {
        const dayPanel = document.getElementById('day-panel');
        const close = (e2) => {
          if (dayPanel && !dayPanel.contains(e2.target) && !container.contains(e2.target)) {
            hideDayPanel();
            document.removeEventListener('click', close);
          }
        };
        document.addEventListener('click', close);
      }, 0);
    });
    g.appendChild(dayRect);
  });

  container.innerHTML = '';
  container.appendChild(svg);
}

function render7DayDurationChart(container, points) {
  if (!points.length) return;
  const margin = { top: 24, right: 24, bottom: 36, left: 48 };
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
      setTimeout(() => {
        const dayPanel = document.getElementById('day-panel');
        const close = (e2) => {
          if (dayPanel && !dayPanel.contains(e2.target) && !container.contains(e2.target)) {
            hideDayPanel();
            document.removeEventListener('click', close);
          }
        };
        document.addEventListener('click', close);
      }, 0);
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
          setTimeout(() => {
            const dayPanel = document.getElementById('day-panel');
            const close = (e2) => {
              if (dayPanel && !dayPanel.contains(e2.target) && !container.contains(e2.target)) {
                hideDayPanel();
                document.removeEventListener('click', close);
              }
            };
            document.addEventListener('click', close);
          }, 0);
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
  if (bedSleepEl) render7DayTimeGraph(bedSleepEl, last7, ['bedTimeMinutes', 'sleepStartMinutes']);
  if (wakeEl) render7DayTimeGraph(wakeEl, last7, ['getUpMinutes']);
  if (durationEl) render7DayDurationChart(durationEl, last7);
}

let dashboardResizeRenderBound = false;
let dashboardCurrentDays = [];
function bindDashboardResponsiveRerender() {
  if (dashboardResizeRenderBound) return;
  dashboardResizeRenderBound = true;

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      renderDashboard7DayGraphs(dashboardCurrentDays);
    }, 120);
  });
}

// --- Dashboard bootstrap ---
const dashboardContainer = document.getElementById('dashboard-container');
function renderDashboardFromData(sleepData) {
  dashboardCurrentDays = Array.isArray(sleepData.days) ? sleepData.days : [];
  dashboardContainer.innerHTML = renderDashboardContent(dashboardCurrentDays);
  if (typeof initDeviationFlagChips === 'function') initDeviationFlagChips();
  renderDashboard7DayGraphs(dashboardCurrentDays);
  bindDashboardResponsiveRerender();

  const recentDays = dashboardCurrentDays.slice(0, Math.min(7, dashboardCurrentDays.length));
  if (recentDays.length > 0 && typeof initDashboardTonightAdjuster === 'function' && typeof getRemainingWakeDisplayFromBasis === 'function' && typeof updateRemainingWakeNav === 'function') {
    const recentAverages = calculateAverages(recentDays);
    const baseWakeWindowMins = durationMinutes(recentAverages.avgSleepEnd, recentAverages.avgSleepStart);
    initDashboardTonightAdjuster(recentAverages, function (projection) {
      const basis = {
        avgSleepStart: projection.sleepTarget,
        avgSleepEnd: recentAverages.avgSleepEnd,
        totalWakeMins: baseWakeWindowMins
      };
      updateRemainingWakeNav(getRemainingWakeDisplayFromBasis(basis, dashboardCurrentDays));
    });
  }

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
  return loadSleepData()
    .then((sleepData) => {
      renderDashboardFromData(sleepData);
    })
    .catch(error => {
      console.error('Error loading dashboard data:', error);
      dashboardContainer.innerHTML = '<p>Error loading data.</p>';
    });
}

if (dashboardContainer) {
  loadDashboardData();
}
