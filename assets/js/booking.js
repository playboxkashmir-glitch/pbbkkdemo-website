const SPORT_META = {
     football: { name: 'Football Turf', icon: 'fas fa-futbol', color: '#15803d', comingSoon: false },
         boxcricket: { name: 'Box Cricket', icon: 'fas fa-baseball-ball', color: '#15803d', comingSoon: false }
};

let facilitiesLoaded = false;
let pendingSportSelection = null;

const CONFIG = {
   facilities: {},
       slots: {
                start: 5,
                end: 26,
                duration: 60
       },
       peak_hours: [18, 19, 20, 21],
       weekend_days: [0, 6],
       gst_rate: 0,
       convenience_fee: 7,
       inaugural_discount_pct: 15,
       reserve_amount: 500,
       reservation_minutes: 10
};

function toLocalDateKey(date) { if (!date) return ''; var y = date.getFullYear(); var m = String(date.getMonth() + 1).padStart(2, '0'); var d = String(date.getDate()).padStart(2, '0'); return y + '-' + m + '-' + d; }

  let state = {
         step: 1,
         sport: null,
         sportName: null,
         facilityId: null,
         facilityDbId: null,
         facilityName: null,
         facilityPrice: 0,
         facilityPeakPrice: 0,
         date: null,
         dateFormatted: null,
         slotTime: null,
         slotLabel: null, selectedHours: [],
         customerName: null,
         customerPhone: null,
         customerEmail: null,
         customerNotes: null, welcomeBackName: null,
         promoCode: null,
         promoType: null,
         promoValue: 0,
         promoMinAmount: 0,
         promoDiscount: 0,
         basePrice: 0,
         gstAmount: 0,
         totalAmount: 0,
         paymentMode: 'full',
         isReserve: false,
         fullAmount: 0,
         reserveAmount: 0,
         balanceDue: 0,
         bookingId: null,
         reservationTimer: null,
         reservationSeconds: CONFIG.reservation_minutes * 60
  };

  async function loadFacilities() {
         try {
      const res = await fetch('/api/facilities');
      if (!res.ok) throw new Error('Failed to load facilities');
      const data = await res.json();
      const facilities = {};
      (data.facilities || []).forEach(function (f) {
         const meta = SPORT_META[f.sport_key] || { name: f.sport_name, icon: 'fas fa-star', color: '#15803d', comingSoon: false };
         if (!facilities[f.sport_key]) {
            facilities[f.sport_key] = {
               name: meta.name,
               icon: meta.icon,
               color: meta.color,
               comingSoon: meta.comingSoon,
               options: []
            };
         }
         if (f.is_active !== false) {
            facilities[f.sport_key].options.push({
               id: f.option_id,
               dbId: f.id,
               name: f.option_name,
               price: Number(f.base_price),
               peak_price: Number(f.peak_price)
            });
         }
      });
      CONFIG.facilities = facilities;
      updateStaticPriceDisplays();
   } catch (err) {
      console.error('Could not load facilities from server:', err);
   } finally {
              facilitiesLoaded = true;
              document.body.classList.remove('facilities-loading');
              if (pendingSportSelection && CONFIG.facilities[pendingSportSelection]) {
                   const s = pendingSportSelection;
                   pendingSportSelection = null;
                   selectSport(s);
              }
         }
}

async function loadSettings() {
     try {
            const res = await fetch('/api/settings');
            if (!res.ok) return;
            const data = await res.json();
            const fee = parseFloat(data.convenience_fee);
            if (!isNaN(fee)) {
                     CONFIG.convenience_fee = fee;
            }
          if (Array.isArray(data.peak_hours) && data.peak_hours.length) { CONFIG.peak_hours = data.peak_hours; } var inauguralPct = parseFloat(data.inaugural_discount_pct); if (!isNaN(inauguralPct)) { CONFIG.inaugural_discount_pct = inauguralPct; }
          var reserveAmt = parseFloat(data.reserve_amount); if (!isNaN(reserveAmt)) { CONFIG.reserve_amount = reserveAmt; }
     } catch (err) {
            console.error('Could not load settings from server:', err);
     }
}


function updateStaticPriceDisplays() {
   document.querySelectorAll('[data-live-price]').forEach(function (el) {
      const optionId = el.getAttribute('data-live-price');
      for (const sportKey in CONFIG.facilities) {
         const match = CONFIG.facilities[sportKey].options.find(function (o) { return o.id === optionId; });
         if (match) {
            el.textContent = '₹' + (match.price - Math.round(match.price * CONFIG.inaugural_discount_pct / 100));
         }
      }
   });
}

