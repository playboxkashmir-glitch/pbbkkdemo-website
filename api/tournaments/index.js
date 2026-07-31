// Vercel Serverless Function: Tournaments module.
// Every tournament-related operation (admin settings, public listing,
// registration, entry-fee payment orders, and match result recording)
// is routed through this single file via method + ?resource= so that we
// only use one extra serverless function slot on the Hobby plan.
import { query } from '../../lib/db.js';
import { requireAuth } from '../../lib/auth.js';
import { seedTournamentIfFull, recordMatchResult } from '../../lib/tournament.js';
import { sendTournamentCancellationEmail } from '../../lib/email.js';

const CATEGORIES = ['open', 'invite'];
const FORMATS = ['5-a-side', '6-a-side', '7-a-side'];
const TEAM_SIZES = [4, 8, 16, 32];
const STATUSES = ['draft', 'open', 'full', 'seeded', 'in_progress', 'completed', 'cancelled'];

function parseBody(req) {
  return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
}

export default async function handler(req, res) {
  const resource = req.query.resource;

try {
  if (req.method === 'GET') {
    if (resource === 'admin-list') return handleAdminList(req, res);
    if (resource === 'admin-detail') return handleAdminDetail(req, res);
    if (resource === 'invite-check') return handleInviteCheck(req, res);
    if (resource === 'bracket') return handleBracket(req, res);
    if (req.query.id) return handlePublicDetail(req, res);
    return handlePublicList(req, res);
  }

  if (req.method === 'POST') {
    if (resource === 'register-team') return handleRegister(req, res);
    if (resource === 'create-order') return handleCreateOrder(req, res);
    if (resource === 'record-result') return handleRecordResult(req, res);
    return handleCreate(req, res);
  }

  if (req.method === 'PATCH') {
    return handleUpdate(req, res);
  }

  if (req.method === 'DELETE') {
    return handleDelete(req, res);
  }

  res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
} catch (err) {
  console.error('Tournaments API error:', err);
  return res.status(500).json({ error: 'Server error.' });
}
}

// ---- Public: list tournaments open for registration ----
async function handlePublicList(req, res) {
  const rows = await query(
    "SELECT t.id, t.name, t.category, t.format, t.num_teams, t.entry_fee, t.start_date, t.registration_deadline, t.status, " +
    "(SELECT COUNT(*) FROM tournament_teams tt WHERE tt.tournament_id = t.id AND tt.payment_status = 'paid') AS teams_registered " +
    "FROM tournaments t WHERE t.status = 'open' ORDER BY t.start_date ASC"
    );
  return res.status(200).json({ tournaments: rows.rows });
}

// ---- Public: single tournament detail (for the registration form) ----
async function handlePublicDetail(req, res) {
  const id = Number(req.query.id);
  if (!id) return res.status(400).json({ error: 'id is required.' });
  const tRes = await query(
    "SELECT t.id, t.name, t.category, t.format, t.num_teams, t.substitutes_allowed, t.entry_fee, t.start_date, " +
    "t.registration_deadline, t.duration_notes, t.rules, t.status, " +
    "(SELECT COUNT(*) FROM tournament_teams tt WHERE tt.tournament_id = t.id AND tt.payment_status = 'paid') AS teams_registered " +
    "FROM tournaments t WHERE t.id = $1",
    [id]
    );
  if (!tRes.rows.length) return res.status(404).json({ error: 'Tournament not found.' });
  return res.status(200).json({ tournament: tRes.rows[0] });
}

// ---- Public: check if an email is eligible for an invite-only tournament ----
async function handleInviteCheck(req, res) {
  const id = Number(req.query.id);
  const email = String(req.query.email || '').trim().toLowerCase();
  if (!id || !email) return res.status(400).json({ error: 'id and email are required.' });
  const inviteRes = await query(
    'SELECT id, used FROM tournament_invite_emails WHERE tournament_id = $1 AND lower(email) = $2',
    [id, email]
    );
  const eligible = inviteRes.rows.length > 0 && !inviteRes.rows[0].used;
  return res.status(200).json({ eligible });
}

