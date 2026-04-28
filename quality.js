// Sleep Quality History: full calendar heatmap (all months).
// Uses renderCalendarHeatmapFullHistory() and shared helpers from nightly.js.
//
// Lifecycle (SPA prep): mount(root) / unmount() on #quality-container — see docs/migration/lifecycle-contract.md

(function () {
  'use strict';

  var qualityMountGeneration = 0;
  var qualityMountedRoot = null;
  var qualityUnsubscribeStore = null;
  /** @type {AbortController | null} */
  var qualityCalendarFlagAbort = null;

  function applyLoadedData(root, sleepData, gen) {
    if (gen !== qualityMountGeneration || qualityMountedRoot !== root) return;
    var flagMap = buildFlagCountMap(sleepData.days);
    var latestDataDate = getLatestDataDate(sleepData.days);
    var years = getSleepDataYearsPresentDescending(sleepData.days);
    root.innerHTML = renderCalendarHeatmapFullHistoryMulti(years, flagMap, latestDataDate);
    if (typeof window.__restoreSyncCalendarHeatmapFlagFilters === 'function') {
      window.__restoreSyncCalendarHeatmapFlagFilters(root);
    }
  }

  function applyError(root, gen) {
    if (gen !== qualityMountGeneration || qualityMountedRoot !== root) return;
    root.innerHTML = '<p>Error loading data.</p>';
  }

  function renderQualityFromStoreSnapshot(root, gen, snapshot) {
    if (gen !== qualityMountGeneration || qualityMountedRoot !== root) return;
    if (snapshot && snapshot.data) {
      applyLoadedData(root, snapshot.data, gen);
      return;
    }
    if (snapshot && snapshot.status === 'error') {
      applyError(root, gen);
    }
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
    if (qualityCalendarFlagAbort) {
      try {
        qualityCalendarFlagAbort.abort();
      } catch (e) {
        /* ignore */
      }
      qualityCalendarFlagAbort = null;
    }
    qualityCalendarFlagAbort = new AbortController();
    if (typeof window.__restoreBindCalendarHeatmapFlagFilters === 'function') {
      window.__restoreBindCalendarHeatmapFlagFilters(root, qualityCalendarFlagAbort.signal);
    }
    if (qualityUnsubscribeStore) {
      qualityUnsubscribeStore();
      qualityUnsubscribeStore = null;
    }
    var store = window.__restoreSleepDataStore;
    if (store && typeof store.subscribe === 'function') {
      qualityUnsubscribeStore = store.subscribe(function (snapshot) {
        renderQualityFromStoreSnapshot(root, gen, snapshot);
      });
      renderQualityFromStoreSnapshot(root, gen, store.getSnapshot());
      store.ensureLoaded()
        .then(function (sleepData) {
          applyLoadedData(root, sleepData, gen);
        })
        .catch(function (error) {
          console.error('Error loading quality history data:', error);
          applyError(root, gen);
        });
      return;
    }
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
    if (qualityCalendarFlagAbort) {
      try {
        qualityCalendarFlagAbort.abort();
      } catch (e) {
        /* ignore */
      }
      qualityCalendarFlagAbort = null;
    }
    if (qualityUnsubscribeStore) {
      qualityUnsubscribeStore();
      qualityUnsubscribeStore = null;
    }
    if (qualityMountedRoot) {
      if (typeof window.__restoreClearCalendarHeatmapFlagFilterState === 'function') {
        window.__restoreClearCalendarHeatmapFlagFilterState(qualityMountedRoot);
      }
      qualityMountedRoot.innerHTML = '';
    }
    qualityMountedRoot = null;
  }

  window.__restoreQualityLifecycle = {
    mount: mount,
    unmount: unmount
  };
})();
