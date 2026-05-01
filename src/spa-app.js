/**
 * Vite SPA entry: History API router, modifier-safe link interception, fetch MPA shells for markup.
 * Sets globalThis.__restoreUseSpaNav so sleep-utils / nightly use path hrefs via routes-data internalNavHref.
 */
import '../routes-data.mjs';

globalThis.__restoreUseSpaNav = true;

const scriptLoaded = Object.create(null);

function scriptBase() {
  const b = import.meta.env.BASE_URL || '/';
  return b.endsWith('/') ? b : b + '/';
}

function loadClassicScript(relativePath) {
  const path = relativePath.replace(/^\//, '');
  if (scriptLoaded[path]) return scriptLoaded[path];
  scriptLoaded[path] = new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = scriptBase() + path;
    el.defer = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error('[spa-app] failed to load script: ' + el.src));
    document.head.appendChild(el);
  });
  return scriptLoaded[path];
}

async function fetchDocHtml(filename) {
  const name = filename.replace(/^\//, '');
  /* Production: shells live under /mpa/ so root *.html can 308 to path routes without breaking fetch */
  const path = (import.meta.env.PROD ? 'mpa/' : '') + name;
  const res = await fetch(scriptBase() + path);
  if (!res.ok) throw new Error('[spa-app] fetch failed: ' + path + ' (' + res.status + ')');
  return res.text();
}

function parseHtml(html) {
  return new DOMParser().parseFromString(html, 'text/html');
}

function rewriteMpaAnchors(rootEl) {
  const fileToPath = {
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
  rootEl.querySelectorAll('a[href]').forEach((a) => {
    const raw = a.getAttribute('href');
    if (!raw || raw.startsWith('#') || raw.startsWith('mailto:') || raw.startsWith('javascript:')) return;
    try {
      const abs = new URL(raw, window.location.origin);
      if (abs.origin !== window.location.origin) return;
      const file = abs.pathname.split('/').pop() || '';
      const spa = fileToPath[file];
      if (spa) {
        a.setAttribute('href', spa + (abs.hash || ''));
      }
    } catch (_) {
      /* ignore */
    }
  });
}

let currentLifecycle = null;

function unmountRoute() {
  if (currentLifecycle && typeof currentLifecycle.unmount === 'function') {
    try {
      currentLifecycle.unmount();
    } catch (e) {
      console.error('[spa-app] unmount error', e);
    }
  }
  currentLifecycle = null;
  const outlet = document.getElementById('spa-outlet');
  if (outlet) outlet.innerHTML = '';
}

const ROUTES = {
  '/dashboard': {
    navPage: 'dashboard',
    mpaFile: 'dashboard.html',
    bodyClass: '',
    extract(doc) {
      const inner = doc.querySelector('#dashboard-container');
      if (!inner) return '';
      return '<div class="container">' + inner.outerHTML + '</div>';
    },
    mountSelector: '#dashboard-container',
    lifecycleProp: '__restoreDashboardLifecycle',
    async preload() {
      await loadClassicScript('nightly.js');
      await loadClassicScript('quick-actions.js');
      await loadClassicScript('dashboard.js');
    },
    remainingWake: { interval: false }
  },
  '/log': {
    navPage: 'log',
    mpaFile: 'log.html',
    bodyClass: '',
    extract(doc) {
      const el = doc.querySelector('#log-page-root');
      if (!el) return '';
      return '<div class="container">' + el.outerHTML + '</div>';
    },
    mountSelector: '#log-page-root',
    lifecycleProp: '__restoreLogLifecycle',
    async preload() {
      await loadClassicScript('nightly.js');
      await loadClassicScript('entry-modal.js');
      await loadClassicScript('log.js');
    },
    remainingWake: { interval: false }
  },
  '/quality': {
    navPage: 'quality',
    mpaFile: 'quality.html',
    bodyClass: 'quality-page',
    extract(doc) {
      const inner = doc.querySelector('#quality-container');
      if (!inner) return '';
      return '<div class="container">' + inner.outerHTML + '</div>';
    },
    mountSelector: '#quality-container',
    lifecycleProp: '__restoreQualityLifecycle',
    async preload() {
      await loadClassicScript('nightly.js');
      await loadClassicScript('quality.js');
    },
    remainingWake: true
  },
  '/timeline': {
    navPage: 'timeline',
    mpaFile: 'nightly.html',
    bodyClass: '',
    extract(doc) {
      const el = doc.querySelector('#timeline-section');
      return el ? el.outerHTML : '';
    },
    mountSelector: '#timeline-section',
    lifecycleProp: '__restoreNightlyTimelineLifecycle',
    async preload() {
      await loadClassicScript('nightly.js');
    },
    remainingWake: true
  },
  '/charts': {
    navPage: 'charts',
    mpaFile: 'charts.html',
    bodyClass: '',
    extract(doc) {
      const el = doc.querySelector('#charts-page-root');
      if (!el) return '';
      const clone = el.cloneNode(true);
      clone.querySelectorAll('#tooltip, #day-panel').forEach(function (n) {
        n.remove();
      });
      return clone.outerHTML;
    },
    mountSelector: '#charts-page-root',
    lifecycleProp: '__restoreChartsLifecycle',
    async preload() {
      await loadClassicScript('charts.js');
    },
    remainingWake: true,
    afterMount() {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          if (typeof scrollGraphPageHashAfterNavOnce === 'function') scrollGraphPageHashAfterNavOnce();
        });
      });
    }
  },
  '/stats': {
    navPage: 'stats',
    mpaFile: 'stats.html',
    bodyClass: 'page-stats',
    extract(doc) {
      const el = doc.querySelector('#stats-page-root');
      return el ? el.outerHTML : '';
    },
    mountSelector: '#stats-page-root',
    lifecycleProp: '__restoreStatsLifecycle',
    async preload() {
      await loadClassicScript('stats-aggregates.js');
      await loadClassicScript('stats.js');
    },
    remainingWake: true
  },
  '/about': {
    navPage: 'about',
    mpaFile: 'about.html',
    bodyClass: '',
    extract(doc) {
      const el = doc.querySelector('#about-page-root');
      return el ? el.outerHTML : '';
    },
    mountSelector: '#about-page-root',
    lifecycleProp: '__restoreAboutLifecycle',
    async preload() {
      await loadClassicScript('about.js');
    },
    remainingWake: true
  },
  '/settings': {
    navPage: 'settings',
    mpaFile: 'settings.html',
    bodyClass: '',
    extract(doc) {
      const el = doc.querySelector('#settings-page-root');
      return el ? el.outerHTML : '';
    },
    mountSelector: '#settings-page-root',
    lifecycleProp: '__restoreSettingsLifecycle',
    async preload() {
      await loadClassicScript('settings.js');
    },
    remainingWake: true
  }
};

