// Vercel Serverless Function: Customers & Memberships module.
// Handles the customers list (derived from booking history) plus membership
// plan management and member enrollment. Routed via method + ?resource= so
// this stays within a single serverless function slot on the Hobby plan.

import { query } from '../../lib/db.js';
import { requireAuth } from '../../lib/auth.js';
import { sendMembershipSignupEmail } from '../../lib/email.js';

const BILLING_CYCLES = ['monthly', 'quarterly', 'half_yearly', 'annual', 'one_time'];
const DISCOUNT_TYPES = ['none', 'percent', 'flat'];
// 'pending' covers a public sign-up (register.playboxkashmir.com) that is
// awaiting staff review and payment; admin-created members go straight to 'active'.
const MEMBERSHIP_STATUSES = ['pending', 'active', 'expired', 'cancelled'];

function parseBody(req) {
  return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
}

// The membership tables were added after this module was first built, so
// this creates them on first use instead of requiring a manual migration
// step in production. Cheap once the tables exist (IF NOT EXISTS is a no-op)
// and cached per warm serverless instance so it only runs once per cold start.
let membershipTablesReady = false;
async function ensureMembershipTables() {
  if (membershipTablesReady) return;
  await query(`
    CREATE TABLE IF NOT EXISTS membership_plans (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      price NUMERIC(10,2) NOT NULL DEFAULT 0,
      billing_cycle TEXT NOT NULL DEFAULT 'monthly',
      discount_type TEXT NOT NULL DEFAULT 'none',
      discount_value NUMERIC(10,2) NOT NULL DEFAULT 0,
      discount_max_amount NUMERIC(10,2),
      complimentary_slots INTEGER NOT NULL DEFAULT 0,
      complimentary_frequency TEXT NOT NULL DEFAULT 'monthly',
      allow_reserve_without_payment BOOLEAN NOT NULL DEFAULT false,
      priority_booking BOOLEAN NOT NULL DEFAULT false,
      max_advance_booking_days INTEGER,
      applicable_sports JSONB NOT NULL DEFAULT '[]'::jsonb,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS memberships (
      id SERIAL PRIMARY KEY,
      plan_id INTEGER NOT NULL REFERENCES membership_plans(id),
      member_name TEXT NOT NULL,
      member_email TEXT NOT NULL,
      member_phone TEXT NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      complimentary_slots_total INTEGER NOT NULL DEFAULT 0,
      complimentary_slots_remaining INTEGER NOT NULL DEFAULT 0,
      complimentary_slots_reset_at DATE,
      amount_paid NUMERIC(10,2) NOT NULL DEFAULT 0,
      payment_method TEXT NOT NULL DEFAULT 'cash',
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_memberships_plan ON memberships (plan_id);
    CREATE INDEX IF NOT EXISTS idx_memberships_email ON memberships (member_email);
    CREATE TABLE IF NOT EXISTS membership_redemptions (
      id SERIAL PRIMARY KEY,
      membership_id INTEGER NOT NULL REFERENCES memberships(id),
      redemption_type TEXT NOT NULL,
      booking_id INTEGER,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_membership_redemptions_membership ON membership_redemptions (membership_id);
  `);
  // The memberships table already existed in production (created before this
  // module's schema.sql documentation was written) with a status CHECK
  // constraint that only allowed 'active' / 'expired' / 'cancelled'. Public
  // sign-ups need 'pending' too, so widen that constraint here - safe to run
  // every cold start since it drops and recreates the same-named constraint.
  await query(`
    ALTER TABLE memberships DROP CONSTRAINT IF EXISTS memberships_status_check;
    ALTER TABLE memberships ADD CONSTRAINT memberships_status_check
      CHECK (status = ANY (ARRAY['pending'::text, 'active'::text, 'expired'::text, 'cancelled'::text]));
  `);
  membershipTablesReady = true;
}

