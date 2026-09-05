// Assembles and sends the daily "Today's Booking Sheet" report email.
// Triggered once a day by the Vercel Cron Job configured in vercel.json,
// which calls GET /api/reports/summary?resource=daily-report (see that
// file for the entry point + the shared-secret check that protects it).
//
// Behaviour, per the admin's request:
// - Does nothing (and sends no email) until the very first booking has
//   ever been made on the site. Once that has happened, it runs every
//   single day from then on, whether or not that particular day has any
//   bookings yet, for as long as the cron job stays enabled.
// - Builds a one-page, print-friendly PDF (lib/pdf.js) listing the day's
//   bookings, any tournament matches/tournaments scheduled that day, and
//   the remaining open slots per facility (with blank ruled lines so
//   staff can pen in walk-in bookings), then emails it via Brevo's SMTP
//   relay (the same relay already used for booking confirmation emails)
//   from contact@playboxkashmir.com to playboxkashmir@gmail.com.

import { query } from './db.js';
import { buildDailyReportPdf } from './pdf.js';
import { sendDailyReportEmail } from './email.js';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DEFAULT_OPENING_HOUR = 5;
const DEFAULT_CLOSING_HOUR = 26; // 2 AM next day, matching the public booking page's default
const REPORT_RECIPIENT = 'playboxkashmir@gmail.com';

function istNow() {
  return new Date(Date.now() + IST_OFFSET_MS);
}

// IST "today" as YYYY-MM-DD, computed from the UTC clock + fixed offset
// (India has no DST) so this is correct regardless of the server's TZ.
function istDateKey(d) {
  return d.toISOString().slice(0, 10);
}

function formatTime12(hour) {
  const h = ((hour % 24) + 24) % 24;
  if (h === 0) return '12 AM';
  if (h === 12) return '12 PM';
  if (h < 12) return `${h} AM`;
  return `${h - 12} PM`;
}

// Formats a [startHour, endHour) range (endHour may be >= 24 to represent
// wrapping past midnight) the same way the public booking page shows
// slots, collapsing to a single AM/PM suffix when both ends share one.
function formatRange(startHour, endHour) {
  const s = formatTime12(startHour);
  const e = formatTime12(endHour);
  const [sNum, sMer] = s.split(' ');
  const [eNum, eMer] = e.split(' ');
  if (sMer === eMer) return `${sNum}-${eNum} ${sMer}`;
  return `${s}-${e}`;
}

function parseHour(timeStr) {
  return parseInt(String(timeStr).split(':')[0], 10) || 0;
}

// Same wrap-aware "is this hour inside this booked block" check used by
// the public availability endpoint (api/bookings/index.js handleAvailability
// + assets/js/booking.js isHourBlocked), reimplemented here since this
// runs server-side with no access to the front-end bundle.
function isHourBlocked(hourRaw, block) {
  const s = parseHour(block.start_time);
  const e = parseHour(block.end_time);
  const h = ((hourRaw % 24) + 24) % 24;
  if (e > s) return h >= s && h < e;
  return h >= s || h < e;
}

// Returns one label per open hour (not merged into ranges) - e.g.
// ["5-6 AM", "6-7 AM", "9-10 PM"] - so each open slot gets its own
// writable line on the report (see buildDailyReportPdf's single big
// walk-in box).
function computeOpenHourSlots(openingHour, closingHour, blocks) {
  const labels = [];
  for (let hour = openingHour; hour < closingHour; hour++) {
    const blocked = blocks.some((b) => isHourBlocked(hour, b));
    if (!blocked) labels.push(formatRange(hour, hour + 1));
  }
  return labels;
}

function formatPaymentLabel(booking) {
  if (booking.payment_status === 'partial') {
    const paid = Number(booking.amount_paid || 0);
    const due = Math.max(0, Number(booking.amount || 0) - paid);
    return `Partial (Rs ${due.toFixed(0)} due)`;
  }
  return 'Full';
}

