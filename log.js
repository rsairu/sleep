// Log page: full night entry form (moved from dashboard drawer).
// Lifecycle (SPA prep): mount / unmount on #log-page-root — see docs/migration/lifecycle-contract.md

(function () {
  'use strict';

  var logMountGeneration = 0;
  /** @type {HTMLElement | null} */
  var logMountedRoot = null;
  var logRemainingWakeTimer = null;
  var logPageDaysForWake = [];

  function clearLogRemainingWakeTimer() {
    if (logRemainingWakeTimer != null) {
      clearInterval(logRemainingWakeTimer);
      logRemainingWakeTimer = null;
    }
  }

  function renderLogFromData(root, sleepData) {
    var days = Array.isArray(sleepData.days) ? sleepData.days : [];
    logPageDaysForWake = days;
    clearLogRemainingWakeTimer();
    var recentDays = days.slice(0, Math.min(7, days.length));
    var recentAverages = recentDays.length
      ? calculateAverages(recentDays)
      : QUICK_ADD_FALLBACK_AVERAGES;
    root.innerHTML =
      '<h1 class="log-page-title dashboard-section-title" data-i18n="log.pageTitle">Log a night</h1>' +
      renderQuickAddDrawer(recentAverages, recentDays, 'page');
    var afterI18n = typeof initI18n === 'function' ? initI18n(root) : Promise.resolve();
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
          },
          daysForDefaultDate: days,
        });
      } else if (typeof wireQuickAddDrawerSliders === 'function') {
        wireQuickAddDrawerSliders();
      }
    });
  }

  function loadLogPageData() {
    var root = logMountedRoot;
    if (!root) return Promise.resolve();
    var genAtStart = logMountGeneration;
    return loadSleepData()
      .then(function (sleepData) {
        if (genAtStart !== logMountGeneration || logMountedRoot !== root) return;
        return renderLogFromData(root, sleepData);
      })
      .catch(function (err) {
        console.error(err);
        if (genAtStart !== logMountGeneration || logMountedRoot !== root) return;
        clearLogRemainingWakeTimer();
        logPageDaysForWake = [];
        root.innerHTML = '<p class="dashboard-empty-msg">Error loading data.</p>';
      });
  }

  /**
   * @param {HTMLElement} root
   * @param {Record<string, unknown>} [_ctx]
   */
  function mount(root, _ctx) {
    if (!root) return;
    logMountGeneration++;
    var gen = logMountGeneration;
    logMountedRoot = root;
    root.innerHTML = '';
    loadSleepData()
      .then(function (sleepData) {
        if (gen !== logMountGeneration || logMountedRoot !== root) return;
        return renderLogFromData(root, sleepData);
      })
      .catch(function (err) {
        console.error(err);
        if (gen !== logMountGeneration || logMountedRoot !== root) return;
        clearLogRemainingWakeTimer();
        logPageDaysForWake = [];
        root.innerHTML = '<p class="dashboard-empty-msg">Error loading data.</p>';
      });
  }

  function unmount() {
    logMountGeneration++;
    clearLogRemainingWakeTimer();
    logPageDaysForWake = [];
    if (logMountedRoot) {
      logMountedRoot.innerHTML = '';
    }
    logMountedRoot = null;
  }

  window.__restoreLogLifecycle = {
    mount: mount,
    unmount: unmount,
  };
})();
