/*!
 * PlayBox Kashmir - Single-Hour Extend module
  * ------------------------------------------------------------------
   * What this does
    * Today the "Complete Payment" step shows a passive banner
     * ("Peak hour pick! Book 2 hours together...") that can't be acted on.
      * The customer has to go back to Step 2 to add another hour.
       *
        * This module adds a real "+ / -" stepper right on the payment step so
         * a customer who booked exactly ONE hour can extend their booking in
          * place, but ONLY when doing so is actually possible: the very next
           * hour on that date/facility must still be free (not booked, not past,
            * not after closing time). If the next hour is taken, the module simply
             * does not appear at all, so there are no dead-end buttons.
              *
               * It works for both peak and normal hours (the trigger has nothing to
                * do with CONFIG.peak_hours, it is purely "1 hour booked" plus "next
                 * hour is free"). When it does appear, it also hides the old static
                  * peak banner for that booking so the customer isn't shown two
                   * competing messages.
                    *
                     * How it integrates
                      * This file does NOT modify booking.js. It loads after it and wraps
                       * the existing global `renderPaymentStep()` function (booking.js calls
                        * this exact function, and only this function, whenever Step 4 is
                         * shown (see goToStep(4) in booking.js), so every place that already
                          * refreshes the payment step automatically refreshes this module too.
                           * It reuses booking.js's own globals: `state`, `CONFIG`,
                            * `isHourBlocked()`, `updateSelectedSlotSummary()`, `renderPaymentStep()`,
                             * and the same "/api/bookings?resource=availability" endpoint the slot
                              * grid already calls, so pricing, the booking summary, the slot hold
                               * (createSlotHold) and the reservation countdown all stay perfectly in
                                * sync automatically; this module never recomputes price itself.
                                 *
                                  * It also adds a small "reset" button right next to the stepper, visible
                                   * once the customer has extended their booking to 3 or more hours. It
                                    * simply jumps them back to their original 1-hour booking in one click,
                                     * instead of clicking "-" repeatedly. It never touches the reservation
                                      * countdown itself (see startReservationTimer()/CONFIG.reservation_minutes
                                       * in booking.js), that keeps counting down exactly as it always has.
                                        *
                                         * Installation
                                          * Add ONE line to book.html, right after booking.js:
                                           *   <script src="assets/js/booking.js"></script>
                                            *   <script src="assets/js/hour-extend.js"></script>   <-- add this line
                                             * That's it. No HTML/CSS changes needed, this file injects its own
                                              * markup and styles next to the order summary.
                                               */
