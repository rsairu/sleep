(function () {
  'use strict';
  (async function initDailyPage() {
    await initI18n(document);
    document.getElementById('nav-container').innerHTML = renderNavBar('timeline');
    initDayNightTheme();
    initRemainingWakeNav();
    var timelineSection = document.getElementById('timeline-section');
    var N = window.__restoreNightlyTimelineLifecycle;
    if (timelineSection && N && typeof N.mount === 'function') {
      N.mount(timelineSection, {});
      var params = new URLSearchParams(window.location.search);
      if (
        params.get('lifecycleHarness') === '1' &&
        typeof isDevBuildContext === 'function' &&
        isDevBuildContext()
      ) {
        console.info('[lifecycleHarness] nightly: start mount → unmount → mount');
        N.unmount();
        console.info('[lifecycleHarness] nightly: after unmount (legend + days cleared)');
        N.mount(timelineSection, {});
        console.info('[lifecycleHarness] nightly: second mount complete');
      }
    }
  })();
})();
