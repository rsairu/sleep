// Note: timeToMinutes and formatTime are now in sleep-utils.js
// Use formatTime(minutes, true) for short midnight format ("00")

// Normalize time for Y-axis positioning
// Y-axis now goes from 5PM (17:00) to 5PM next day
// Times before 5PM (00:00-16:59) should appear after midnight (add 1440)
// Times from 5PM onwards (17:00-23:59) stay as is
// Times after midnight (00:00-16:59) get 1440 added to appear after 23:59
function normalizeTimeForYAxis(minutes) {
  if (minutes < 1020) { // Before 5pm (17:00)
    return minutes + 1440; // Add 24 hours to make them appear after midnight
  }
  return minutes; // 17:00-23:59 stay as is
}

// Note: parseDate (getDateFromString), calculateTotalSleep, formatDuration, 
// isWeekend, and isHoliday are now in sleep-utils.js
// Use getDateFromString(dateString, year) instead of parseDate

// Polynomial regression function (non-linear)
// Returns coefficients [a, b, c] for y = a*x² + b*x + c (quadratic)
// Can be extended to higher degrees if needed
function polynomialRegression(xValues, yValues, degree = 2) {
  const n = xValues.length;
  
  // Build the design matrix X
  const X = [];
  for (let i = 0; i < n; i++) {
    const row = [];
    for (let d = degree; d >= 0; d--) {
      row.push(Math.pow(xValues[i], d));
    }
    X.push(row);
  }
  
  // Build X^T * X and X^T * Y
  const XTX = [];
  const XTY = [];
  
  for (let i = 0; i <= degree; i++) {
    XTX[i] = [];
    XTY[i] = 0;
    for (let j = 0; j <= degree; j++) {
      let sum = 0;
      for (let k = 0; k < n; k++) {
        sum += X[k][i] * X[k][j];
      }
      XTX[i][j] = sum;
    }
    for (let k = 0; k < n; k++) {
      XTY[i] += X[k][i] * yValues[k];
    }
  }
  
  // Solve the system using Gaussian elimination
  const coefficients = solveLinearSystem(XTX, XTY);
  
  return coefficients; // [a, b, c] for quadratic, or [a, b] for linear, etc.
}

// Helper function to solve linear system using Gaussian elimination
function solveLinearSystem(A, b) {
  const n = A.length;
  const augmented = A.map((row, i) => [...row, b[i]]);
  
  // Forward elimination
  for (let i = 0; i < n; i++) {
    // Find pivot
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(augmented[k][i]) > Math.abs(augmented[maxRow][i])) {
        maxRow = k;
      }
    }
    [augmented[i], augmented[maxRow]] = [augmented[maxRow], augmented[i]];
    
    // Make all rows below this one 0 in current column
    for (let k = i + 1; k < n; k++) {
      const factor = augmented[k][i] / augmented[i][i];
      for (let j = i; j <= n; j++) {
        augmented[k][j] -= factor * augmented[i][j];
      }
    }
  }
  
  // Back substitution
  const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    x[i] = augmented[i][n];
    for (let j = i + 1; j < n; j++) {
      x[i] -= augmented[i][j] * x[j];
    }
    x[i] /= augmented[i][i];
  }
  
  return x;
}

// Evaluate polynomial at given x value
function evaluatePolynomial(coefficients, x) {
  let result = 0;
  for (let i = 0; i < coefficients.length; i++) {
    result += coefficients[i] * Math.pow(x, coefficients.length - 1 - i);
  }
  return result;
}