// Adds one billing/complimentary cycle to a YYYY-MM-DD date string.
function addCycle(dateStr, cycle) {
  const d = new Date(dateStr + 'T00:00:00Z');
  switch (cycle) {
    case 'monthly': d.setUTCMonth(d.getUTCMonth() + 1); break;
    case 'quarterly': d.setUTCMonth(d.getUTCMonth() + 3); break;
    case 'half_yearly': d.setUTCMonth(d.getUTCMonth() + 6); break;
    case 'annual': d.setUTCFullYear(d.getUTCFullYear() + 1); break;
    case 'one_time': d.setUTCFullYear(d.getUTCFullYear() + 100); break; // effectively no expiry
    default: d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return d.toISOString().slice(0, 10);
}

// Resources that touch the membership tables - ensure they exist first.
const MEMBERSHIP_RESOURCES = new Set([
  'plans', 'plan-detail', 'plan', 'members', 'member-detail', 'member',
  'redeem-slot', 'public-plans', 'signup'
]);

export default async function handler(req, res) {
  const resource = req.query.resource;

  try {
    if (MEMBERSHIP_RESOURCES.has(resource)) await ensureMembershipTables();

    if (req.method === 'GET') {
      if (resource === 'plans') return handleListPlans(req, res);
      if (resource === 'plan-detail') return handlePlanDetail(req, res);
      if (resource === 'members') return handleListMembers(req, res);
      if (resource === 'member-detail') return handleMemberDetail(req, res);
      // Public, unauthenticated: only what the register subdomain needs to
      // show customers the plans staff have marked active.
      if (resource === 'public-plans') return handleListPublicPlans(req, res);
      return handleListCustomers(req, res);
    }

    if (req.method === 'POST') {
      if (resource === 'plan') return handleCreatePlan(req, res);
      if (resource === 'member') return handleCreateMember(req, res);
      if (resource === 'redeem-slot') return handleRedeemSlot(req, res);
      // Public, unauthenticated: a customer requesting a plan from
      // register.playboxkashmir.com. Lands as 'pending' for staff review.
      if (resource === 'signup') return handleSignup(req, res);
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'Unknown resource for POST.' });
    }

    if (req.method === 'PATCH') {
      if (resource === 'plan') return handleUpdatePlan(req, res);
      if (resource === 'member') return handleUpdateMember(req, res);
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'Unknown resource for PATCH.' });
    }

    if (req.method === 'DELETE') {
      if (resource === 'plan') return handleDeletePlan(req, res);
      if (resource === 'member') return handleDeleteMember(req, res);
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'Unknown resource for DELETE.' });
    }

    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Customers/Memberships API error:', err);
    return res.status(500).json({ error: 'Server error.' });
  }
}

// ---------------- Customers (existing behaviour, unchanged) ----------------
async function handleListCustomers(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  const { search } = req.query || {};
  const params = [];
  let searchClause = '';
  if (search) {
    params.push(`%${search}%`);
    searchClause = `WHERE customer_name ILIKE $1 OR customer_email ILIKE $1 OR customer_phone ILIKE $1`;
  }
  const { rows } = await query(
    `SELECT
      customer_name,
      customer_email,
      customer_phone,
      COUNT(*) AS total_bookings,
      SUM(amount) FILTER (WHERE status IN ('confirmed','completed')) AS total_spent,
      MAX(booking_date) AS last_booking_date
    FROM bookings
    ${searchClause}
    GROUP BY customer_name, customer_email, customer_phone
    ORDER BY last_booking_date DESC`,
    params
  );
  return res.status(200).json({ customers: rows });
}

// ---------------- Membership Plans ----------------
async function handleListPlans(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  const { rows } = await query(
    `SELECT p.*, (SELECT COUNT(*) FROM memberships m WHERE m.plan_id = p.id AND m.status = 'active') AS active_members
     FROM membership_plans p ORDER BY p.created_at DESC`
  );
  return res.status(200).json({ plans: rows });
}

