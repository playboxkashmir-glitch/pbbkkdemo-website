

const CONFIG = {
  slotStartHour: 5,
  slotEndHour: 26,
  peakHours: [18, 19, 20, 21],
  slotDurationMin: 60
};

let currentFacilities = [];

document.addEventListener('DOMContentLoaded', async () => {
  const authed = await checkSession();
  if (!authed) return;

  const dateEl = document.getElementById('headerDate');
  if (dateEl) {
    dateEl.textContent = new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }

  const navbar = document.getElementById('navbar');
  if (navbar) {
    window.addEventListener('scroll', () => navbar.classList.toggle('scrolled', window.scrollY > 20));
  }

  await loadDashboardSummary();
  await loadTodayBookings();
  await loadFacilities();

  const bookingDateInput = document.getElementById('bookingDate');
  if (bookingDateInput) {
    const today = new Date().toISOString().slice(0, 10);
    bookingDateInput.min = today;
    bookingDateInput.value = today;
  }
});

async function checkSession() {
  try {
    const res = await fetch('/api/auth/session', { credentials: 'include' });
    if (!res.ok) {
      window.location.href = 'login.html';
      return false;
    }
    return true;
  } catch (err) {
    window.location.href = 'login.html';
    return false;
  }
}

async function handleLogout(e) {
  if (e) e.preventDefault();
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  } catch (err) {}
  window.location.href = 'login.html';
}

function toggleSidebar() {
  const sidebar = document.getElementById('adminSidebar');
  if (sidebar) sidebar.classList.toggle('open');
}

async function loadDashboardSummary() {
  try {
    const res = await fetch('/api/reports/summary', { credentials: 'include' });
    if (!res.ok) return;
    const data = await res.json();
    setText('stat-today', data.today ? data.today.count : 0);
    setText('stat-revenue', formatCurrency(data.today ? data.today.revenue : 0));
    setText('stat-week', data.week ? data.week.count : 0);
    setText('stat-month', formatCurrency(data.month ? data.month.revenue : 0));
    renderStatChange('stat-today-change', data.today ? data.today.count : 0, data.yesterday ? data.yesterday.count : 0, { suffix: 'from yesterday', mode: 'diff' });
    renderStatChange('stat-revenue-change', data.today ? data.today.revenue : 0, data.yesterday ? data.yesterday.revenue : 0, { suffix: 'from yesterday', mode: 'diff', currency: true });
    renderStatChange('stat-week-change', data.week ? data.week.count : 0, data.lastWeekSame ? data.lastWeekSame.count : 0, { suffix: 'vs last week', mode: 'pct' });
    renderStatChange('stat-month-change', data.month ? data.month.revenue : 0, data.lastMonthSame ? data.lastMonthSame.revenue : 0, { suffix: 'vs last month', mode: 'pct' });
    renderRevenueChart(data.last7Days);
    renderDashboardSportBreakdown(data.bySport);
    renderPeakHours(data.peakHours);
  } catch (err) {
    console.error('Failed to load dashboard summary', err);
  }
}

