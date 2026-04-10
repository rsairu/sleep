// Graph page rendering. Shared math/time helpers live in sleep-utils.js.

function graphRangeDays(key) {
  const map = { '30d': 30, '90d': 90, '180d': 180, '365d': 365 };
  return map[key] ?? null;
}

function filterPointsByGraphRange(allPoints, rangeKey) {
  if (!allPoints.length) return [];
  if (rangeKey === 'all') return allPoints.slice();
  const days = graphRangeDays(rangeKey);
  if (!days) return allPoints.slice();
  const endDate = allPoints[allPoints.length - 1].date;
  const startDate = new Date(endDate.getTime());
  startDate.setHours(0, 0, 0, 0);
  startDate.setDate(startDate.getDate() - (days - 1));
  return allPoints.filter((p) => p.date >= startDate && p.date <= endDate);
}

function graphAlarmWakeMarkersOn() {
  const el = document.getElementById('show-alarm-wake-markers');
  return !el || el.checked;
}

function graphNaturalWakeMarkersOn() {
  const el = document.getElementById('show-natural-wake-markers');
  return !el || el.checked;
}

function graphOuterWidth() {
  const el = document.getElementById('graph-container');
  const w = el && el.clientWidth;
  return Math.max(320, w || 800);
}

function debounceGraph(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(null, args), ms);
  };
}

function defaultGraphRangeKey() {
  return window.matchMedia('(max-width: 768px)').matches ? '90d' : 'all';
}

function regressionDegree(pointCount) {
  return Math.min(2, Math.max(0, pointCount - 1));
}

function clearGraphSvgsAndErrors() {
  ['graph-svg', 'bar-chart-svg', 'delay-chart-svg', 'sol-chart-svg'].forEach((id) => {
    const svg = document.getElementById(id);
    if (svg) while (svg.firstChild) svg.removeChild(svg.firstChild);
  });
  document.querySelectorAll('#graph-container .chart-error, #bar-chart-container .chart-error, #delay-chart-container .chart-error, #sol-chart-container .chart-error').forEach((el) => el.remove());
}

function setActiveGraphRangeButton(rangeKey) {
  document.querySelectorAll('.graph-range-btn').forEach((btn) => {
    const active = btn.dataset.range === rangeKey;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

let graphPageAllPoints = [];
let graphPageRangeKey = 'all';
let graphPageTogglesBound = false;

// Load and render graph
loadSleepData()
  .then((data) => {
    graphPageAllPoints = data.days.map(day => {
      const rawBedMinutes = timeToMinutes(day.bed);
      const rawSleepStartMinutes = timeToMinutes(day.sleepStart);
      const rawGetUpMinutes = timeToMinutes(day.sleepEnd);
      const sleepDuration = calculateTotalSleep(day);
      
      // Calculate main sleep (without nap)
      const sleepStart = timeToMinutes(day.sleepStart);
      const sleepEnd = timeToMinutes(day.sleepEnd);
      const mainSleep = sleepEnd >= sleepStart 
        ? sleepEnd - sleepStart 
        : sleepEnd + 1440 - sleepStart;
      
      // Calculate nap duration if exists
      let napDuration = 0;
      if (day.nap && day.nap.start && day.nap.end) {
        const napStart = timeToMinutes(day.nap.start);
        const napEnd = timeToMinutes(day.nap.end);
        napDuration = napEnd >= napStart 
          ? napEnd - napStart 
          : napEnd + 1440 - napStart;
      }
      
      return {
        date: getDateFromString(day.date),
        bedTimeMinutes: normalizeTimeForYAxis(rawBedMinutes),
        bedTimeRawMinutes: rawBedMinutes, // Keep original for display
        bedTimeString: day.bed,
        sleepStartMinutes: normalizeTimeForYAxis(rawSleepStartMinutes),
        sleepStartRawMinutes: rawSleepStartMinutes, // Keep original for display
        sleepStartString: day.sleepStart,
        getUpMinutes: normalizeTimeForYAxis(rawGetUpMinutes),
        getUpRawMinutes: rawGetUpMinutes, // Keep original for display
        getUpString: day.sleepEnd,
        dateString: day.date,
        sleepDurationMinutes: sleepDuration,
        mainSleepMinutes: mainSleep,
        napMinutes: napDuration,
        wakeDelayMinutes: calculateWakeDelay(day),
        sleepDelayMinutes: calculateSleepDelay(day),
        firstAlarm: day.alarm && day.alarm.length > 0 ? day.alarm[0] : null,
        fragmentation: normalizeFragmentationLevel(day),
        naturalWake: isNaturalWakeDay(day)
      };
    });

    graphPageAllPoints.sort((a, b) => a.date - b.date);

    graphPageRangeKey = defaultGraphRangeKey();

    document.querySelectorAll('.graph-range-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        graphPageRangeKey = btn.dataset.range;
        renderGraphPageCharts();
      });
    });

    window.addEventListener('resize', debounceGraph(() => renderGraphPageCharts(), 200));

    renderGraphPageCharts();
  })
  .catch((error) => {
    console.error('Error loading data:', error);
    document.getElementById('graph-container').innerHTML = '<p>Error loading data</p>';
  });

