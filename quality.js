// Sleep Quality History: full calendar heatmap (all months).
// Uses renderCalendarHeatmapFullHistory() and shared helpers from daily.js.

const qualityContainer = document.getElementById('quality-container');
if (qualityContainer) {
  loadSleepData()
    .then((sleepData) => {
      const flagMap = buildFlagCountMap(sleepData.days);
      const latestDataDate = getLatestDataDate(sleepData.days, YEAR);
      qualityContainer.innerHTML = renderCalendarHeatmapFullHistory(YEAR, flagMap, latestDataDate);
    })
    .catch(error => {
      console.error('Error loading quality history data:', error);
      qualityContainer.innerHTML = '<p>Error loading data.</p>';
    });
}
