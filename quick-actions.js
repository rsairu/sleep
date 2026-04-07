// Time-aware dashboard quick actions (wake / nap / sleep) using recent averages; persists via upsertSleepDay.
(function () {
  const NAP_STORAGE_KEY = 'restore_quick_nap_v1';

  let quickActionsIntervalId = null;
  let boundClickHandler = null;

  function getAppYear() {
    return typeof YEAR === 'number' ? YEAR : getAppDate().getFullYear();
  }

  function formatMdFromDate(d) {
    return d.getMonth() + 1 + '/' + d.getDate();
  }

  function nowClockMinutes(d) {
    return d.getHours() * 60 + d.getMinutes();
  }

  function formatTimeFromDate(d) {
    return formatTime(nowClockMinutes(d));
  }

  function addWallMinutes(d, deltaM) {
    const x = new Date(d.getTime() + deltaM * 60000);
    return formatTime(nowClockMinutes(x));
  }

  function getAveragesFromDays(days) {
    const recent = days && days.length ? days.slice(0, Math.min(7, days.length)) : [];
    if (recent.length === 0) {
      return typeof QUICK_ADD_FALLBACK_AVERAGES !== 'undefined'
        ? QUICK_ADD_FALLBACK_AVERAGES
        : { avgSleepStart: 22 * 60 + 30, avgSleepEnd: 7 * 60, avgFirstAlarmToWake: null };
    }
    return calculateAverages(recent);
  }

  /**
   * @returns {'wake'|'sleep'|'mid'}
   */
  function inferPhase(now, averages) {
    if (typeof inferSharedSleepContextPhase === 'function') {
      return inferSharedSleepContextPhase(now, averages.avgSleepStart, averages.avgSleepEnd);
    }
    return 'mid';
  }

  function getQuickActionsPhaseFromSharedContext(sharedContext, now, averages) {
    if (sharedContext && sharedContext.navDisplay) {
      if (sharedContext.navDisplay.phase === 'sleep') return 'sleep';
      if (sharedContext.wakeInLast3Hours) return 'wake';
      if (sharedContext.wakeProximity) return 'wake';
      const b = sharedContext.basis;
      if (b && Number.isFinite(b.avgSleepStart) && Number.isFinite(b.avgSleepEnd)) {
        return inferPhase(now, { avgSleepStart: b.avgSleepStart, avgSleepEnd: b.avgSleepEnd });
      }
      return 'mid';
    }
    return inferPhase(now, averages);
  }

  function hasQaBedAndSleepFlags(nightMd) {
    const e = readNightQaSleepFlagMap()[nightMd];
    return Boolean(e && e.bed && e.sleep);
  }

  function hasQaBedFlag(nightMd) {
    const e = readNightQaSleepFlagMap()[nightMd];
    return Boolean(e && e.bed);
  }

  function hasQaSleepFlag(nightMd) {
    const e = readNightQaSleepFlagMap()[nightMd];
    return Boolean(e && e.sleep);
  }

  function pickDayForNightMd(nightMd, liveDays) {
    return pickDayForNightMdNav(nightMd, liveDays);
  }

  /**
   * Bed already recorded for this sleep-period row (flags or non-stub value within recent hours).
   */
  function bedLoggedForSleepPeriod(nightMd, liveDays, averages, now) {
    if (hasQaBedFlag(nightMd)) return true;
    const day = pickDayForNightMd(nightMd, liveDays);
    if (!day) return false;
    const stub = buildStubDayForNightMd(nightMd, liveDays, averages);
    if (!stub) return false;
    const bedDiff = String(day.bed || '') !== String(stub.bed || '');
    if (!bedDiff) return false;
    return isWallClockWithinRecentHoursNav(now, day.bed, 12);
  }

  /**
   * Fell-asleep already recorded for this sleep-period row (flags or non-stub value within recent hours).
   */
  function sleepLoggedForSleepPeriod(nightMd, liveDays, averages, now) {
    if (hasQaSleepFlag(nightMd)) return true;
    const day = pickDayForNightMd(nightMd, liveDays);
    if (!day) return false;
    const stub = buildStubDayForNightMd(nightMd, liveDays, averages);
    if (!stub) return false;
    const sleepDiff = String(day.sleepStart || '') !== String(stub.sleepStart || '');
    if (!sleepDiff) return false;
    return isWallClockWithinRecentHoursNav(now, day.sleepStart, 12);
  }

  /**
   * Bed + fell-asleep already recorded for this sleep-period row (local cache / live days),
   * both differing from stub defaults and within the last 12h, or both via quick actions (flags).
   */
  function bedAndSleepCompleteForSleepPeriod(nightMd, liveDays, averages, now) {
    if (hasQaBedAndSleepFlags(nightMd)) return true;
    const day = pickDayForNightMd(nightMd, liveDays);
    if (!day) return false;
    const stub = buildStubDayForNightMd(nightMd, liveDays, averages);
    if (!stub) return false;
    const bedDiff = String(day.bed || '') !== String(stub.bed || '');
    const sleepDiff = String(day.sleepStart || '') !== String(stub.sleepStart || '');
    if (!bedDiff || !sleepDiff) return false;
    return (
      isWallClockWithinRecentHoursNav(now, day.bed, 12) &&
      isWallClockWithinRecentHoursNav(now, day.sleepStart, 12)
    );
  }

  function readNapSession() {
    try {
      const raw = localStorage.getItem(NAP_STORAGE_KEY);
      if (!raw) return null;
      const o = JSON.parse(raw);
      if (!o || typeof o.dateMd !== 'string' || typeof o.start !== 'string') return null;
      return o;
    } catch (_e) {
      return null;
    }
  }

  function writeNapSession(session) {
    try {
      if (!session) localStorage.removeItem(NAP_STORAGE_KEY);
      else localStorage.setItem(NAP_STORAGE_KEY, JSON.stringify(session));
    } catch (_e) { /* ignore */ }
  }

  function findDayByMd(days, md) {
    return findDayByDateMd(days, md);
  }

  function cloneDayBase(d) {
    return {
      date: d.date,
      bed: d.bed,
      sleepStart: d.sleepStart,
      sleepEnd: d.sleepEnd,
      bathroom: Array.isArray(d.bathroom) ? d.bathroom.slice() : [],
      alarm: Array.isArray(d.alarm) ? d.alarm.slice() : [],
      nap: d.nap && d.nap.start
        ? { start: d.nap.start, end: d.nap.end != null && d.nap.end !== '' ? d.nap.end : null }
        : null,
      WASO: typeof d.WASO === 'number' && Number.isFinite(d.WASO) ? d.WASO : 0
    };
  }

  function newStubDay(dateMd, days, averages) {
    const stub = buildStubDayForNightMd(dateMd, days, averages);
    if (stub) return stub;
    const template = days && days.length ? days[0] : null;
    const ss = template
      ? template.sleepStart
      : formatTime(modMinutes1440(averages.avgSleepStart));
    const bed = template
      ? template.bed
      : formatTime(modMinutes1440(averages.avgSleepStart - 25));
    const se = template
      ? template.sleepEnd
      : formatTime(modMinutes1440(averages.avgSleepEnd));
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

  function mergeUniqueTimeStrings(list, t) {
    const mins = new Set();
    const out = [];
    (list || []).forEach(function (x) {
      const m = timeToMinutes(x);
      if (!Number.isFinite(m)) return;
      mins.add(m);
      out.push(x);
    });
    const n = timeToMinutes(t);
    if (Number.isFinite(n)) {
      let clash = false;
      mins.forEach(function (m) {
        if (Math.abs(m - n) < 2) clash = true;
      });
      if (!clash) out.push(t);
    }
    return out;
  }

  function isSupabaseEnabled() {
    const cfg = typeof getSupabaseConfig === 'function' ? getSupabaseConfig() : { enabled: false };
    return Boolean(cfg.enabled);
  }

  function ensureCloudForPersist() {
    if (isSupabaseEnabled()) return true;
    if (typeof showAppToast === 'function') showAppToast('Cloud sync required — Settings');
    return false;
  }

  function persistPartial(dateMd, partial, onReload) {
    return saveDraftAndMaybePromote(dateMd, partial)
      .then(function () {
        if (typeof showAppToast === 'function') showAppToast('recorded');
        if (typeof onReload === 'function') return onReload();
        return null;
      })
      .catch(function (err) {
        console.error(err);
        if (typeof showAppToast === 'function') {
          showAppToast(err && err.message ? err.message : 'Save failed');
        }
        return Promise.reject(err);
      });
  }

  function getEditableDayByMd(md, days) {
    return getSleepDraftByDate(md)
      .catch(function () {
        return null;
      })
      .then(function (draft) {
        if (draft) return draft;
        return findDayByMd(days, md);
      });
  }

  function handleWakeUp(days, averages, onReload, now) {
    const md =
      typeof resolveRecordDateMdForWake === 'function'
        ? resolveRecordDateMdForWake(now, averages.avgSleepEnd, days)
        : recordDateMdForSleepPeriod(now, averages.avgSleepEnd);
    return persistPartial(md, { sleepEnd: formatTimeFromDate(now) }, onReload).then(function () {
      markNightQaSleepFlag(md, 'wake');
      return null;
    });
  }

  function handleAlarmNow(days, averages, onReload, now) {
    const md =
      typeof resolveRecordDateMdForWake === 'function'
        ? resolveRecordDateMdForWake(now, averages.avgSleepEnd, days)
        : recordDateMdForSleepPeriod(now, averages.avgSleepEnd);
    const alarmNow = formatTimeFromDate(now);
    return getEditableDayByMd(md, days).then(function (day) {
      const existingAlarm = day && Array.isArray(day.alarm) ? day.alarm : [];
      return persistPartial(
        md,
        { alarm: mergeUniqueTimeStrings(existingAlarm, alarmNow) },
        onReload
      );
    });
  }

  /** Bed time only — does not change sleepStart or sleepEnd. */
  function handleBedNow(days, averages, onReload, now) {
    const md = recordDateMdForSleepPeriod(now, averages.avgSleepEnd);
    const bedClock = formatTimeFromDate(now);
    return persistPartial(md, { bed: bedClock }, onReload).then(function () {
      markNightQaSleepFlag(md, 'bed');
      return null;
    });
  }

  /** Fell-asleep time only — does not change bed. */
  function handleSleepAt(days, averages, onReload, now, offsetMin) {
    const md = recordDateMdForSleepPeriod(now, averages.avgSleepEnd);
    const startClock = offsetMin === 0 ? formatTimeFromDate(now) : addWallMinutes(now, offsetMin);
    return persistPartial(md, { sleepStart: startClock }, onReload).then(function () {
      markNightQaSleepFlag(md, 'sleep');
      return null;
    });
  }

  function handleBathroomTripNow(days, averages, onReload, now) {
    const md = recordDateMdForSleepPeriod(now, averages.avgSleepEnd);
    const t = formatTimeFromDate(now);
    return getEditableDayByMd(md, days).then(function (day) {
      const existingBathroom = day && Array.isArray(day.bathroom) ? day.bathroom : [];
      return persistPartial(
        md,
        { bathroom: mergeUniqueTimeStrings(existingBathroom, t) },
        onReload
      );
    });
  }

  function napOpenOnDay(day) {
    return Boolean(
      day &&
        day.nap &&
        day.nap.start &&
        (day.nap.end == null || day.nap.end === '')
    );
  }

  function isNapActive(days, now) {
    const md = formatMdFromDate(now);
    const day = findDayByMd(days, md);
    if (napOpenOnDay(day)) return true;
    const s = readNapSession();
    return Boolean(s && s.dateMd === md);
  }

  function handleNapStart(days, averages, onReload, now) {
    const md = formatMdFromDate(now);
    const startStr = formatTimeFromDate(now);
    if (!isSupabaseEnabled()) {
      writeNapSession({ dateMd: md, start: startStr });
      if (typeof showAppToast === 'function') showAppToast('recorded');
      return Promise.resolve();
    }
    writeNapSession(null);
    return persistPartial(md, { nap: { start: startStr, end: null } }, onReload);
  }

  function handleNapEnd(days, averages, onReload, now) {
    const md = formatMdFromDate(now);
    const endStr = formatTimeFromDate(now);
    const session = readNapSession();
    if (!isSupabaseEnabled()) {
      writeNapSession(null);
      if (typeof showAppToast === 'function') showAppToast('recorded');
      return Promise.resolve();
    }
    return getEditableDayByMd(md, days).then(function (day) {
      let startStr = null;
      let targetMd = md;
      if (napOpenOnDay(day)) {
        startStr = day.nap.start;
        targetMd = day.date;
      } else if (session && session.dateMd === md) {
        startStr = session.start;
        targetMd = session.dateMd;
      }
      if (!startStr) {
        if (typeof showAppToast === 'function') showAppToast('Start a nap first');
        return null;
      }
      writeNapSession(null);
      return persistPartial(
        targetMd,
        { nap: { start: startStr, end: endStr } },
        onReload
      );
    });
  }

  function quickActionButton(def) {
    return '<button type="button" class="dashboard-quick-action-btn about-theme-option" data-qa="' +
      def.qa +
      '"><span aria-hidden="true">' +
      def.emoji +
      '</span> ' +
      def.label +
      '</button>';
  }

  const QUICK_ACTIONS_BY_PHASE = {
    wake: [
      { qa: 'wake', emoji: '🌅', label: 'Wake up' },
      { qa: 'alarm', emoji: '⏰', label: 'Log alarm', when: function (ctx) { return ctx.showAlarm; } }
    ],
    sleep: [
      { qa: 'bed-now', emoji: '🛏️', label: 'Get in bed', when: function (ctx) { return !ctx.bedLoggedForNight; } },
      { qa: 'sleep-0', emoji: '🌙', label: 'Go to sleep', when: function (ctx) { return !ctx.sleepLoggedForNight; } },
      { qa: 'bathroom-trip', emoji: '🧻', label: 'Bathroom break', when: function (ctx) { return ctx.bedSleepLoggedForNight; } },
      { qa: 'sleep-10', emoji: '🌙', label: 'Sleep in 10 min', when: function (ctx) { return !ctx.bedSleepLoggedForNight && !ctx.sleepLoggedForNight; } }
    ],
    mid: [
      {
        qa: 'nap-start',
        emoji: '😴',
        label: 'Start a nap',
        when: function (ctx) {
          return (
            ctx.napStartAllowed &&
            !ctx.wakeInLast3Hours &&
            !ctx.implicitPostWakeQuiet
          );
        }
      },
      { qa: 'nap-end', emoji: '💤', label: 'End your nap', when: function (ctx) { return ctx.napActive; } }
    ]
  };

  function renderButtons(phase, context) {
    const defs = QUICK_ACTIONS_BY_PHASE[phase] || QUICK_ACTIONS_BY_PHASE.mid;
    return defs
      .filter(function (def) {
        return typeof def.when !== 'function' || def.when(context);
      })
      .map(quickActionButton)
      .join('');
  }

  function renderQuickActions(days, onReload) {
    const mount = document.getElementById('dashboard-quick-actions-buttons');
    if (!mount) return;
    const averages = getAveragesFromDays(days);
    const sharedContext =
      typeof getSharedAppTimeContext === 'function' ? getSharedAppTimeContext(days) : null;
    const now = sharedContext && sharedContext.now ? sharedContext.now : getAppDate();
    const phase = getQuickActionsPhaseFromSharedContext(sharedContext, now, averages);
    const napActive = isNapActive(days, now);
    const showAlarm = averages.avgFirstAlarmToWake != null;
    const nightMd = sharedContext && sharedContext.nightMd
      ? sharedContext.nightMd
      : recordDateMdForSleepPeriod(
        now,
        sharedContext && sharedContext.basis ? sharedContext.basis.avgSleepEnd : averages.avgSleepEnd
      );
    const nightAverages = sharedContext && sharedContext.basis
      ? {
        avgSleepStart: sharedContext.basis.avgSleepStart,
        avgSleepEnd: sharedContext.basis.avgSleepEnd
      }
      : averages;
    const bedLogged =
      phase === 'sleep' && bedLoggedForSleepPeriod(nightMd, days, nightAverages, now);
    const sleepLogged =
      phase === 'sleep' && sleepLoggedForSleepPeriod(nightMd, days, nightAverages, now);
    const bedSleepLogged =
      phase === 'sleep' && bedAndSleepCompleteForSleepPeriod(nightMd, days, nightAverages, now);
    let napStartAllowed = false;
    if (sharedContext && sharedContext.navDisplay) {
      const pr = sharedContext.navDisplay.percentRemaining;
      if (typeof pr === 'number' && typeof getRemainingWakeThresholds === 'function') {
        const { openMin } = getRemainingWakeThresholds();
        napStartAllowed = pr >= openMin;
      }
    }
    const buttonContext = {
      showAlarm: showAlarm,
      napActive: napActive,
      napStartAllowed: napStartAllowed,
      wakeInLast3Hours: Boolean(sharedContext && sharedContext.wakeInLast3Hours),
      implicitPostWakeQuiet: Boolean(sharedContext && sharedContext.implicitPostWakeQuiet),
      bedLoggedForNight: bedLogged,
      sleepLoggedForNight: sleepLogged,
      bedSleepLoggedForNight: bedSleepLogged
    };
    mount.innerHTML = renderButtons(phase, buttonContext);

  }

  function onQuickActionClick(e, getDays, onReload) {
    const mount = document.getElementById('dashboard-quick-actions-buttons');
    if (!mount) return;
    const btn = e.target.closest && e.target.closest('[data-qa]');
    if (!btn || !btn.getAttribute || !mount.contains(btn)) return;
    const qa = btn.getAttribute('data-qa');
    if (!qa) return;
    if (!ensureCloudForPersist()) return;
    const days = getDays();
    const averages = getAveragesFromDays(days);
    const now = getAppDate();
    if (qa === 'wake') {
      e.preventDefault();
      handleWakeUp(days, averages, onReload, now);
    } else if (qa === 'alarm') {
      e.preventDefault();
      handleAlarmNow(days, averages, onReload, now);
    } else if (qa === 'bed-now') {
      e.preventDefault();
      handleBedNow(days, averages, onReload, now);
    } else if (qa === 'sleep-0') {
      e.preventDefault();
      handleSleepAt(days, averages, onReload, now, 0);
    } else if (qa === 'sleep-10') {
      e.preventDefault();
      handleSleepAt(days, averages, onReload, now, 10);
    } else if (qa === 'bathroom-trip') {
      e.preventDefault();
      handleBathroomTripNow(days, averages, onReload, now);
    } else if (qa === 'nap-start') {
      e.preventDefault();
      handleNapStart(days, averages, onReload, now).then(function () {
        renderQuickActions(getDays(), onReload);
      });
    } else if (qa === 'nap-end') {
      e.preventDefault();
      handleNapEnd(days, averages, onReload, now).then(function () {
        renderQuickActions(getDays(), onReload);
      });
    }
  }

  function initDashboardQuickActions(getDays, onReload) {
    if (quickActionsIntervalId) {
      clearInterval(quickActionsIntervalId);
      quickActionsIntervalId = null;
    }
    if (boundClickHandler) {
      document.removeEventListener('click', boundClickHandler);
      boundClickHandler = null;
    }

    function refresh() {
      renderQuickActions(getDays(), onReload);
    }
    refresh();
    quickActionsIntervalId = window.setInterval(refresh, 60000);

    boundClickHandler = function (e) {
      onQuickActionClick(e, getDays, onReload);
    };
    document.addEventListener('click', boundClickHandler);
  }

  window.initDashboardQuickActions = initDashboardQuickActions;
  window.refreshDashboardQuickActions = function (days, onReload) {
    renderQuickActions(days, onReload);
  };
})();