function goToStep(stepNum) {
   const currentStep = document.getElementById('step-' + state.step);
   const nextStep = document.getElementById('step-' + stepNum);
   if (!nextStep) return;
   if (currentStep) currentStep.style.display = 'none';
   nextStep.style.display = 'block';
for (let i = 1; i <= 5; i++) {
   const indicator = document.getElementById('step-indicator-' + i);
   if (!indicator) continue;
   indicator.classList.remove('active', 'completed');
   if (i < stepNum) indicator.classList.add('completed');
   else if (i === stepNum) indicator.classList.add('active');
}
   state.step = stepNum;
   window.scrollTo({ top: 0, behavior: 'smooth' });
   if (stepNum === 2) renderCalendar();
   if (stepNum === 3) renderSummaryStep3();
   if (stepNum === 4) renderPaymentStep();
}

function selectSport(sport) {
   if (!CONFIG.facilities[sport]) {
if (!facilitiesLoaded) {
     pendingSportSelection = sport;
     return;
}
        alert('This sport is not available for booking right now.');
        return;
   }
   if (CONFIG.facilities[sport].comingSoon) {
      alert(CONFIG.facilities[sport].name + ' is coming soon. Bookings are not available yet.');
      return;
   }
   state.sport = sport;
   state.sportName = CONFIG.facilities[sport].name;
   state.facilityId = null;
   state.facilityDbId = null;
   state.facilityName = null;
   state.facilityPrice = 0;
document.querySelectorAll('.sport-card').forEach(function (el) { el.classList.remove('selected'); });
   const card = document.querySelector('[data-sport="' + sport + '"]');
   if (card) card.classList.add('selected');
const facilitySelector = document.getElementById('facilitySelector');
   const facilitiesList = document.getElementById('facilitiesList');
   if (facilitySelector) facilitySelector.style.display = 'block';
const options = CONFIG.facilities[sport].options;
   if (facilitiesList) {
      facilitiesList.innerHTML = options.map(function (opt) {
         return '<button class="facility-btn" data-facility="' + opt.id + '" onclick="selectFacility(\'' + opt.id + '\', ' + opt.dbId + ', \'' + opt.name + '\', ' + opt.price + ', ' + opt.peak_price + ')">' + opt.name + '</button>';
      }).join('');
   }
   if (options.length === 1) { selectFacility(options[0].id, options[0].dbId, options[0].name, options[0].price, options[0].peak_price); } else { checkStep1Complete(); }
}

function selectFacility(id, dbId, name, price, peakPrice) {
   state.facilityId = id;
   state.facilityDbId = dbId;
   state.facilityName = name;
   state.facilityPrice = price;
   state.facilityPeakPrice = peakPrice;
   document.querySelectorAll('.facility-btn').forEach(function (el) { el.classList.remove('selected'); });
   const btn = document.querySelector('[data-facility="' + id + '"]');
   if (btn) btn.classList.add('selected');
   checkStep1Complete();
}

function checkStep1Complete() {
   const btn = document.getElementById('btn-step1-next');
   if (!btn) return;
   btn.disabled = !(state.sport && state.facilityId);
}

let currentCalDate = new Date();

function renderCalendar() {
   const year = currentCalDate.getFullYear();
   const month = currentCalDate.getMonth();
   const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
   const monthYearEl = document.getElementById('calMonthYear');
   if (monthYearEl) monthYearEl.textContent = monthNames[month] + ' ' + year;
   const firstDay = new Date(year, month, 1).getDay();
   const daysInMonth = new Date(year, month + 1, 0).getDate();
   const today = new Date();
   today.setHours(0, 0, 0, 0);
   let html = '';
   for (let i = 0; i < firstDay; i++) {
      html += '<div class="cal-day empty"></div>';
   }
   for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month, d);
      date.setHours(0, 0, 0, 0);
      const isToday = date.getTime() === today.getTime();
      const isPast = date < today;
      const isSelected = state.date && state.date.getTime() === date.getTime();
      let classes = 'cal-day';
      if (isToday) classes += ' today';
      if (isPast) classes += ' disabled';
      if (isSelected) classes += ' selected';
      if (isPast) {
         html += '<div class="' + classes + '">' + d + '</div>';
      } else {
         html += '<div class="' + classes + '" onclick="selectDate(' + year + ',' + month + ',' + d + ')">' + d + '</div>';
      }
   }
   const calDaysEl = document.getElementById('calDays');
   if (calDaysEl) calDaysEl.innerHTML = html;
}

function prevMonth() {
   currentCalDate.setMonth(currentCalDate.getMonth() - 1);
   renderCalendar();
}

function nextMonth() {
   currentCalDate.setMonth(currentCalDate.getMonth() + 1);
   renderCalendar();
}

