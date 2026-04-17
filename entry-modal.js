// Night entry form: document-level handlers; log page (full panel) or legacy pull-down drawer if present.
(function () {
  let quickAddOptions = {};
  let quickAddHostBound = false;
  let quickAddDateLoadSeq = 0;
  /** Last loaded main times per dateMd for QA flags (bed / sleep / wake) after save. */
  let quickAddInitialSnapshot = null;

  /** `YYYY-MM-DD` for `<input type="date">` from stored sleep key (ISO only). */
  function sleepDateKeyToDateInputValue(key) {
    if (!key || typeof key !== 'string') return '';
    const iso = normalizeSleepDateKey(key);
    return iso || '';
  }

  function dateInputValueToSleepDateKey(value) {
    if (!value || typeof value !== 'string') return '';
    const t = value.trim();
    const iso = normalizeSleepDateKey(t);
    if (iso) return iso;
    const d = new Date(t + 'T00:00:00');
    if (Number.isNaN(d.getTime())) return '';
    return formatIsoDateFromLocalDate(d);
  }

  /** Calendar date for the night row: tomorrow in pre-sleep or dynamic sleep phase, else today. */
  function getQuickAddDefaultNightDate() {
    const wrapper = document.querySelector('.nav-wrapper');
    const presleep = wrapper && wrapper.classList.contains('nav-wrapper--phase-presleep');
    const inSleepPhase = wrapper && wrapper.classList.contains('nav-wrapper--phase-sleep');
    const d = getAppDate();
    if (presleep || inSleepPhase) d.setDate(d.getDate() + 1);
    return d;
  }

  function quickAddPresetDateInputValue() {
    return formatIsoDateFromLocalDate(getQuickAddDefaultNightDate());
  }

  function normalizeTime(value) {
    const v = String(value || '').trim();
    const match = v.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
    if (!match) return null;
    return String(Number(match[1])) + ':' + match[2];
  }

  /** `<input type="time">` value is HH:MM (24h). */
  function timeInputValueToNormalized(val) {
    if (val === undefined || val === null) return null;
    const s = String(val).trim();
    if (!s) return null;
    const m = s.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    return normalizeTime(m[1] + ':' + m[2]);
  }

  function setQuickAddStatus(text, isError) {
    const el = document.getElementById('quick-add-status');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('quick-add-status--error', Boolean(isError));
  }

  function setDrawerExpanded(expanded) {
    const drawer = document.getElementById('quick-add-drawer');
    const handle = document.getElementById('quick-add-drawer-handle');
    if (!drawer || drawer.classList.contains('quick-add-drawer--page') || !handle) return;
    drawer.classList.toggle('is-expanded', expanded);
    handle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  }

  function syncQuickAddTimeListRemoveButtons(listEl) {
    if (!listEl) return;
    const rows = listEl.querySelectorAll('.quick-add-time-row');
    const showRemove = rows.length > 1;
    for (let i = 0; i < rows.length; i++) {
      const btn = rows[i].querySelector('.quick-add-time-remove');
      if (!btn) continue;
      btn.hidden = !showRemove;
      btn.setAttribute('aria-hidden', showRemove ? 'false' : 'true');
    }
  }

  function appendQuickAddTimeRow(listEl) {
    if (!listEl) return;
    const row = document.createElement('div');
    row.className = 'quick-add-time-row';
    row.innerHTML =
      '<input type="time" step="60" class="quick-add-input quick-add-time-native" value="">' +
      '<div class="quick-add-time-spin">' +
      '<button type="button" class="quick-add-time-spin-btn quick-add-time-spin-btn--up" aria-label="One minute later">▲</button>' +
      '<button type="button" class="quick-add-time-spin-btn quick-add-time-spin-btn--down" aria-label="One minute earlier">▼</button>' +
      '</div>' +
      '<button type="button" class="quick-add-time-remove" aria-label="Remove time">×</button>';
    listEl.appendChild(row);
    syncQuickAddTimeListRemoveButtons(listEl);
  }

  function initQuickAddDynamicTimeLists() {
    const bath = document.getElementById('quick-add-bathroom-list');
    if (bath) {
      bath.innerHTML = '';
      appendQuickAddTimeRow(bath);
    }
    const alarm = document.getElementById('quick-add-alarm-list');
    if (alarm) {
      alarm.innerHTML = '';
      appendQuickAddTimeRow(alarm);
    }
  }

  function collectNormalizedTimesFromList(listRoot) {
    if (!listRoot) return [];
    const inputs = listRoot.querySelectorAll('.quick-add-time-native');
    const out = [];
    for (let i = 0; i < inputs.length; i++) {
      const n = timeInputValueToNormalized(inputs[i].value);
      if (n) out.push(n);
    }
    return out;
  }

  function quickAddStepTimeMinutes(input, deltaMinutes) {
    if (!input) return;
    let mins;
    const v = input.value;
    if (v && String(v).trim()) {
      const p = String(v).trim().split(':');
      mins = Number(p[0]) * 60 + Number(p[1]);
      if (!Number.isFinite(mins)) mins = 7 * 60;
    } else {
      mins = 7 * 60;
    }
    mins = ((mins + deltaMinutes) % 1440 + 1440) % 1440;
    const h = Math.floor(mins / 60);
    const mm = mins % 60;
    input.value = String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
  }

  function onQuickAddRemoveTimeRow(btn) {
    const row = btn.closest('.quick-add-time-row');
    const list = row && row.parentElement;
    if (!row || !list) return;
    const rows = list.querySelectorAll('.quick-add-time-row');
    if (rows.length <= 1) return;
    row.remove();
    syncQuickAddTimeListRemoveButtons(list);
  }

  function applyInitialMainTimesFromFormDataset() {
    const form = document.getElementById('quick-add-form');
    if (!form || !form.dataset) return;
    const bedEl = document.getElementById('quick-add-bed');
    const sleepEl = document.getElementById('quick-add-sleep');
    const wakeEl = document.getElementById('quick-add-wake');
    if (bedEl && form.dataset.initialBed) bedEl.value = form.dataset.initialBed;
    if (sleepEl && form.dataset.initialSleep) sleepEl.value = form.dataset.initialSleep;
    if (wakeEl && form.dataset.initialWake) wakeEl.value = form.dataset.initialWake;
  }

  function resetQuickAddFormToDefaults() {
    const dateInput = document.getElementById('quick-add-date');
    if (dateInput) dateInput.value = quickAddPresetDateInputValue();
    initQuickAddDynamicTimeLists();
    applyInitialMainTimesFromFormDataset();

    const napS = document.getElementById('quick-add-nap-start');
    const napE = document.getElementById('quick-add-nap-end');
    if (napS) napS.value = '';
    if (napE) napE.value = '';
    const waso = document.getElementById('quick-add-waso');
    if (waso) waso.value = '0';
    syncQuickAddLabelToggles([]);
    setQuickAddStatus('', false);
  }

  function clearQuickAddFormEntirely() {
    const dateInput = document.getElementById('quick-add-date');
    if (dateInput) dateInput.value = quickAddPresetDateInputValue();
    const bedEl = document.getElementById('quick-add-bed');
    const sleepEl = document.getElementById('quick-add-sleep');
    const wakeEl = document.getElementById('quick-add-wake');
    if (bedEl) bedEl.value = '';
    if (sleepEl) sleepEl.value = '';
    if (wakeEl) wakeEl.value = '';
    initQuickAddDynamicTimeLists();
    const napS = document.getElementById('quick-add-nap-start');
    const napE = document.getElementById('quick-add-nap-end');
    if (napS) napS.value = '';
    if (napE) napE.value = '';
    const waso = document.getElementById('quick-add-waso');
    if (waso) waso.value = '';
    syncQuickAddLabelToggles([]);
    setQuickAddStatus('', false);
  }

  function closeQuickAddDrawer() {
    setDrawerExpanded(false);
    resetQuickAddFormToDefaults();
  }

  function escapeLabelAttr(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');
  }

  function ensureQuickAddLabelChipsRendered() {
    const host = document.getElementById('quick-add-label-chips');
    if (!host || typeof SLEEP_DAY_LABEL_OPTIONS === 'undefined') return;
    if (host.getAttribute('data-chips-rendered') === '1') return;
    host.setAttribute('data-chips-rendered', '1');
    host.innerHTML = SLEEP_DAY_LABEL_OPTIONS.map(function (opt) {
      const tit = escapeLabelAttr(opt.title);
      return (
        '<button type="button" class="sleep-day-label-toggle" data-emoji="' +
        opt.emoji +
        '" aria-pressed="false" aria-label="' +
        tit +
        '" title="' +
        tit +
        '"><span class="sleep-day-label-toggle__emoji" aria-hidden="true">' +
        opt.emoji +
        '</span></button>'
      );
    }).join('');
  }

  function syncQuickAddLabelToggles(labels) {
    const host = document.getElementById('quick-add-label-chips');
    if (!host) return;
    const set = {};
    for (let i = 0; i < labels.length; i++) set[labels[i]] = true;
    const btns = host.querySelectorAll('.sleep-day-label-toggle');
    for (let j = 0; j < btns.length; j++) {
      const btn = btns[j];
      const e = btn.getAttribute('data-emoji');
      const on = Boolean(e && set[e]);
      btn.classList.toggle('is-pressed', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  function labelsFromRecord(record) {
    if (typeof normalizeSleepDayLabels === 'function') {
      return normalizeSleepDayLabels(record && record.labels);
    }
    return Array.isArray(record && record.labels) ? record.labels : [];
  }

  function collectQuickAddLabelsFromDom() {
    const host = document.getElementById('quick-add-label-chips');
    if (!host) return [];
    const out = [];
    const pressed = host.querySelectorAll('.sleep-day-label-toggle.is-pressed');
    for (let i = 0; i < pressed.length; i++) {
      const e = pressed[i].getAttribute('data-emoji');
      if (e) out.push(e);
    }
    return typeof normalizeSleepDayLabels === 'function' ? normalizeSleepDayLabels(out) : out;
  }

  function wireQuickAddDrawerSliders() {
    const form = document.getElementById('quick-add-form');
    if (!form || !document.getElementById('quick-add-bed')) return;

    const dateInput = document.getElementById('quick-add-date');
    if (dateInput) dateInput.value = quickAddPresetDateInputValue();
    initQuickAddDynamicTimeLists();
    ensureQuickAddLabelChipsRendered();

    const waso = document.getElementById('quick-add-waso');
    if (waso && (waso.value === '' || waso.value === null)) waso.value = '0';
  }

  function normalizedTimesToFormattedWallClock(normList) {
    const out = [];
    for (let i = 0; i < normList.length; i++) {
      const m = timeToMinutes(normList[i]);
      if (Number.isFinite(m)) out.push(formatTime(m));
    }
    return out;
  }

  function toTimeInputValue(wallClock) {
    const m = timeToMinutes(wallClock);
    if (!Number.isFinite(m)) return '';
    return formatMinutesTo24hString(m);
  }

  function setQuickAddTimeListFromWallClock(listId, values) {
    const list = document.getElementById(listId);
    if (!list) return;
    list.innerHTML = '';
    const entries = Array.isArray(values) && values.length ? values : [''];
    for (let i = 0; i < entries.length; i++) {
      appendQuickAddTimeRow(list);
      const rows = list.querySelectorAll('.quick-add-time-row');
      const row = rows[rows.length - 1];
      const inp = row && row.querySelector('.quick-add-time-native');
      if (inp) inp.value = toTimeInputValue(entries[i]);
    }
    syncQuickAddTimeListRemoveButtons(list);
  }

  function wallClockFromRecordField(value) {
    if (value == null || value === '') return null;
    const m = timeToMinutes(value);
    return Number.isFinite(m) ? formatTime(m) : null;
  }

  function wallClockFromTimeInput(el) {
    if (!el || !el.value) return null;
    const m = timeToMinutes(el.value);
    return Number.isFinite(m) ? formatTime(m) : null;
  }

  function applyRecordToQuickAddForm(dateMd, record) {
    const dateInput = document.getElementById('quick-add-date');
    if (dateInput && dateMd) dateInput.value = sleepDateKeyToDateInputValue(dateMd);

    const bedEl = document.getElementById('quick-add-bed');
    const sleepEl = document.getElementById('quick-add-sleep');
    const wakeEl = document.getElementById('quick-add-wake');
    const napS = document.getElementById('quick-add-nap-start');
    const napE = document.getElementById('quick-add-nap-end');
    const waso = document.getElementById('quick-add-waso');

    if (!record) {
      initQuickAddDynamicTimeLists();
      applyInitialMainTimesFromFormDataset();
      if (napS) napS.value = '';
      if (napE) napE.value = '';
      if (waso) waso.value = '0';
      ensureQuickAddLabelChipsRendered();
      syncQuickAddLabelToggles([]);
      if (dateMd) {
        quickAddInitialSnapshot = {
          dateMd: dateMd,
          bed: wallClockFromTimeInput(bedEl),
          sleepStart: wallClockFromTimeInput(sleepEl),
          sleepEnd: wallClockFromTimeInput(wakeEl)
        };
      }
      return;
    }

    if (bedEl) bedEl.value = toTimeInputValue(record.bed);
    if (sleepEl) sleepEl.value = toTimeInputValue(record.sleepStart);
    if (wakeEl) wakeEl.value = toTimeInputValue(record.sleepEnd);
    setQuickAddTimeListFromWallClock('quick-add-bathroom-list', record.bathroom || []);
    setQuickAddTimeListFromWallClock('quick-add-alarm-list', record.alarm || []);
    if (napS) napS.value = toTimeInputValue(record.nap && record.nap.start);
    if (napE) napE.value = toTimeInputValue(record.nap && record.nap.end);
    if (waso) waso.value = String(Number.isFinite(record.WASO) ? Math.max(0, Math.floor(record.WASO)) : 0);
    ensureQuickAddLabelChipsRendered();
    syncQuickAddLabelToggles(labelsFromRecord(record));
    if (dateMd) {
      quickAddInitialSnapshot = {
        dateMd: dateMd,
        bed: wallClockFromRecordField(record.bed),
        sleepStart: wallClockFromRecordField(record.sleepStart),
        sleepEnd: wallClockFromRecordField(record.sleepEnd)
      };
    }
  }

  function loadQuickAddFormForDate(dateMd) {
    if (!dateMd) return Promise.resolve();
    const seq = ++quickAddDateLoadSeq;
    return Promise.all([
      getSleepDayByDate(dateMd).catch(function () { return null; }),
      getSleepDraftByDate(dateMd).catch(function () { return null; })
    ]).then(function (results) {
      if (seq !== quickAddDateLoadSeq) return null;
      const canonical = results[0];
      const draft = results[1];
      applyRecordToQuickAddForm(dateMd, canonical || draft || null);
      return null;
    }).catch(function () {
      if (seq !== quickAddDateLoadSeq) return null;
      applyRecordToQuickAddForm(dateMd, null);
      return null;
    });
  }

  function handleSubmit(event) {
    event.preventDefault();
    const dateMd = dateInputValueToSleepDateKey(document.getElementById('quick-add-date').value);

    const bedEl = document.getElementById('quick-add-bed');
    const sleepEl = document.getElementById('quick-add-sleep');
    const wakeEl = document.getElementById('quick-add-wake');
    const bedRaw = bedEl && bedEl.value;
    const sleepRaw = sleepEl && sleepEl.value;
    const wakeRaw = wakeEl && wakeEl.value;

    const bedM = bedRaw ? timeToMinutes(bedRaw) : NaN;
    const sleepM = sleepRaw ? timeToMinutes(sleepRaw) : NaN;
    const wakeM = wakeRaw ? timeToMinutes(wakeRaw) : NaN;

    const bed = Number.isFinite(bedM) ? formatTime(bedM) : null;
    const sleepStart = Number.isFinite(sleepM) ? formatTime(sleepM) : null;
    const sleepEnd = Number.isFinite(wakeM) ? formatTime(wakeM) : null;

    const bathroomNorms = collectNormalizedTimesFromList(document.getElementById('quick-add-bathroom-list'));
    const bathroom = normalizedTimesToFormattedWallClock(bathroomNorms);

    const alarmNorms = collectNormalizedTimesFromList(document.getElementById('quick-add-alarm-list'));
    const alarm = normalizedTimesToFormattedWallClock(alarmNorms);

    const napStartRaw = document.getElementById('quick-add-nap-start').value;
    const napEndRaw = document.getElementById('quick-add-nap-end').value;
    const napStart = napStartRaw ? timeInputValueToNormalized(napStartRaw) : null;
    const napEnd = napEndRaw ? timeInputValueToNormalized(napEndRaw) : null;
    const wasoRaw = document.getElementById('quick-add-waso').value;
    const wasoTrim = (wasoRaw != null ? String(wasoRaw) : '').trim();

    if (!dateMd) {
      setQuickAddStatus(typeof t === 'function' ? t('log.errorPickDate', 'Pick a valid date.') : 'Pick a valid date.', true);
      return;
    }
    if ((napStart && !napEnd) || (!napStart && napEnd)) {
      setQuickAddStatus('Enter both nap start and nap end, or leave both blank.', true);
      return;
    }
    if ((napStartRaw || napEndRaw) && (!napStart || !napEnd)) {
      setQuickAddStatus('Nap times must be valid (use the time picker or adjust with − / +).', true);
      return;
    }
    if (wasoTrim !== '') {
      const wasoNum = Number(wasoTrim);
      if (!Number.isFinite(wasoNum) || wasoNum < 0 || Math.floor(wasoNum) !== wasoNum) {
        setQuickAddStatus('WASO must be a whole number 0 or greater.', true);
        return;
      }
    }

    const partial = {};
    if (bed) partial.bed = bed;
    if (sleepStart) partial.sleepStart = sleepStart;
    if (sleepEnd) partial.sleepEnd = sleepEnd;
    if (bathroom.length) partial.bathroom = bathroom;
    if (alarm.length) partial.alarm = alarm;
    if (napStart && napEnd) partial.nap = { start: napStart, end: napEnd };
    if (wasoTrim !== '') partial.WASO = Math.floor(Number(wasoTrim));

    const labelsSelected = collectQuickAddLabelsFromDom();
    partial.labels = labelsSelected;

    const hasOther =
      Boolean(bed) ||
      Boolean(sleepStart) ||
      Boolean(sleepEnd) ||
      bathroom.length > 0 ||
      alarm.length > 0 ||
      Boolean(napStart && napEnd) ||
      wasoTrim !== '';
    if (!hasOther && labelsSelected.length === 0) {
      setQuickAddStatus(
        typeof t === 'function'
          ? t('log.errorNeedField', 'Pick a date and add at least one field or night note to save.')
          : 'Pick a date and add at least one field or night note to save.',
        true
      );
      return;
    }

    const saveBtn = document.getElementById('quick-add-save');
    if (saveBtn) saveBtn.disabled = true;
    setQuickAddStatus('Saving...', false);

    saveDraftAndMaybePromote(dateMd, partial)
      .then(function () {
        const snap = quickAddInitialSnapshot;
        if (
          snap &&
          snap.dateMd === dateMd &&
          typeof markNightQaSleepFlag === 'function'
        ) {
          if (bed && bed !== snap.bed) markNightQaSleepFlag(dateMd, 'bed');
          if (sleepStart && sleepStart !== snap.sleepStart) markNightQaSleepFlag(dateMd, 'sleep');
          if (sleepEnd && sleepEnd !== snap.sleepEnd) markNightQaSleepFlag(dateMd, 'wake');
        }
        setQuickAddStatus('Saved.', false);
        const drawerEl = document.getElementById('quick-add-drawer');
        const isLogPage = drawerEl && drawerEl.classList.contains('quick-add-drawer--page');
        if (!isLogPage) {
          closeQuickAddDrawer();
        }
        if (quickAddOptions && typeof quickAddOptions.onSaved === 'function') {
          return quickAddOptions.onSaved();
        }
        return null;
      })
      .catch(function (error) {
        console.error(error);
        setQuickAddStatus(error && error.message ? error.message : 'Could not save. Check Settings and try again.', true);
      })
      .finally(function () {
        if (saveBtn) saveBtn.disabled = false;
      });
  }

  function bindQuickAddHostOnce() {
    if (quickAddHostBound) return;
    quickAddHostBound = true;
    document.addEventListener('submit', function (e) {
      const t = e.target;
      if (t && t.id === 'quick-add-form') handleSubmit(e);
    });
    document.addEventListener('click', function (e) {
      const t = e.target;
      if (!t) return;
      const form = t.closest && t.closest('#quick-add-form');
      if (!form) return;

      const cancelBtn = t.closest && t.closest('#quick-add-cancel');
      if (cancelBtn && form.contains(cancelBtn)) {
        e.preventDefault();
        closeQuickAddDrawer();
        return;
      }

      const clearAllBtn = t.closest && t.closest('#quick-add-clear-all');
      if (clearAllBtn && form.contains(clearAllBtn)) {
        e.preventDefault();
        clearQuickAddFormEntirely();
        return;
      }

      const bathAdd = t.closest && t.closest('#quick-add-bathroom-add');
      if (bathAdd && form.contains(bathAdd)) {
        e.preventDefault();
        appendQuickAddTimeRow(document.getElementById('quick-add-bathroom-list'));
        return;
      }

      const alarmAdd = t.closest && t.closest('#quick-add-alarm-add');
      if (alarmAdd && form.contains(alarmAdd)) {
        e.preventDefault();
        appendQuickAddTimeRow(document.getElementById('quick-add-alarm-list'));
        return;
      }

      const rm = t.closest && t.closest('.quick-add-time-remove');
      if (rm && form.contains(rm)) {
        e.preventDefault();
        onQuickAddRemoveTimeRow(rm);
        return;
      }

      const labelBtn = t.closest && t.closest('.sleep-day-label-toggle');
      if (labelBtn && form.contains(labelBtn)) {
        e.preventDefault();
        const nowOn = labelBtn.classList.toggle('is-pressed');
        labelBtn.setAttribute('aria-pressed', nowOn ? 'true' : 'false');
        return;
      }

      const spinBtn = t.closest && t.closest('.quick-add-time-spin-btn');
      if (spinBtn && form.contains(spinBtn)) {
        e.preventDefault();
        if (spinBtn.closest('.quick-add-waso-spin')) {
          const inp = document.getElementById('quick-add-waso');
          if (!inp) return;
          let v = inp.value === '' ? 0 : parseInt(inp.value, 10);
          if (!Number.isFinite(v)) v = 0;
          const up = spinBtn.classList.contains('quick-add-time-spin-btn--up');
          v = Math.max(0, v + (up ? 1 : -1));
          inp.value = String(v);
          return;
        }
        const row = spinBtn.closest('.quick-add-time-row');
        const inp = row && row.querySelector('.quick-add-time-native');
        if (inp) {
          const up = spinBtn.classList.contains('quick-add-time-spin-btn--up');
          quickAddStepTimeMinutes(inp, up ? 1 : -1);
        }
      }
    });
    document.addEventListener('change', function (e) {
      const t = e.target;
      if (!t || t.id !== 'quick-add-date') return;
      const dateMd = dateInputValueToSleepDateKey(t.value);
      if (!dateMd) return;
      loadQuickAddFormForDate(dateMd);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      const drawer = document.getElementById('quick-add-drawer');
      if (!drawer || drawer.classList.contains('quick-add-drawer--page')) return;
      if (drawer.classList.contains('is-expanded')) {
        closeQuickAddDrawer();
      }
    });
  }

  function initQuickAddEntryModal(options) {
    quickAddOptions = options || {};
    bindQuickAddHostOnce();
    wireQuickAddDrawerSliders();
    const dateInput = document.getElementById('quick-add-date');
    const dateMd = dateInputValueToSleepDateKey(dateInput && dateInput.value);
    if (dateMd) loadQuickAddFormForDate(dateMd);
  }

  window.initQuickAddEntryModal = initQuickAddEntryModal;
  window.wireQuickAddDrawerSliders = wireQuickAddDrawerSliders;
})();
