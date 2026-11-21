// Dashboard: recent average, lifetime average, recent nights (timeline rows), sleep quality history.
// Uses renderDashboardContent() and shared helpers from nightly.js.
// Includes 7-day graphs: bed/sleep-start and wake time (left column), duration chart (right).
// Requires: time-utils.js (timeToMinutes, formatDuration, formatTime) + sleep-utils.js (getDateFromString, calculateTotalSleep)
//
// Lifecycle (SPA prep): mount / unmount on #dashboard-container — see docs/lifecycle-contract.md

// --- 7-day graph helpers ---
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
      naturalWake: classifyWake(day).natural
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

/** Point field holding each series' "usual" (Natural average as of that night); bed has none. */
const TIME_SERIES_USUAL_KEY = {
  sleepStartMinutes: 'usualSleepStartMinutes',
  getUpMinutes: 'usualGetUpMinutes'
};

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

// --- 7-day chart draw-in (scroll reveal) ---
// Each chart starts undrawn and plays once per mount when it first scrolls into view:
//   dots pop in left → right as a sweep reaches them (duration chart: nap dashes sweep with them);
//   then the dashed "usual" lines sweep left → right.
// Re-renders after that (resize, store refresh, Tonight draft arriving) resume a draw that is still
// playing, or render the finished chart. prefers-reduced-motion / no IntersectionObserver → static.
// Observer is per-route state: reset each render, torn down on unmount.

const DASHBOARD_CHART_DRAW = {
  sweepMs: 1000,
  trendGapMs: 150,
  trendMs: 750,
  /** Fraction of the chart that must be on screen before it draws. */
  revealRatio: 0.35
};

const DASHBOARD_SVG_NS = 'http://www.w3.org/2000/svg';
const dashboardSvgEl = (tag) => document.createElementNS(DASHBOARD_SVG_NS, tag);

/** chart id → performance.now() when its draw started (this mount only). */
const dashboardChartDrawStarts = new Map();
/** observed container → reveal callback for the current render */
const dashboardChartDrawTargets = new Map();
/** @type {IntersectionObserver | null} */
let dashboardChartDrawObserver = null;
let dashboardChartDrawClipSeq = 0;

function dashboardChartsShouldAnimate() {
  if (typeof IntersectionObserver !== 'function' || typeof requestAnimationFrame !== 'function') return false;
  try {
    return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) {
    return true;
  }
}

function chartDrawClamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
function chartDrawEaseInOut(p) {
  return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
}

/** Per-render plan: clip layers + points the draw animates. */
function createDashboardChartDrawPlan(svg) {
  const defs = dashboardSvgEl('defs');
  svg.insertBefore(defs, svg.firstChild);
  return { svg, defs, sweep: null, trend: null, points: [] };
}

function addDashboardChartClipLayer(plan, parent, className) {
  const id = `dashboard-chart-draw-clip-${++dashboardChartDrawClipSeq}`;
  const clip = dashboardSvgEl('clipPath');
  clip.setAttribute('id', id);
  plan.defs.appendChild(clip);
  const layer = dashboardSvgEl('g');
  layer.setAttribute('class', className);
  layer.setAttribute('clip-path', `url(#${id})`);
  parent.appendChild(layer);
  return { clip, layer };
}

/**
 * Layer revealed left → right from x0 to x1 (graph coords). Starts fully open so a static render
 * (no animation) needs no further work beyond dropping the clip.
 * @param {{ x0: number, x1: number, top: number, height: number }} box
 */
function addDashboardChartSweepLayer(plan, parent, className, box) {
  const { clip, layer } = addDashboardChartClipLayer(plan, parent, className);
  const rect = dashboardSvgEl('rect');
  rect.setAttribute('x', String(box.x0));
  rect.setAttribute('y', String(box.top));
  rect.setAttribute('width', String(Math.max(0, box.x1 - box.x0)));
  rect.setAttribute('height', String(box.height));
  clip.appendChild(rect);
  return { layer, rect, x0: box.x0, x1: box.x1 };
}