function selectDate(year, month, day) {
   state.date = new Date(year, month, day);
   state.slotTime = null;
   state.slotLabel = null; state.selectedHours = []; state.basePrice = 0;
   const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
   state.dateFormatted = state.date.toLocaleDateString('en-IN', dateOptions);
   const displayEl = document.getElementById('selectedDateDisplay');
   if (displayEl) displayEl.innerHTML = '<i class="fas fa-calendar-day"></i><span>' + state.dateFormatted + '</span>';
   renderCalendar();
   renderSlots();
   updateStep2Btn();
}

async function renderSlots() {
   const slotsGrid = document.getElementById('slotsGrid');
   if (!slotsGrid || !state.date || !state.facilityId) return;
   const dateKey = toLocalDateKey(state.date);
   slotsGrid.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:#9ca3af;">Loading available slots...</p>';
   let blockedRanges = [];
   try {
      const res = await fetch('/api/bookings?resource=availability&date=' + dateKey + '&facility_id=' + state.facilityDbId + '&hold_token=' + encodeURIComponent(state.holdToken || ''));
      if (res.ok) {
         const data = await res.json();
         blockedRanges = (data.blocked || []);
      }
   } catch (err) {
      console.error('Could not check slot availability:', err);
   }
if (!state.date || toLocalDateKey(state.date) !== dateKey) return;

const today = new Date();
   const isToday = state.date.toDateString() === today.toDateString();
   const currentHour = today.getHours();
   let html = '';
   for (let hour = CONFIG.slots.start; hour < CONFIG.slots.end; hour++) {
      const startTime = formatTime(hour % 24);
      const endTime = formatTime((hour + 1) % 24);
      const slotKey = (hour % 24) + ':00';
      const isBooked = blockedRanges.some(function (b) { return isHourBlocked(hour, b); });
      const isPast = isToday && (hour % 24) <= currentHour;
      const isPeak = CONFIG.peak_hours.includes(hour % 24);
      let rawPrice = isPeak ? state.facilityPeakPrice : state.facilityPrice; let price = rawPrice - Math.round(rawPrice * CONFIG.inaugural_discount_pct / 100);
      const priceDisplay = isPeak ? ('₹' + price + ' <span style="font-size:0.65rem;color:#f59e0b;">Peak</span>') : ('₹' + price);
      let slotClass = 'slot-btn';
      if (isBooked || isPast) slotClass += ' booked';
      const isSelected = state.selectedHours.indexOf(hour) !== -1;
      if (isSelected) slotClass += ' selected';
      if (isBooked || isPast) {
         html += '<button class="' + slotClass + '" disabled><span class="slot-time">' + startTime + ' - ' + endTime + '</span><span class="slot-price">Booked</span></button>';
      } else {
         html += '<button class="' + slotClass + '" onclick="toggleSlot(' + hour + ')"><span class="slot-time">' + startTime + ' - ' + endTime + '</span><span class="slot-price">' + priceDisplay + '</span></button>';
      }
   }
   slotsGrid.innerHTML = html;
}

function formatTime(hour) {
   if (hour === 0) return '12:00 AM';
   if (hour === 12) return '12:00 PM';
   if (hour < 12) return hour + ':00 AM';
   return (hour - 12) + ':00 PM';
}

function toggleSlot(hour) {
   var hrs = state.selectedHours; var idx = hrs.indexOf(hour); if (idx !== -1) { var isEnd = hour === hrs[0] || hour === hrs[hrs.length - 1]; if (isEnd) { hrs.splice(idx, 1); } else { state.selectedHours = [hour]; } } else if (hrs.length === 0) { state.selectedHours = [hour]; } else { var mn = Math.min.apply(null, hrs); var mx = Math.max.apply(null, hrs); if (hour === mx + 1 || hour === mn - 1) { hrs.push(hour); } else { state.selectedHours = [hour]; } } state.selectedHours.sort(function (a, b) { return a - b; }); updateSelectedSlotSummary(); renderSlots(); updateStep2Btn();
   
   
   
   
   
   
}

function isHourBlocked(hour, block) { var s = parseInt(String(block.start_time).split(':')[0], 10); var e = parseInt(String(block.end_time).split(':')[0], 10); var h = hour % 24; if (e > s) { return h >= s && h < e; } return h >= s || h < e; } function updateSelectedSlotSummary() { var hrs = state.selectedHours; if (!hrs || !hrs.length) { state.slotTime = null; state.slotLabel = null; state.basePrice = 0; return; } var first = hrs[0]; var last = hrs[hrs.length - 1]; state.slotTime = (first % 24) + ':00'; var total = 0; for (var i = 0; i < hrs.length; i++) { var hh = hrs[i] % 24; total += (CONFIG.peak_hours.indexOf(hh) !== -1) ? state.facilityPeakPrice : state.facilityPrice; } state.basePrice = total; state.slotLabel = formatTime(first % 24) + ' - ' + formatTime((last + 1) % 24) + ' (' + hrs.length + (hrs.length > 1 ? ' hrs)' : ' hr)'); } function updateStep2Btn() {
   const btn = document.getElementById('btn-step2-next');
   if (!btn) return;
   btn.disabled = !(state.date && state.selectedHours && state.selectedHours.length);
}