// ---- Public: bracket / fixtures for display ----
async function handleBracket(req, res) {
  const id = Number(req.query.id);
  if (!id) return res.status(400).json({ error: 'id is required.' });
  const matchesRes = await query(
    'SELECT m.id, m.round, m.round_name, m.match_index, m.match_date, m.winner_id, ' +
    't1.team_name AS team1_name, t1.seed_label AS team1_seed, ' +
    't2.team_name AS team2_name, t2.seed_label AS team2_seed ' +
    'FROM tournament_matches m ' +
    'LEFT JOIN tournament_teams t1 ON t1.id = m.team1_id ' +
    'LEFT JOIN tournament_teams t2 ON t2.id = m.team2_id ' +
    'WHERE m.tournament_id = $1 ORDER BY m.round ASC, m.match_index ASC',
    [id]
    );
  return res.status(200).json({ matches: matchesRes.rows });
}

// ---- Admin: list every tournament (any status) ----
async function handleAdminList(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  const rows = await query(
    "SELECT t.*, (SELECT COUNT(*) FROM tournament_teams tt WHERE tt.tournament_id = t.id AND tt.payment_status = 'paid') AS teams_registered " +
    'FROM tournaments t ORDER BY t.created_at DESC'
    );
  return res.status(200).json({ tournaments: rows.rows });
}

// ---- Admin: full detail (invite emails, teams, players, matches) ----
async function handleAdminDetail(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  const id = Number(req.query.id);
  if (!id) return res.status(400).json({ error: 'id is required.' });

const tRes = await query('SELECT * FROM tournaments WHERE id = $1', [id]);
  if (!tRes.rows.length) return res.status(404).json({ error: 'Tournament not found.' });
  const tournament = tRes.rows[0];

const invitesRes = await query('SELECT id, slot_index, email, used FROM tournament_invite_emails WHERE tournament_id = $1 ORDER BY slot_index', [id]);
  const teamsRes = await query('SELECT * FROM tournament_teams WHERE tournament_id = $1 ORDER BY id', [id]);
  const teamIds = teamsRes.rows.map((t) => t.id);
  let players = [];
  if (teamIds.length) {
    const playersRes = await query('SELECT * FROM tournament_players WHERE team_id = ANY($1::int[]) ORDER BY is_substitute, id', [teamIds]);
    players = playersRes.rows;
  }
  const matchesRes = await query('SELECT * FROM tournament_matches WHERE tournament_id = $1 ORDER BY round, match_index', [id]);

return res.status(200).json({
  tournament,
  invite_emails: invitesRes.rows,
  teams: teamsRes.rows.map((t) => Object.assign({}, t, { players: players.filter((p) => p.team_id === t.id) })),
  matches: matchesRes.rows
});
}

// ---- Admin: create a new tournament ----
async function handleCreate(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  const body = parseBody(req);
  const { name, category, format, num_teams, substitutes_allowed, start_date, registration_deadline, entry_fee, duration_notes, rules, invite_emails } = body;

if (!name || !category || !format || !num_teams || !start_date) {
  return res.status(400).json({ error: 'name, category, format, num_teams and start_date are required.' });
}
  if (CATEGORIES.indexOf(category) === -1) {
    return res.status(400).json({ error: 'category must be "open" or "invite".' });
  }
  if (FORMATS.indexOf(format) === -1) {
    return res.status(400).json({ error: 'format must be 5-a-side, 6-a-side or 7-a-side.' });
  }
  if (TEAM_SIZES.indexOf(Number(num_teams)) === -1) {
    return res.status(400).json({ error: 'num_teams must be 4, 8, 16 or 32.' });
  }

const insertRes = await query(
  "INSERT INTO tournaments (name, category, format, num_teams, substitutes_allowed, start_date, registration_deadline, entry_fee, duration_notes, rules, status) " +
  "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'open') RETURNING *",
  [name, category, format, Number(num_teams), Number(substitutes_allowed) || 3, start_date, registration_deadline || null, Number(entry_fee) || 0, duration_notes || null, rules || null]
  );
  const tournament = insertRes.rows[0];

if (category === 'invite') {
  const emails = Array.isArray(invite_emails) ? invite_emails : [];
  for (let i = 0; i < Number(num_teams); i++) {
    const email = (emails[i] || '').trim() || null;
    await query('INSERT INTO tournament_invite_emails (tournament_id, slot_index, email) VALUES ($1, $2, $3)', [tournament.id, i, email]);
  }
}

return res.status(201).json({ tournament });
}

