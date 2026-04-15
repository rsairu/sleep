// Shared utility functions for sleep tracking application

// Holiday calendar: { year: { month: [day, ...] } }. Exposed on window for pages that need the reference.
const HOLIDAYS_BY_YEAR = {
  2026: {
    1: [1, 2, 3, 12],
    2: [11, 23],
    3: [20],
    4: [29],
    5: [3, 4, 5, 6],
    6: [],
    7: [20],
    8: [11],
    9: [21, 22, 23],
    10: [12],
    11: [3, 23],
    12: [31]
  }
};
if (typeof window !== 'undefined') window.HOLIDAYS_BY_YEAR = HOLIDAYS_BY_YEAR;

/** Fixed emoji keys for optional per-night labels (log + daily display). Order is canonical storage order. */
const SLEEP_DAY_LABEL_OPTIONS = [
  { emoji: '👶', title: 'Kids' },
  { emoji: '🐶', title: 'Pet' },
  { emoji: '🍺', title: 'Alcohol' },
  { emoji: '✈️', title: 'Travel' },
  { emoji: '😰', title: 'Stress' },
  { emoji: '💼', title: 'Work' },
  { emoji: '☕', title: 'Caffeine' },
  { emoji: '🍝', title: 'Late/heavy meal' },
  { emoji: '🤒', title: 'Illness' }
];
if (typeof window !== 'undefined') window.SLEEP_DAY_LABEL_OPTIONS = SLEEP_DAY_LABEL_OPTIONS;

const SLEEP_DAY_LABEL_EMOJI_SET = new Set(SLEEP_DAY_LABEL_OPTIONS.map(function (o) { return o.emoji; }));

function normalizeSleepDayLabels(value) {
  const raw = Array.isArray(value) ? value : [];
  const picked = new Set();
  for (let i = 0; i < raw.length; i++) {
    const e = raw[i];
    if (e != null && SLEEP_DAY_LABEL_EMOJI_SET.has(String(e))) picked.add(String(e));
  }
  return SLEEP_DAY_LABEL_OPTIONS.map(function (o) { return o.emoji; }).filter(function (e) { return picked.has(e); });
}

const SUPABASE_URL_STORAGE_KEY = 'restore_supabase_url';
const SUPABASE_ANON_KEY_STORAGE_KEY = 'restore_supabase_anon_key';
/** When `dev` or `prod`, dev builds re-apply matching pair from `local-supabase-presets.js` on each page. */
const ACTIVE_SUPABASE_PRESET_KEY = 'sleep-app-active-supabase-preset';
const RESTORE_LAST_DATA_SOURCE_KEY = 'restore_last_data_source';
/** When `'1'`, read sleep data from `data/sleep-data.json` even if Supabase is configured (testing). */
const RESTORE_FORCE_LOCAL_SLEEP_DATA_KEY = 'restore_force_local_sleep_data';
/** MVP single-user row until per-user auth; must match seed in supabase/schema.sql */
const RESTORE_CLOUD_USER_ID = '00000000-0000-0000-0000-000000000001';
/** After one-time local→cloud push when cloud row was still seed defaults */
const USER_SETTINGS_CLOUD_MIGRATION_DONE_KEY = 'restore_user_settings_cloud_migration_v1';
/** `sleep-app-quality-palette` when unset/invalid; seed defaults; dev-banner reset. */
const DEFAULT_QUALITY_PALETTE_ID = 'auto';
const SLEEP_DATA_LOCAL_CACHE_KEY = 'restore_sleep_data_cache_v2';
const SLEEP_DATA_CACHE_TTL_MS = 5 * 60 * 1000;

let sleepDataCacheValue = null;
let sleepDataCacheExpiresAt = 0;
let sleepDataCacheKey = '';
let sleepDataPendingPromise = null;

let userSettingsCloudHydrateSucceeded = false;
let userSettingsCloudHydratePromise = null;

function isSleepDataForcedLocal() {
  return safeReadStorage(RESTORE_FORCE_LOCAL_SLEEP_DATA_KEY) === '1';
}

function setSleepDataForcedLocal(on) {
  safeWriteStorage(RESTORE_FORCE_LOCAL_SLEEP_DATA_KEY, on ? '1' : '');
  clearSleepDataCache();
  resetUserSettingsCloudHydration();
  if (typeof window !== 'undefined') window.__RESTORE_DATA_SOURCE__ = '';
  updateDataSourceBadge();
}

function getSleepDataCacheKey(config) {
  if (!config || !config.enabled) return 'local';
  if (isSleepDataForcedLocal()) return 'local:forced';
  return 'cloud:' + String(config.url || '').replace(/\/+$/, '') + '|' + String(config.anonKey || '');
}

function loadSleepDataUsesSupabase(config) {
  return Boolean(config && config.enabled && !isSleepDataForcedLocal());
}

function cloneSleepData(data) {
  return JSON.parse(JSON.stringify(data));
}

function clearSleepDataCache() {
  sleepDataCacheValue = null;
  sleepDataCacheExpiresAt = 0;
  sleepDataCacheKey = '';
  sleepDataPendingPromise = null;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(SLEEP_DATA_LOCAL_CACHE_KEY);
    }
  } catch (_) {}
}

function readSleepDataLocalCache() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(SLEEP_DATA_LOCAL_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.cacheKey !== 'string') return null;
    if (!Number.isFinite(parsed.fetchedAt)) return null;
    if (!parsed.data || typeof parsed.data !== 'object') return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

function writeSleepDataLocalCache(cacheKey, data) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(
      SLEEP_DATA_LOCAL_CACHE_KEY,
      JSON.stringify({
        cacheKey: cacheKey,
        fetchedAt: getAppNowMs(),
        data: data
      })
    );
  } catch (_) {}
}

function safeReadStorage(key) {
  try {
    if (typeof localStorage === 'undefined') return '';
    return localStorage.getItem(key) || '';
  } catch (_) {
    return '';
  }
}

function safeWriteStorage(key, value) {
  try {
    if (typeof localStorage === 'undefined') return;
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch (_) {}
}

const LANGUAGE_KEY = 'sleep-app-language';
const DEFAULT_LANGUAGE = 'en';
const LOCALE_DICTIONARY_URL = 'locales.json';
const SUPPORTED_LANGUAGES = ['en', 'ja'];
let localeDictionaryCache = null;
let localeDictionaryPromise = null;

function normalizeLanguage(value) {
  const raw = String(value || '').toLowerCase();
  if (raw === 'ja' || raw.startsWith('ja-')) return 'ja';
  return 'en';
}

function getLanguagePreference() {
  const stored = safeReadStorage(LANGUAGE_KEY);
  if (stored) return normalizeLanguage(stored);
  if (typeof navigator !== 'undefined' && navigator.language) {
    return normalizeLanguage(navigator.language);
  }
  return DEFAULT_LANGUAGE;
}

function setLanguagePreference(language) {
  const normalized = normalizeLanguage(language);
  safeWriteStorage(LANGUAGE_KEY, normalized);
  syncUserSettingsRowToCloud();
  updateDevBannerUserSettingsPanel();
  return normalized;
}

function getLocalizedValue(dict, language, key) {
  if (!dict || typeof dict !== 'object') return '';
  const langDict = dict[language];
  if (!langDict || typeof langDict !== 'object') return '';
  let node = langDict;
  const parts = String(key || '').split('.');
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!node || typeof node !== 'object' || !(part in node)) return '';
    node = node[part];
  }
  return typeof node === 'string' ? node : '';
}

function t(key, fallback) {
  const language = getLanguagePreference();
  const preferred = getLocalizedValue(localeDictionaryCache, language, key);
  if (preferred) return preferred;
  const english = getLocalizedValue(localeDictionaryCache, 'en', key);
  if (english) return english;
  return fallback == null ? '' : String(fallback);
}

async function loadLocaleDictionary() {
  if (localeDictionaryCache) return localeDictionaryCache;
  if (localeDictionaryPromise) return localeDictionaryPromise;
  localeDictionaryPromise = fetch(LOCALE_DICTIONARY_URL, { cache: 'no-store' })
    .then(function (res) {
      if (!res.ok) return {};
      return res.json();
    })
    .then(function (json) {
      if (!json || typeof json !== 'object') return {};
      return json;
    })
    .catch(function () {
      return {};
    })
    .then(function (dict) {
      localeDictionaryCache = dict;
      if (typeof window !== 'undefined') window.__RESTORE_LOCALE_DICTIONARY__ = dict;
      return dict;
    })
    .finally(function () {
      localeDictionaryPromise = null;
    });
  return localeDictionaryPromise;
}

function applyTranslations(root) {
  const base = root || document;
  if (!base) return;
  base.querySelectorAll('[data-i18n]').forEach(function (el) {
    const key = el.getAttribute('data-i18n');
    const fallback = el.textContent || '';
    const value = t(key, fallback);
    if (value) el.textContent = value;
  });
  base.querySelectorAll('[data-i18n-aria-label]').forEach(function (el) {
    const key = el.getAttribute('data-i18n-aria-label');
    const fallback = el.getAttribute('aria-label') || '';
    const value = t(key, fallback);
    if (value) el.setAttribute('aria-label', value);
  });
  base.querySelectorAll('[data-i18n-title]').forEach(function (el) {
    const key = el.getAttribute('data-i18n-title');
    const fallback = el.getAttribute('title') || '';
    const value = t(key, fallback);
    if (value) el.setAttribute('title', value);
  });
}

async function initI18n(root) {
  await loadLocaleDictionary();
  const language = getLanguagePreference();
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.setAttribute('lang', language);
  }
  applyTranslations(root || document);
  return language;
}

function getSupabaseConfig() {
  const urlFromStorage = safeReadStorage(SUPABASE_URL_STORAGE_KEY).trim();
  const anonFromStorage = safeReadStorage(SUPABASE_ANON_KEY_STORAGE_KEY).trim();
  const urlFromWindow = typeof window !== 'undefined' && window.RESTORE_SUPABASE_URL ? String(window.RESTORE_SUPABASE_URL).trim() : '';
  const anonFromWindow = typeof window !== 'undefined' && window.RESTORE_SUPABASE_ANON_KEY ? String(window.RESTORE_SUPABASE_ANON_KEY).trim() : '';
  const url = urlFromStorage || urlFromWindow;
  const anonKey = anonFromStorage || anonFromWindow;
  return { url, anonKey, enabled: Boolean(url && anonKey) };
}

function setSupabaseConfig(url, anonKey) {
  safeWriteStorage(SUPABASE_URL_STORAGE_KEY, (url || '').trim());
  safeWriteStorage(SUPABASE_ANON_KEY_STORAGE_KEY, (anonKey || '').trim());
  clearSleepDataCache();
  resetUserSettingsCloudHydration();
}

function clearSupabaseConfig() {
  safeWriteStorage(SUPABASE_URL_STORAGE_KEY, '');
  safeWriteStorage(SUPABASE_ANON_KEY_STORAGE_KEY, '');
  safeWriteStorage(RESTORE_FORCE_LOCAL_SLEEP_DATA_KEY, '');
  clearActiveSupabasePreset();
  clearSleepDataCache();
  resetUserSettingsCloudHydration();
}

function readLocalSupabasePresets() {
  if (typeof window === 'undefined') return null;
  const raw = window.__RESTORE_SUPABASE_PRESETS__;
  if (!raw || typeof raw !== 'object') return null;
  const dev = raw.dev;
  const prod = raw.prod;
  if (!dev || typeof dev !== 'object' || !prod || typeof prod !== 'object') return null;
  const devUrl = String(dev.url || '').trim();
  const devKey = String(dev.anonKey || '').trim();
  const prodUrl = String(prod.url || '').trim();
  const prodKey = String(prod.anonKey || '').trim();
  if (!devUrl || !devKey || !prodUrl || !prodKey) return null;
  return {
    dev: { url: devUrl, anonKey: devKey },
    prod: { url: prodUrl, anonKey: prodKey }
  };
}

function getActiveSupabasePresetId() {
  const v = safeReadStorage(ACTIVE_SUPABASE_PRESET_KEY).trim().toLowerCase();
  if (v === 'dev' || v === 'prod') return v;
  return '';
}

function setActiveSupabasePresetId(id) {
  const n = String(id || '').trim().toLowerCase();
  if (n === 'dev' || n === 'prod') safeWriteStorage(ACTIVE_SUPABASE_PRESET_KEY, n);
  else safeWriteStorage(ACTIVE_SUPABASE_PRESET_KEY, '');
}

function clearActiveSupabasePreset() {
  safeWriteStorage(ACTIVE_SUPABASE_PRESET_KEY, '');
}

function ensureDevSupabasePresetApplied() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (!isDevBuildContext()) return;
  const id = getActiveSupabasePresetId();
  if (id !== 'dev' && id !== 'prod') return;
  const presets = readLocalSupabasePresets();
  if (!presets) return;
  const pair = presets[id];
  if (!pair) return;
  const cur = getSupabaseConfig();
  if (cur.url === pair.url && cur.anonKey === pair.anonKey) return;
  setSupabaseConfig(pair.url, pair.anonKey);
}

function getDataSourceState() {
  const config = getSupabaseConfig();
  if (config.enabled && isSleepDataForcedLocal()) return 'local';
  const explicit = typeof window !== 'undefined' ? window.__RESTORE_DATA_SOURCE__ : '';
  if (explicit === 'cloud' || explicit === 'local') return explicit;
  const stored = safeReadStorage(RESTORE_LAST_DATA_SOURCE_KEY);
  if (stored === 'cloud' || stored === 'local') return stored;
  return config.enabled ? 'cloud' : 'local';
}

const DATA_SOURCE_MENU_ICON_CLOUD =
  '<svg class="nav-menu-item-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z"/></svg>';
const DATA_SOURCE_MENU_ICON_LOCAL =
  '<svg class="nav-menu-item-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/></svg>';

function getDataSourceUIModel(source) {
  if (source === 'cloud') {
    return {
      title: 'Data source: Supabase cloud',
      iconSvg: DATA_SOURCE_MENU_ICON_CLOUD
    };
  }
  return {
    title: 'Data source: local JSON fallback',
    iconSvg: DATA_SOURCE_MENU_ICON_LOCAL
  };
}

function updateDataSourceBadge(source) {
  const resolved = source === 'cloud' || source === 'local' ? source : getDataSourceState();
  if (typeof window !== 'undefined') window.__RESTORE_DATA_SOURCE__ = resolved;
  safeWriteStorage(RESTORE_LAST_DATA_SOURCE_KEY, resolved);
  const link = document.getElementById('nav-menu-data-source');
  const iconWrap = document.getElementById('nav-menu-data-source-icon');
  if (!link || !iconWrap) return;
  const model = getDataSourceUIModel(resolved);
  link.title = model.title;
  link.setAttribute('aria-label', model.title);
  iconWrap.innerHTML = model.iconSvg;
}

function mapSupabaseRowToDay(row) {
  if (!row) return null;
  let canon = '';
  if (row.sleep_date != null && String(row.sleep_date).trim() !== '') {
    const s = String(row.sleep_date).trim().slice(0, 10);
    canon = normalizeSleepDateKey(s, LEGACY_SLEEP_DATE_FALLBACK_YEAR) || s;
  }
  if (!canon && row.date_md) {
    canon =
      normalizeSleepDateKey(row.date_md, LEGACY_SLEEP_DATE_FALLBACK_YEAR) || String(row.date_md).trim();
  }
  if (!canon) return null;
  return {
    date: canon,
    bed: row.bed,
    sleepStart: row.sleep_start,
    sleepEnd: row.sleep_end,
    bathroom: Array.isArray(row.bathroom) ? row.bathroom : [],
    alarm: Array.isArray(row.alarm) ? row.alarm : [],
    nap: row.nap_start
      ? { start: row.nap_start, end: row.nap_end != null && row.nap_end !== '' ? row.nap_end : null }
      : null,
    WASO: Number.isFinite(row.waso) ? row.waso : 0,
    labels: normalizeSleepDayLabels(row.labels)
  };
}

/**
 * Parse a wall-clock string to minutes from midnight (0–1439).
 * Accepts 24-hour "HH:MM" / "H:MM" and 12-hour "h:mm AM/PM" (case-insensitive).
 */
function parseWallClockToMinutes(timeStr) {
  if (timeStr == null || timeStr === '') return NaN;
  const s = String(timeStr).trim();
  const m12 = s.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/);
  if (m12) {
    let h = parseInt(m12[1], 10);
    const min = parseInt(m12[2], 10);
    const ap = m12[3].toUpperCase();
    if (h < 1 || h > 12 || min < 0 || min > 59) return NaN;
    if (ap === 'AM') {
      h = h === 12 ? 0 : h;
    } else {
      h = h === 12 ? 12 : h + 12;
    }
    return h * 60 + min;
  }
  const m24 = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m24) {
    const h = parseInt(m24[1], 10);
    const min = parseInt(m24[2], 10);
    if (h < 0 || h > 23 || min < 0 || min > 59) return NaN;
    return h * 60 + min;
  }
  return NaN;
}

function formatMinutesTo24hString(minutes) {
  const total = ((Math.round(Number(minutes)) % 1440) + 1440) % 1440;
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  return String(hours).padStart(2, '0') + ':' + String(mins).padStart(2, '0');
}

/** Canonicalize time text for Supabase (always HH:MM 24-hour). */
function normalizeTimeStringForSupabase(timeStr) {
  if (timeStr == null) return null;
  if (timeStr === '') return '';
  const m = parseWallClockToMinutes(timeStr);
  if (!Number.isFinite(m)) return String(timeStr).trim();
  return formatMinutesTo24hString(m);
}

function emptySleepDayForDate(dateMd) {
  return {
    date: dateMd,
    bed: null,
    sleepStart: null,
    sleepEnd: null,
    bathroom: [],
    alarm: [],
    nap: null,
    WASO: 0,
    labels: []
  };
}

/**
 * Merge a partial day update onto an existing day (or empty defaults for a new date).
 * Only keys present on `partial` are applied (`'key' in partial`), so omitted keys keep stored values.
 */
function mergePartialSleepDayForUpsert(existing, dateMd, partial) {
  const base = existing ? JSON.parse(JSON.stringify(existing)) : emptySleepDayForDate(dateMd);
  base.date = dateMd;
  const fields = ['bed', 'sleepStart', 'sleepEnd', 'bathroom', 'alarm', 'nap', 'WASO', 'labels'];
  for (let i = 0; i < fields.length; i++) {
    const k = fields[i];
    if (k in partial) base[k] = partial[k];
  }
  return base;
}

function mapDayToSupabaseRow(day) {
  const bathroom = Array.isArray(day.bathroom) ? day.bathroom.map(normalizeTimeStringForSupabase) : [];
  const alarm = Array.isArray(day.alarm) ? day.alarm.map(normalizeTimeStringForSupabase) : [];
  const dateMd =
    normalizeSleepDateKey(day.date, LEGACY_SLEEP_DATE_FALLBACK_YEAR) ||
    (day.date != null ? String(day.date).trim() : '');
  return {
    user_id: RESTORE_CLOUD_USER_ID,
    sleep_date: dateMd || null,
    date_md: dateMd,
    bed: normalizeTimeStringForSupabase(day.bed),
    sleep_start: normalizeTimeStringForSupabase(day.sleepStart),
    sleep_end: normalizeTimeStringForSupabase(day.sleepEnd),
    bathroom: bathroom,
    alarm: alarm,
    nap_start: day.nap && day.nap.start != null && day.nap.start !== '' ? normalizeTimeStringForSupabase(day.nap.start) : null,
    nap_end: day.nap && day.nap.end != null && day.nap.end !== '' ? normalizeTimeStringForSupabase(day.nap.end) : null,
    waso: Number.isFinite(day.WASO) ? day.WASO : 0,
    labels: normalizeSleepDayLabels(day.labels)
  };
}

function mapPartialDayToDraftPatch(partial) {
  const patch = {};
  if (!partial || typeof partial !== 'object') return patch;
  if ('bed' in partial) patch.bed = normalizeTimeStringForSupabase(partial.bed);
  if ('sleepStart' in partial) patch.sleep_start = normalizeTimeStringForSupabase(partial.sleepStart);
  if ('sleepEnd' in partial) patch.sleep_end = normalizeTimeStringForSupabase(partial.sleepEnd);
  if ('bathroom' in partial) {
    patch.bathroom = Array.isArray(partial.bathroom)
      ? partial.bathroom.map(normalizeTimeStringForSupabase)
      : [];
  }
  if ('alarm' in partial) {
    patch.alarm = Array.isArray(partial.alarm)
      ? partial.alarm.map(normalizeTimeStringForSupabase)
      : [];
  }
  if ('nap' in partial) {
    const nap = partial.nap || {};
    patch.nap_start = nap.start != null && nap.start !== '' ? normalizeTimeStringForSupabase(nap.start) : null;
    patch.nap_end = nap.end != null && nap.end !== '' ? normalizeTimeStringForSupabase(nap.end) : null;
  }
  if ('WASO' in partial) {
    patch.waso = Number.isFinite(partial.WASO) ? Math.max(0, Math.floor(partial.WASO)) : 0;
  }
  if ('labels' in partial) {
    patch.labels = normalizeSleepDayLabels(partial.labels);
  }
  return patch;
}

function resetUserSettingsCloudHydration() {
  userSettingsCloudHydrateSucceeded = false;
  userSettingsCloudHydratePromise = null;
}

function isSeedDefaultUserSettingsRow(row) {
  if (!row || typeof row !== 'object') return false;
  const t = row.theme_override;
  return (
    row.language === 'en' &&
    (t == null || t === '') &&
    row.clock_format === '24h' &&
    row.quality_palette === DEFAULT_QUALITY_PALETTE_ID &&
    Number(row.remaining_wake_open_min) === 35 &&
    Number(row.remaining_wake_winding_min) === 15 &&
    Number(row.remaining_wake_phase_heads_up_mins) === 30
  );
}

function localUserSettingsToRow() {
  const language = getLanguagePreference();
  const themeOverride = getThemeOverride();
  const theme_override = themeOverride === 'day' || themeOverride === 'night' ? themeOverride : null;
  let clock_format = getClockFormatPreference();
  if (clock_format !== '12h' && clock_format !== '24h') clock_format = '24h';
  let quality_palette = getQualityPaletteId();
  if (quality_palette !== 'meadow' && quality_palette !== 'harbor' && quality_palette !== 'auto') {
    quality_palette = DEFAULT_QUALITY_PALETTE_ID;
  }
  let thresholds = getRemainingWakeThresholds();
  let openMin = clampThresholdPercent(thresholds.openMin);
  let windingMin = clampThresholdPercent(thresholds.windingMin);
  if (openMin <= windingMin) {
    openMin = DEFAULT_REMAINING_WAKE_OPEN_MIN;
    windingMin = DEFAULT_REMAINING_WAKE_WINDING_MIN;
  }
  let remaining_wake_phase_heads_up_mins = getRemainingWakePhaseHeadsUpMinutes();
  if (REMAINING_WAKE_PHASE_HEADS_UP_ALLOWED.indexOf(remaining_wake_phase_heads_up_mins) === -1) {
    remaining_wake_phase_heads_up_mins = DEFAULT_REMAINING_WAKE_PHASE_HEADS_UP_MINS;
  }
  return {
    user_id: RESTORE_CLOUD_USER_ID,
    language: language === 'ja' ? 'ja' : 'en',
    theme_override: theme_override,
    clock_format: clock_format,
    quality_palette: quality_palette,
    remaining_wake_open_min: openMin,
    remaining_wake_winding_min: windingMin,
    remaining_wake_phase_heads_up_mins: remaining_wake_phase_heads_up_mins
  };
}

function localUserSettingsDiffersFromSeedDefaults() {
  return !isSeedDefaultUserSettingsRow(localUserSettingsToRow());
}