function normalizePath(pathname) {
  const p = pathname.replace(/\/+$/, '') || '/';
  return p;
}

async function activatePath(pathname, { replaceHash } = {}) {
  const norm = normalizePath(pathname);
  const key = ROUTES[norm] ? norm : '/dashboard';
  const cfg = ROUTES[key];
  if (!cfg) return;

  unmountRoute();

  const htmlText = await fetchDocHtml(cfg.mpaFile);
  const doc = parseHtml(htmlText);
  const fragment = cfg.extract(doc);
  const outlet = document.getElementById('spa-outlet');
  if (!outlet) throw new Error('[spa-app] #spa-outlet missing');
  outlet.innerHTML = fragment;
  rewriteMpaAnchors(outlet);

  document.body.className = cfg.bodyClass || '';

  await cfg.preload();

  if (typeof initI18n === 'function') {
    await initI18n(document);
  }
  const nav = document.getElementById('nav-container');
  if (nav && typeof renderNavBar === 'function') {
    nav.innerHTML = renderNavBar(cfg.navPage);
    rewriteMpaAnchors(nav);
  }
  if (typeof window !== 'undefined' && window.__restoreUseSpaNav) {
    window.__devClockControlBound = false;
    window.__devBannerCloudRefreshBound = false;
    window.__devBannerDbSwitchFlipBound = false;
    window.__devBannerDrawerBound = false;
    window.__devBannerUserSettingsBound = false;
  }
  if (typeof initDayNightTheme === 'function') initDayNightTheme();
  if (typeof initRemainingWakeNav === 'function') {
    if (cfg.remainingWake === true) initRemainingWakeNav();
    else if (cfg.remainingWake && typeof cfg.remainingWake === 'object') initRemainingWakeNav(cfg.remainingWake);
  }

  const root = document.querySelector(cfg.mountSelector);
  const life = window[cfg.lifecycleProp];
  if (root && life && typeof life.mount === 'function') {
    life.mount(root, {});
    currentLifecycle = life;
  }

  if (typeof cfg.afterMount === 'function') await cfg.afterMount();

  const h = replaceHash != null ? replaceHash : window.location.hash;
  if (h && h.length > 1) {
    const id = h.slice(1);
    requestAnimationFrame(function () {
      const target = document.getElementById(id);
      if (target && typeof target.scrollIntoView === 'function') target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
}

function isModifiedClick(e) {
  return e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;
}

function shouldInterceptNavigation(url) {
  if (url.origin !== window.location.origin) return false;
  const path = normalizePath(url.pathname);
  if (ROUTES[path]) return true;
  const file = url.pathname.split('/').pop() || '';
  if (/\.html$/i.test(file)) return true;
  return false;
}

function interceptClick(e) {
  const a = e.target && e.target.closest && e.target.closest('a[href]');
  if (!a || a.target === '_blank') return;
  if (isModifiedClick(e)) return;
  let url;
  try {
    url = new URL(a.getAttribute('href'), window.location.href);
  } catch (_) {
    return;
  }
  if (!shouldInterceptNavigation(url)) return;
  const curNorm = normalizePath(window.location.pathname);
  const nextNorm = normalizePath(url.pathname);
  if (nextNorm === curNorm && ROUTES[curNorm] && url.hash && url.hash.length > 1) {
    e.preventDefault();
    history.pushState(null, '', url.pathname + url.search + url.hash);
    const id = url.hash.slice(1);
    requestAnimationFrame(function () {
      const target = document.getElementById(id);
      if (target && typeof target.scrollIntoView === 'function') target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return;
  }
  const file = url.pathname.split('/').pop() || '';
  let path = normalizePath(url.pathname);
  if (/\.html$/i.test(file)) {
    const map = {
      dashboard: '/dashboard',
      log: '/log',
      quality: '/quality',
      nightly: '/timeline',
      charts: '/charts',
      stats: '/stats',
      about: '/about',
      settings: '/settings',
      index: '/dashboard'
    };
    const base = file.replace(/\.html$/i, '');
    path = map[base] ? map[base] : '/dashboard';
  }
  e.preventDefault();
  const dest = path + url.search + url.hash;
  history.pushState(null, '', dest);
  activatePath(path, { replaceHash: url.hash }).catch(function (err) {
    console.error(err);
  });
}

window.addEventListener('click', interceptClick, true);

window.addEventListener('popstate', function () {
  activatePath(window.location.pathname, { replaceHash: window.location.hash }).catch(function (err) {
    console.error(err);
  });
});

function boot() {
  const raw = normalizePath(window.location.pathname);
  const effective = raw === '/' ? '/dashboard' : raw;
  if (raw === '/') {
    history.replaceState(null, '', '/dashboard' + window.location.search + window.location.hash);
  }
  activatePath(effective, { replaceHash: window.location.hash }).catch(function (e) {
    console.error('[spa-app] boot failed', e);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
