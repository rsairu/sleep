/**
 * Canonical MPA routes for nav tabs and fixed menu/home hrefs.
 * Loaded as `<script type="module" src="routes-data.mjs" defer></script>` before sleep-utils (deferred chain).
 *
 * mpaHref(key) — internal navigation targets for MPA *.html (+ hash).
 * spaHref(key) — path routes for SPA (Vite shell); hash fragments preserved for deep links.
 */

/** Tab nav id → canonical SPA path (matches History API router). */
export const spaPathByTabId = {
  dashboard: '/dashboard',
  log: '/log',
  quality: '/quality',
  timeline: '/timeline',
  charts: '/charts',
  stats: '/stats'
};

export const navTabs = [
  { id: 'dashboard', key: 'nav.tabs.dashboard', defaultName: 'Dashboard', url: 'dashboard.html', icon: '🛌' },
  { id: 'log', key: 'nav.tabs.log', defaultName: 'Log', url: 'log.html', icon: '✏️' },
  { id: 'quality', key: 'nav.tabs.quality', defaultName: 'Quality', url: 'quality.html', icon: '💜' },
  { id: 'timeline', key: 'nav.tabs.daily', defaultName: 'Nightly', url: 'nightly.html', icon: '📅' },
  { id: 'charts', key: 'nav.tabs.graphs', defaultName: 'Charts', url: 'charts.html', icon: '📊' },
  { id: 'stats', key: 'nav.tabs.stats', defaultName: 'Stats', url: 'stats.html', icon: '🔢' }
];

/** Canonical legacy shell file -> SPA path map (used for rewrite/intercept compatibility). */
export const spaPathByMpaFile = {
  'dashboard.html': '/dashboard',
  'log.html': '/log',
  'quality.html': '/quality',
  'nightly.html': '/timeline',
  'charts.html': '/charts',
  'stats.html': '/stats',
  'about.html': '/about',
  'settings.html': '/settings',
  'index.html': '/dashboard'
};

/** Reverse map used by compatibility helpers. */
export const mpaFileBySpaPath = Object.keys(spaPathByMpaFile).reduce((acc, file) => {
  const path = spaPathByMpaFile[file];
  if (!acc[path]) acc[path] = file;
  return acc;
}, {});

export const href = {
  about: 'about.html',
  settings: 'settings.html',
  settingsCloudSync: 'settings.html#cloud-sync',
  dashboard: 'dashboard.html'
};

/** Menu / home paths for SPA (no *.html). */
export const spaHrefMenu = {
  about: '/about',
  settings: '/settings',
  settingsCloudSync: '/settings#cloud-sync',
  dashboard: '/dashboard'
};

/** Semantic key → resolver spec (see mpaHref). Registry also listed in docs/routing.md */
const INTERNAL_MPA_LINKS = {
  'tab.dashboard': { tab: 'dashboard' },
  'tab.log': { tab: 'log' },
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

export function spaPathForTabId(id) {
  const p = spaPathByTabId[id];
  return p || null;
}

export function spaPathFromMpaFile(fileName) {
  if (!fileName || typeof fileName !== 'string') return null;
  return spaPathByMpaFile[fileName] || null;
}

export function mpaFileFromSpaPath(pathname) {
  if (!pathname || typeof pathname !== 'string') return null;
  return mpaFileBySpaPath[pathname] || null;
}

export function spaHref(key) {
  const spec = INTERNAL_MPA_LINKS[key];
  if (!spec) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[routes-data] spaHref: unknown key "' + key + '"');
    }
    return '#';
  }
  if (spec.hrefKey) {
    const resolved = spaHrefMenu[spec.hrefKey] || spec.fallback || '#';
    if (spec.hash) {
      return stripHash(resolved) + '#' + spec.hash;
    }
    return resolved;
  }
  if (spec.tab) {
    const tabPath = spaPathByTabId[spec.tab];
    if (!tabPath) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[routes-data] spaHref: unknown tab id "' + spec.tab + '" for key "' + key + '"');
      }
      return '#';
    }
    return spec.hash ? stripHash(tabPath) + '#' + spec.hash : tabPath;
  }
  return '#';
}

/**
 * MPA or SPA href from the same semantic key (reads globalThis.__restoreUseSpaNav at call time).
 * @param {string} key
 */
export function internalNavHref(key) {
  const g = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : null;
  const spa = g && g.__restoreUseSpaNav;
  if (spa) return spaHref(key);
  return mpaHref(key);
}

/**
 * @param {object} globalObj - e.g. globalThis or a vm sandbox `window`
 */
export function installRoutesData(globalObj) {
  const g = globalObj && typeof globalObj === 'object' ? globalObj : globalThis;
  g.__restoreRoutesData = {
    navTabs,
    href,
    spaHrefMenu,
    spaPathByTabId,
    spaPathByMpaFile,
    mpaFileBySpaPath,
    mpaHref,
    spaHref,
    spaPathForTabId,
    spaPathFromMpaFile,
    mpaFileFromSpaPath,
    internalNavHref
  };
}

/* Browser: document exists. Node (math-tests): omit; caller uses installRoutesData(context). */
if (typeof document !== 'undefined') {
  installRoutesData(typeof globalThis !== 'undefined' ? globalThis : window);
}