function userSettingsRowToLocalStorage(row) {
  if (!row || typeof row !== 'object') return;
  safeWriteStorage(LANGUAGE_KEY, row.language === 'ja' ? 'ja' : 'en');
  try {
    if (row.theme_override === 'day' || row.theme_override === 'night') {
      localStorage.setItem(THEME_OVERRIDE_KEY, row.theme_override);
    } else {
      localStorage.removeItem(THEME_OVERRIDE_KEY);
    }
  } catch (_) {}
  try {
    if (row.clock_format === '12h' || row.clock_format === '24h') {
      localStorage.setItem(CLOCK_FORMAT_KEY, row.clock_format);
    }
  } catch (_) {}
  try {
    if (row.quality_palette === 'meadow' || row.quality_palette === 'harbor' || row.quality_palette === 'auto') {
      localStorage.setItem(QUALITY_PALETTE_KEY, row.quality_palette);
    }
  } catch (_) {}
  let openMin = clampThresholdPercent(Number(row.remaining_wake_open_min));
  let windingMin = clampThresholdPercent(Number(row.remaining_wake_winding_min));
  if (openMin <= windingMin) {
    openMin = DEFAULT_REMAINING_WAKE_OPEN_MIN;
    windingMin = DEFAULT_REMAINING_WAKE_WINDING_MIN;
  }
  try {
    localStorage.setItem(REMAINING_WAKE_THRESHOLDS_KEY, JSON.stringify({ openMin: openMin, windingMin: windingMin }));
  } catch (_) {}
  const heads = parseInt(row.remaining_wake_phase_heads_up_mins, 10);
  if (REMAINING_WAKE_PHASE_HEADS_UP_ALLOWED.indexOf(heads) !== -1) {
    try {
      localStorage.setItem(REMAINING_WAKE_PHASE_HEADS_UP_KEY, String(heads));
    } catch (_) {}
  }
}

function fetchUserSettings(config) {
  if (!config || !config.enabled) return Promise.resolve(null);
  const uid = encodeURIComponent(RESTORE_CLOUD_USER_ID);
  const url =
    config.url.replace(/\/+$/, '') +
    '/rest/v1/user_settings?select=user_id,language,theme_override,clock_format,quality_palette,remaining_wake_open_min,remaining_wake_winding_min,remaining_wake_phase_heads_up_mins&user_id=eq.' +
    uid +
    '&limit=1';
  return fetch(url, { headers: getSupabaseAuthHeaders(config, false) })
    .then(function (res) {
      if (!res.ok) throw new Error('User settings read failed: ' + res.status);
      return res.json();
    })
    .then(function (rows) {
      if (!Array.isArray(rows) || rows.length === 0) return null;
      return rows[0];
    });
}

function upsertUserSettings(config, row) {
  if (!config || !config.enabled) {
    return Promise.reject(new Error('Supabase is not configured. Set URL and anon key in Settings.'));
  }
  const url = config.url.replace(/\/+$/, '') + '/rest/v1/user_settings?on_conflict=user_id';
  return fetch(url, {
    method: 'POST',
    headers: Object.assign({}, getSupabaseAuthHeaders(config, true), {
      Prefer: 'resolution=merge-duplicates,return=representation'
    }),
    body: JSON.stringify([row])
  }).then(function (res) {
    if (!res.ok) {
      return parseSupabaseErrorPayload(res).then(function (msg) {
        throw new Error('User settings upsert failed: ' + res.status + (msg ? ' — ' + msg : ''));
      });
    }
    return res.json();
  });
}

function ensureUserSettingsFromCloud(config) {
  if (!config || !loadSleepDataUsesSupabase(config)) return Promise.resolve();
  if (userSettingsCloudHydrateSucceeded) return Promise.resolve();
  if (userSettingsCloudHydratePromise) return userSettingsCloudHydratePromise;
  userSettingsCloudHydratePromise = fetchUserSettings(config)
    .then(function (row) {
      const migrationDone = safeReadStorage(USER_SETTINGS_CLOUD_MIGRATION_DONE_KEY) === '1';
      if (!row) {
        return upsertUserSettings(config, localUserSettingsToRow()).then(function () {
          safeWriteStorage(USER_SETTINGS_CLOUD_MIGRATION_DONE_KEY, '1');
        });
      }
      if (isSeedDefaultUserSettingsRow(row) && localUserSettingsDiffersFromSeedDefaults() && !migrationDone) {
        return upsertUserSettings(config, localUserSettingsToRow()).then(function () {
          safeWriteStorage(USER_SETTINGS_CLOUD_MIGRATION_DONE_KEY, '1');
        });
      }
      userSettingsRowToLocalStorage(row);
      safeWriteStorage(USER_SETTINGS_CLOUD_MIGRATION_DONE_KEY, '1');
    })
    .then(function () {
      userSettingsCloudHydrateSucceeded = true;
    })
    .catch(function (err) {
      console.warn('User settings cloud hydrate failed.', err);
    })
    .finally(function () {
      userSettingsCloudHydratePromise = null;
    });
  return userSettingsCloudHydratePromise;
}

function refreshUiAfterUserSettingsHydrate() {
  if (typeof document === 'undefined') return;
  applyDayNightTheme();
  updateDayNightIcon();
  updateThemeSelectors();
  updateClockFormatSelector();
  updateQualityPaletteSelector();
  const langSelect = document.getElementById('config-language-select');
  if (langSelect) langSelect.value = getLanguagePreference();
  const lang = getLanguagePreference();
  if (document.documentElement) document.documentElement.setAttribute('lang', lang);
  void initI18n(document);
  const inputOpen = document.getElementById('config-open-min');
  const inputWinding = document.getElementById('config-winding-min');
  if (inputOpen && inputWinding) {
    const th = getRemainingWakeThresholds();
    applyRemainingWakeThresholdsUI(100 - th.openMin, 100 - th.windingMin);
  }
  const headsUpRange = document.getElementById('config-rw-phase-heads-up');
  if (headsUpRange) {
    const mins = getRemainingWakePhaseHeadsUpMinutes();
    headsUpRange.value = String(remainingWakePhaseHeadsUpMinutesToSliderIndex(mins));
    headsUpRange.setAttribute('aria-valuetext', getRemainingWakePhaseHeadsUpStopAriaLabel(mins));
  }
  updateDevBannerUserSettingsPanel();
}

function chainSleepDataWithUserSettingsHydrate(config, dataPromise) {
  if (!loadSleepDataUsesSupabase(config)) return dataPromise;
  return dataPromise.then(function (data) {
    return ensureUserSettingsFromCloud(config).then(function () {
      refreshUiAfterUserSettingsHydrate();
      return data;
    });
  });
}

function syncUserSettingsRowToCloud() {
  const config = getSupabaseConfig();
  if (!loadSleepDataUsesSupabase(config)) return;
  var row;
  try {
    row = localUserSettingsToRow();
  } catch (_e) {
    return;
  }
  void upsertUserSettings(config, row).catch(function (err) {
    console.warn('User settings sync failed.', err);
  });
}

function getSupabaseAuthHeaders(config, includeJson) {
  const headers = {
    apikey: config.anonKey,
    Authorization: 'Bearer ' + config.anonKey
  };
  if (includeJson) headers['Content-Type'] = 'application/json';
  return headers;
}

function parseSupabaseErrorPayload(res) {
  return res.text().then(function (body) {
    if (!body) return '';
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed === 'object') {
        if (parsed.message) return String(parsed.message);
        if (parsed.error) return String(parsed.error);
      }
    } catch (_e) {}
    return body;
  }).catch(function () {
    return '';
  });
}

function sortDaysNewestFirst(days) {
  return days.slice().sort(function (a, b) {
    const ka = normalizeSleepDateKey(a.date) || String(a.date || '');
    const kb = normalizeSleepDateKey(b.date) || String(b.date || '');
    return kb.localeCompare(ka);
  });
}

function fetchStaticSleepData() {
  return fetch('data/sleep-data.json').then(r => r.json());
}

function fetchSupabaseSleepData(config) {
  const uid = encodeURIComponent(RESTORE_CLOUD_USER_ID);
  const url =
    config.url.replace(/\/+$/, '') +
    '/rest/v1/sleep_days?select=user_id,sleep_date,date_md,bed,sleep_start,sleep_end,bathroom,alarm,nap_start,nap_end,waso,labels&user_id=eq.' +
    uid;
  return fetch(url, {
    headers: {
      apikey: config.anonKey,
      Authorization: 'Bearer ' + config.anonKey
    }
  }).then(function (res) {
    if (!res.ok) throw new Error('Supabase read failed: ' + res.status);
    return res.json();
  }).then(function (rows) {
    const days = (rows || []).map(mapSupabaseRowToDay).filter(Boolean);
    return { days: sortDaysNewestFirst(days) };
  });
}

function loadSleepData(options) {
  const opts = options || {};
  const forceRefresh = Boolean(opts.forceRefresh);
  const config = getSupabaseConfig();
  const cacheKey = getSleepDataCacheKey(config);
  const now = getAppNowMs();
  const manualRefreshOnly = config.enabled && isDevBuildContext();

  if (
    !forceRefresh &&
    sleepDataCacheValue &&
    sleepDataCacheKey === cacheKey &&
    (manualRefreshOnly || now < sleepDataCacheExpiresAt)
  ) {
    updateDataSourceBadge(loadSleepDataUsesSupabase(config) ? 'cloud' : 'local');
    return chainSleepDataWithUserSettingsHydrate(config, Promise.resolve(cloneSleepData(sleepDataCacheValue)));
  }

  if (!forceRefresh && sleepDataPendingPromise && sleepDataCacheKey === cacheKey) {
    return chainSleepDataWithUserSettingsHydrate(config, sleepDataPendingPromise.then(cloneSleepData));
  }

  if (!forceRefresh) {
    const storedCache = readSleepDataLocalCache();
    if (
      storedCache &&
      storedCache.cacheKey === cacheKey &&
      (manualRefreshOnly || now < storedCache.fetchedAt + SLEEP_DATA_CACHE_TTL_MS)
    ) {
      sleepDataCacheValue = storedCache.data;
      sleepDataCacheKey = cacheKey;
      sleepDataCacheExpiresAt = storedCache.fetchedAt + SLEEP_DATA_CACHE_TTL_MS;
      updateDataSourceBadge(loadSleepDataUsesSupabase(config) ? 'cloud' : 'local');
      return chainSleepDataWithUserSettingsHydrate(config, Promise.resolve(cloneSleepData(storedCache.data)));
    }
  }

  sleepDataCacheKey = cacheKey;
  const request = (loadSleepDataUsesSupabase(config)
    ? fetchSupabaseSleepData(config)
        .then(function (data) {
          updateDataSourceBadge('cloud');
          return data;
        })
        .catch(function (error) {
          console.warn('Supabase load failed; falling back to data/sleep-data.json.', error);
          updateDataSourceBadge('local');
          return fetchStaticSleepData();
        })
    : fetchStaticSleepData().then(function (data) {
        updateDataSourceBadge('local');
        return data;
      })
  ).then(function (data) {
    sleepDataCacheValue = data;
    sleepDataCacheExpiresAt = getAppNowMs() + SLEEP_DATA_CACHE_TTL_MS;
    writeSleepDataLocalCache(cacheKey, data);
    const out = cloneSleepData(data);
    if (loadSleepDataUsesSupabase(config)) {
      return ensureUserSettingsFromCloud(config).then(function () {
        refreshUiAfterUserSettingsHydrate();
        return out;
      });
    }
    return out;
  });

  sleepDataPendingPromise = request.finally(function () {
    sleepDataPendingPromise = null;
  });

  return sleepDataPendingPromise;
}

function upsertSleepDay(day) {
  const config = getSupabaseConfig();
  if (!config.enabled) {
    return Promise.reject(new Error('Supabase is not configured. Set URL and anon key in Settings.'));
  }
  const row = mapDayToSupabaseRow(day);
  const url = config.url.replace(/\/+$/, '') + '/rest/v1/sleep_days?on_conflict=user_id,sleep_date';
  return fetch(url, {
    method: 'POST',
    headers: {
      apikey: config.anonKey,
      Authorization: 'Bearer ' + config.anonKey,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation'
    },
    body: JSON.stringify([row])
  }).then(function (res) {
    if (!res.ok) throw new Error('Supabase upsert failed: ' + res.status);
    return res.json();
  }).then(function (rows) {
    clearSleepDataCache();
    return rows;
  });
}

function getSleepDayByDate(dateMd) {
  if (!dateMd) return Promise.resolve(null);
  return loadSleepData().then(function (data) {
    const days = Array.isArray(data && data.days) ? data.days : [];
    for (let i = 0; i < days.length; i++) {
      if (days[i].date === dateMd) return days[i];
    }
    return null;
  });
}

function getSleepDraftByDate(dateMd) {
  const config = getSupabaseConfig();
  if (!config.enabled || !dateMd) return Promise.resolve(null);
  const iso =
    normalizeSleepDateKey(dateMd, LEGACY_SLEEP_DATE_FALLBACK_YEAR) || String(dateMd).trim();
  if (!iso) return Promise.resolve(null);
  const select = 'user_id,sleep_date,date_md,bed,sleep_start,sleep_end,bathroom,alarm,nap_start,nap_end,waso,labels';
  const qIso = encodeURIComponent(iso);
  const uid = encodeURIComponent(RESTORE_CLOUD_USER_ID);
  const url =
    config.url.replace(/\/+$/, '') +
    '/rest/v1/sleep_day_drafts?select=' +
    select +
    '&user_id=eq.' +
    uid +
    '&sleep_date=eq.' +
    qIso +
    '&limit=1';
  return fetch(url, {
    headers: getSupabaseAuthHeaders(config, false)
  }).then(function (res) {
    if (!res.ok) {
      return parseSupabaseErrorPayload(res).then(function (msg) {
        throw new Error('Supabase draft read failed: ' + res.status + (msg ? ' — ' + msg : ''));
      });
    }
    return res.json();
  }).then(function (rows) {
    if (!Array.isArray(rows) || rows.length === 0) return null;
    return mapSupabaseRowToDay(rows[0]);
  });
}

function upsertSleepDraftPartial(dateMd, partial) {
  const config = getSupabaseConfig();
  if (!config.enabled) {
    return Promise.reject(new Error('Supabase is not configured. Set URL and anon key in Settings.'));
  }
  if (!dateMd) {
    return Promise.reject(new Error('Missing date for draft upsert.'));
  }
  return getSleepDraftByDate(dateMd).then(function (existingDraft) {
    const merged = mergePartialSleepDayForUpsert(existingDraft, dateMd, partial || {});
    const row = mapDayToSupabaseRow(merged);
    const url = config.url.replace(/\/+$/, '') + '/rest/v1/sleep_day_drafts?on_conflict=user_id,sleep_date';
    return fetch(url, {
      method: 'POST',
      headers: Object.assign(
        {},
        getSupabaseAuthHeaders(config, true),
        { Prefer: 'resolution=merge-duplicates,return=representation' }
      ),
      body: JSON.stringify([row])
    });
  }).then(function (res) {
    if (!res.ok) {
      return parseSupabaseErrorPayload(res).then(function (msg) {
        throw new Error('Supabase draft upsert failed: ' + res.status + (msg ? ' — ' + msg : ''));
      });
    }
    return res.json();
  });
}

function saveDraftAndMaybePromote(dateMd, partial) {
  const config = getSupabaseConfig();
  if (!config.enabled) {
    return Promise.reject(new Error('Supabase is not configured. Set URL and anon key in Settings.'));
  }
  if (!dateMd) {
    return Promise.reject(new Error('Missing date for draft save.'));
  }
  const key =
    normalizeSleepDateKey(dateMd, LEGACY_SLEEP_DATE_FALLBACK_YEAR) || String(dateMd).trim();
  const patch = mapPartialDayToDraftPatch(partial || {});
  if (Object.keys(patch).length === 0) {
    return Promise.resolve({ promoted: false, date_md: key || dateMd });
  }
  const url = config.url.replace(/\/+$/, '') + '/rest/v1/rpc/promote_draft_if_complete';
  return fetch(url, {
    method: 'POST',
    headers: getSupabaseAuthHeaders(config, true),
    body: JSON.stringify({
      p_date_md: key,
      p_patch: patch
    })
  }).then(function (res) {
    if (!res.ok) {
      return parseSupabaseErrorPayload(res).then(function (msg) {
        throw new Error('Supabase draft save failed: ' + res.status + (msg ? ' — ' + msg : ''));
      });
    }
    return res.json();
  }).then(function (result) {
    clearSleepDataCache();
    if (Array.isArray(result)) return result[0] || { promoted: false, date_md: key || dateMd };
    return result || { promoted: false, date_md: key || dateMd };
  });
}

function initSupabaseConfigForm() {
  const mount = document.getElementById('supabase-config-mount');
  if (!mount) return;
  const cfg = getSupabaseConfig();
  mount.innerHTML =
    '<div class="supabase-config-card">' +
      '<p class="section-intro">Connect Restore to Supabase for cloud sync. If blank, the app uses local <code>data/sleep-data.json</code> as read-only fallback.</p>' +
      '<div class="config-data-source-toggle-wrap" id="config-data-source-toggle-wrap" hidden>' +
      '<p class="section-intro config-data-source-toggle-label" id="config-data-source-toggle-label">Data load source</p>' +
      '<div class="config-data-source-toggle" role="group" aria-labelledby="config-data-source-toggle-label">' +
      '<button type="button" class="config-data-source-toggle-btn" id="data-source-pick-cloud" aria-pressed="false">' +
      '<span class="config-data-source-toggle-emoji" aria-hidden="true">☁️</span> Cloud' +
      '</button>' +
      '<button type="button" class="config-data-source-toggle-btn" id="data-source-pick-local" aria-pressed="false">' +
      '<span class="config-data-source-toggle-emoji" aria-hidden="true">💾</span> Local' +
      '</button>' +
      '</div>' +
      '<p class="section-intro config-data-source-toggle-hint">Local uses <code>data/sleep-data.json</code> only; cloud uses Supabase. Reload other tabs or use Fetch latest after switching.</p>' +
      '</div>' +
      '<label class="supabase-config-label" for="supabase-url-input">Supabase URL</label>' +
      '<input class="supabase-config-input" id="supabase-url-input" type="url" placeholder="https://YOUR-PROJECT.supabase.co" value="' + escapeHtmlBannerAttr(cfg.url) + '">' +
      '<label class="supabase-config-label" for="supabase-anon-input">Supabase anon key</label>' +
      '<input class="supabase-config-input" id="supabase-anon-input" type="password" placeholder="eyJ..." value="' + escapeHtmlBannerAttr(cfg.anonKey) + '">' +
      '<div class="supabase-config-actions">' +
        '<button type="button" class="about-theme-option" id="supabase-save-btn">Save</button>' +
        '<button type="button" class="about-theme-option" id="supabase-test-btn">Test connection</button>' +
        '<button type="button" class="about-theme-option" id="supabase-refresh-btn">Fetch latest cloud data</button>' +
        '<button type="button" class="about-theme-option" id="supabase-clear-btn">Clear</button>' +
      '</div>' +
      '<p class="section-intro supabase-config-status" id="supabase-config-status"></p>' +
    '</div>';

  const statusEl = document.getElementById('supabase-config-status');
  const urlEl = document.getElementById('supabase-url-input');
  const keyEl = document.getElementById('supabase-anon-input');
  const saveBtn = document.getElementById('supabase-save-btn');
  const testBtn = document.getElementById('supabase-test-btn');
  const refreshBtn = document.getElementById('supabase-refresh-btn');
  const clearBtn = document.getElementById('supabase-clear-btn');
  const toggleWrap = document.getElementById('config-data-source-toggle-wrap');
  const pickLocalBtn = document.getElementById('data-source-pick-local');
  const pickCloudBtn = document.getElementById('data-source-pick-cloud');
  if (!statusEl || !urlEl || !keyEl || !saveBtn || !testBtn || !refreshBtn || !clearBtn) return;

  function syncDataSourceToggleUI() {
    if (!toggleWrap || !pickLocalBtn || !pickCloudBtn) return;
    const enabled = getSupabaseConfig().enabled;
    toggleWrap.hidden = !enabled;
    if (!enabled) return;
    const forced = isSleepDataForcedLocal();
    pickLocalBtn.setAttribute('aria-pressed', forced ? 'true' : 'false');
    pickCloudBtn.setAttribute('aria-pressed', forced ? 'false' : 'true');
  }

  syncDataSourceToggleUI();

  if (pickLocalBtn && pickCloudBtn) {
    pickLocalBtn.addEventListener('click', function () {
      if (!getSupabaseConfig().enabled) return;
      setSleepDataForcedLocal(true);
      syncDataSourceToggleUI();
      setStatus('Loading from local data/sleep-data.json. Reload other open tabs or refetch here.', false);
    });
    pickCloudBtn.addEventListener('click', function () {
      if (!getSupabaseConfig().enabled) return;
      setSleepDataForcedLocal(false);
      syncDataSourceToggleUI();
      setStatus('Loading from Supabase on next fetch or page reload.', false);
    });
  }

  function setStatus(text, isError) {
    statusEl.textContent = text;
    statusEl.classList.toggle('supabase-config-status--error', Boolean(isError));
  }

  saveBtn.addEventListener('click', function () {
    const url = (urlEl.value || '').trim();
    const anonKey = (keyEl.value || '').trim();
    if (!url || !anonKey) {
      setStatus('Enter both URL and anon key to enable cloud sync.', true);
      return;
    }
    setSupabaseConfig(url, anonKey);
    clearActiveSupabasePreset();
    syncDataSourceToggleUI();
    setStatus('Saved. Reload any page to use cloud data.', false);
  });

  testBtn.addEventListener('click', function () {
    const url = (urlEl.value || '').trim();
    const anonKey = (keyEl.value || '').trim();
    if (!url || !anonKey) {
      setStatus('Enter both URL and anon key before testing.', true);
      return;
    }
    testBtn.disabled = true;
    setStatus('Testing connection...', false);
    const uid = encodeURIComponent(RESTORE_CLOUD_USER_ID);
    const endpoint =
      url.replace(/\/+$/, '') +
      '/rest/v1/sleep_days?select=sleep_date&user_id=eq.' +
      uid +
      '&limit=1';
    fetch(endpoint, {
      headers: {
        apikey: anonKey,
        Authorization: 'Bearer ' + anonKey
      }
    })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function () {
        setStatus('Connection successful.', false);
      })
      .catch(function (error) {
        setStatus('Connection failed: ' + (error && error.message ? error.message : 'unknown error'), true);
      })
      .finally(function () {
        testBtn.disabled = false;
      });
  });

  refreshBtn.addEventListener('click', function () {
    const cfg = getSupabaseConfig();
    if (!cfg.enabled) {
      setStatus('Save URL and anon key first, then fetch latest cloud data.', true);
      return;
    }
    refreshBtn.disabled = true;
    setStatus('Fetching latest cloud data...', false);
    loadSleepData({ forceRefresh: true })
      .then(function (data) {
        const count = data && Array.isArray(data.days) ? data.days.length : null;
        const suffix = count == null ? '' : ' (' + count + ' nights)';
        setStatus('Latest cloud data loaded' + suffix + '.', false);
      })
      .catch(function (error) {
        setStatus('Fetch failed: ' + (error && error.message ? error.message : 'unknown error'), true);
      })
      .finally(function () {
        refreshBtn.disabled = false;
      });
  });

  clearBtn.addEventListener('click', function () {
    clearSupabaseConfig();
    urlEl.value = '';
    keyEl.value = '';
    syncDataSourceToggleUI();
    setStatus('Cleared. App will fall back to data/sleep-data.json.', false);
  });
}

function timeToMinutes(time) {
  return parseWallClockToMinutes(time);
}

// Minutes between start and end, handling midnight crossover
function durationMinutes(startMinutes, endMinutes) {
  return endMinutes >= startMinutes ? endMinutes - startMinutes : endMinutes + 1440 - startMinutes;
}

