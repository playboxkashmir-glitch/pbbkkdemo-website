// admin/tournaments.js
let currentTournamentId = null;

document.addEventListener('DOMContentLoaded', init);

async function init() {
    const ok = await checkSession();
    if (!ok) return;
    await loadTournaments();
    bind('createTournamentBtn', 'click', showCreateTournamentModal);
    bind('closeTournamentModalBtn', 'click', closeTournamentModal);
    bind('closeDetailModalBtn', 'click', closeDetailModal);
    bind('t_category', 'change', onCategoryChange);
    bind('t_num_teams', 'change', onNumTeamsChange);
    bind('saveTournamentBtn', 'click', saveTournament);
    bind('saveQuickSettingsBtn', 'click', saveQuickSettings);
    bind('saveInviteEmailsBtn', 'click', saveInviteEmails);
}

function bind(id, evt, fn) {
    const el = document.getElementById(id);
    if (el) el.addEventListener(evt, fn);
}

function capitalizeWord(str) {
    if (!str) return '';
    return String(str).replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
}

async function loadTournaments() {
    const tbody = document.getElementById('tournamentsTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6">Loading...</td></tr>';
    try {
          const res = await fetch('/api/tournaments?resource=admin-list', { credentials: 'include' });
          if (!res.ok) throw new Error('load failed');
          const data = await res.json();
          const rows = data.tournaments || [];
          if (!rows.length) {
                  tbody.innerHTML = '<tr><td colspan="6">No tournaments yet. Click "Create Tournament" to add one.</td></tr>';
                  return;
          }
          tbody.innerHTML = rows.map(renderTournamentRow).join('');
          rows.forEach(function (t) {
                  const btn = document.getElementById('viewBtn_' + t.id);
                  if (btn) btn.addEventListener('click', function () { openDetailModal(t.id); });
          });
    } catch (err) {
          tbody.innerHTML = '<tr><td colspan="6">Error loading tournaments.</td></tr>';
    }
}

function renderTournamentRow(t) {
    const catLabel = capitalizeWord(t.category);
    const formatLabel = capitalizeWord(t.format);
    const count = (t.registered_count || 0) + ' / ' + t.num_teams;
    return '<tr>' +
          '<td>' + escapeHtml(t.name) + '</td>' +
          '<td>' + catLabel + '</td>' +
          '<td>' + formatLabel + '</td>' +
          '<td>' + count + '</td>' +
          '<td>' + capitalizeWord(t.status) + '</td>' +
          '<td><button id="viewBtn_' + t.id + '" class="btn-secondary">View</button></td>' +
          '</tr>';
}

function showCreateTournamentModal() {
    const modal = document.getElementById('tournamentModal');
    if (!modal) return;
    document.getElementById('tournamentModalTitle').textContent = 'Create Tournament';
    document.getElementById('t_id').value = '';
    document.getElementById('t_name').value = '';
    document.getElementById('t_category').value = 'open';
    document.getElementById('t_format').value = '5-a-side';
    document.getElementById('t_num_teams').value = '8';
    document.getElementById('t_substitutes').value = '3';
    document.getElementById('t_start_date').value = '';
    document.getElementById('t_registration_deadline').value = '';
    document.getElementById('t_entry_fee').value = '';
    document.getElementById('t_duration_notes').value = '';
    document.getElementById('t_rules').value = '';
    onCategoryChange();
    onNumTeamsChange();
    modal.style.display = 'flex';
}

function closeTournamentModal() {
    const modal = document.getElementById('tournamentModal');
    if (modal) modal.style.display = 'none';
}

function onCategoryChange() {
    const cat = document.getElementById('t_category').value;
    const wrap = document.getElementById('inviteEmailsWrap');
    if (!wrap) return;
    wrap.style.display = cat === 'invite_only' ? 'block' : 'none';
    if (cat === 'invite_only') renderInviteEmailInputs();
}

function onNumTeamsChange() {
    const cat = document.getElementById('t_category').value;
    if (cat === 'invite_only') renderInviteEmailInputs();
}

function renderInviteEmailInputs(existingEmails) {
    const container = document.getElementById('inviteEmailInputs');
    if (!container) return;
    const numTeams = parseInt(document.getElementById('t_num_teams').value, 10) || 0;
    const emails = existingEmails || [];
    let html = '';
    for (let i = 0; i < numTeams; i++) {
          const val = emails[i] ? escapeHtml(emails[i]) : '';
          html += '<input type="email" class="invite-email-input" data-slot="' + i + '" placeholder="Team ' + (i + 1) + ' email (optional)" value="' + val + '" />';
    }
    container.innerHTML = html;
}

async function saveTournament() {
    const id = document.getElementById('t_id').value;
    const payload = {
          name: document.getElementById('t_name').value.trim(),
          category: document.getElementById('t_category').value,
          format: document.getElementById('t_format').value,
          num_teams: parseInt(document.getElementById('t_num_teams').value, 10),
          substitutes: parseInt(document.getElementById('t_substitutes').value, 10) || 3,
          start_date: document.getElementById('t_start_date').value,
          registration_deadline: document.getElementById('t_registration_deadline').value,
          entry_fee: parseFloat(document.getElementById('t_entry_fee').value) || 0,
          duration_notes: document.getElementById('t_duration_notes').value,
          rules: document.getElementById('t_rules').value
    };
    if (!payload.name) { alert('Please enter a tournament name.'); return; }
    if (payload.category === 'invite_only') {
          const inputs = document.querySelectorAll('.invite-email-input');
          payload.invite_emails = Array.from(inputs).map(function (inp) { return inp.value.trim(); });
    }
    try {
          const method = id ? 'PATCH' : 'POST';
          if (id) payload.id = id;
          const res = await fetch('/api/tournaments?resource=admin', {
                  method: method,
                  headers: { 'Content-Type': 'application/json' },
                  credentials: 'include',
                  body: JSON.stringify(payload)
          });
          if (!res.ok) {
                  const errData = await res.json().catch(function () { return {}; });
                  alert(errData.error || 'Failed to save tournament.');
                  return;
          }
          closeTournamentModal();
          await loadTournaments();
    } catch (err) {
          alert('Failed to save tournament.');
    }
}

async function openDetailModal(id) {
    currentTournamentId = id;
    const modal = document.getElementById('detailModal');
    const body = document.getElementById('detailModalBody');
    if (!modal || !body) return;
    body.innerHTML = 'Loading...';
    modal.style.display = 'flex';
    try {
          const res = await fetch('/api/tournaments?resource=admin-detail&id=' + encodeURIComponent(id), { credentials: 'include' });
          if (!res.ok) throw new Error('load failed');
          const data = await res.json();
          renderDetail(data.tournament);
    } catch (err) {
          body.innerHTML = 'Error loading tournament detail.';
    }
}

function closeDetailModal() {
    const modal = document.getElementById('detailModal');
    if (modal) modal.style.display = 'none';
    currentTournamentId = null;
}

function settingsField(label, value) {
    return '<div class="detail-field"><span class="detail-label">' + escapeHtml(label) + '</span><span class="detail-value">' + escapeHtml(String(value)) + '</span></div>';
}

function renderDetail(t) {
    const body = document.getElementById('detailModalBody');
    if (!body) return;
    let html = '<h3>' + escapeHtml(t.name) + '</h3>';
    html += '<div class="detail-grid">';
    html += settingsField('Category', capitalizeWord(t.category));
    html += settingsField('Format', capitalizeWord(t.format));
    html += settingsField('Teams', (t.registered_count || 0) + ' / ' + t.num_teams);
    html += settingsField('Status', capitalizeWord(t.status));
    html += settingsField('Start Date', t.start_date || '-');
    html += settingsField('Registration Deadline', t.registration_deadline || '-');
    html += '</div>';

  html += '<h4>Quick Settings</h4>';
    html += '<div class="quick-settings-form">';
    html += '<label>Status ' +
          '<select id="qs_status">' +
          '<option value="open"' + (t.status === 'open' ? ' selected' : '') + '>Open</option>' +
          '<option value="closed"' + (t.status === 'closed' ? ' selected' : '') + '>Closed</option>' +
          '<option value="in_progress"' + (t.status === 'in_progress' ? ' selected' : '') + '>In Progress</option>' +
          '<option value="completed"' + (t.status === 'completed' ? ' selected' : '') + '>Completed</option>' +
          '</select></label>';
    html += '<label>Entry Fee <input type="number" id="qs_entry_fee" value="' + (t.entry_fee || 0) + '" /></label>';
    html += '<button id="saveQuickSettingsBtn" class="btn-primary">Save</button>';
    html += '</div>';

  if (t.category === 'invite_only') {
        html += '<h4>Invite Emails</h4>';
        html += '<div id="inviteEmailsDetailWrap">';
        (t.invite_emails || []).forEach(function (e, i) {
                html += '<input type="email" class="invite-email-detail-input" data-slot="' + i + '" value="' + escapeHtml(e || '') + '" placeholder="Team ' + (i + 1) + ' email" />';
        });
        html += '</div>';
        html += '<button id="saveInviteEmailsBtn" class="btn-secondary">Save Invite Emails</button>';
  }

  html += '<h4>Registered Teams</h4>';
    const teams = t.teams || [];
    if (!teams.length) {
          html += '<p>No teams registered yet.</p>';
    } else {
          html += '<table class="detail-table"><thead><tr><th>Team</th><th>Captain</th><th>Email</th><th>Seed</th><th>Paid</th></tr></thead><tbody>';
          teams.forEach(function (team) {
                  html += '<tr>' +
                            '<td>' + escapeHtml(team.team_name) + '</td>' +
                            '<td>' + escapeHtml(team.captain_name) + '</td>' +
                            '<td>' + escapeHtml(team.email) + '</td>' +
                            '<td>' + escapeHtml(team.seed_label || '-') + '</td>' +
                            '<td>' + (team.paid ? 'Yes' : 'No') + '</td>' +
                            '</tr>';
          });
          html += '</tbody></table>';
    }

  const matches = t.matches || [];
    if (matches.length) {
          html += '<h4>Bracket</h4>';
          const rounds = {};
          matches.forEach(function (m) {
                  if (!rounds[m.round_number]) rounds[m.round_number] = [];
                  rounds[m.round_number].push(m);
          });
          Object.keys(rounds).sort(function (a, b) { return a - b; }).forEach(function (rn) {
                  html += '<h5>' + escapeHtml(rounds[rn][0].round_name || ('Round ' + rn)) + '</h5>';
                  rounds[rn].forEach(function (m) {
                            const teamAName = m.team_a_name || 'TBD';
                            const teamBName = m.team_b_name || 'TBD';
                            html += '<div class="match-row">';
                            html += '<span>' + escapeHtml(teamAName) + ' vs ' + escapeHtml(teamBName) + '</span>';
                            html += '<span>' + (m.match_date || 'TBD') + '</span>';
                            if (m.winner_id) {
                                        html += '<span>Winner: ' + escapeHtml(m.winner_id === m.team_a_id ? teamAName : teamBName) + '</span>';
                            } else if (m.team_a_id && m.team_b_id) {
                                        html += '<button class="btn-secondary" onclick="recordResult(' + m.id + ', ' + m.team_a_id + ')">Team A Wins</button>';
                                        html += '<button class="btn-secondary" onclick="recordResult(' + m.id + ', ' + m.team_b_id + ')">Team B Wins</button>';
                            }
                            html += '</div>';
                  });
          });
    }

  body.innerHTML = html;
    bind('saveQuickSettingsBtn', 'click', saveQuickSettings);
    bind('saveInviteEmailsBtn', 'click', saveInviteEmails);
}

async function saveQuickSettings() {
    if (!currentTournamentId) return;
    const status = document.getElementById('qs_status').value;
    const entryFee = parseFloat(document.getElementById('qs_entry_fee').value) || 0;
    try {
          const res = await fetch('/api/tournaments?resource=admin', {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  credentials: 'include',
                  body: JSON.stringify({ id: currentTournamentId, status: status, entry_fee: entryFee })
          });
          if (!res.ok) throw new Error('save failed');
          await loadTournaments();
          await openDetailModal(currentTournamentId);
    } catch (err) {
          alert('Failed to save settings.');
    }
}

async function saveInviteEmails() {
    if (!currentTournamentId) return;
    const inputs = document.querySelectorAll('.invite-email-detail-input');
    const emails = Array.from(inputs).map(function (inp) { return inp.value.trim(); });
    try {
          const res = await fetch('/api/tournaments?resource=admin', {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  credentials: 'include',
                  body: JSON.stringify({ id: currentTournamentId, invite_emails: emails })
          });
          if (!res.ok) throw new Error('save failed');
          await openDetailModal(currentTournamentId);
    } catch (err) {
          alert('Failed to save invite emails.');
    }
}

async function recordResult(matchId, winnerId) {
    if (!confirm('Record this team as the winner? This will advance them to the next round and email the next match to both teams.')) return;
    try {
          const res = await fetch('/api/tournaments?resource=record-result', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  credentials: 'include',
                  body: JSON.stringify({ match_id: matchId, winner_id: winnerId })
          });
          if (!res.ok) {
                  const errData = await res.json().catch(function () { return {}; });
                  alert(errData.error || 'Failed to record result.');
                  return;
          }
          await loadTournaments();
          await openDetailModal(currentTournamentId);
    } catch (err) {
          alert('Failed to record result.');
    }
}