function renderStatChange(elId, current, previous, opts) {
  var el = document.getElementById(elId);
  if (!el) return;
  opts = opts || {};
  var suffix = opts.suffix || '';
  var mode = opts.mode || 'diff';
  var currency = !!opts.currency;
  current = Number(current) || 0;
  previous = Number(previous) || 0;
  var text, cls;
  function fmt(n) {
    n = Math.round(n);
    return currency ? ('₹' + Math.abs(n).toLocaleString('en-IN')) : String(Math.abs(n));
  }
  if (mode === 'diff') {
    var diff = current - previous;
    if (diff === 0) {
      text = 'No change ' + suffix;
      cls = 'neutral';
    } else {
      text = (diff > 0 ? '+' : '-') + fmt(diff) + ' ' + suffix;
      cls = diff > 0 ? 'positive' : 'negative';
    }
  } else {
    if (previous === 0) {
      if (current === 0) {
        text = 'No change ' + suffix;
        cls = 'neutral';
      } else {
        text = 'New activity ' + suffix;
        cls = 'positive';
      }
    } else {
      var pct = Math.round(((current - previous) / previous) * 100);
      if (pct === 0) {
        text = 'No change ' + suffix;
        cls = 'neutral';
      } else {
        text = (pct > 0 ? '+' : '') + pct + '% ' + suffix;
        cls = pct > 0 ? 'positive' : 'negative';
      }
    }
  }
  el.textContent = text;
  el.classList.remove('positive', 'negative', 'neutral');
  el.classList.add(cls);
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function formatCurrency(amount) {
  const n = Number(amount) || 0;
  return '₹' + n.toLocaleString('en-IN');
}

const SPORT_COLORS = ['#10b981', '#f59e0b', '#3b82f6', '#8b5cf6', '#ef4444', '#06b6d4'];

function formatCurrencyShort(amount) {
    const n = Number(amount) || 0;
    if (n >= 1000) return '\u20b9' + (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return '\u20b9' + n.toLocaleString('en-IN');
}

function renderRevenueChart(days) {
    const el = document.getElementById('revenueChartBars');
    if (!el) return;
    if (!days || !days.length) {
          el.innerHTML = '<p style="text-align:center;color:#9ca3af;padding:1.5rem;">No revenue data yet.</p>';
          return;
    }
    const maxRevenue = Math.max.apply(null, days.map(function (d) { return Number(d.revenue); })) || 1;
    el.innerHTML = days.map(function (d) {
          const revenue = Number(d.revenue);
          const pct = revenue > 0 ? Math.max(Math.round((revenue / maxRevenue) * 100), 4) : 0;
          const isPeak = revenue === maxRevenue && revenue > 0;
          return '<div class="bar-wrap">' +
                  '<div class="bar' + (isPeak ? ' peak' : '') + '" style="height:' + pct + '%"><span class="bar-val">' + formatCurrencyShort(revenue) + '</span></div>' +
                  '<span class="bar-label">' + escapeHtml(d.label) + '</span>' +
                  '</div>';
    }).join('');
}

function renderDashboardSportBreakdown(bySport) {
    const el = document.getElementById('dashboardSportBreakdown');
    if (!el) return;
    if (!bySport || !bySport.length) {
          el.innerHTML = '<p style="text-align:center;color:#9ca3af;padding:1rem;">No booking data yet.</p>';
          return;
    }
    const total = bySport.reduce(function (sum, s) { return sum + Number(s.count); }, 0) || 1;
    el.innerHTML = bySport.map(function (s, i) {
          const pct = Math.round((Number(s.count) / total) * 100);
          const color = SPORT_COLORS[i % SPORT_COLORS.length];
          return '<div class="sport-row">' +
                  '<div class="sport-row-info"><span class="sport-dot" style="background:' + color + ';"></span><span>' + escapeHtml(s.sport_name) + '</span></div>' +
                  '<div class="sport-bar-wrap"><div class="sport-bar" style="width:' + pct + '%;background:' + color + ';"></div></div>' +
                  '<span class="sport-pct">' + pct + '%</span>' +
                  '</div>';
    }).join('');
}

function renderPeakHours(peakHours) {
    const el = document.getElementById('peakHoursGrid');
    if (!el) return;
    if (!peakHours || !peakHours.length) return;
    const sorted = peakHours.slice().sort(function (a, b) { return Number(b.count) - Number(a.count); });
    const highKey = sorted[0] ? sorted[0].key : null;
    const midKey = sorted[1] ? sorted[1].key : null;
    el.innerHTML = peakHours.map(function (p) {
          let cls = 'low';
          if (p.key === highKey && Number(p.count) > 0) cls = 'high';
          else if (p.key === midKey && Number(p.count) > 0) cls = 'mid';
          const star = cls === 'high' ? ' \u2b50' : '';
          return '<div class="hour-cell ' + cls + '" title="' + escapeHtml(p.range) + '">' + escapeHtml(p.label) + star + '</div>';
    }).join('');
}


async function loadTodayBookings() {
  const tbody = document.getElementById('todayBookingsTable');
  if (!tbody) return;
  const today = new Date().toISOString().slice(0, 10);
  try {
    const res = await fetch('/api/bookings?date=' + today, { credentials: 'include' });
    if (!res.ok) return;
    const data = await res.json();
    const bookings = data.bookings || [];
    if (!bookings.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#9ca3af;padding:1.5rem;">No bookings for today yet.</td></tr>';
      return;
    }
    tbody.innerHTML = bookings.map(renderBookingRow).join('');
  } catch (err) {
    console.error('Failed to load bookings', err);
  }
}

function renderBookingRow(b) {
  const initial = (b.customer_name || '?').charAt(0).toUpperCase();
  const statusClass = b.status === 'confirmed' ? 'confirmed' : (b.status === 'cancelled' ? 'cancelled' : 'reserved');
  return '<tr>' +
    '<td><code>' + b.booking_ref + '</code></td>' +
    '<td><div class="customer-cell"><div class="customer-avatar">' + initial + '</div><div>' +
    '<div class="customer-name">' + escapeHtml(b.customer_name) + '</div>' +
    '<div class="customer-contact">' + escapeHtml(b.customer_phone) + '</div>' +
    '</div></div></td>' +
    '<td><span class="facility-tag">' + escapeHtml(b.option_name) + '</span></td>' +
    '<td>' + formatTimeLabel(b.start_time) + ' – ' + formatTimeLabel(b.end_time) + '</td>' +
    '<td class="amount">₹' + b.amount + '</td>' +
    '<td><span class="status-badge ' + statusClass + '">' + capitalize(b.status) + '</span></td>' +
    '<td><button class="btn-icon" title="View"><i class="fas fa-eye"></i></button></td>' +
    '</tr>';
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
  });
}