function renderSummaryStep3() {
   const el = document.getElementById('summaryItems3');
   if (!el) return;
   calculatePrice();
   el.innerHTML = buildSummaryRows();
}

function buildSummaryRows() {
const rows = []; rows.push(['Sport', state.sportName]); rows.push(['Facility', state.facilityName]); rows.push(['Date', state.dateFormatted]); rows.push(['Time Slot', state.slotLabel]); rows.push(['Turf Price', '₹' + state.basePrice]); rows.push(['Inaugural Offer (-' + CONFIG.inaugural_discount_pct + '%)', '-₹' + state.inauguralDiscount]); if (state.promoDiscount > 0) { rows.push(['Promo (' + state.promoCode + ')', '-₹' + state.promoDiscount]); } rows.push(['Subtotal', '₹' + state.discountedSubtotal]);
   return rows.map(function (r) {
      return '<div class="summary-row"><span class="label">' + r[0] + '</span><span class="value">' + r[1] + '</span></div>';
   }).join('');
}
function buildBookingInfoRows() { const rows = []; rows.push(['Sport', state.sportName]); rows.push(['Facility', state.facilityName]); rows.push(['Date', state.dateFormatted]); rows.push(['Time Slot', state.slotLabel]); return rows.map(function (r) { return '<div class="summary-row"><span class="label">' + r[0] + '</span><span class="value">' + r[1] + '</span></div>'; }).join(''); }

function calculatePrice() { const original = state.basePrice; const inauguralDiscount = Math.round(original * CONFIG.inaugural_discount_pct / 100); state.inauguralDiscount = inauguralDiscount; const afterInaugural = original - inauguralDiscount; let price = afterInaugural; let discount = 0; if (state.promoCode && price >= state.promoMinAmount) { if (state.promoType === 'percent') { discount = Math.round(price * state.promoValue / 100); } else { discount = state.promoValue; } } state.promoDiscount = discount; const discounted = price - discount; state.discountedSubtotal = discounted; const convenienceFee = CONFIG.convenience_fee; state.gstAmount = convenienceFee; state.totalAmount = Math.round((discounted + convenienceFee) * 100) / 100; }
async function applyPromo() {
   const codeInput = document.getElementById('promoCode');
   const resultEl = document.getElementById('promoResult');
   const code = codeInput ? codeInput.value.trim().toUpperCase() : '';
   if (!resultEl) return;
   if (!code) {
      resultEl.textContent = 'Please enter a promo code.';
      resultEl.className = 'promo-result error';
      return;
   }
   resultEl.textContent = 'Checking promo code...';
   resultEl.className = 'promo-result';
   try {
      const res = await fetch('/api/promos?validate=' + encodeURIComponent(code));
      const data = await res.json();
      if (!res.ok || !data.promo) {
         state.promoCode = null;
         state.promoType = null;
         state.promoValue = 0;
         state.promoMinAmount = 0;
         calculatePrice(); renderSummaryStep3();
         resultEl.textContent = (data && data.error) || 'Invalid promo code. Please try again.';
         resultEl.className = 'promo-result error';
         return;
      }
      const promo = data.promo;
      const minAmount = Number(promo.min_amount);
      if (state.basePrice < minAmount) {
         resultEl.textContent = 'Minimum booking amount ₹' + minAmount + ' required for this code.';
         resultEl.className = 'promo-result error';
         return;
      }
      state.promoCode = promo.code;
      state.promoType = promo.type;
      state.promoValue = Number(promo.value);
      state.promoMinAmount = minAmount;
      calculatePrice(); renderSummaryStep3();
      const discountText = promo.type === 'percent' ? (promo.value + '% off') : ('₹' + promo.value + ' off');
      resultEl.textContent = '✓ Promo applied! ' + discountText;
      resultEl.className = 'promo-result success';
   } catch (err) {
      resultEl.textContent = 'Could not validate promo code. Please check your connection and try again.';
      resultEl.className = 'promo-result error';
   }
}

function validateAndProceed() {
   const name = document.getElementById('custName').value.trim();
   const phone = document.getElementById('custPhone').value.trim();
   const email = document.getElementById('custEmail').value.trim();
   let valid = true;
   if (!name || name.length < 2) {
      document.getElementById('err-name').textContent = 'Please enter your full name.';
      valid = false;
   } else {
      document.getElementById('err-name').textContent = '';
   }
   if (!phone || phone.replace(/\D/g, '').length < 10) {
      document.getElementById('err-phone').textContent = 'Please enter a valid phone number.';
      valid = false;
   } else {
      document.getElementById('err-phone').textContent = '';
   }
   if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      document.getElementById('err-email').textContent = 'Please enter a valid email address.';
      valid = false;
   } else {
      document.getElementById('err-email').textContent = '';
   }
   if (!valid) return;
   state.customerName = name;
   state.customerPhone = phone;
   state.customerEmail = email; lookupReturningCustomer(email);
   const notesEl = document.getElementById('custNotes');
   state.customerNotes = notesEl ? notesEl.value.trim() : '';
   calculatePrice();
   goToStep(4);
}

