// Dashboard quick-add: pull-down drawer above Tonight, same dual-slider pattern as tonight adjuster.
(function () {
  let quickAddOptions = {};
  let quickAddHostBound = false;
  let sliderWireAbort = null;
  let quickAddAlarmNorm = null;

  function formatMonthDayFromDate(date) {
    return (date.getMonth() + 1) + '/' + date.getDate();
  }

  function getAppYear() {
    return typeof YEAR === 'number' ? YEAR : new Date().getFullYear();
  }

  function monthDayToDateInput(md) {
    if (!md || typeof md !== 'string' || md.indexOf('/') === -1) return '';
    const parts = md.split('/').map(Number);
    if (!parts[0] || !parts[1]) return '';
    const d = new Date(getAppYear(), parts[0] - 1, parts[1]);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function dateInputToMonthDay(value) {
    if (!value) return '';
    const d = new Date(value + 'T00:00:00');
    if (Number.isNaN(d.getTime())) return '';
    return formatMonthDayFromDate(d);
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
    if (!drawer || !handle) return;
    drawer.classList.toggle('is-expanded', expanded);
    handle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
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
  }

  function initQuickAddDynamicTimeLists() {
    const bath = document.getElementById('quick-add-bathroom-list');
    const alarmList = document.getElementById('quick-add-alarm-adv-list');
    if (bath) {
      bath.innerHTML = '';
      appendQuickAddTimeRow(bath);
    }
    if (alarmList) {
      alarmList.innerHTML = '';
      appendQuickAddTimeRow(alarmList);
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
    if (rows.length <= 1) {
      const inp = row.querySelector('.quick-add-time-native');
      if (inp) inp.value = '';
      return;
    }
    row.remove();
  }

  function resetQuickAddFormToDefaults() {
    const dateInput = document.getElementById('quick-add-date');
    if (dateInput) dateInput.value = monthDayToDateInput(formatMonthDayFromDate(new Date()));
    initQuickAddDynamicTimeLists();
    const napS = document.getElementById('quick-add-nap-start');
    const napE = document.getElementById('quick-add-nap-end');
    if (napS) napS.value = '';
    if (napE) napE.value = '';
    const waso = document.getElementById('quick-add-waso');
    if (waso) waso.value = '0';
    setQuickAddStatus('', false);

    const sleepSlider = document.getElementById('quick-add-sleep-slider');
    const wakeSlider = document.getElementById('quick-add-wake-slider');
    const form = document.getElementById('quick-add-form');
    if (sleepSlider && wakeSlider && form && form.dataset) {
      const is = parseInt(form.dataset.initialSleepNorm, 10);
      const iw = parseInt(form.dataset.initialWakeNorm, 10);
      if (Number.isFinite(is) && Number.isFinite(iw)) {
        sleepSlider.value = String(is);
        wakeSlider.value = String(iw);
      }
    }
    quickAddAlarmNorm = null;
    updateQuickAddalarmMarkerDisplay();
    updateQuickAddSliderVisualsFromDom();
  }

  function closeQuickAddDrawer() {
    setDrawerExpanded(false);
    resetQuickAddFormToDefaults();
  }

  function updateQuickAddalarmMarkerDisplay() {
    const marker = document.getElementById('quick-add-alarm-marker');
    const timeEl = document.getElementById('quick-add-alarm-marker-time');
    const wrap = document.getElementById('quick-add-adjust-slider');
    if (!marker || !timeEl || !wrap) return;
    if (quickAddAlarmNorm === null) {
      marker.hidden = true;
      wrap.style.removeProperty('--quick-add-alarm-pct');
      timeEl.textContent = '';
      return;
    }
    marker.hidden = false;
    const scopeStart = parseInt(document.getElementById('quick-add-sleep-slider').min, 10);
    const scopeEnd = parseInt(document.getElementById('quick-add-sleep-slider').max, 10);
    const span = scopeEnd - scopeStart;
    const pct = span > 0 ? ((quickAddAlarmNorm - scopeStart) / span) * 100 : 50;
    wrap.style.setProperty('--quick-add-alarm-pct', pct + '%');
    timeEl.textContent = formatTime(modMinutes1440(quickAddAlarmNorm));
  }

  function updateQuickAddSliderVisualsFromDom() {
    const wrap = document.getElementById('quick-add-adjust-slider');
    const sleepSlider = document.getElementById('quick-add-sleep-slider');
    const wakeSlider = document.getElementById('quick-add-wake-slider');
    const sleepLabel = document.getElementById('quick-add-sleep-thumb-label');
    const wakeLabel = document.getElementById('quick-add-wake-thumb-label');
    if (!wrap || !sleepSlider || !wakeSlider || !sleepLabel || !wakeLabel) return;

    const min = parseInt(sleepSlider.min, 10);
    const max = parseInt(sleepSlider.max, 10);
    const span = max - min;
    const sleepNorm = parseInt(sleepSlider.value, 10);
    const wakeNorm = parseInt(wakeSlider.value, 10);
    const sleepPct = span > 0 ? ((sleepNorm - min) / span) * 100 : 0;
    const wakePct = span > 0 ? ((wakeNorm - min) / span) * 100 : 0;
    wrap.style.setProperty('--tonight-sleep-pct', sleepPct + '%');
    wrap.style.setProperty('--tonight-wake-pct', wakePct + '%');
    wrap.style.setProperty('--tonight-mid-pct', (sleepPct + wakePct) / 2 + '%');
    sleepLabel.textContent = formatTime(modMinutes1440(sleepNorm));
    wakeLabel.textContent = formatTime(modMinutes1440(wakeNorm));
    updateQuickAddalarmMarkerDisplay();
  }

  function wireQuickAddDrawerSliders() {
    if (sliderWireAbort) sliderWireAbort.abort();
    sliderWireAbort = new AbortController();
    const signal = sliderWireAbort.signal;

    const drawer = document.getElementById('quick-add-drawer');
    const handle = document.getElementById('quick-add-drawer-handle');
    const sleepSlider = document.getElementById('quick-add-sleep-slider');
    const wakeSlider = document.getElementById('quick-add-wake-slider');
    const sliderWrap = document.getElementById('quick-add-adjust-slider');
    const sliderOverlay = document.getElementById('quick-add-adjust-overlay');
    const alarmChip = document.getElementById('quick-add-alarm-chip');
    const alarmMarker = document.getElementById('quick-add-alarm-marker');
    const alarmMarkerIcon = document.getElementById('quick-add-alarm-marker-icon');
    const form = document.getElementById('quick-add-form');
    const dateInput = document.getElementById('quick-add-date');

    if (!drawer || !handle || !sleepSlider || !wakeSlider || !sliderWrap || !sliderOverlay || !form) return;

    quickAddAlarmNorm = null;
    if (dateInput) dateInput.value = monthDayToDateInput(formatMonthDayFromDate(new Date()));
    initQuickAddDynamicTimeLists();

    const scopeMin = parseInt(sleepSlider.min, 10);
    const scopeMax = parseInt(sleepSlider.max, 10);
    const baseLike = {
      scopeStartNorm: scopeMin,
      scopeEndNorm: scopeMax
    };

    function clampPair(sleepNorm, wakeNorm, changedSide) {
      let s = sleepNorm;
      let w = wakeNorm;
      if (changedSide === 'sleep' && s >= w) s = w - TONIGHT_ADJUST_MIN_GAP_MINUTES;
      else if (changedSide === 'wake' && w <= s) w = s + TONIGHT_ADJUST_MIN_GAP_MINUTES;
      return clampTonightProjectionNorms(baseLike, s, w);
    }

    function getNormFromClientX(clientX) {
      const rect = sliderWrap.getBoundingClientRect();
      const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return Math.round(scopeMin + frac * (scopeMax - scopeMin));
    }

    function pointInSliderBar(clientX, clientY) {
      const rect = sliderWrap.getBoundingClientRect();
      const pad = 12;
      return clientX >= rect.left - pad && clientX <= rect.right + pad &&
        clientY >= rect.top - pad && clientY <= rect.bottom + 36;
    }

    let dragging = null;
    function onOverlayPointerDown(e) {
      if (e.button !== undefined && e.button !== 0) return;
      if (e.touches && e.touches.length > 1) return;
      if (e.cancelable) e.preventDefault();
      const norm = getNormFromClientX(e.touches ? e.touches[0].clientX : e.clientX);
      const sleepNorm = parseInt(sleepSlider.value, 10);
      const wakeNorm = parseInt(wakeSlider.value, 10);
      const distToSleep = Math.abs(norm - sleepNorm);
      const distToWake = Math.abs(norm - wakeNorm);
      dragging = distToSleep <= distToWake ? 'sleep' : 'wake';
      if (dragging === 'sleep') elSetSleep(norm);
      else elSetWake(norm);
    }

    function elSetSleep(norm) {
      const w = parseInt(wakeSlider.value, 10);
      const c = clampPair(norm, w, 'sleep');
      sleepSlider.value = String(c.sleepNorm);
      wakeSlider.value = String(c.wakeNorm);
      updateQuickAddSliderVisualsFromDom();
    }

    function elSetWake(norm) {
      const s = parseInt(sleepSlider.value, 10);
      const c = clampPair(s, norm, 'wake');
      sleepSlider.value = String(c.sleepNorm);
      wakeSlider.value = String(c.wakeNorm);
      updateQuickAddSliderVisualsFromDom();
    }

    function onOverlayPointerMove(e) {
      if (!dragging) return;
      if (e.cancelable) e.preventDefault();
      const norm = getNormFromClientX(e.touches ? e.touches[0].clientX : e.clientX);
      if (dragging === 'sleep') elSetSleep(norm);
      else elSetWake(norm);
    }

    function onOverlayPointerUp() {
      dragging = null;
    }

    sliderOverlay.addEventListener('mousedown', onOverlayPointerDown, { signal: signal });
    sliderOverlay.addEventListener('touchstart', onOverlayPointerDown, { passive: false, signal: signal });
    document.addEventListener('mousemove', onOverlayPointerMove, { signal: signal });
    document.addEventListener('touchmove', onOverlayPointerMove, { passive: false, signal: signal });
    document.addEventListener('mouseup', onOverlayPointerUp, { signal: signal });
    document.addEventListener('touchend', onOverlayPointerUp, { signal: signal });
    document.addEventListener('touchcancel', onOverlayPointerUp, { signal: signal });

    sleepSlider.addEventListener('input', function () {
      const w = parseInt(wakeSlider.value, 10);
      const c = clampPair(parseInt(sleepSlider.value, 10), w, 'sleep');
      sleepSlider.value = String(c.sleepNorm);
      wakeSlider.value = String(c.wakeNorm);
      updateQuickAddSliderVisualsFromDom();
    }, { signal: signal });

    wakeSlider.addEventListener('input', function () {
      const s = parseInt(sleepSlider.value, 10);
      const c = clampPair(s, parseInt(wakeSlider.value, 10), 'wake');
      sleepSlider.value = String(c.sleepNorm);
      wakeSlider.value = String(c.wakeNorm);
      updateQuickAddSliderVisualsFromDom();
    }, { signal: signal });

    let handleStartY = null;
    let handlePulled = false;
    handle.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      handleStartY = e.clientY;
      handlePulled = false;
      try {
        handle.setPointerCapture(e.pointerId);
      } catch (_err) { /* ignore */ }
    }, { signal: signal });
    handle.addEventListener('pointermove', function (e) {
      if (handleStartY === null) return;
      if (e.clientY - handleStartY > 22) handlePulled = true;
    }, { signal: signal });
    handle.addEventListener('pointerup', function () {
      if (handleStartY === null) return;
      if (handlePulled) setDrawerExpanded(true);
      else setDrawerExpanded(!drawer.classList.contains('is-expanded'));
      handleStartY = null;
      handlePulled = false;
    }, { signal: signal });
    handle.addEventListener('pointercancel', function () {
      handleStartY = null;
      handlePulled = false;
    }, { signal: signal });

    let alarmDragMode = null;
    function clearAlarmIfOutside(clientX, clientY) {
      if (!pointInSliderBar(clientX, clientY)) {
        quickAddAlarmNorm = null;
        updateQuickAddalarmMarkerDisplay();
      }
    }

    function bindAlarmPoolDrag(el) {
      if (!el) return;
      el.addEventListener('pointerdown', function (e) {
        if (e.button !== undefined && e.button !== 0) return;
        e.preventDefault();
        alarmDragMode = 'pool';
        el.setPointerCapture(e.pointerId);
      }, { signal: signal });
      el.addEventListener('pointermove', function (e) {
        if (alarmDragMode !== 'pool') return;
        if (pointInSliderBar(e.clientX, e.clientY)) {
          quickAddAlarmNorm = getNormFromClientX(e.clientX);
          updateQuickAddalarmMarkerDisplay();
        }
      }, { signal: signal });
      el.addEventListener('pointerup', function (e) {
        if (alarmDragMode !== 'pool') return;
        alarmDragMode = null;
        try {
          el.releasePointerCapture(e.pointerId);
        } catch (_err) { /* ignore */ }
        if (pointInSliderBar(e.clientX, e.clientY)) {
          quickAddAlarmNorm = getNormFromClientX(e.clientX);
        } else {
          quickAddAlarmNorm = null;
        }
        updateQuickAddalarmMarkerDisplay();
      }, { signal: signal });
      el.addEventListener('pointercancel', function () {
        alarmDragMode = null;
      }, { signal: signal });
    }

    function bindAlarmMarkerDrag(markerRoot, iconEl) {
      if (!markerRoot || !iconEl) return;
      iconEl.addEventListener('pointerdown', function (e) {
        if (e.button !== undefined && e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        alarmDragMode = 'marker';
        iconEl.setPointerCapture(e.pointerId);
      }, { signal: signal });
      iconEl.addEventListener('pointermove', function (e) {
        if (alarmDragMode !== 'marker') return;
        if (pointInSliderBar(e.clientX, e.clientY)) {
          quickAddAlarmNorm = getNormFromClientX(e.clientX);
          updateQuickAddalarmMarkerDisplay();
        }
      }, { signal: signal });
      iconEl.addEventListener('pointerup', function (e) {
        if (alarmDragMode !== 'marker') return;
        alarmDragMode = null;
        try {
          iconEl.releasePointerCapture(e.pointerId);
        } catch (_err) { /* ignore */ }
        clearAlarmIfOutside(e.clientX, e.clientY);
        updateQuickAddalarmMarkerDisplay();
      }, { signal: signal });
      iconEl.addEventListener('pointercancel', function () {
        alarmDragMode = null;
      }, { signal: signal });
    }

    bindAlarmPoolDrag(alarmChip);
    bindAlarmMarkerDrag(alarmMarker, alarmMarkerIcon || alarmMarker);

    updateQuickAddSliderVisualsFromDom();
  }

  function handleSubmit(event) {
    event.preventDefault();
    const dateMd = dateInputToMonthDay(document.getElementById('quick-add-date').value);
    const sleepNorm = parseInt(document.getElementById('quick-add-sleep-slider').value, 10);
    const wakeNorm = parseInt(document.getElementById('quick-add-wake-slider').value, 10);
    const sleepStart = formatTime(modMinutes1440(sleepNorm));
    const sleepEnd = formatTime(modMinutes1440(wakeNorm));
    const formEl = document.getElementById('quick-add-form');
    const bedLeadRaw = formEl && formEl.dataset ? formEl.dataset.bedLead : '20';
    const bedLead = parseInt(bedLeadRaw, 10) || 20;
    const bedM = modMinutes1440(sleepNorm - bedLead);
    const bed = formatTime(bedM);

    const bathroom = collectNormalizedTimesFromList(document.getElementById('quick-add-bathroom-list'));
    let alarm = collectNormalizedTimesFromList(document.getElementById('quick-add-alarm-adv-list'));
    if (quickAddAlarmNorm !== null) {
      alarm = [formatTime(modMinutes1440(quickAddAlarmNorm))];
    }

    const napStartRaw = document.getElementById('quick-add-nap-start').value;
    const napEndRaw = document.getElementById('quick-add-nap-end').value;
    const napStart = napStartRaw ? timeInputValueToNormalized(napStartRaw) : null;
    const napEnd = napEndRaw ? timeInputValueToNormalized(napEndRaw) : null;
    const wasoRaw = document.getElementById('quick-add-waso').value;
    const waso = wasoRaw === '' ? 0 : Number(wasoRaw);

    if (!dateMd || !bed || !sleepStart || !sleepEnd) {
      setQuickAddStatus('Pick a date and adjust the sleep bar (fell asleep & wake).', true);
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
    if (!Number.isFinite(waso) || waso < 0) {
      setQuickAddStatus('WASO must be 0 or greater.', true);
      return;
    }

    const saveBtn = document.getElementById('quick-add-save');
    if (saveBtn) saveBtn.disabled = true;
    setQuickAddStatus('Saving...', false);

    const day = {
      date: dateMd,
      bed: bed,
      sleepStart: sleepStart,
      sleepEnd: sleepEnd,
      bathroom: bathroom,
      alarm: alarm,
      nap: napStart && napEnd ? { start: napStart, end: napEnd } : null,
      WASO: Math.floor(waso)
    };

    upsertSleepDay(day)
      .then(function () {
        setQuickAddStatus('Saved.', false);
        closeQuickAddDrawer();
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
    const host = document.getElementById('dashboard-container');
    if (!host || quickAddHostBound) return;
    quickAddHostBound = true;
    host.addEventListener('submit', function (e) {
      const t = e.target;
      if (t && t.id === 'quick-add-form') handleSubmit(e);
    });
    host.addEventListener('click', function (e) {
      const t = e.target;
      if (!t || !host.contains(t)) return;

      if (t.id === 'quick-add-cancel') {
        e.preventDefault();
        closeQuickAddDrawer();
        return;
      }

      if (t.id === 'quick-add-bathroom-add') {
        e.preventDefault();
        appendQuickAddTimeRow(document.getElementById('quick-add-bathroom-list'));
        return;
      }
      if (t.id === 'quick-add-alarm-adv-add') {
        e.preventDefault();
        appendQuickAddTimeRow(document.getElementById('quick-add-alarm-adv-list'));
        return;
      }

      const rm = t.closest && t.closest('.quick-add-time-remove');
      if (rm && host.contains(rm)) {
        e.preventDefault();
        onQuickAddRemoveTimeRow(rm);
        return;
      }

      const spinBtn = t.closest && t.closest('.quick-add-time-spin-btn');
      if (spinBtn && host.contains(spinBtn)) {
        e.preventDefault();
        const row = spinBtn.closest('.quick-add-time-row');
        const inp = row && row.querySelector('.quick-add-time-native');
        if (inp) {
          const up = spinBtn.classList.contains('quick-add-time-spin-btn--up');
          quickAddStepTimeMinutes(inp, up ? 1 : -1);
        }
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      const drawer = document.getElementById('quick-add-drawer');
      if (drawer && drawer.classList.contains('is-expanded')) {
        closeQuickAddDrawer();
      }
    });
  }

  function initQuickAddEntryModal(options) {
    quickAddOptions = options || {};
    bindQuickAddHostOnce();
    wireQuickAddDrawerSliders();
  }

  window.initQuickAddEntryModal = initQuickAddEntryModal;
  window.wireQuickAddDrawerSliders = wireQuickAddDrawerSliders;
})();