// Format minutes as "Xh Ym" or "Xh" or "Ym"
function formatDuration(minutes) {
  const m = Math.round(minutes);
  const hours = Math.floor(m / 60);
  const mins = m % 60;
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

// Format minutes from midnight as "HH:MM"
// Optionally return "00" for midnight (for graph display)
function formatTime(minutes, shortMidnight = false) {
  const total = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  const clockFormat = getClockFormatPreference();
  if (clockFormat === '24h' && shortMidnight && hours === 0) {
    return `00`;
  }
  if (clockFormat === '12h') {
    const hour12 = hours % 12 || 12;
    const ampm = hours < 12 ? 'AM' : 'PM';
    return `${hour12}:${String(mins).padStart(2, '0')} ${ampm}`;
  }
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

// Calculate sleep duration (including naps)
function calculateTotalSleep(day) {
  const sleepStart = timeToMinutes(day.sleepStart);
  const sleepEnd = timeToMinutes(day.sleepEnd);
  let total = durationMinutes(sleepStart, sleepEnd);
  if (day.nap && day.nap.start && day.nap.end) {
    total += durationMinutes(timeToMinutes(day.nap.start), timeToMinutes(day.nap.end));
  }
  return total;
}

/**
 * Stripe level from JSON `WASO` (wake-after-sleep-onset episode count): 1 → mild, 2 → moderate, 3+ → severe.
 * Returns null when WASO is 0, missing, or invalid.
 */
function normalizeFragmentationLevel(day) {
  const n = day && day.WASO;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const w = Math.floor(n);
  if (w < 1) return null;
  if (w === 1) return 'mild';
  if (w === 2) return 'moderate';
  return 'severe';
}

/**
 * Diagonal stripe overlay on SVG sleep duration bars (dashboard / graph).
 * Inserts foreignObject above the bar rect; pointer-events none.
 */
function appendSvgSleepBarFragmentation(parentG, x, y, width, height, level) {
  if (!level || width <= 0 || height <= 0) return;
  const fo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
  fo.setAttribute('x', String(x));
  fo.setAttribute('y', String(y));
  fo.setAttribute('width', String(width));
  fo.setAttribute('height', String(height));
  fo.setAttribute('class', 'sleep-bar-frag-fo');
  const div = document.createElement('div');
  div.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  div.className = `sleep-bar-frag-fill sleep-fragmentation sleep-fragmentation--${level}`;
  fo.appendChild(div);
  parentG.appendChild(fo);
}

/** When a sleep key is legacy M/D (no year), assume this calendar year. */
var LEGACY_SLEEP_DATE_FALLBACK_YEAR = 2026;

function isIsoSleepDateString(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.trim());
}

function parseIsoLocalDate(iso) {
  const m = String(iso)
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dt;
}

function formatIsoDateFromLocalDate(d) {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + mo + '-' + day;
}

/**
 * Canonical sleep row key YYYY-MM-DD. Accepts ISO, legacy M/D, or M/D/YYYY.
 * @param {string} input
 * @param {number} [fallbackYear] for M/D without year (defaults to LEGACY_SLEEP_DATE_FALLBACK_YEAR)
 */
function normalizeSleepDateKey(input, fallbackYear) {
  if (input == null || input === '') return '';
  const s = String(input).trim();
  if (!s) return '';
  if (isIsoSleepDateString(s)) {
    const d = parseIsoLocalDate(s);
    return d ? formatIsoDateFromLocalDate(d) : '';
  }
  const parts = s.split('/').map(function (p) {
    return p.trim();
  });
  if (parts.length >= 2) {
    const month = parseInt(parts[0], 10);
    const day = parseInt(parts[1], 10);
    const y =
      parts.length >= 3 && parts[2] !== ''
        ? parseInt(parts[2], 10)
        : Number.isFinite(fallbackYear)
          ? fallbackYear
          : LEGACY_SLEEP_DATE_FALLBACK_YEAR;
    if (!Number.isFinite(month) || !Number.isFinite(day) || !Number.isFinite(y)) return '';
    if (month < 1 || month > 12 || day < 1 || day > 31) return '';
    const d = new Date(y, month - 1, day);
    if (d.getFullYear() !== y || d.getMonth() !== month - 1 || d.getDate() !== day) return '';
    return formatIsoDateFromLocalDate(d);
  }
  return '';
}

/** Local midnight Date from sleep key (ISO or legacy M/D). */
function parseSleepDateToLocalDate(dateString, fallbackYear) {
  if (!dateString) return new Date(NaN);
  const fy = Number.isFinite(fallbackYear) ? fallbackYear : LEGACY_SLEEP_DATE_FALLBACK_YEAR;
  const iso = normalizeSleepDateKey(dateString, fy);
  if (!iso) return new Date(NaN);
  const d = parseIsoLocalDate(iso);
  return d || new Date(NaN);
}

/** M/D display for UI tooltips and day headers (from ISO or legacy key). */
function formatSleepDateMonthDay(isoOrLegacy) {
  const d = parseSleepDateToLocalDate(isoOrLegacy);
  if (Number.isNaN(d.getTime())) return String(isoOrLegacy || '');
  return d.getMonth() + 1 + '/' + d.getDate();
}

/** Years present in sleep rows (newest first), for multi-year heatmaps. */
function getSleepDataYearsPresentDescending(days) {
  if (!days || !days.length) {
    return typeof getAppDate === 'function' ? [getAppDate().getFullYear()] : [LEGACY_SLEEP_DATE_FALLBACK_YEAR];
  }
  const years = new Set();
  for (let i = 0; i < days.length; i++) {
    const dt = parseSleepDateToLocalDate(days[i].date);
    if (!Number.isNaN(dt.getTime())) years.add(dt.getFullYear());
  }
  const arr = Array.from(years);
  arr.sort(function (a, b) {
    return b - a;
  });
  return arr.length
    ? arr
    : [typeof getAppDate === 'function' ? getAppDate().getFullYear() : LEGACY_SLEEP_DATE_FALLBACK_YEAR];
}

// Parse date string to [month, day] (1-based month). Supports ISO and legacy M/D.
function parseDateString(dateString) {
  const d = parseSleepDateToLocalDate(dateString);
  if (Number.isNaN(d.getTime())) return [NaN, NaN];
  return [d.getMonth() + 1, d.getDate()];
}

// Get Date from sleep key; legacy M/D uses fallbackYear when year is absent from string.
function getDateFromString(dateString, fallbackYear) {
  const fy = Number.isFinite(fallbackYear) ? fallbackYear : LEGACY_SLEEP_DATE_FALLBACK_YEAR;
  return parseSleepDateToLocalDate(dateString, fy);
}

// Check if a date is a weekend (Saturday or Sunday)
// Accepts either a Date object or sleep date string (ISO or legacy M/D).
function isWeekend(dateOrString, fallbackYear) {
  let date;
  if (dateOrString instanceof Date) {
    date = dateOrString;
  } else {
    date = getDateFromString(dateOrString, fallbackYear);
  }
  return date.getDay() % 6 === 0; // 0 = Sunday, 6 = Saturday
}

// Check if a date is a holiday
// Accepts either a Date object or sleep date string. holidays is optional (defaults to HOLIDAYS_BY_YEAR).
function isHoliday(dateOrString, holidays, fallbackYear) {
  const h = holidays ?? HOLIDAYS_BY_YEAR;
  let month;
  let day;
  let y;
  if (dateOrString instanceof Date) {
    month = dateOrString.getMonth() + 1;
    day = dateOrString.getDate();
    y = dateOrString.getFullYear();
  } else {
    const fy = Number.isFinite(fallbackYear) ? fallbackYear : LEGACY_SLEEP_DATE_FALLBACK_YEAR;
    const d = parseSleepDateToLocalDate(dateOrString, fy);
    if (Number.isNaN(d.getTime())) return false;
    month = d.getMonth() + 1;
    day = d.getDate();
    y = d.getFullYear();
  }
  const yearHolidays = h[y];
  if (!yearHolidays) return false;
  return yearHolidays[month] && yearHolidays[month].includes(day);
}

// Normalize time for averaging (handles times that cross midnight)
// Times before noon (00:00-11:59) are treated as next day (add 1440)
// This ensures early morning fell asleep times are averaged correctly with late night times
function normalizeTimeForAveraging(minutes) {
  if (minutes < 720) { // Before noon (12:00)
    return minutes + 1440; // Add 24 hours
  }
  return minutes;
}

/**
 * Wake clock (sleepEnd) on the same extended timeline as fell-asleep averaging.
 * After an overnight span (wake clock before sleep-start clock), wake is next calendar segment (+1440).
 * Same-calendar-day segment uses normalizeTimeForAveraging(wake) so morning naps stay compatible with night sleep.
 * Overnight wrap uses sleep-start clock; same-calendar segment defers to normalizeTimeForAveraging.
 */
function normalizeWakeTimeForAveraging(sleepStartMinutes, wakeMinutes) {
  if (wakeMinutes < sleepStartMinutes) {
    return wakeMinutes + 1440;
  }
  if (sleepStartMinutes < 360 && wakeMinutes >= 600) {
    return wakeMinutes + 1440;
  }
  return normalizeTimeForAveraging(wakeMinutes);
}

// Denormalize time back to 0-1440 range
function denormalizeTimeForAveraging(normalizedMinutes) {
  return normalizedMinutes % 1440;
}

// Normalize time for comparison (handles times that cross midnight)
// For bed times: times at/after noon (12:00-23:59) are normalized to negative values
// This allows correct comparison with times after midnight (00:00-11:59)
function normalizeTimeForComparison(minutes) {
  // If time is at or after noon (720 minutes), it's before midnight
  // Normalize by subtracting 1440 to make it negative for comparison
  if (minutes >= 720) {
    return minutes - 1440;
  }
  return minutes;
}

// Normalize time for Y-axis positioning where chart starts at 17:00.
function normalizeTimeForYAxis(minutes) {
  if (minutes < 1020) {
    return minutes + 1440;
  }
  return minutes;
}

// Calculate longest uninterrupted sleep (ignoring bathroom; alarms count as interruptions)
function calculateLongestUninterrupted(day) {
  const sleepStart = timeToMinutes(day.sleepStart);
  const sleepEnd = timeToMinutes(day.sleepEnd);
  const normalizedSleepEnd = sleepEnd >= sleepStart ? sleepEnd : sleepEnd + 1440;
  const sleepDuration = durationMinutes(sleepStart, sleepEnd);

  const normalizeInterruption = (m) => {
    if (sleepEnd < sleepStart && m < sleepStart) {
      return m + 1440;
    }
    return m;
  };

  const alarmInterruptions = (day.alarm || [])
    .map(timeToMinutes)
    .map(normalizeInterruption)
    .filter(m => m >= sleepStart && m <= normalizedSleepEnd);

  const interruptions = [...alarmInterruptions];
  interruptions.sort((a, b) => a - b);

  if (interruptions.length === 0) {
    return sleepDuration;
  }

  let longest = 0;
  let start = sleepStart;
  for (const interrupt of interruptions) {
    const duration = interrupt - start;
    if (duration > longest) longest = duration;
    start = interrupt;
  }

  const lastDuration = normalizedSleepEnd - start;
  if (lastDuration > longest) longest = lastDuration;
  return longest;
}

function getFirstAlarmMinutes(day) {
  if (!day.alarm || day.alarm.length === 0) return null;
  return Math.min(...day.alarm.map(timeToMinutes));
}

// Signed alarm-to-wake delta (minutes): wake - firstAlarm.
// Negative values are meaningful and preserved for analysis.
function calculateAlarmToWakeDelta(day) {
  const firstAlarm = getFirstAlarmMinutes(day);
  if (firstAlarm === null) return null;
  const wakeTime = timeToMinutes(day.sleepEnd);
  return wakeTime - firstAlarm;
}

// Backward-compatible alias for existing callers.
function calculateFirstAlarmToWake(day) {
  return calculateAlarmToWakeDelta(day);
}

/**
 * Natural wake: no alarms, or exactly one alarm with wake strictly before it (negative alarm-to-wake delta).
 * Multiple alarm times imply snooze / backup alarms → not natural.
 */
function isNaturalWakeDay(day) {
  const alarms = day && day.alarm;
  if (!alarms || alarms.length === 0) return true;
  if (alarms.length !== 1) return false;
  const delta = calculateAlarmToWakeDelta(day);
  return delta !== null && delta < 0;
}

// Calculate delay from bed time to falling asleep
function calculateSleepDelay(day) {
  const bedTime = timeToMinutes(day.bed);
  const sleepStart = timeToMinutes(day.sleepStart);
  let delay = sleepStart - bedTime;
  if (delay < 0) delay += 1440;
  return delay;
}

// Backward-compatible alias for existing callers.
function calculateWakeDelay(day) {
  const firstAlarm = getFirstAlarmMinutes(day);
  if (firstAlarm === null) return null;
  const wakeTime = timeToMinutes(day.sleepEnd);
  let delay = wakeTime - firstAlarm;
  if (delay < 0 && firstAlarm >= 1080) {
    delay = (wakeTime + 1440) - firstAlarm;
  }
  return delay > 0 ? delay : null;
}

function calculateBedToSleepDelay(day) {
  return calculateSleepDelay(day);
}

function calculateNapDuration(day) {
  if (!day.nap || !day.nap.start || !day.nap.end) return null;
  return durationMinutes(timeToMinutes(day.nap.start), timeToMinutes(day.nap.end));
}

function solveLinearSystem(A, b) {
  const n = A.length;
  const augmented = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < n; i++) {
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(augmented[k][i]) > Math.abs(augmented[maxRow][i])) {
        maxRow = k;
      }
    }
    [augmented[i], augmented[maxRow]] = [augmented[maxRow], augmented[i]];
    for (let k = i + 1; k < n; k++) {
      const factor = augmented[k][i] / augmented[i][i];
      for (let j = i; j <= n; j++) {
        augmented[k][j] -= factor * augmented[i][j];
      }
    }
  }
  const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    x[i] = augmented[i][n];
    for (let j = i + 1; j < n; j++) x[i] -= augmented[i][j] * x[j];
    x[i] /= augmented[i][i];
  }
  return x;
}

function polynomialRegression(xValues, yValues, degree = 2) {
  const n = xValues.length;
  const X = [];
  for (let i = 0; i < n; i++) {
    const row = [];
    for (let d = degree; d >= 0; d--) row.push(Math.pow(xValues[i], d));
    X.push(row);
  }
  const XTX = [];
  const XTY = [];
  for (let i = 0; i <= degree; i++) {
    XTX[i] = [];
    XTY[i] = 0;
    for (let j = 0; j <= degree; j++) {
      let sum = 0;
      for (let k = 0; k < n; k++) sum += X[k][i] * X[k][j];
      XTX[i][j] = sum;
    }
    for (let k = 0; k < n; k++) XTY[i] += X[k][i] * yValues[k];
  }
  return solveLinearSystem(XTX, XTY);
}

function evaluatePolynomial(coefficients, x) {
  let result = 0;
  for (let i = 0; i < coefficients.length; i++) {
    result += coefficients[i] * Math.pow(x, coefficients.length - 1 - i);
  }
  return result;
}

// Project repo (used in nav bar)
const GITHUB_REPO_URL = 'https://github.com/rsairu/sleep/';
const DEV_VERCEL_APP_URL = 'https://sleep-mu.vercel.app';
const DEV_VERCEL_PROJECT_URL = 'https://vercel.com/rsairu-5429s-projects/sleep';
const SUPABASE_PROJECT_REF_PROD = 'lsaguxfovamihwnicpkk';
const SUPABASE_PROJECT_REF_DEV = 'pjpzxkyflmzzbfdkujan';
// Dev banner + app-time simulation spec: docs/dev-banner.md
const DEV_BANNER_OVERRIDE_KEY = 'sleep-app-force-dev-banner';
const DEV_CLOCK_OVERRIDE_MS_KEY = 'sleep-app-dev-clock-override-ms';
const DEV_BANNER_DRAWER_COLLAPSED_KEY = 'sleep-app-dev-banner-drawer-collapsed';
const DEV_BANNER_EXPANDED_RESERVE_KEY = 'sleep-app-dev-banner-expanded-reserve-px';

// Day/night mode: sunrise and sunset in local time (hours 0-23, minutes 0-59)
const SUNRISE_MINUTES = 6 * 60;
const SUNSET_MINUTES = 18 * 60;

const THEME_OVERRIDE_KEY = 'sleep-app-theme-override';
const REMAINING_WAKE_THRESHOLDS_KEY = 'sleep-app-remaining-wake-thresholds';
const REMAINING_WAKE_PHASE_HEADS_UP_KEY = 'sleep-app-remaining-wake-phase-heads-up-mins';
const REMAINING_WAKE_PHASE_HEADS_UP_ALLOWED = [0, 15, 30, 45, 60];
/** Slider index 0 = 1 h (left) … index 4 = off (right). Matches allowed minutes. */
const REMAINING_WAKE_PHASE_HEADS_UP_STOPS_DESC = [60, 45, 30, 15, 0];
const DEFAULT_REMAINING_WAKE_PHASE_HEADS_UP_MINS = 30;
const CLOCK_FORMAT_KEY = 'sleep-app-clock-format';
const QUALITY_PALETTE_KEY = 'sleep-app-quality-palette';
const TONIGHT_PROJECTION_ADJUSTMENT_KEY = 'sleep-app-tonight-projection-adjustment';

// Six-step ramps (best → worst). Tiers 4–6 map to severity flags (slight / moderate / severe); 1–3 reserved for future use.
const QUALITY_PALETTES = {
  meadow: {
    label: 'Meadow',
    colors: ['#2a9641', '#6da035', '#b0aa28', '#ecbd61', '#b45309', '#7f1d1d']
  },
  harbor: {
    label: 'Harbor',
    colors: ['#3db0a4', '#2f8f82', '#8fb88a', '#ecbd61', '#8f5f50', '#42202e']
  }
};

const QUALITY_PALETTE_CSS_VARS = [
  '--quality-excellent',
  '--quality-great',
  '--quality-good',
  '--quality-slight',
  '--quality-moderate',
  '--quality-severe'
];

// Percent of wake time remaining: active while >= openMin; winding while >= windingMin and < openMin; pre-sleep while < windingMin. (Dev banner: Winding % = openMin, Pre-sleep % = windingMin.)
const DEFAULT_REMAINING_WAKE_OPEN_MIN = 35;
const DEFAULT_REMAINING_WAKE_WINDING_MIN = 15;

// Returns { openMin, windingMin } from localStorage or defaults. Values are in 0–100, step 1.
function getRemainingWakeThresholds() {
  try {
    const raw = localStorage.getItem(REMAINING_WAKE_THRESHOLDS_KEY);
    if (raw) {
      const o = JSON.parse(raw);
      const openMin = clampThresholdPercent(typeof o.openMin === 'number' ? o.openMin : DEFAULT_REMAINING_WAKE_OPEN_MIN);
      const windingMin = clampThresholdPercent(typeof o.windingMin === 'number' ? o.windingMin : DEFAULT_REMAINING_WAKE_WINDING_MIN);
      if (openMin > windingMin) return { openMin, windingMin };
    }
  } catch (_) {}
  return { openMin: DEFAULT_REMAINING_WAKE_OPEN_MIN, windingMin: DEFAULT_REMAINING_WAKE_WINDING_MIN };
}

function clampThresholdPercent(n) {
  const step = 1;
  const v = Math.round(n / step) * step;
  return Math.min(100, Math.max(0, v));
}

// Saves thresholds to localStorage. openMin and windingMin must satisfy openMin > windingMin.
function setRemainingWakeThresholds(openMin, windingMin) {
  openMin = clampThresholdPercent(openMin);
  windingMin = clampThresholdPercent(windingMin);
  if (openMin <= windingMin) return;
  try {
    localStorage.setItem(REMAINING_WAKE_THRESHOLDS_KEY, JSON.stringify({ openMin, windingMin }));
  } catch (_) {}
  syncUserSettingsRowToCloud();
  updateDevBannerUserSettingsPanel();
}

function getRemainingWakePhaseHeadsUpMinutes() {
  try {
    const raw = localStorage.getItem(REMAINING_WAKE_PHASE_HEADS_UP_KEY);
    if (raw === null || raw === '') return DEFAULT_REMAINING_WAKE_PHASE_HEADS_UP_MINS;
    const n = parseInt(raw, 10);
    if (REMAINING_WAKE_PHASE_HEADS_UP_ALLOWED.indexOf(n) !== -1) return n;
  } catch (_) {}
  return DEFAULT_REMAINING_WAKE_PHASE_HEADS_UP_MINS;
}

function setRemainingWakePhaseHeadsUpMinutes(mins) {
  const n = parseInt(mins, 10);
  if (REMAINING_WAKE_PHASE_HEADS_UP_ALLOWED.indexOf(n) === -1) return;
  try {
    localStorage.setItem(REMAINING_WAKE_PHASE_HEADS_UP_KEY, String(n));
  } catch (_) {}
  syncUserSettingsRowToCloud();
  updateDevBannerUserSettingsPanel();
}

function remainingWakePhaseHeadsUpMinutesToSliderIndex(mins) {
  const i = REMAINING_WAKE_PHASE_HEADS_UP_STOPS_DESC.indexOf(mins);
  if (i >= 0) return i;
  const j = REMAINING_WAKE_PHASE_HEADS_UP_STOPS_DESC.indexOf(DEFAULT_REMAINING_WAKE_PHASE_HEADS_UP_MINS);
  return j >= 0 ? j : 2;
}

function remainingWakePhaseHeadsUpSliderIndexToMinutes(idx) {
  const i = parseInt(idx, 10);
  if (i < 0 || i >= REMAINING_WAKE_PHASE_HEADS_UP_STOPS_DESC.length) {
    return DEFAULT_REMAINING_WAKE_PHASE_HEADS_UP_MINS;
  }
  return REMAINING_WAKE_PHASE_HEADS_UP_STOPS_DESC[i];
}

function getRemainingWakePhaseHeadsUpStopAriaLabel(mins) {
  switch (mins) {
    case 60:
      return t('config.remainingWake.headsUpStop60', '1 hour before');
    case 45:
      return t('config.remainingWake.headsUpStop45', '45 minutes before');
    case 30:
      return t('config.remainingWake.headsUpStop30', '30 minutes before');
    case 15:
      return t('config.remainingWake.headsUpStop15', '15 minutes before');
    case 0:
      return t('config.remainingWake.headsUpStop0', 'Off');
    default:
      return t('config.remainingWake.headsUpStop0', 'Off');
  }
}

// Returns 'day' if current local time is between sunrise and sunset, else 'night'
function getThemeFromTime() {
  const now = getAppDate();
  const minutesSinceMidnight = now.getHours() * 60 + now.getMinutes();
  return minutesSinceMidnight >= SUNRISE_MINUTES && minutesSinceMidnight < SUNSET_MINUTES ? 'day' : 'night';
}

// Returns current theme override from localStorage ('day' | 'night' | null)
function getThemeOverride() {
  try {
    const v = localStorage.getItem(THEME_OVERRIDE_KEY);
    return v === 'day' || v === 'night' ? v : null;
  } catch (_) {
    return null;
  }
}

// Sets theme override and saves to localStorage (null = auto)
function setThemeOverride(theme) {
  try {
    if (theme === null) localStorage.removeItem(THEME_OVERRIDE_KEY);
    else localStorage.setItem(THEME_OVERRIDE_KEY, theme);
  } catch (_) {}
  syncUserSettingsRowToCloud();
}

function getClockFormatPreference() {
  try {
    const value = localStorage.getItem(CLOCK_FORMAT_KEY);
    return value === '12h' || value === '24h' ? value : '24h';
  } catch (_) {
    return '24h';
  }
}

function setClockFormatPreference(format) {
  if (format !== '12h' && format !== '24h') return;
  try {
    localStorage.setItem(CLOCK_FORMAT_KEY, format);
  } catch (_) {}
  syncUserSettingsRowToCloud();
  updateDevBannerUserSettingsPanel();
}