function lookupReturningCustomer(email) { if (!email) return; fetch('/api/bookings?resource=customer-lookup&email=' + encodeURIComponent(email)).then(function (r) { return r.ok ? r.json() : null; }).then(function (data) { state.welcomeBackFound = !!(data && data.found); state.welcomeBackName = null; var el = document.getElementById('welcomeBackMsg'); if (el) { if (state.welcomeBackFound) { el.textContent = 'Welcome back!'; el.style.display = 'flex'; } else { el.style.display = 'none'; } } }).catch(function () {}); } function renderPaymentStep() {
   calculatePrice();
   const finalSummary = document.getElementById('finalSummary'); var welcomeEl = document.getElementById('welcomeBackMsg'); if (welcomeEl) { if (state.welcomeBackFound) { welcomeEl.textContent = 'Welcome back!'; welcomeEl.style.display = 'flex'; } else { welcomeEl.style.display = 'none'; } }
   if (finalSummary) {
      finalSummary.innerHTML = buildBookingInfoRows() +
         '<div class="summary-row"><span class="label">Customer</span><span class="value">' + state.customerName + '</span></div>' +
         '<div class="summary-row"><span class="label">Email</span><span class="value">' + state.customerEmail + '</span></div>';
   }
   const slotPriceEl = document.getElementById('pay-slot-price');
   if (slotPriceEl) slotPriceEl.textContent = '₹' + state.basePrice;
   const inaugRow = document.getElementById('inauguralRow'); if (inaugRow) { if (state.inauguralDiscount > 0) { inaugRow.style.display = 'flex'; const payInaugEl = document.getElementById('pay-inaugural'); if (payInaugEl) payInaugEl.textContent = '-₹' + state.inauguralDiscount; } else { inaugRow.style.display = 'none'; } }
   const gstEl = document.getElementById('pay-gst');
   if (gstEl) gstEl.textContent = '₹' + state.gstAmount;
   state.paymentMode = 'full';
        var modeFullBtn = document.getElementById('modeFullBtn'); var modeReserveBtn = document.getElementById('modeReserveBtn');
        if (modeFullBtn) modeFullBtn.classList.add('active');
        if (modeReserveBtn) modeReserveBtn.classList.remove('active');
        updatePaymentModeUI();
     const discRow = document.getElementById('discountRow');
   if (discRow) {
      if (state.promoDiscount > 0) {
         discRow.style.display = 'flex';
         const payDiscEl = document.getElementById('pay-discount');
         if (payDiscEl) payDiscEl.textContent = '-₹' + state.promoDiscount;
      } else {
         discRow.style.display = 'none';
      }
   }
       const upsellEl = document.getElementById('peakUpsellBanner');
       if (upsellEl) {
                
                const isPeakSlot = (state.selectedHours || []).some(function (h) { return CONFIG.peak_hours.indexOf(h % 24) !== -1; });
upsellEl.style.display = (isPeakSlot && (state.selectedHours || []).length === 1) ? 'flex' : 'none';       }
   startReservationTimer();
   createSlotHold();
}
function setPaymentMode(mode) {
        state.paymentMode = (mode === 'reserve') ? 'reserve' : 'full';
        var modeFullBtn = document.getElementById('modeFullBtn');
        var modeReserveBtn = document.getElementById('modeReserveBtn');
        if (modeFullBtn) modeFullBtn.classList.toggle('active', state.paymentMode === 'full');
        if (modeReserveBtn) modeReserveBtn.classList.toggle('active', state.paymentMode === 'reserve');
        updatePaymentModeUI();
}

