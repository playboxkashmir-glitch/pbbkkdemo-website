// Vercel Serverless Function: Razorpay Webhook handler
// Verifies the X-Razorpay-Signature header using RAZORPAY_WEBHOOK_SECRET,
// then acknowledges events like payment.captured, payment.failed, order.paid.
// IMPORTANT: Signature verification requires the EXACT raw request body bytes,
// so automatic JSON body-parsing is disabled below and we read the raw stream.
import { sendTournamentConfirmationEmail } from '../lib/email.js';
import { seedTournamentIfFull } from '../lib/tournament.js';
import crypto from 'crypto';
import { query } from '../lib/db.js';
import { sendBookingConfirmationEmail } from '../lib/email.js';

export const config = {
  api: {
    bodyParser: false,
  },
};

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return res.status(500).json({ error: 'Webhook secret is not configured.' });
  }

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (err) {
    return res.status(400).json({ error: 'Could not read request body.' });
  }

  const signature = req.headers['x-razorpay-signature'];
  if (!signature) {
    return res.status(400).json({ error: 'Missing signature header.' });
  }

  const expected = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  const verified = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!verified) {
    return res.status(400).json({ error: 'Invalid webhook signature.' });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch (err) {
    return res.status(400).json({ error: 'Invalid JSON payload.' });
  }

  const eventType = event && event.event;

  // Log the verified event for now (visible in Vercel's function logs).
  // There is no database configured yet, so we cannot persist booking status here.
  // See project notes: consider adding storage if you want webhook events
  // to automatically update booking records.
  console.log('Verified Razorpay webhook event:', eventType);

  if (eventType === 'payment.captured') {
    await handlePaymentCaptured(event);
  } else {
    console.log('Unhandled Razorpay webhook event type:', eventType);
  }

  return res.status(200).json({ received: true });
}

async function handlePaymentCaptured(event) {
  try {
    const payment = event && event.payload && event.payload.payment && event.payload.payment.entity;
    if (!payment) {
      console.error('payment.captured event missing payment entity.');
      return;
    }
    const notes = payment.notes || {};
    if (notes.type === 'tournament') {
      return handleTournamentPaymentCaptured(payment);
    }
    const bookingRef = notes.booking_id;
    if (!bookingRef) {
      console.error('payment.captured event missing booking_id in notes.');
      return;
    }

    const existing = await query('SELECT id FROM bookings WHERE booking_ref = $1', [bookingRef]);
    if (existing.rows.length) {
      console.log('Booking already recorded for', bookingRef);
      return;
    }

    const facilityLookup = await query('SELECT id, option_name FROM facilities WHERE option_id = $1', [notes.facility_id]);
    if (facilityLookup.rows.length === 0) {
      console.error('No facility found for option_id', notes.facility_id);
      return;
    }
    const facility = facilityLookup.rows[0];

    // Reserve/partial-payment bookings: Razorpay only ever captures whatever
    // amount was actually charged (the reserve amount, if this was a reserve
    // booking). We still store the FULL booking value in `amount`, and track
    // what has actually been collected so far in `amount_paid` + `payment_status`.
    const capturedAmount = payment.amount ? payment.amount / 100 : Number(notes.amount) || 0;
    const isReserve = notes.is_reserve === true || notes.is_reserve === 'true';
    const fullAmount = Number(notes.full_amount) || capturedAmount;
    const amountPaid = capturedAmount;
    const paymentStatus = isReserve ? 'partial' : 'paid';
    const rate = Number(notes.rate) || fullAmount;
    const termsAccepted = (notes.terms_accepted === true || notes.terms_accepted === 'true');
    const termsVersion = notes.terms_version || null;

    const insertResult = await query(
      `INSERT INTO bookings
      (booking_ref, facility_id, customer_name, customer_email, customer_phone,
      booking_date, start_time, end_time, rate, amount, payment_method, status, source, notes, terms_accepted_at, terms_version, payment_status, amount_paid)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, CASE WHEN $15 THEN now() ELSE NULL END, $16, $17, $18)
      RETURNING *`,
      [
        bookingRef,
        facility.id,
        notes.customer_name || '',
        notes.customer_email || '',
        notes.customer_phone || '',
        notes.booking_date,
        notes.start_time,
        notes.end_time,
        rate,
        fullAmount,
        'razorpay',
        'confirmed',
        'online',
        (notes.customer_notes ? notes.customer_notes + ' | ' : '') + 'Razorpay payment_id: ' + payment.id, termsAccepted, termsVersion, paymentStatus, amountPaid
      ]
    );

    const booking = insertResult.rows[0];
    booking.option_name = facility.option_name;

    await sendBookingConfirmationEmail(booking);
  
    await query('UPDATE bookings SET confirmation_sent_at = now() WHERE id = $1', [booking.id]);
  } catch (err) {
    console.error('handlePaymentCaptured error:', err);
  }
}


// Handles a captured payment for a TOURNAMENT entry fee (as opposed to a
// slot booking, handled by handlePaymentCaptured above). Marks the team
// as paid, sends the tournament-specific confirmation email (separate
// from the slot-booking confirmation email), and checks whether the
// tournament has now filled up so it can be randomly seeded.
async function handleTournamentPaymentCaptured(payment) {
  try {
    const notes = payment.notes || {};
    const teamId = notes.team_id;
    if (!teamId) {
      console.error('Tournament payment.captured event missing team_id in notes.');
      return;
    }

  const teamRes = await query('SELECT * FROM tournament_teams WHERE id = $1', [teamId]);
    const team = teamRes.rows[0];
    if (!team) {
      console.error('No tournament team found for id', teamId);
      return;
    }
    if (team.payment_status === 'paid') {
      console.log('Tournament team already recorded as paid:', teamId);
      return;
    }

  const amountPaid = payment.amount ? payment.amount / 100 : Number(notes.amount) || 0;

  const updateRes = await query(
    "UPDATE tournament_teams SET payment_status = 'paid', amount_paid = $1, razorpay_payment_id = $2 WHERE id = $3 RETURNING *",
    [amountPaid, payment.id, teamId]
    );
    const updatedTeam = updateRes.rows[0];

  const tRes = await query('SELECT * FROM tournaments WHERE id = $1', [team.tournament_id]);
    const tournament = tRes.rows[0];

  await sendTournamentConfirmationEmail(updatedTeam, tournament);
    await seedTournamentIfFull(team.tournament_id);
  } catch (err) {
    console.error('handleTournamentPaymentCaptured error:', err);
  }
}
