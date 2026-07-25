// Vercel Serverless Function: accepts booking submissions coming from the
// internal team Google Form (via an Apps Script trigger on the response
// Sheet) and creates a booking exactly the way the admin dashboard's
// "Add Booking" flow does. Has no admin session, so it is protected by a
// shared secret header instead (FORM_SUBMIT_SECRET env var).
import { query } from '../lib/db.js';
import { sendBookingConfirmationEmail, sendBookingFailedEmail } from '../lib/email.js';

const SPORT_TO_FACILITY = {
    'Football Turf (6 & 7-a-side)': { sportKey: 'football', optionName: 'Main Turf' },
    'Box Cricket': { sportKey: 'boxcricket', optionName: 'Main Turf' },
};

const PAYMENT_METHOD_MAP = {
    'Cash': 'cash',
    'UPI': 'upi',
    'Card': 'card',
    'Free (Complimentary)': 'free',
};

const ALL_SLOTS_24H = [
    ['05:00', '06:00'], ['06:00', '07:00'], ['07:00', '08:00'], ['08:00', '09:00'],
    ['09:00', '10:00'], ['10:00', '11:00'], ['11:00', '12:00'], ['12:00', '13:00'],
    ['13:00', '14:00'], ['14:00', '15:00'], ['15:00', '16:00'], ['16:00', '17:00'],
    ['17:00', '18:00'], ['18:00', '19:00'], ['19:00', '20:00'], ['20:00', '21:00'],
    ['21:00', '22:00'], ['22:00', '23:00'], ['23:00', '00:00'], ['00:00', '01:00'],
    ['01:00', '02:00'],
  ];

function to24Hour(h, mm, ap) {
    let hour = parseInt(h, 10);
    const ampm = ap.toUpperCase();
    if (ampm === 'AM') {
          if (hour === 12) hour = 0;
    } else if (hour !== 12) {
          hour += 12;
    }
    return String(hour).padStart(2, '0') + ':' + mm;
}

function to12HourLabel(startHHMM, endHHMM) {
    const fmt = (hhmm) => {
          const parts = hhmm.split(':');
          let h = parseInt(parts[0], 10);
          const mm = parts[1];
          const ampm = h >= 12 ? 'PM' : 'AM';
          let h12 = h % 12;
          if (h12 === 0) h12 = 12;
          return h12 + ':' + mm + ' ' + ampm;
    };
    return fmt(startHHMM) + ' - ' + fmt(endHHMM);
}

function parseTimeSlot(label) {
    const m = String(label || '').match(/(\d{1,2}):(\d{2})\s*(AM|PM)\s*-\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!m) return null;
    return [to24Hour(m[1], m[2], m[3]), to24Hour(m[4], m[5], m[6])];
}

