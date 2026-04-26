(function () {
  'use strict';
  (async function initQualityPage() {
    await initI18n(document);
    document.getElementById('nav-container').innerHTML = renderNavBar('quality');
    initDayNightTheme();
    initRemainingWakeNav();
    var qualityRoot = document.getElementById('quality-container');
    var L = window.__restoreQualityLifecycle;
    if (qualityRoot && L && typeof L.mount === 'function') {
      L.mount(qualityRoot, {});
      var params = new URLSearchParams(window.location.search);
      if (
        params.get('lifecycleHarness') === '1' &&
        typeof isDevBuildContext === 'function' &&
        isDevBuildContext()
      ) {
        console.info('[lifecycleHarness] quality: start mount → unmount → mount');
        L.unmount();
        console.info('[lifecycleHarness] quality: after unmount (expect empty outlet)');
        L.mount(qualityRoot, {});
        console.info('[lifecycleHarness] quality: second mount complete');
      }
    }
  })();
})();
