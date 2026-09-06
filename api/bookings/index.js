// Vercel Serverless Function: Consolidated bookings endpoints.
// Combines list/create, single-booking get/update/cancel, availability check,
// and confirmation email sending into one file to stay within the Vercel
// Hobby plan's 12-function limit. Vercel's optional catch-all dynamic route
// ([[...slug]].js) did not reliably match the bare path or sub-path segments
// on this project, so routing here is done via query parameters instead:
// /api/bookings                                (GET list, POST create - admin only)
// /api/bookings?id=123                          (GET/PATCH/DELETE single - admin only)
// /api/bookings?resource=availability&date=..    (GET availability - PUBLIC)
// /api/bookings?resource=membership-status&email=..&sport=..  (GET - PUBLIC: looks up
//    the caller's active membership discount + complimentary slot balance for a sport)
// /api/bookings?resource=complimentary-booking   (POST - PUBLIC: redeem a complimentary
//    slot from an active membership for a $0 booking, no payment gateway involved)
// /api/bookings?resource=send-confirmation       (POST send confirmation email - admin only)
import { query } from '../../lib/db.js';
import { requireAuth } from '../../lib/auth.js';
import { sendBookingConfirmationEmail, sendBookingCancellationEmail } from '../../lib/email.js'; const lookupAttempts = new Map(); const LOOKUP_WINDOW_MS = 10 * 60 * 1000; const LOOKUP_MAX_REQUESTS = 8; function getClientIp(req) { const fwd = req.headers['x-forwarded-for']; if (fwd) return String(fwd).split(',')[0].trim(); return (req.socket && req.socket.remoteAddress) || 'unknown'; } function isLookupRateLimited(ip) { const now = Date.now(); if (lookupAttempts.size > 5000) { for (const [key, entry] of lookupAttempts) { if (now - entry.windowStart > LOOKUP_WINDOW_MS) lookupAttempts.delete(key); } } const entry = lookupAttempts.get(ip); if (!entry || now - entry.windowStart > LOOKUP_WINDOW_MS) { lookupAttempts.set(ip, { count: 1, windowStart: now }); return false; } entry.count += 1; return entry.count > LOOKUP_MAX_REQUESTS; }

function generateBookingRef() {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `PBK-${ts}-${rand}`;
}