function getQualityPaletteId() {
  try {
    const v = localStorage.getItem(QUALITY_PALETTE_KEY);
    if (v === 'meadow' || v === 'harbor' || v === 'auto') return v;
  } catch (_) {}
  return DEFAULT_QUALITY_PALETTE_ID;
}

function setQualityPaletteId(id) {
  if (id !== 'meadow' && id !== 'harbor' && id !== 'auto') return;
  try {
    localStorage.setItem(QUALITY_PALETTE_KEY, id);
  } catch (_) {}
  syncUserSettingsRowToCloud();
  updateDevBannerUserSettingsPanel();
}

// Concrete palette used for CSS (stored 'auto' → meadow or harbor from effective theme).
function getResolvedQualityPaletteId() {
  const stored = getQualityPaletteId();
  if (stored !== 'auto') return stored;
  return getEffectiveTheme() === 'day' ? 'meadow' : 'harbor';
}

function applyQualityPaletteToDocument() {
  const id = getResolvedQualityPaletteId();
  const pal = QUALITY_PALETTES[id];
  if (!pal || pal.colors.length !== 6) return;
  const root = document.documentElement;
  for (let i = 0; i < 6; i++) {
    root.style.setProperty(QUALITY_PALETTE_CSS_VARS[i], pal.colors[i]);
  }
}

function hydrateQualityPalettePreviewBars() {
  const wrap = document.getElementById('config-quality-palette');
  if (!wrap) return;
  wrap.querySelectorAll('[data-quality-palette]').forEach(function (btn) {
    const pid = btn.getAttribute('data-quality-palette');
    const bar = btn.querySelector('.config-quality-palette-bar');
    if (!bar) return;
    const pal = QUALITY_PALETTES[pid];
    if (!pal) return;
    bar.innerHTML = pal.colors
      .map(function (c) {
        return '<span style="background-color:' + c + '"></span>';
      })
      .join('');
  });
}

function updateQualityPaletteSelector() {
  const wrap = document.getElementById('config-quality-palette');
  if (!wrap) return;
  const selected = getQualityPaletteId();
  wrap.querySelectorAll('[data-quality-palette]').forEach(function (btn) {
    const on = btn.getAttribute('data-quality-palette') === selected;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', on);
  });
}

function initQualityPaletteSelector() {
  hydrateQualityPalettePreviewBars();
  updateQualityPaletteSelector();
  const wrap = document.getElementById('config-quality-palette');
  if (!wrap) return;
  wrap.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-quality-palette]');
    if (!btn) return;
    const id = btn.getAttribute('data-quality-palette');
    if (id !== 'auto' && !QUALITY_PALETTES[id]) return;
    setQualityPaletteId(id);
    applyQualityPaletteToDocument();
    updateQualityPaletteSelector();
    document.dispatchEvent(new CustomEvent('quality-palette-changed', { detail: { palette: id } }));
  });
}

// Effective theme: override if set, otherwise from time
function getEffectiveTheme() {
  const override = getThemeOverride();
  return override !== null ? override : getThemeFromTime();
}

// Applies day or night theme to the document; uses override if set. Returns effective theme.
function applyDayNightTheme() {
  const theme = getEffectiveTheme();
  document.documentElement.dataset.theme = theme;
  applyQualityPaletteToDocument();
  return theme;
}

const SUN_ICON = '<svg xmlns="http://www.w3.org/2000/svg" class="nav-daynight-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.25a.75.75 0 01.75.75v2.25a.75.75 0 01-1.5 0V3a.75.75 0 01.75-.75zM7.5 12a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM18.894 6.166a.75.75 0 00-1.06-1.06l-1.591 1.59a.75.75 0 101.06 1.061l1.591-1.59zM21.75 12a.75.75 0 01-.75.75h-2.25a.75.75 0 010-1.5H21a.75.75 0 01.75.75zM17.834 18.894a.75.75 0 001.06-1.06l-1.59-1.591a.75.75 0 10-1.061 1.06l1.59 1.591zM12 18a.75.75 0 01.75.75V21a.75.75 0 01-1.5 0v-2.25A.75.75 0 0112 18zM5.106 18.894a.75.75 0 001.06 1.06l1.591-1.59a.75.75 0 10-1.06-1.061l-1.591 1.59zM6 12a.75.75 0 01-.75.75H3a.75.75 0 010-1.5h2.25A.75.75 0 016 12zM6.697 7.757l-1.59-1.591a.75.75 0 00-1.061 1.06l1.59 1.591a.75.75 0 001.061-1.06z"/></svg>';
const MOON_ICON = '<svg class="nav-daynight-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z"/></svg>';

function getDayNightTitle(theme, isOverride) {
  const mode = theme.charAt(0).toUpperCase() + theme.slice(1);
  return `${mode} mode (${isOverride ? 'manual' : 'auto'})`;
}

// Returns HTML for the day/night toggle (sun | moon, active state highlighted)
function getDayNightToggleHTML(theme) {
  const isOverride = getThemeOverride() !== null;
  const dayActive = theme === 'day';
  const nightActive = theme === 'night';
  const dayTitle = getDayNightTitle('day', isOverride);
  const nightTitle = getDayNightTitle('night', isOverride);
  return (
    '<div id="nav-daynight" class="nav-daynight-toggle" role="group" aria-label="Theme">' +
      '<button type="button" class="nav-daynight-option' + (dayActive ? ' active' : '') + '" data-theme="day" title="Light mode" aria-label="Light mode" aria-pressed="' + dayActive + '">' + SUN_ICON + '</button>' +
      '<button type="button" class="nav-daynight-option' + (nightActive ? ' active' : '') + '" data-theme="night" title="Dark mode" aria-label="Dark mode" aria-pressed="' + nightActive + '">' + MOON_ICON + '</button>' +
    '</div>'
  );
}

// Returns HTML for the animated sun/moon toggle (used in nav menu and config page). clipPathIdSuffix must be unique per page (e.g. 'nav', 'config').
function getThemeToggleHTML(nightActive, buttonId, clipPathIdSuffix) {
  buttonId = buttonId || 'nav-menu-theme-toggle';
  clipPathIdSuffix = clipPathIdSuffix || 'nav';
  const cutoutId = 'theme-toggle__classic__cutout__' + clipPathIdSuffix;
  return (
    '<button type="button" class="theme-toggle' + (nightActive ? ' theme-toggle--toggled' : '') + '" id="' + buttonId + '" title="Toggle theme" aria-label="Toggle theme" aria-pressed="' + nightActive + '">' +
      '<span class="theme-toggle-sr">Toggle theme</span>' +
      '<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" width="1em" height="1em" fill="currentColor" stroke-linecap="round" class="theme-toggle__classic" viewBox="0 0 32 32">' +
        '<clipPath id="' + cutoutId + '"><path d="M0-5h30a1 1 0 0 0 9 13v24H0Z"/></clipPath>' +
        '<g clip-path="url(#' + cutoutId + ')">' +
          '<circle cx="16" cy="16" r="9.34"/>' +
          '<g stroke="currentColor" stroke-width="1.5">' +
            '<path d="M16 5.5v-4"/><path d="M16 30.5v-4"/><path d="M1.5 16h4"/><path d="M26.5 16h4"/>' +
            '<path d="m23.4 8.6 2.8-2.8"/><path d="m5.7 26.3 2.9-2.9"/><path d="m5.8 5.8 2.8 2.8"/><path d="m23.4 23.4 2.9 2.9"/>' +
          '</g>' +
        '</g>' +
      '</svg>' +
    '</button>'
  );
}

// Updates the nav day/night toggle active state (e.g. after theme tick or click)
function updateDayNightIcon() {
  const theme = getEffectiveTheme();
  const pillWrap = document.getElementById('nav-daynight');
  if (pillWrap) {
    pillWrap.querySelectorAll('.nav-daynight-option').forEach(btn => {
      const isActive = btn.getAttribute('data-theme') === theme;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', isActive);
    });
  }
  const menuToggle = document.getElementById('nav-menu-theme-toggle');
  if (menuToggle) {
    menuToggle.classList.toggle('theme-toggle--toggled', theme === 'night');
    menuToggle.setAttribute('aria-pressed', theme === 'night');
  }
  const configToggle = document.getElementById('config-theme-toggle');
  if (configToggle) {
    configToggle.classList.toggle('theme-toggle--toggled', theme === 'night');
    configToggle.setAttribute('aria-pressed', theme === 'night');
  }
}

// Toggle theme: click sets theme to the chosen option (day or night)
function handleDayNightClick(e) {
  const btn = e.target.closest('.nav-daynight-option');
  if (!btn) return;
  const theme = btn.getAttribute('data-theme');
  if (theme !== 'day' && theme !== 'night') return;
  setThemeChoice(theme);
}

// Set theme from a choice: 'day' | 'night' | 'auto'. Updates override, applies theme, nav toggle, and config selector.
function setThemeChoice(choice) {
  if (choice !== 'auto' && choice !== 'day' && choice !== 'night') return;
  setThemeOverride(choice === 'auto' ? null : choice);
  applyDayNightTheme();
  updateDayNightIcon();
  updateThemeSelectors();
  updateDevBannerUserSettingsPanel();
}

// Updates theme selector active state on Config page (Auto button; Light/Dark row state is in the toggle).
function updateThemeSelectors() {
  const wrap = document.getElementById('config-theme');
  if (!wrap) return;
  const override = getThemeOverride();
  wrap.querySelectorAll('.about-theme-option').forEach(btn => {
    const isActive = btn.getAttribute('data-theme') === 'auto' && override === null;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', isActive);
  });
}

function updateClockFormatSelector() {
  const wrap = document.getElementById('config-clock');
  if (!wrap) return;
  const selected = getClockFormatPreference();
  wrap.querySelectorAll('.about-theme-option').forEach(btn => {
    const isActive = btn.getAttribute('data-clock-format') === selected;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', isActive);
  });
}

function initClockFormatSelector() {
  const wrap = document.getElementById('config-clock');
  if (!wrap) return;
  updateClockFormatSelector();
  wrap.addEventListener('click', function (e) {
    const btn = e.target.closest('.about-theme-option');
    if (!btn) return;
    const format = btn.getAttribute('data-clock-format');
    if (format !== '12h' && format !== '24h') return;
    setClockFormatPreference(format);
    updateClockFormatSelector();
    const inputOpen = document.getElementById('config-open-min');
    const inputWinding = document.getElementById('config-winding-min');
    if (inputOpen && inputWinding) {
      const p1 = parseInt(inputOpen.value, 10);
      const p2 = parseInt(inputWinding.value, 10);
      applyRemainingWakeThresholdsUI(p1, p2);
    }
    document.dispatchEvent(new CustomEvent('clock-format-changed', { detail: { format } }));
  });
}

function initLanguageSelector() {
  const select = document.getElementById('config-language-select');
  if (!select) return;
  const current = getLanguagePreference();
  select.value = current;
  select.addEventListener('change', async function () {
    const selected = normalizeLanguage(select.value);
    if (SUPPORTED_LANGUAGES.indexOf(selected) === -1) return;
    setLanguagePreference(selected);
    await initI18n(document);
  });
}

// Initializes the Config page theme selector: inject Light/Dark toggle, attach row and Auto handlers.
function initConfigThemeSelector() {
  const wrap = document.getElementById('config-theme');
  if (!wrap) return;
  const toggleWrap = document.getElementById('config-theme-toggle-wrap');
  if (toggleWrap) {
    const theme = getEffectiveTheme();
    toggleWrap.innerHTML = getThemeToggleHTML(theme === 'night', 'config-theme-toggle', 'config');
  }
  updateDayNightIcon();
  updateThemeSelectors();

  const lightDarkRow = document.getElementById('config-theme-light-dark-row');
  if (lightDarkRow) {
    lightDarkRow.addEventListener('click', function (e) {
      e.preventDefault();
      const current = getEffectiveTheme();
      setThemeChoice(current === 'day' ? 'night' : 'day');
    });
    lightDarkRow.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const current = getEffectiveTheme();
        setThemeChoice(current === 'day' ? 'night' : 'day');
      }
    });
  }

  wrap.addEventListener('click', function (e) {
    const btn = e.target.closest('.about-theme-option');
    if (!btn) return;
    const choice = btn.getAttribute('data-theme');
    if (choice !== 'auto') return;
    setThemeChoice('auto');
  });
}

// 0–1440 modular arithmetic (JavaScript % can be negative).
function modMinutes1440(n) {
  return ((n % 1440) + 1440) % 1440;
}

function isValidClockMinute(n) {
  return Number.isInteger(n) && n >= 0 && n <= 1439;
}

function getTonightProjectionAdjustment() {
  try {
    const raw = localStorage.getItem(TONIGHT_PROJECTION_ADJUSTMENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const sleep = parsed.sleep;
    const wake = parsed.wake;
    if (!isValidClockMinute(sleep) || !isValidClockMinute(wake)) return null;
    if (sleep === wake) return null;
    return { sleep, wake };
  } catch (_) {
    return null;
  }
}

function setTonightProjectionAdjustment(sleep, wake) {
  if (!isValidClockMinute(sleep) || !isValidClockMinute(wake)) return;
  if (sleep === wake) return;
  try {
    localStorage.setItem(TONIGHT_PROJECTION_ADJUSTMENT_KEY, JSON.stringify({
      sleep: modMinutes1440(sleep),
      wake: modMinutes1440(wake)
    }));
  } catch (_) {}
}

function clearTonightProjectionAdjustment() {
  try {
    localStorage.removeItem(TONIGHT_PROJECTION_ADJUSTMENT_KEY);
  } catch (_) {}
}

/** Same key as quick-actions / entry-modal night QA flags (bed, sleep, wake). */
const RESTORE_QA_SLEEP_LOGGED_KEY = 'restore_qa_sleep_logged_v1';

function readNightQaSleepFlagMap() {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(RESTORE_QA_SLEEP_LOGGED_KEY) : null;
    if (!raw) return {};
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object') return {};
    let changed = false;
    const migrated = {};
    Object.keys(o).forEach(function (k) {
      const iso = normalizeSleepDateKey(k, LEGACY_SLEEP_DATE_FALLBACK_YEAR);
      const nk = iso || k;
      if (nk !== k) changed = true;
      if (!migrated[nk]) migrated[nk] = {};
      Object.assign(migrated[nk], o[k]);
    });
    if (changed && typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(RESTORE_QA_SLEEP_LOGGED_KEY, JSON.stringify(migrated));
      } catch (_e2) { /* ignore */ }
    }
    return migrated;
  } catch (_e) {
    return {};
  }
}

function markNightQaSleepFlag(nightMd, kind) {
  if (!nightMd || !kind) return;
  try {
    const map = readNightQaSleepFlagMap();
    if (!map[nightMd]) map[nightMd] = {};
    map[nightMd][kind] = true;
    if (kind === 'wake') {
      map[nightMd].wakeAtMs = getAppNowMs();
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(RESTORE_QA_SLEEP_LOGGED_KEY, JSON.stringify(map));
    }
  } catch (_e) { /* ignore */ }
}

function formatMonthDayFromDateForNav(d) {
  return formatIsoDateFromLocalDate(d);
}

/**
 * Wake-day key for the night row (evening → next calendar wake-day; early morning stays today).
 * Matches quick-actions recordDateMdForSleep.
 * Wake-day invariant: row `date` is the wake that completes the night.
 * Example: bed at 10 PM previous day or 1 AM same day both belong to the wake-day row.
 * +120 early-morning band: docs/quick-actions.md § Phase and row constants.
 */
function recordDateMdForSleepPeriod(now, avgWakeMins) {
  const nowM = now.getHours() * 60 + now.getMinutes();
  const w = modMinutes1440(avgWakeMins);
  if (nowM <= w + 120) {
    return formatMonthDayFromDateForNav(now);
  }
  const t = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return formatMonthDayFromDateForNav(t);
}

/**
 * True when this wake-day row has user bed/sleep data but wake (sleepEnd) is still the stub default
 * and no QA wake flag — i.e. the night is not finalized. Used for wake quick-action date resolution.
 */
function nightRowAwaitingWake(nightMd, liveDays, averagesFallback) {
  if (!nightMd) return false;
  if (isNightWakeLogged(nightMd)) return false;
  const qa = readNightQaSleepFlagMap()[nightMd];
  if (qa && qa.wake) return false;
  const day = pickDayForNightMdNav(nightMd, liveDays || []);
  const stub = buildStubDayForNightMd(nightMd, liveDays || [], averagesFallback);
  let hasUserBedSleep = Boolean(qa && (qa.bed || qa.sleep));
  if (day && stub) {
    const bedDiff = String(day.bed || '') !== String(stub.bed || '');
    const sleepDiff = String(day.sleepStart || '') !== String(stub.sleepStart || '');
    if (bedDiff || sleepDiff) hasUserBedSleep = true;
  } else if (day && !stub) {
    if ((day.bed && String(day.bed).trim() !== '') || (day.sleepStart && String(day.sleepStart).trim() !== '')) {
      hasUserBedSleep = true;
    }
  }
  if (!hasUserBedSleep) return false;
  if (!day || !stub) return true;
  const wakeDiff = String(day.sleepEnd || '') !== String(stub.sleepEnd || '');
  return !wakeDiff;
}

/**
 * Wake-day key for persisting sleepEnd / morning alarm: same basis as recordDateMdForSleepPeriod, but if the
 * clock has moved to the next calendar morning while yesterday's wake-day row is still awaiting wake,
 * finalize that row (simulated time / late logging). Otherwise bed and wake would land on different rows.
 * Early-morning band (+120): docs/quick-actions.md § Phase and row constants.
 */
function resolveRecordDateMdForWake(now, avgWakeMins, liveDays) {
  const primary = recordDateMdForSleepPeriod(now, avgWakeMins);
  const averagesFallback =
    typeof QUICK_ADD_FALLBACK_AVERAGES !== 'undefined' ? QUICK_ADD_FALLBACK_AVERAGES : null;
  const nowM = now.getHours() * 60 + now.getMinutes();
  const w = modMinutes1440(avgWakeMins);
  const inEarlyMorningBand = nowM <= w + 120;
  if (!inEarlyMorningBand) {
    return primary;
  }
  const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const priorCalMd = formatMonthDayFromDateForNav(y);
  const priorOpen = nightRowAwaitingWake(priorCalMd, liveDays, averagesFallback);
  if (!priorOpen) {
    return primary;
  }
  const primaryOpen = nightRowAwaitingWake(primary, liveDays, averagesFallback);
  if (!primaryOpen) {
    return priorCalMd;
  }
  return primary;
}

function remainWakeCircDistMinutes(a, b) {
  const x = modMinutes1440(a);
  const y = modMinutes1440(b);
  const d = Math.abs(x - y);
  return Math.min(d, 1440 - d);
}

function remainWakeOffsetFromSleepAvg(nowM, sleepAvgM) {
  const s = modMinutes1440(sleepAvgM);
  const n = modMinutes1440(nowM);
  let o = n - s;
  if (o < -720) o += 1440;
  if (o > 720) o -= 1440;
  return o;
}

// Phase / quiet-window constants — documented in docs/quick-actions.md § Phase and row constants.
const PHASE_WAKE_PROXIMITY_MINS = 105;
const PHASE_SLEEP_WINDOW_BEFORE = 120;
const PHASE_SLEEP_WINDOW_AFTER = 240;

/** Shared time-aware phase logic for remaining wake and dashboard quick actions. */
function inferSharedSleepContextPhase(now, avgSleepStart, avgSleepEnd) {
  const nowM = now.getHours() * 60 + now.getMinutes();
  const wakeM = avgSleepEnd;
  const sleepM = avgSleepStart;
  if (remainWakeCircDistMinutes(nowM, wakeM) <= PHASE_WAKE_PROXIMITY_MINS) {
    return 'wake';
  }
  const off = remainWakeOffsetFromSleepAvg(nowM, sleepM);
  if (off >= -PHASE_SLEEP_WINDOW_BEFORE && off <= PHASE_SLEEP_WINDOW_AFTER) {
    return 'sleep';
  }
  return 'mid';
}

function isWithinWakeProximity(now, avgSleepEnd) {
  const nowM = now.getHours() * 60 + now.getMinutes();
  return remainWakeCircDistMinutes(nowM, avgSleepEnd) <= PHASE_WAKE_PROXIMITY_MINS;
}

/** Same window as dashboard quick-actions inferPhase === 'sleep' (not wake, not mid). */
function inferNavSleepWindowPhase(now, avgSleepStart, avgSleepEnd) {
  return inferSharedSleepContextPhase(now, avgSleepStart, avgSleepEnd) === 'sleep';
}

function findDayByDateMd(days, md) {
  if (!days || !days.length) return null;
  for (let i = 0; i < days.length; i++) {
    if (days[i].date === md) return days[i];
  }
  return null;
}

function pickDayForNightMdNav(nightMd, liveDays) {
  let d = findDayByDateMd(liveDays, nightMd);
  if (d) return d;
  const c = readSleepDataLocalCache();
  if (c && c.data && Array.isArray(c.data.days)) {
    d = findDayByDateMd(c.data.days, nightMd);
  }
  return d || null;
}

/** True if wall-clock time plausibly falls within the last `hoursBack` hours (matches quick-actions). */
function isWallClockWithinRecentHoursNav(now, timeStr, hoursBack) {
  const m = timeToMinutes(timeStr);
  if (!Number.isFinite(m)) return false;
  const hh = Math.floor(modMinutes1440(m) / 60);
  const mi = modMinutes1440(m) % 60;
  const y = now.getFullYear();
  const mo = now.getMonth();
  const d = now.getDate();
  const candidates = [
    new Date(y, mo, d, hh, mi, 0, 0),
    new Date(y, mo, d - 1, hh, mi, 0, 0),
    new Date(y, mo, d + 1, hh, mi, 0, 0)
  ];
  const lo = now.getTime() - hoursBack * 3600000;
  const hi = now.getTime() + 45 * 60000;
  for (let i = 0; i < candidates.length; i++) {
    const t = candidates[i].getTime();
    if (t >= lo && t <= hi) return true;
  }
  return false;
}

/**
 * Stub row for a night md; uses 7-day basis + days[0] template, or averagesFallback when no logged days.
 */
function buildStubDayForNightMd(dateMd, days, averagesFallback) {
  const template = days && days.length ? days[0] : null;
  const basis = computeRecentSevenDayWakeBasis(days);
  const avgS = basis ? basis.avgSleepStart : (averagesFallback ? averagesFallback.avgSleepStart : NaN);
  const avgE = basis ? basis.avgSleepEnd : (averagesFallback ? averagesFallback.avgSleepEnd : NaN);
  if (!Number.isFinite(avgS) || !Number.isFinite(avgE)) return null;
  const ss = template ? template.sleepStart : formatTime(modMinutes1440(avgS));
  const bed = template ? template.bed : formatTime(modMinutes1440(avgS - 25));
  const se = template ? template.sleepEnd : formatTime(modMinutes1440(avgE));
  return {
    date: dateMd,
    bed: bed,
    sleepStart: ss,
    sleepEnd: se,
    bathroom: [],
    alarm: [],
    nap: null,
    WASO: 0
  };
}

function isNightWakeLogged(nightMd) {
  const e = readNightQaSleepFlagMap()[nightMd];
  return Boolean(e && e.wake);
}

/** Bed or fell-asleep logged (QA flags or row differs from stub + recent wall clock). */
function isNightBedOrSleepLogged(nightMd, liveDays, now, averagesFallback) {
  const qa = readNightQaSleepFlagMap()[nightMd];
  if (qa && (qa.bed || qa.sleep)) return true;
  const day = pickDayForNightMdNav(nightMd, liveDays);
  if (!day) return false;
  const stub = buildStubDayForNightMd(nightMd, liveDays, averagesFallback);
  if (!stub) return false;
  const bedDiff = String(day.bed || '') !== String(stub.bed || '');
  const sleepDiff = String(day.sleepStart || '') !== String(stub.sleepStart || '');
  const bedOk = bedDiff && isWallClockWithinRecentHoursNav(now, day.bed, 12);
  const sleepOk = sleepDiff && isWallClockWithinRecentHoursNav(now, day.sleepStart, 12);
  return Boolean(bedOk || sleepOk);
}