// ---- Admin: update tournament settings and/or invite emails ----
async function handleUpdate(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  const body = parseBody(req);
    const id = Number(req.query.id || body.id);
    if (!id) return res.status(400).json({ error: 'id is required.' });

    if (body.category !== undefined && CATEGORIES.indexOf(body.category) === -1) {
          return res.status(400).json({ error: 'category must be "open" or "invite".' });
    }
    if (body.format !== undefined && FORMATS.indexOf(body.format) === -1) {
          return res.status(400).json({ error: 'format must be 5-a-side, 6-a-side or 7-a-side.' });
    }
    if (body.num_teams !== undefined && TEAM_SIZES.indexOf(Number(body.num_teams)) === -1) {
          return res.status(400).json({ error: 'num_teams must be 4, 8, 16 or 32.' });
    }
    if (body.status !== undefined && STATUSES.indexOf(body.status) === -1) {
          return res.status(400).json({ error: 'Invalid status.' });
    }

    const existingRes = await query('SELECT * FROM tournaments WHERE id = $1', [id]);
    const existing = existingRes.rows[0];
    if (!existing) return res.status(404).json({ error: 'Tournament not found.' });
    const isCancelling = body.status === 'cancelled' && existing.status !== 'cancelled';

const fields = ['name', 'category', 'format', 'num_teams', 'substitutes_allowed', 'start_date', 'registration_deadline', 'entry_fee', 'duration_notes', 'rules', 'status'];
  const sets = [];
  const values = [];
  let i = 1;
  fields.forEach((f) => {
    if (body[f] !== undefined) {
      sets.push(f + ' = $' + i);
      values.push(body[f]);
      i++;
    }
  });
  if (sets.length) {
    sets.push('updated_at = now()');
    values.push(id);
    await query('UPDATE tournaments SET ' + sets.join(', ') + ' WHERE id = $' + i, values);
  }

if (Array.isArray(body.invite_emails)) {
  for (let idx = 0; idx < body.invite_emails.length; idx++) {
    const email = (body.invite_emails[idx] || '').trim() || null;
    await query(
      'INSERT INTO tournament_invite_emails (tournament_id, slot_index, email) VALUES ($1, $2, $3) ON CONFLICT (tournament_id, slot_index) DO UPDATE SET email = EXCLUDED.email',
      [id, idx, email]
      );
  }
}

const tRes = await query('SELECT * FROM tournaments WHERE id = $1', [id]);
    const tournament = tRes.rows[0];

    if (isCancelling) {
          const teamsRes = await query('SELECT * FROM tournament_teams WHERE tournament_id = $1', [id]);
          for (const team of teamsRes.rows) {
                  try {
                            await sendTournamentCancellationEmail(team, tournament);
                  } catch (emailErr) {
                            console.error('Failed to send tournament cancellation email:', emailErr);
                  }
          }
    }

    return res.status(200).json({ tournament });
}

// ---- Admin: delete/cancel a tournament ----
async function handleDelete(req, res) {
    const user = await requireAuth(req, res);
    if (!user) return;
    const id = Number(req.query.id);
    if (!id) return res.status(400).json({ error: 'id is required.' });

    const tRes2 = await query('SELECT * FROM tournaments WHERE id = $1', [id]);
    const tournament = tRes2.rows[0];
    if (!tournament) return res.status(404).json({ error: 'Tournament not found.' });

    const teamsRes = await query('SELECT * FROM tournament_teams WHERE tournament_id = $1', [id]);
    for (const team of teamsRes.rows) {
          try {
                  await sendTournamentCancellationEmail(team, tournament);
          } catch (emailErr) {
                  console.error('Failed to send tournament cancellation email:', emailErr);
          }
    }

    await query('DELETE FROM tournaments WHERE id = $1', [id]);
    return res.status(200).json({ success: true });
}