export default async function handler(req, res) {
  const { resource } = req.query;

// Slot availability must be readable by anonymous visitors on the public
// booking page, so this one resource is intentionally not behind requireAuth.
if (resource === 'availability') {
  return handleAvailability(req, res); } if (resource === 'customer-lookup') { return handleCustomerLookup(req, res);
}
if (resource === 'hold') { return handleHold(req, res); }
// Both membership resources below are intentionally public (no requireAuth):
// membership-status is read-only lookup-by-email used to render the discount/
// complimentary-slot UI on the public booking page, and complimentary-booking
// is how that same public page redeems a slot - same trust model as the
// Razorpay-backed booking flow, which is also public and self-service.
if (resource === 'membership-status') { return handleMembershipStatus(req, res); }
if (resource === 'complimentary-booking') { return handleComplimentaryBooking(req, res); }

const user = await requireAuth(req, res);
  if (!user) return;

const { id } = req.query;
  if (resource === 'send-confirmation') {
    return handleSendConfirmation(req, res);
  }
  if (resource === 'cancel') {
    return handleCancelBooking(req, res, user);
  }
  if (id) {
    return handleSingle(req, res);
  }
  if (req.method === 'GET') return handleList(req, res);
  if (req.method === 'POST') return handleCreate(req, res);

res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleList(req, res) {
  try {
    const { date, from, to, status, facility_id } = req.query;
    const clauses = [];
    const params = [];
    if (date) {
      params.push(date);
      clauses.push(`b.booking_date = $${params.length}`);
    } else if (from) {
      params.push(from);
      clauses.push(`b.booking_date >= $${params.length}`);
      if (to) {
        params.push(to);
        clauses.push(`b.booking_date <= $${params.length}`);
      }
    }
    if (status) {
      params.push(status);
      clauses.push(`b.status = $${params.length}`);
    }
    if (facility_id) {
      params.push(facility_id);
      clauses.push(`b.facility_id = $${params.length}`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = await query(
      `SELECT b.*, f.option_name, f.sport_name
      FROM bookings b
      JOIN facilities f ON f.id = b.facility_id
      ${where}
      ORDER BY b.booking_date DESC, b.start_time DESC`,
      params
      );
    return res.status(200).json({ bookings: rows.rows });
  } catch (err) {
    console.error('List bookings error:', err);
    return res.status(500).json({ error: 'Server error while fetching bookings.' });
  }
}

async function handleCreate(req, res) {
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { facility_id, customer_name, customer_email, customer_phone, booking_date, start_time, end_time, rate, payment_method, notes, status } = body;
    const missing = [];
    if (!facility_id) missing.push('facility_id');
    if (!customer_name) missing.push('customer_name');
    if (!customer_email) missing.push('customer_email');
    if (!customer_phone) missing.push('customer_phone');
    if (!booking_date) missing.push('booking_date');
    if (!start_time) missing.push('start_time');
    if (!end_time) missing.push('end_time');
    if (rate === undefined || rate === null) missing.push('rate');
    if (missing.length) {
      return res.status(400).json({ error: `Missing required field(s): ${missing.join(', ')}` });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(customer_email)) {
      return res.status(400).json({ error: 'Invalid email address.' });
    }
    const phoneDigits = String(customer_phone).replace(/\D/g, '');
    if (phoneDigits.length < 10) {
      return res.status(400).json({ error: 'Invalid phone number.' });
    }
    const numericRate = Number(rate);
    if (!Number.isFinite(numericRate) || numericRate < 0) {
      return res.status(400).json({ error: 'Rate must be a valid non-negative number.' });
    }
    const bookingRef = generateBookingRef();
    const rows = await query(
      `INSERT INTO bookings
      (booking_ref, facility_id, customer_name, customer_email, customer_phone,
      booking_date, start_time, end_time, rate, amount, payment_method, status, source, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$11,'manual',$12)
      RETURNING *`,
      [bookingRef, facility_id, customer_name, customer_email, phoneDigits, booking_date, start_time, end_time, numericRate, payment_method || 'cash', status || 'confirmed', notes || null]
      );
    return res.status(201).json({ booking: rows.rows[0] });
  } catch (err) {
    if (err && err.code === '23505') {
      return res.status(409).json({ error: 'That date and time slot is already booked for this facility.' });
    }
    console.error('Create booking error:', err);
    return res.status(500).json({ error: 'Server error while creating booking.' });
  }
}

async function handleSingle(req, res) {
  const { id } = req.query;
  if (req.method === 'GET') {
    try {
      const rows = await query('SELECT b.*, f.option_name, f.sport_name FROM bookings b JOIN facilities f ON f.id=b.facility_id WHERE b.id=$1', [id]);
      if (rows.rows.length === 0) {
        return res.status(404).json({ error: 'Booking not found.' });
      }
      return res.status(200).json({ booking: rows.rows[0] });
    } catch (err) {
      console.error('Get booking error:', err);
      return res.status(500).json({ error: 'Server error while fetching booking.' });
    }
  }

if (req.method === 'PATCH') {
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const allowed = ['status', 'customer_name', 'customer_email', 'customer_phone', 'rate', 'amount', 'notes'];
    const sets = [];
    const params = [];
    for (const key of allowed) {
      if (body[key] !== undefined) {
        params.push(body[key]);
        sets.push(`${key} = $${params.length}`);
      }
    }
    if (sets.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update.' });
    }
    params.push(id);
    const rows = await query(
      `UPDATE bookings SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length} RETURNING *`,
      params
      );
    if (rows.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found.' });
    }
    return res.status(200).json({ booking: rows.rows[0] });
  } catch (err) {
    if (err && err.code === '23505') {
      return res.status(409).json({ error: 'That date and time slot is already booked for this facility.' });
    }
    console.error('Update booking error:', err);
    return res.status(500).json({ error: 'Server error while updating booking.' });
  }
}

if (req.method === 'DELETE') {found: true
  try {
    const rows = await query(`UPDATE bookings SET status='cancelled', updated_at=now() WHERE id=$1 RETURNING *`, [id]);
    if (rows.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found.' });
    }
    return res.status(200).json({ booking: rows.rows[0] });
  } catch (err) {
    console.error('Cancel booking error:', err);
    return res.status(500).json({ error: 'Server error while cancelling booking.' });
  }
}

res.setHeader('Allow', 'GET, PATCH, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleCustomerLookup(req, res) { if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Method not allowed' }); } const ip = getClientIp(req); if (isLookupRateLimited(ip)) { return res.status(429).json({ error: 'Too many requests. Please try again later.' }); } const { email } = req.query; if (!email) { return res.status(400).json({ error: 'email query param is required.' }); } try { const rows = await query('SELECT customer_name FROM bookings WHERE lower(customer_email) = lower($1) ORDER BY booking_date DESC LIMIT 1', [email]); if (rows.rows.length === 0) { return res.status(200).json({ found: false }); } return res.status(200).json({ found: true }); } catch (err) { console.error('Customer lookup error:', err); return res.status(500).json({ error: 'Server error while looking up customer.' }); } } async function handleAvailability(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { date, facility_id, hold_token } = req.query;
  if (!date) {
    return res.status(400).json({ error: 'date query param is required (YYYY-MM-DD).' });
  }
  try {
    const params = [date];
    let facilityClause = '';
    if (facility_id) {
      params.push(facility_id);
      facilityClause = `AND facility_id = $${params.length}`;
    }
    const rows = await query(
      `SELECT facility_id, start_time, end_time, status
      FROM bookings
      WHERE booking_date = $1 AND status IN ('reserved','confirmed') ${facilityClause}`,
      params
      );
      const holdParams = [date]; let holdFacilityClause = ''; if (facility_id) { holdParams.push(facility_id); holdFacilityClause = `AND facility_id = $${holdParams.length}`; } let holdTokenClause = ''; if (hold_token) { holdParams.push(hold_token); holdTokenClause = `AND hold_token IS DISTINCT FROM $${holdParams.length}`; } const holdRows = await query(`SELECT facility_id, start_time, end_time, 'held' as status FROM slot_holds WHERE booking_date = $1 AND expires_at > now() ${holdFacilityClause} ${holdTokenClause}`, holdParams);
    return res.status(200).json({ blocked: rows.rows.concat(holdRows.rows) });
  } catch (err) {
    console.error('Availability error:', err);
    return res.status(500).json({ error: 'Server error while checking availability.' });
  }
}
async function handleHold(req, res) { if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); } try { const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); const { facility_id, booking_date, slots, hold_token } = body; if (!facility_id || !booking_date || !Array.isArray(slots) || slots.length === 0 || slots.length > 12 || !hold_token) { return res.status(400).json({ error: 'facility_id, booking_date, slots[], and hold_token are required.' }); } await query('DELETE FROM slot_holds WHERE expires_at < now()'); const expiresAt = new Date(Date.now() + 10 * 60000); for (const s of slots) { await query('INSERT INTO slot_holds (facility_id, booking_date, start_time, end_time, hold_token, expires_at) VALUES ($1,$2,$3,$4,$5,$6)', [facility_id, booking_date, s.start_time, s.end_time, hold_token, expiresAt]); } return res.status(200).json({ success: true, expires_at: expiresAt }); } catch (err) { console.error('Hold error:', err); return res.status(500).json({ error: 'Server error while creating slot hold.' }); } }