function formatDateLabel(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

function formatSubjectDate(dateKey) {
  const [y, m, d] = dateKey.split('-');
  return `${d}-${m}-${y.slice(2)}`;
}

// Returns { skipped: true, reason } if nothing was sent, or
// { skipped: false, reportDate, recipients, bookingCount } on success.
// Throws on unexpected errors (DB/PDF/email failures) so the caller can
// log + surface a 500.
export async function runDailyReport() {
  const everBooked = await query('SELECT EXISTS(SELECT 1 FROM bookings) AS exists');
  if (!everBooked.rows[0].exists) {
    return { skipped: true, reason: 'No booking has ever been made yet; daily report has not started.' };
  }

  const now = istNow();
  const reportDate = istDateKey(now);

  const settingsRows = await query('SELECT key, value FROM settings');
  const settings = {};
  settingsRows.rows.forEach((r) => { settings[r.key] = r.value; });
  const openingHour = Number.isFinite(Number(settings.opening_hour)) ? Number(settings.opening_hour) : DEFAULT_OPENING_HOUR;
  const closingHour = Number.isFinite(Number(settings.closing_hour)) ? Number(settings.closing_hour) : DEFAULT_CLOSING_HOUR;
  const businessName = settings.business_name || 'PlayBox Kashmir';

  const facilitiesRes = await query('SELECT * FROM facilities WHERE is_active = true ORDER BY id');
  const facilities = facilitiesRes.rows;

  const bookingsRes = await query(
    `SELECT b.*, f.option_name, f.sport_name
     FROM bookings b JOIN facilities f ON f.id = b.facility_id
     WHERE b.booking_date = $1 AND b.status IN ('reserved','confirmed')
     ORDER BY f.id, b.start_time`,
    [reportDate]
  );

  const matchesRes = await query(
    `SELECT m.round_name, t.name AS tournament_name,
            t1.team_name AS team1_name, t2.team_name AS team2_name
     FROM tournament_matches m
     JOIN tournaments t ON t.id = m.tournament_id
     LEFT JOIN tournament_teams t1 ON t1.id = m.team1_id
     LEFT JOIN tournament_teams t2 ON t2.id = m.team2_id
     WHERE m.match_date = $1
     ORDER BY m.round ASC, m.match_index ASC`,
    [reportDate]
  );

  const startingTodayRes = await query(
    `SELECT name, format, num_teams FROM tournaments
     WHERE start_date = $1 AND status <> 'cancelled'`,
    [reportDate]
  );

  const bookings = bookingsRes.rows.map((b) => ({
    time_label: formatRange(parseHour(b.start_time), (() => {
      const sH = parseHour(b.start_time);
      const eH = parseHour(b.end_time);
      return eH <= sH ? eH + 24 : eH;
    })()),
    customer_name: b.customer_name,
    customer_phone: b.customer_phone,
    facility_label: b.option_name,
    payment_label: formatPaymentLabel(b)
  }));

  const events = [
    ...startingTodayRes.rows.map((t) => `${t.name} kicks off today (${t.format}, ${t.num_teams} teams)`),
    ...matchesRes.rows.map((m) => `${m.tournament_name} — ${m.round_name}: ${m.team1_name || 'TBD'} vs ${m.team2_name || 'TBD'}`)
  ];

  // Only Main Turf is actually operational right now (the cricket nets
  // and pickleball courts exist in the facilities table for future use
  // but aren't live yet), so the open-slots section only covers that one
  // facility rather than a grid of every facility row.
  const turfFacility = facilities.find((f) => f.option_id === 'turf1') || facilities[0];
  let turfOpenSlots = { facilityLabel: 'Main Turf', hourLabels: [] };
  if (turfFacility) {
    const blocks = bookingsRes.rows
      .filter((b) => b.facility_id === turfFacility.id)
      .map((b) => ({ start_time: b.start_time, end_time: b.end_time }));
    turfOpenSlots = {
      facilityLabel: turfFacility.option_name,
      hourLabels: computeOpenHourSlots(openingHour, closingHour, blocks)
    };
  }

  const pdfBuffer = await buildDailyReportPdf({
    reportDateLabel: formatDateLabel(reportDate),
    generatedAtLabel: `Generated at ${now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} IST`,
    businessName,
    bookings,
    events,
    turfOpenSlots
  });

  const subject = `Today's Booking ${formatSubjectDate(reportDate)}`;
  await sendDailyReportEmail({
    to: REPORT_RECIPIENT,
    subject,
    pdfBuffer,
    pdfFilename: `todays-booking-${reportDate}.pdf`
  });

  return { skipped: false, reportDate, recipients: [REPORT_RECIPIENT], bookingCount: bookings.length };
}
