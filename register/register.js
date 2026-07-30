let TOURNAMENTS = [];
let selectedTournament = null;
let currentTeamId = null;

document.addEventListener('DOMContentLoaded', () => {
    loadTournaments();
    const backBtn = document.getElementById('btnBackToList');
    if (backBtn) backBtn.addEventListener('click', backToList);
    const payBtn = document.getElementById('btnPayRegister');
    if (payBtn) payBtn.addEventListener('click', submitRegistration);
    const emailInput = document.getElementById('reg_email');
    if (emailInput) emailInput.addEventListener('blur', onEmailBlur);
});

async function loadTournaments() {
    const container = document.getElementById('tournamentCards');
    if (!container) return;
    try {
          const res = await fetch('/api/tournaments?resource=list');
          if (!res.ok) throw new Error('load failed');
          const data = await res.json();
          TOURNAMENTS = data.tournaments || [];
          if (!TOURNAMENTS.length) {
                  container.innerHTML = '<p>No tournaments are open for registration right now. Please check back soon.</p>';
                  return;
          }
          container.innerHTML = TOURNAMENTS.map(renderTournamentCard).join('');
          TOURNAMENTS.forEach(function (t) {
                  const el = document.getElementById('tcard_' + t.id);
                  if (el) el.addEventListener('click', function () { selectTournament(t); });
          });
    } catch (err) {
          container.innerHTML = '<p>Could not load tournaments. Please refresh the page.</p>';
    }
}

function renderTournamentCard(t) {
    const badgeLabel = t.category === 'invite_only' ? 'Invite Only' : 'Open For All';
    return '<div class="tourn-card" id="tcard_' + t.id + '">' +
          '<span class="tourn-card-badge ' + t.category + '">' + badgeLabel + '</span>' +
          '<h3>' + escapeHtmlLocal(t.name) + '</h3>' +
          '<p>' + escapeHtmlLocal(capitalizeWordLocal(t.format)) + '</p>' +
                '<p>Starts ' + formatDateOnlyLocal(t.start_date) + '</p>' +
                '<div class="tourn-fee">Entry Fee: ₹' + (t.entry_fee || 0) + '</div>' +
          '</div>';
}