// Looks up the caller's active membership (matched on the email they typed
// into the booking form, per the Membership Terms requirement that discounts
// and complimentary slots are tied to the registered email) that covers the
// given sport, and returns its discount + complimentary-slot balance so the
// booking page can show "Use a complimentary slot (1/2 remaining)" and
// auto-apply the plan's discount to the price breakdown. Returns
// { found: false } rather than an error when there is no matching active
// membership - that is the normal case for most bookings, not a failure.
async function handleMembershipStatus(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const ip = getClientIp(req);
  if (isLookupRateLimited(ip)) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }
  const { email, sport } = req.query;
  if (!email) {
    return res.status(400).json({ error: 'email query param is required.' });
  }
  try {
    const rows = await query(
      `SELECT m.id AS membership_id, m.complimentary_slots_total, m.complimentary_slots_remaining,
              p.name AS plan_name, p.discount_type, p.discount_value, p.discount_max_amount
       FROM memberships m
       JOIN membership_plans p ON p.id = m.plan_id
       WHERE lower(m.member_email) = lower($1)
         AND m.status = 'active'
         AND m.end_date >= CURRENT_DATE
         AND (p.applicable_sports = '[]'::jsonb OR p.applicable_sports @> to_jsonb($2::text))
       ORDER BY m.created_at DESC
       LIMIT 1`,
      [email, sport || '']
    );
    if (rows.rows.length === 0) {
      return res.status(200).json({ found: false });
    }
    const m = rows.rows[0];
    return res.status(200).json({
      found: true,
      membership_id: m.membership_id,
      plan_name: m.plan_name,
      discount_type: m.discount_type,
      discount_value: Number(m.discount_value),
      discount_max_amount: m.discount_max_amount !== null ? Number(m.discount_max_amount) : null,
      complimentary_total: m.complimentary_slots_total,
      complimentary_remaining: m.complimentary_slots_remaining
    });
  } catch (err) {
    console.error('Membership status lookup error:', err);
    return res.status(500).json({ error: 'Server error while looking up membership status.' });
  }
}