async function handlePlanDetail(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  const id = Number(req.query.id);
  if (!id) return res.status(400).json({ error: 'id is required.' });
  const { rows } = await query('SELECT * FROM membership_plans WHERE id = $1', [id]);
  if (!rows.length) return res.status(404).json({ error: 'Plan not found.' });
  return res.status(200).json({ plan: rows[0] });
}

async function handleCreatePlan(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  const body = parseBody(req);
  const {
    name, description, price, billing_cycle, discount_type, discount_value,
    discount_max_amount, complimentary_slots, complimentary_frequency,
    allow_reserve_without_payment, priority_booking, max_advance_booking_days,
    applicable_sports
  } = body;

  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Plan name is required.' });
  const cycle = billing_cycle || 'monthly';
  if (BILLING_CYCLES.indexOf(cycle) === -1) {
    return res.status(400).json({ error: 'billing_cycle must be one of ' + BILLING_CYCLES.join(', ') + '.' });
  }
  const dType = discount_type || 'none';
  if (DISCOUNT_TYPES.indexOf(dType) === -1) {
    return res.status(400).json({ error: 'discount_type must be one of ' + DISCOUNT_TYPES.join(', ') + '.' });
  }
  const compFreq = complimentary_frequency || 'monthly';
  if (BILLING_CYCLES.indexOf(compFreq) === -1) {
    return res.status(400).json({ error: 'complimentary_frequency must be one of ' + BILLING_CYCLES.join(', ') + '.' });
  }

  const insertRes = await query(
    `INSERT INTO membership_plans
      (name, description, price, billing_cycle, discount_type, discount_value, discount_max_amount,
       complimentary_slots, complimentary_frequency, allow_reserve_without_payment, priority_booking,
       max_advance_booking_days, applicable_sports)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [
      String(name).trim(),
      description || null,
      Number(price) || 0,
      cycle,
      dType,
      Number(discount_value) || 0,
      (discount_max_amount !== undefined && discount_max_amount !== '') ? Number(discount_max_amount) : null,
      Number(complimentary_slots) || 0,
      compFreq,
      !!allow_reserve_without_payment,
      !!priority_booking,
      (max_advance_booking_days !== undefined && max_advance_booking_days !== '') ? Number(max_advance_booking_days) : null,
      JSON.stringify(Array.isArray(applicable_sports) ? applicable_sports : [])
    ]
  );
  return res.status(201).json({ plan: insertRes.rows[0] });
}

async function handleUpdatePlan(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  const body = parseBody(req);
  const id = Number(req.query.id || body.id);
  if (!id) return res.status(400).json({ error: 'id is required.' });

  if (body.billing_cycle !== undefined && BILLING_CYCLES.indexOf(body.billing_cycle) === -1) {
    return res.status(400).json({ error: 'billing_cycle must be one of ' + BILLING_CYCLES.join(', ') + '.' });
  }
  if (body.discount_type !== undefined && DISCOUNT_TYPES.indexOf(body.discount_type) === -1) {
    return res.status(400).json({ error: 'discount_type must be one of ' + DISCOUNT_TYPES.join(', ') + '.' });
  }
  if (body.complimentary_frequency !== undefined && BILLING_CYCLES.indexOf(body.complimentary_frequency) === -1) {
    return res.status(400).json({ error: 'complimentary_frequency must be one of ' + BILLING_CYCLES.join(', ') + '.' });
  }

  const fields = [];
  const values = [];
  let i = 1;
  function set(col, val) { fields.push(col + ' = $' + i); values.push(val); i++; }

  if (body.name !== undefined) set('name', String(body.name).trim());
  if (body.description !== undefined) set('description', body.description);
  if (body.price !== undefined) set('price', Number(body.price) || 0);
  if (body.billing_cycle !== undefined) set('billing_cycle', body.billing_cycle);
  if (body.discount_type !== undefined) set('discount_type', body.discount_type);
  if (body.discount_value !== undefined) set('discount_value', Number(body.discount_value) || 0);
  if (body.discount_max_amount !== undefined) set('discount_max_amount', body.discount_max_amount === '' ? null : Number(body.discount_max_amount));
  if (body.complimentary_slots !== undefined) set('complimentary_slots', Number(body.complimentary_slots) || 0);
  if (body.complimentary_frequency !== undefined) set('complimentary_frequency', body.complimentary_frequency);
  if (body.allow_reserve_without_payment !== undefined) set('allow_reserve_without_payment', !!body.allow_reserve_without_payment);
  if (body.priority_booking !== undefined) set('priority_booking', !!body.priority_booking);
  if (body.max_advance_booking_days !== undefined) set('max_advance_booking_days', body.max_advance_booking_days === '' ? null : Number(body.max_advance_booking_days));
  if (body.applicable_sports !== undefined) set('applicable_sports', JSON.stringify(Array.isArray(body.applicable_sports) ? body.applicable_sports : []));
  if (body.is_active !== undefined) set('is_active', !!body.is_active);

  if (!fields.length) return res.status(400).json({ error: 'No fields to update.' });
  set('updated_at', new Date());
  values.push(id);

  const result = await query(
    'UPDATE membership_plans SET ' + fields.join(', ') + ' WHERE id = $' + i + ' RETURNING *',
    values
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Plan not found.' });
  return res.status(200).json({ plan: result.rows[0] });
}

async function handleDeletePlan(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  const id = Number(req.query.id);
  if (!id) return res.status(400).json({ error: 'id is required.' });
  const activeRes = await query("SELECT COUNT(*) FROM memberships WHERE plan_id = $1 AND status = 'active'", [id]);
  if (Number(activeRes.rows[0].count) > 0) {
    return res.status(400).json({ error: 'Cannot delete a plan with active members. Deactivate it instead.' });
  }
  const result = await query('DELETE FROM membership_plans WHERE id = $1 RETURNING id', [id]);
  if (!result.rows.length) return res.status(404).json({ error: 'Plan not found.' });
  return res.status(200).json({ success: true });
}

// Only what a customer on register.playboxkashmir.com needs to compare and
// choose a plan - no auth, so keep this to non-sensitive, customer-facing fields.
async function handleListPublicPlans(req, res) {
  const { rows } = await query(
    `SELECT id, name, description, price, billing_cycle, discount_type, discount_value,
            discount_max_amount, complimentary_slots, complimentary_frequency,
            allow_reserve_without_payment, priority_booking, applicable_sports
     FROM membership_plans
     WHERE is_active = true
     ORDER BY price ASC`
  );
  return res.status(200).json({ plans: rows });
}

// Public sign-up from register.playboxkashmir.com. Creates the membership as
// 'pending' with no payment recorded - staff confirm payment and flip it to
// 'active' from the admin Memberships page, the same way a walk-in enrollment
// is handled, just started by the customer instead of a staff member.
async function handleSignup(req, res) {
  const body = parseBody(req);
  const { plan_id, member_name, member_email, member_phone, notes } = body;

  if (!plan_id || !member_name || !member_email || !member_phone) {
    return res.status(400).json({ error: 'plan_id, member_name, member_email and member_phone are required.' });
  }
  const emailStr = String(member_email).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailStr)) {
    return res.status(400).json({ error: 'A valid email address is required.' });
  }
  const phoneStr = String(member_phone).trim();
  if (phoneStr.replace(/\D/g, '').length < 7) {
    return res.status(400).json({ error: 'A valid phone number is required.' });
  }

  const planRes = await query('SELECT * FROM membership_plans WHERE id = $1 AND is_active = true', [Number(plan_id)]);
  if (!planRes.rows.length) return res.status(404).json({ error: 'Membership plan not found or no longer available.' });
  const plan = planRes.rows[0];

  const startDate = new Date().toISOString().slice(0, 10);
  const endDate = addCycle(startDate, plan.billing_cycle);
  const resetAt = addCycle(startDate, plan.complimentary_frequency);

  const insertRes = await query(
    `INSERT INTO memberships
      (plan_id, member_name, member_email, member_phone, start_date, end_date,
       complimentary_slots_total, complimentary_slots_remaining, complimentary_slots_reset_at,
       amount_paid, payment_method, notes, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending')
     RETURNING *`,
    [
      plan.id, String(member_name).trim(), emailStr, phoneStr,
      startDate, endDate, plan.complimentary_slots, plan.complimentary_slots, resetAt,
      0, 'pending', notes ? String(notes).trim().slice(0, 1000) : null
    ]
  );
  const membership = insertRes.rows[0];

  // Best-effort: a failed confirmation email should never fail the sign-up itself.
  try {
    await sendMembershipSignupEmail(membership, plan);
  } catch (emailErr) {
    console.error('Membership sign-up confirmation email failed:', emailErr);
  }

  return res.status(201).json({ member: membership });
}

// ---------------- Members (plan enrollments) ----------------
async function handleListMembers(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  const { search } = req.query || {};
  const params = [];
  let searchClause = '';
  if (search) {
    params.push(`%${search}%`);
    searchClause = `WHERE m.member_name ILIKE $1 OR m.member_email ILIKE $1 OR m.member_phone ILIKE $1`;
  }
  const { rows } = await query(
    `SELECT m.*, p.name AS plan_name, p.billing_cycle, p.allow_reserve_without_payment,
            p.discount_type, p.discount_value
     FROM memberships m
     JOIN membership_plans p ON p.id = m.plan_id
     ${searchClause}
     ORDER BY m.created_at DESC`,
    params
  );
  return res.status(200).json({ members: rows });
}

async function handleMemberDetail(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  const id = Number(req.query.id);
  if (!id) return res.status(400).json({ error: 'id is required.' });
  const memberRes = await query(
    `SELECT m.*, p.name AS plan_name, p.billing_cycle, p.allow_reserve_without_payment,
            p.discount_type, p.discount_value
     FROM memberships m JOIN membership_plans p ON p.id = m.plan_id WHERE m.id = $1`,
    [id]
  );
  if (!memberRes.rows.length) return res.status(404).json({ error: 'Member not found.' });
  const redemptionsRes = await query(
    'SELECT * FROM membership_redemptions WHERE membership_id = $1 ORDER BY created_at DESC',
    [id]
  );
  return res.status(200).json({ member: memberRes.rows[0], redemptions: redemptionsRes.rows });
}

async function handleCreateMember(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  const body = parseBody(req);
  const { plan_id, member_name, member_email, member_phone, start_date, amount_paid, payment_method, notes } = body;

  if (!plan_id || !member_name || !member_email || !member_phone) {
    return res.status(400).json({ error: 'plan_id, member_name, member_email and member_phone are required.' });
  }
  const planRes = await query('SELECT * FROM membership_plans WHERE id = $1', [Number(plan_id)]);
  if (!planRes.rows.length) return res.status(404).json({ error: 'Membership plan not found.' });
  const plan = planRes.rows[0];

  const startDate = start_date || new Date().toISOString().slice(0, 10);
  const endDate = body.end_date || addCycle(startDate, plan.billing_cycle);
  const resetAt = addCycle(startDate, plan.complimentary_frequency);

  const insertRes = await query(
    `INSERT INTO memberships
      (plan_id, member_name, member_email, member_phone, start_date, end_date,
       complimentary_slots_total, complimentary_slots_remaining, complimentary_slots_reset_at,
       amount_paid, payment_method, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [
      plan.id, String(member_name).trim(), String(member_email).trim(), String(member_phone).trim(),
      startDate, endDate, plan.complimentary_slots, plan.complimentary_slots, resetAt,
      Number(amount_paid) || 0, payment_method || 'cash', notes || null
    ]
  );
  return res.status(201).json({ member: insertRes.rows[0] });
}

async function handleUpdateMember(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  const body = parseBody(req);
  const id = Number(req.query.id || body.id);
  if (!id) return res.status(400).json({ error: 'id is required.' });

  if (body.status !== undefined && MEMBERSHIP_STATUSES.indexOf(body.status) === -1) {
    return res.status(400).json({ error: 'status must be one of ' + MEMBERSHIP_STATUSES.join(', ') + '.' });
  }

  const fields = [];
  const values = [];
  let i = 1;
  function set(col, val) { fields.push(col + ' = $' + i); values.push(val); i++; }

  if (body.member_name !== undefined) set('member_name', String(body.member_name).trim());
  if (body.member_email !== undefined) set('member_email', String(body.member_email).trim());
  if (body.member_phone !== undefined) set('member_phone', String(body.member_phone).trim());
  if (body.start_date !== undefined) set('start_date', body.start_date);
  if (body.end_date !== undefined) set('end_date', body.end_date);
  if (body.status !== undefined) set('status', body.status);
  if (body.complimentary_slots_remaining !== undefined) set('complimentary_slots_remaining', Number(body.complimentary_slots_remaining) || 0);
  if (body.complimentary_slots_reset_at !== undefined) set('complimentary_slots_reset_at', body.complimentary_slots_reset_at);
  if (body.amount_paid !== undefined) set('amount_paid', Number(body.amount_paid) || 0);
  if (body.payment_method !== undefined) set('payment_method', body.payment_method);
  if (body.notes !== undefined) set('notes', body.notes);

  if (body.reset_complimentary_slots) {
    const planRes = await query(
      'SELECT p.complimentary_slots, p.complimentary_frequency FROM membership_plans p JOIN memberships m ON m.plan_id = p.id WHERE m.id = $1',
      [id]
    );
    if (planRes.rows.length) {
      const plan = planRes.rows[0];
      set('complimentary_slots_remaining', plan.complimentary_slots);
      set('complimentary_slots_reset_at', addCycle(new Date().toISOString().slice(0, 10), plan.complimentary_frequency));
    }
  }

  if (!fields.length) return res.status(400).json({ error: 'No fields to update.' });
  set('updated_at', new Date());
  values.push(id);

  const result = await query(
    'UPDATE memberships SET ' + fields.join(', ') + ' WHERE id = $' + i + ' RETURNING *',
    values
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Member not found.' });
  return res.status(200).json({ member: result.rows[0] });
}

async function handleDeleteMember(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  const id = Number(req.query.id);
  if (!id) return res.status(400).json({ error: 'id is required.' });
  const result = await query('DELETE FROM memberships WHERE id = $1 RETURNING id', [id]);
  if (!result.rows.length) return res.status(404).json({ error: 'Member not found.' });
  return res.status(200).json({ success: true });
}

// ---------------- Redeem a complimentary slot ----------------
async function handleRedeemSlot(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  const body = parseBody(req);
  const id = Number(req.query.id || body.id);
  if (!id) return res.status(400).json({ error: 'id (membership id) is required.' });

  const memberRes = await query('SELECT * FROM memberships WHERE id = $1', [id]);
  if (!memberRes.rows.length) return res.status(404).json({ error: 'Member not found.' });
  const member = memberRes.rows[0];
  if (member.status !== 'active') return res.status(400).json({ error: 'Membership is not active.' });
  if (member.complimentary_slots_remaining <= 0) {
    return res.status(400).json({ error: 'No complimentary slots remaining.' });
  }

  const updateRes = await query(
    'UPDATE memberships SET complimentary_slots_remaining = complimentary_slots_remaining - 1, updated_at = now() WHERE id = $1 RETURNING *',
    [id]
  );
  await query(
    "INSERT INTO membership_redemptions (membership_id, redemption_type, booking_id, notes) VALUES ($1, 'complimentary_slot', $2, $3)",
    [id, body.booking_id || null, body.notes || null]
  );
  return res.status(200).json({ member: updateRes.rows[0] });
}
