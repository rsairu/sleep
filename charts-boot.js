(function () {
  'use strict';
  (async function initGraphPage() {
    await initI18n(document);
    document.getElementById('nav-container').innerHTML = renderNavBar('charts');
    initDayNightTheme();
    initRemainingWakeNav();
    var chartsRoot = document.getElementById('charts-page-root');
    var C = window.__restoreChartsLifecycle;
    if (chartsRoot && C && typeof C.mount === 'function') {
      C.mount(chartsRoot, {});
      var params = new URLSearchParams(window.location.search);
      if (
        params.get('lifecycleHarness') === '1' &&
        typeof isDevBuildContext === 'function' &&
        isDevBuildContext()
      ) {
        console.info('[lifecycleHarness] charts: start mount → unmount → mount');
        C.unmount();
        console.info('[lifecycleHarness] charts: after unmount (SVGs cleared; static chrome kept)');
        C.mount(chartsRoot, {});
        console.info('[lifecycleHarness] charts: second mount complete');
      }
    }
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (typeof scrollGraphPageHashAfterNavOnce === 'function') scrollGraphPageHashAfterNavOnce();
      });
    });
  })();
})();
