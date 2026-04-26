/**
 * Canonical MPA routes for nav tabs and fixed menu/home hrefs.
 * Loaded as `<script type="module" src="routes-data.mjs" defer></script>` before sleep-utils (deferred chain).
 *
 * mpaHref(key) — internal navigation targets for MPA *.html (+ hash). SPA pivot can add spaHref later.
 */

export const navTabs = [
  { id: 'dashboard', key: 'nav.tabs.dashboard', defaultName: 'Dashboard', url: 'dashboard.html', icon: '🛌' },
  { id: 'log', key: 'nav.tabs.log', defaultName: 'Log', url: 'log.html', icon: '✏️' },
  { id: 'quality', key: 'nav.tabs.quality', defaultName: 'Quality', url: 'quality.html', icon: '💜' },
  { id: 'timeline', key: 'nav.tabs.daily', defaultName: 'Nightly', url: 'nightly.html', icon: '📅' },
  { id: 'charts', key: 'nav.tabs.graphs', defaultName: 'Charts', url: 'charts.html', icon: '📊' },
  { id: 'stats', key: 'nav.tabs.stats', defaultName: 'Stats', url: 'stats.html', icon: '🔢' }
];

export const href = {
  about: 'about.html',
  settings: 'settings.html',
  settingsCloudSync: 'settings.html#cloud-sync',
  dashboard: 'dashboard.html'
};

/** Semantic key → resolver spec (see mpaHref). Registry also listed in docs/migration/route-table.md */
const INTERNAL_MPA_LINKS = {
  'about.page': { hrefKey: 'about', fallback: 'about.html' },
  'about.dailyFlags': { hrefKey: 'about', hash: 'daily-flags', fallback: 'about.html' },
  'about.quickActions': { hrefKey: 'about', hash: 'quick-actions', fallback: 'about.html' },
  'about.tonightBarSymbols': { hrefKey: 'about', hash: 'tonight-bar-symbols', fallback: 'about.html' },
  'about.remainingWakeTime': { hrefKey: 'about', hash: 'remaining-wake-time', fallback: 'about.html' },
  'about.sleepStatistics': { hrefKey: 'about', hash: 'sleep-statistics', fallback: 'about.html' },
  'about.tonightGuidance': { hrefKey: 'about', hash: 'tonight-guidance', fallback: 'about.html' },
  'settings.page': { hrefKey: 'settings', fallback: 'settings.html' },
  'settings.inAppTips': { hrefKey: 'settings', hash: 'in-app-tips', fallback: 'settings.html' },
  'settings.remainingWake': { hrefKey: 'settings', hash: 'remaining-wake', fallback: 'settings.html' },
  'settings.cloudSync': { hrefKey: 'settingsCloudSync', fallback: 'settings.html#cloud-sync' },
  'dashboard.page': { hrefKey: 'dashboard', fallback: 'dashboard.html' },
  'tab.quality': { tab: 'quality' },
  'tab.timeline': { tab: 'timeline' },
  'tab.charts': { tab: 'charts' },
  'tab.stats': { tab: 'stats' },
  'charts.bedAsleepWake': { tab: 'charts', hash: 'chart-bed-asleep-wake' },
  'charts.sleepDuration': { tab: 'charts', hash: 'chart-sleep-duration' }
};

function stripHash(url) {
  if (!url || typeof url !== 'string') return '';
  const i = url.indexOf('#');
  return i === -1 ? url : url.slice(0, i);
}

function tabUrlById(id) {
  for (let i = 0; i < navTabs.length; i++) {
    if (navTabs[i].id === id) return navTabs[i].url;
  }
  return null;
}

export function mpaHref(key) {
  const spec = INTERNAL_MPA_LINKS[key];
  if (!spec) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[routes-data] mpaHref: unknown key "' + key + '"');
    }
    return '#';
  }
  if (spec.hrefKey) {
    const resolved = href[spec.hrefKey] || spec.fallback || '#';
    if (spec.hash) {
      return stripHash(resolved) + '#' + spec.hash;
    }
    return resolved;
  }
  if (spec.tab) {
    const tabUrl = tabUrlById(spec.tab);
    if (!tabUrl) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[routes-data] mpaHref: unknown tab id "' + spec.tab + '" for key "' + key + '"');
      }
      return '#';
    }
    return spec.hash ? stripHash(tabUrl) + '#' + spec.hash : tabUrl;
  }
  return '#';
}

/**
 * @param {object} globalObj - e.g. globalThis or a vm sandbox `window`
 */
export function installRoutesData(globalObj) {
  const g = globalObj && typeof globalObj === 'object' ? globalObj : globalThis;
  g.__restoreRoutesData = {
    navTabs,
    href,
    mpaHref
  };
}

/* Browser: document exists. Node (math-tests): omit; caller uses installRoutesData(context). */
if (typeof document !== 'undefined') {
  installRoutesData(typeof globalThis !== 'undefined' ? globalThis : window);
}
