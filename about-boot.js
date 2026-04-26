(function () {
  'use strict';
  (async function initAboutPage() {
    await initI18n(document);
    document.getElementById('nav-container').innerHTML = renderNavBar('about');
    var aboutRoot = document.getElementById('about-page-root');
    var A = window.__restoreAboutLifecycle;
    if (aboutRoot && A && typeof A.mount === 'function') {
      A.mount(aboutRoot, {});
      var params = new URLSearchParams(window.location.search);
      if (
        params.get('lifecycleHarness') === '1' &&
        typeof isDevBuildContext === 'function' &&
        isDevBuildContext()
      ) {
        console.info('[lifecycleHarness] about: start mount → unmount → mount');
        A.unmount();
        console.info('[lifecycleHarness] about: after unmount (remaining-wake controls cleared)');
        A.mount(aboutRoot, {});
        console.info('[lifecycleHarness] about: second mount complete');
      }
    }
  })();
})();
