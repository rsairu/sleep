(function () {
  'use strict';
  (async function initDashboardPage() {
    await initI18n(document);
    document.getElementById('nav-container').innerHTML = renderNavBar('dashboard');
    initDayNightTheme();
    initRemainingWakeNav({ interval: false });
    var dashRoot = document.getElementById('dashboard-container');
    var D = window.__restoreDashboardLifecycle;
    if (dashRoot && D && typeof D.mount === 'function') {
      D.mount(dashRoot, {});
      var params = new URLSearchParams(window.location.search);
      if (
        params.get('lifecycleHarness') === '1' &&
        typeof isDevBuildContext === 'function' &&
        isDevBuildContext()
      ) {
        console.info('[lifecycleHarness] dashboard: start mount → unmount → mount');
        D.unmount();
        console.info('[lifecycleHarness] dashboard: after unmount (expect empty outlet)');
        D.mount(dashRoot, {});
        console.info('[lifecycleHarness] dashboard: second mount complete');
      }
    }
  })();
})();