function escapeHtmlLocal(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function formatDateOnlyLocal(str) {
        if (!str) return 'TBA';
        const d = new Date(str);
        if (isNaN(d.getTime())) return 'TBA';
        return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function capitalizeWordLocal(str) {
    if (!str) return '';
    return String(str).replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
}

function selectTournament(t) {
    selectedTournament = t;
    document.getElementById('tournamentListSection').style.display = 'none';
    document.getElementById('registrationFormSection').style.display = 'block';
    document.getElementById('selectedTournamentName').textContent = t.name;
    document.getElementById('selectedTournamentSub').textContent = capitalizeWordLocal(t.format) + ' - ' + (t.category === 'invite_only' ? 'Invite Only' : 'Open For All');
    document.getElementById('reg_entry_fee_display').textContent = '₹' + (t.entry_fee || 0);
    const msg = document.getElementById('eligibilityMsg');
    msg.className = 'eligibility-msg';
    msg.textContent = '';
    buildPlayerInputs(t);
}

function backToList() {
    selectedTournament = null;
    document.getElementById('registrationFormSection').style.display = 'none';
    document.getElementById('tournamentListSection').style.display = 'block';
}

function buildPlayerInputs(t) {
    const container = document.getElementById('playersContainer');
    if (!container) return;
    const starters = parseInt(String(t.format).split('-')[0], 10) || 5;
    const subs = (typeof t.substitutes === 'number') ? t.substitutes : 3;
    const total = starters + subs;
    let html = '';
    for (let i = 0; i < total; i++) {
          const label = i < starters ? ('Player ' + (i + 1)) : ('Substitute ' + (i - starters + 1));
          html += '<div class="player-row">' +
                  '<input type="text" class="player-name-input" placeholder="' + label + ' Name">' +
                  '<input type="number" class="player-jersey-input" placeholder="Jersey #">' +
                  '</div>';
    }
    container.innerHTML = html;
}

async function onEmailBlur() {
    if (!selectedTournament || selectedTournament.category !== 'invite_only') return;
    const email = document.getElementById('reg_email').value.trim();
    const msg = document.getElementById('eligibilityMsg');
    if (!email) return;
    try {
          const res = await fetch('/api/tournaments?resource=invite-check&id=' + selectedTournament.id + '&email=' + encodeURIComponent(email));
          const data = await res.json();
          if (data.eligible) {
                  msg.className = 'eligibility-msg success';
                  msg.textContent = 'You are eligible to register for this tournament.';
          } else {
                  msg.className = 'eligibility-msg error';
                  msg.textContent = 'Sorry, you are not eligible for this tournament. Please try a different tournament or contact us.';
          }
    } catch (err) {
          msg.className = 'eligibility-msg';
          msg.textContent = '';
    }
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

async function submitRegistration() {
    if (!selectedTournament) return;
    const teamName = document.getElementById('reg_team_name').value.trim();
    const captainName = document.getElementById('reg_captain_name').value.trim();
    const contactNumber = document.getElementById('reg_contact_number').value.trim();
    const email = document.getElementById('reg_email').value.trim();
    const agreeTerms = document.getElementById('reg_agree_terms').checked;

  if (!teamName || !captainName || !contactNumber || !email) {
        alert('Please fill in all team details.');
        return;
  }
    if (!agreeTerms) {
          alert('Please accept the Terms and Conditions to continue.');
          return;
    }

  const nameInputs = document.querySelectorAll('.player-name-input');
    const jerseyInputs = document.querySelectorAll('.player-jersey-input');
    const players = [];
    for (let i = 0; i < nameInputs.length; i++) {
          const name = nameInputs[i].value.trim();
          if (name) {
                  players.push({ name: name, jersey_number: jerseyInputs[i].value.trim() });
          }
    }

  const payBtn = document.getElementById('btnPayRegister');
    payBtn.disabled = true;
    showLoading('Registering your team...');

  try {
        const res = await fetch('/api/tournaments?resource=register-team', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                          tournament_id: selectedTournament.id,
                          team_name: teamName,
                          captain_name: captainName,
                          contact_number: contactNumber,
                          email: email,
                          players: players
                })
        });
        const data = await res.json();
        if (!res.ok) {
                hideLoading();
                payBtn.disabled = false;
                alert(data.error || 'Could not register your team.');
                return;
        }
        currentTeamId = data.team_id;

      const orderRes = await fetch('/api/tournaments?resource=create-order', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ team_id: currentTeamId, terms_accepted: agreeTerms })
      });
        const orderData = await orderRes.json();
        hideLoading();
        if (!orderRes.ok || !orderData.id) {
                payBtn.disabled = false;
                alert(orderData.error || 'Could not start payment. Please try again.');
                return;
        }
        openRazorpayCheckout(orderData, teamName, email, contactNumber);
  } catch (err) {
        hideLoading();
        payBtn.disabled = false;
        alert('Network error. Please try again.');
  }
}

function openRazorpayCheckout(order, teamName, email, contactNumber) {
    const options = {
          key: 'rzp_live_T90dB0bfW4qEMO',
          amount: order.amount,
          currency: 'INR',
          name: 'PlayBox Kashmir™',
          description: selectedTournament.name + ' - Entry Fee',
          image: 'https://playboxkashmir.com/assets/images/logo.png',
          order_id: order.id,
          prefill: {
                  name: teamName,
                  email: email,
                  contact: contactNumber
          },
          notes: {
                  type: 'tournament',
                  team_id: String(currentTeamId),
                  tournament_id: String(selectedTournament.id)
          },
          theme: { color: '#15803d' },
          handler: function (response) {
                  verifyAndConfirm(response);
          },
          modal: {
                  ondismiss: function () {
                            document.getElementById('btnPayRegister').disabled = false;
                  }
          }
    };
    try {
          const rzp = new Razorpay(options);
          rzp.open();
    } catch (err) {
          alert('Unable to open the payment gateway. Please refresh and try again.');
          document.getElementById('btnPayRegister').disabled = false;
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
                  document.getElementById('btnPayRegister').disabled = false;
          }
    }).catch(function () {
          hideLoading();
          alert('Payment verification failed due to a network error. Please contact support with your payment ID.');
          document.getElementById('btnPayRegister').disabled = false;
    });
}

function showConfirmation() {
    document.getElementById('registrationFormSection').style.display = 'none';
    document.getElementById('confirmationSection').style.display = 'block';
}