function updatePaymentModeUI() {
        var isReserveMode = state.paymentMode === 'reserve';
        var reserveRow = document.getElementById('reservePriceRow');
        var balanceRow = document.getElementById('balanceRow');
        var reserveNote = document.getElementById('reserveHelperNote');
        var totalLabel = document.getElementById('payTotalLabel');
        var totalEl = document.getElementById('pay-total');
        var payBtnAmount = document.getElementById('btnPayAmount');
        var amountNow = state.totalAmount;
        if (isReserveMode) {
                   var reserveAmt = CONFIG.reserve_amount;
                   var balance = Math.max(Math.round(((state.discountedSubtotal || 0) - reserveAmt) * 100) / 100, 0);
                   amountNow = Math.round((reserveAmt + CONFIG.convenience_fee) * 100) / 100;
                         if (reserveRow) { reserveRow.style.display = 'flex'; var prEl = document.getElementById('pay-reserve'); if (prEl) prEl.textContent = '₹' + reserveAmt; }
                         if (balanceRow) { balanceRow.style.display = 'flex'; var pbEl = document.getElementById('pay-balance'); if (pbEl) pbEl.textContent = '₹' + balance; }
                   if (reserveNote) reserveNote.style.display = 'flex';
                   if (totalLabel) totalLabel.textContent = 'Total Payable Now';
        } else {
                   if (reserveRow) reserveRow.style.display = 'none';
                   if (balanceRow) balanceRow.style.display = 'none';
                   if (reserveNote) reserveNote.style.display = 'none';
                   if (totalLabel) totalLabel.textContent = 'Total Payable';
        }
              if (totalEl) totalEl.innerHTML = '<strong>₹' + amountNow + '</strong>';
              if (payBtnAmount) payBtnAmount.textContent = '₹' + amountNow;
}


function startReservationTimer() {
   const timerEl = document.getElementById('reservationTimer');
   const display = document.getElementById('timerDisplay');
   if (!timerEl || !display) return;
   timerEl.style.display = 'block';
   state.reservationSeconds = CONFIG.reservation_minutes * 60;
   if (state.reservationTimer) clearInterval(state.reservationTimer);
   state.reservationTimer = setInterval(function () {
      state.reservationSeconds--;
      const mins = Math.floor(state.reservationSeconds / 60);
      const secs = state.reservationSeconds % 60;
      display.textContent = mins + ':' + (secs < 10 ? '0' : '') + secs;
      if (state.reservationSeconds <= 0) {
         clearInterval(state.reservationTimer);
         timerEl.style.display = 'none';
         alert('Your slot reservation has expired. Please select a new slot.');
         goToStep(1);
      }
   }, 1000);
}

function stopReservationTimer() {
   if (state.reservationTimer) {
      clearInterval(state.reservationTimer);
      state.reservationTimer = null;
   }
   const timerEl = document.getElementById('reservationTimer');
   if (timerEl) timerEl.style.display = 'none';
}
function createSlotHold() { if (!state.facilityDbId || !state.date || !(state.selectedHours && state.selectedHours.length)) return; var dateKey = toLocalDateKey(state.date); var slots = state.selectedHours.map(function (h) { return { start_time: (h % 24) + ':00', end_time: ((h + 1) % 24) + ':00' }; }); if (!state.holdToken) { state.holdToken = 'H' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); } fetch('/api/bookings?resource=hold', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ facility_id: state.facilityDbId, booking_date: dateKey, slots: slots, hold_token: state.holdToken }) }).catch(function (err) { console.error('Could not place slot hold:', err); }); }

function initiatePayment(mode) {
     if (window.PBKEnsureMaintenanceAccepted && !window.PBKEnsureMaintenanceAccepted(function () { initiatePayment(mode); })) { return; }
        state.paymentMode = (mode === 'reserve') ? 'reserve' : 'full';
var agreeBox = document.getElementById('agree-terms');
   if (agreeBox && !agreeBox.checked) {
      var wrap = document.getElementById('agree-terms-wrap');
      if (wrap) wrap.classList.add('error');
      if (typeof showToast === 'function') {
         showToast('Please accept the Privacy Policy and Terms & Conditions to continue.', 'error');
      } else {
         alert('Please accept the Privacy Policy and Terms & Conditions to continue.');
      }
      if (agreeBox.scrollIntoView) agreeBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
   }
   showLoading('Initializing payment...');
state.bookingId = 'PBK' + Date.now().toString(36).toUpperCase();
createRazorpayOrder().then(function () {
   hideLoading();
                           if (typeof Razorpay === 'undefined') {
   const script = document.createElement('script');
                              script.src = 'https://checkout.razorpay.com/v1/checkout.js';
                              script.onload = openRazorpay;
                              script.onerror = function () {
                                 alert('Payment gateway could not be loaded. Please check your internet connection and try again.');
                              };
                              document.head.appendChild(script);
                           } else {
                              openRazorpay();
                           }
}).catch(function (err) {
   hideLoading();
   alert(err && err.message ? err.message : 'Could not start payment. Please try again.');
});
}

