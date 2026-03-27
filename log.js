// Log page: full night entry form (moved from dashboard drawer).
(function () {
  const logRoot = document.getElementById('log-page-root');
  if (!logRoot) return;

  let logRemainingWakeTimer = null;
  let logPageDaysForWake = [];

  function clearLogRemainingWakeTimer() {
    if (logRemainingWakeTimer != null) {
      clearInterval(logRemainingWakeTimer);
      logRemainingWakeTimer = null;
    }
  }

  function renderLogFromData(sleepData) {
    const days = Array.isArray(sleepData.days) ? sleepData.days : [];
    logPageDaysForWake = days;
    clearLogRemainingWakeTimer();
    const recentDays = days.slice(0, Math.min(7, days.length));
    const recentAverages = recentDays.length
      ? calculateAverages(recentDays)
      : QUICK_ADD_FALLBACK_AVERAGES;
    logRoot.innerHTML =
      '<h1 class="log-page-title dashboard-section-title" data-i18n="log.pageTitle">Log a night</h1>' +
      renderQuickAddDrawer(recentAverages, recentDays, 'page');
    const afterI18n = typeof initI18n === 'function' ? initI18n(logRoot) : Promise.resolve();
    return afterI18n.then(function () {
      if (typeof updateRemainingWakeNav === 'function' && typeof getRemainingWakeDisplayFromDays === 'function') {
        updateRemainingWakeNav(getRemainingWakeDisplayFromDays(days));
        logRemainingWakeTimer = window.setInterval(function () {
          updateRemainingWakeNav(getRemainingWakeDisplayFromDays(logPageDaysForWake));
        }, 60000);
      }
      if (typeof initQuickAddEntryModal === 'function') {
        initQuickAddEntryModal({
          onSaved: function () {
            return loadLogPageData();
          }
        });
      } else if (typeof wireQuickAddDrawerSliders === 'function') {
        wireQuickAddDrawerSliders();
      }
    });
  }

  function loadLogPageData() {
    return loadSleepData()
      .then(function (sleepData) {
        return renderLogFromData(sleepData);
      })
      .catch(function (err) {
        console.error(err);
        clearLogRemainingWakeTimer();
        logPageDaysForWake = [];
        logRoot.innerHTML = '<p class="dashboard-empty-msg">Error loading data.</p>';
      });
  }

  loadLogPageData();
})();
