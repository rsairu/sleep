// Dashboard: recent average, lifetime average, past three nights (timeline rows), sleep quality history.
// Uses renderDashboardContent() and shared helpers from sleep.js.

const dashboardContainer = document.getElementById('dashboard-container');
if (dashboardContainer) {
  Promise.all([
    fetch('sleep-data.json').then(r => r.json()),
    fetch('holidays.json').then(r => r.json())
  ])
    .then(([sleepData, holidaysData]) => {
      if (typeof holidays !== 'undefined') holidays = holidaysData;
      dashboardContainer.innerHTML = renderDashboardContent(sleepData.days);
      if (typeof renderDashboard7DayGraphs === 'function') {
        renderDashboard7DayGraphs(sleepData.days);
      }
    })
    .catch(error => {
      console.error('Error loading dashboard data:', error);
      dashboardContainer.innerHTML = '<p>Error loading data.</p>';
    });
}