function createRazorpayOrder() {
   return fetch('/api/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
         facility_id: state.facilityId, booking_date: (state.date ? toLocalDateKey(state.date) : ''), hours: (state.selectedHours || []).slice(), promo_code: (state.promoCode || null), terms_accepted: true,
         payment_mode: state.paymentMode || 'full',
         currency: 'INR',
         receipt: state.bookingId,
         notes: {
            booking_id: state.bookingId,
            sport: state.sport,
            facility_id: state.facilityId,
            facility: state.facilityName,
            customer_name: state.customerName,
            customer_email: state.customerEmail,
            customer_phone: state.customerPhone,
          customer_notes: state.customerNotes,
            booking_date: state.date ? toLocalDateKey(state.date) : '',
            start_time: (function () { var hh = (state.selectedHours && state.selectedHours[0] !== undefined) ? state.selectedHours[0] : parseInt(String(state.slotTime).split(':')[0], 10); return (hh % 24) + ':00'; })(),
            end_time: (function () {
               var hrsArr = state.selectedHours || []; var h = hrsArr.length ? hrsArr[hrsArr.length - 1] : parseInt(String(state.slotTime).split(':')[0], 10);
               return ((h + 1) % 24) + ':00';
            })(),
            rate: state.basePrice,
            amount: state.totalAmount
         }
      })
   }).then(function (res) {
      if (!res.ok) throw new Error('Order creation failed. Please try again.');
      return res.json();
   }).then(function (data) {
      if (!data || !data.id) throw new Error('Invalid order response from server.');
      state.razorpayOrderId = data.id; if (typeof data.amount === 'number') { state.totalAmount = data.amount / 100; var totalEl = document.getElementById('pay-total'); if (totalEl) totalEl.innerHTML = '<strong>₹' + state.totalAmount + '</strong>'; var payBtnAmount = document.getElementById('btnPayAmount'); if (payBtnAmount) payBtnAmount.textContent = '₹' + state.totalAmount; } state.isReserve = !!data.is_reserve; state.fullAmount = (typeof data.full_amount === 'number') ? data.full_amount : state.totalAmount; state.reserveAmount = (typeof data.reserve_amount === 'number') ? data.reserve_amount : 0; state.balanceDue = (typeof data.balance_due === 'number') ? data.balance_due : 0;
      return data;
   });
}

function verifyAndConfirm(response) {
   showLoading('Verifying payment...');
   fetch('/api/verify-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
         razorpay_order_id: response.razorpay_order_id,
         razorpay_payment_id: response.razorpay_payment_id,
         razorpay_signature: response.razorpay_signature
      })
   }).then(function (res) {
      return res.json().then(function (data) { return { res: res, data: data }; });
   }).then(function (result) {
      hideLoading();
      if (result.res.ok && result.data && result.data.verified) {
         handlePaymentSuccess(response);
      } else {
         alert('Payment could not be verified. If money was deducted, it will be refunded. Please contact support.');
      }
   }).catch(function () {
      hideLoading();
      alert('Payment verification failed due to a network error. Please contact support with your payment ID.');
   });
}

function openRazorpay() {
   const options = {
      key: 'rzp_live_T90dB0bfW4qEMO',
      amount: Math.round(state.totalAmount * 100),
      currency: 'INR',
      name: 'PlayBox Kashmir™',
      description: state.facilityName + ' - ' + state.slotLabel + ' on ' + state.dateFormatted + (state.isReserve ? ' (Reserve Payment)' : ''),
      image: 'https://playboxkashmir.com/assets/images/logo.png',
      order_id: state.razorpayOrderId,
      prefill: {
         name: state.customerName,
         email: state.customerEmail,
         contact: state.customerPhone
      },
      notes: {
         booking_id: state.bookingId,
         sport: state.sportName,
         facility: state.facilityName,
         date: state.dateFormatted,
         slot: state.slotLabel
      },
      theme: { color: '#15803d' },
      handler: function (response) {
         verifyAndConfirm(response);
      },
      modal: {
         ondismiss: function () {
            showPaymentCancelled();
         }
      }
   };
   try {
      const rzp = new Razorpay(options);
      rzp.open();
   } catch (err) {
      hideLoading();
      alert('Unable to open the payment gateway. Please refresh and try again.');
   }
}

function showPaymentCancelled() {
   const msg = document.createElement('div');
   msg.style.cssText = 'position:fixed;top:80px;right:1rem;background:#ef4444;color:#fff;padding:0.75rem 1.25rem;border-radius:10px;z-index:99999;box-shadow:0 10px 25px rgba(0,0,0,0.2);';
   msg.textContent = 'Payment cancelled. Your slot is still reserved for ' + CONFIG.reservation_minutes + ' minutes.';
   document.body.appendChild(msg);
   setTimeout(function () { msg.remove(); }, 4000);
}

