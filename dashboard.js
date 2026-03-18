// Dashboard: recent average, lifetime average, past three nights (timeline rows), sleep quality history.
// Uses renderDashboardContent() and shared helpers from daily.js.
// Includes 7-day graphs: time graph (left) and sleep duration chart (right).
// Requires: sleep-utils.js (timeToMinutes, getDateFromString, calculateTotalSleep, formatDuration, formatTime)

// --- 7-day graph helpers ---
function normalizeTimeForYAxis(minutes) {
  if (minutes < 1020) return minutes + 1440;
  return minutes;
}

function calculateWakeDelay(day) {
  if (!day.alarm || day.alarm.length === 0) return null;
  const firstAlarm = Math.min(...day.alarm.map(timeToMinutes));
  const wakeTime = timeToMinutes(day.sleepEnd);
  let delay = wakeTime - firstAlarm;
  if (delay < 0 && firstAlarm >= 1080) delay = (wakeTime + 1440) - firstAlarm;
  return delay > 0 ? delay : null;
}

function calculateSleepDelay(day) {
  const bedTime = timeToMinutes(day.bed);
  const sleepStart = timeToMinutes(day.sleepStart);
  let delay = sleepStart - bedTime;
  if (delay < 0) delay += 1440;
  return delay;
}

function solveLinearSystem(A, b) {
  const n = A.length;
  const augmented = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < n; i++) {
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(augmented[k][i]) > Math.abs(augmented[maxRow][i])) maxRow = k;
    }
    [augmented[i], augmented[maxRow]] = [augmented[maxRow], augmented[i]];
    for (let k = i + 1; k < n; k++) {
      const factor = augmented[k][i] / augmented[i][i];
      for (let j = i; j <= n; j++) augmented[k][j] -= factor * augmented[i][j];
    }
  }
  const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    x[i] = augmented[i][n];
    for (let j = i + 1; j < n; j++) x[i] -= augmented[i][j] * x[j];
    x[i] /= augmented[i][i];
  }
  return x;
}

function polynomialRegression(xValues, yValues, degree = 2) {
  const n = xValues.length;
  const X = [];
  for (let i = 0; i < n; i++) {
    const row = [];
    for (let d = degree; d >= 0; d--) row.push(Math.pow(xValues[i], d));
    X.push(row);
  }
  const XTX = [], XTY = [];
  for (let i = 0; i <= degree; i++) {
    XTX[i] = [];
    XTY[i] = 0;
    for (let j = 0; j <= degree; j++) {
      let sum = 0;
      for (let k = 0; k < n; k++) sum += X[k][i] * X[k][j];
      XTX[i][j] = sum;
    }
    for (let k = 0; k < n; k++) XTY[i] += X[k][i] * yValues[k];
  }
  return solveLinearSystem(XTX, XTY);
}

function evaluatePolynomial(coefficients, x) {
  let result = 0;
  for (let i = 0; i < coefficients.length; i++)
    result += coefficients[i] * Math.pow(x, coefficients.length - 1 - i);
  return result;
}

/** For last-7-days charts: "Last Nite" (2 lines) for the most recent day, otherwise three-letter weekday (Mon, Tue, …). */
function get7DayAxisLabel(point, index, total) {
  if (index === total - 1) return null; // rendered as two-line "Last Nite" in the graph
  const d = new Date(point.date);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return days[d.getDay()];
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
      napMinutes: napDuration
    };
  });
}