/** Sets every animated element for time t (ms since the draw started). Returns true when finished. */
function applyDashboardChartDraw(plan, t) {
  const C = DASHBOARD_CHART_DRAW;
  let mainEndMs = 0;
  if (plan.sweep) {
    const s = plan.sweep;
    const p = chartDrawEaseInOut(chartDrawClamp01(t / C.sweepMs));
    const w = (s.x1 - s.x0) * p;
    s.rect.setAttribute('width', String(w));
    const revealX = s.x0 + w;
    plan.points.forEach((pt) => {
      if (pt.shown || (p < 1 && pt.x > revealX)) return;
      pt.shown = true;
      pt.el.classList.remove('chart-draw-point--pending');
    });
    mainEndMs = C.sweepMs;
  }
  let endMs = mainEndMs;
  if (plan.trend) {
    const tr = plan.trend;
    const start = mainEndMs + C.trendGapMs;
    const p = chartDrawEaseInOut(chartDrawClamp01((t - start) / C.trendMs));
    tr.rect.setAttribute('width', String((tr.x1 - tr.x0) * p));
    endMs = start + C.trendMs;
  }
  return t >= endMs;
}

/** Final state: drop clips (they also block hover/click hit-testing) and point classes. */
function finishDashboardChartDraw(plan) {
  [plan.sweep, plan.trend].forEach((l) => {
    if (l) l.layer.removeAttribute('clip-path');
  });
  plan.defs.remove();
  plan.points.forEach((pt) => {
    pt.el.classList.remove('chart-draw-point', 'chart-draw-point--pending');
  });
}

function runDashboardChartDraw(plan, startedAt) {
  plan.points.forEach((pt) => {
    pt.shown = false;
    pt.el.classList.add('chart-draw-point', 'chart-draw-point--pending');
  });
  const step = () => {
    if (!plan.svg.isConnected) return; // replaced by a re-render or unmounted
    if (applyDashboardChartDraw(plan, performance.now() - startedAt)) {
      finishDashboardChartDraw(plan);
      return;
    }
    requestAnimationFrame(step);
  };
  // Runs synchronously once so a fresh / resumed chart never paints in its final state first.
  step();
}

function getDashboardChartDrawObserver() {
  if (dashboardChartDrawObserver) return dashboardChartDrawObserver;
  const ratio = DASHBOARD_CHART_DRAW.revealRatio;
  dashboardChartDrawObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting || entry.intersectionRatio < ratio - 0.001) return;
        const onReveal = dashboardChartDrawTargets.get(entry.target);
        dashboardChartDrawTargets.delete(entry.target);
        if (dashboardChartDrawObserver) dashboardChartDrawObserver.unobserve(entry.target);
        if (onReveal) onReveal();
      });
    },
    { threshold: [0, ratio] }
  );
  return dashboardChartDrawObserver;
}

/** Call once per renderDashboard7DayGraphs: containers may have been replaced. */
function resetDashboardChartDrawTargets() {
  if (dashboardChartDrawObserver) dashboardChartDrawObserver.disconnect();
  dashboardChartDrawTargets.clear();
}

function teardownDashboardChartDraw() {
  resetDashboardChartDrawTargets();
  dashboardChartDrawObserver = null;
  dashboardChartDrawStarts.clear();
}

/**
 * Call after the chart's svg is in the DOM.
 * @param {string} drawId stable per chart ('bed-sleep' | 'wake' | 'duration')
 */
function registerDashboardChartDraw(drawId, container, plan) {
  if (!drawId || !dashboardChartsShouldAnimate()) {
    finishDashboardChartDraw(plan);
    return;
  }
  const startedAt = dashboardChartDrawStarts.get(drawId);
  if (startedAt != null) {
    runDashboardChartDraw(plan, startedAt); // resume, or jump straight to the finished chart
    return;
  }
  // Hold undrawn until it scrolls into view.
  plan.points.forEach((pt) => pt.el.classList.add('chart-draw-point', 'chart-draw-point--pending'));
  applyDashboardChartDraw(plan, 0);
  dashboardChartDrawTargets.set(container, () => {
    const t0 = performance.now();
    dashboardChartDrawStarts.set(drawId, t0);
    runDashboardChartDraw(plan, t0);
  });
  getDashboardChartDrawObserver().observe(container);
}

/** Width (px) of each slice of the bed → asleep band; each slice carries its own gradient. */
const SLEEP_LAG_BAND_SLICE_PX = 4;

/**
 * Bed → asleep band on the bed / sleep chart: straight edges through each night's bed and asleep dots,
 * so its thickness is the sleep lag. The band is cut into thin vertical slices, each with its own
 * vertical gradient from that slice's bed edge (--color-bed) to its asleep edge (--color-sleep), so the
 * blend follows each night's lag instead of one gradient across the whole band. Breaks where a night
 * lacks either time.
 */
