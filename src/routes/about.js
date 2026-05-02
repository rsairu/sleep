// About page lifecycle (Phase 6): extract inline init from about.html.
// See docs/lifecycle-contract.md

(function () {
  'use strict';

  var aboutMountGeneration = 0;
  var aboutMountedRoot = null;

  function applyAboutTranslations() {
    if (typeof applyTranslations !== 'function') return;
    if (aboutMountedRoot) applyTranslations(aboutMountedRoot);
    var navEl = document.getElementById('nav-container');
    if (navEl) applyTranslations(navEl);
  }

  function mount(root, _ctx) {
    if (!root) return;
    aboutMountGeneration++;
    var gen = aboutMountGeneration;
    aboutMountedRoot = root;

    applyAboutTranslations();
    if (typeof initDayNightTheme === 'function') initDayNightTheme();
    if (typeof initRemainingWakeNav === 'function') initRemainingWakeNav();

    if (gen !== aboutMountGeneration || aboutMountedRoot !== root) return;
    if (typeof initAboutDashboardHintDismissButtons === 'function') initAboutDashboardHintDismissButtons();
  }

  function unmount() {
    aboutMountGeneration++;
    aboutMountedRoot = null;
  }

  window.__restoreAboutLifecycle = {
    mount: mount,
    unmount: unmount
  };
})();