function showConfirmation(paymentResponse) {
document.querySelectorAll('div').forEach(function (el) {
   if (el.style && el.style.position === 'fixed' && el.style.zIndex === '99999') {
      el.remove();
   }
});
   const confirmCard = document.getElementById('confirmCard');
   if (confirmCard) {
      confirmCard.innerHTML =
         '<div class="summary-row"><span class="label">Booking ID</span><span class="value" style="font-family:monospace;">' + state.bookingId + '</span></div>' +
         '<div class="summary-row"><span class="label">Sport</span><span class="value">' + state.sportName + '</span></div>' +
         '<div class="summary-row"><span class="label">Facility</span><span class="value">' + state.facilityName + '</span></div>' +
         '<div class="summary-row"><span class="label">Date</span><span class="value">' + state.dateFormatted + '</span></div>' +
         '<div class="summary-row"><span class="label">Time Slot</span><span class="value">' + state.slotLabel + '</span></div>' +
         '<div class="summary-row"><span class="label">Customer</span><span class="value">' + state.customerName + '</span></div>' +
         '<div class="summary-row"><span class="label">Email</span><span class="value">' + state.customerEmail + '</span></div>' +
         '<div class="summary-row"><span class="label">Amount Paid</span><span class="value" style="color:#15803d;font-weight:800;">₹' + state.totalAmount + '</span></div>' +
         (state.isReserve ? '<div class="summary-row"><span class="label">Balance Due</span><span class="value" style="color:#b45309;font-weight:700;">₹' + state.balanceDue + '</span></div>' : '') +
         '<div class="summary-row"><span class="label">Payment ID</span><span class="value" style="font-family:monospace;">' + (paymentResponse.razorpay_payment_id || '') + '</span></div>' +
         '<div class="summary-row"><span class="label">Status</span><span class="value" style="color:' + (state.isReserve ? '#b45309' : '#10b981') + ';">' + (state.isReserve ? 'Reserved - Pending Full Payment' : 'Confirmed') + '</span></div>';
   }
   goToStep(5);
}

function handlePaymentSuccess(response) {
   showLoading('Confirming booking...');
   stopReservationTimer();
setTimeout(function () {
   hideLoading();
   showConfirmation(response);
}, 1500);
}

function resetBooking() {
   state = {
      step: 1,
      sport: null,
      sportName: null,
      facilityId: null,
      facilityDbId: null,
      facilityName: null,
      facilityPrice: 0,
      facilityPeakPrice: 0,
      date: null,
      dateFormatted: null,
      slotTime: null,
      slotLabel: null, selectedHours: [],
      customerName: null,
      customerPhone: null,
      customerEmail: null,
      customerNotes: null, welcomeBackName: null,
      promoCode: null,
      promoType: null,
      promoValue: 0,
      promoMinAmount: 0,
      promoDiscount: 0,
      basePrice: 0,
      gstAmount: 0,
      totalAmount: 0,
      paymentMode: 'full',
      isReserve: false,
      fullAmount: 0,
      reserveAmount: 0,
      balanceDue: 0,
      bookingId: null,
      reservationTimer: null,
      reservationSeconds: CONFIG.reservation_minutes * 60
   };
['custName', 'custPhone', 'custEmail', 'custNotes', 'promoCode'].forEach(function (id) {
   const el = document.getElementById(id);
   if (el) el.value = '';
});
   const promoResultEl = document.getElementById('promoResult');
   if (promoResultEl) promoResultEl.textContent = '';
   goToStep(1);
}

function showLoading(text) {
   const overlay = document.getElementById('loadingOverlay');
   if (overlay) overlay.style.display = 'flex';
   const textEl = document.getElementById('loadingText');
   if (textEl) textEl.textContent = text || 'Processing...';
}

function hideLoading() {
   const overlay = document.getElementById('loadingOverlay');
   if (overlay) overlay.style.display = 'none';
}

document.addEventListener('DOMContentLoaded', async () => {
document.body.classList.add('facilities-loading');
     await Promise.all([loadFacilities(), loadSettings()]);

                          const urlParams = new URLSearchParams(window.location.search);
   const sportParam = urlParams.get('sport');
   if (sportParam && CONFIG.facilities[sportParam]) {
      setTimeout(() => selectSport(sportParam), 100);
   }

                          const navbar = document.getElementById('navbar');
   if (navbar) {
      window.addEventListener('scroll', () => {
         navbar.classList.toggle('scrolled', window.scrollY > 50);
      });
   }

                          console.log('PlayBox Kashmir Booking System - v2.0 initialized');
});

function setupAgreeTermsGate() {
   var box = document.getElementById('agree-terms');
   var btn = document.getElementById('btnPay');
   if (!box) return;
   function sync() {
      if (btn) btn.disabled = !box.checked;
      var wrap = document.getElementById('agree-terms-wrap');
      if (box.checked && wrap) wrap.classList.remove('error');
   }
   box.addEventListener('change', sync);
   sync();
}
if (document.readyState === 'loading') {
   document.addEventListener('DOMContentLoaded', setupAgreeTermsGate);
} else {
   setupAgreeTermsGate();
}