function render7DayTimeGraph(container, points) {
  if (!points.length) return;
  const margin = { top: 24, right: 24, bottom: 36, left: 48 };
  const width = Math.max(320, points.length * 36);
  const height = 280;
  const graphWidth = width - margin.left - margin.right;
  const graphHeight = height - margin.top - margin.bottom;

  // Dynamic Y range: min/max of 7-day data plus 1 hour on each side
  const allTimes = points.flatMap(p => [p.bedTimeMinutes, p.sleepStartMinutes, p.getUpMinutes]);
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
    const label = ns('text');
    label.setAttribute('x', x);
    label.setAttribute('class', 'axis-label');
    label.setAttribute('text-anchor', 'middle');
    const text = get7DayAxisLabel(point, index, points.length);
    if (text === null) {
      label.setAttribute('y', graphHeight + 10);
      const t1 = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
      t1.setAttribute('x', x);
      t1.textContent = 'Last';
      const t2 = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
      t2.setAttribute('x', x);
      t2.setAttribute('dy', '1em');
      t2.textContent = 'Nite';
      label.appendChild(t1);
      label.appendChild(t2);
    } else {
      label.setAttribute('y', graphHeight + 14);
      label.textContent = text;
    }
    g.appendChild(label);
  });

  const path = (pts, key) => {
    let d = '';
    pts.forEach((p, i) => {
      const x = xScale(p.date), y = yScale(p[key]);
      d += (i ? ' L ' : 'M ') + x + ' ' + y;
    });
    return d;
  };

  const pathBedtime = ns('path');
  pathBedtime.setAttribute('d', path(points, 'bedTimeMinutes'));
  pathBedtime.setAttribute('class', 'data-line bedtime');
  g.appendChild(pathBedtime);
  const pathSleepStart = ns('path');
  pathSleepStart.setAttribute('d', path(points, 'sleepStartMinutes'));
  pathSleepStart.setAttribute('class', 'data-line sleep-start');
  g.appendChild(pathSleepStart);
  const pathGetUp = ns('path');
  pathGetUp.setAttribute('d', path(points, 'getUpMinutes'));
  pathGetUp.setAttribute('class', 'data-line getup');
  g.appendChild(pathGetUp);

  const getUpReg = polynomialRegression(points.map((_, i) => i), points.map(p => p.getUpMinutes), 2);
  const sleepStartReg = polynomialRegression(points.map((_, i) => i), points.map(p => p.sleepStartMinutes), 2);
  const bedtimeReg = polynomialRegression(points.map((_, i) => i), points.map(p => p.bedTimeMinutes), 2);

  const regPath = (coeffs, key) => {
    let d = '';
    points.forEach((p, i) => {
      const x = xScale(p.date), y = yScale(evaluatePolynomial(coeffs, i));
      d += (i ? ' L ' : 'M ') + x + ' ' + y;
    });
    return d;
  };
  const regGetUp = ns('path');
  regGetUp.setAttribute('d', regPath(getUpReg, 'getUpMinutes'));
  regGetUp.setAttribute('class', 'regression-line getup-regression');
  regGetUp.setAttribute('fill', 'none');
  g.appendChild(regGetUp);
  const regSleepStart = ns('path');
  regSleepStart.setAttribute('d', regPath(sleepStartReg, 'sleepStartMinutes'));
  regSleepStart.setAttribute('class', 'regression-line sleep-start-regression');
  regSleepStart.setAttribute('fill', 'none');
  g.appendChild(regSleepStart);
  const regBedtime = ns('path');
  regBedtime.setAttribute('d', regPath(bedtimeReg, 'bedTimeMinutes'));
  regBedtime.setAttribute('class', 'regression-line bedtime-regression');
  regBedtime.setAttribute('fill', 'none');
  g.appendChild(regBedtime);

  points.forEach(p => {
    ['bedTimeMinutes', 'sleepStartMinutes', 'getUpMinutes'].forEach((key, i) => {
      const circle = ns('circle');
      circle.setAttribute('cx', xScale(p.date));
      circle.setAttribute('cy', yScale(p[key]));
      circle.setAttribute('r', 3);
      circle.setAttribute('class', 'data-point ' + (key === 'bedTimeMinutes' ? 'bedtime' : key === 'sleepStartMinutes' ? 'sleep-start' : 'getup'));
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
  const width = Math.max(320, points.length * 36);
  const height = 280;
  const graphWidth = width - margin.left - margin.right;
  const graphHeight = height - margin.top - margin.bottom;

  const minDate = points[0].date, maxDate = points[points.length - 1].date;
  const dateRange = maxDate - minDate || 1;
  const xScale = (date) => ((date - minDate) / dateRange) * graphWidth;

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
    const x = xScale(point.date);
    const tickLine = ns('line');
    tickLine.setAttribute('x1', x); tickLine.setAttribute('y1', graphHeight);
    tickLine.setAttribute('x2', x); tickLine.setAttribute('y2', graphHeight + 5);
    tickLine.setAttribute('class', 'axis');
    g.appendChild(tickLine);
    const label = ns('text');
    label.setAttribute('x', x);
    label.setAttribute('class', 'axis-label');
    label.setAttribute('text-anchor', 'middle');
    const text = get7DayAxisLabel(point, index, points.length);
    if (text === null) {
      label.setAttribute('y', graphHeight + 10);
      const t1 = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
      t1.setAttribute('x', x);
      t1.textContent = 'Last';
      const t2 = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
      t2.setAttribute('x', x);
      t2.setAttribute('dy', '1em');
      t2.textContent = 'Nite';
      label.appendChild(t1);
      label.appendChild(t2);
    } else {
      label.setAttribute('y', graphHeight + 14);
      label.textContent = text;
    }
    g.appendChild(label);
  });

  const tooltip = document.getElementById('tooltip');
  const dayWidth = graphWidth / Math.max(1, points.length);
  const barWidth = Math.max(2, dayWidth * 0.8);
  points.forEach(point => {
    const x = xScale(point.date);
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
      tooltip.textContent = `${point.dateString}: ${formatDuration(point.sleepDurationMinutes)}${napText}`;
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
          tooltip.textContent = `${point.dateString}: ${formatDuration(point.sleepDurationMinutes)} (${formatDuration(point.mainSleepMinutes)} + ${formatDuration(point.napMinutes)} nap)`;
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
    }
  });

  const sleepReg = polynomialRegression(points.map((_, i) => i), points.map(p => p.sleepDurationMinutes), 2);
  let trendD = '';
  points.forEach((p, i) => {
    const x = xScale(p.date), y = sleepYScale(evaluatePolynomial(sleepReg, i));
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
  const timeEl = document.getElementById('dashboard-7d-time-graph');
  const durationEl = document.getElementById('dashboard-7d-duration-graph');
  if (timeEl) render7DayTimeGraph(timeEl, last7);
  if (durationEl) render7DayDurationChart(durationEl, last7);
}

// --- Dashboard bootstrap ---
const dashboardContainer = document.getElementById('dashboard-container');
if (dashboardContainer) {
  fetch('sleep-data.json').then(r => r.json())
    .then((sleepData) => {
      dashboardContainer.innerHTML = renderDashboardContent(sleepData.days);
      renderDashboard7DayGraphs(sleepData.days);

      const recentDays = sleepData.days.slice(0, Math.min(7, sleepData.days.length));
      if (recentDays.length > 0 && typeof getRemainingWakeDisplay === 'function' && typeof updateRemainingWakeNav === 'function') {
        const recentAverages = calculateAverages(recentDays);
        updateRemainingWakeNav(getRemainingWakeDisplay(recentAverages));
      }
    })
    .catch(error => {
      console.error('Error loading dashboard data:', error);
      dashboardContainer.innerHTML = '<p>Error loading data.</p>';
    });
}
