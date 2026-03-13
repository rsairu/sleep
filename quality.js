// Sleep Quality History: full calendar heatmap (all months).
// Uses renderCalendarHeatmapFullHistory() and shared helpers from daily.js.

const qualityContainer = document.getElementById('quality-container');
if (qualityContainer) {
  Promise.all([
    fetch('sleep-data.json').then(r => r.json()),
    fetch('holidays.json').then(r => r.json())
  ])
    .then(([sleepData, holidaysData]) => {
      if (typeof holidays !== 'undefined') holidays = holidaysData;
      const flagMap = buildFlagCountMap(sleepData.days);
      const latestDataDate = getLatestDataDate(sleepData.days, YEAR);
      qualityContainer.innerHTML = renderCalendarHeatmapFullHistory(YEAR, flagMap, latestDataDate);
    })
    .catch(error => {
      console.error('Error loading quality history data:', error);
      qualityContainer.innerHTML = '<p>Error loading data.</p>';
    });
}