/**
 * Dynamic "sleep" nav phase: in bed or asleep logged, wake not logged, and clock in overnight limbo or sleep window.
 */
function shouldShowDynamicSleepNavPhase(days, basis, now, nightMd) {
  if (!basis || !days || !days.length || !nightMd) return false;
  if (isNightWakeLogged(nightMd)) return false;
  const averagesFallback =
    typeof QUICK_ADD_FALLBACK_AVERAGES !== 'undefined' ? QUICK_ADD_FALLBACK_AVERAGES : null;
  if (!isNightBedOrSleepLogged(nightMd, days, now, averagesFallback)) return false;
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const inLimbo = shouldShowGoToBedSoonWakeNav(nowMins, basis.avgSleepEnd, basis.avgSleepStart);
  const inSleepWin = inferNavSleepWindowPhase(now, basis.avgSleepStart, basis.avgSleepEnd);
  return inLimbo || inSleepWin;
}

/** Last 7 days in `days`: average get-up, average fell-asleep, and wake-window length (minutes between them). */
function computeRecentSevenDayWakeBasis(days) {
  if (!days || days.length === 0) return null;
  const recent = days.slice(0, Math.min(7, days.length));
  let sleepStartSum = 0;
  let sleepEndSum = 0;
  for (let i = 0; i < recent.length; i++) {
    const d = recent[i];
    const ss = timeToMinutes(d.sleepStart);
    sleepStartSum += normalizeTimeForAveraging(ss);
    sleepEndSum += normalizeWakeTimeForAveraging(ss, timeToMinutes(d.sleepEnd));
  }
  const n = recent.length;
  const avgSleepStart = denormalizeTimeForAveraging(Math.round(sleepStartSum / n));
  const avgSleepEnd = denormalizeTimeForAveraging(Math.round(sleepEndSum / n));
  const totalWakeMins = durationMinutes(avgSleepEnd, avgSleepStart);
  return { avgSleepStart, avgSleepEnd, totalWakeMins };
}

function applyTonightProjectionAdjustmentToBasis(basis, adjustment) {
  if (!basis) return null;
  if (!adjustment) return basis;
  if (!isValidClockMinute(adjustment.sleep) || !isValidClockMinute(adjustment.wake)) return basis;
  // Remaining wake countdown is anchored by current -> sleep target.
  // Keep wake-window length from recent baseline so wake-only adjustments do not skew progress.
  const avgSleepStart = modMinutes1440(adjustment.sleep);
  return {
    avgSleepStart,
    avgSleepEnd: basis.avgSleepEnd,
    totalWakeMins: basis.totalWakeMins
  };
}

function getEffectiveRemainingWakeBasis(days) {
  const base = computeRecentSevenDayWakeBasis(days);
  return applyTonightProjectionAdjustmentToBasis(base, getTonightProjectionAdjustment());
}

function getFallbackWakeBasis() {
  const fallback = typeof QUICK_ADD_FALLBACK_AVERAGES !== 'undefined'
    ? QUICK_ADD_FALLBACK_AVERAGES
    : { avgSleepStart: 22 * 60 + 30, avgSleepEnd: 7 * 60 };
  return {
    avgSleepStart: fallback.avgSleepStart,
    avgSleepEnd: fallback.avgSleepEnd,
    totalWakeMins: durationMinutes(fallback.avgSleepEnd, fallback.avgSleepStart)
  };
}

function getWakeDayCandidateMds(now) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return [
    formatMonthDayFromDateForNav(today),
    formatMonthDayFromDateForNav(yesterday),
    formatMonthDayFromDateForNav(tomorrow)
  ];
}

function isWakeEventRecentForMd(md, liveDays, now, hoursBack, averagesFallback) {
  if (!md) return false;
  const qa = readNightQaSleepFlagMap()[md];
  if (qa && Number.isFinite(qa.wakeAtMs)) {
    const nowMs = now.getTime();
    const lo = nowMs - hoursBack * 3600000;
    const hi = nowMs + 45 * 60000;
    if (qa.wakeAtMs >= lo && qa.wakeAtMs <= hi) return true;
  }
  const day = pickDayForNightMdNav(md, liveDays);
  if (!day) return false;
  const stub = buildStubDayForNightMd(md, liveDays, averagesFallback);
  if (!stub) return false;
  const wakeDiff = String(day.sleepEnd || '') !== String(stub.sleepEnd || '');
  const wakeLogged = Boolean((qa && qa.wake) || wakeDiff);
  if (!wakeLogged) return false;
  return isWallClockWithinRecentHoursNav(now, day.sleepEnd, hoursBack);
}

function isRecentWakeInHours(liveDays, now, hoursBack, averagesFallback) {
  if (!now || !Number.isFinite(hoursBack) || hoursBack <= 0) return false;
  const mdCandidates = getWakeDayCandidateMds(now);
  for (let i = 0; i < mdCandidates.length; i++) {
    if (isWakeEventRecentForMd(mdCandidates[i], liveDays, now, hoursBack, averagesFallback)) {
      return true;
    }
  }
  return false;
}

// Documented in docs/quick-actions.md § Phase and row constants.
const IMPLICIT_POST_WAKE_QUIET_MINUTES = 180;

/**
 * True when wall clock is within `quietMinutes` after average wake on a typical wake-before-sleep schedule.
 * Skips when avg wake is not before avg sleep on the clock (avoids odd shift edge cases).
 */
function isImplicitPostWakeQuietWindow(now, avgWakeMins, avgSleepStartMins, quietMinutes) {
  if (!now || !Number.isFinite(avgWakeMins) || !Number.isFinite(avgSleepStartMins) || !Number.isFinite(quietMinutes)) {
    return false;
  }
  const w = modMinutes1440(avgWakeMins);
  const s = modMinutes1440(avgSleepStartMins);
  if (w >= s) return false;
  const n = modMinutes1440(now.getHours() * 60 + now.getMinutes());
  if (n < w) return false;
  return n - w <= quietMinutes;
}

/**
 * Shared dashboard/app time context for nav-canonical UI decisions with explicit override signals.
 */
function getSharedAppTimeContext(days) {
  const liveDays = Array.isArray(days) ? days : [];
  const now = getAppDate();
  const basis = getEffectiveRemainingWakeBasis(liveDays) || getFallbackWakeBasis();
  if (!basis || !Number.isFinite(basis.avgSleepStart) || !Number.isFinite(basis.avgSleepEnd)) {
    return null;
  }
  const nightMd = recordDateMdForSleepPeriod(now, basis.avgSleepEnd);
  const navDisplay = getRemainingWakeDisplayFromBasis(basis, liveDays);
  const averagesFallback = typeof QUICK_ADD_FALLBACK_AVERAGES !== 'undefined' ? QUICK_ADD_FALLBACK_AVERAGES : null;
  const isDynamicSleepPhase =
    Boolean(liveDays.length && shouldShowDynamicSleepNavPhase(liveDays, basis, now, nightMd));
  const wakeProximity = isWithinWakeProximity(now, basis.avgSleepEnd);
  const wakeInLast3Hours = isRecentWakeInHours(
    liveDays,
    now,
    3,
    averagesFallback
  );
  const implicitPostWakeQuiet = isImplicitPostWakeQuietWindow(
    now,
    basis.avgSleepEnd,
    basis.avgSleepStart,
    IMPLICIT_POST_WAKE_QUIET_MINUTES
  );
  return {
    now,
    basis,
    nightMd,
    navDisplay,
    isDynamicSleepPhase,
    wakeProximity,
    wakeInLast3Hours,
    implicitPostWakeQuiet
  };
}

/** Wall-clock minute (0–1439) when only `percentWakeRemaining` of the average wake window remains before average sleep. */
function wakePercentToClockMinutes(basis, percentWakeRemaining) {
  if (!basis || basis.totalWakeMins <= 0) return null;
  const rem = (percentWakeRemaining / 100) * basis.totalWakeMins;
  return Math.round(modMinutes1440(basis.avgSleepStart - rem));
}

// Filled when config page loads sleep data (for threshold clock labels under sliders).
let configRemainingWakeBasis = null;

// Bar uses position from left: 0 = 100% remaining (open), 100 = 0% remaining. pos1 = open/winding boundary, pos2 = winding/presleep.
function applyRemainingWakeThresholdsUI(pos1, pos2) {
  const segOpen = document.getElementById('config-rw-seg-open');
  const segWinding = document.getElementById('config-rw-seg-winding');
  const segPresleep = document.getElementById('config-rw-seg-presleep');
  const iconOpen = document.getElementById('config-rw-icon-open');
  const iconWinding = document.getElementById('config-rw-icon-winding');
  const iconPresleep = document.getElementById('config-rw-icon-presleep');
  const inputOpen = document.getElementById('config-open-min');
  const inputWinding = document.getElementById('config-winding-min');
  if (!segOpen || !segWinding || !segPresleep || !iconOpen || !iconWinding || !iconPresleep || !inputOpen || !inputWinding) return;

  const p1 = Math.min(95, Math.max(5, pos1));
  const p2 = Math.min(100, Math.max(p1 + 1, pos2));

  segOpen.style.flex = '0 0 ' + p1 + '%';
  segWinding.style.flex = '0 0 ' + (p2 - p1) + '%';
  segPresleep.style.flex = '0 0 ' + (100 - p2) + '%';
  iconOpen.style.flex = '0 0 ' + p1 + '%';
  iconWinding.style.flex = '0 0 ' + (p2 - p1) + '%';
  iconPresleep.style.flex = '0 0 ' + (100 - p2) + '%';
  inputOpen.value = p1;
  inputWinding.value = p2;

  const openMin = 100 - p1;
  const windingMin = 100 - p2;
  const basis = configRemainingWakeBasis;
  const clockOpen = basis ? wakePercentToClockMinutes(basis, openMin) : null;
  const clockWinding = basis ? wakePercentToClockMinutes(basis, windingMin) : null;
  const clockWake = basis ? basis.avgSleepEnd : null;
  const clockSleep = basis ? basis.avgSleepStart : null;
  const timeOpen = clockOpen != null ? formatTime(clockOpen) : '—';
  const timeWinding = clockWinding != null ? formatTime(clockWinding) : '—';
  const timeWake = clockWake != null ? formatTime(clockWake) : '—';
  const timeSleep = clockSleep != null ? formatTime(clockSleep) : '—';

  const percentLeft = document.getElementById('config-rw-percent-left');
  const percentRight = document.getElementById('config-rw-percent-right');
  if (percentLeft) {
    percentLeft.style.left = p1 + '%';
    const pct = percentLeft.querySelector('.config-rw-thumb-pct');
    const tim = percentLeft.querySelector('.config-rw-thumb-time');
    if (pct) pct.textContent = openMin + '%';
    if (tim) tim.textContent = timeOpen;
    percentLeft.setAttribute(
      'aria-label',
      t('config.remainingWake.leftThumbAria', 'Active until {percent}% wake time remains, around {time} with your 7-day averages')
        .replace('{percent}', String(openMin))
        .replace('{time}', String(timeOpen))
    );
  }
  if (percentRight) {
    percentRight.style.left = p2 + '%';
    const pct = percentRight.querySelector('.config-rw-thumb-pct');
    const tim = percentRight.querySelector('.config-rw-thumb-time');
    if (pct) pct.textContent = windingMin + '%';
    if (tim) tim.textContent = timeWinding;
    percentRight.setAttribute(
      'aria-label',
      t('config.remainingWake.rightThumbAria', 'Winding down until {percent}% wake time remains, around {time} with your 7-day averages')
        .replace('{percent}', String(windingMin))
        .replace('{time}', String(timeWinding))
    );
  }

  const endWakeTime = document.getElementById('config-rw-end-wake-time');
  const endSleepTime = document.getElementById('config-rw-end-sleep-time');
  if (endWakeTime) endWakeTime.textContent = timeWake;
  if (endSleepTime) endSleepTime.textContent = timeSleep;
}

// Snap value to 0, 1, 2, ... 100
function snapPercentTo1(frac) {
  const v = Math.round(frac * 100);
  return Math.min(100, Math.max(0, v));
}

/** Markup for the default-values control + bar/sliders (Settings and About). `ariaLabelledBy` is the id of the visible section heading. */
function getRemainingWakeThresholdsControlHTML(ariaLabelledBy) {
  const labelId = ariaLabelledBy || 'remaining-wake';
  const phaseOpen = t('config.remainingWake.phase.open', 'Active');
  const phaseWinding = t('config.remainingWake.phase.winding', 'Winding');
  const phasePresleep = t('config.remainingWake.phase.presleep', 'Pre-sleep');
  const defaultsLabel = t('config.remainingWake.defaultsButton', 'Use default values');
  const openBoundaryAria = t('config.remainingWake.openBoundaryAria', 'Active / Winding boundary (percent remaining)');
  const windingBoundaryAria = t('config.remainingWake.windingBoundaryAria', 'Winding / Pre-sleep boundary (percent remaining)');
  const wakeLabel = t('config.remainingWake.wakeLabel', 'Wake');
  const sleepLabel = t('config.remainingWake.sleepLabel', 'Sleep');
  const phaseSleepHint = t(
    'config.remainingWake.phase.sleepHint',
    'A fourth header phase (moon) appears automatically when you log bed or fell-asleep before wake. It is not controlled by these sliders.'
  );
  const headsUpTitle = t('config.remainingWake.headsUpTitle', 'Phase change heads-up');
  const headsUpIntro = t(
    'config.remainingWake.headsUpIntro',
    'Shows a small note when the next phase (☀️Active → 🌇Winding → 🛏️Pre-sleep) is approaching.'
  );
  const headsUpSliderLeft = t(
    'config.remainingWake.headsUpSliderLeft',
    'Earlier heads-up'
  );
  const headsUpSliderRight = t('config.remainingWake.headsUpSliderRight', 'No heads-up');
  const headsUpTick60 = t('config.remainingWake.headsUpTick60', '60 min');
  const headsUpTick45 = t('config.remainingWake.headsUpTick45', '45 min');
  const headsUpTick30 = t('config.remainingWake.headsUpTick30', '30 min');
  const headsUpTick15 = t('config.remainingWake.headsUpTick15', '15 min');
  const headsUpTickOff = t('config.remainingWake.headsUpTickOff', 'Off');
  const headsUpDefaultButton = t(
    'config.remainingWake.headsUpDefaultButton',
    'Use default value (30m before)'
  );
  const headsUpDefaultAria = t(
    'config.remainingWake.headsUpDefaultAria',
    'Reset phase change heads-up to default: 30 minutes before'
  );
  const z = escapeHtmlBannerText;
  return (
    '<p class="config-remaining-wake-default-row">' +
      '<button type="button" class="config-rw-defaults-button" id="config-rw-use-defaults">' + defaultsLabel + ' <span class="config-rw-default-values"></span></button>' +
    '</p>' +
    '<div class="config-remaining-wake" id="config-remaining-wake" role="group" aria-labelledby="' +
    labelId +
    '">' +
    '<div class="config-remaining-wake-icons" aria-hidden="true">' +
    '<span class="config-remaining-wake-icon-seg" id="config-rw-icon-open"><span class="config-rw-icon-emoji">☀️</span><span class="config-rw-icon-label">' + phaseOpen + '</span></span>' +
    '<span class="config-remaining-wake-icon-seg" id="config-rw-icon-winding"><span class="config-rw-icon-emoji">🌇</span><span class="config-rw-icon-label">' + phaseWinding + '</span></span>' +
    '<span class="config-remaining-wake-icon-seg" id="config-rw-icon-presleep"><span class="config-rw-icon-emoji">🛏️</span><span class="config-rw-icon-label">' + phasePresleep + '</span></span>' +
    '</div>' +
    '<p class="config-remaining-wake-sleep-note">' + phaseSleepHint + '</p>' +
    '<div class="config-remaining-wake-bar-wrap">' +
    '<div class="config-remaining-wake-bar">' +
    '<div class="config-remaining-wake-seg config-remaining-wake-seg--open" id="config-rw-seg-open"></div>' +
    '<div class="config-remaining-wake-seg config-remaining-wake-seg--winding" id="config-rw-seg-winding"></div>' +
    '<div class="config-remaining-wake-seg config-remaining-wake-seg--presleep" id="config-rw-seg-presleep"></div>' +
    '</div>' +
    '<input type="range" id="config-open-min" min="0" max="100" step="1" value="65" aria-label="' + openBoundaryAria + '" tabindex="0">' +
    '<input type="range" id="config-winding-min" min="0" max="100" step="1" value="85" aria-label="' + windingBoundaryAria + '" tabindex="0">' +
    '<div class="config-remaining-wake-bar-overlay" id="config-rw-bar-overlay" aria-hidden="true"></div>' +
    '</div>' +
    '<div class="config-remaining-wake-labels">' +
    '<span class="config-rw-end-label"><span class="config-rw-end-title">' + wakeLabel + '</span><span class="config-rw-end-time" id="config-rw-end-wake-time" aria-hidden="true">—</span></span>' +
    '<span class="config-rw-end-label"><span class="config-rw-end-title">' + sleepLabel + '</span><span class="config-rw-end-time" id="config-rw-end-sleep-time" aria-hidden="true">—</span></span>' +
    '</div>' +
    '<div class="config-remaining-wake-percent-under" id="config-rw-percent-under" aria-live="polite">' +
    '<span class="config-rw-percent-thumb" id="config-rw-percent-left">' +
    '<span class="config-rw-thumb-pct">30%</span><span class="config-rw-thumb-time" aria-hidden="true">—</span>' +
    '</span>' +
    '<span class="config-rw-percent-thumb" id="config-rw-percent-right">' +
    '<span class="config-rw-thumb-pct">10%</span><span class="config-rw-thumb-time" aria-hidden="true">—</span>' +
    '</span>' +
    '</div>' +
    '</div>' +
    '<div class="config-rw-heads-up">' +
    '<label class="config-rw-heads-up-title" id="config-rw-phase-heads-up-title" for="config-rw-phase-heads-up">' +
    z(headsUpTitle) +
    '</label>' +
    '<p class="section-intro config-rw-heads-up-intro">' +
    z(headsUpIntro) +
    '</p>' +
    '<p class="config-rw-heads-up-default-row">' +
    '<button type="button" class="config-rw-defaults-button" id="config-rw-heads-up-use-default" aria-label="' +
    escapeHtmlBannerAttr(headsUpDefaultAria) +
    '">' +
    z(headsUpDefaultButton) +
    '</button>' +
    '</p>' +
    '<div class="config-rw-heads-up-slider-wrap">' +
    '<div class="config-rw-heads-up-slider-endpoints" aria-hidden="true">' +
    '<span class="config-rw-heads-up-slider-end config-rw-heads-up-slider-end--left">' +
    z(headsUpSliderLeft) +
    '</span>' +
    '<span class="config-rw-heads-up-slider-end config-rw-heads-up-slider-end--right">' +
    z(headsUpSliderRight) +
    '</span>' +
    '</div>' +
    '<div class="config-rw-heads-up-slider-padded">' +
    '<div class="config-rw-heads-up-slider-track-outer">' +
    '<div class="config-rw-heads-up-slider-track-bg" aria-hidden="true"></div>' +
    '<input type="range" id="config-rw-phase-heads-up" class="config-rw-heads-up-range" min="0" max="4" step="1" value="2" ' +
    'aria-labelledby="config-rw-phase-heads-up-title" />' +
    '</div>' +
    '<div class="config-rw-heads-up-slider-tick-labels" aria-hidden="true">' +
    '<span class="config-rw-heads-up-slider-tick-label">' +
    z(headsUpTick60) +
    '</span>' +
    '<span class="config-rw-heads-up-slider-tick-label">' +
    z(headsUpTick45) +
    '</span>' +
    '<span class="config-rw-heads-up-slider-tick-label">' +
    z(headsUpTick30) +
    '</span>' +
    '<span class="config-rw-heads-up-slider-tick-label">' +
    z(headsUpTick15) +
    '</span>' +
    '<span class="config-rw-heads-up-slider-tick-label">' +
    z(headsUpTickOff) +
    '</span>' +
    '</div>' +
    '</div>' +
    '</div>' +
    '</div>'
  );
}

// Initializes remaining wake thresholds UI: bar, sliders, localStorage (Settings and About).
function initRemainingWakeThresholdsConfig() {
  const inputOpen = document.getElementById('config-open-min');
  const inputWinding = document.getElementById('config-winding-min');
  const barWrap = document.getElementById('config-rw-bar-overlay') && document.getElementById('config-rw-bar-overlay').parentElement;
  const overlay = document.getElementById('config-rw-bar-overlay');
  if (!inputOpen || !inputWinding || !barWrap || !overlay) return;

  loadSleepData()
    .then(function (data) {
      configRemainingWakeBasis = computeRecentSevenDayWakeBasis(data.days);
      const { openMin, windingMin } = getRemainingWakeThresholds();
      applyRemainingWakeThresholdsUI(100 - openMin, 100 - windingMin);
    })
    .catch(function () {
      configRemainingWakeBasis = null;
      const { openMin, windingMin } = getRemainingWakeThresholds();
      applyRemainingWakeThresholdsUI(100 - openMin, 100 - windingMin);
    });

  const { openMin, windingMin } = getRemainingWakeThresholds();
  const pos1 = 100 - openMin;
  const pos2 = 100 - windingMin;
  applyRemainingWakeThresholdsUI(pos1, pos2);

  function syncFromInputs() {
    let p1 = parseInt(inputOpen.value, 10) || 70;
    let p2 = parseInt(inputWinding.value, 10) || 90;
    if (p1 >= p2) {
      p2 = Math.min(100, p1 + 1);
      p1 = Math.max(0, p2 - 1);
    }
    applyRemainingWakeThresholdsUI(p1, p2);
    const openMinNew = 100 - p1;
    const windingMinNew = 100 - p2;
    if (openMinNew > windingMinNew) setRemainingWakeThresholds(openMinNew, windingMinNew);
  }

  inputOpen.addEventListener('input', syncFromInputs);
  inputWinding.addEventListener('input', syncFromInputs);

  // Overlay: decide which slider to move from pointer x, then update that slider so right thumb is grabbable
  let dragging = null; // 'open' | 'winding'

  function getValueFromEvent(e) {
    const rect = barWrap.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const frac = (clientX - rect.left) / rect.width;
    return snapPercentTo1(frac);
  }

  function onPointerDown(e) {
    if (e.button !== 0 && !e.touches) return;
    if (e.touches && e.touches.length > 1) return;
    e.preventDefault();
    const val = getValueFromEvent(e);
    const p1 = parseInt(inputOpen.value, 10);
    const p2 = parseInt(inputWinding.value, 10);
    const mid = (p1 + p2) / 2;
    if (val <= mid) {
      dragging = 'open';
      inputOpen.value = String(Math.min(p2 - 1, val));
    } else {
      dragging = 'winding';
      inputWinding.value = String(Math.max(p1 + 1, val));
    }
    syncFromInputs();
  }

  function onPointerMove(e) {
    if (!dragging) return;
    if (e.cancelable) e.preventDefault();
    const val = getValueFromEvent(e);
    const p1 = parseInt(inputOpen.value, 10);
    const p2 = parseInt(inputWinding.value, 10);
    if (dragging === 'open') {
      inputOpen.value = String(Math.min(p2 - 1, val));
    } else {
      inputWinding.value = String(Math.max(p1 + 1, val));
    }
    syncFromInputs();
  }

  function onPointerUp() {
    dragging = null;
  }

  overlay.addEventListener('mousedown', onPointerDown);
  overlay.addEventListener('touchstart', onPointerDown, { passive: false });
  document.addEventListener('mousemove', onPointerMove);
  document.addEventListener('mouseup', onPointerUp);
  document.addEventListener('touchmove', onPointerMove, { passive: false });
  document.addEventListener('touchend', onPointerUp);
  document.addEventListener('touchcancel', onPointerUp);

  const defaultsBtn = document.getElementById('config-rw-use-defaults');
  if (defaultsBtn) {
    const defaultsLabel = `(${DEFAULT_REMAINING_WAKE_OPEN_MIN}%, ${DEFAULT_REMAINING_WAKE_WINDING_MIN}%)`;
    const span = defaultsBtn.querySelector('.config-rw-default-values');
    if (span) span.textContent = defaultsLabel;
    const defaultsAria = t(
      'config.remainingWake.defaultsAria',
      'Reset remaining wake thresholds to defaults: {open}% and {winding}%'
    )
      .replace('{open}', String(DEFAULT_REMAINING_WAKE_OPEN_MIN))
      .replace('{winding}', String(DEFAULT_REMAINING_WAKE_WINDING_MIN));
    defaultsBtn.setAttribute(
      'aria-label',
      defaultsAria
    );
    defaultsBtn.addEventListener('click', function () {
      setRemainingWakeThresholds(DEFAULT_REMAINING_WAKE_OPEN_MIN, DEFAULT_REMAINING_WAKE_WINDING_MIN);
      const pos1 = 100 - DEFAULT_REMAINING_WAKE_OPEN_MIN;
      const pos2 = 100 - DEFAULT_REMAINING_WAKE_WINDING_MIN;
      applyRemainingWakeThresholdsUI(pos1, pos2);
    });
  }

  const headsUpRange = document.getElementById('config-rw-phase-heads-up');
  if (headsUpRange) {
    function syncHeadsUpRangeFromStorage() {
      const mins = getRemainingWakePhaseHeadsUpMinutes();
      headsUpRange.value = String(remainingWakePhaseHeadsUpMinutesToSliderIndex(mins));
      headsUpRange.setAttribute(
        'aria-valuetext',
        getRemainingWakePhaseHeadsUpStopAriaLabel(mins)
      );
    }
    function onHeadsUpRangeInput() {
      const idx = parseInt(headsUpRange.value, 10) || 0;
      const mins = remainingWakePhaseHeadsUpSliderIndexToMinutes(idx);
      setRemainingWakePhaseHeadsUpMinutes(mins);
      headsUpRange.setAttribute(
        'aria-valuetext',
        getRemainingWakePhaseHeadsUpStopAriaLabel(mins)
      );
      if (typeof initRemainingWakeNav === 'function') {
        initRemainingWakeNav();
      }
    }
    syncHeadsUpRangeFromStorage();
    headsUpRange.addEventListener('input', onHeadsUpRangeInput);
    headsUpRange.addEventListener('change', onHeadsUpRangeInput);

    const headsUpDefaultBtn = document.getElementById('config-rw-heads-up-use-default');
    if (headsUpDefaultBtn) {
      headsUpDefaultBtn.addEventListener('click', function () {
        setRemainingWakePhaseHeadsUpMinutes(DEFAULT_REMAINING_WAKE_PHASE_HEADS_UP_MINS);
        syncHeadsUpRangeFromStorage();
        if (typeof initRemainingWakeNav === 'function') {
          initRemainingWakeNav();
        }
      });
    }
  }
}