// Creates a $0 booking by redeeming one complimentary slot per hour booked
// from the caller's active membership - entirely separate from the Razorpay
// flow in api/create-order.js + api/razorpay-webhook.js, since there is no
// payment to collect or verify here. The membership is re-resolved from the
// submitted email server-side (never trusted from the client) and the slot
// count is decremented with a single conditional UPDATE so two concurrent
// requests can't both redeem the same last remaining slot.
async function handleComplimentaryBooking(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { facility_id, booking_date, hours, customer_name, customer_email, customer_phone } = body;
    if (!facility_id || !booking_date || !Array.isArray(hours) || hours.length === 0 || hours.length > 12) {
      return res.status(400).json({ error: 'facility_id, booking_date and a valid hours[] array (1-12 entries) are required.' });
    }
    if (!customer_name || !customer_email || !customer_phone) {
      return res.status(400).json({ error: 'customer_name, customer_email and customer_phone are required.' });
    }
    if (body.terms_accepted !== true) {
      return res.status(400).json({ error: 'You must accept the Terms & Conditions before booking.' });
    }
    if (!hours.every(function (h) { return Number.isInteger(h) && h >= 0 && h < 26; })) {
      return res.status(400).json({ error: 'hours[] must contain valid hour numbers.' });
    }

    const facRows = await query('SELECT id, base_price, peak_price, sport_key, option_name FROM facilities WHERE option_id = $1 AND is_active = true', [facility_id]);
    if (facRows.rows.length === 0) {
      return res.status(400).json({ error: 'Unknown or unavailable facility.' });
    }
    const facility = facRows.rows[0];

    const memberRows = await query(
      `SELECT m.id, m.complimentary_slots_remaining
       FROM memberships m
       JOIN membership_plans p ON p.id = m.plan_id
       WHERE lower(m.member_email) = lower($1)
         AND m.status = 'active'
         AND m.end_date >= CURRENT_DATE
         AND (p.applicable_sports = '[]'::jsonb OR p.applicable_sports @> to_jsonb($2::text))
       ORDER BY m.created_at DESC
       LIMIT 1`,
      [customer_email, facility.sport_key]
    );
    if (memberRows.rows.length === 0) {
      return res.status(400).json({ error: 'No active membership with complimentary slots found for this email and sport.' });
    }
    const membership = memberRows.rows[0];
    const slotsNeeded = hours.length;

    // Atomic, conditional decrement: only succeeds if enough slots are still
    // remaining at the moment this runs, so a second request racing for the
    // last slot(s) fails cleanly instead of over-redeeming.
    const decrementRes = await query(
      `UPDATE memberships SET complimentary_slots_remaining = complimentary_slots_remaining - $2, updated_at = now()
       WHERE id = $1 AND complimentary_slots_remaining >= $2
       RETURNING id`,
      [membership.id, slotsNeeded]
    );
    if (decrementRes.rows.length === 0) {
      return res.status(400).json({ error: 'Not enough complimentary slots remaining for this many hours.' });
    }

    let basePriceTotal = 0;
    const sortedHours = hours.slice().sort(function (a, b) { return a - b; });
    sortedHours.forEach(function (h) {
      basePriceTotal += Number(facility.base_price);
    });
    const startTime = (sortedHours[0] % 24) + ':00';
    const endTime = ((sortedHours[sortedHours.length - 1] + 1) % 24) + ':00';
    const bookingRef = generateBookingRef();
    const phoneDigits = String(customer_phone).replace(/\D/g, '');

    let booking;
    try {
      const insertRes = await query(
        `INSERT INTO bookings
          (booking_ref, facility_id, customer_name, customer_email, customer_phone,
           booking_date, start_time, end_time, rate, amount, amount_paid, payment_method, payment_status, status, source, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,0,'complimentary','paid','confirmed','online',$10)
         RETURNING *`,
        [bookingRef, facility.id, customer_name, customer_email, phoneDigits, booking_date, startTime, endTime, basePriceTotal,
         (body.customer_notes ? body.customer_notes + ' | ' : '') + 'Redeemed via membership #' + membership.id + ' (complimentary slot)']
      );
      booking = insertRes.rows[0];
    } catch (insertErr) {
      // Roll back the slot decrement if the booking itself could not be
      // created (e.g. the slot was taken by someone else in the meantime),
      // so the member doesn't lose a complimentary slot for nothing.
      await query('UPDATE memberships SET complimentary_slots_remaining = complimentary_slots_remaining + $2, updated_at = now() WHERE id = $1', [membership.id, slotsNeeded]);
      if (insertErr && insertErr.code === '23505') {
        return res.status(409).json({ error: 'That date and time slot is already booked for this facility.' });
      }
      throw insertErr;
    }

    await query(
      'INSERT INTO membership_redemptions (membership_id, redemption_type, booking_id, notes) VALUES ($1,$2,$3,$4)',
      [membership.id, 'complimentary_slot', booking.id, slotsNeeded + ' hour(s) at ' + facility.option_name + ' on ' + booking_date]
    );

    booking.option_name = facility.option_name;
    try {
      await sendBookingConfirmationEmail(booking);
      await query('UPDATE bookings SET confirmation_sent_at = now() WHERE id = $1', [booking.id]);
    } catch (emailErr) {
      console.error('Complimentary booking confirmation email error:', emailErr);
    }

    return res.status(201).json({ booking });
  } catch (err) {
    console.error('Complimentary booking error:', err);
    return res.status(500).json({ error: 'Server error while creating complimentary booking.' });
  }
}

