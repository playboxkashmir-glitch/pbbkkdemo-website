let PLANS = [];
let selectedPlan = null;

document.addEventListener('DOMContentLoaded', function () {
    loadPlans();
    const backBtn = document.getElementById('btnBackToPlans');
    if (backBtn) backBtn.addEventListener('click', backToPlans);
    const submitBtn = document.getElementById('btnSubmitSignup');
    if (submitBtn) submitBtn.addEventListener('click', submitSignup);
});

async function loadPlans() {
    const container = document.getElementById('planCards');
    if (!container) return;
    try {
        const res = await fetch('/api/customers?resource=public-plans');
        if (!res.ok) throw new Error('load failed');
        const data = await res.json();
        PLANS = data.plans || [];
        if (!PLANS.length) {
            container.innerHTML = '<p>No membership plans are open for sign-up right now. Please check back soon.</p>';
            return;
        }
        container.innerHTML = PLANS.map(renderPlanCard).join('');
        PLANS.forEach(function (p) {
            const el = document.getElementById('plancard_' + p.id);
            if (el) el.addEventListener('click', function () { selectPlan(p); });
        });
    } catch (err) {
        container.innerHTML = '<p>Could not load membership plans. Please refresh the page.</p>';
    }
}

function billingCycleLabel(cycle) {
    return ({
        monthly: 'month', quarterly: 'quarter', half_yearly: 'half-year',
        annual: 'year', one_time: 'one-time'
    })[cycle] || cycle;
}

function billingCycleLabelCap(cycle) {
    return ({
        monthly: 'Monthly', quarterly: 'Quarterly', half_yearly: 'Half-Yearly',
        annual: 'Annual', one_time: 'One-Time'
    })[cycle] || capitalizeWordLocal(cycle);
}

function planPerks(p) {
    const perks = [];
    if (p.discount_type === 'percent' && Number(p.discount_value) > 0) {
        perks.push(Number(p.discount_value) + '% off every booking' + (p.discount_max_amount ? ' (up to ₹' + p.discount_max_amount + ')' : ''));
    } else if (p.discount_type === 'flat' && Number(p.discount_value) > 0) {
        perks.push('₹' + p.discount_value + ' off every booking');
    }
    if (Number(p.complimentary_slots) > 0) {
        perks.push(p.complimentary_slots + ' complimentary hour' + (p.complimentary_slots > 1 ? 's' : '') + ' every ' + billingCycleLabel(p.complimentary_frequency));
    }
    if (p.allow_reserve_without_payment) perks.push('Reserve slots without upfront payment');
    if (p.priority_booking) perks.push('Priority booking access');
    const sports = Array.isArray(p.applicable_sports) ? p.applicable_sports : [];
    perks.push(sports.length ? 'Valid for: ' + sports.map(capitalizeWordLocal).join(', ') : 'Valid across all sports');
    return perks;
}

function renderPlanCard(p) {
    const perksHtml = planPerks(p).map(function (perk) {
        return '<li><i class="fas fa-check"></i> ' + escapeHtmlLocal(perk) + '</li>';
    }).join('');
    return '<div class="tourn-card plan-card" id="plancard_' + p.id + '">' +
        '<span class="tourn-card-badge open">₹' + (p.price || 0) + ' / ' + billingCycleLabel(p.billing_cycle) + '</span>' +
        '<h3>' + escapeHtmlLocal(p.name) + '</h3>' +
        (p.description ? '<p>' + escapeHtmlLocal(p.description) + '</p>' : '') +
        '<ul class="plan-perks">' + perksHtml + '</ul>' +
        '<div class="tourn-fee">Choose Plan <i class="fas fa-arrow-right"></i></div>' +
        '</div>';
}

function escapeHtmlLocal(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function capitalizeWordLocal(str) {
    if (!str) return '';
    return String(str).replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
}

function selectPlan(p) {
    selectedPlan = p;
    document.getElementById('planListSection').style.display = 'none';
    document.getElementById('signupFormSection').style.display = 'block';
    document.getElementById('selectedPlanName').textContent = p.name;
    document.getElementById('selectedPlanSub').textContent = billingCycleLabelCap(p.billing_cycle) + ' membership';
    document.getElementById('mem_price_display').textContent = '₹' + (p.price || 0);
    const msg = document.getElementById('signupMsg');
    msg.className = 'eligibility-msg';
    msg.textContent = '';
    document.getElementById('mem_name').value = '';
    document.getElementById('mem_phone').value = '';
    document.getElementById('mem_email').value = '';
    document.getElementById('mem_notes').value = '';
    const submitBtn = document.getElementById('btnSubmitSignup');
    if (submitBtn) submitBtn.disabled = false;
}

function backToPlans() {
    selectedPlan = null;
    document.getElementById('signupFormSection').style.display = 'none';
    document.getElementById('planListSection').style.display = 'block';
}

function showLoading(text) {
    const overlay = document.getElementById('loadingOverlay');
    const t = document.getElementById('loadingText');
    if (t) t.textContent = text || 'Processing...';
    if (overlay) overlay.style.display = 'flex';
}

function hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) overlay.style.display = 'none';
}

async function submitSignup() {
    if (!selectedPlan) return;
    const name = document.getElementById('mem_name').value.trim();
    const phone = document.getElementById('mem_phone').value.trim();
    const email = document.getElementById('mem_email').value.trim();
    const notes = document.getElementById('mem_notes').value.trim();

    if (!name || !phone || !email) {
        alert('Please fill in your name, phone number and email.');
        return;
    }

    const submitBtn = document.getElementById('btnSubmitSignup');
    submitBtn.disabled = true;
    showLoading('Submitting your request...');

    try {
        const res = await fetch('/api/customers?resource=signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                plan_id: selectedPlan.id,
                member_name: name,
                member_phone: phone,
                member_email: email,
                notes: notes
            })
        });
        const data = await res.json();
        hideLoading();
        if (!res.ok) {
            submitBtn.disabled = false;
            alert(data.error || 'Could not submit your request. Please try again.');
            return;
        }
        showConfirmation();
    } catch (err) {
        hideLoading();
        submitBtn.disabled = false;
        alert('Network error. Please try again.');
    }
}

function showConfirmation() {
    document.getElementById('signupFormSection').style.display = 'none';
    document.getElementById('confirmationSection').style.display = 'block';
}