// Binds dev-banner wall clock mode (real vs simulated) and optional datetime apply (dev build only).
function initDevClockControl() {
  if (typeof window === 'undefined' || !isDevBuildContext()) return;
  if (window.__devClockControlBound) return;
  window.__devClockControlBound = true;

  function setModeUi(realTimeActive) {
    const realBtn = document.getElementById('nav-dev-banner-clock-mode-real');
    const simBtn = document.getElementById('nav-dev-banner-clock-mode-sim');
    const panel = document.getElementById('nav-dev-banner-clock-sim-panel');
    if (!realBtn || !simBtn || !panel) return;
    realBtn.classList.toggle('nav-dev-banner-clock-mode-btn--active', realTimeActive);
    simBtn.classList.toggle('nav-dev-banner-clock-mode-btn--active', !realTimeActive);
    realBtn.setAttribute('aria-pressed', realTimeActive ? 'true' : 'false');
    simBtn.setAttribute('aria-pressed', realTimeActive ? 'false' : 'true');
    panel.hidden = realTimeActive;
  }

  function persistDevClockMs(ms) {
    const t = new Date(ms);
    if (Number.isNaN(t.getTime())) return;
    try {
      localStorage.setItem(DEV_CLOCK_OVERRIDE_MS_KEY, String(t.getTime()));
    } catch (_) {}
    window.location.reload();
  }

  function persistDevClockFromInput(inputEl) {
    const v = inputEl.value;
    if (!v) return;
    const t = new Date(v);
    if (Number.isNaN(t.getTime())) return;
    persistDevClockMs(t.getTime());
  }

  function bindWhenReady() {
    const input = document.getElementById('nav-dev-banner-dev-clock-input');
    const realBtn = document.getElementById('nav-dev-banner-clock-mode-real');
    const simBtn = document.getElementById('nav-dev-banner-clock-mode-sim');
    if (!input || !realBtn || !simBtn) return;

    input.value = formatDateForDatetimeLocal(getAppDate());
    setModeUi(readDevClockOverrideMs() == null);

    let devClockUiReady = false;
    requestAnimationFrame(function () {
      devClockUiReady = true;
    });

    input.addEventListener('input', function () {
      if (!devClockUiReady) return;
      setModeUi(false);
    });

    input.addEventListener('change', function () {
      if (!devClockUiReady) return;
      setModeUi(false);
      persistDevClockFromInput(input);
    });

    function openDevClockNativePicker() {
      try {
        if (typeof input.showPicker === 'function') {
          input.showPicker();
          return;
        }
      } catch (_) {}
      input.focus();
    }

    input.addEventListener('click', function () {
      openDevClockNativePicker();
    });

    realBtn.addEventListener('click', function () {
      if (readDevClockOverrideMs() != null) {
        try {
          localStorage.removeItem(DEV_CLOCK_OVERRIDE_MS_KEY);
        } catch (_) {}
        window.location.reload();
        return;
      }
      setModeUi(true);
    });

    simBtn.addEventListener('click', function () {
      setModeUi(false);
      input.value = formatDateForDatetimeLocal(getAppDate());
    });

    const stepSpec = [
      { id: 'nav-dev-banner-clock-step-prev-day', apply: function (d) { d.setDate(d.getDate() - 1); } },
      { id: 'nav-dev-banner-clock-step-minus-hour', apply: function (d) { d.setHours(d.getHours() - 1); } },
      { id: 'nav-dev-banner-clock-step-minus-min', apply: function (d) { d.setMinutes(d.getMinutes() - 1); } },
      { id: 'nav-dev-banner-clock-step-plus-min', apply: function (d) { d.setMinutes(d.getMinutes() + 1); } },
      { id: 'nav-dev-banner-clock-step-plus-hour', apply: function (d) { d.setHours(d.getHours() + 1); } },
      { id: 'nav-dev-banner-clock-step-next-day', apply: function (d) { d.setDate(d.getDate() + 1); } }
    ];
    for (let i = 0; i < stepSpec.length; i++) {
      const spec = stepSpec[i];
      const btn = document.getElementById(spec.id);
      if (!btn) continue;
      btn.addEventListener('click', function () {
        const d = getAppDate();
        spec.apply(d);
        persistDevClockMs(d.getTime());
      });
    }
  }

  requestAnimationFrame(bindWhenReady);
}

function initDevBannerCloudRefresh() {
  if (typeof window === 'undefined' || !isDevBuildContext()) return;
  if (window.__devBannerCloudRefreshBound) return;
  window.__devBannerCloudRefreshBound = true;

  function bindWhenReady() {
    const btn = document.getElementById('nav-dev-banner-cloud-refresh-btn');
    if (!btn) return;
    btn.addEventListener('click', function () {
      const cfg = getSupabaseConfig();
      if (!cfg.enabled) return;
      btn.disabled = true;
      loadSleepData({ forceRefresh: true })
        .then(function () {
          window.location.reload();
        })
        .catch(function () {})
        .finally(function () {
          btn.disabled = false;
        });
    });
  }

  requestAnimationFrame(bindWhenReady);
}

function initDevBannerSupabasePresetToggle() {
  if (typeof window === 'undefined' || !isDevBuildContext()) return;
  if (window.__devBannerPresetToggleBound) return;
  window.__devBannerPresetToggleBound = true;

  function bindWhenReady() {
    const devBtn = document.getElementById('nav-dev-banner-preset-dev-btn');
    const prodBtn = document.getElementById('nav-dev-banner-preset-prod-btn');
    if (!devBtn || !prodBtn) return;
    const presets = readLocalSupabasePresets();
    if (!presets) return;
    devBtn.addEventListener('click', function () {
      setActiveSupabasePresetId('dev');
      setSupabaseConfig(presets.dev.url, presets.dev.anonKey);
      window.location.reload();
    });
    prodBtn.addEventListener('click', function () {
      setActiveSupabasePresetId('prod');
      setSupabaseConfig(presets.prod.url, presets.prod.anonKey);
      window.location.reload();
    });
  }

  requestAnimationFrame(bindWhenReady);
}

function initDevBannerDrawer() {
  if (typeof window === 'undefined' || !isDevBuildContext()) return;
  if (window.__devBannerDrawerBound) return;
  window.__devBannerDrawerBound = true;

  function bindWhenReady() {
    const banner = document.querySelector('.nav-dev-banner');
    const handle = document.getElementById('nav-dev-banner-drawer-handle');
    const drawer = document.getElementById('nav-dev-banner-drawer');
    if (!banner || !handle) return;

    let postToggleLayoutTimer = null;

    function setUi(collapsed) {
      banner.classList.toggle('nav-dev-banner--collapsed', collapsed);
      banner.dataset.devBannerDrawerToggledAt = String(Date.now());
      handle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      handle.setAttribute(
        'aria-label',
        collapsed ? 'Expand dev banner (drag down or tap)' : 'Collapse dev banner (drag up or tap)'
      );
      try {
        if (collapsed) localStorage.setItem(DEV_BANNER_DRAWER_COLLAPSED_KEY, '1');
        else localStorage.removeItem(DEV_BANNER_DRAWER_COLLAPSED_KEY);
      } catch (_) {}
      requestAnimationFrame(function () {
        syncDevBannerFixedLayout();
      });
      if (postToggleLayoutTimer != null) {
        clearTimeout(postToggleLayoutTimer);
        postToggleLayoutTimer = null;
      }
      postToggleLayoutTimer = window.setTimeout(function () {
        postToggleLayoutTimer = null;
        delete banner.dataset.devBannerDrawerToggledAt;
        syncDevBannerFixedLayout();
      }, 360);
    }

    let ptrDown = false;
    let y0 = 0;
    let maxAbsDy = 0;
    let suppressClick = false;
    const dragThresholdPx = 10;
    const swipeThresholdPx = 40;
    const handleDragVisualMaxPx = 14;
    let startCollapsed = false;
    let dragStarted = false;
    let dragDrawerFullPx = 0;
    let dragDrawerStartPx = 0;

    function resetHandleVisual() {
      handle.style.transform = '';
    }

    handle.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 && e.button !== undefined) return;
      ptrDown = true;
      y0 = e.clientY;
      maxAbsDy = 0;
      dragStarted = false;
      startCollapsed = banner.classList.contains('nav-dev-banner--collapsed');
      dragDrawerFullPx = drawer ? Math.ceil(drawer.scrollHeight) : 0;
      dragDrawerStartPx = startCollapsed ? 0 : dragDrawerFullPx;
      resetHandleVisual();
      try {
        handle.setPointerCapture(e.pointerId);
      } catch (_) {}
    });

    handle.addEventListener('pointermove', function (e) {
      if (!ptrDown) return;
      const dy = e.clientY - y0;
      maxAbsDy = Math.max(maxAbsDy, Math.abs(dy));
      const vis = Math.max(-handleDragVisualMaxPx, Math.min(handleDragVisualMaxPx, dy * 0.35));
      handle.style.transform = vis ? 'translateY(' + vis + 'px)' : '';
      if (!drawer) return;
      if (maxAbsDy <= dragThresholdPx) return;
      if (!dragStarted) {
        dragStarted = true;
        banner.classList.add('nav-dev-banner--dragging');
      }
      const targetPx = Math.max(0, Math.min(dragDrawerFullPx, dragDrawerStartPx + dy));
      banner.classList.remove('nav-dev-banner--collapsed');
      drawer.style.maxHeight = `${targetPx}px`;
    });

    function endPointer(e) {
      if (!ptrDown) return;
      ptrDown = false;
      resetHandleVisual();
      try {
        handle.releasePointerCapture(e.pointerId);
      } catch (_) {}
      const dy = e.clientY - y0;
      if (dragStarted) {
        banner.classList.remove('nav-dev-banner--dragging');
        if (drawer) drawer.style.maxHeight = '';
      }
      if (maxAbsDy > dragThresholdPx) {
        suppressClick = true;
        if (dy < -swipeThresholdPx) setUi(true);
        else if (dy > swipeThresholdPx) setUi(false);
        else setUi(startCollapsed ? false : true);
      }
    }

    handle.addEventListener('pointerup', endPointer);
    handle.addEventListener('pointercancel', function (e) {
      ptrDown = false;
      resetHandleVisual();
      try {
        handle.releasePointerCapture(e.pointerId);
      } catch (_) {}
    });

    handle.addEventListener('click', function (e) {
      if (suppressClick) {
        e.preventDefault();
        e.stopPropagation();
        suppressClick = false;
        return;
      }
      e.preventDefault();
      setUi(!banner.classList.contains('nav-dev-banner--collapsed'));
    });
  }

  requestAnimationFrame(bindWhenReady);
}

/** Full expanded height; when collapsed, briefly expands with transitions off for an accurate read. */
function measureDevBannerExpandedHeightPx(banner) {
  banner.dataset.devBannerLayoutMeasure = '1';
  let h = 0;
  const drawerEl = banner.querySelector('.nav-dev-banner-drawer');
  const prevDrawerTransition = drawerEl ? drawerEl.style.transition : '';
  try {
    if (drawerEl) drawerEl.style.transition = 'none';
    const wasCollapsed = banner.classList.contains('nav-dev-banner--collapsed');
    const prevVis = banner.style.visibility;
    if (wasCollapsed) banner.classList.add('nav-dev-banner--measure');
    banner.style.visibility = 'hidden';
    if (wasCollapsed) banner.classList.remove('nav-dev-banner--collapsed');
    void banner.offsetHeight;
    h = Math.ceil(banner.getBoundingClientRect().height);
    if (wasCollapsed) banner.classList.add('nav-dev-banner--collapsed');
    banner.style.visibility = prevVis || '';
    if (wasCollapsed) banner.classList.remove('nav-dev-banner--measure');
  } finally {
    if (drawerEl) drawerEl.style.transition = prevDrawerTransition;
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        delete banner.dataset.devBannerLayoutMeasure;
      });
    });
  }
  return h;
}

function readDevBannerExpandedReservePx() {
  try {
    const raw = localStorage.getItem(DEV_BANNER_EXPANDED_RESERVE_KEY);
    if (raw == null || raw === '') return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.ceil(n);
  } catch (_) {
    return null;
  }
}

function persistDevBannerExpandedReservePx(px) {
  try {
    localStorage.setItem(DEV_BANNER_EXPANDED_RESERVE_KEY, String(Math.ceil(px)));
  } catch (_) {}
}

// Reserves vertical space for the fixed dev banner: live collapsed height when the drawer is
// closed (so the page sits under the compact strip), full live height when open. The
// localStorage expanded-reserve cache is only used to avoid undershooting padding while the
// drawer is opening (live height lags until max-height finishes). syncDevBannerFixedLayout is
// bound to resize once per window (see initDayNightTheme).
function syncDevBannerFixedLayout() {
  const wrap = document.querySelector('.nav-wrapper');
  if (!wrap) return;
  const banner = wrap.querySelector('.nav-dev-banner');
  if (!banner) {
    wrap.style.paddingTop = '';
    return;
  }
  const mb = parseFloat(getComputedStyle(banner).marginBottom) || 0;
  const toggledAt = parseInt(banner.dataset.devBannerDrawerToggledAt, 10);
  const inDrawerAnimWindow =
    Number.isFinite(toggledAt) && Date.now() - toggledAt < 380;

  let reservePx;
  if (banner.classList.contains('nav-dev-banner--collapsed')) {
    reservePx = Math.ceil(banner.getBoundingClientRect().height);
  } else {
    const live = Math.ceil(banner.getBoundingClientRect().height);
    let expandedRef = readDevBannerExpandedReservePx();
    if (expandedRef == null || expandedRef <= 0) {
      expandedRef = measureDevBannerExpandedHeightPx(banner);
    }
    reservePx = inDrawerAnimWindow ? Math.max(live, expandedRef) : live;
    if (!inDrawerAnimWindow) {
      persistDevBannerExpandedReservePx(live);
    } else if (live >= expandedRef) {
      persistDevBannerExpandedReservePx(live);
    }
  }

  wrap.style.paddingTop = `${reservePx + mb}px`;
}

function updateDevBannerUserSettingsPanel() {
  if (typeof document === 'undefined') return;
  const panel = document.getElementById('nav-dev-banner-user-panel');
  if (!panel) return;

  const langSel = document.getElementById('nav-dev-banner-user-lang');
  if (langSel) {
    const cur = getLanguagePreference();
    langSel.value = SUPPORTED_LANGUAGES.indexOf(cur) === -1 ? 'en' : cur;
  }

  const clockSel = document.getElementById('nav-dev-banner-user-clock');
  if (clockSel) {
    const cf = getClockFormatPreference();
    clockSel.value = cf === '12h' ? '12h' : '24h';
  }

  const themeSel = document.getElementById('nav-dev-banner-user-theme');
  if (themeSel) {
    const override = getThemeOverride();
    themeSel.value = override === null ? 'auto' : override;
  }

  const palSel = document.getElementById('nav-dev-banner-user-palette');
  if (palSel) {
    const pal = getQualityPaletteId();
    if (pal === 'meadow' || pal === 'harbor' || pal === 'auto') palSel.value = pal;
  }

  const th = getRemainingWakeThresholds();
  const openIn = document.getElementById('nav-dev-banner-rw-open');
  const windIn = document.getElementById('nav-dev-banner-rw-winding');
  if (openIn) openIn.value = String(th.openMin);
  if (windIn) windIn.value = String(th.windingMin);

  const heads = document.getElementById('nav-dev-banner-rw-heads-up');
  if (heads) heads.value = String(getRemainingWakePhaseHeadsUpMinutes());
}

/** Resets dev-banner user settings (and mirrored prefs) to app defaults; dev build only (Use defaults). */
function applyDevBannerUserSettingsDefaults() {
  if (typeof document === 'undefined') return;
  setLanguagePreference(DEFAULT_LANGUAGE);
  if (document.documentElement) document.documentElement.setAttribute('lang', DEFAULT_LANGUAGE);
  void initI18n(document);
  setClockFormatPreference('24h');
  updateClockFormatSelector();
  document.dispatchEvent(new CustomEvent('clock-format-changed', { detail: { format: '24h' } }));
  setThemeChoice('auto');
  setQualityPaletteId(DEFAULT_QUALITY_PALETTE_ID);
  applyQualityPaletteToDocument();
  updateQualityPaletteSelector();
  document.dispatchEvent(
    new CustomEvent('quality-palette-changed', { detail: { palette: DEFAULT_QUALITY_PALETTE_ID } })
  );
  setRemainingWakeThresholds(DEFAULT_REMAINING_WAKE_OPEN_MIN, DEFAULT_REMAINING_WAKE_WINDING_MIN);
  setRemainingWakePhaseHeadsUpMinutes(DEFAULT_REMAINING_WAKE_PHASE_HEADS_UP_MINS);
  if (typeof applyRemainingWakeThresholdsUI === 'function') {
    applyRemainingWakeThresholdsUI(
      100 - DEFAULT_REMAINING_WAKE_OPEN_MIN,
      100 - DEFAULT_REMAINING_WAKE_WINDING_MIN
    );
  }
  if (typeof initRemainingWakeNav === 'function') initRemainingWakeNav();
  updateDevBannerUserSettingsPanel();
  requestAnimationFrame(function () {
    syncDevBannerFixedLayout();
  });
}

function initDevBannerUserSettingsPanel() {
  if (typeof window === 'undefined' || !isDevBuildContext()) return;
  if (window.__devBannerUserSettingsBound) return;
  window.__devBannerUserSettingsBound = true;

  function bindWhenReady() {
    const panel = document.getElementById('nav-dev-banner-user-panel');
    if (!panel) return;

    const langSel = document.getElementById('nav-dev-banner-user-lang');
    if (langSel) {
      langSel.addEventListener('change', function () {
        const selected = normalizeLanguage(langSel.value);
        if (SUPPORTED_LANGUAGES.indexOf(selected) === -1) return;
        setLanguagePreference(selected);
        if (document.documentElement) document.documentElement.setAttribute('lang', selected);
        void initI18n(document);
        requestAnimationFrame(function () {
          syncDevBannerFixedLayout();
        });
      });
    }

    const clockSel = document.getElementById('nav-dev-banner-user-clock');
    if (clockSel) {
      clockSel.addEventListener('change', function () {
        const f = clockSel.value;
        if (f !== '12h' && f !== '24h') return;
        setClockFormatPreference(f);
        updateClockFormatSelector();
        document.dispatchEvent(new CustomEvent('clock-format-changed', { detail: { format: f } }));
        if (typeof initRemainingWakeNav === 'function') initRemainingWakeNav();
      });
    }

    const themeSel = document.getElementById('nav-dev-banner-user-theme');
    if (themeSel) {
      themeSel.addEventListener('change', function () {
        const ch = themeSel.value;
        if (ch !== 'auto' && ch !== 'day' && ch !== 'night') return;
        setThemeChoice(ch);
      });
    }

    const palSel = document.getElementById('nav-dev-banner-user-palette');
    if (palSel) {
      palSel.addEventListener('change', function () {
        const id = palSel.value;
        if (id !== 'meadow' && id !== 'harbor' && id !== 'auto') return;
        setQualityPaletteId(id);
        applyQualityPaletteToDocument();
        updateQualityPaletteSelector();
        document.dispatchEvent(new CustomEvent('quality-palette-changed', { detail: { palette: id } }));
      });
    }

    function syncRwFromDevInputs() {
      const openEl = document.getElementById('nav-dev-banner-rw-open');
      const windEl = document.getElementById('nav-dev-banner-rw-winding');
      if (!openEl || !windEl) return;
      let openMin = parseInt(openEl.value, 10);
      let windingMin = parseInt(windEl.value, 10);
      if (!Number.isFinite(openMin)) openMin = DEFAULT_REMAINING_WAKE_OPEN_MIN;
      if (!Number.isFinite(windingMin)) windingMin = DEFAULT_REMAINING_WAKE_WINDING_MIN;
      openMin = clampThresholdPercent(openMin);
      windingMin = clampThresholdPercent(windingMin);
      if (openMin <= windingMin) {
        windingMin = Math.max(0, openMin - 1);
        if (windingMin < 0 || openMin <= windingMin) {
          openMin = DEFAULT_REMAINING_WAKE_OPEN_MIN;
          windingMin = DEFAULT_REMAINING_WAKE_WINDING_MIN;
        }
      }
      setRemainingWakeThresholds(openMin, windingMin);
      if (typeof initRemainingWakeNav === 'function') initRemainingWakeNav();
    }

    const openEl = document.getElementById('nav-dev-banner-rw-open');
    const windEl = document.getElementById('nav-dev-banner-rw-winding');
    if (openEl) {
      openEl.addEventListener('change', syncRwFromDevInputs);
      openEl.addEventListener('blur', syncRwFromDevInputs);
    }
    if (windEl) {
      windEl.addEventListener('change', syncRwFromDevInputs);
      windEl.addEventListener('blur', syncRwFromDevInputs);
    }

    const headsSel = document.getElementById('nav-dev-banner-rw-heads-up');
    if (headsSel) {
      headsSel.addEventListener('change', function () {
        const n = parseInt(headsSel.value, 10);
        setRemainingWakePhaseHeadsUpMinutes(n);
        if (typeof initRemainingWakeNav === 'function') initRemainingWakeNav();
      });
    }

    const useDefaultBtn = document.getElementById('nav-dev-banner-user-use-default');
    if (useDefaultBtn) {
      useDefaultBtn.addEventListener('click', function () {
        applyDevBannerUserSettingsDefaults();
      });
    }

    updateDevBannerUserSettingsPanel();
  }

  requestAnimationFrame(bindWhenReady);
}

