/**
 * Canonical MPA routes for nav tabs and fixed menu/home hrefs.
 * Loaded before sleep-utils.js; future Vite migration can replace the IIFE with `export const routes`.
 */
(function (global) {
  'use strict';

  var NAV_TABS = [
    { id: 'dashboard', key: 'nav.tabs.dashboard', defaultName: 'Dashboard', url: 'dashboard.html', icon: '🛌' },
    { id: 'log', key: 'nav.tabs.log', defaultName: 'Log', url: 'log.html', icon: '✏️' },
    { id: 'quality', key: 'nav.tabs.quality', defaultName: 'Quality', url: 'quality.html', icon: '💜' },
    { id: 'timeline', key: 'nav.tabs.daily', defaultName: 'Nightly', url: 'nightly.html', icon: '📅' },
    { id: 'charts', key: 'nav.tabs.graphs', defaultName: 'Charts', url: 'charts.html', icon: '📊' },
    { id: 'stats', key: 'nav.tabs.stats', defaultName: 'Stats', url: 'stats.html', icon: '🔢' }
  ];

  global.__restoreRoutesData = {
    navTabs: NAV_TABS,
    href: {
      about: 'about.html',
      settings: 'settings.html',
      settingsCloudSync: 'settings.html#cloud-sync',
      dashboard: 'dashboard.html'
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