function appendSleepLagBand(layer, defs, points, xAt, yScale) {
  const has = (p) => Number.isFinite(p.bedTimeMinutes) && Number.isFinite(p.sleepStartMinutes);
  const lerp = (u, v, t) => u + (v - u) * t;
  const band = dashboardSvgEl('g');
  band.setAttribute('class', 'sleep-lag-band');
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    if (!has(a) || !has(b)) continue;
    const xa = xAt(i), xb = xAt(i + 1);
    const n = Math.max(1, Math.ceil((xb - xa) / SLEEP_LAG_BAND_SLICE_PX));
    for (let k = 0; k < n; k++) {
      const t0 = k / n, t1 = (k + 1) / n, tm = (t0 + t1) / 2;
      const x0 = lerp(xa, xb, t0);
      const x1 = lerp(xa, xb, t1) + 0.5; // overlap hides anti-aliasing seams (incl. between nights)
      const bedY = (t) => yScale(lerp(a.bedTimeMinutes, b.bedTimeMinutes, t));
      const asleepY = (t) => yScale(lerp(a.sleepStartMinutes, b.sleepStartMinutes, t));

      const id = `sleep-lag-band-${++dashboardChartDrawClipSeq}`;
      const grad = dashboardSvgEl('linearGradient');
      grad.setAttribute('id', id);
      grad.setAttribute('gradientUnits', 'userSpaceOnUse');
      grad.setAttribute('x1', '0'); grad.setAttribute('x2', '0');
      grad.setAttribute('y1', String(bedY(tm)));
      grad.setAttribute('y2', String(asleepY(tm)));
      [['0', 'sleep-lag-band__stop--bed'], ['1', 'sleep-lag-band__stop--asleep']].forEach(([offset, cls]) => {
        const stop = dashboardSvgEl('stop');
        stop.setAttribute('offset', offset);
        stop.setAttribute('class', cls);
        grad.appendChild(stop);
      });
      defs.appendChild(grad);

      const slice = dashboardSvgEl('polygon');
      slice.setAttribute('points', `${x0},${bedY(t0)} ${x1},${bedY(t1)} ${x1},${asleepY(t1)} ${x0},${asleepY(t0)}`);
      slice.setAttribute('fill', `url(#${id})`);
      band.appendChild(slice);
    }
  }
  if (band.childNodes.length) layer.appendChild(band);
}

/**
 * @param {string[]} seriesKeys subset of bedTimeMinutes, sleepStartMinutes, getUpMinutes
 * @param {object | null} [tonightPoint] from buildTonightPoint — adds a "Tonight" column after "Last night".
 *   Series with a value get a hollow point; it has no usual line.
 * Dots only (no day-to-day line) in centered day columns; bed + asleep together get a bed → asleep band
 * (appendSleepLagBand); dashed "usual" lines for fell-asleep / wake (TIME_SERIES_USUAL_KEY); natural
 * wake as a bullseye.
 */