// Initializes day/night theme, click handler, and timer to re-check (when in auto mode)
function initDayNightTheme() {
  applyDayNightTheme();
  updateDayNightIcon();
  updateDataSourceBadge();
  const pillWrap = document.getElementById('nav-daynight');
  if (pillWrap) pillWrap.addEventListener('click', handleDayNightClick);
  initNavMenu();
  initNavSlumbyBounce();
  initDevClockControl();
  initDevBannerCloudRefresh();
  initDevBannerSupabasePresetToggle();
  initDevBannerDrawer();
  initDevBannerUserSettingsPanel();
  setInterval(function () {
    applyDayNightTheme();
    updateDayNightIcon();
  }, 60000);

  requestAnimationFrame(function () {
    syncDevBannerFixedLayout();
    if (isDevBuildContext()) {
      requestAnimationFrame(function () {
        syncDevBannerFixedLayout();
      });
    }
    if (typeof window !== 'undefined' && !window.__devBannerLayoutResizeBound) {
      window.__devBannerLayoutResizeBound = true;
      window.addEventListener('resize', syncDevBannerFixedLayout);
    }
  });
}

// Hamburger menu: toggle dropdown, theme buttons, close on outside click
function initNavMenu() {
  const trigger = document.getElementById('nav-menu-trigger');
  const dropdown = document.getElementById('nav-menu-dropdown');
  if (!trigger || !dropdown) return;

  function closeMenu() {
    trigger.setAttribute('aria-expanded', 'false');
    dropdown.classList.remove('nav-menu-dropdown--open');
    dropdown.hidden = true;
  }

  function openMenu() {
    trigger.setAttribute('aria-expanded', 'true');
    dropdown.classList.add('nav-menu-dropdown--open');
    dropdown.hidden = false;
  }

  function toggleMenu() {
    const isOpen = dropdown.classList.contains('nav-menu-dropdown--open');
    if (isOpen) closeMenu();
    else openMenu();
  }

  trigger.addEventListener('click', function (e) {
    e.stopPropagation();
    toggleMenu();
  });

  const themeToggle = document.getElementById('nav-menu-theme-toggle');
  const themeRow = themeToggle ? themeToggle.closest('.nav-menu-theme-row') : null;
  if (themeRow) {
    themeRow.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      const current = getEffectiveTheme();
      setThemeChoice(current === 'day' ? 'night' : 'day');
    });
  }

  dropdown.querySelectorAll('a.nav-menu-item').forEach(link => {
    link.addEventListener('click', closeMenu);
  });

  document.addEventListener('click', function (e) {
    if (dropdown.classList.contains('nav-menu-dropdown--open') && !trigger.contains(e.target) && !dropdown.contains(e.target)) {
      closeMenu();
    }
  });
}

