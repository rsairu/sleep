/**
 * Localization / i18n runtime: locale preference, dictionary loading, t(), and DOM application.
 * Self-contained — no dependency on sleep-utils. Loaded before sleep-utils.js.
 * Reference doc: docs/localization.md.
 */
(function (root) {
  'use strict';

  const LANGUAGE_KEY = 'sleep-app-language';
  const DEFAULT_LANGUAGE = 'en';
  const LOCALE_DICTIONARY_URL = 'locales.json';
  const SUPPORTED_LANGUAGES = ['en', 'ja'];

  let localeDictionaryCache = null;
  let localeDictionaryPromise = null;

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
    if (typeof syncUserSettingsRowToCloud === 'function') syncUserSettingsRowToCloud();
    if (typeof updateDevBannerUserSettingsPanel === 'function') updateDevBannerUserSettingsPanel();
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

  function applyTranslations(rootNode) {
    const base = rootNode || (typeof document !== 'undefined' ? document : null);
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

  async function initI18n(rootNode) {
    await loadLocaleDictionary();
    const language = getLanguagePreference();
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.setAttribute('lang', language);
    }
    applyTranslations(rootNode || (typeof document !== 'undefined' ? document : null));
    return language;
  }

  root.LANGUAGE_KEY = LANGUAGE_KEY;
  root.DEFAULT_LANGUAGE = DEFAULT_LANGUAGE;
  root.SUPPORTED_LANGUAGES = SUPPORTED_LANGUAGES;
  root.normalizeLanguage = normalizeLanguage;
  root.getLanguagePreference = getLanguagePreference;
  root.setLanguagePreference = setLanguagePreference;
  root.getLocalizedValue = getLocalizedValue;
  root.t = t;
  root.loadLocaleDictionary = loadLocaleDictionary;
  root.applyTranslations = applyTranslations;
  root.initI18n = initI18n;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
