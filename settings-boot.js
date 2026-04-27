(function () {
  'use strict';
  (async function initConfigPage() {
    await initI18n(document);
    document.getElementById('nav-container').innerHTML = renderNavBar('settings');
    var settingsRoot = document.getElementById('settings-page-root');
    var S = window.__restoreSettingsLifecycle;
    if (settingsRoot && S && typeof S.mount === 'function') {
      S.mount(settingsRoot, {});
      var params = new URLSearchParams(window.location.search);
      if (
        params.get('lifecycleHarness') === '1' &&
        typeof isDevBuildContext === 'function' &&
        isDevBuildContext()
      ) {
        console.info('[lifecycleHarness] settings: start mount → unmount → mount');
        S.unmount();
        console.info('[lifecycleHarness] settings: after unmount (remaining-wake/cloud controls cleared)');
        S.mount(settingsRoot, {});
        console.info('[lifecycleHarness] settings: second mount complete');
      }
    }
  })();
})();
