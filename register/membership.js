let PLANS = [];
let selectedPlan = null;

document.addEventListener('DOMContentLoaded', function () {
    loadPlans();
    const backBtn = document.getElementById('btnBackToPlans');
    if (backBtn) backBtn.addEventListener('click', backToPlans);
    const submitBtn = document.getElementById('btnSubmitSignup');
    if (submitBtn) submitBtn.addEventListener('click', submitPayment);
    const agreeBox = document.getElementById('mem_agree_terms');
    if (agreeBox) {
        agreeBox.addEventListener('change', function () {
            if (submitBtn) submitBtn.disabled = !agreeBox.checked;
        });
    }
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
    // Pay button stays disabled until the Terms and Conditions checkbox is
    // checked (see the 'change' listener wired up in DOMContentLoaded).
    const agreeBox = document.getElementById('mem_agree_terms');
    if (agreeBox) agreeBox.checked = false;
    const submitBtn = document.getElementById('btnSubmitSignup');
    if (submitBtn) submitBtn.disabled = true;
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

async function submitPayment() {
    if (!selectedPlan) return;
    const name = document.getElementById('mem_name').value.trim();
    const phone = document.getElementById('mem_phone').value.trim();
    const email = document.getElementById('mem_email').value.trim();
    const notes = document.getElementById('mem_notes').value.trim();
    const agreeTerms = document.getElementById('mem_agree_terms').checked;

    if (!name || !phone || !email) {
        alert('Please fill in your name, phone number and email.');
        return;
    }
    if (!agreeTerms) {
        alert('Please accept the Membership Terms and Conditions to continue.');
        return;
    }

    const submitBtn = document.getElementById('btnSubmitSignup');
    submitBtn.disabled = true;
    showLoading('Starting payment...');

    try {
        const orderRes = await fetch('/api/customers?resource=membership-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                plan_id: selectedPlan.id,
                member_name: name,
                member_phone: phone,
                member_email: email,
                notes: notes,
                terms_accepted: agreeTerms
            })
        });
        const orderData = await orderRes.json();
        hideLoading();
        if (!orderRes.ok || !orderData.id) {
            submitBtn.disabled = false;
            alert(orderData.error || 'Could not start payment. Please try again.');
            return;
        }
        openRazorpayCheckout(orderData, name, email, phone);
    } catch (err) {
        hideLoading();
        submitBtn.disabled = false;
        alert('Network error. Please try again.');
    }
}

function openRazorpayCheckout(order, name, email, phone) {
    const options = {
        key: 'rzp_live_T90dB0bfW4qEMO',
        amount: order.amount,
        currency: order.currency || 'INR',
        name: 'PlayBox Kashmir™',
        description: selectedPlan.name + ' Membership',
        image: 'https://playboxkashmir.com/assets/images/logo.png',
        order_id: order.id,
        prefill: {
            name: name,
            email: email,
            contact: phone
        },
        notes: {
            type: 'membership',
            plan_id: String(selectedPlan.id)
        },
        theme: { color: '#15803d' },
        handler: function (response) {
            verifyAndConfirm(response);
        },
        modal: {
            ondismiss: function () {
                document.getElementById('btnSubmitSignup').disabled = false;
            }
        }
    };
    try {
        const rzp = new Razorpay(options);
        rzp.open();
    } catch (err) {
        alert('Unable to open the payment gateway. Please refresh and try again.');
        document.getElementById('btnSubmitSignup').disabled = false;
    }
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
            showConfirmation();
        } else {
            alert('Payment could not be verified. If money was deducted, it will be refunded. Please contact support.');
            document.getElementById('btnSubmitSignup').disabled = false;
        }
    }).catch(function () {
        hideLoading();
        alert('Payment verification failed due to a network error. Please contact support with your payment ID.');
        document.getElementById('btnSubmitSignup').disabled = false;
    });
}

function showConfirmation() {
    document.getElementById('signupFormSection').style.display = 'none';
    document.getElementById('confirmationSection').style.display = 'block';
}