async function loadFacilities() {
  try {
    const res = await fetch('/api/facilities', { credentials: 'include' });
    if (!res.ok) return;
    const data = await res.json();
    currentFacilities = data.facilities || [];
  } catch (err) {
    console.error('Failed to load facilities', err);
  }
}

function showAddBookingModal() {
  const modal = document.getElementById('addBookingModal');
  if (!modal) return;
  modal.style.display = 'flex';
  clearAddBookingForm();
  onBookingSportChange();
}

function closeAddBookingModal() {
  const modal = document.getElementById('addBookingModal');
  if (modal) modal.style.display = 'none';
}

function clearAddBookingForm() {
  ['bookingCustomerName', 'bookingCustomerPhone', 'bookingCustomerEmail', 'bookingRate'].forEach(function (id) {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const errEl = document.getElementById('addBookingError');
  if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
}

function onBookingSportChange() {
  const sportSel = document.getElementById('bookingSport');
  const facilitySel = document.getElementById('bookingFacility');
  if (!sportSel || !facilitySel) return;
  const sportKey = sportSel.value;
  const matches = currentFacilities.filter(function (f) { return f.sport_key === sportKey && f.is_active !== false; });
  let html = '<option value="">Select facility</option>';
  matches.forEach(function (f) {
    html += '<option value="' + f.id + '" data-base-price="' + f.base_price + '" data-peak-price="' + f.peak_price + '">' + escapeHtml(f.option_name) + '</option>';
  });
  facilitySel.innerHTML = html;
  onBookingSlotInputsChange();
}

function generateTimeSlots() {
  const slots = [];
  let hour = CONFIG.slotStartHour;
  while (hour < CONFIG.slotEndHour) {
    const startH = hour % 24;
    const endH = (hour + 1) % 24;
    const startLabel = formatHourLabel(startH);
    const endLabel = formatHourLabel(endH);
    const startValue = String(startH).padStart(2, '0') + ':00';
    const endValue = String(endH).padStart(2, '0') + ':00';
    slots.push({ value: startValue + '|' + endValue, label: startLabel + ' – ' + endLabel });
    hour += 1;
  }
  return slots;
}

function formatHourLabel(h24) {
  const period = h24 >= 12 ? 'PM' : 'AM';
  let h = h24 % 12;
  if (h === 0) h = 12;
  return h + ':00 ' + period;
}

async function onBookingSlotInputsChange() {
  const facilitySel = document.getElementById('bookingFacility');
  const dateInput = document.getElementById('bookingDate');
  const timeSel = document.getElementById('bookingTimeSlot');
  const rateInput = document.getElementById('bookingRate');
  if (!facilitySel || !dateInput || !timeSel) return;

  const facilityId = facilitySel.value;
  const date = dateInput.value;
  const slots = generateTimeSlots();

  if (!facilityId || !date) {
    timeSel.innerHTML = '<option value="">Select date &amp; facility first</option>';
    return;
  }

  let blocked = [];
  try {
    const res = await fetch('/api/bookings?resource=availability&date=' + date + '&facility_id=' + facilityId, { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      blocked = (data.blocked || []).map(function (b) { return b.start_time; });
    }
  } catch (err) {
    console.error('Failed to check availability', err);
  }

  const previousSlotValue = timeSel.value; timeSel.innerHTML = slots.map(function (s) {
    const startTime = s.value.split('|')[0];
    const isBlocked = blocked.indexOf(startTime) !== -1;
    return '<option value="' + s.value + '"' + (isBlocked ? ' disabled' : '') + '>' + s.label + (isBlocked ? ' (Booked)' : '') + '</option>';
  }).join('');
  if (previousSlotValue) { timeSel.value = previousSlotValue; }

const selectedOption = facilitySel.options[facilitySel.selectedIndex];
    if (selectedOption && rateInput) {
          const selectedSlotValue = timeSel.value;
          const startHour = selectedSlotValue ? parseInt(selectedSlotValue.split('|')[0].split(':')[0], 10) : null;
          const isPeak = startHour !== null && CONFIG.peakHours.indexOf(startHour) !== -1;
          const price = isPeak ? selectedOption.dataset.peakPrice : selectedOption.dataset.basePrice;
          rateInput.value = price || selectedOption.dataset.basePrice || '';
    }
}

async function submitAddBooking() {
  const errEl = document.getElementById('addBookingError');
  const btn = document.getElementById('createBookingBtn');
  function showError(msg) {
    if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
  }
  if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }

  const nameEl = document.getElementById('bookingCustomerName');
  const phoneEl = document.getElementById('bookingCustomerPhone');
  const emailEl = document.getElementById('bookingCustomerEmail');
  const facilityEl = document.getElementById('bookingFacility');
  const dateEl = document.getElementById('bookingDate');
  const timeEl = document.getElementById('bookingTimeSlot');
  const rateEl = document.getElementById('bookingRate');
  const paymentEl = document.getElementById('bookingPaymentMethod');

  const name = nameEl ? nameEl.value.trim() : '';
  const phone = phoneEl ? phoneEl.value.trim() : '';
  const email = emailEl ? emailEl.value.trim() : '';
  const facilityId = facilityEl ? facilityEl.value : '';
  const date = dateEl ? dateEl.value : '';
  const timeValue = timeEl ? timeEl.value : '';
  const rate = rateEl ? rateEl.value : '';
  const paymentMethod = paymentEl ? paymentEl.value : 'cash';

  if (!name || !phone || !email || !facilityId || !date || !timeValue || rate === '') {
    showError('Please fill in all fields, including the time slot and rate.');
    return;
  }

  const parts = timeValue.split('|');
  const start_time = parts[0];
  const end_time = parts[1];

  btn.disabled = true;
  btn.textContent = 'Booking...';

  try {
    const res = await fetch('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        facility_id: Number(facilityId),
        customer_name: name,
        customer_email: email,
        customer_phone: phone,
        booking_date: date,
        start_time: start_time,
        end_time: end_time,
        rate: Number(rate),
        payment_method: paymentMethod,
        status: 'confirmed'
      })
    });
    const data = await res.json();
    if (!res.ok) {
      showError(data.error || 'Could not create booking.');
      btn.disabled = false;
      btn.textContent = 'Create Booking';
      return;
    }

    closeAddBookingModal();
    await loadDashboardSummary();
    await loadTodayBookings();

    if (data.booking && data.booking.id) {
      fetch('/api/bookings?resource=send-confirmation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ booking_id: data.booking.id })
      }).catch(function () {});
    }
  } catch (err) {
    showError('Network error while creating booking. Please try again.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create Booking';
  }
}