function render7DayTimeGraph(container, points, seriesKeys, tonightPoint, drawId) {
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

  // Dynamic Y range: selected series (incl. tonight's values and usual lines), plus 1 hour on each side
  const allTimes = points.flatMap(p => keys.map(k => p[k]));
  points.forEach((p) => keys.forEach((k) => {
    const usualKey = TIME_SERIES_USUAL_KEY[k];
    if (usualKey && Number.isFinite(p[usualKey])) allTimes.push(p[usualKey]);
  }));
  tonightKeys.forEach((k) => allTimes.push(tonight[k]));
  const dataMin = Math.min(...allTimes), dataMax = Math.max(...allTimes);
  const hourPad = 60;
  const finalYMin = Math.floor((dataMin - hourPad) / 60) * 60;
  const finalYMax = Math.ceil((dataMax + hourPad) / 60) * 60;
  const range = Math.max(finalYMax - finalYMin, 120);

  // One centered column per night (+ Tonight), same as the duration chart: dots never sit on the axes.
  const slotCount = points.length + (tonight ? 1 : 0);
  const dayWidth = graphWidth / Math.max(1, slotCount);
  const xAt = (index) => dayWidth * (index + 0.5);
  const tonightX = xAt(points.length);
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
  const drawPlan = createDashboardChartDrawPlan(svg);
  // Clip boxes: a little past the plot on each side so stroke caps aren't cut.
  const drawPad = 10;
  const drawBox = (x1) => ({ x0: -drawPad, x1: x1 + drawPad, top: -margin.top, height: height });

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
    const x = xAt(index);
    const tickLine = ns('line');
    tickLine.setAttribute('x1', x); tickLine.setAttribute('y1', graphHeight);
    tickLine.setAttribute('x2', x); tickLine.setAttribute('y2', graphHeight + 5);
    tickLine.setAttribute('class', 'axis');
    g.appendChild(tickLine);
    append7DayXAxisTickLabel(g, ns, x, graphHeight, point, index, points.length);
  });
  if (tonight) {
    const tx = tonightX;
    const tickLine = ns('line');
    tickLine.setAttribute('x1', tx); tickLine.setAttribute('y1', graphHeight);
    tickLine.setAttribute('x2', tx); tickLine.setAttribute('y2', graphHeight + 5);
    tickLine.setAttribute('class', 'axis');
    g.appendChild(tickLine);
    appendTonightXAxisTickLabel(g, ns, tx, graphHeight, tonightKeys.length > 0);
  }

  // Bed → asleep band sweeps in left → right with the dots (which pop in as the sweep reaches them).
  drawPlan.sweep = addDashboardChartSweepLayer(drawPlan, g, 'chart-draw-lines', drawBox(graphWidth));
  if (keys.includes('bedTimeMinutes') && keys.includes('sleepStartMinutes')) {
    const bandDefs = ns('defs'); // own defs: drawPlan.defs is removed when the draw finishes
    svg.insertBefore(bandDefs, svg.firstChild);
    appendSleepLagBand(drawPlan.sweep.layer, bandDefs, points, xAt, yScale);
  }

  // "Your usual" lines (Natural fell-asleep / wake as of each night) sit above the band, behind the
  // dots, and draw after them; they stop at last night. Bed has no recent average, so no line. Gaps where a night is learning.
  drawPlan.trend = addDashboardChartSweepLayer(
    drawPlan, g, 'chart-draw-trend', drawBox(xAt(points.length - 1))
  );
  keys.forEach((key) => {
    const usualKey = TIME_SERIES_USUAL_KEY[key];
    if (!usualKey) return;
    let d = '';
    let penDown = false;
    points.forEach((p, i) => {
      if (!Number.isFinite(p[usualKey])) { penDown = false; return; }
      d += (penDown ? ' L ' : ' M ') + xAt(i) + ' ' + yScale(p[usualKey]);
      penDown = true;
    });
    if (!d) return;
    const usualPath = ns('path');
    usualPath.setAttribute('d', d.trim());
    usualPath.setAttribute('class', `usual-line usual-line--${tonightSeriesSuffix(key)}`);
    drawPlan.trend.layer.appendChild(usualPath);
  });

  const dotR = 9;
  points.forEach((p, index) => {
    keys.forEach((key) => {
      if (!Number.isFinite(p[key])) return;
      const x = xAt(index);
      const y = yScale(p[key]);

      // Natural wake: bullseye in the same footprint as a plain dot.
      if (key === 'getUpMinutes' && p.naturalWake) {
        const ng = ns('g');
        ng.setAttribute('class', 'time-dot-natural');
        [
          [dotR, 'time-dot-natural__ring'],
          [dotR - 2.5, 'time-dot-natural__gap'],
          [dotR - 5, 'time-dot-natural__core']
        ].forEach(([r, cls]) => {
          const c = ns('circle');
          c.setAttribute('cx', String(x));
          c.setAttribute('cy', String(y));
          c.setAttribute('r', String(r));
          c.setAttribute('class', cls);
          ng.appendChild(c);
        });
        g.appendChild(ng);
        drawPlan.points.push({ el: ng, x });
        return;
      }

      const circle = ns('circle');
      circle.setAttribute('cx', x);
      circle.setAttribute('cy', y);
      circle.setAttribute('r', dotR);
      circle.setAttribute('class', `time-dot time-dot--${tonightSeriesSuffix(key)}`);
      g.appendChild(circle);
      drawPlan.points.push({ el: circle, x });
    });
  });

  // Tonight: hollow points (in progress, no usual line).
  if (tonight) {
    tonightKeys.forEach((key) => {
      const ring = ns('circle');
      ring.setAttribute('cx', String(tonightX));
      ring.setAttribute('cy', String(yScale(tonight[key])));
      ring.setAttribute('r', String(dotR - 1));
      ring.setAttribute('class', `data-point-tonight data-point-tonight--${tonightSeriesSuffix(key)}`);
      g.appendChild(ring);
      drawPlan.points.push({ el: ring, x: tonightX });
    });
  }

  // Invisible tap/click areas per day: tap a day to show daily values popup (same as charts.js)
  const tonightLeft = points.length * dayWidth;
  points.forEach((point, index) => {
    const x = xAt(index);
    const left = x - dayWidth / 2;
    const w = dayWidth;
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
  registerDashboardChartDraw(drawId, container, drawPlan);
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

/**
 * WASO stripes on total-sleep dots, by normalizeFragmentationLevel: pitch / stripe width in px.
 * Denser with more wake episodes (same mild → severe progression as the bar / timeline textures).
 */
const DURATION_WASO_STRIPES = {
  mild: { pitch: 7, width: 1.5 },
  moderate: { pitch: 4.5, width: 1.5 },
  severe: { pitch: 3, width: 1.75 }
};

/**
 * Natural (recent-average) values as of a night: the same per-night baseline the deviation flags use
 * (getDeviationBaseline — the entries before that night). null while learning (fewer than
 * DEVIATION_MIN_PRIOR_NIGHTS earlier entries), so the charts' usual lines and the flags appear together.
 * @param {Array<object>} days newest-first, as passed to computeRecentAverages
 * @param {number} dayIndex the night's index in `days`
 * @returns {{ sleepDuration: number, sleepStart: number, getUp: number } | null} unrounded minutes;
 *   sleepStart / getUp on the 7-day chart y axis (normalizeTimeForYAxis)
 */
function getUsualBaselineForNight(days, dayIndex) {
  if (typeof getDeviationBaseline !== 'function' || !Number.isInteger(dayIndex)) return null;
  const b = getDeviationBaseline(days, dayIndex);
  if (!b || b.insufficient) return null;
  const toYAxis = (norm) => (Number.isFinite(norm) ? normalizeTimeForYAxis(modMinutes1440(norm)) : null);
  return {
    sleepDuration: Number.isFinite(b.avgSleepDuration) ? b.avgSleepDuration : null,
    sleepStart: toYAxis(b.avgFellAsleepTime),
    getUp: toYAxis(b.avgWakeTime)
  };
}

/**
 * Total sleep, last 7 nights. Dots on a zoomed axis: position (not bar length) carries the value, so
 * cropping the axis does not exaggerate differences. The dashed line is "your usual" — the Natural
 * average as of each night (point.usualSleepMinutes) — in place of a fitted trend, so one long night
 * does not swing it. Nap nights (SKP): hollow --color-sleep ring at main sleep, --color-nap dash up to
 * a --color-nap total dot. WASO nights: stripes in the dot's own color (DURATION_WASO_STRIPES).
 */
function render7DayDurationChart(container, points, drawId) {
  if (!points.length) return;
  const margin = { top: 24, right: 40, bottom: 36, left: 48 };
  const width = getResponsiveDashboardChartWidth(container, points.length);
  const height = 280;
  const graphWidth = width - margin.left - margin.right;
  const graphHeight = height - margin.top - margin.bottom;
  const slotWidth = graphWidth / Math.max(1, points.length);
  const xScaleByIndex = (index) => slotWidth * (index + 0.5);

  const hasNap = (p) => p.napMinutes > 0;
  const hasUsual = (p) => Number.isFinite(p.usualSleepMinutes);

  // Dynamic Y range over everything drawn (totals, main sleep on nap nights, usual line), plus 1 hour each side
  const allValues = [];
  points.forEach((p) => {
    allValues.push(p.sleepDurationMinutes);
    if (hasNap(p)) allValues.push(p.mainSleepMinutes);
    if (hasUsual(p)) allValues.push(p.usualSleepMinutes);
  });
  const dataMin = Math.min(...allValues), dataMax = Math.max(...allValues);
  const hourPad = 60;
  const sleepYMin = Math.max(0, Math.floor((dataMin - hourPad) / 60) * 60);
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
  const drawPlan = createDashboardChartDrawPlan(svg);

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

  const drawPad = 10;
  const drawBox = (x0, x1) => ({ x0: x0 - drawPad, x1: x1 + drawPad, top: -margin.top, height: height });

  // "Your usual" line sits behind the dots but draws after them. Gaps where a night is still learning.
  drawPlan.trend = addDashboardChartSweepLayer(
    drawPlan, g, 'chart-draw-trend', drawBox(xScaleByIndex(0), xScaleByIndex(points.length - 1))
  );
  let usualD = '';
  let penDown = false;
  points.forEach((p, i) => {
    if (!hasUsual(p)) { penDown = false; return; }
    usualD += (penDown ? ' L ' : ' M ') + xScaleByIndex(i) + ' ' + sleepYScale(p.usualSleepMinutes);
    penDown = true;
  });
  if (usualD) {
    const usualPath = ns('path');
    usualPath.setAttribute('d', usualD.trim());
    usualPath.setAttribute('class', 'usual-line usual-line--sleep');
    drawPlan.trend.layer.appendChild(usualPath);
  }

  // Nap dashes reveal with a left → right sweep; dots pop in as the sweep reaches them.
  drawPlan.sweep = addDashboardChartSweepLayer(drawPlan, g, 'chart-draw-lines', drawBox(0, graphWidth));
  const totalR = 9;
  const mainR = 8;
  // WASO: stripes cut into the dot in the panel color, so they take the dot's own color (sleep / nap).
  // Own <defs> — drawPlan.defs is removed when the draw finishes.
  const wasoDefs = ns('defs');
  svg.insertBefore(wasoDefs, svg.firstChild);
  const wasoPatternIds = {};
  const wasoPatternId = (level) => {
    if (wasoPatternIds[level]) return wasoPatternIds[level];
    const spec = DURATION_WASO_STRIPES[level];
    if (!spec) return null;
    const id = `duration-waso-${level}-${++dashboardChartDrawClipSeq}`;
    const pattern = ns('pattern');
    pattern.setAttribute('id', id);
    pattern.setAttribute('patternUnits', 'userSpaceOnUse');
    pattern.setAttribute('width', String(spec.pitch));
    pattern.setAttribute('height', String(spec.pitch));
    pattern.setAttribute('patternTransform', 'rotate(35)');
    const stripe = ns('line');
    stripe.setAttribute('x1', '0'); stripe.setAttribute('y1', '0');
    stripe.setAttribute('x2', '0'); stripe.setAttribute('y2', String(spec.pitch));
    stripe.setAttribute('stroke-width', String(spec.width));
    stripe.setAttribute('class', 'duration-waso-stripe');
    pattern.appendChild(stripe);
    wasoDefs.appendChild(pattern);
    wasoPatternIds[level] = id;
    return id;
  };
  const appendWasoStripes = (parent, cx, cy, r, level) => {
    const id = level ? wasoPatternId(level) : null;
    if (!id) return;
    const overlay = ns('circle');
    overlay.setAttribute('cx', cx); overlay.setAttribute('cy', cy); overlay.setAttribute('r', r - 1);
    overlay.setAttribute('fill', `url(#${id})`);
    overlay.setAttribute('class', 'duration-waso-overlay');
    parent.appendChild(overlay);
  };
  points.forEach((point, index) => {
    const x = xScaleByIndex(index);
    const totalY = sleepYScale(point.sleepDurationMinutes);
    if (!hasNap(point)) {
      const dotG = ns('g');
      const dot = ns('circle');
      dot.setAttribute('cx', x); dot.setAttribute('cy', totalY); dot.setAttribute('r', totalR);
      dot.setAttribute('class', 'duration-dot');
      dotG.appendChild(dot);
      appendWasoStripes(dotG, x, totalY, totalR, point.fragmentation);
      g.appendChild(dotG);
      drawPlan.points.push({ el: dotG, x });
      return;
    }
    const mainY = sleepYScale(point.mainSleepMinutes);
    const y1 = mainY - mainR - 1;
    const y2 = totalY + totalR + 1;
    if (y1 > y2) {
      const dash = ns('line');
      dash.setAttribute('x1', x); dash.setAttribute('y1', y1);
      dash.setAttribute('x2', x); dash.setAttribute('y2', y2);
      dash.setAttribute('class', 'duration-nap-connector');
      drawPlan.sweep.layer.appendChild(dash);
    }
    const napG = ns('g');
    const ring = ns('circle');
    ring.setAttribute('cx', x); ring.setAttribute('cy', mainY); ring.setAttribute('r', mainR);
    ring.setAttribute('class', 'duration-dot duration-dot--main');
    const total = ns('circle');
    total.setAttribute('cx', x); total.setAttribute('cy', totalY); total.setAttribute('r', totalR);
    total.setAttribute('class', 'duration-dot duration-dot--nap-total');
    napG.appendChild(ring);
    napG.appendChild(total);
    appendWasoStripes(napG, x, totalY, totalR, point.fragmentation);
    g.appendChild(napG);
    drawPlan.points.push({ el: napG, x });
  });

  // Invisible hover / tap column per night: tooltip on hover, day panel on click.
  const tooltip = document.getElementById('tooltip');
  const tooltipText = (point) => {
    const napText = hasNap(point)
      ? ` (${formatDuration(point.mainSleepMinutes)} + ${formatDuration(point.napMinutes)} nap)`
      : '';
    const usualText = hasUsual(point) ? ` · usual ${formatDuration(Math.round(point.usualSleepMinutes))}` : '';
    return `${formatSleepDateMonthDay(point.dateString)}: ${formatDuration(point.sleepDurationMinutes)}${napText}${usualText}`;
  };
  points.forEach((point, index) => {
    const x = xScaleByIndex(index);
    const col = ns('rect');
    col.setAttribute('x', x - slotWidth / 2);
    col.setAttribute('y', 0);
    col.setAttribute('width', slotWidth);
    col.setAttribute('height', graphHeight);
    col.setAttribute('class', 'duration-hit-column');
    col.addEventListener('mouseenter', () => {
      if (!tooltip) return;
      tooltip.textContent = tooltipText(point);
      tooltip.classList.add('visible');
    });
    col.addEventListener('mousemove', (e) => {
      if (tooltip) {
        tooltip.style.left = (e.clientX + 10) + 'px';
        tooltip.style.top = (e.clientY - 10) + 'px';
      }
    });
    col.addEventListener('mouseleave', () => { if (tooltip) tooltip.classList.remove('visible'); });
    col.addEventListener('click', (e) => {
      showDayPanel(point, e.clientX, e.clientY);
      scheduleDashboardChartDayPanelOutsideClose(container);
    });
    g.appendChild(col);
  });

  container.innerHTML = '';
  container.appendChild(svg);
  registerDashboardChartDraw(drawId, container, drawPlan);
}

function renderDashboard7DayGraphs(days) {
  if (!days || days.length === 0) return;
  const points = buildPoints(days);
  points.forEach((p, i) => { p.dayIndex = i; }); // index in `days` (newest-first) for per-night baselines
  points.sort((a, b) => a.date - b.date);
  const last7 = points.slice(-7);
  if (last7.length === 0) return;
  last7.forEach((p) => {
    const usual = getUsualBaselineForNight(days, p.dayIndex);
    p.usualSleepMinutes = usual ? usual.sleepDuration : null;
    p.usualSleepStartMinutes = usual ? usual.sleepStart : null;
    p.usualGetUpMinutes = usual ? usual.getUp : null;
  });
  const bedSleepEl = document.getElementById('dashboard-7d-bed-sleep-graph');
  const wakeEl = document.getElementById('dashboard-7d-wake-graph');
  const durationEl = document.getElementById('dashboard-7d-duration-graph');
  // Tonight column: bed/sleep chart shows the draft values; the stacked wake chart gets an empty
  // Tonight slot so both charts keep the same x columns.
  const tonightPoint = buildTonightPoint(getActiveDashboardPendingNight());
  resetDashboardChartDrawTargets();
  if (bedSleepEl) render7DayTimeGraph(bedSleepEl, last7, ['bedTimeMinutes', 'sleepStartMinutes'], tonightPoint, 'bed-sleep');
  if (wakeEl) render7DayTimeGraph(wakeEl, last7, ['getUpMinutes'], tonightPoint, 'wake');
  if (durationEl) render7DayDurationChart(durationEl, last7, 'duration');
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
 * (`getCurrentNightKey`: cutover on the natural recent-average wake).
 */
function getDashboardTonightNightKey(days) {
  if (typeof getCurrentNightKey !== 'function' || typeof getAppDate !== 'function') return null;
  const md = getCurrentNightKey(getAppDate(), Array.isArray(days) ? days : []);
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

  const recentAverages = computeRecentAverages(dashboardCurrentDays);
  if (recentAverages && typeof initDashboardTonightAdjuster === 'function' && typeof updateRemainingWakeNav === 'function' && typeof getRemainingWakeDisplayFromDays === 'function') {
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
  teardownDashboardChartDraw(); // charts draw in again on each visit
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
  teardownDashboardChartDraw();
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