async function handleSendConfirmation(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { booking_id } = body;
    if (!booking_id) {
      return res.status(400).json({ error: 'booking_id is required.' });
    }
    const rows = await query('SELECT b.*, f.option_name, f.sport_name FROM bookings b JOIN facilities f ON f.id=b.facility_id WHERE b.id=$1', [booking_id]);
    const booking = rows.rows[0];
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found.' });
    }
    await sendBookingConfirmationEmail(booking);
    await query('UPDATE bookings SET confirmation_sent_at = now() WHERE id = $1', [booking_id]);
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Send confirmation error:', err);
    return res.status(500).json({ error: 'Failed to send confirmation email. Check SMTP configuration.' });
  }
}

async function handleCancelBooking(req, res, user) {
    if (req.method !== 'POST') {
          res.setHeader('Allow', 'POST');
          return res.status(405).json({ error: 'Method not allowed' });
    }
    try {
          const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
          const { id, reason, notes } = body;
          if (!id) {
                  return res.status(400).json({ error: 'Booking id is required.' });
          }
          if (reason !== 'user_requested' && reason !== 'playbox_cancellation') {
                  return res.status(400).json({ error: 'A valid cancellation reason is required.' });
          }
          const rows = await query('SELECT b.*, f.option_name, f.sport_name FROM bookings b JOIN facilities f ON f.id=b.facility_id WHERE b.id = $1', [id]);
          const booking = rows.rows[0];
          if (!booking) {
                  return res.status(404).json({ error: 'Booking not found.' });
          }
          if (booking.status === 'cancelled') {
                  return res.status(400).json({ error: 'This booking is already cancelled.' });
          }

          const settingsRows = await query("SELECT key, value FROM settings WHERE key = 'convenience_fee'");
          let convenienceFee = 0;
          settingsRows.rows.forEach(function (row) {
                  if (row.key === 'convenience_fee') {
                            const fee = parseFloat(row.value);
                            if (!isNaN(fee)) convenienceFee = fee;
                  }
          });

          const isOnline = booking.payment_method === 'razorpay';
          const paidAmount = parseFloat(booking.amount_paid || 0);
          const refundableBase = Math.max(0, paidAmount - convenienceFee);

          let refundAmount = 0;
          let refundNote = '';

          if (!isOnline) {
                  refundAmount = 0;
                  refundNote = 'This booking was paid in cash/offline, so no automatic refund applies. Please contact us directly if a refund is due.';
          } else if (reason === 'playbox_cancellation') {
                  refundAmount = refundableBase;
                  refundNote = 'As this booking was cancelled by PlayBox Kashmir, the full amount paid (excluding the non-refundable convenience fee) will be refunded.';
          } else {
                  const hoursUntilSlot = computeHoursUntilSlot(booking.booking_date, booking.start_time);
                  if (hoursUntilSlot >= 24) {
                            refundAmount = refundableBase;
                            refundNote = 'Cancelled more than 24 hours before the scheduled slot: 100% of the amount paid (excluding the non-refundable convenience fee) is refunded, as per our Cancellation & Refund Policy.';
                  } else if (hoursUntilSlot >= 12) {
                            refundAmount = refundableBase * 0.5;
                            refundNote = 'Cancelled between 12-24 hours before the scheduled slot: 50% of the amount paid (excluding the non-refundable convenience fee) is refunded, as per our Cancellation & Refund Policy.';
                  } else {
                            refundAmount = 0;
                            refundNote = 'Cancelled less than 12 hours before the scheduled slot: as per our Cancellation & Refund Policy, no refund applies.';
                  }
          }

          refundAmount = Math.round(refundAmount * 100) / 100;

          const updateRows = await query(
                  `UPDATE bookings SET status='cancelled', cancellation_reason=$1, cancellation_notes=$2, refund_amount=$3, cancelled_at=now(), cancelled_by=$4, updated_at=now() WHERE id=$5 RETURNING *`,
                  [reason, notes || null, refundAmount, (user && user.username) || 'admin', id]
                );
          const updated = Object.assign({}, updateRows.rows[0], { option_name: booking.option_name, sport_name: booking.sport_name });

          let emailSent = false;
          let emailError = null;
          try {
                  await sendBookingCancellationEmail(updated, { reason: reason, notes: notes, refundAmount: refundAmount, refundNote: refundNote });
                  emailSent = true;
                  await query('UPDATE bookings SET cancellation_email_sent_at = now() WHERE id = $1', [id]);
          } catch (err) {
                  console.error('Cancellation email error:', err);
                  emailError = err.message;
          }

          return res.status(200).json({ booking: updated, refund_amount: refundAmount, email_sent: emailSent, email_error: emailError });
    } catch (err) {
          console.error('Cancel booking error:', err);
          return res.status(500).json({ error: 'Server error while cancelling booking.' });
    }
}

// Computes hours remaining until a booking's scheduled start, treating the
// stored date/time as IST (UTC+5:30) wall-clock values (India has no DST).
function computeHoursUntilSlot(bookingDate, startTime) {
    const dateStr = String(bookingDate).slice(0, 10);
    const timeStr = String(startTime).slice(0, 5);
    const parts = dateStr.split('-').map(Number);
    const timeParts = timeStr.split(':').map(Number);
    const istMillis = Date.UTC(parts[0], parts[1] - 1, parts[2], timeParts[0], timeParts[1]) - (5.5 * 60 * 60 * 1000);
    return (istMillis - Date.now()) / (1000 * 60 * 60);
}