(function () {
    'use strict';

  if (typeof window.renderPaymentStep !== 'function') {
    console.warn('[hour-extend] booking.js globals not found, module disabled.');
    return;
  }

  // ---- module state -------------------------------------------------
  var pbk = {
    active: false,     // true while WE are controlling an extended booking
    baseHour: null,    // the single hour the customer originally picked
    busy: false,       // true while an availability check / update is in flight
    mounted: false
};

  // ---- styling (scoped, theme-matched, injected once) ---------------
  function injectStyle() {
    if (document.getElementById('pbk-hour-extend-style')) return;
    var style = document.createElement('style');
    style.id = 'pbk-hour-extend-style';
    style.textContent =
            '.pbk-hour-extend{display:flex;align-items:center;justify-content:space-between;' +
              'gap:.75rem;margin:0 0 1rem;padding:.75rem .9rem;background:var(--white,#fff);' +
              'border:1px dashed var(--primary,#15803d);border-radius:var(--radius,12px);}' +
            '.pbk-hour-extend__label{display:flex;flex-direction:column;gap:.15rem;min-width:0;}' +
            '.pbk-hour-extend__title{font-size:.8rem;font-weight:700;color:var(--dark,#111827);' +
              'display:flex;align-items:center;gap:.4rem;}' +
            '.pbk-hour-extend__title i{color:var(--primary,#15803d);}' +
            '.pbk-hour-extend__hint{font-size:.72rem;color:var(--gray,#6b7280);}' +
            '.pbk-hour-extend__stepper{display:flex;align-items:center;gap:.6rem;flex-shrink:0;}' +
            '.pbk-hour-extend__btn{width:32px;height:32px;border-radius:50%;border:1.5px solid var(--primary,#15803d);' +
              'background:var(--white,#fff);color:var(--primary,#15803d);font-size:1.15rem;font-weight:700;' +
              'line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;' +
              'transition:var(--transition,all .3s ease);padding:0;}' +
            '.pbk-hour-extend__btn:hover:not(:disabled){background:var(--primary,#15803d);color:#fff;}' +
            '.pbk-hour-extend__btn:disabled{opacity:.35;cursor:not-allowed;}' +
            '.pbk-hour-extend__btn.is-loading{opacity:.6;cursor:wait;}' +
            '.pbk-hour-extend__count{min-width:46px;text-align:center;font-size:.85rem;font-weight:700;color:var(--dark,#111827);}' +
            '.pbk-hour-extend__reset{margin-left:.15rem;width:26px;height:26px;flex-shrink:0;border-radius:50%;' +
              'border:1.5px solid var(--gray-light,#9ca3af);background:var(--white,#fff);color:var(--gray,#6b7280);' +
              'font-size:.8rem;display:none;align-items:center;justify-content:center;cursor:pointer;padding:0;' +
              'transition:var(--transition,all .3s ease);}' +
            '.pbk-hour-extend__reset:hover:not(:disabled){background:var(--gray-light,#9ca3af);color:#fff;}' +
            '.pbk-hour-extend__btn, .pbk-hour-extend__reset{position:relative;}' +
            '.pbk-hour-extend__btn[data-tip]:hover::after, .pbk-hour-extend__reset[data-tip]:hover::after{' +
              'content:attr(data-tip);position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);' +
              'background:var(--dark,#111827);color:#fff;font-size:.65rem;font-weight:600;line-height:1;' +
              'padding:.3rem .5rem;border-radius:6px;white-space:nowrap;pointer-events:none;z-index:5;' +
              'box-shadow:var(--shadow-sm,0 1px 2px rgba(0,0,0,.05));}' +
            '.pbk-hour-extend__btn[data-tip]:hover::before, .pbk-hour-extend__reset[data-tip]:hover::before{' +
              'content:"";position:absolute;bottom:100%;left:50%;transform:translateX(-50%);' +
              'border:4px solid transparent;border-top-color:var(--dark,#111827);pointer-events:none;z-index:5;}' +
            '@media (max-width:480px){.pbk-hour-extend{flex-direction:column;align-items:stretch;text-align:center;}' +
              '.pbk-hour-extend__stepper{justify-content:center;}}';
    document.head.appendChild(style);
  }

  // ---- markup (mounted once, right under the order summary rows) ----
  function mount() {
    if (pbk.mounted) return document.getElementById('pbkHourExtend');
    var finalSummary = document.getElementById('finalSummary');
    if (!finalSummary || !finalSummary.parentNode) return null;

    var wrap = document.createElement('div');
    wrap.id = 'pbkHourExtend';
    wrap.className = 'pbk-hour-extend';
    wrap.style.display = 'none';
    wrap.innerHTML =
            '<div class="pbk-hour-extend__label">' +
              '<span class="pbk-hour-extend__title"><i class="fas fa-clock"></i> Add more time?</span>' +
              '<span class="pbk-hour-extend__hint" id="pbkHourHint">The next hour is open, extend your slot now.</span>' +
            '</div>' +
            '<div class="pbk-hour-extend__stepper">' +
              '<button type="button" class="pbk-hour-extend__btn" id="pbkHourMinus" aria-label="Remove hours" data-tip="Remove hours">&minus;</button>' +
              '<span class="pbk-hour-extend__count" id="pbkHourCount" aria-live="polite">1 Hr</span>' +
              '<button type="button" class="pbk-hour-extend__btn" id="pbkHourPlus" aria-label="Add hours" data-tip="Add hours">+</button>' +
              '<button type="button" class="pbk-hour-extend__reset" id="pbkHourReset" aria-label="Reset" data-tip="Reset"><i class="fas fa-rotate-left"></i></button>' +
            '</div>';

    // Sits right below the booking summary rows, above the price breakdown.
    // It does not touch #finalSummary's own innerHTML, which booking.js rewrites
    // on every render, so this control survives every re-render untouched.
    finalSummary.parentNode.insertBefore(wrap, finalSummary.nextSibling);

    document.getElementById('pbkHourPlus').addEventListener('click', onPlus);
    document.getElementById('pbkHourMinus').addEventListener('click', onMinus);
    document.getElementById('pbkHourReset').addEventListener('click', onReset);
    pbk.mounted = true;
    return wrap;
  }

  // ---- helpers --------------------------------------------------------
  function dateKeyOf(date) {
    if (typeof window.toLocalDateKey === 'function') return window.toLocalDateKey(date);
    var y = date.getFullYear();
    var m = String(date.getMonth() + 1).padStart(2, '0');
    var d = String(date.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }

  function isPastOrOutOfHours(hour) {
    if (hour >= CONFIG.slots.end) return true;
    var today = new Date();
    var isToday = state.date && state.date.toDateString() === today.toDateString();
    if (isToday && (hour % 24) <= today.getHours()) return true;
    return false;
  }

  // Same endpoint booking.js's own renderSlots() uses, so we see live,
  // real availability (including other customers' bookings and holds).
  function fetchBlockedRanges() {
    if (!state.date || !state.facilityDbId) return Promise.resolve([]);
    var dateKey = dateKeyOf(state.date);
    return fetch('/api/bookings?resource=availability&date=' + dateKey +
              '&facility_id=' + state.facilityDbId +
              '&hold_token=' + encodeURIComponent(state.holdToken || ''))
            .then(function (res) { return res.ok ? res.json() : { blocked: [] }; })
      .then(function (data) { return data.blocked || []; })
      .catch(function () { return []; });
  }

  function isHourFree(hour, blockedRanges) {
    if (isPastOrOutOfHours(hour)) return false;
    for (var i = 0; i < blockedRanges.length; i++) {
      if (window.isHourBlocked(hour, blockedRanges[i])) return false;
    }
    return true;
  }

  // Mirrors booking.js's own peak-banner condition so we can restore it
  // correctly when our module decides not to take over.
  function restorePeakBanner(hrs) {
    var banner = document.getElementById('peakUpsellBanner');
    if (!banner) return;
    var isPeakSlot = hrs.some(function (h) { return CONFIG.peak_hours.indexOf(h % 24) !== -1; });
    banner.style.display = (isPeakSlot && hrs.length === 1) ? 'flex' : 'none';
  }

  function suppressPeakBanner() {
    var banner = document.getElementById('peakUpsellBanner');
    if (banner) banner.style.display = 'none';
  }

  // ---- rendering --------------------------------------------------------
  function setBusyUI(busy) {
    ['pbkHourPlus', 'pbkHourMinus'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.classList.toggle('is-loading', busy);
  });
}

  function renderControls(hrsLen, canGrow) {
    var wrap = document.getElementById('pbkHourExtend');
    if (!wrap) return;
    wrap.style.display = 'flex';
    var countEl = document.getElementById('pbkHourCount');
    var hintEl = document.getElementById('pbkHourHint');
    var plus = document.getElementById('pbkHourPlus');
    var minus = document.getElementById('pbkHourMinus');
    var resetBtn = document.getElementById('pbkHourReset');
    if (countEl) countEl.textContent = hrsLen + ' Hr';
    if (minus) minus.disabled = pbk.busy || hrsLen <= 1;
    if (plus) plus.disabled = pbk.busy || !canGrow;
    if (resetBtn) {
      // Only worth offering once there are at least 3 hours to undo in one go.
      resetBtn.style.display = hrsLen >= 3 ? 'inline-flex' : 'none';
      resetBtn.disabled = pbk.busy;
    }
    if (hintEl) {
      hintEl.textContent = pbk.busy
                ? 'Checking availability…'
                : (canGrow
                  ? 'The next hour is open, extend your slot now.'
                  : "That's the max for now, no free hour right after this slot.");
    }
  }

  function hide() {
    var wrap = document.getElementById('pbkHourExtend');
    if (wrap) wrap.style.display = 'none';
  }

  // ---- button handlers --------------------------------------------------
  function onPlus() {
    if (pbk.busy) return;
    var hrs = state.selectedHours || [];
    if (!hrs.length) return;
    var nextHour = Math.max.apply(null, hrs) + 1;

    pbk.busy = true;
    setBusyUI(true);
    fetchBlockedRanges().then(function (blocked) {
            pbk.busy = false;
      setBusyUI(false);
      if (!isHourFree(nextHour, blocked)) {
        renderControls(hrs.length, false); // someone else took it, just disable +
        return;
      }
      hrs.push(nextHour);
      hrs.sort(function (a, b) { return a - b; });
      window.updateSelectedSlotSummary();
      window.renderPaymentStep(); // recomputes price, summary, slot hold, timer, and re-runs our refresh()
    });
  }

  function onMinus() {
    if (pbk.busy) return;
    var hrs = state.selectedHours || [];
    if (hrs.length <= 1) return;
    hrs.pop();
    window.updateSelectedSlotSummary();
    window.renderPaymentStep();
  }

  // Jumps straight back to the original 1-hour booking in one click,
  // instead of clicking "-" repeatedly. Only relevant once we are the
  // ones controlling the extended selection (see pbk.active below).
  function onReset() {
    if (pbk.busy) return;
    if (!pbk.active || pbk.baseHour === null) return;
    var hrs = state.selectedHours || [];
    if (hrs.length <= 1) return;
    state.selectedHours = [pbk.baseHour];
    window.updateSelectedSlotSummary();
    window.renderPaymentStep();
  }

  // ---- core decision logic --------------------------------------------
  function evaluate() {
    var hrs = (state.selectedHours || []).slice().sort(function (a, b) { return a - b; });

    if (!hrs.length) { hide(); return; }

    // Case 1: we are already actively controlling this booking (the
    // customer used our + / - at least once already this visit). Keep
    // controlling it as long as the booking still starts at the same hour.
    if (pbk.active && pbk.baseHour !== null && hrs[0] === pbk.baseHour) {
      suppressPeakBanner();
      var currentMax = hrs[hrs.length - 1];
      pbk.busy = true;
      renderControls(hrs.length, false); // optimistic disable while we re-check
      fetchBlockedRanges().then(function (blocked) {
                pbk.busy = false;
        renderControls(hrs.length, isHourFree(currentMax + 1, blocked));
      });
      return;
    }

    // Case 2: fresh booking / fresh visit to Step 4. Only offer the
    // module when exactly one hour is booked.
    pbk.active = false;
    pbk.baseHour = null;
    if (hrs.length !== 1) { hide(); restorePeakBanner(hrs); return; }

    var baseHour = hrs[0];
    suppressPeakBanner(); // optimistic, avoids a banner flash while we check
    fetchBlockedRanges().then(function (blocked) {
            var canGrow = isHourFree(baseHour + 1, blocked);
      if (!canGrow) {
        hide();
        restorePeakBanner(hrs); // fall back to the original passive nudge, if applicable
        return;
      }
      pbk.active = true;
      pbk.baseHour = baseHour;
      renderControls(1, true);
    });
  }

  function refresh() {
    if (!mount()) return;
    injectStyle();
    evaluate();
  }

  // ---- wire into booking.js's existing render cycle ---------------------
  // booking.js calls renderPaymentStep() exactly once, every time Step 4
  // is shown (see goToStep(4)). Wrapping it means we never need to touch
  // booking.js and we automatically stay in sync with it.
  var originalRenderPaymentStep = window.renderPaymentStep;
  window.renderPaymentStep = function () {
    var result = originalRenderPaymentStep.apply(this, arguments);
    refresh();
    return result;
  };
})();