function isLocalDevHost(hostname) {
  const host = (hostname || '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

// Optional build-id mismatch gate:
// - Set <html data-build-id="..."> on each build.
// - Set <html data-prod-build-id="..."> to your known production ID.
// Banner appears when running local dev OR when IDs differ.
function isDevBuildContext() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;

  const params = new URLSearchParams(window.location.search);
  if (params.get('devBanner') === '1') return true;
  if (params.get('devBanner') === '0') return false;

  try {
    const forced = localStorage.getItem(DEV_BANNER_OVERRIDE_KEY);
    if (forced === '1') return true;
    if (forced === '0') return false;
  } catch (_) {}

  if (isLocalDevHost(window.location.hostname)) return true;

  const html = document.documentElement;
  const buildId = html ? html.getAttribute('data-build-id') : '';
  const prodBuildId = html ? html.getAttribute('data-prod-build-id') : '';
  if (buildId && prodBuildId && buildId !== prodBuildId) return true;

  return false;
}

function readDevBannerDrawerCollapsed() {
  if (!isDevBuildContext()) return false;
  try {
    return localStorage.getItem(DEV_BANNER_DRAWER_COLLAPSED_KEY) === '1';
  } catch (_) {
    return false;
  }
}

/** Epoch ms from localStorage when dev build + valid key; else null. Ignored outside dev context. */
function readDevClockOverrideMs() {
  if (!isDevBuildContext()) return null;
  try {
    const raw = localStorage.getItem(DEV_CLOCK_OVERRIDE_MS_KEY);
    if (raw == null || raw === '') return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    return n;
  } catch (_) {
    return null;
  }
}

/** Wall clock for app logic: dev override ms or Date.now(). Theme interval still uses real time. */
function getAppNowMs() {
  const o = readDevClockOverrideMs();
  return o != null ? o : Date.now();
}

function getAppDate() {
  return new Date(getAppNowMs());
}

/** Value for input[type=datetime-local] in local timezone. */
function formatDateForDatetimeLocal(d) {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return y + '-' + mo + '-' + day + 'T' + h + ':' + mi;
}

function escapeHtmlBannerText(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeHtmlBannerAttr(s) {
  return escapeHtmlBannerText(s).replace(/"/g, '&quot;');
}

function resolveSupabaseDashboardUrl() {
  const url = (getSupabaseConfig().url || '').toLowerCase();
  if (url.includes(SUPABASE_PROJECT_REF_PROD)) {
    return 'https://supabase.com/dashboard/project/' + SUPABASE_PROJECT_REF_PROD;
  }
  if (url.includes(SUPABASE_PROJECT_REF_DEV)) {
    return 'https://supabase.com/dashboard/project/' + SUPABASE_PROJECT_REF_DEV;
  }
  return 'https://supabase.com/dashboard/project/' + SUPABASE_PROJECT_REF_DEV;
}

function getDevBannerSupabaseDbClass() {
  const url = (getSupabaseConfig().url || '').toLowerCase();
  if (url.includes(SUPABASE_PROJECT_REF_PROD)) return 'nav-dev-banner--db-prod';
  return 'nav-dev-banner--db-dev';
}

function getDevGitBranchLabel() {
  if (typeof window === 'undefined') return '';
  const b = window.__DEV_GIT_BRANCH__;
  if (b == null || b === '') return '';
  const t = String(b).trim();
  return t || '';
}

function isDevGitBranchMaster() {
  const label = getDevGitBranchLabel();
  return label !== '' && label.toLowerCase() === 'master';
}

/** 1×1 transparent GIF — idle `src` for nav Slumby bounce overlay between plays. */
var SLUMBY_NAV_GIF_IDLE_DATA_URI =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
var SLUMBY_NAV_BOUNCE_MS = 4180;
var SLUMBY_NAV_STILL_PATH = 'assets/slumby_bounce_still.png';
var SLUMBY_NAV_GIF_PATH = 'assets/slumby_bounce_mini.gif';

// Render navigation bar
function renderNavBar(currentPage) {
  applyDayNightTheme();
  ensureDevSupabasePresetApplied();

  const pages = [
    { id: 'dashboard', key: 'nav.tabs.dashboard', defaultName: 'Dashboard', url: 'dashboard.html', icon: '🛌' },
    { id: 'log', key: 'nav.tabs.log', defaultName: 'Log', url: 'log.html', icon: '✏️' },
    { id: 'quality', key: 'nav.tabs.quality', defaultName: 'Quality', url: 'quality.html', icon: '🟢' },
    { id: 'timeline', key: 'nav.tabs.daily', defaultName: 'Daily', url: 'daily.html', icon: '📅' },
    { id: 'graph', key: 'nav.tabs.graphs', defaultName: 'Graphs', url: 'graph.html', icon: '📊' },
    { id: 'stats', key: 'nav.tabs.stats', defaultName: 'Stats', url: 'stats.html', icon: '🔢' }
  ];

  const navItems = pages.map(page => {
    const isActive = page.id === currentPage;
    const name = t(page.key, page.defaultName);
    return `<a href="${page.url}" class="nav-tab ${isActive ? 'active' : ''}" aria-label="${name}"><span class="nav-icon">${page.icon}</span><span class="nav-tab-label">${name}</span></a>`;
  }).join('');

  const theme = getEffectiveTheme();
  const nightActive = theme === 'night';
  const hamburgerIcon = '<svg class="nav-menu-trigger-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z"/></svg>';
  const menuTrigger = `<button type="button" class="nav-menu-trigger" id="nav-menu-trigger" aria-label="${t('nav.menu.options', 'Options')}" aria-expanded="false" aria-haspopup="true">${hamburgerIcon}</button>`;
  const configIcon = `<svg class="nav-menu-item-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 15.5A3.5 3.5 0 0 1 8.5 12 3.5 3.5 0 0 1 12 8.5a3.5 3.5 0 0 1 3.5 3.5 3.5 3.5 0 0 1-3.5 3.5m7.43-2.53c.04-.32.07-.64.07-.97 0-.33-.03-.66-.07-1l2.11-1.63c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.31-.61-.22l-2.49 1c-.52-.39-1.06-.73-1.69-.98l-.37-2.65A.506.506 0 0 0 14 2h-4c-.25 0-.46.18-.5.42l-.37 2.65c-.63.25-1.17.59-1.69.98l-2.49-1c-.22-.09-.49 0-.61.22l-2 3.46c-.13.22-.08.49.12.64L4.57 11c-.04.34-.07.67-.07 1 0 .33.03.65.07.97l-2.11 1.66c-.19.15-.25.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1.01c.52.4 1.06.74 1.69.99l.37 2.65c.04.24.25.42.5.42h4c.25 0 .46-.18.5-.42l.37-2.65c.63-.26 1.17-.59 1.69-.99l2.49 1.01c.22.08.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.66z"/></svg>`;
  const aboutIcon = `<svg class="nav-menu-item-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>`;
  // Theme toggle: animated sun/moon from toggles.dev by Alfie Jones (https://toggles.dev). clipPathIdSuffix avoids duplicate IDs when nav + config both have the toggle.
  const themeToggleHTML = getThemeToggleHTML(nightActive, 'nav-menu-theme-toggle', 'nav');
  const dataSourceModel = getDataSourceUIModel(getDataSourceState());
  const dataSourceMenuRow =
    '<a href="config.html#cloud-sync" class="nav-menu-item nav-menu-item--data-source" id="nav-menu-data-source" role="menuitem" title="' +
    escapeHtmlBannerAttr(dataSourceModel.title) +
    '" aria-label="' +
    escapeHtmlBannerAttr(dataSourceModel.title) +
    '"><span class="nav-menu-item-icon-wrap" id="nav-menu-data-source-icon">' +
    dataSourceModel.iconSvg +
    '</span><span data-i18n="nav.menu.dataSource">' +
    t('nav.menu.dataSource', 'Data source') +
    '</span></a>';
  const menuItems = (
    '<div class="nav-menu-dropdown" id="nav-menu-dropdown" role="menu" hidden>' +
      '<a href="about.html" class="nav-menu-item" role="menuitem"><span class="nav-menu-item-icon-wrap">' + aboutIcon + '</span><span>' + t('nav.menu.about', 'About') + '</span></a>' +
      '<a href="config.html" class="nav-menu-item" role="menuitem"><span class="nav-menu-item-icon-wrap">' + configIcon + '</span><span>' + t('nav.menu.settings', 'Settings') + '</span></a>' +
      '<div class="nav-menu-item nav-menu-theme-row" role="none"><span class="nav-menu-item-icon-wrap">' + themeToggleHTML + '</span><span>' + t('nav.menu.theme', 'Theme') + '</span></div>' +
      dataSourceMenuRow +
    '</div>'
  );
  const navRight = `<div class="nav-right nav-menu-wrap">${menuTrigger}${menuItems}</div>`;

  const appIcon =
    '<span class="nav-app-icon-wrap nav-slumby-icon-wrap" id="nav-slumby-icon-wrap">' +
    '<img src="' +
    SLUMBY_NAV_STILL_PATH +
    '" alt="" class="nav-app-icon nav-slumby-still" id="nav-slumby-still" width="36" height="36" decoding="async">' +
    '<img src="' +
    SLUMBY_NAV_GIF_IDLE_DATA_URI +
    '" alt="" class="nav-app-icon nav-slumby-gif" id="nav-slumby-gif" width="36" height="36" decoding="async" aria-hidden="true">' +
    '</span>';
  const appName = `<a href="dashboard.html" class="nav-app-block nav-app-block--stacked" title="${t('nav.tabs.dashboard', 'Dashboard')}"><span class="nav-app-name">Restore</span>${appIcon}<span class="nav-app-subtitle">${t('nav.app.subtitle', 'Sleep Tracker')}</span></a>`;
  const remainingWakeSlot = `<div class="nav-remaining-wake" id="nav-remaining-wake"></div>`;
  const headerRow = `<div class="nav-header nav-header--remaining-wake">${appName}${remainingWakeSlot}${navRight}</div>`;
  const tabsRow = `<div class="nav-tabs-row"><div class="nav-tabs">${navItems}</div></div>`;
  const branchLabel = getDevGitBranchLabel();
  const supabaseDashboardUrl = resolveSupabaseDashboardUrl();
  const devBannerDbClass = getDevBannerSupabaseDbClass();
  const devBannerOnMaster = isDevGitBranchMaster();
  const useAlertBannerBg =
    devBannerDbClass === 'nav-dev-banner--db-prod' || devBannerOnMaster;
  const devBannerBgClass = useAlertBannerBg ? 'nav-dev-banner--db-prod' : 'nav-dev-banner--db-dev';
  const clockOverrideActive = readDevClockOverrideMs() != null;
  const cloudRefreshDisabled = !getSupabaseConfig().enabled;
  // Feather-style git-branch (MIT); stroke scales with banner font size.
  const gitBranchIcon =
    '<svg class="nav-dev-banner-branch-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>';
  const githubBannerIcon =
    '<svg class="nav-dev-banner-deploy-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>';
  const vercelDeployIcon =
    '<svg class="nav-dev-banner-deploy-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 1.125 22.5 20.25H1.5L12 1.125z"/></svg>';
  const supabaseDeployIcon =
    '<svg class="nav-dev-banner-deploy-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M21.362 9.354H12V.396l9.362 8.958zM12 12.396H3.638L12 21.362v-8.966zM12 0v9.362H0V12h12v12h2.638V12H24V9.362H12V0z"/></svg>';
  const refreshIconSvg =
    '<svg class="nav-dev-banner-refresh-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>';
  const devClockGlobeIcon =
    '<svg class="nav-dev-banner-clock-mode-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="10"/>' +
    '<line x1="2" y1="12" x2="22" y2="12"/>' +
    '<path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>' +
    '</svg>';
  const devClockSimIcon =
    '<svg class="nav-dev-banner-clock-mode-icon nav-dev-banner-clock-mode-icon--sim" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<g class="nav-dev-banner-clock-sim-ghost"><circle cx="8" cy="7" r="3.5"/><path d="M4 21v-2a4 4 0 0 1 4-4h0a4 4 0 0 1 4 4v2"/></g>' +
    '<g><circle cx="15" cy="9" r="3.5"/><path d="M11 21v-2a4 4 0 0 1 4-4h0a4 4 0 0 1 4 4v2"/></g>' +
    '</svg>';
  const devClockStepIconPrevDay =
    '<svg class="nav-dev-banner-clock-step-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="4" x2="5" y2="20"/><polyline points="20 18 14 12 20 6"/><polyline points="14 18 8 12 14 6"/></svg>';
  const devClockStepIconMinusHour =
    '<svg class="nav-dev-banner-clock-step-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="18 18 12 12 18 6"/><polyline points="12 18 6 12 12 6"/></svg>';
  const devClockStepIconMinusMin =
    '<svg class="nav-dev-banner-clock-step-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="14 18 8 12 14 6"/></svg>';
  const devClockStepIconPlusMin =
    '<svg class="nav-dev-banner-clock-step-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="10 18 16 12 10 6"/></svg>';
  const devClockStepIconPlusHour =
    '<svg class="nav-dev-banner-clock-step-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 18 12 12 6 6"/><polyline points="12 18 18 12 12 6"/></svg>';
  const devClockStepIconNextDay =
    '<svg class="nav-dev-banner-clock-step-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="4 18 10 12 4 6"/><polyline points="10 18 16 12 10 6"/><line x1="19" y1="4" x2="19" y2="20"/></svg>';
  const githubBannerLink =
    '<a href="' +
    escapeHtmlBannerAttr(GITHUB_REPO_URL) +
    '" class="nav-dev-banner-deploy-link" target="_blank" rel="noopener noreferrer" title="GitHub repository" aria-label="Open GitHub repository">' +
    githubBannerIcon +
    '</a>';
  const supabaseDashboardLink =
    '<a href="' +
    escapeHtmlBannerAttr(supabaseDashboardUrl) +
    '" class="nav-dev-banner-deploy-link" target="_blank" rel="noopener noreferrer" title="Supabase dashboard" aria-label="Open Supabase dashboard">' +
    supabaseDeployIcon +
    '</a>';
  const vercelAppLink =
    '<a href="' +
    escapeHtmlBannerAttr(DEV_VERCEL_APP_URL) +
    '" class="nav-dev-banner-deploy-link nav-dev-banner-vercel-link" target="_blank" rel="noopener noreferrer" title="Open production deployment (sleep-mu.vercel.app)" aria-label="Open production deployment at sleep-mu.vercel.app">' +
    vercelDeployIcon +
    '<span class="nav-dev-banner-vercel-host">Production</span></a>';
  const vercelLabelsSep = '<span class="nav-dev-banner-vercel-sep" aria-hidden="true">   |   </span>';
  const vercelProjectLink =
    '<a href="' +
    escapeHtmlBannerAttr(DEV_VERCEL_PROJECT_URL) +
    '" class="nav-dev-banner-deploy-link nav-dev-banner-vercel-link" target="_blank" rel="noopener noreferrer" title="Vercel project dashboard" aria-label="Open Vercel project dashboard">' +
    '<span class="nav-dev-banner-vercel-host">Project</span></a>';
  const vercelIconLink = vercelAppLink + vercelLabelsSep + vercelProjectLink;
  const branchMeta = branchLabel
    ? '<span class="nav-dev-banner-branch-meta">' +
      gitBranchIcon +
      '<span class="nav-dev-banner-branch-name">' +
      escapeHtmlBannerText(branchLabel) +
      '</span></span>'
    : '';
  const devBannerBranchRow = '<div class="nav-dev-banner-branch-row">' + githubBannerLink + branchMeta + '</div>';
  const cloudRefreshDisabledAttr = cloudRefreshDisabled ? ' disabled' : '';
  const localPresets = readLocalSupabasePresets();
  const activePresetId = getActiveSupabasePresetId();
  const presetDevActiveClass = activePresetId === 'dev' ? ' nav-dev-banner-preset-btn--active' : '';
  const presetProdActiveClass = activePresetId === 'prod' ? ' nav-dev-banner-preset-btn--active' : '';
  const devBannerPresetStrip = localPresets
    ? '<div class="nav-dev-banner-preset" role="group" aria-label="Supabase project preset">' +
      '<button type="button" class="nav-dev-banner-preset-btn' +
      presetDevActiveClass +
      '" id="nav-dev-banner-preset-dev-btn" title="Use dev Supabase project" aria-label="Use dev Supabase project" aria-pressed="' +
      (activePresetId === 'dev' ? 'true' : 'false') +
      '">Dev</button>' +
      '<button type="button" class="nav-dev-banner-preset-btn' +
      presetProdActiveClass +
      '" id="nav-dev-banner-preset-prod-btn" title="Use prod Supabase project" aria-label="Use prod Supabase project" aria-pressed="' +
      (activePresetId === 'prod' ? 'true' : 'false') +
      '">Prod</button>' +
      '</div>'
    : '';
  const devBannerCloudRow =
    '<div class="nav-dev-banner-cloud-row">' +
    supabaseDashboardLink +
    devBannerPresetStrip +
    '<span class="nav-dev-banner-cloud-hint">Cloud data not synced in dev</span>' +
    '<button type="button" class="nav-dev-banner-cloud-refresh" id="nav-dev-banner-cloud-refresh-btn"' +
    cloudRefreshDisabledAttr +
    ' title="Refresh cloud data and reload page" aria-label="Refresh cloud data and reload page">' +
    refreshIconSvg +
    '<span class="nav-dev-banner-cloud-refresh-label">Refresh</span>' +
    '</button>' +
    '</div>';
  const devBannerVercelRow = '<div class="nav-dev-banner-vercel-row">' + vercelIconLink + '</div>';
  const devBannerLeftInner = devBannerBranchRow + devBannerCloudRow + devBannerVercelRow;
  let devBannerWarnings = '';
  if (devBannerDbClass === 'nav-dev-banner--db-prod') {
    devBannerWarnings += '<p class="nav-dev-banner-prod-warning">⚠️ You are using PROD data!</p>';
  }
  if (devBannerOnMaster) {
    devBannerWarnings +=
      '<p class="nav-dev-banner-prod-warning">⚠️ You are on the master branch — use a feature branch for development and testing.</p>';
  }
  const devDrawerCollapsed = readDevBannerDrawerCollapsed();
  const devBannerCollapsedClass = devDrawerCollapsed ? ' nav-dev-banner--collapsed' : '';
  const devToggleAriaExpanded = devDrawerCollapsed ? 'false' : 'true';
  const devToggleAriaLabel = devDrawerCollapsed
    ? 'Expand dev banner (drag down or tap)'
    : 'Collapse dev banner (drag up or tap)';
  const devTitleExtras =
    '<div class="nav-dev-banner-title-row">' +
    '<hr class="nav-dev-banner-title-rule" aria-hidden="true" />' +
    devBannerWarnings +
    '</div>';
  const clockRealActive = !clockOverrideActive;
  const clockRealClass = clockRealActive ? ' nav-dev-banner-clock-mode-btn--active' : '';
  const clockSimClass = clockOverrideActive ? ' nav-dev-banner-clock-mode-btn--active' : '';
  const devClockBlock =
    '<div class="nav-dev-banner-clock" role="group" aria-label="App time controls: real time or simulated override for app logic (development only)">' +
    '<span class="nav-dev-banner-clock-heading">App time controls</span>' +
    '<div class="nav-dev-banner-clock-mode" role="group" aria-label="App time source">' +
    '<button type="button" class="nav-dev-banner-clock-mode-btn' +
    clockRealClass +
    '" id="nav-dev-banner-clock-mode-real" title="Use real time" aria-label="Use real time" aria-pressed="' +
    (clockRealActive ? 'true' : 'false') +
    '">' +
    devClockGlobeIcon +
    '<span class="nav-dev-banner-clock-mode-label">Real time</span>' +
    '</button>' +
    '<button type="button" class="nav-dev-banner-clock-mode-btn' +
    clockSimClass +
    '" id="nav-dev-banner-clock-mode-sim" title="Use simulated time" aria-label="Use simulated time" aria-pressed="' +
    (clockOverrideActive ? 'true' : 'false') +
    '">' +
    '<span class="nav-dev-banner-clock-mode-label">Simulated</span>' +
    devClockSimIcon +
    '</button>' +
    '</div>' +
    '<div class="nav-dev-banner-clock-sim-panel" id="nav-dev-banner-clock-sim-panel"' +
    (clockOverrideActive ? '' : ' hidden') +
    '>' +
    '<div class="nav-dev-banner-clock-wall-row">' +
    '<input type="datetime-local" id="nav-dev-banner-dev-clock-input" class="nav-dev-banner-dev-clock-input" autocomplete="off" />' +
    '</div>' +
    '<div class="nav-dev-banner-clock-step-toolbar" role="toolbar" aria-label="Adjust simulated time">' +
    '<button type="button" class="nav-dev-banner-clock-step-btn" id="nav-dev-banner-clock-step-prev-day" title="Previous day" aria-label="Previous day">' +
    devClockStepIconPrevDay +
    '</button>' +
    '<button type="button" class="nav-dev-banner-clock-step-btn" id="nav-dev-banner-clock-step-minus-hour" title="Back one hour" aria-label="Back one hour">' +
    devClockStepIconMinusHour +
    '</button>' +
    '<button type="button" class="nav-dev-banner-clock-step-btn" id="nav-dev-banner-clock-step-minus-min" title="Back one minute" aria-label="Back one minute">' +
    devClockStepIconMinusMin +
    '</button>' +
    '<button type="button" class="nav-dev-banner-clock-step-btn" id="nav-dev-banner-clock-step-plus-min" title="Forward one minute" aria-label="Forward one minute">' +
    devClockStepIconPlusMin +
    '</button>' +
    '<button type="button" class="nav-dev-banner-clock-step-btn" id="nav-dev-banner-clock-step-plus-hour" title="Forward one hour" aria-label="Forward one hour">' +
    devClockStepIconPlusHour +
    '</button>' +
    '<button type="button" class="nav-dev-banner-clock-step-btn" id="nav-dev-banner-clock-step-next-day" title="Next day" aria-label="Next day">' +
    devClockStepIconNextDay +
    '</button>' +
    '</div>' +
    '</div>' +
    '</div>';
  const devBannerRight = '<div class="nav-dev-banner-right">' + devClockBlock + '</div>';
  const devBannerMainRow =
    '<div class="nav-dev-banner-main-row">' +
    '<div class="nav-dev-banner-left">' +
    devBannerLeftInner +
    '</div>' +
    devBannerRight +
    '</div>';
  const devBannerUserIdEsc = escapeHtmlBannerText(RESTORE_CLOUD_USER_ID);
  const devBannerUserPanel =
    '<div class="nav-dev-banner-user-panel" id="nav-dev-banner-user-panel">' +
    '<div class="nav-dev-banner-user-panel-header">' +
    '<span class="nav-dev-banner-user-panel-title-line">' +
    '<span class="nav-dev-banner-user-panel-title">User settings</span>' +
    '<span class="nav-dev-banner-user-id-paren" aria-hidden="true"> (</span>' +
    '<code class="nav-dev-banner-user-id nav-dev-banner-user-id--inline" title="RESTORE_CLOUD_USER_ID; user_settings primary key (cloud tenant)">' +
    devBannerUserIdEsc +
    '</code>' +
    '<span class="nav-dev-banner-user-id-paren" aria-hidden="true">)</span>' +
    '</span>' +
    '</div>' +
    '<div class="nav-dev-banner-user-settings" role="group" aria-label="User settings (dev; mirrors Settings and user_settings)">' +
    '<div class="nav-dev-banner-user-settings-row nav-dev-banner-user-settings-row--prefs-grid" role="group" aria-label="Display, quality, and remaining time">' +
    '<div class="nav-dev-banner-user-defaults-slot">' +
    '<button type="button" class="nav-dev-banner-user-defaults-btn" id="nav-dev-banner-user-use-default"' +
    ' aria-label="Reset user settings to app defaults">Use defaults</button>' +
    '</div>' +
    '<div class="nav-dev-banner-user-field nav-dev-banner-user-field--col nav-dev-banner-user-field--pref">' +
    '<span class="nav-dev-banner-user-label">Language</span>' +
    '<select id="nav-dev-banner-user-lang" class="nav-dev-banner-user-select nav-dev-banner-user-select--field" aria-label="Display language">' +
    '<option value="en">en</option>' +
    '<option value="ja">ja</option>' +
    '</select>' +
    '</div>' +
    '<div class="nav-dev-banner-user-field nav-dev-banner-user-field--col nav-dev-banner-user-field--pref">' +
    '<span class="nav-dev-banner-user-label">Clock</span>' +
    '<select id="nav-dev-banner-user-clock" class="nav-dev-banner-user-select nav-dev-banner-user-select--field" aria-label="Clock format">' +
    '<option value="12h">12h</option>' +
    '<option value="24h">24h</option>' +
    '</select>' +
    '</div>' +
    '<div class="nav-dev-banner-user-field nav-dev-banner-user-field--col nav-dev-banner-user-field--pref">' +
    '<span class="nav-dev-banner-user-label">Theme</span>' +
    '<select id="nav-dev-banner-user-theme" class="nav-dev-banner-user-select nav-dev-banner-user-select--field" aria-label="Theme override">' +
    '<option value="auto">Auto</option>' +
    '<option value="day">Day</option>' +
    '<option value="night">Night</option>' +
    '</select>' +
    '</div>' +
    '<div class="nav-dev-banner-user-field nav-dev-banner-user-field--col nav-dev-banner-user-field--pref">' +
    '<span class="nav-dev-banner-user-label">Palette</span>' +
    '<select id="nav-dev-banner-user-palette" class="nav-dev-banner-user-select nav-dev-banner-user-select--field" aria-label="Quality palette">' +
    '<option value="meadow">Meadow</option>' +
    '<option value="harbor">Harbor</option>' +
    '<option value="auto">Auto</option>' +
    '</select>' +
    '</div>' +
    '<div class="nav-dev-banner-user-remaining-time" role="group" aria-labelledby="nav-dev-banner-remaining-time-heading">' +
    '<span class="nav-dev-banner-user-remaining-time-heading" id="nav-dev-banner-remaining-time-heading">Remaining time</span>' +
    '<div class="nav-dev-banner-user-remaining-time-controls">' +
    '<div class="nav-dev-banner-user-field nav-dev-banner-user-field--col nav-dev-banner-user-field--rw">' +
    '<span class="nav-dev-banner-user-label nav-dev-banner-user-label--rw">' +
    '<span class="nav-dev-banner-user-emoji" aria-hidden="true">🌇</span> Winding' +
    '</span>' +
    '<span class="nav-dev-banner-user-pct-row">' +
    '<input type="number" id="nav-dev-banner-rw-open" class="nav-dev-banner-user-input-num nav-dev-banner-user-input-num--pct" min="1" max="99" step="1" aria-label="Winding: percent of wake time remaining when the active phase ends (winding begins below this)" />' +
    '<span class="nav-dev-banner-user-pct-suffix" aria-hidden="true">%</span>' +
    '</span>' +
    '</div>' +
    '<div class="nav-dev-banner-user-field nav-dev-banner-user-field--col nav-dev-banner-user-field--rw">' +
    '<span class="nav-dev-banner-user-label nav-dev-banner-user-label--rw">' +
    '<span class="nav-dev-banner-user-emoji" aria-hidden="true">🛏️</span> Pre-sleep' +
    '</span>' +
    '<span class="nav-dev-banner-user-pct-row">' +
    '<input type="number" id="nav-dev-banner-rw-winding" class="nav-dev-banner-user-input-num nav-dev-banner-user-input-num--pct" min="0" max="98" step="1" aria-label="Pre-sleep: percent of wake time remaining when winding ends (pre-sleep begins below this)" />' +
    '<span class="nav-dev-banner-user-pct-suffix" aria-hidden="true">%</span>' +
    '</span>' +
    '</div>' +
    '<div class="nav-dev-banner-user-field nav-dev-banner-user-field--col nav-dev-banner-user-field--rw">' +
    '<span class="nav-dev-banner-user-label nav-dev-banner-user-label--rw">Heads-up</span>' +
    '<select id="nav-dev-banner-rw-heads-up" class="nav-dev-banner-user-select nav-dev-banner-user-select--field nav-dev-banner-user-select--rw-compact" aria-label="Heads-up before phase change (minutes)">' +
    '<option value="60">60 min</option>' +
    '<option value="45">45 min</option>' +
    '<option value="30">30 min</option>' +
    '<option value="15">15 min</option>' +
    '<option value="0">Off</option>' +
    '</select>' +
    '</div>' +
    '</div>' +
    '</div>' +
    '</div>' +
    '</div>' +
    '</div>';
  const devTitleStrip =
    '<div class="nav-dev-banner-title-strip">' +
    '<span class="nav-dev-banner-line nav-dev-banner-title">DEV BUILD</span>' +
    '</div>';
  const devDrawerPanel =
    '<div class="nav-dev-banner-drawer" id="nav-dev-banner-drawer" role="region" aria-label="Development build details">' +
    devTitleExtras +
    devBannerMainRow +
    devBannerUserPanel +
    '</div>';
  const devDrawerHandle =
    '<button type="button" class="nav-dev-banner-drawer-handle" id="nav-dev-banner-drawer-handle"' +
    ' aria-expanded="' +
    devToggleAriaExpanded +
    '"' +
    ' aria-controls="nav-dev-banner-drawer"' +
    ' aria-label="' +
    escapeHtmlBannerAttr(devToggleAriaLabel) +
    '">' +
    '<span class="nav-dev-banner-drawer-handle-bar" aria-hidden="true"></span>' +
    '</button>';
  const devBannerBody =
    '<div class="nav-dev-banner-inner">' + devTitleStrip + devDrawerPanel + devDrawerHandle + '</div>';
  const prodSupabaseAria =
    devBannerDbClass === 'nav-dev-banner--db-prod' ? ' Using production Supabase data.' : '';
  const masterBranchAria = devBannerOnMaster ? ' Current git branch is master.' : '';
  const devBannerAlertAria = prodSupabaseAria + masterBranchAria;
  const devAria = branchLabel
    ? `Development build, branch ${escapeHtmlBannerAttr(branchLabel)}; App time controls: real or simulated.${devBannerAlertAria}`
    : `Development build; App time controls: real or simulated.${devBannerAlertAria}`;
  const devBanner = isDevBuildContext()
    ? `<div class="nav-dev-banner ${devBannerBgClass}${devBannerCollapsedClass}" role="status" aria-label="${devAria}">${devBannerBody}</div>`
    : '';
  return `<div class="nav-wrapper nav-wrapper--remaining-wake">${devBanner}${headerRow}${tabsRow}</div>`;
}

// Phase thresholds from getRemainingWakeThresholds(): open >= openMin%, winding openMin–windingMin%, pre-sleep < windingMin%.
// totalWakeMins = minutes from average get-up to average sleep (recent 7 days).
function getRemainingWakePhase(remainingMins, totalWakeMins) {
  if (totalWakeMins <= 0) return 'open';
  const percentRemaining = Math.min(100, (remainingMins / totalWakeMins) * 100);
  const { openMin, windingMin } = getRemainingWakeThresholds();
  if (percentRemaining >= openMin) return 'open';
  if (percentRemaining >= windingMin) return 'winding';
  return 'presleep';
}

function getRemainingWakeIcon(phase) {
  switch (phase) {
    case 'open': return '☀️';
    case 'winding': return '🌇';
    case 'presleep': return '🛏️';
    case 'sleep': return '🌙';
    default: return '☀️';
  }
}

/**
 * Minutes until the next percent-threshold phase (open→winding or winding→pre-sleep), for nav heads-up.
 * Returns { icon, minutes, nextPhase } or null.
 */
function computeRemainingWakePhaseHeadsUp(phase, remainingMins, totalWakeMins) {
  const windowMins = getRemainingWakePhaseHeadsUpMinutes();
  if (
    windowMins <= 0 ||
    !Number.isFinite(remainingMins) ||
    !Number.isFinite(totalWakeMins) ||
    totalWakeMins <= 0
  ) {
    return null;
  }
  const { openMin, windingMin } = getRemainingWakeThresholds();
  let boundaryRem;
  let nextPhase;
  if (phase === 'open') {
    boundaryRem = (totalWakeMins * openMin) / 100;
    nextPhase = 'winding';
  } else if (phase === 'winding') {
    boundaryRem = (totalWakeMins * windingMin) / 100;
    nextPhase = 'presleep';
  } else {
    return null;
  }
  const n = Math.max(0, Math.ceil(remainingMins - boundaryRem));
  if (n <= 0 || n > windowMins) return null;
  return {
    icon: getRemainingWakeIcon(nextPhase),
    minutes: n,
    nextPhase
  };
}

/**
 * After average sleep time (same evening) or before average wake (early morning), we are outside
 * the main wake window — avoid wrapping minutes-until-sleep to ~24h.
 * Skipped when wake and sleep order is atypical (wake >= sleep on the clock).
 */
function shouldShowGoToBedSoonWakeNav(nowMins, wakeMins, sleepMins) {
  if (!Number.isFinite(nowMins) || !Number.isFinite(wakeMins) || !Number.isFinite(sleepMins)) {
    return false;
  }
  if (wakeMins >= sleepMins) return false;
  return nowMins > sleepMins || nowMins < wakeMins;
}

/** Build remaining-wake display from a computed wake basis. Pass `days` for dynamic sleep phase and wake flags. */
function getRemainingWakeDisplayFromBasis(basis, days) {
  if (!basis || basis.totalWakeMins <= 0) return null;
  const { avgSleepStart, avgSleepEnd, totalWakeMins } = basis;
  const now = getAppDate();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const nightMd = recordDateMdForSleepPeriod(now, avgSleepEnd);

  if (days && days.length && shouldShowDynamicSleepNavPhase(days, basis, now, nightMd)) {
    return {
      phase: 'sleep',
      icon: getRemainingWakeIcon('sleep'),
      timeLabel: 'sweet dreams',
      timeLabelSoft: true,
      percentRemaining: null
    };
  }

  if (shouldShowGoToBedSoonWakeNav(nowMins, avgSleepEnd, avgSleepStart)) {
    if (!(days && days.length && isNightWakeLogged(nightMd))) {
      const phase = getRemainingWakePhase(0, totalWakeMins);
      const icon = getRemainingWakeIcon(phase);
      return {
        phase,
        icon,
        timeLabel: 'go to bed soon',
        timeLabelSoft: true,
        percentRemaining: 0
      };
    }
  }
  const remainingMins = avgSleepStart >= nowMins ? avgSleepStart - nowMins : 1440 - nowMins + avgSleepStart;
  const phase = getRemainingWakePhase(remainingMins, totalWakeMins);
  const icon = getRemainingWakeIcon(phase);
  const timeLabel = formatDuration(Math.round(remainingMins));
  const percentRemaining = totalWakeMins > 0
    ? Math.min(100, Math.max(0, (remainingMins / totalWakeMins) * 100))
    : 100;
  const phaseHeadsUp = computeRemainingWakePhaseHeadsUp(phase, remainingMins, totalWakeMins);
  return { phase, icon, timeLabel, percentRemaining, phaseHeadsUp };
}

/** Returns { phase, icon, timeLabel, percentRemaining } from raw days (used when daily.js not loaded).
 * Recent 7 days: average get-up and fell-asleep; phase uses minutes-until-sleep vs that wake-window length. */
function getRemainingWakeDisplayFromDays(days) {
  if (!days || days.length === 0) return null;
  const basis = getEffectiveRemainingWakeBasis(days);
  return getRemainingWakeDisplayFromBasis(basis, days);
}

/** Injects remaining wake into nav and sets phase class on wrapper. */
function updateRemainingWakeNav(display) {
  if (!display) return;
  const slot = document.getElementById('nav-remaining-wake');
  const wrapper = document.querySelector('.nav-wrapper');
  if (slot) {
    const { openMin, windingMin } = getRemainingWakeThresholds();
    const p1 = 100 - openMin;
    const p2 = 100 - windingMin;
    const progress = typeof display.percentRemaining === 'number'
      ? Math.min(100, Math.max(0, 100 - display.percentRemaining))
      : null;
    const progressBar = progress === null
      ? ''
      : `<span class="nav-remaining-wake-progress nav-remaining-wake-progress--${display.phase}" aria-hidden="true" style="--nav-rw-p1:${p1}%;--nav-rw-p2:${p2}%;--nav-rw-progress:${progress}%"><span class="nav-remaining-wake-progress-track"></span><span class="nav-remaining-wake-progress-fill"></span></span>`;
    const timeClass =
      'nav-remaining-wake-time' +
      (display.timeLabelSoft ? ' nav-remaining-wake-time--soft' : '');
    let ariaLabel = 'Remaining wake time';
    if (display.phase === 'sleep') {
      ariaLabel = 'Sweet dreams';
    } else if (display.timeLabelSoft && display.phase === 'presleep') {
      ariaLabel = 'Go to bed soon';
    } else if (display.timeLabelSoft) {
      ariaLabel = display.timeLabel || 'Go to bed soon';
    }
    const hu = display.phaseHeadsUp;
    if (hu && hu.minutes > 0) {
      const ariaExtra =
        hu.nextPhase === 'winding'
          ? t(
              'config.remainingWake.headsUpAriaWinding',
              'Winding down in {minutes} minutes'
            ).replace('{minutes}', String(hu.minutes))
          : t(
              'config.remainingWake.headsUpAriaPresleep',
              'Pre-sleep in {minutes} minutes'
            ).replace('{minutes}', String(hu.minutes));
      ariaLabel = ariaLabel + '. ' + ariaExtra;
    }
    const headsUpHtml =
      hu && hu.minutes > 0
        ? `<span class="nav-remaining-wake-phase-heads-up" aria-hidden="true">${hu.icon} in ${hu.minutes}m</span>`
        : '';
    const ariaEsc = escapeHtmlBannerAttr(ariaLabel);
    slot.innerHTML =
      `<a href="about.html#remaining-wake-time" class="nav-remaining-wake-link" title="${ariaEsc}" aria-label="${ariaEsc}"><span class="nav-remaining-wake-main"><span class="nav-remaining-wake-icon" aria-hidden="true">${display.icon}</span><span class="${timeClass}">${display.timeLabel}</span>${headsUpHtml}</span>${progressBar}</a>`;
  }
  if (wrapper) {
    wrapper.classList.remove(
      'nav-wrapper--phase-open',
      'nav-wrapper--phase-winding',
      'nav-wrapper--phase-presleep',
      'nav-wrapper--phase-sleep'
    );
    wrapper.classList.add('nav-wrapper--phase-' + display.phase);
  }
}

/**
 * Fetches sleep data and fills remaining wake in nav. Call on every page so header is consistent.
 * @param {{ interval?: boolean }} [options] — pass `{ interval: false }` when the page already refreshes the nav (e.g. log) or to avoid racing before `nav-container` is filled (dashboard runs load before inline nav render).
 */
function scheduleNextNavSlumbyBounce() {
  if (typeof window === 'undefined') return;
  var schedKey = '__sleepAppNavSlumbyScheduleTimer';
  if (window[schedKey]) {
    clearTimeout(window[schedKey]);
    window[schedKey] = null;
  }
  var minMs = 10000;
  var maxMs = 35000;
  var delay = minMs + Math.random() * (maxMs - minMs);
  window[schedKey] = setTimeout(function () {
    window[schedKey] = null;
    playNavSlumbyBounce();
  }, delay);
}

function playNavSlumbyBounce() {
  if (typeof document === 'undefined') return;
  var wrap = document.getElementById('nav-slumby-icon-wrap');
  var gifEl = document.getElementById('nav-slumby-gif');
  if (!wrap || !gifEl) {
    scheduleNextNavSlumbyBounce();
    return;
  }
  var endKey = '__sleepAppNavSlumbyEndTimer';
  if (typeof window !== 'undefined' && window[endKey]) {
    clearTimeout(window[endKey]);
    window[endKey] = null;
  }
  gifEl.src = SLUMBY_NAV_GIF_PATH + '?t=' + Date.now();
  wrap.classList.add('nav-slumby-icon-wrap--animating');
  if (typeof window === 'undefined') return;
  window[endKey] = setTimeout(function () {
    window[endKey] = null;
    wrap.classList.remove('nav-slumby-icon-wrap--animating');
    gifEl.src = SLUMBY_NAV_GIF_IDLE_DATA_URI;
    scheduleNextNavSlumbyBounce();
  }, SLUMBY_NAV_BOUNCE_MS);
}

/** Random intermittent Slumby bounce in the main nav (still PNG + overlay GIF). */
function initNavSlumbyBounce() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  var schedKey = '__sleepAppNavSlumbyScheduleTimer';
  var endKey = '__sleepAppNavSlumbyEndTimer';
  if (window[schedKey]) {
    clearTimeout(window[schedKey]);
    window[schedKey] = null;
  }
  if (window[endKey]) {
    clearTimeout(window[endKey]);
    window[endKey] = null;
  }
  if (!document.getElementById('nav-slumby-icon-wrap')) return;
  scheduleNextNavSlumbyBounce();
}

function initRemainingWakeNav(options) {
  const runInterval = !options || options.interval !== false;
  const timerKey = '__sleepAppRemainingWakeNavTimer';
  if (typeof window !== 'undefined' && window[timerKey]) {
    clearInterval(window[timerKey]);
    window[timerKey] = null;
  }
  loadSleepData()
    .then(data => {
      const days = Array.isArray(data.days) ? data.days : [];
      const basis = getEffectiveRemainingWakeBasis(days);
      updateRemainingWakeNav(getRemainingWakeDisplayFromBasis(basis, days));
      if (runInterval && typeof window !== 'undefined') {
        window[timerKey] = setInterval(function () {
          updateRemainingWakeNav(getRemainingWakeDisplayFromBasis(basis, days));
        }, 60000);
      }
    })
    .catch(() => {});
}

/**
 * Show the shared day-panel popup with bed, sleep, get up, and sleep duration.
 * point: { dateString, bedTimeString, sleepStartString, getUpString, sleepDurationMinutes, mainSleepMinutes?, napMinutes? }
 * Position is derived from clientX/clientY, flipping to stay on screen.
 */
function showDayPanel(point, clientX, clientY) {
  const dayPanel = document.getElementById('day-panel');
  if (!dayPanel) return;
  const sleepDuration = formatDuration(point.sleepDurationMinutes);
  const mainSleep = formatDuration(point.mainSleepMinutes != null ? point.mainSleepMinutes : point.sleepDurationMinutes);
  const napText = (point.napMinutes != null && point.napMinutes > 0) ? ` (${mainSleep} + ${formatDuration(point.napMinutes)} nap)` : '';
  dayPanel.innerHTML = `
    <div class="day-panel-header">${formatSleepDateMonthDay(point.dateString)}</div>
    <div class="day-panel-row">
      <span class="day-panel-label bedtime">bed:</span>
      <span class="day-panel-value">${point.bedTimeString}</span>
    </div>
    <div class="day-panel-row">
      <span class="day-panel-label sleep-start">sleep:</span>
      <span class="day-panel-value">${point.sleepStartString}</span>
    </div>
    <div class="day-panel-row">
      <span class="day-panel-label getup">get up:</span>
      <span class="day-panel-value">${point.getUpString}</span>
    </div>
    <div class="day-panel-row">
      <span class="day-panel-label">sleep duration:</span>
      <span class="day-panel-value">${sleepDuration}${napText}</span>
    </div>
  `;
  const panelWidth = 200;
  const panelHeight = 140;
  let left = clientX + 12;
  let top = clientY - 10;
  if (left + panelWidth > window.innerWidth - 20) left = clientX - panelWidth - 12;
  if (top < 20) top = 20;
  if (top + panelHeight > window.innerHeight - 20) top = window.innerHeight - panelHeight - 20;
  dayPanel.style.left = left + 'px';
  dayPanel.style.top = top + 'px';
  dayPanel.classList.add('visible');
}

function hideDayPanel() {
  const dayPanel = document.getElementById('day-panel');
  if (dayPanel) dayPanel.classList.remove('visible');
}