function formatTimeLabel(time24) {
  if (!time24) return '';
  const parts = String(time24).split(':');
  let h = parseInt(parts[0], 10);
  const period = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return h + ':' + (parts[1] || '00') + ' ' + period;
}

// --- Reliable inline-SVG icon rendering (Font Awesome CDN can be unavailable; this avoids that dependency) ---
(function () {
  var ICON_PATHS = {
    'eye': '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="3" fill="currentColor"/>',
    'tachometer-alt': '<path d="M4 18a8 8 0 1 1 16 0" fill="none" stroke="currentColor" stroke-width="1.8"/><line x1="12" y1="18" x2="16" y2="12" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="18" r="1.4" fill="currentColor"/>',
    'calendar-check': '<rect x="3" y="5" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><line x1="3" y1="9" x2="21" y2="9" stroke="currentColor" stroke-width="1.6"/><line x1="7" y1="3" x2="7" y2="7" stroke="currentColor" stroke-width="1.6"/><line x1="17" y1="3" x2="17" y2="7" stroke="currentColor" stroke-width="1.6"/><path d="M8 14l2.5 2.5L16 11" fill="none" stroke="currentColor" stroke-width="1.8"/>',
    'ban': '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><line x1="5.5" y1="18.5" x2="18.5" y2="5.5" stroke="currentColor" stroke-width="1.8"/>',
    'calendar-alt': '<rect x="3" y="5" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><line x1="3" y1="9" x2="21" y2="9" stroke="currentColor" stroke-width="1.6"/><line x1="7" y1="3" x2="7" y2="7" stroke="currentColor" stroke-width="1.6"/><line x1="17" y1="3" x2="17" y2="7" stroke="currentColor" stroke-width="1.6"/><circle cx="8" cy="13" r="1" fill="currentColor"/><circle cx="12" cy="13" r="1" fill="currentColor"/><circle cx="16" cy="13" r="1" fill="currentColor"/><circle cx="8" cy="17" r="1" fill="currentColor"/><circle cx="12" cy="17" r="1" fill="currentColor"/>',
    'users': '<circle cx="8.5" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M2.5 20c0-3.3 2.7-6 6-6s6 2.7 6 6" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="16.5" cy="9" r="2.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M14.7 14.2c.6-.2 1.2-.3 1.8-.3 2.9 0 5.3 2.1 5.5 5" fill="none" stroke="currentColor" stroke-width="1.4"/>',
    'building': '<rect x="4" y="3" width="16" height="18" rx="1" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="7" y="6" width="3" height="3" fill="currentColor"/><rect x="14" y="6" width="3" height="3" fill="currentColor"/><rect x="7" y="11" width="3" height="3" fill="currentColor"/><rect x="14" y="11" width="3" height="3" fill="currentColor"/><rect x="9.5" y="16" width="5" height="5" fill="currentColor"/>',
    'tags': '<path d="M3 11.5V4a1 1 0 0 1 1-1h7.5a1 1 0 0 1 .7.3l8 8a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0l-8-8a1 1 0 0 1-.3-.7z" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="7.5" cy="7.5" r="1.3" fill="currentColor"/>',
    'percentage': '<circle cx="7" cy="7" r="2.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="17" cy="17" r="2.5" fill="none" stroke="currentColor" stroke-width="1.6"/><line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" stroke-width="1.6"/>',
    'chart-bar': '<line x1="3" y1="21" x2="21" y2="21" stroke="currentColor" stroke-width="1.6"/><rect x="5" y="13" width="3.5" height="8" fill="currentColor"/><rect x="10.5" y="9" width="3.5" height="12" fill="currentColor"/><rect x="16" y="5" width="3.5" height="16" fill="currentColor"/>',
    'cog': '<circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2.2 2.2"/>',
    'trophy': '<path d="M8 4h8v2a4 4 0 0 1-4 4 4 4 0 0 1-4-4V4z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 5H4v2a4 4 0 0 0 4 4" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M16 5h4v2a4 4 0 0 1-4 4" fill="none" stroke="currentColor" stroke-width="1.4"/><line x1="12" y1="14" x2="12" y2="18" stroke="currentColor" stroke-width="1.6"/><line x1="8" y1="20" x2="16" y2="20" stroke="currentColor" stroke-width="1.6"/><line x1="12" y1="18" x2="12" y2="20" stroke="currentColor" stroke-width="1.6"/>',
    'id-card': '<rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="8" cy="11" r="2" fill="none" stroke="currentColor" stroke-width="1.4"/><line x1="13" y1="10" x2="18" y2="10" stroke="currentColor" stroke-width="1.4"/><line x1="13" y1="13" x2="18" y2="13" stroke="currentColor" stroke-width="1.4"/><line x1="6" y1="16" x2="10" y2="16" stroke="currentColor" stroke-width="1.4"/>',
    'external-link-alt': '<path d="M14 4h6v6" fill="none" stroke="currentColor" stroke-width="1.7"/><line x1="20" y1="4" x2="11" y2="13" stroke="currentColor" stroke-width="1.7"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" fill="none" stroke="currentColor" stroke-width="1.7"/>',
    'sign-out-alt': '<path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3" fill="none" stroke="currentColor" stroke-width="1.7"/><line x1="21" y1="12" x2="10" y2="12" stroke="currentColor" stroke-width="1.7"/><path d="M17 8l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.7"/>',
    'bars': '<line x1="3" y1="6" x2="21" y2="6" stroke="currentColor" stroke-width="1.8"/><line x1="3" y1="12" x2="21" y2="12" stroke="currentColor" stroke-width="1.8"/><line x1="3" y1="18" x2="21" y2="18" stroke="currentColor" stroke-width="1.8"/>',
    'plus': '<line x1="12" y1="4" x2="12" y2="20" stroke="currentColor" stroke-width="2"/><line x1="4" y1="12" x2="20" y2="12" stroke="currentColor" stroke-width="2"/>',
    'calendar-week': '<rect x="3" y="5" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><line x1="3" y1="9" x2="21" y2="9" stroke="currentColor" stroke-width="1.6"/><rect x="4" y="13" width="16" height="4" fill="currentColor" opacity="0.35"/>',
    'chart-line': '<polyline points="3,17 9,10 13,14 21,5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="9" cy="10" r="1.2" fill="currentColor"/><circle cx="13" cy="14" r="1.2" fill="currentColor"/><circle cx="21" cy="5" r="1.2" fill="currentColor"/>',
    'edit': '<path d="M4 20l1-4.5L15.5 5l3.5 3.5L8.5 19 4 20z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><line x1="13.5" y1="7" x2="17" y2="10.5" stroke="currentColor" stroke-width="1.5"/>',
    'times': '<line x1="5" y1="5" x2="19" y2="19" stroke="currentColor" stroke-width="2"/><line x1="19" y1="5" x2="5" y2="19" stroke="currentColor" stroke-width="2"/>',
    'undo': '<path d="M4 10h8a6 6 0 1 1-5.6 8" fill="none" stroke="currentColor" stroke-width="1.8"/><polyline points="4,4 4,10 10,10" fill="none" stroke="currentColor" stroke-width="1.8"/>',
    'check': '<polyline points="4,12 9,17 20,5" fill="none" stroke="currentColor" stroke-width="2"/>',
    'trash': '<line x1="4" y1="7" x2="20" y2="7" stroke="currentColor" stroke-width="1.7"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" fill="none" stroke="currentColor" stroke-width="1.7"/><line x1="9" y1="4" x2="15" y2="4" stroke="currentColor" stroke-width="1.7"/>',
    'chevron-left': '<polyline points="15,4 7,12 15,20" fill="none" stroke="currentColor" stroke-width="2"/>',
    'chevron-right': '<polyline points="9,4 17,12 9,20" fill="none" stroke="currentColor" stroke-width="2"/>',
    'search': '<circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="1.8"/><line x1="20" y1="20" x2="15.2" y2="15.2" stroke="currentColor" stroke-width="1.8"/>',
    'save': '<path d="M5 3h11l4 4v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><rect x="8" y="3" width="8" height="5" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="7" y="13" width="10" height="7" fill="none" stroke="currentColor" stroke-width="1.4"/>'
  };

  function iconNameFromClassList(classList) {
    for (var i = 0; i < classList.length; i++) {
      var c = classList[i];
      if (c.indexOf('fa-') === 0) return c.slice(3);
    }
    return null;
  }

  function convertIcon(el) {
    if (!el || el.getAttribute('data-pk-converted')) return;
    var name = iconNameFromClassList(el.classList);
    if (!name) return;
    if (name === 'rupee-sign') {
      var span = document.createElement('span');
      span.className = el.className;
      span.textContent = '₹';
      span.style.fontWeight = '700';
      if (el.parentNode) el.parentNode.replaceChild(span, el);
      return;
    }
    var svgInner = ICON_PATHS[name];
    if (!svgInner) return;
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '1em');
    svg.setAttribute('height', '1em');
    svg.setAttribute('class', el.className);
    svg.setAttribute('aria-hidden', 'true');
    svg.style.display = 'inline-block';
    svg.style.verticalAlign = '-0.125em';
    svg.innerHTML = svgInner;
    if (el.parentNode) el.parentNode.replaceChild(svg, el);
  }

  function convertAll(root) {
    if (!root || !root.querySelectorAll) return;
    var els = root.querySelectorAll('i.fas, i.far, i.fab');
    for (var i = 0; i < els.length; i++) convertIcon(els[i]);
  }

  convertAll(document);
  document.addEventListener('DOMContentLoaded', function () { convertAll(document); });

  var observer = new MutationObserver(function (mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var added = mutations[i].addedNodes;
      for (var j = 0; j < added.length; j++) {
        var node = added[j];
        if (node.nodeType !== 1) continue;
        if (node.matches && node.matches('i.fas, i.far, i.fab')) convertIcon(node);
        convertAll(node);
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