function generateBookingRef() {
    const ts = Date.now().toString(36).toUpperCase();
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    return 'PBK-' + ts + '-' + rand;
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
          res.setHeader('Allow', 'POST');
          return res.status(405).json({ error: 'Method not allowed' });
    }

  const providedSecret = req.headers['x-form-secret'];
    const expectedSecret = process.env.FORM_SUBMIT_SECRET;
    if (!expectedSecret || providedSecret !== expectedSecret) {
          return res.status(401).json({ error: 'Unauthorized' });
    }

  try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
        const {
                customer_name,
                customer_phone,
                customer_email,
                sport,
                booking_date,
                time_slot,
                rate,
                payment_method,
                notes,
                submitted_by_email,
        } = body;

      const missing = [];
        if (!customer_name) missing.push('customer_name');
        if (!customer_phone) missing.push('customer_phone');
        if (!customer_email) missing.push('customer_email');
        if (!sport) missing.push('sport');
        if (!booking_date) missing.push('booking_date');
        if (!time_slot) missing.push('time_slot');
        if (rate === undefined || rate === null || rate === '') missing.push('rate');
        if (missing.length) {
                return res.status(400).json({ error: 'Missing required field(s): ' + missing.join(', ') });
        }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(customer_email)) {
                return res.status(400).json({ error: 'Invalid email address.' });
        }

      const phoneDigits = String(customer_phone).replace(/\D/g, '');
        if (phoneDigits.length < 10) {
                return res.status(400).json({ error: 'Invalid phone number.' });
        }

      const sportInfo = SPORT_TO_FACILITY[sport];
        if (!sportInfo) {
                return res.status(400).json({ error: 'Unrecognized sport: ' + sport });
        }

      const facRows = await query(
              'SELECT id FROM facilities WHERE sport_key = $1 AND option_name = $2 AND is_active = true LIMIT 1',
              [sportInfo.sportKey, sportInfo.optionName]
            );
        if (!facRows.rows.length) {
                return res.status(400).json({ error: 'Facility not found for selected sport.' });
        }
        const facilityId = facRows.rows[0].id;

      const times = parseTimeSlot(time_slot);
        if (!times) {
                return res.status(400).json({ error: 'Could not parse time slot: ' + time_slot });
        }
        const [startTime, endTime] = times;

      const numericRate = Number(rate);
        if (!Number.isFinite(numericRate) || numericRate < 0) {
                return res.status(400).json({ error: 'Rate must be a valid non-negative number.' });
        }

      const dbPaymentMethod = PAYMENT_METHOD_MAP[payment_method] || 'cash';
        const bookingRef = generateBookingRef();

      try {
              const insertRows = await query(
                        'INSERT INTO bookings ' +
                          '(booking_ref, facility_id, customer_name, customer_email, customer_phone, ' +
                          'booking_date, start_time, end_time, rate, amount, payment_method, status, source, notes) ' +
                          "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,'confirmed','manual',$11) " +
                          'RETURNING *',
                        [
                                    bookingRef,
                                    facilityId,
                                    customer_name,
                                    customer_email,
                                    phoneDigits,
                                    booking_date,
                                    startTime,
                                    endTime,
                                    numericRate,
                                    dbPaymentMethod,
                                    notes || 'Submitted via team Google Form',
                                  ]
                      );
              const booking = insertRows.rows[0];

          const facilityDetails = await query(
                    'SELECT option_name, sport_name FROM facilities WHERE id = $1',
                    [facilityId]
                  );
              if (facilityDetails.rows[0]) {
                        booking.option_name = facilityDetails.rows[0].option_name;
                        booking.sport_name = facilityDetails.rows[0].sport_name;
              }

          try {
                    await sendBookingConfirmationEmail(booking);
                    await query('UPDATE bookings SET confirmation_sent_at = now() WHERE id = $1', [booking.id]);
          } catch (emailErr) {
                    console.error('Form booking confirmation email error:', emailErr);
          }

          return res.status(201).json({ booking });
      } catch (err) {
              if (err && err.code === '23505') {
                        let suggestions = [];
                        try {
                                    const blockedRows = await query(
                                                  "SELECT start_time FROM bookings WHERE facility_id = $1 AND booking_date = $2 AND status IN ('reserved','confirmed')",
                                                  [facilityId, booking_date]
                                                );
                                    const blockedSet = new Set(blockedRows.rows.map((r) => r.start_time));
                                    suggestions = ALL_SLOTS_24H
                                      .filter(([s]) => !blockedSet.has(s) && s !== startTime)
                                      .slice(0, 5)
                                      .map(([s, e]) => to12HourLabel(s, e));
                        } catch (lookupErr) {
                                    console.error('Alternative slot lookup error:', lookupErr);
                        }

                try {
                            await sendBookingFailedEmail({
                                          customer_name,
                                          customer_email,
                                          sport,
                                          booking_date,
                                          time_slot,
                                          suggestions,
                                    submitted_by_email,
                            });
                } catch (emailErr) {
                            console.error('Booking failed email error:', emailErr);
                }

                return res.status(409).json({
                            error: 'That date and time slot is already booked for this facility.',
                            suggestions,
                });
              }
              throw err;
      }
  } catch (err) {
        console.error('Form booking error:', err);
        return res.status(500).json({ error: 'Server error while creating booking from form.' });
  }
}
