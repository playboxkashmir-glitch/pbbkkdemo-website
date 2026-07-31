// admin/memberships.js
let plansCache = [];
let currentPlanId = null;
let currentMemberId = null;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  const ok = await checkSession();
  if (!ok) return;
  await loadPlans();
  await loadMembers();
  bind('createPlanBtn', 'click', showCreatePlanModal);
  bind('closePlanModalBtn', 'click', closePlanModal);
  bind('savePlanBtn', 'click', savePlan);
  bind('p_discount_type', 'change', onPlanDiscountTypeChange);
  bind('enrollMemberBtn', 'click', showCreateMemberModal);
  bind('closeMemberModalBtn', 'click', closeMemberModal);
  bind('saveMemberBtn', 'click', saveMember);
  bind('m_plan_id', 'change', onMemberPlanChange);
}

function bind(id, evt, fn) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(evt, fn);
}

function capitalizeWord(str) {
  if (!str) return '';
  return String(str).replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(d) {
  if (!d) return '-';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '-';
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function describeDiscount(p) {
  if (!p.discount_type || p.discount_type === 'none' || Number(p.discount_value) === 0) return 'None';
  if (p.discount_type === 'percent') {
    return Number(p.discount_value) + '% off' + (p.discount_max_amount ? (' (max ' + formatCurrency(p.discount_max_amount) + ')') : '');
  }
  return formatCurrency(p.discount_value) + ' flat off';
}

// ---------------- Membership Plans ----------------
async function loadPlans() {
  const tbody = document.getElementById('plansTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="9" class="pk-loading">Loading plans...</td></tr>';
  try {
    const res = await fetch('/api/customers?resource=plans', { credentials: 'include' });
    if (!res.ok) throw new Error('load failed');
    const data = await res.json();
    plansCache = data.plans || [];
    if (!plansCache.length) {
      tbody.innerHTML = '<tr><td colspan="9">No membership plans yet. Click "Create Membership Plan" to add one.</td></tr>';
      return;
    }
    tbody.innerHTML = plansCache.map(renderPlanRow).join('');
    plansCache.forEach(function (p) {
      const editBtn = document.getElementById('planEditBtn_' + p.id);
      if (editBtn) editBtn.addEventListener('click', function () { showEditPlanModal(p.id); });
      const delBtn = document.getElementById('planDeleteBtn_' + p.id);
      if (delBtn) delBtn.addEventListener('click', function () { deletePlan(p.id, p.name); });
    });
    populateMemberPlanSelect();
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="9">Failed to load membership plans.</td></tr>';
  }
}

function renderPlanRow(p) {
  const comp = p.complimentary_slots > 0
    ? (p.complimentary_slots + ' / ' + capitalizeWord(p.complimentary_frequency))
    : 'None';
  const reserveBadge = p.allow_reserve_without_payment
    ? '<span style="color:#059669;font-weight:600;">Yes</span>'
    : '<span style="color:#9ca3af;">No</span>';
  const statusBadge = p.is_active
    ? '<span style="color:#059669;font-weight:600;">Active</span>'
    : '<span style="color:#9ca3af;">Inactive</span>';
  return '<tr>' +
    '<td>' + escapeHtml(p.name) + '</td>' +
    '<td>' + formatCurrency(p.price) + ' / ' + capitalizeWord(p.billing_cycle) + '</td>' +
    '<td>' + capitalizeWord(p.billing_cycle) + '</td>' +
    '<td>' + describeDiscount(p) + '</td>' +
    '<td>' + comp + '</td>' +
    '<td>' + reserveBadge + '</td>' +
    '<td>' + (p.active_members || 0) + '</td>' +
    '<td>' + statusBadge + '</td>' +
    '<td><button id="planEditBtn_' + p.id + '" class="btn-secondary">Edit</button> ' +
      '<button id="planDeleteBtn_' + p.id + '" class="btn-danger">Delete</button></td>' +
    '</tr>';
}

function showCreatePlanModal() {
  currentPlanId = null;
  const modal = document.getElementById('planModal');
  if (!modal) return;
  document.getElementById('planModalTitle').textContent = 'Create Membership Plan';
  document.getElementById('p_id').value = '';
  document.getElementById('p_name').value = '';
  document.getElementById('p_description').value = '';
  document.getElementById('p_price').value = '';
  document.getElementById('p_billing_cycle').value = 'monthly';
  document.getElementById('p_discount_type').value = 'none';
  document.getElementById('p_discount_value').value = '0';
  document.getElementById('p_discount_max').value = '';
  document.getElementById('p_comp_slots').value = '0';
  document.getElementById('p_comp_freq').value = 'monthly';
  document.getElementById('p_max_advance').value = '';
  document.getElementById('p_allow_reserve').checked = false;
  document.getElementById('p_priority').checked = false;
  document.getElementById('p_sport_football').checked = false;
  document.getElementById('p_sport_cricket').checked = false;
  document.getElementById('p_sport_pickleball').checked = false;
  document.getElementById('planStatusFieldWrap').style.display = 'none';
  onPlanDiscountTypeChange();
  modal.style.display = 'flex';
}

async function showEditPlanModal(id) {
  try {
    const res = await fetch('/api/customers?resource=plan-detail&id=' + encodeURIComponent(id), { credentials: 'include' });
    if (!res.ok) throw new Error('load failed');
    const data = await res.json();
    const p = data.plan;
    currentPlanId = p.id;
    document.getElementById('planModalTitle').textContent = 'Edit Membership Plan';
    document.getElementById('p_id').value = p.id;
    document.getElementById('p_name').value = p.name || '';
    document.getElementById('p_description').value = p.description || '';
    document.getElementById('p_price').value = p.price;
    document.getElementById('p_billing_cycle').value = p.billing_cycle;
    document.getElementById('p_discount_type').value = p.discount_type;
    document.getElementById('p_discount_value').value = p.discount_value;
    document.getElementById('p_discount_max').value = p.discount_max_amount || '';
    document.getElementById('p_comp_slots').value = p.complimentary_slots;
    document.getElementById('p_comp_freq').value = p.complimentary_frequency;
    document.getElementById('p_max_advance').value = p.max_advance_booking_days || '';
    document.getElementById('p_allow_reserve').checked = !!p.allow_reserve_without_payment;
    document.getElementById('p_priority').checked = !!p.priority_booking;
    const sports = Array.isArray(p.applicable_sports) ? p.applicable_sports : [];
    document.getElementById('p_sport_football').checked = sports.indexOf('football') !== -1;
    document.getElementById('p_sport_cricket').checked = sports.indexOf('cricket') !== -1;
    document.getElementById('p_sport_pickleball').checked = sports.indexOf('pickleball') !== -1;
    document.getElementById('p_active').checked = !!p.is_active;
    document.getElementById('planStatusFieldWrap').style.display = '';
    onPlanDiscountTypeChange();
    document.getElementById('planModal').style.display = 'flex';
  } catch (err) {
    alert('Failed to load plan details.');
  }
}

function closePlanModal() {
  const modal = document.getElementById('planModal');
  if (modal) modal.style.display = 'none';
}

function onPlanDiscountTypeChange() {
  const type = document.getElementById('p_discount_type').value;
  const maxWrap = document.getElementById('p_discount_max_wrap');
  if (maxWrap) maxWrap.style.display = (type === 'percent') ? '' : 'none';
  const valWrap = document.getElementById('p_discount_value_wrap');
  if (valWrap) valWrap.style.display = (type === 'none') ? 'none' : '';
}

async function savePlan() {
  const id = document.getElementById('p_id').value;
  const sports = [];
  if (document.getElementById('p_sport_football').checked) sports.push('football');
  if (document.getElementById('p_sport_cricket').checked) sports.push('cricket');
  if (document.getElementById('p_sport_pickleball').checked) sports.push('pickleball');

  const payload = {
    name: document.getElementById('p_name').value.trim(),
    description: document.getElementById('p_description').value.trim(),
    price: parseFloat(document.getElementById('p_price').value) || 0,
    billing_cycle: document.getElementById('p_billing_cycle').value,
    discount_type: document.getElementById('p_discount_type').value,
    discount_value: parseFloat(document.getElementById('p_discount_value').value) || 0,
    discount_max_amount: document.getElementById('p_discount_max').value,
    complimentary_slots: parseInt(document.getElementById('p_comp_slots').value, 10) || 0,
    complimentary_frequency: document.getElementById('p_comp_freq').value,
    max_advance_booking_days: document.getElementById('p_max_advance').value,
    allow_reserve_without_payment: document.getElementById('p_allow_reserve').checked,
    priority_booking: document.getElementById('p_priority').checked,
    applicable_sports: sports
  };
  if (id) payload.is_active = document.getElementById('p_active').checked;

  if (!payload.name) { alert('Please enter a plan name.'); return; }

  try {
    const method = id ? 'PATCH' : 'POST';
    if (id) payload.id = id;
    const res = await fetch('/api/customers?resource=plan' + (id ? ('&id=' + encodeURIComponent(id)) : ''), {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const errData = await res.json().catch(function () { return {}; });
      alert(errData.error || 'Failed to save plan.');
      return;
    }
    closePlanModal();
    await loadPlans();
  } catch (err) {
    alert('Failed to save plan.');
  }
}

async function deletePlan(id, name) {
  const msg = 'Delete the membership plan' + (name ? (' "' + name + '"') : '') + '? This cannot be undone. Plans with active members cannot be deleted.';
  if (!confirm(msg)) return;
  try {
    const res = await fetch('/api/customers?resource=plan&id=' + encodeURIComponent(id), {
      method: 'DELETE',
      credentials: 'include'
    });
    if (!res.ok) {
      const errData = await res.json().catch(function () { return {}; });
      alert(errData.error || 'Failed to delete plan.');
      return;
    }
    await loadPlans();
  } catch (err) {
    alert('Failed to delete plan.');
  }
}

// ---------------- Members ----------------
function populateMemberPlanSelect() {
  const sel = document.getElementById('m_plan_id');
  if (!sel) return;
  const activePlans = plansCache.filter(function (p) { return p.is_active; });
  sel.innerHTML = activePlans.map(function (p) {
    return '<option value="' + p.id + '">' + escapeHtml(p.name) + ' (' + formatCurrency(p.price) + ' / ' + capitalizeWord(p.billing_cycle) + ')</option>';
  }).join('');
}

async function loadMembers() {
  const tbody = document.getElementById('membersTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" class="pk-loading">Loading members...</td></tr>';
  try {
    const res = await fetch('/api/customers?resource=members', { credentials: 'include' });
    if (!res.ok) throw new Error('load failed');
    const data = await res.json();
    const rows = data.members || [];
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6">No members enrolled yet. Click "Enroll Member" to add one.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(renderMemberRow).join('');
    rows.forEach(function (m) {
      const editBtn = document.getElementById('memberEditBtn_' + m.id);
      if (editBtn) editBtn.addEventListener('click', function () { showEditMemberModal(m.id); });
      const redeemBtn = document.getElementById('memberRedeemBtn_' + m.id);
      if (redeemBtn) redeemBtn.addEventListener('click', function () { redeemSlot(m.id, m.member_name); });
      const delBtn = document.getElementById('memberDeleteBtn_' + m.id);
      if (delBtn) delBtn.addEventListener('click', function () { deleteMember(m.id, m.member_name); });
    });
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="6">Failed to load members.</td></tr>';
  }
}

function renderMemberRow(m) {
  const statusColors = { active: '#059669', expired: '#9ca3af', cancelled: '#dc2626' };
  const statusColor = statusColors[m.status] || '#111827';
  const comp = m.complimentary_slots_total > 0
    ? (m.complimentary_slots_remaining + ' / ' + m.complimentary_slots_total + ' left')
    : 'None';
  const redeemDisabled = (m.status !== 'active' || m.complimentary_slots_remaining <= 0) ? ' disabled' : '';
  return '<tr>' +
    '<td>' + escapeHtml(m.member_name) + '<br><small style="color:#6b7280;">' + escapeHtml(m.member_email) + '</small></td>' +
    '<td>' + escapeHtml(m.plan_name) + '</td>' +
    '<td style="color:' + statusColor + ';font-weight:600;">' + capitalizeWord(m.status) + '</td>' +
    '<td>' + comp + '</td>' +
    '<td>' + formatDate(m.end_date) + '</td>' +
    '<td><button id="memberEditBtn_' + m.id + '" class="btn-secondary">Edit</button> ' +
      '<button id="memberRedeemBtn_' + m.id + '" class="btn-secondary"' + redeemDisabled + '>Redeem Slot</button> ' +
      '<button id="memberDeleteBtn_' + m.id + '" class="btn-danger">Delete</button></td>' +
    '</tr>';
}

function showCreateMemberModal() {
  if (!plansCache.filter(function (p) { return p.is_active; }).length) {
    alert('Please create an active membership plan first.');
    return;
  }
  currentMemberId = null;
  const modal = document.getElementById('memberModal');
  if (!modal) return;
  document.getElementById('memberModalTitle').textContent = 'Enroll Member';
  document.getElementById('m_id').value = '';
  populateMemberPlanSelect();
  document.getElementById('m_name').value = '';
  document.getElementById('m_email').value = '';
  document.getElementById('m_phone').value = '';
  document.getElementById('m_start_date').value = new Date().toISOString().slice(0, 10);
  document.getElementById('m_end_date').value = '';
  document.getElementById('m_amount_paid').value = '';
  document.getElementById('m_payment_method').value = 'cash';
  document.getElementById('m_notes').value = '';
  document.getElementById('memberStatusFieldWrap').style.display = 'none';
  document.getElementById('memberSlotsInfoWrap').style.display = 'none';
  onMemberPlanChange();
  modal.style.display = 'flex';
}

async function showEditMemberModal(id) {
  try {
    const res = await fetch('/api/customers?resource=member-detail&id=' + encodeURIComponent(id), { credentials: 'include' });
    if (!res.ok) throw new Error('load failed');
    const data = await res.json();
    const m = data.member;
    currentMemberId = m.id;
    document.getElementById('memberModalTitle').textContent = 'Edit Member';
    document.getElementById('m_id').value = m.id;
    populateMemberPlanSelect();
    document.getElementById('m_plan_id').value = m.plan_id;
    document.getElementById('m_name').value = m.member_name;
    document.getElementById('m_email').value = m.member_email;
    document.getElementById('m_phone').value = m.member_phone;
    document.getElementById('m_start_date').value = (m.start_date || '').slice(0, 10);
    document.getElementById('m_end_date').value = (m.end_date || '').slice(0, 10);
    document.getElementById('m_amount_paid').value = m.amount_paid;
    document.getElementById('m_payment_method').value = m.payment_method;
    document.getElementById('m_notes').value = m.notes || '';
    document.getElementById('m_status').value = m.status;
    document.getElementById('memberStatusFieldWrap').style.display = '';
    document.getElementById('memberSlotsInfoWrap').style.display = '';
    document.getElementById('memberSlotsInfoText').textContent =
      m.complimentary_slots_remaining + ' / ' + m.complimentary_slots_total + ' complimentary slots remaining (resets ' + formatDate(m.complimentary_slots_reset_at) + ')';
    document.getElementById('memberModal').style.display = 'flex';
  } catch (err) {
    alert('Failed to load member details.');
  }
}

function closeMemberModal() {
  const modal = document.getElementById('memberModal');
  if (modal) modal.style.display = 'none';
}

function onMemberPlanChange() {
  if (currentMemberId) return;
  const planId = Number(document.getElementById('m_plan_id').value);
  const plan = plansCache.find(function (p) { return p.id === planId; });
  if (plan) {
    document.getElementById('m_amount_paid').value = plan.price;
  }
}

async function saveMember() {
  const id = document.getElementById('m_id').value;
  const payload = {
    plan_id: Number(document.getElementById('m_plan_id').value),
    member_name: document.getElementById('m_name').value.trim(),
    member_email: document.getElementById('m_email').value.trim(),
    member_phone: document.getElementById('m_phone').value.trim(),
    start_date: document.getElementById('m_start_date').value,
    amount_paid: parseFloat(document.getElementById('m_amount_paid').value) || 0,
    payment_method: document.getElementById('m_payment_method').value,
    notes: document.getElementById('m_notes').value.trim()
  };
  const endDateVal = document.getElementById('m_end_date').value;
  if (endDateVal) payload.end_date = endDateVal;
  if (id) payload.status = document.getElementById('m_status').value;

  if (!payload.plan_id || !payload.member_name || !payload.member_email || !payload.member_phone) {
    alert('Please fill in plan, name, email and phone.');
    return;
  }

  try {
    const method = id ? 'PATCH' : 'POST';
    if (id) payload.id = id;
    const res = await fetch('/api/customers?resource=member' + (id ? ('&id=' + encodeURIComponent(id)) : ''), {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const errData = await res.json().catch(function () { return {}; });
      alert(errData.error || 'Failed to save member.');
      return;
    }
    closeMemberModal();
    await loadMembers();
    await loadPlans();
  } catch (err) {
    alert('Failed to save member.');
  }
}

async function deleteMember(id, name) {
  const msg = 'Remove membership for' + (name ? (' "' + name + '"') : ' this member') + '? This cannot be undone.';
  if (!confirm(msg)) return;
  try {
    const res = await fetch('/api/customers?resource=member&id=' + encodeURIComponent(id), {
      method: 'DELETE',
      credentials: 'include'
    });
    if (!res.ok) {
      const errData = await res.json().catch(function () { return {}; });
      alert(errData.error || 'Failed to delete member.');
      return;
    }
    await loadMembers();
    await loadPlans();
  } catch (err) {
    alert('Failed to delete member.');
  }
}

async function redeemSlot(id, name) {
  const msg = 'Redeem one complimentary slot for' + (name ? (' ' + name) : ' this member') + '?';
  if (!confirm(msg)) return;
  try {
    const res = await fetch('/api/customers?resource=redeem-slot&id=' + encodeURIComponent(id), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({})
    });
    if (!res.ok) {
      const errData = await res.json().catch(function () { return {}; });
      alert(errData.error || 'Failed to redeem slot.');
      return;
    }
    await loadMembers();
  } catch (err) {
    alert('Failed to redeem slot.');
  }
}
