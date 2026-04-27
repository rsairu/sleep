(function () {
  'use strict';
  (async function initLogPage() {
    await initI18n(document);
    document.getElementById('nav-container').innerHTML = renderNavBar('log');
    initDayNightTheme();
    initRemainingWakeNav({ interval: false });
    var logRoot = document.getElementById('log-page-root');
    var L = window.__restoreLogLifecycle;
    if (logRoot && L && typeof L.mount === 'function') {
      L.mount(logRoot, {});
      var params = new URLSearchParams(window.location.search);
      if (
        params.get('lifecycleHarness') === '1' &&
        typeof isDevBuildContext === 'function' &&
        isDevBuildContext()
      ) {
        console.info('[lifecycleHarness] log: start mount → unmount → mount');
        L.unmount();
        console.info('[lifecycleHarness] log: after unmount (expect empty outlet)');
        L.mount(logRoot, {});
        console.info('[lifecycleHarness] log: second mount complete');
      }
    }
  })();
})();
