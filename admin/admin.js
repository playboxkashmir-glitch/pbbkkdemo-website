

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
        renderRevenueChart(data.last7Days);
        renderDashboardSportBreakdown(data.bySport);
        renderPeakHours(data.peakHours);
  } catch (err) {
    console.error('Failed to load dashboard summary', err);
  }
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