// Load and render graph
Promise.all([
  fetch('sleep-data.json').then(response => response.json()),
  fetch('holidays.json').then(response => response.json())
])
  .then(([data, holidaysData]) => {
    const holidays = holidaysData;
    // Process data: convert to array of {date, bedTimeMinutes, bedTimeString, sleepStartMinutes, sleepStartString, getUpMinutes, getUpString, sleepDurationMinutes}
    const points = data.days.map(day => {
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
        napMinutes: napDuration
      };
    });

    // Sort by date (oldest first for left-to-right display)
    points.sort((a, b) => a.date - b.date);

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
    const width = Math.max(800, totalDays * 20); // At least 20px per point
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
      const isHolidayDay = isHoliday(point.date, holidays);
      
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

    // Calculate polynomial regression for get up times (quadratic, degree 2)
    const getUpXValues = points.map((point, index) => index);
    const getUpYValues = points.map(point => point.getUpMinutes);
    const getUpRegression = polynomialRegression(getUpXValues, getUpYValues, 2);
    
    // Calculate polynomial regression for sleep start times
    const sleepStartXValues = points.map((point, index) => index);
    const sleepStartYValues = points.map(point => point.sleepStartMinutes);
    const sleepStartRegression = polynomialRegression(sleepStartXValues, sleepStartYValues, 2);
    
    // Calculate polynomial regression for bed time (quadratic, degree 2)
    const bedtimeXValues = points.map((point, index) => index);
    const bedtimeYValues = points.map(point => point.bedTimeMinutes);
    const bedtimeRegression = polynomialRegression(bedtimeXValues, bedtimeYValues, 2);

    // Draw get up regression curve - extend 10 more days
    const getUpRegPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    let getUpPathData = '';
    const extendedIndex = points.length - 1 + 10;
    const extendedMaxDateForCurve = new Date(maxDate.getTime() + 10 * 24 * 60 * 60 * 1000);
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
    const dayPanel = document.getElementById('day-panel');
    
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
      circle.setAttribute('r', 4);
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
      circle.setAttribute('r', 4);
      circle.setAttribute('class', 'data-point sleep-start sleep-start-point');
      circle.setAttribute('data-date', point.dateString);
      circle.setAttribute('data-time', point.sleepStartString);
      
      g.appendChild(circle);
    });

    // Draw get up data points
    points.forEach(point => {
      const x = xScale(point.date);
      const y = yScale(point.getUpMinutes);
      
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', x);
      circle.setAttribute('cy', y);
      circle.setAttribute('r', 4);
      circle.setAttribute('class', 'data-point getup getup-point');
      circle.setAttribute('data-date', point.dateString);
      circle.setAttribute('data-time', point.getUpString);
      
      g.appendChild(circle);
    });
    
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
        
        // Get SVG position relative to viewport
        const svgRect = svg.getBoundingClientRect();
        const baseX = svgRect.left + margin.left + x;
        const baseY = svgRect.top + margin.top;
        
        // Build consolidated day panel content
        const sleepDuration = formatDuration(point.sleepDurationMinutes);
        const mainSleep = formatDuration(point.mainSleepMinutes);
        const napText = point.napMinutes > 0 ? ` (${mainSleep} + ${formatDuration(point.napMinutes)} nap)` : '';
        
        dayPanel.innerHTML = `
          <div class="day-panel-header">${point.dateString}</div>
          <div class="day-panel-row">
            <span class="day-panel-label bedtime">bed:</span>
            <span class="day-panel-value">${point.bedTimeString}</span>
          </div>
          <div class="day-panel-row">
            <span class="day-panel-label sleep-start">sleep:</span>
            <span class="day-panel-value">${point.sleepStartString}</span>
          </div>
          <div class="day-panel-row">
            <span class="day-panel-label getup">get up:</span>
            <span class="day-panel-value">${point.getUpString}</span>
          </div>
          <div class="day-panel-row">
            <span class="day-panel-label">sleep duration:</span>
            <span class="day-panel-value">${sleepDuration}${napText}</span>
          </div>
        `;
        
        // Position panel to the right of the hover line, or left if too close to edge
        const panelWidth = 200; // Approximate width
        const panelHeight = 120; // Approximate height
        let panelX = baseX + 15;
        let panelY = baseY + graphHeight / 2 - panelHeight / 2;
        
        // Adjust if too close to right edge
        if (panelX + panelWidth > window.innerWidth - 20) {
          panelX = baseX - panelWidth - 15;
        }
        
        // Adjust if too close to top or bottom
        if (panelY < 20) {
          panelY = 20;
        } else if (panelY + panelHeight > window.innerHeight - 20) {
          panelY = window.innerHeight - panelHeight - 20;
        }
        
        dayPanel.style.left = panelX + 'px';
        dayPanel.style.top = panelY + 'px';
        dayPanel.classList.add('visible');
      });
      
      hoverRect.addEventListener('mouseleave', () => {
        // Hide vertical line
        hoverLine.style.display = 'none';
        
        // Hide day panel
        dayPanel.classList.remove('visible');
      });
      
      // Add at the end so it's on top for interaction but transparent
      g.appendChild(hoverRect);
    });

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
      const points = document.querySelectorAll('.getup-point');
      if (line) {
        line.style.display = show ? 'block' : 'none';
      }
      points.forEach(point => {
        point.style.display = show ? 'block' : 'none';
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

    setupCheckbox('show-bedtime-line', toggleBedtimeLine);
    setupCheckbox('show-sleep-start-line', toggleSleepStartLine);
    setupCheckbox('show-getup-line', toggleGetUpLine);
    setupCheckbox('show-getup-regression', toggleGetUpRegression);
    setupCheckbox('show-sleep-start-regression', toggleSleepStartRegression);
    setupCheckbox('show-bedtime-regression', toggleBedtimeRegression);

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

    // Draw Y-axis for bar chart
    const barChartYAxis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    barChartYAxis.setAttribute('x1', 0);
    barChartYAxis.setAttribute('y1', 0);
    barChartYAxis.setAttribute('x2', 0);
    barChartYAxis.setAttribute('y2', barChartGraphHeight);
    barChartYAxis.setAttribute('class', 'axis');
    barChartG.appendChild(barChartYAxis);

    // Draw Y-axis labels and ticks for bar chart
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
    barChartYAxisTitle.textContent = 'Sleep Duration';
    barChartSvg.appendChild(barChartYAxisTitle);

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
      }
    });

    // Calculate polynomial regression for sleep duration
    const sleepXValues = points.map((point, index) => index);
    const sleepYValues = points.map(point => point.sleepDurationMinutes);
    const sleepRegression = polynomialRegression(sleepXValues, sleepYValues, 2);

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
  })
  .catch(error => {
    console.error('Error loading data:', error);
    document.getElementById('graph-container').innerHTML = '<p>Error loading data</p>';
  });
