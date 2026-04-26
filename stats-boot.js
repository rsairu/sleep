(function () {
  'use strict';
  (async function initStatsPage() {
    await initI18n(document);
    document.getElementById('nav-container').innerHTML = renderNavBar('stats');
    initDayNightTheme();
    initRemainingWakeNav();
    var statsRoot = document.getElementById('stats-page-root');
    var S = window.__restoreStatsLifecycle;
    if (statsRoot && S && typeof S.mount === 'function') {
      S.mount(statsRoot, {});
      var params = new URLSearchParams(window.location.search);
      if (
        params.get('lifecycleHarness') === '1' &&
        typeof isDevBuildContext === 'function' &&
        isDevBuildContext()
      ) {
        console.info('[lifecycleHarness] stats: start mount → unmount → mount');
        S.unmount();
        console.info('[lifecycleHarness] stats: after unmount (period bar + matrix cleared)');
        S.mount(statsRoot, {});
        console.info('[lifecycleHarness] stats: second mount complete');
      }
    }
  })();
})();
