// Dashboard quick-add modal for direct sleep entry.
(function () {
  let quickAddInitialized = false;
  let quickAddOptions = {};

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

  function parseTimeList(raw) {
    if (!raw || !String(raw).trim()) return [];
    const parts = String(raw).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    const normalized = [];
    for (let i = 0; i < parts.length; i++) {
      const t = normalizeTime(parts[i]);
      if (!t) return null;
      normalized.push(t);
    }
    return normalized;
  }

  function setQuickAddStatus(text, isError) {
    const el = document.getElementById('quick-add-status');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('quick-add-status--error', Boolean(isError));
  }

  function openQuickAddModal(defaultDateMd) {
    const modal = document.getElementById('quick-add-modal');
    if (!modal) return;
    const dateInput = document.getElementById('quick-add-date');
    if (dateInput) dateInput.value = monthDayToDateInput(defaultDateMd || formatMonthDayFromDate(new Date()));
    setQuickAddStatus('', false);
    modal.hidden = false;
    requestAnimationFrame(function () {
      modal.classList.add('is-open');
    });
  }

  function closeQuickAddModal() {
    const modal = document.getElementById('quick-add-modal');
    if (!modal) return;
    modal.classList.remove('is-open');
    setTimeout(function () {
      modal.hidden = true;
    }, 120);
  }

  function buildModalMarkup() {
    return (
      '<button type="button" class="quick-add-fab" id="quick-add-open-btn" aria-label="Add or edit a night">+ Night</button>' +
      '<div class="quick-add-modal" id="quick-add-modal" hidden>' +
        '<div class="quick-add-backdrop" id="quick-add-backdrop"></div>' +
        '<div class="quick-add-dialog" role="dialog" aria-modal="true" aria-labelledby="quick-add-title">' +
          '<h2 class="section-title quick-add-title" id="quick-add-title">Add or update night</h2>' +
          '<form id="quick-add-form" class="quick-add-form">' +
            '<label class="quick-add-label" for="quick-add-date">Date</label>' +
            '<input class="quick-add-input" id="quick-add-date" type="date" required>' +
            '<label class="quick-add-label" for="quick-add-bed">Bed time</label>' +
            '<input class="quick-add-input" id="quick-add-bed" type="text" inputmode="numeric" placeholder="22:30" required>' +
            '<label class="quick-add-label" for="quick-add-sleep-start">Fell asleep</label>' +
            '<input class="quick-add-input" id="quick-add-sleep-start" type="text" inputmode="numeric" placeholder="22:45" required>' +
            '<label class="quick-add-label" for="quick-add-sleep-end">Get up</label>' +
            '<input class="quick-add-input" id="quick-add-sleep-end" type="text" inputmode="numeric" placeholder="7:05" required>' +
            '<details class="quick-add-advanced">' +
              '<summary>Advanced fields (optional)</summary>' +
              '<label class="quick-add-label" for="quick-add-bathroom">Bathroom wake times (comma-separated)</label>' +
              '<input class="quick-add-input" id="quick-add-bathroom" type="text" inputmode="numeric" placeholder="1:40, 4:20">' +
              '<label class="quick-add-label" for="quick-add-alarm">Alarm times (comma-separated)</label>' +
              '<input class="quick-add-input" id="quick-add-alarm" type="text" inputmode="numeric" placeholder="7:00, 7:10">' +
              '<label class="quick-add-label" for="quick-add-nap-start">Nap start</label>' +
              '<input class="quick-add-input" id="quick-add-nap-start" type="text" inputmode="numeric" placeholder="18:30">' +
              '<label class="quick-add-label" for="quick-add-nap-end">Nap end</label>' +
              '<input class="quick-add-input" id="quick-add-nap-end" type="text" inputmode="numeric" placeholder="19:10">' +
              '<label class="quick-add-label" for="quick-add-waso">WASO count</label>' +
              '<input class="quick-add-input" id="quick-add-waso" type="number" min="0" step="1" value="0">' +
            '</details>' +
            '<p class="quick-add-status" id="quick-add-status"></p>' +
            '<div class="quick-add-actions">' +
              '<button type="button" class="about-theme-option" id="quick-add-cancel">Cancel</button>' +
              '<button type="submit" class="about-theme-option" id="quick-add-save">Save</button>' +
            '</div>' +
          '</form>' +
        '</div>' +
      '</div>'
    );
  }

  function handleSubmit(event) {
    event.preventDefault();
    const dateMd = dateInputToMonthDay(document.getElementById('quick-add-date').value);
    const bed = normalizeTime(document.getElementById('quick-add-bed').value);
    const sleepStart = normalizeTime(document.getElementById('quick-add-sleep-start').value);
    const sleepEnd = normalizeTime(document.getElementById('quick-add-sleep-end').value);
    const bathroom = parseTimeList(document.getElementById('quick-add-bathroom').value);
    const alarm = parseTimeList(document.getElementById('quick-add-alarm').value);
    const napStartRaw = document.getElementById('quick-add-nap-start').value;
    const napEndRaw = document.getElementById('quick-add-nap-end').value;
    const napStart = napStartRaw ? normalizeTime(napStartRaw) : null;
    const napEnd = napEndRaw ? normalizeTime(napEndRaw) : null;
    const wasoRaw = document.getElementById('quick-add-waso').value;
    const waso = wasoRaw === '' ? 0 : Number(wasoRaw);

    if (!dateMd || !bed || !sleepStart || !sleepEnd) {
      setQuickAddStatus('Fill date, bed, fell asleep, and get up using HH:MM.', true);
      return;
    }
    if (bathroom === null || alarm === null) {
      setQuickAddStatus('Bathroom/alarm times must be HH:MM, separated by commas.', true);
      return;
    }
    if ((napStart && !napEnd) || (!napStart && napEnd)) {
      setQuickAddStatus('Enter both nap start and nap end, or leave both blank.', true);
      return;
    }
    if ((napStartRaw || napEndRaw) && (!napStart || !napEnd)) {
      setQuickAddStatus('Nap times must be HH:MM.', true);
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
        closeQuickAddModal();
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

  function initQuickAddEntryModal(options) {
    quickAddOptions = options || {};
    if (quickAddInitialized) return;
    quickAddInitialized = true;

    document.body.insertAdjacentHTML('beforeend', buildModalMarkup());

    const openBtn = document.getElementById('quick-add-open-btn');
    const closeBtn = document.getElementById('quick-add-cancel');
    const backdrop = document.getElementById('quick-add-backdrop');
    const form = document.getElementById('quick-add-form');
    const modal = document.getElementById('quick-add-modal');

    if (openBtn) {
      openBtn.addEventListener('click', function () {
        openQuickAddModal(formatMonthDayFromDate(new Date()));
      });
    }
    if (closeBtn) closeBtn.addEventListener('click', closeQuickAddModal);
    if (backdrop) backdrop.addEventListener('click', closeQuickAddModal);
    if (form) form.addEventListener('submit', handleSubmit);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal && !modal.hidden) closeQuickAddModal();
    });
  }

  window.initQuickAddEntryModal = initQuickAddEntryModal;
})();
