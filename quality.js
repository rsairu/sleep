// Sleep Quality History: full calendar heatmap (all months).
// Uses renderCalendarHeatmapFullHistory() and shared helpers from nightly.js.
//
// Lifecycle (SPA prep): mount(root) / unmount() on #quality-container — see docs/migration/lifecycle-contract.md

(function () {
  'use strict';

  var qualityMountGeneration = 0;
  var qualityMountedRoot = null;

  function applyLoadedData(root, sleepData, gen) {
    if (gen !== qualityMountGeneration || qualityMountedRoot !== root) return;
    var flagMap = buildFlagCountMap(sleepData.days);
    var latestDataDate = getLatestDataDate(sleepData.days);
    var years = getSleepDataYearsPresentDescending(sleepData.days);
    root.innerHTML = renderCalendarHeatmapFullHistoryMulti(years, flagMap, latestDataDate);
  }

  function applyError(root, gen) {
    if (gen !== qualityMountGeneration || qualityMountedRoot !== root) return;
    root.innerHTML = '<p>Error loading data.</p>';
  }

  /**
   * @param {HTMLElement} root
   * @param {Record<string, unknown>} [_ctx] reserved for future SPA context (e.g. abortSignal)
   */
  function mount(root, _ctx) {
    if (!root) return;
    qualityMountGeneration++;
    var gen = qualityMountGeneration;
    qualityMountedRoot = root;
    root.innerHTML = '';
    loadSleepData()
      .then(function (sleepData) {
        applyLoadedData(root, sleepData, gen);
      })
      .catch(function (error) {
        console.error('Error loading quality history data:', error);
        applyError(root, gen);
      });
  }

  function unmount() {
    qualityMountGeneration++;
    if (qualityMountedRoot) {
      qualityMountedRoot.innerHTML = '';
    }
    qualityMountedRoot = null;
  }

  window.__restoreQualityLifecycle = {
    mount: mount,
    unmount: unmount
  };
})();
