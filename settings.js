// Settings page lifecycle (Phase 6): extract inline init from settings.html.
// See docs/migration/lifecycle-contract.md

(function () {
  'use strict';

  var settingsMountGeneration = 0;
  var settingsMountedRoot = null;

  function runSettingsHashScroll() {
    if (window.location.hash.length <= 1) return;
    var id = decodeURIComponent(window.location.hash.slice(1));
    var scrollTarget = document.getElementById(id);
    if (!scrollTarget) return;
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        scrollTarget.scrollIntoView({ block: 'start', behavior: 'auto' });
      });
    });
  }

  function mount(root, _ctx) {
    if (!root) return;
    settingsMountGeneration++;
    var gen = settingsMountGeneration;
    settingsMountedRoot = root;

    if (typeof applyTranslations === 'function') applyTranslations(root);
    if (typeof initDayNightTheme === 'function') initDayNightTheme();
    if (typeof initRemainingWakeNav === 'function') initRemainingWakeNav();
    if (typeof initClockFormatSelector === 'function') initClockFormatSelector();
    if (typeof initLanguageSelector === 'function') initLanguageSelector();
    if (typeof initConfigThemeSelector === 'function') initConfigThemeSelector();
    if (typeof initQualityPaletteSelector === 'function') initQualityPaletteSelector();
    if (typeof initTonightGuidanceConfigControls === 'function') initTonightGuidanceConfigControls();

    var rwMount = document.getElementById('remaining-wake-mount');
    if (rwMount && typeof getRemainingWakeThresholdsControlHTML === 'function') {
      rwMount.innerHTML = getRemainingWakeThresholdsControlHTML('remaining-wake');
    }

    if (gen !== settingsMountGeneration || settingsMountedRoot !== root) return;
    if (typeof initRemainingWakeThresholdsConfig === 'function') initRemainingWakeThresholdsConfig();
    if (typeof initDashboardHintsSettingsControls === 'function') initDashboardHintsSettingsControls();
    if (typeof initSupabaseConfigForm === 'function') initSupabaseConfigForm();
    runSettingsHashScroll();
  }

  function unmount() {
    settingsMountGeneration++;
    var rwMount = document.getElementById('remaining-wake-mount');
    if (rwMount) rwMount.innerHTML = '';
    var supabaseMount = document.getElementById('supabase-config-mount');
    if (supabaseMount) supabaseMount.innerHTML = '';
    settingsMountedRoot = null;
  }

  window.__restoreSettingsLifecycle = {
    mount: mount,
    unmount: unmount
  };
})();