// ---- Public: register a team for a tournament ----
async function handleRegister(req, res) {
  const body = parseBody(req);
  const { tournament_id, contact_number, email, team_name, captain_name, players } = body;

if (!tournament_id || !contact_number || !email || !team_name || !captain_name || !Array.isArray(players) || !players.length) {
  return res.status(400).json({ error: 'Missing required registration fields.' });
}

const tRes = await query('SELECT * FROM tournaments WHERE id = $1', [tournament_id]);
  const tournament = tRes.rows[0];
  if (!tournament) return res.status(404).json({ error: 'Tournament not found.' });
  if (tournament.status !== 'open') {
    return res.status(400).json({ error: 'This tournament is not currently open for registration.' });
  }

const countRes = await query("SELECT COUNT(*) FROM tournament_teams WHERE tournament_id = $1 AND payment_status = 'paid'", [tournament_id]);
  if (Number(countRes.rows[0].count) >= tournament.num_teams) {
    return res.status(400).json({ error: 'This tournament is already full.' });
  }

const normalizedEmail = String(email).trim().toLowerCase();

if (tournament.category === 'invite') {
  const inviteRes = await query('SELECT id, used FROM tournament_invite_emails WHERE tournament_id = $1 AND lower(email) = $2', [tournament_id, normalizedEmail]);
  if (!inviteRes.rows.length || inviteRes.rows[0].used) {
    return res.status(403).json({ error: 'Sorry, you are not eligible for this tournament. Please try a different tournament or contact us.' });
  }
}

const existingRes = await query('SELECT id, payment_status FROM tournament_teams WHERE tournament_id = $1 AND lower(email) = $2', [tournament_id, normalizedEmail]);
    if (existingRes.rows.length) {
          if (existingRes.rows[0].payment_status === 'paid') {
                  return res.status(400).json({ error: 'A team has already registered with this email for this tournament.' });
          }
          await query('DELETE FROM tournament_teams WHERE id = $1', [existingRes.rows[0].id]);
    }

const teamRes = await query(
  'INSERT INTO tournament_teams (tournament_id, team_name, captain_name, contact_number, email) VALUES ($1,$2,$3,$4,$5) RETURNING *',
  [tournament_id, team_name, captain_name, contact_number, normalizedEmail]
  );
  const team = teamRes.rows[0];

const starters = parseInt(String(tournament.format).split('-')[0], 10) || 5;
    for (let i = 0; i < players.length; i++) {
          const p = players[i];
          await query(
                  'INSERT INTO tournament_players (team_id, player_name, jersey_number, is_substitute) VALUES ($1,$2,$3,$4)',
                  [team.id, p.name, p.jersey_number || null, i >= starters]
                );
    }

if (tournament.category === 'invite') {
  await query('UPDATE tournament_invite_emails SET used = true WHERE tournament_id = $1 AND lower(email) = $2', [tournament_id, normalizedEmail]);
}

return res.status(201).json({ team_id: team.id, entry_fee: tournament.entry_fee });
}

// ---- Public: create a Razorpay order for a team's entry fee ----
async function handleCreateOrder(req, res) {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    return res.status(500).json({ error: 'Payment gateway is not configured.' });
  }

const body = parseBody(req);
  const { team_id } = body;
  if (!team_id) return res.status(400).json({ error: 'team_id is required.' });
  if (body.terms_accepted !== true) {
    return res.status(400).json({ error: 'You must accept the Terms & Conditions before payment.' });
  }

const teamRes = await query('SELECT * FROM tournament_teams WHERE id = $1', [team_id]);
  const team = teamRes.rows[0];
  if (!team) return res.status(404).json({ error: 'Team registration not found.' });
  if (team.payment_status === 'paid') return res.status(400).json({ error: 'This team has already paid.' });

const tRes = await query('SELECT * FROM tournaments WHERE id = $1', [team.tournament_id]);
  const tournament = tRes.rows[0];
  const amount = Math.round(Number(tournament.entry_fee) * 100);
  if (!Number.isInteger(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Invalid entry fee configured for this tournament.' });
  }

const notes = {
  type: 'tournament',
  team_id: String(team.id),
  tournament_id: String(tournament.id),
  team_name: team.team_name,
  captain_name: team.captain_name,
  email: team.email,
  contact_number: team.contact_number,
  amount: tournament.entry_fee,
  terms_accepted: body.terms_accepted
};

const auth = Buffer.from(keyId + ':' + keySecret).toString('base64');
  const rpRes = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Basic ' + auth },
    body: JSON.stringify({ amount: amount, currency: 'INR', receipt: 'TRN' + team.id, notes: notes })
  });
  const data = await rpRes.json();
  if (!rpRes.ok) {
    const message = (data && data.error && data.error.description) || 'Order creation failed.';
    return res.status(rpRes.status).json({ error: message });
  }

await query('UPDATE tournament_teams SET razorpay_order_id = $1, terms_accepted_at = now() WHERE id = $2', [data.id, team.id]);

return res.status(200).json({ id: data.id, amount: data.amount, currency: data.currency });
}

// ---- Admin: record a match result and advance the winner ----
async function handleRecordResult(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  const body = parseBody(req);
  const { match_id, winner_id } = body;
  if (!match_id || !winner_id) return res.status(400).json({ error: 'match_id and winner_id are required.' });
  const result = await recordMatchResult(Number(match_id), Number(winner_id));
  return res.status(200).json(result);
}