function renderGraphPageCharts() {
    const points = filterPointsByGraphRange(graphPageAllPoints, graphPageRangeKey);
    clearGraphSvgsAndErrors();
    setActiveGraphRangeButton(graphPageRangeKey);

    if (points.length === 0) {
        const msg = document.createElement('p');
        msg.className = 'chart-error';
        msg.textContent = 'No nights in this range.';
        document.getElementById('graph-container').appendChild(msg);
        return;
    }

    // Y-axis: start from 5pm (17:00 = 1020) and go to 5pm next day (17:00 + 1440 = 2460)
    // This covers: 17:00, 18:00, 19:00, 20:00, 21:00, 22:00, 23:00, 00:00, 01:00, ..., 16:00, 17:00
    const yMin = 1020; // 5pm
    const yMax = 2460; // 5pm next day (17:00 + 1440 = 2460)
    
    // Adjust based on actual data range (include bed times, sleep start times, and get up times)
    const bedTimes = points.map(p => p.bedTimeMinutes);
    const sleepStartTimes = points.map(p => p.sleepStartMinutes);
    const getUpTimes = points.map(p => p.getUpMinutes);
    const allTimes = [...bedTimes, ...sleepStartTimes, ...getUpTimes];
    const dataMin = Math.min(...allTimes);
    const dataMax = Math.max(...allTimes);
    
    // Extend range if needed, but keep 5pm as minimum and 5pm next day as maximum
    const finalYMin = Math.min(yMin, Math.max(1020, dataMin - 30));
    const finalYMax = Math.max(yMax, Math.min(2460, dataMax + 30));

    // Right y-axis: same as left y-axis (time scale)

    // Graph dimensions - increase right margin for second y-axis
    // Extend width to accommodate 10 more days for trend projection
    const totalDays = points.length + 10;
    const margin = { top: 40, right: 80, bottom: 60, left: 80 };
    const outerWidth = graphOuterWidth();
    const minPxPerDay = 12;
    const width = Math.max(outerWidth, totalDays * minPxPerDay);
    const height = 700;
    const graphWidth = width - margin.left - margin.right;
    const graphHeight = height - margin.top - margin.bottom;

    // Create SVG
    const svg = document.getElementById('graph-svg');
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);

    // Create main group
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('transform', `translate(${margin.left},${margin.top})`);
    svg.appendChild(g);

    // X scale (dates) - extend range by 10 days for trend line projection
    const minDate = points[0].date;
    const maxDate = points[points.length - 1].date;
    const extendedMaxDate = new Date(maxDate);
    extendedMaxDate.setDate(extendedMaxDate.getDate() + 10); // Add 10 days
    const dateRange = extendedMaxDate - minDate;
    
    const xScale = (date) => {
      return ((date - minDate) / dateRange) * graphWidth;
    };

    // Calculate width of one day in graph units
    // Use number of days, not milliseconds
    const numDays = points.length;
    const dayWidth = graphWidth / numDays;

    // Y scale (bed times in minutes) - left axis
    const yScale = (minutes) => {
      return graphHeight - ((minutes - finalYMin) / (finalYMax - finalYMin)) * graphHeight;
    };

    // Create standard time ticks: 17:00, 18:00, 19:00, ..., 23:00, 00:00, 01:00, ..., 16:00, 17:00
    const yTicks = [];
    // Start from 5pm (17:00 = 1020) and add hourly ticks up to 5pm next day (17:00 + 1440 = 2460)
    for (let hour = 17; hour <= 41; hour++) {
      const minutes = (hour % 24) * 60;
      // For hours 24-41, add 1440 to make them appear after midnight
      const tickValue = hour < 24 ? minutes : minutes + 1440;
      if (tickValue >= finalYMin && tickValue <= finalYMax) {
        yTicks.push(tickValue);
      }
    }

    // Draw recession bars for weekends and holidays (behind everything)
    // Do this first so they appear behind all other elements
    // Calculate bar width - use a minimum width to ensure visibility
    const barWidth = Math.max(dayWidth, graphWidth / points.length);
    
    points.forEach((point) => {
      const isWeekendDay = isWeekend(point.date);
      const isHolidayDay = isHoliday(point.date);
      
      if (isWeekendDay || isHolidayDay) {
        const x = xScale(point.date);
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        // Center the bar on the data point, make it wider for visibility
        rect.setAttribute('x', x - barWidth / 2);
        rect.setAttribute('y', 0);
        rect.setAttribute('width', barWidth);
        rect.setAttribute('height', graphHeight);
        rect.setAttribute('class', isHolidayDay ? 'recession-bar holiday' : 'recession-bar');
        // Insert at the beginning so it appears behind other elements
        g.insertBefore(rect, g.firstChild);
      }
    });

    yTicks.forEach(tick => {
      const y = yScale(tick);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', 0);
      line.setAttribute('y1', y);
      line.setAttribute('x2', xScale(extendedMaxDate));
      line.setAttribute('y2', y);
      line.setAttribute('class', 'grid-line');
      g.appendChild(line);
    });

    // Draw X-axis - extend to cover the extended range
    const xAxis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    xAxis.setAttribute('x1', 0);
    xAxis.setAttribute('y1', graphHeight);
    xAxis.setAttribute('x2', xScale(extendedMaxDate));
    xAxis.setAttribute('y2', graphHeight);
    xAxis.setAttribute('class', 'axis');
    g.appendChild(xAxis);

    // Draw left Y-axis (bed times)
    const yAxis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    yAxis.setAttribute('x1', 0);
    yAxis.setAttribute('y1', 0);
    yAxis.setAttribute('x2', 0);
    yAxis.setAttribute('y2', graphHeight);
    yAxis.setAttribute('class', 'axis');
    g.appendChild(yAxis);

    // Draw right Y-axis (sleep duration)
    const yAxisRight = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    yAxisRight.setAttribute('x1', graphWidth);
    yAxisRight.setAttribute('y1', 0);
    yAxisRight.setAttribute('x2', graphWidth);
    yAxisRight.setAttribute('y2', graphHeight);
    yAxisRight.setAttribute('class', 'axis');
    g.appendChild(yAxisRight);

    // Draw Y-axis labels and ticks
    yTicks.forEach(tick => {
      const y = yScale(tick);
      const tickLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      tickLine.setAttribute('x1', -5);
      tickLine.setAttribute('y1', y);
      tickLine.setAttribute('x2', 0);
      tickLine.setAttribute('y2', y);
      tickLine.setAttribute('class', 'axis');
      g.appendChild(tickLine);

      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', -10);
      label.setAttribute('y', y + 4);
      label.setAttribute('class', 'axis-label');
      label.setAttribute('text-anchor', 'end');
      // Format tick label: show as 24-hour clock format (hours only, no :00)
      const tickHours = Math.floor(tick / 60) % 24;
      if (tick >= 1440) {
        // After midnight (next day)
        const nextDayHours = Math.floor((tick - 1440) / 60);
        label.textContent = String(nextDayHours).padStart(2, '0');
      } else {
        // Before midnight
        label.textContent = String(tickHours).padStart(2, '0');
      }
      g.appendChild(label);
    });

    // Draw X-axis labels (show only month starts: Jan, Feb, etc.)
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    points.forEach((point, index) => {
      // Check if this is the 1st of the month
      const [month, day] = point.dateString.split('/').map(Number);
      if (day === 1) {
        const x = xScale(point.date);
        const tickLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        tickLine.setAttribute('x1', x);
        tickLine.setAttribute('y1', graphHeight);
        tickLine.setAttribute('x2', x);
        tickLine.setAttribute('y2', graphHeight + 5);
        tickLine.setAttribute('class', 'axis');
        g.appendChild(tickLine);

        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', x);
        label.setAttribute('y', graphHeight + 20);
        label.setAttribute('class', 'axis-label');
        label.setAttribute('text-anchor', 'middle');
        // Show month abbreviation (month is 1-indexed, so subtract 1 for array index)
        label.textContent = monthNames[month - 1];
        g.appendChild(label);
      }
    });

    // Draw axis titles
    const xAxisTitle = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    xAxisTitle.setAttribute('x', margin.left + graphWidth / 2);
    xAxisTitle.setAttribute('y', height - 10);
    xAxisTitle.setAttribute('class', 'axis-title');
    xAxisTitle.setAttribute('text-anchor', 'middle');
    xAxisTitle.textContent = 'Date';
    svg.appendChild(xAxisTitle);

    const yAxisTitle = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    yAxisTitle.setAttribute('x', -height / 2);
    yAxisTitle.setAttribute('y', 20);
    yAxisTitle.setAttribute('class', 'axis-title');
    yAxisTitle.setAttribute('text-anchor', 'middle');
    yAxisTitle.setAttribute('transform', 'rotate(-90)');
    yAxisTitle.textContent = 'Time';
    svg.appendChild(yAxisTitle);

    // Draw right Y-axis labels and ticks (same as left axis)
    yTicks.forEach(tick => {
      const y = yScale(tick);
      const tickLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      tickLine.setAttribute('x1', graphWidth);
      tickLine.setAttribute('y1', y);
      tickLine.setAttribute('x2', graphWidth + 5);
      tickLine.setAttribute('y2', y);
      tickLine.setAttribute('class', 'axis');
      g.appendChild(tickLine);

      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', graphWidth + 10);
      label.setAttribute('y', y + 4);
      label.setAttribute('class', 'axis-label');
      label.setAttribute('text-anchor', 'start');
      // Format tick label: show as 24-hour clock format (hours only, no :00)
      const tickHours = Math.floor(tick / 60) % 24;
      if (tick >= 1440) {
        // After midnight (next day)
        const nextDayHours = Math.floor((tick - 1440) / 60);
        label.textContent = String(nextDayHours).padStart(2, '0');
      } else {
        // Before midnight
        label.textContent = String(tickHours).padStart(2, '0');
      }
      g.appendChild(label);
    });

    const yAxisTitleRight = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    yAxisTitleRight.setAttribute('x', width - 20);
    yAxisTitleRight.setAttribute('y', height / 2);
    yAxisTitleRight.setAttribute('class', 'axis-title');
    yAxisTitleRight.setAttribute('text-anchor', 'middle');
    yAxisTitleRight.setAttribute('transform', `rotate(-90 ${width - 20} ${height / 2})`);
    yAxisTitleRight.textContent = 'Time';
    svg.appendChild(yAxisTitleRight);

    // Draw bed time data line
    const pathBedtime = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    let pathDataBedtime = '';
    points.forEach((point, index) => {
      const x = xScale(point.date);
      const y = yScale(point.bedTimeMinutes);
      if (index === 0) {
        pathDataBedtime += `M ${x} ${y}`;
      } else {
        pathDataBedtime += ` L ${x} ${y}`;
      }
    });
    pathBedtime.setAttribute('d', pathDataBedtime);
    pathBedtime.setAttribute('class', 'data-line bedtime');
    pathBedtime.setAttribute('id', 'bedtime-line');
    g.appendChild(pathBedtime);

    // Draw sleep start (fell asleep) data line
    const pathSleepStart = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    let pathDataSleepStart = '';
    points.forEach((point, index) => {
      const x = xScale(point.date);
      const y = yScale(point.sleepStartMinutes);
      if (index === 0) {
        pathDataSleepStart += `M ${x} ${y}`;
      } else {
        pathDataSleepStart += ` L ${x} ${y}`;
      }
    });
    pathSleepStart.setAttribute('d', pathDataSleepStart);
    pathSleepStart.setAttribute('class', 'data-line sleep-start');
    pathSleepStart.setAttribute('id', 'sleep-start-line');
    g.appendChild(pathSleepStart);

    // Draw get up data line
    const pathGetUp = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    let pathDataGetUp = '';
    points.forEach((point, index) => {
      const x = xScale(point.date);
      const y = yScale(point.getUpMinutes);
      if (index === 0) {
        pathDataGetUp += `M ${x} ${y}`;
      } else {
        pathDataGetUp += ` L ${x} ${y}`;
      }
    });
    pathGetUp.setAttribute('d', pathDataGetUp);
    pathGetUp.setAttribute('class', 'data-line getup');
    pathGetUp.setAttribute('id', 'getup-line');
    g.appendChild(pathGetUp);

    const showNaturalWakeStyle = graphNaturalWakeMarkersOn();
    const breakMasksG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    breakMasksG.setAttribute('class', 'getup-line-break-masks');
    breakMasksG.setAttribute('id', 'getup-line-break-masks');
    if (showNaturalWakeStyle) {
      points.forEach((point) => {
        if (!point.naturalWake) return;
        const x = xScale(point.date);
        const y = yScale(point.getUpMinutes);
        const mask = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        mask.setAttribute('cx', String(x));
        mask.setAttribute('cy', String(y));
        mask.setAttribute('r', '7.5');
        mask.setAttribute('class', 'getup-break-mask');
        breakMasksG.appendChild(mask);
      });
    }
    g.appendChild(breakMasksG);

    // Calculate polynomial regression for get up times (quadratic, degree 2)
    const getUpXValues = points.map((point, index) => index);
    const getUpYValues = points.map(point => point.getUpMinutes);
    const getUpRegression = polynomialRegression(getUpXValues, getUpYValues, regressionDegree(points.length));
    
    // Calculate polynomial regression for sleep start times
    const sleepStartXValues = points.map((point, index) => index);
    const sleepStartYValues = points.map(point => point.sleepStartMinutes);
    const sleepStartRegression = polynomialRegression(sleepStartXValues, sleepStartYValues, regressionDegree(points.length));
    
    // Calculate polynomial regression for bed time (quadratic, degree 2)
    const bedtimeXValues = points.map((point, index) => index);
    const bedtimeYValues = points.map(point => point.bedTimeMinutes);
    const bedtimeRegression = polynomialRegression(bedtimeXValues, bedtimeYValues, regressionDegree(points.length));

    // Draw get up regression curve - extend 10 more days
    const getUpRegPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    let getUpPathData = '';
    const extendedIndex = points.length - 1 + 10;
    // Generate curve points for smooth rendering
    for (let i = 0; i <= extendedIndex; i++) {
      const x = xScale(new Date(minDate.getTime() + i * 24 * 60 * 60 * 1000));
      const y = yScale(evaluatePolynomial(getUpRegression, i));
      if (i === 0) {
        getUpPathData += `M ${x} ${y}`;
      } else {
        getUpPathData += ` L ${x} ${y}`;
      }
    }
    getUpRegPath.setAttribute('d', getUpPathData);
    getUpRegPath.setAttribute('class', 'regression-line getup-regression');
    getUpRegPath.setAttribute('id', 'getup-regression-line');
    getUpRegPath.setAttribute('fill', 'none');
    g.appendChild(getUpRegPath);

    // Draw sleep start regression curve - extend 10 more days
    const sleepStartRegPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    let sleepStartPathData = '';
    // Generate curve points for smooth rendering
    for (let i = 0; i <= extendedIndex; i++) {
      const x = xScale(new Date(minDate.getTime() + i * 24 * 60 * 60 * 1000));
      const y = yScale(evaluatePolynomial(sleepStartRegression, i));
      if (i === 0) {
        sleepStartPathData += `M ${x} ${y}`;
      } else {
        sleepStartPathData += ` L ${x} ${y}`;
      }
    }
    sleepStartRegPath.setAttribute('d', sleepStartPathData);
    sleepStartRegPath.setAttribute('class', 'regression-line sleep-start-regression');
    sleepStartRegPath.setAttribute('id', 'sleep-start-regression-line');
    sleepStartRegPath.setAttribute('fill', 'none');
    g.appendChild(sleepStartRegPath);

    // Draw bed time regression curve - extend 10 more days
    const bedtimeRegPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    let bedtimePathData = '';
    // Generate curve points for smooth rendering
    for (let i = 0; i <= extendedIndex; i++) {
      const x = xScale(new Date(minDate.getTime() + i * 24 * 60 * 60 * 1000));
      const y = yScale(evaluatePolynomial(bedtimeRegression, i));
      if (i === 0) {
        bedtimePathData += `M ${x} ${y}`;
      } else {
        bedtimePathData += ` L ${x} ${y}`;
      }
    }
    bedtimeRegPath.setAttribute('d', bedtimePathData);
    bedtimeRegPath.setAttribute('class', 'regression-line bedtime-regression');
    bedtimeRegPath.setAttribute('id', 'bedtime-regression-line');
    bedtimeRegPath.setAttribute('fill', 'none');
    g.appendChild(bedtimeRegPath);

    // Draw data points
    const tooltip = document.getElementById('tooltip');
    
    // Create vertical hover line indicator
    const hoverLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    hoverLine.setAttribute('class', 'hover-line');
    hoverLine.style.display = 'none';
    hoverLine.setAttribute('x1', 0);
    hoverLine.setAttribute('y1', 0);
    hoverLine.setAttribute('x2', 0);
    hoverLine.setAttribute('y2', graphHeight);
    hoverLine.setAttribute('stroke', 'rgba(255, 255, 255, 0.3)');
    hoverLine.setAttribute('stroke-width', '1');
    hoverLine.setAttribute('stroke-dasharray', '4,4');
    g.appendChild(hoverLine);
    
    // Bed time points
    points.forEach(point => {
      const x = xScale(point.date);
      const y = yScale(point.bedTimeMinutes);
      
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', x);
      circle.setAttribute('cy', y);
      circle.setAttribute('r', 3);
      circle.setAttribute('class', 'data-point bedtime bedtime-point');
      circle.setAttribute('data-date', point.dateString);
      circle.setAttribute('data-time', point.bedTimeString);
      
      g.appendChild(circle);
    });

    // Sleep start (fell asleep) points
    points.forEach(point => {
      const x = xScale(point.date);
      const y = yScale(point.sleepStartMinutes);
      
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', x);
      circle.setAttribute('cy', y);
      circle.setAttribute('r', 3);
      circle.setAttribute('class', 'data-point sleep-start sleep-start-point');
      circle.setAttribute('data-date', point.dateString);
      circle.setAttribute('data-time', point.sleepStartString);
      
      g.appendChild(circle);
    });

    const showAlarmWakeMarkers = graphAlarmWakeMarkersOn();
    const getupMarkersG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    getupMarkersG.setAttribute('id', 'getup-markers-group');
    points.forEach((point) => {
      const x = xScale(point.date);
      const y = yScale(point.getUpMinutes);
      const xStr = String(x);
      const yStr = String(y);

      if (point.naturalWake && showNaturalWakeStyle) {
        const ng = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        ng.setAttribute('class', 'getup-natural-wake-group');
        const ringOuter = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        ringOuter.setAttribute('cx', xStr);
        ringOuter.setAttribute('cy', yStr);
        ringOuter.setAttribute('r', '7.5');
        ringOuter.setAttribute('class', 'getup-natural-ring-outer getup-marker--natural');
        const ringInner = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        ringInner.setAttribute('cx', xStr);
        ringInner.setAttribute('cy', yStr);
        ringInner.setAttribute('r', '5.5');
        ringInner.setAttribute('class', 'getup-natural-ring-inner getup-marker--natural');
        const core = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        core.setAttribute('cx', xStr);
        core.setAttribute('cy', yStr);
        core.setAttribute('r', '3');
        core.setAttribute('class', 'data-point getup getup-point getup-marker--natural getup-natural-core');
        core.setAttribute('data-date', point.dateString);
        core.setAttribute('data-time', point.getUpString);
        ng.appendChild(ringOuter);
        ng.appendChild(ringInner);
        ng.appendChild(core);
        getupMarkersG.appendChild(ng);
      } else if (point.naturalWake && !showNaturalWakeStyle && showAlarmWakeMarkers) {
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', xStr);
        circle.setAttribute('cy', yStr);
        circle.setAttribute('r', '3');
        circle.setAttribute('class', 'data-point getup getup-point getup-marker--alarm');
        circle.setAttribute('data-date', point.dateString);
        circle.setAttribute('data-time', point.getUpString);
        getupMarkersG.appendChild(circle);
      } else if (!point.naturalWake && showAlarmWakeMarkers) {
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', xStr);
        circle.setAttribute('cy', yStr);
        circle.setAttribute('r', '3');
        circle.setAttribute('class', 'data-point getup getup-point getup-marker--alarm');
        circle.setAttribute('data-date', point.dateString);
        circle.setAttribute('data-time', point.getUpString);
        getupMarkersG.appendChild(circle);
      }
    });
    g.appendChild(getupMarkersG);
    
    // Create invisible hover areas for each day (after points so they're on top for interaction)
    // Calculate non-overlapping hover areas by using midpoints between days
    points.forEach((point, index) => {
      const x = xScale(point.date);
      const bedtimeY = yScale(point.bedTimeMinutes);
      const sleepStartY = yScale(point.sleepStartMinutes);
      const getupY = yScale(point.getUpMinutes);
      
      // Calculate left and right boundaries for this day's hover area
      let leftBoundary, rightBoundary;
      
      if (index === 0) {
        // First day: extend to left edge or half way to next day
        const nextX = index < points.length - 1 ? xScale(points[index + 1].date) : x + dayWidth;
        leftBoundary = Math.max(0, x - (nextX - x) / 2);
        rightBoundary = index < points.length - 1 ? (x + nextX) / 2 : x + dayWidth / 2;
      } else if (index === points.length - 1) {
        // Last day: extend from previous day's midpoint to right edge
        const prevX = xScale(points[index - 1].date);
        leftBoundary = (prevX + x) / 2;
        rightBoundary = Math.min(graphWidth, x + dayWidth / 2);
      } else {
        // Middle days: extend from midpoint with previous to midpoint with next
        const prevX = xScale(points[index - 1].date);
        const nextX = xScale(points[index + 1].date);
        leftBoundary = (prevX + x) / 2;
        rightBoundary = (x + nextX) / 2;
      }
      
      const hoverAreaWidth = rightBoundary - leftBoundary;
      
      // Create invisible rectangle covering the full height for this day
      const hoverRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      hoverRect.setAttribute('x', leftBoundary);
      hoverRect.setAttribute('y', 0);
      hoverRect.setAttribute('width', hoverAreaWidth);
      hoverRect.setAttribute('height', graphHeight);
      hoverRect.setAttribute('class', 'day-hover-area');
      hoverRect.style.fill = 'transparent';
      hoverRect.style.cursor = 'pointer';
      hoverRect.style.pointerEvents = 'all';
      
      hoverRect.addEventListener('mouseenter', () => {
        // Show vertical line
        hoverLine.setAttribute('x1', x);
        hoverLine.setAttribute('x2', x);
        hoverLine.setAttribute('y1', 0);
        hoverLine.setAttribute('y2', graphHeight);
        hoverLine.style.display = 'block';
        
        // Get SVG position relative to viewport and show shared day panel
        const svgRect = svg.getBoundingClientRect();
        const baseX = svgRect.left + margin.left + x;
        const baseY = svgRect.top + margin.top;
        showDayPanel(point, baseX, baseY + graphHeight / 2);
      });
      
      hoverRect.addEventListener('mouseleave', () => {
        hoverLine.style.display = 'none';
        hideDayPanel();
      });
      
      // Add at the end so it's on top for interaction but transparent
      g.appendChild(hoverRect);
    });

    const GRAPH_DATA_LINE_IDS = ['show-bedtime-line', 'show-sleep-start-line', 'show-getup-line'];
    const GRAPH_TREND_LINE_IDS = ['show-bedtime-regression', 'show-sleep-start-regression', 'show-getup-regression'];

    function syncGraphMasterDataCheckbox() {
      const master = document.getElementById('show-all-data-lines');
      if (!master) return;
      const boxes = GRAPH_DATA_LINE_IDS.map((id) => document.getElementById(id)).filter(Boolean);
      if (!boxes.length) return;
      const on = boxes.filter((b) => b.checked).length;
      master.indeterminate = on > 0 && on < boxes.length;
      master.checked = on === boxes.length;
    }

    function syncGraphMasterTrendCheckbox() {
      const master = document.getElementById('show-all-trend-lines');
      if (!master) return;
      const boxes = GRAPH_TREND_LINE_IDS.map((id) => document.getElementById(id)).filter(Boolean);
      if (!boxes.length) return;
      const on = boxes.filter((b) => b.checked).length;
      master.indeterminate = on > 0 && on < boxes.length;
      master.checked = on === boxes.length;
    }

    function applyGraphMasterGroup(ids, checked) {
      ids.forEach((id) => {
        const el = document.getElementById(id);
        if (!el || el.checked === checked) return;
        el.checked = checked;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }

    // Set up show/hide toggle handlers
    function setupCheckbox(id, toggleFn) {
      const checkbox = document.getElementById(id);
      if (checkbox) {
        checkbox.addEventListener('change', (e) => toggleFn(e.target.checked));
        toggleFn(checkbox.checked);
      }
    }

    function toggleBedtimeLine(show) {
      const line = document.getElementById('bedtime-line');
      const points = document.querySelectorAll('.bedtime-point');
      if (line) {
        line.style.display = show ? 'block' : 'none';
      }
      points.forEach(point => {
        point.style.display = show ? 'block' : 'none';
      });
    }

    function toggleSleepStartLine(show) {
      const line = document.getElementById('sleep-start-line');
      const points = document.querySelectorAll('.sleep-start-point');
      if (line) {
        line.style.display = show ? 'block' : 'none';
      }
      points.forEach(point => {
        point.style.display = show ? 'block' : 'none';
      });
    }

    function toggleGetUpLine(show) {
      const line = document.getElementById('getup-line');
      const masks = document.getElementById('getup-line-break-masks');
      const markerGroup = document.getElementById('getup-markers-group');
      const alarmWakeCh = document.getElementById('show-alarm-wake-markers');
      const naturalWakeCh = document.getElementById('show-natural-wake-markers');
      if (line) {
        line.style.display = show ? 'block' : 'none';
      }
      if (masks) {
        masks.style.display = show ? 'block' : 'none';
      }
      if (markerGroup) {
        markerGroup.style.display = show ? 'block' : 'none';
      }
      [alarmWakeCh, naturalWakeCh].forEach((el) => {
        if (!el) return;
        el.disabled = !show;
        el.setAttribute('aria-disabled', show ? 'false' : 'true');
      });
    }

    function toggleGetUpRegression(show) {
      const line = document.getElementById('getup-regression-line');
      if (line) {
        line.style.display = show ? 'block' : 'none';
      }
    }

    function toggleSleepStartRegression(show) {
      const line = document.getElementById('sleep-start-regression-line');
      if (line) {
        line.style.display = show ? 'block' : 'none';
      }
    }

    function toggleBedtimeRegression(show) {
      const line = document.getElementById('bedtime-regression-line');
      if (line) {
        line.style.display = show ? 'block' : 'none';
      }
    }

    if (!graphPageTogglesBound) {
      graphPageTogglesBound = true;

      const masterData = document.getElementById('show-all-data-lines');
      const masterTrend = document.getElementById('show-all-trend-lines');
      if (masterData) {
        masterData.addEventListener('change', () => {
          masterData.indeterminate = false;
          applyGraphMasterGroup(GRAPH_DATA_LINE_IDS, masterData.checked);
          syncGraphMasterDataCheckbox();
        });
      }
      if (masterTrend) {
        masterTrend.addEventListener('change', () => {
          masterTrend.indeterminate = false;
          applyGraphMasterGroup(GRAPH_TREND_LINE_IDS, masterTrend.checked);
          syncGraphMasterTrendCheckbox();
        });
      }
      GRAPH_DATA_LINE_IDS.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', syncGraphMasterDataCheckbox);
      });
      GRAPH_TREND_LINE_IDS.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', syncGraphMasterTrendCheckbox);
      });

      setupCheckbox('show-bedtime-line', toggleBedtimeLine);
      setupCheckbox('show-sleep-start-line', toggleSleepStartLine);
      setupCheckbox('show-getup-line', toggleGetUpLine);
      ['show-alarm-wake-markers', 'show-natural-wake-markers'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', () => renderGraphPageCharts());
      });
      setupCheckbox('show-getup-regression', toggleGetUpRegression);
      setupCheckbox('show-sleep-start-regression', toggleSleepStartRegression);
      setupCheckbox('show-bedtime-regression', toggleBedtimeRegression);
      syncGraphMasterDataCheckbox();
      syncGraphMasterTrendCheckbox();
    } else {
      const bedCh = document.getElementById('show-bedtime-line');
      const sleepCh = document.getElementById('show-sleep-start-line');
      const getupCh = document.getElementById('show-getup-line');
      const getupRegCh = document.getElementById('show-getup-regression');
      const sleepRegCh = document.getElementById('show-sleep-start-regression');
      const bedRegCh = document.getElementById('show-bedtime-regression');
      if (bedCh) toggleBedtimeLine(bedCh.checked);
      if (sleepCh) toggleSleepStartLine(sleepCh.checked);
      if (getupCh) toggleGetUpLine(getupCh.checked);
      if (getupRegCh) toggleGetUpRegression(getupRegCh.checked);
      if (sleepRegCh) toggleSleepStartRegression(sleepRegCh.checked);
      if (bedRegCh) toggleBedtimeRegression(bedRegCh.checked);
      syncGraphMasterDataCheckbox();
      syncGraphMasterTrendCheckbox();
    }

    // ===== BAR CHART: Sleep Duration Per Day =====
    try {
    // Verify required variables are available
    if (typeof xScale === 'undefined' || typeof dayWidth === 'undefined' || typeof monthNames === 'undefined' || !points) {
      throw new Error('Required variables not available for bar chart');
    }
    
    // Use same dimensions and scales as main graph
    const barChartMargin = { top: 40, right: 80, bottom: 60, left: 80 };
    const barChartWidth = width;
    const barChartHeight = 500;
    const barChartGraphWidth = barChartWidth - barChartMargin.left - barChartMargin.right;
    const barChartGraphHeight = barChartHeight - barChartMargin.top - barChartMargin.bottom;

    // Create bar chart SVG
    const barChartSvg = document.getElementById('bar-chart-svg');
    if (!barChartSvg) {
      throw new Error('Bar chart SVG element not found');
    }
    barChartSvg.setAttribute('width', barChartWidth);
    barChartSvg.setAttribute('height', barChartHeight);

    // Create main group for bar chart
    const barChartG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    barChartG.setAttribute('transform', `translate(${barChartMargin.left},${barChartMargin.top})`);
    barChartSvg.appendChild(barChartG);

    // Y scale for sleep duration (3 hours = 180 minutes to 14 hours = 840 minutes)
    const sleepYMin = 180; // 3 hours
    const sleepYMax = 840; // 14 hours
    const sleepYScale = (minutes) => {
      return barChartGraphHeight - ((minutes - sleepYMin) / (sleepYMax - sleepYMin)) * barChartGraphHeight;
    };

    // Create Y-axis ticks (3h to 14h in 1 hour increments)
    const sleepYTicks = [];
    for (let hour = 3; hour <= 14; hour++) {
      sleepYTicks.push(hour * 60); // Convert to minutes
    }

    // Draw grid lines for bar chart
    sleepYTicks.forEach(tick => {
      const y = sleepYScale(tick);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', 0);
      line.setAttribute('y1', y);
      line.setAttribute('x2', barChartGraphWidth);
      line.setAttribute('y2', y);
      line.setAttribute('class', 'grid-line');
      barChartG.appendChild(line);
    });

    // Draw X-axis for bar chart
    const barChartXAxis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    barChartXAxis.setAttribute('x1', 0);
    barChartXAxis.setAttribute('y1', barChartGraphHeight);
    barChartXAxis.setAttribute('x2', barChartGraphWidth);
    barChartXAxis.setAttribute('y2', barChartGraphHeight);
    barChartXAxis.setAttribute('class', 'axis');
    barChartG.appendChild(barChartXAxis);

    // Draw Y-axis for bar chart (left and right, same scale)
    const barChartYAxis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    barChartYAxis.setAttribute('x1', 0);
    barChartYAxis.setAttribute('y1', 0);
    barChartYAxis.setAttribute('x2', 0);
    barChartYAxis.setAttribute('y2', barChartGraphHeight);
    barChartYAxis.setAttribute('class', 'axis');
    barChartG.appendChild(barChartYAxis);

    const barChartYAxisRight = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    barChartYAxisRight.setAttribute('x1', barChartGraphWidth);
    barChartYAxisRight.setAttribute('y1', 0);
    barChartYAxisRight.setAttribute('x2', barChartGraphWidth);
    barChartYAxisRight.setAttribute('y2', barChartGraphHeight);
    barChartYAxisRight.setAttribute('class', 'axis');
    barChartG.appendChild(barChartYAxisRight);

    // Draw Y-axis labels and ticks for bar chart (left)
    sleepYTicks.forEach(tick => {
      const y = sleepYScale(tick);
      const tickLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      tickLine.setAttribute('x1', -5);
      tickLine.setAttribute('y1', y);
      tickLine.setAttribute('x2', 0);
      tickLine.setAttribute('y2', y);
      tickLine.setAttribute('class', 'axis');
      barChartG.appendChild(tickLine);

      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', -10);
      label.setAttribute('y', y + 4);
      label.setAttribute('class', 'axis-label');
      label.setAttribute('text-anchor', 'end');
      label.textContent = `${tick / 60}h`;
      barChartG.appendChild(label);
    });

    // Draw X-axis labels (same as main graph - month starts)
    points.forEach((point) => {
      const [month, day] = point.dateString.split('/').map(Number);
      if (day === 1) {
        const x = xScale(point.date);
        const tickLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        tickLine.setAttribute('x1', x);
        tickLine.setAttribute('y1', barChartGraphHeight);
        tickLine.setAttribute('x2', x);
        tickLine.setAttribute('y2', barChartGraphHeight + 5);
        tickLine.setAttribute('class', 'axis');
        barChartG.appendChild(tickLine);

        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', x);
        label.setAttribute('y', barChartGraphHeight + 20);
        label.setAttribute('class', 'axis-label');
        label.setAttribute('text-anchor', 'middle');
        label.textContent = monthNames[month - 1];
        barChartG.appendChild(label);
      }
    });

    // Draw axis titles for bar chart
    const barChartXAxisTitle = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    barChartXAxisTitle.setAttribute('x', barChartMargin.left + barChartGraphWidth / 2);
    barChartXAxisTitle.setAttribute('y', barChartHeight - 10);
    barChartXAxisTitle.setAttribute('class', 'axis-title');
    barChartXAxisTitle.setAttribute('text-anchor', 'middle');
    barChartXAxisTitle.textContent = 'Date';
    barChartSvg.appendChild(barChartXAxisTitle);

    const barChartYAxisTitle = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    barChartYAxisTitle.setAttribute('x', -barChartHeight / 2);
    barChartYAxisTitle.setAttribute('y', 20);
    barChartYAxisTitle.setAttribute('class', 'axis-title');
    barChartYAxisTitle.setAttribute('text-anchor', 'middle');
    barChartYAxisTitle.setAttribute('transform', 'rotate(-90)');
    barChartYAxisTitle.textContent = 'Hours';
    barChartSvg.appendChild(barChartYAxisTitle);

    sleepYTicks.forEach((tick) => {
      const y = sleepYScale(tick);
      const tickLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      tickLine.setAttribute('x1', barChartGraphWidth);
      tickLine.setAttribute('y1', y);
      tickLine.setAttribute('x2', barChartGraphWidth + 5);
      tickLine.setAttribute('y2', y);
      tickLine.setAttribute('class', 'axis');
      barChartG.appendChild(tickLine);

      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', barChartGraphWidth + 10);
      label.setAttribute('y', y + 4);
      label.setAttribute('class', 'axis-label');
      label.setAttribute('text-anchor', 'start');
      label.textContent = `${tick / 60}h`;
      barChartG.appendChild(label);
    });

    const barChartYAxisTitleRight = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    barChartYAxisTitleRight.setAttribute('x', barChartWidth - 20);
    barChartYAxisTitleRight.setAttribute('y', barChartHeight / 2);
    barChartYAxisTitleRight.setAttribute('class', 'axis-title');
    barChartYAxisTitleRight.setAttribute('text-anchor', 'middle');
    barChartYAxisTitleRight.setAttribute('transform', `rotate(-90 ${barChartWidth - 20} ${barChartHeight / 2})`);
    barChartYAxisTitleRight.textContent = 'Hours';
    barChartSvg.appendChild(barChartYAxisTitleRight);

    // Draw bars for sleep duration
    const barWidth = Math.max(2, dayWidth * 0.8); // 80% of day width, minimum 2px
    points.forEach((point) => {
      const x = xScale(point.date);
      const sleepDurationMinutes = point.sleepDurationMinutes;
      const mainSleepMinutes = point.mainSleepMinutes;
      const napMinutes = point.napMinutes;
      
      // Draw main sleep bar (bottom portion)
      const mainSleepBarY = sleepYScale(mainSleepMinutes);
      const mainSleepBarHeight = barChartGraphHeight - mainSleepBarY;
      
      const mainRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      mainRect.setAttribute('x', x - barWidth / 2);
      mainRect.setAttribute('y', mainSleepBarY);
      mainRect.setAttribute('width', barWidth);
      mainRect.setAttribute('height', mainSleepBarHeight);
      mainRect.setAttribute('class', 'sleep-bar');
      mainRect.setAttribute('data-date', point.dateString);
      mainRect.setAttribute('data-sleep', mainSleepMinutes);

      // Add hover events
      mainRect.addEventListener('mouseenter', () => {
        const napText = napMinutes > 0 ? ` (${formatDuration(mainSleepMinutes)} + ${formatDuration(napMinutes)} nap)` : '';
        tooltip.textContent = `${point.dateString}: ${formatDuration(sleepDurationMinutes)}${napText}`;
        tooltip.classList.add('visible');
      });

      mainRect.addEventListener('mousemove', (e) => {
        tooltip.style.left = (e.clientX + 10) + 'px';
        tooltip.style.top = (e.clientY - 10) + 'px';
      });

      mainRect.addEventListener('mouseleave', () => {
        tooltip.classList.remove('visible');
      });

      barChartG.appendChild(mainRect);
      appendSvgSleepBarFragmentation(barChartG, x - barWidth / 2, mainSleepBarY, barWidth, mainSleepBarHeight, point.fragmentation);
      
      // Draw nap bar (top portion) if nap exists
      if (napMinutes > 0) {
        const napBarY = sleepYScale(sleepDurationMinutes);
        const napBarHeight = mainSleepBarY - napBarY;
        
        const napRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        napRect.setAttribute('x', x - barWidth / 2);
        napRect.setAttribute('y', napBarY);
        napRect.setAttribute('width', barWidth);
        napRect.setAttribute('height', napBarHeight);
        napRect.setAttribute('class', 'sleep-bar nap-bar');
        napRect.setAttribute('data-date', point.dateString);
        napRect.setAttribute('data-sleep', napMinutes);

        // Add hover events for nap bar
        napRect.addEventListener('mouseenter', () => {
          tooltip.textContent = `${point.dateString}: ${formatDuration(sleepDurationMinutes)} (${formatDuration(mainSleepMinutes)} + ${formatDuration(napMinutes)} nap)`;
          tooltip.classList.add('visible');
        });

        napRect.addEventListener('mousemove', (e) => {
          tooltip.style.left = (e.clientX + 10) + 'px';
          tooltip.style.top = (e.clientY - 10) + 'px';
        });

        napRect.addEventListener('mouseleave', () => {
          tooltip.classList.remove('visible');
        });

        barChartG.appendChild(napRect);
        appendSvgSleepBarFragmentation(barChartG, x - barWidth / 2, napBarY, barWidth, napBarHeight, point.fragmentation);
      }
    });

    // Calculate polynomial regression for sleep duration
    const sleepXValues = points.map((point, index) => index);
    const sleepYValues = points.map(point => point.sleepDurationMinutes);
    const sleepRegression = polynomialRegression(sleepXValues, sleepYValues, regressionDegree(points.length));

    // Draw trend curve for sleep duration
    const sleepTrendPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    let sleepTrendPathData = '';
    // Generate curve points for smooth rendering
    for (let i = 0; i < points.length; i++) {
      const x = xScale(points[i].date);
      const y = sleepYScale(evaluatePolynomial(sleepRegression, i));
      if (i === 0) {
        sleepTrendPathData += `M ${x} ${y}`;
      } else {
        sleepTrendPathData += ` L ${x} ${y}`;
      }
    }
    sleepTrendPath.setAttribute('d', sleepTrendPathData);
    sleepTrendPath.setAttribute('class', 'regression-line sleep-trend');
    sleepTrendPath.setAttribute('id', 'sleep-trend-line');
    sleepTrendPath.setAttribute('fill', 'none');
    barChartG.appendChild(sleepTrendPath);
    } catch (barChartError) {
      console.error('Error rendering bar chart:', barChartError);
      const errorDiv = document.createElement('div');
      errorDiv.style.cssText = 'color: red; padding: 10px; background: rgba(255,0,0,0.1); margin: 10px 0;';
      errorDiv.textContent = 'Bar chart error: ' + barChartError.message;
      document.getElementById('bar-chart-container').appendChild(errorDiv);
    }

    // ===== WAKE DELAY CHART: first alarm → get up (positive bars only) =====
    try {
      if (typeof xScale === 'undefined' || typeof dayWidth === 'undefined' || typeof monthNames === 'undefined' || !points) {
        throw new Error('Required variables not available for wake delay chart');
      }

      const wakeChartMargin = { top: 40, right: 80, bottom: 60, left: 80 };
      const wakeChartWidth = width;
      const wakeChartHeight = 500;
      const wakeChartGraphWidth = wakeChartWidth - wakeChartMargin.left - wakeChartMargin.right;
      const wakeChartGraphHeight = wakeChartHeight - wakeChartMargin.top - wakeChartMargin.bottom;

      const wakeChartSvg = document.getElementById('delay-chart-svg');
      if (!wakeChartSvg) {
        throw new Error('Wake delay chart SVG element not found');
      }
      wakeChartSvg.setAttribute('width', wakeChartWidth);
      wakeChartSvg.setAttribute('height', wakeChartHeight);

      const wakeChartG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      wakeChartG.setAttribute('transform', `translate(${wakeChartMargin.left},${wakeChartMargin.top})`);
      wakeChartSvg.appendChild(wakeChartG);

      const wakeVals = points.map((p) => p.wakeDelayMinutes).filter((v) => v != null && v > 0);
      const wakeMaxData = wakeVals.length ? Math.max(...wakeVals) : 0;
      const wakeYMax = Math.max(180, Math.ceil(wakeMaxData / 60) * 60);

      const wakeYScale = (minutes) =>
        wakeChartGraphHeight - (minutes / wakeYMax) * wakeChartGraphHeight;

      const wakeYTicks = [];
      const wakeTickStep = wakeYMax <= 120 ? 30 : 60;
      for (let m = 0; m <= wakeYMax; m += wakeTickStep) {
        wakeYTicks.push(m);
      }
      if (wakeYTicks[wakeYTicks.length - 1] !== wakeYMax) {
        wakeYTicks.push(wakeYMax);
      }

      wakeYTicks.forEach((tick) => {
        const y = wakeYScale(tick);
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', 0);
        line.setAttribute('y1', y);
        line.setAttribute('x2', wakeChartGraphWidth);
        line.setAttribute('y2', y);
        line.setAttribute('class', 'grid-line');
        if (tick === 0) line.setAttribute('stroke-width', '2');
        wakeChartG.appendChild(line);
      });

      const wakeChartXAxis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      wakeChartXAxis.setAttribute('x1', 0);
      wakeChartXAxis.setAttribute('y1', wakeChartGraphHeight);
      wakeChartXAxis.setAttribute('x2', wakeChartGraphWidth);
      wakeChartXAxis.setAttribute('y2', wakeChartGraphHeight);
      wakeChartXAxis.setAttribute('class', 'axis');
      wakeChartG.appendChild(wakeChartXAxis);

      const wakeChartYAxis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      wakeChartYAxis.setAttribute('x1', 0);
      wakeChartYAxis.setAttribute('y1', 0);
      wakeChartYAxis.setAttribute('x2', 0);
      wakeChartYAxis.setAttribute('y2', wakeChartGraphHeight);
      wakeChartYAxis.setAttribute('class', 'axis');
      wakeChartG.appendChild(wakeChartYAxis);

      const wakeChartYAxisRight = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      wakeChartYAxisRight.setAttribute('x1', wakeChartGraphWidth);
      wakeChartYAxisRight.setAttribute('y1', 0);
      wakeChartYAxisRight.setAttribute('x2', wakeChartGraphWidth);
      wakeChartYAxisRight.setAttribute('y2', wakeChartGraphHeight);
      wakeChartYAxisRight.setAttribute('class', 'axis');
      wakeChartG.appendChild(wakeChartYAxisRight);

      wakeYTicks.forEach((tick) => {
        const y = wakeYScale(tick);
        const tickLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        tickLine.setAttribute('x1', -5);
        tickLine.setAttribute('y1', y);
        tickLine.setAttribute('x2', 0);
        tickLine.setAttribute('y2', y);
        tickLine.setAttribute('class', 'axis');
        wakeChartG.appendChild(tickLine);

        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', -10);
        label.setAttribute('y', y + 4);
        label.setAttribute('class', 'axis-label');
        label.setAttribute('text-anchor', 'end');
        label.textContent = tick % 60 === 0 ? `${tick / 60}h` : `${tick}m`;
        wakeChartG.appendChild(label);
      });

      points.forEach((point) => {
        const [month, day] = point.dateString.split('/').map(Number);
        if (day === 1) {
          const x = xScale(point.date);
          const tickLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          tickLine.setAttribute('x1', x);
          tickLine.setAttribute('y1', wakeChartGraphHeight);
          tickLine.setAttribute('x2', x);
          tickLine.setAttribute('y2', wakeChartGraphHeight + 5);
          tickLine.setAttribute('class', 'axis');
          wakeChartG.appendChild(tickLine);

          const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          label.setAttribute('x', x);
          label.setAttribute('y', wakeChartGraphHeight + 20);
          label.setAttribute('class', 'axis-label');
          label.setAttribute('text-anchor', 'middle');
          label.textContent = monthNames[month - 1];
          wakeChartG.appendChild(label);
        }
      });

      const wakeChartXAxisTitle = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      wakeChartXAxisTitle.setAttribute('x', wakeChartMargin.left + wakeChartGraphWidth / 2);
      wakeChartXAxisTitle.setAttribute('y', wakeChartHeight - 10);
      wakeChartXAxisTitle.setAttribute('class', 'axis-title');
      wakeChartXAxisTitle.setAttribute('text-anchor', 'middle');
      wakeChartXAxisTitle.textContent = 'Date';
      wakeChartSvg.appendChild(wakeChartXAxisTitle);

      const wakeChartYAxisTitle = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      wakeChartYAxisTitle.setAttribute('x', -wakeChartHeight / 2);
      wakeChartYAxisTitle.setAttribute('y', 20);
      wakeChartYAxisTitle.setAttribute('class', 'axis-title');
      wakeChartYAxisTitle.setAttribute('text-anchor', 'middle');
      wakeChartYAxisTitle.setAttribute('transform', 'rotate(-90)');
      wakeChartYAxisTitle.textContent = 'Delay';
      wakeChartSvg.appendChild(wakeChartYAxisTitle);

      wakeYTicks.forEach((tick) => {
        const y = wakeYScale(tick);
        const tickLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        tickLine.setAttribute('x1', wakeChartGraphWidth);
        tickLine.setAttribute('y1', y);
        tickLine.setAttribute('x2', wakeChartGraphWidth + 5);
        tickLine.setAttribute('y2', y);
        tickLine.setAttribute('class', 'axis');
        wakeChartG.appendChild(tickLine);

        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', wakeChartGraphWidth + 10);
        label.setAttribute('y', y + 4);
        label.setAttribute('class', 'axis-label');
        label.setAttribute('text-anchor', 'start');
        label.textContent = tick % 60 === 0 ? `${tick / 60}h` : `${tick}m`;
        wakeChartG.appendChild(label);
      });

      const wakeChartYAxisTitleRight = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      wakeChartYAxisTitleRight.setAttribute('x', wakeChartWidth - 20);
      wakeChartYAxisTitleRight.setAttribute('y', wakeChartHeight / 2);
      wakeChartYAxisTitleRight.setAttribute('class', 'axis-title');
      wakeChartYAxisTitleRight.setAttribute('text-anchor', 'middle');
      wakeChartYAxisTitleRight.setAttribute('transform', `rotate(-90 ${wakeChartWidth - 20} ${wakeChartHeight / 2})`);
      wakeChartYAxisTitleRight.textContent = 'Delay';
      wakeChartSvg.appendChild(wakeChartYAxisTitleRight);

      const wakeBarWidth = Math.max(2, dayWidth * 0.8);
      points.forEach((point) => {
        const x = xScale(point.date);
        if (point.wakeDelayMinutes !== null && point.wakeDelayMinutes !== undefined && point.wakeDelayMinutes > 0) {
          const wakeDelayBarY = wakeYScale(point.wakeDelayMinutes);
          const wakeDelayBarHeight = wakeChartGraphHeight - wakeDelayBarY;
          if (wakeDelayBarHeight > 0 && !isNaN(wakeDelayBarHeight)) {
            const wakeDelayRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            wakeDelayRect.setAttribute('x', x - wakeBarWidth / 2);
            wakeDelayRect.setAttribute('y', wakeDelayBarY);
            wakeDelayRect.setAttribute('width', wakeBarWidth);
            wakeDelayRect.setAttribute('height', wakeDelayBarHeight);
            wakeDelayRect.setAttribute('class', 'sleep-bar wake-delay-bar');

            wakeDelayRect.addEventListener('mouseenter', () => {
              const alarmText = point.firstAlarm ? ` (alarm ${point.firstAlarm} → get up ${point.getUpString})` : '';
              tooltip.textContent = `${point.dateString}: ${formatDuration(point.wakeDelayMinutes)} wake delay${alarmText}`;
              tooltip.classList.add('visible');
            });
            wakeDelayRect.addEventListener('mousemove', (e) => {
              tooltip.style.left = (e.clientX + 10) + 'px';
              tooltip.style.top = (e.clientY - 10) + 'px';
            });
            wakeDelayRect.addEventListener('mouseleave', () => {
              tooltip.classList.remove('visible');
            });
            wakeChartG.appendChild(wakeDelayRect);
          }
        }
      });

      const wakeDelayPoints = points.filter(
        (p) => p.wakeDelayMinutes !== null && p.wakeDelayMinutes !== undefined && p.wakeDelayMinutes > 0
      );
      if (wakeDelayPoints.length > 0) {
        const wakeDelayXValues = wakeDelayPoints.map((point) => points.indexOf(point));
        const wakeDelayYValues = wakeDelayPoints.map((point) => point.wakeDelayMinutes);
        const wakeDelayRegression = polynomialRegression(
          wakeDelayXValues,
          wakeDelayYValues,
          regressionDegree(wakeDelayPoints.length)
        );

        const wakeDelayTrendPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        let wakeDelayTrendPathData = '';
        for (let i = 0; i < points.length; i++) {
          const predictedValue = evaluatePolynomial(wakeDelayRegression, i);
          if (predictedValue > 0) {
            const x = xScale(points[i].date);
            const y = wakeYScale(predictedValue);
            const clampedY = Math.max(0, Math.min(wakeChartGraphHeight, y));
            wakeDelayTrendPathData += wakeDelayTrendPathData ? ` L ${x} ${clampedY}` : `M ${x} ${clampedY}`;
          }
        }
        wakeDelayTrendPath.setAttribute('d', wakeDelayTrendPathData);
        wakeDelayTrendPath.setAttribute('class', 'regression-line wake-delay-trend');
        wakeDelayTrendPath.setAttribute('id', 'wake-delay-trend-line');
        wakeDelayTrendPath.setAttribute('fill', 'none');
        wakeChartG.appendChild(wakeDelayTrendPath);
      }
    } catch (wakeDelayChartError) {
      console.error('Error rendering wake delay chart:', wakeDelayChartError);
      const errorDiv = document.createElement('div');
      errorDiv.className = 'chart-error';
      errorDiv.textContent = 'Wake delay chart error: ' + wakeDelayChartError.message;
      document.getElementById('delay-chart-container').appendChild(errorDiv);
    }

    // ===== SOL CHART: sleep onset latency (bed → fell asleep), same data as former "sleep delay" bars =====
    try {
      if (typeof xScale === 'undefined' || typeof dayWidth === 'undefined' || typeof monthNames === 'undefined' || !points) {
        throw new Error('Required variables not available for SOL chart');
      }

      const solChartMargin = { top: 40, right: 80, bottom: 60, left: 80 };
      const solChartWidth = width;
      const solChartHeight = 500;
      const solChartGraphWidth = solChartWidth - solChartMargin.left - solChartMargin.right;
      const solChartGraphHeight = solChartHeight - solChartMargin.top - solChartMargin.bottom;

      const solChartSvg = document.getElementById('sol-chart-svg');
      if (!solChartSvg) {
        throw new Error('SOL chart SVG element not found');
      }
      solChartSvg.setAttribute('width', solChartWidth);
      solChartSvg.setAttribute('height', solChartHeight);

      const solChartG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      solChartG.setAttribute('transform', `translate(${solChartMargin.left},${solChartMargin.top})`);
      solChartSvg.appendChild(solChartG);

      const solVals = points.map((p) => p.sleepDelayMinutes).filter((v) => v != null && v > 0);
      const solMaxData = solVals.length ? Math.max(...solVals) : 0;
      const solYMax = Math.max(180, Math.ceil(solMaxData / 60) * 60);

      const solYScale = (minutes) =>
        solChartGraphHeight - (minutes / solYMax) * solChartGraphHeight;

      const solYTicks = [];
      const solTickStep = solYMax <= 120 ? 30 : 60;
      for (let m = 0; m <= solYMax; m += solTickStep) {
        solYTicks.push(m);
      }
      if (solYTicks[solYTicks.length - 1] !== solYMax) {
        solYTicks.push(solYMax);
      }

      solYTicks.forEach((tick) => {
        const y = solYScale(tick);
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', 0);
        line.setAttribute('y1', y);
        line.setAttribute('x2', solChartGraphWidth);
        line.setAttribute('y2', y);
        line.setAttribute('class', 'grid-line');
        if (tick === 0) line.setAttribute('stroke-width', '2');
        solChartG.appendChild(line);
      });

      const solChartXAxis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      solChartXAxis.setAttribute('x1', 0);
      solChartXAxis.setAttribute('y1', solChartGraphHeight);
      solChartXAxis.setAttribute('x2', solChartGraphWidth);
      solChartXAxis.setAttribute('y2', solChartGraphHeight);
      solChartXAxis.setAttribute('class', 'axis');
      solChartG.appendChild(solChartXAxis);

      const solChartYAxis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      solChartYAxis.setAttribute('x1', 0);
      solChartYAxis.setAttribute('y1', 0);
      solChartYAxis.setAttribute('x2', 0);
      solChartYAxis.setAttribute('y2', solChartGraphHeight);
      solChartYAxis.setAttribute('class', 'axis');
      solChartG.appendChild(solChartYAxis);

      const solChartYAxisRight = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      solChartYAxisRight.setAttribute('x1', solChartGraphWidth);
      solChartYAxisRight.setAttribute('y1', 0);
      solChartYAxisRight.setAttribute('x2', solChartGraphWidth);
      solChartYAxisRight.setAttribute('y2', solChartGraphHeight);
      solChartYAxisRight.setAttribute('class', 'axis');
      solChartG.appendChild(solChartYAxisRight);

      solYTicks.forEach((tick) => {
        const y = solYScale(tick);
        const tickLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        tickLine.setAttribute('x1', -5);
        tickLine.setAttribute('y1', y);
        tickLine.setAttribute('x2', 0);
        tickLine.setAttribute('y2', y);
        tickLine.setAttribute('class', 'axis');
        solChartG.appendChild(tickLine);

        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', -10);
        label.setAttribute('y', y + 4);
        label.setAttribute('class', 'axis-label');
        label.setAttribute('text-anchor', 'end');
        label.textContent = tick % 60 === 0 ? `${tick / 60}h` : `${tick}m`;
        solChartG.appendChild(label);
      });

      points.forEach((point) => {
        const [month, day] = point.dateString.split('/').map(Number);
        if (day === 1) {
          const x = xScale(point.date);
          const tickLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          tickLine.setAttribute('x1', x);
          tickLine.setAttribute('y1', solChartGraphHeight);
          tickLine.setAttribute('x2', x);
          tickLine.setAttribute('y2', solChartGraphHeight + 5);
          tickLine.setAttribute('class', 'axis');
          solChartG.appendChild(tickLine);

          const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          label.setAttribute('x', x);
          label.setAttribute('y', solChartGraphHeight + 20);
          label.setAttribute('class', 'axis-label');
          label.setAttribute('text-anchor', 'middle');
          label.textContent = monthNames[month - 1];
          solChartG.appendChild(label);
        }
      });

      const solChartXAxisTitle = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      solChartXAxisTitle.setAttribute('x', solChartMargin.left + solChartGraphWidth / 2);
      solChartXAxisTitle.setAttribute('y', solChartHeight - 10);
      solChartXAxisTitle.setAttribute('class', 'axis-title');
      solChartXAxisTitle.setAttribute('text-anchor', 'middle');
      solChartXAxisTitle.textContent = 'Date';
      solChartSvg.appendChild(solChartXAxisTitle);

      const solChartYAxisTitle = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      solChartYAxisTitle.setAttribute('x', -solChartHeight / 2);
      solChartYAxisTitle.setAttribute('y', 20);
      solChartYAxisTitle.setAttribute('class', 'axis-title');
      solChartYAxisTitle.setAttribute('text-anchor', 'middle');
      solChartYAxisTitle.setAttribute('transform', 'rotate(-90)');
      solChartYAxisTitle.textContent = 'Delay';
      solChartSvg.appendChild(solChartYAxisTitle);

      solYTicks.forEach((tick) => {
        const y = solYScale(tick);
        const tickLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        tickLine.setAttribute('x1', solChartGraphWidth);
        tickLine.setAttribute('y1', y);
        tickLine.setAttribute('x2', solChartGraphWidth + 5);
        tickLine.setAttribute('y2', y);
        tickLine.setAttribute('class', 'axis');
        solChartG.appendChild(tickLine);

        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', solChartGraphWidth + 10);
        label.setAttribute('y', y + 4);
        label.setAttribute('class', 'axis-label');
        label.setAttribute('text-anchor', 'start');
        label.textContent = tick % 60 === 0 ? `${tick / 60}h` : `${tick}m`;
        solChartG.appendChild(label);
      });

      const solChartYAxisTitleRight = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      solChartYAxisTitleRight.setAttribute('x', solChartWidth - 20);
      solChartYAxisTitleRight.setAttribute('y', solChartHeight / 2);
      solChartYAxisTitleRight.setAttribute('class', 'axis-title');
      solChartYAxisTitleRight.setAttribute('text-anchor', 'middle');
      solChartYAxisTitleRight.setAttribute('transform', `rotate(-90 ${solChartWidth - 20} ${solChartHeight / 2})`);
      solChartYAxisTitleRight.textContent = 'Delay';
      solChartSvg.appendChild(solChartYAxisTitleRight);

      const solBarWidth = Math.max(2, dayWidth * 0.8);
      points.forEach((point) => {
        const x = xScale(point.date);
        if (point.sleepDelayMinutes !== null && point.sleepDelayMinutes !== undefined && point.sleepDelayMinutes > 0) {
          const solBarY = solYScale(point.sleepDelayMinutes);
          const solBarHeight = solChartGraphHeight - solBarY;
          if (solBarHeight > 0 && !isNaN(solBarHeight)) {
            const solRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            solRect.setAttribute('x', x - solBarWidth / 2);
            solRect.setAttribute('y', solBarY);
            solRect.setAttribute('width', solBarWidth);
            solRect.setAttribute('height', solBarHeight);
            solRect.setAttribute('class', 'sleep-bar delay-bar');

            solRect.addEventListener('mouseenter', () => {
              tooltip.textContent = `${point.dateString}: ${formatDuration(point.sleepDelayMinutes)} SOL (bed ${point.bedTimeString} → sleep ${point.sleepStartString})`;
              tooltip.classList.add('visible');
            });
            solRect.addEventListener('mousemove', (e) => {
              tooltip.style.left = (e.clientX + 10) + 'px';
              tooltip.style.top = (e.clientY - 10) + 'px';
            });
            solRect.addEventListener('mouseleave', () => {
              tooltip.classList.remove('visible');
            });
            solChartG.appendChild(solRect);
          }
        }
      });

      const sleepDelayPoints = points.filter(
        (p) => p.sleepDelayMinutes !== null && p.sleepDelayMinutes !== undefined && p.sleepDelayMinutes > 0
      );
      if (sleepDelayPoints.length > 0) {
        const sleepDelayXValues = sleepDelayPoints.map((point) => points.indexOf(point));
        const sleepDelayYValues = sleepDelayPoints.map((point) => point.sleepDelayMinutes);
        const sleepDelayRegression = polynomialRegression(
          sleepDelayXValues,
          sleepDelayYValues,
          regressionDegree(sleepDelayPoints.length)
        );

        const sleepDelayTrendPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        let sleepDelayTrendPathData = '';
        for (let i = 0; i < points.length; i++) {
          const predictedValue = evaluatePolynomial(sleepDelayRegression, i);
          if (predictedValue > 0) {
            const x = xScale(points[i].date);
            const y = solYScale(predictedValue);
            const clampedY = Math.max(0, Math.min(solChartGraphHeight, y));
            sleepDelayTrendPathData += sleepDelayTrendPathData ? ` L ${x} ${clampedY}` : `M ${x} ${clampedY}`;
          }
        }
        sleepDelayTrendPath.setAttribute('d', sleepDelayTrendPathData);
        sleepDelayTrendPath.setAttribute('class', 'regression-line sleep-delay-trend');
        sleepDelayTrendPath.setAttribute('id', 'sleep-delay-trend-line');
        sleepDelayTrendPath.setAttribute('fill', 'none');
        solChartG.appendChild(sleepDelayTrendPath);
      }
    } catch (solChartError) {
      console.error('Error rendering SOL chart:', solChartError);
      const errorDiv = document.createElement('div');
      errorDiv.className = 'chart-error';
      errorDiv.textContent = 'SOL chart error: ' + solChartError.message;
      document.getElementById('sol-chart-container').appendChild(errorDiv);
    }
}
