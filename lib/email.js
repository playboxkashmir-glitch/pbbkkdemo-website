// Sends booking confirmation emails via SMTP (nodemailer).
// Requires SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS (and optionally SMTP_FROM)
// to be set in your environment. Works with any SMTP provider (Gmail, SendGrid,
// Mailgun, Zoho, Amazon SES SMTP, etc.) - just supply your own credentials.

import nodemailer from 'nodemailer';

let transporter;

function getTransporter() {
  if (!transporter) {
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
    if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
      throw new Error('SMTP environment variables are not fully configured.');
    }
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT),
      secure: Number(SMTP_PORT) === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS }
    });
  }
  return transporter;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

const SITE_URL = 'https://playboxkashmir.com';
const LOGO_URL = SITE_URL + '/assets/images/logo.png';
const FAVICON_URL = SITE_URL + '/assets/images/logo.png';
const BOOK_URL = SITE_URL + '/book.html';
const CANCELLATION_URL = SITE_URL + '/cancellation.html';
const SUPPORT_EMAIL = 'contact@playboxkashmir.com';

function formatDateNice(dateVal) { var d = (dateVal instanceof Date) ? dateVal : new Date(dateVal); if (isNaN(d.getTime())) { return String(dateVal); } return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }); } function formatTime12(t) { if (!t) return ''; var parts = String(t).split(':'); var h = parseInt(parts[0], 10); var m = parts[1] || '00'; var ampm = h >= 12 ? 'PM' : 'AM'; var h12 = h % 12; if (h12 === 0) { h12 = 12; } return h12 + ':' + m + ' ' + ampm; } function computeDurationHours(start, end) { var s = parseInt(String(start).split(':')[0], 10); var e = parseInt(String(end).split(':')[0], 10); var diff = e - s; if (diff <= 0) { diff += 24; } return diff; } function detailBlock(label, value) {
  return (
    '<div style="margin-bottom:18px;">' +
      '<div style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#6b7280;margin-bottom:3px;">' + label + '</div>' +
      '<div style="font-size:15px;color:#111827;font-weight:600;">' + value + '</div>' +
    '</div>'
  );
}

export async function sendBookingConfirmationEmail(booking) {
  const fromAddress = process.env.SMTP_FROM || process.env.SMTP_USER;
  const t = getTransporter();

  const subject = (booking.payment_status === 'partial' ? 'Slot Reserved (Pending Full Payment) - ' : 'Booking Confirmed - ') + booking.booking_ref + ' | PlayBox Kashmir';

  const customerName = escapeHtml(booking.customer_name || 'there');
  const firstName = customerName.split(' ')[0];

  const leftColumn = [
    detailBlock('Booking ID', escapeHtml(booking.booking_ref)),
    detailBlock('Customer Name', customerName),
    detailBlock('Facility', escapeHtml(booking.option_name || '')),
    detailBlock('Date', formatDateNice(booking.booking_date)),
    detailBlock('Time', formatTime12(booking.start_time) + ' - ' + formatTime12(booking.end_time)),
    detailBlock('Duration', (function () { var h = computeDurationHours(booking.start_time, booking.end_time); return h + (h > 1 ? ' Hours' : ' Hour'); })())
  ].join('');

  const isPartial = booking.payment_status === 'partial';
  const paidBadge = isPartial
    ? '<span style="display:inline-block;background:#FEF3C7;color:#92400e;font-size:13px;font-weight:700;padding:5px 14px;border-radius:999px;">Partially Paid</span>'
    : '<span style="display:inline-block;background:#DCFCE7;color:#15803d;font-size:13px;font-weight:700;padding:5px 14px;border-radius:999px;">Paid &#10003;</span>';

  const amountPaidDisplay = isPartial ? booking.amount_paid : booking.amount;
  const rightColumn = [
    detailBlock('Amount Paid', '&#8377;' + escapeHtml(amountPaidDisplay)),
    detailBlock('Payment Status', paidBadge),
    isPartial ? detailBlock('Balance Due', '&#8377;' + escapeHtml((Number(booking.amount) - Number(booking.amount_paid)).toFixed(2))) : ''
  ].join('');

  const html = [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="UTF-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    '<title>Booking Confirmed - PlayBox Kashmir™</title>',
    '<style>',
    "  body, table, td { font-family: 'Segoe UI', Arial, Helvetica, sans-serif; }",
    '  @media only screen and (max-width: 480px) {',
    '    .pk-container { width: 100% !important; }',
    '    .pk-col { display: block !important; width: 100% !important; padding-right: 0 !important; }',
    '    .pk-body-pad { padding-left: 22px !important; padding-right: 22px !important; }',
    '  }',
    '</style>',
    '</head>',
    '<body style="margin:0;padding:0;background-color:#f3f4f6;">',
    '  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;padding:32px 12px;">',
    '    <tr>',
    '      <td align="center">',
    '        <table role="presentation" class="pk-container" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(15,118,110,0.12);">',

    '          <tr>',
    '            <td align="center" style="background-color:#0F766E;padding:36px 24px 30px;">',
    '              <img src="' + LOGO_URL + '" alt="PlayBox Kashmir™" width="64" height="64" style="display:block;margin:0 auto 14px;border-radius:14px;" />',
    '            <div style="font-size:22px;line-height:1.3;font-weight:700;color:#ffffff;">' + (isPartial ? 'Your Slot is Reserved! &#9203;' : 'Your Booking is Confirmed! &#127881;') + '</div>',
    '            </td>',
    '          </tr>',

    '          <tr>',
    '            <td class="pk-body-pad" style="padding:32px 40px 8px;">',
    '              <p style="margin:0 0 6px;font-size:16px;color:#111827;">Hey ' + firstName + ',</p>',
    '            <p style="margin:0;font-size:14px;line-height:1.6;color:#4b5563;">' + (isPartial ? 'Your slot at <strong>PlayBox Kashmir™</strong> has been reserved, pending full payment. Here are your booking details:' : 'Great news! Your slot at <strong>PlayBox Kashmir™</strong> is booked and confirmed. Here are your booking details:') + '</p>',
    '            </td>',
    '          </tr>',

    '          <tr>',
    '            <td class="pk-body-pad" style="padding:20px 40px 4px;">',
    '              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">',
    '                <tr>',
    '                  <td class="pk-col" valign="top" width="50%" style="padding-right:16px;">' + leftColumn + '</td>',
    '                  <td class="pk-col" valign="top" width="50%">' + rightColumn + '</td>',
    '                </tr>',
    '              </table>',
    '            </td>',
    '          </tr>',

    '          <tr>',
    '            <td class="pk-body-pad" style="padding:12px 40px 0;">',
    '              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F0FDFA;border-left:4px solid #0F766E;border-radius:8px;">',
    '                <tr>',
    '                  <td style="padding:18px 20px;">',
    '                    <div style="font-size:14px;font-weight:700;color:#0F766E;margin-bottom:10px;">Important Information</div>',
    '                    <ul style="margin:0;padding-left:18px;color:#374151;font-size:13.5px;line-height:1.9;">',
    '                      <li>Please arrive 10 minutes before your slot.</li>',
    '                      <li>Wear appropriate sports footwear.</li>',
    '                      <li>Follow staff instructions.</li>',
    '                      <li>No smoking or alcohol on the premises.</li>',
    '                    </ul>',
    '                  </td>',
    '                </tr>',
    '              </table>',
    '            </td>',
    '          </tr>',

    '          <tr>',
    '            <td align="center" style="padding:32px 40px 8px;">',
    '              <table role="presentation" cellpadding="0" cellspacing="0">',
    '                <tr>',
    '                  <td align="center" style="border-radius:8px;background-color:#0F766E;">',
    '                    <a href="' + BOOK_URL + '" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px;">Book another slot</a>',
    '                  </td>',
    '                </tr>',
    '              </table>',
    '            </td>',
    '          </tr>',

    '          <tr>',
    '            <td class="pk-body-pad" style="padding:20px 40px 0;">',
    '              <p style="margin:0;font-size:12.5px;line-height:1.7;color:#6b7280;text-align:center;">',
    '                Need to make changes? Read our <a href="' + CANCELLATION_URL + '" style="color:#0F766E;font-weight:600;text-decoration:none;">cancellation policy</a>.',
    '                For any help with cancellations, email us at <a href="mailto:' + SUPPORT_EMAIL + '" style="color:#0F766E;font-weight:600;text-decoration:none;">' + SUPPORT_EMAIL + '</a>.',
    '              </p>',
    '            </td>',
    '          </tr>',

    '          <tr>',
    '            <td style="padding:28px 40px 0;">',
    '              <hr style="border:none;border-top:1px solid #e5e7eb;margin:0;" />',
    '            </td>',
    '          </tr>',

    '          <tr>',
    '            <td align="center" style="padding:24px 40px 12px;">',
    '              <p style="margin:0 0 4px;font-size:12.5px;color:#6b7280;">&#128231; <a href="mailto:' + SUPPORT_EMAIL + '" style="color:#6b7280;text-decoration:none;">' + SUPPORT_EMAIL + '</a></p>',
    '              <p style="margin:0 0 4px;font-size:12.5px;color:#6b7280;">&#127760; <a href="' + SITE_URL + '" style="color:#6b7280;text-decoration:none;">www.playboxkashmir.com</a></p>',
    '              <p style="margin:0;font-size:12.5px;color:#6b7280;">&#128205; PlayBox Kashmir™</p>',
    '            </td>',
    '          </tr>',

    '          <tr>',
    '            <td align="center" style="padding:8px 40px 36px;">',
    '              <img src="' + FAVICON_URL + '" alt="PlayBox Kashmir™" width="36" height="36" style="display:block;margin:0 auto 8px;border-radius:8px;" />',
    '              <p style="margin:0;font-size:13px;color:#111827;font-weight:600;">Warm regards,</p>',
    '              <p style="margin:2px 0 0;font-size:13px;color:#6b7280;">The PlayBox Kashmir™ Team</p>',
    '            </td>',
    '          </tr>',

    '        </table>',
    '      </td>',
    '    </tr>',
    '  </table>',
    '</body>',
    '</html>'
  ].join('\n');

  await t.sendMail({
    from: fromAddress,
    to: booking.customer_email,
    subject,
    html
  });
}


// Sends a "booking failed" notification when a form submission's requested
// slot is already taken. Reuses the same SMTP transporter/from-address as
// sendBookingConfirmationEmail above.
export async function sendBookingFailedEmail({ customer_name, customer_email, sport, booking_date, time_slot, suggestions, submitted_by_email }) {
    const fromAddress = process.env.SMTP_FROM || process.env.SMTP_USER;
    const t = getTransporter();
    const subject = 'Booking Request Failed - Slot Unavailable | PlayBox Kashmir';
    const name = escapeHtml(customer_name || 'there');
    const sportLabel = escapeHtml(sport || '');
    const dateLabel = escapeHtml(String(booking_date || ''));
    const slotLabel = escapeHtml(time_slot || '');

  const hasPrior = suggestions && Array.isArray(suggestions.prior) && suggestions.prior.length > 0;
  const hasLater = suggestions && Array.isArray(suggestions.later) && suggestions.later.length > 0;
  const suggestionsHtml = (hasPrior || hasLater)
    ? (
        '<p style="margin:16px 0 0;font-size:14px;color:#111827;">Here are some open slots on the same date you could try instead:</p>' +
        (hasPrior
          ? '<p style="margin:10px 0 2px;font-size:13px;color:#111827;font-weight:600;">Earlier available slots:</p>' +
            '<ul style="margin:0 0 0;padding-left:18px;color:#374151;font-size:13.5px;line-height:1.7;">' +
            suggestions.prior.map((s) => '<li>' + escapeHtml(s) + '</li>').join('') +
            '</ul>'
          : '') +
        (hasLater
          ? '<p style="margin:10px 0 2px;font-size:13px;color:#111827;font-weight:600;">Later available slots:</p>' +
            '<ul style="margin:0 0 0;padding-left:18px;color:#374151;font-size:13.5px;line-height:1.7;">' +
            suggestions.later.map((s) => '<li>' + escapeHtml(s) + '</li>').join('') +
            '</ul>'
          : '')
      )
    : '<p style="margin:16px 0 0;font-size:14px;color:#111827;">Please try a different date or time slot, or contact us and we will help you find one.</p>';

  const html = [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '<meta charset="UTF-8" />',
        '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
        '<title>Booking Request Failed - PlayBox Kashmir</title>',
        '</head>',
        '<body style="margin:0;padding:0;background-color:#f3f4f6;">',
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;">',
        '<tr><td align="center">',
        '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;margin:24px 0;border-radius:8px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">',
        '<tr>',
        '<td align="center" style="background-color:#B91C1C;padding:32px 24px;">',
        '<div style="font-size:21px;line-height:1.3;font-weight:700;color:#ffffff;">Booking Request Failed</div>',
        '</td>',
        '</tr>',
        '<tr>',
        '<td style="padding:28px 32px 8px;">',
        '<p style="margin:0 0 6px;font-size:16px;color:#111827;">Hey ' + name + ',</p>',
      '<p style="margin:0 0 12px;font-size:13px;color:#4b5563;">This booking was submitted by a team member (' + escapeHtml(submitted_by_email || '') + ') for customer ' + name + ' (' + escapeHtml(customer_email || '') + ').</p>',
        '<p style="margin:0;font-size:14px;line-height:1.6;color:#4b5563;">Unfortunately, the slot you requested (<strong>' + sportLabel + '</strong> on <strong>' + dateLabel + '</strong> at <strong>' + slotLabel + '</strong>) had already been booked by someone else moments before your request went through.</p>',
        suggestionsHtml,
        '</td>',
        '</tr>',
        '<tr>',
        '<td style="padding:24px 32px 32px;">',
        '<p style="margin:0;font-size:12.5px;line-height:1.7;color:#6b7280;">Need help picking a new slot? Email us at <a href="mailto:contact@playboxkashmir.com" style="color:#0F766E;font-weight:600;text-decoration:none;">contact@playboxkashmir.com</a>.</p>',
        '</td>',
        '</tr>',
        '</table>',
        '</td>',
        '</tr>',
        '</table>',
        '</body>',
        '</html>',
      ].join('\n');

  await t.sendMail({
        from: fromAddress,
        to: submitted_by_email || customer_email,
        subject,
        html,
  });
}


// Sends a booking cancellation notice to the customer, including the
// cancellation reason and any applicable refund (per the Cancellation &
// Refund Policy). Reuses the same SMTP transporter/branding as
// sendBookingConfirmationEmail above.
export async function sendBookingCancellationEmail(booking, cancellation) {
    const t = getTransporter();
    const fromAddress = process.env.SMTP_FROM || process.env.SMTP_USER;

  const reason = cancellation && cancellation.reason;
    const notes = cancellation && cancellation.notes;
    const refundAmount = (cancellation && cancellation.refundAmount) || 0;
    const refundNote = (cancellation && cancellation.refundNote) || '';
    const hasRefund = refundAmount > 0;

  const reasonLabel = reason === 'playbox_cancellation'
      ? 'Cancelled by PlayBox Kashmir\u2122'
        : "Cancelled at the customer's request";

  const subject = 'Booking Cancelled - ' + booking.booking_ref + ' | PlayBox Kashmir';

  const durationHours = computeDurationHours(booking.start_time, booking.end_time);
    const amountPaidDisplay = 'Rs ' + Number(booking.amount_paid || 0).toFixed(2);
    const refundDisplay = 'Rs ' + Number(refundAmount).toFixed(2);

  const statusBadgeColor = hasRefund ? '#15803D' : '#B91C1C';
    const statusBadgeBg = hasRefund ? '#DCFCE7' : '#FEE2E2';
    const statusBadgeText = hasRefund ? 'Refund Approved' : 'No Refund';

  const leftColumn = [
        detailBlock('Booking ID', escapeHtml(booking.booking_ref)),
        detailBlock('Customer Name', escapeHtml(booking.customer_name)),
        detailBlock('Facility', escapeHtml(booking.option_name || booking.sport_name || '-'))
      ].join('');

  const rightColumn = [
        detailBlock('Date', escapeHtml(formatDateNice(booking.booking_date))),
        detailBlock('Time', escapeHtml(formatTime12(booking.start_time)) + ' - ' + escapeHtml(formatTime12(booking.end_time)) + ' (' + durationHours + ' hrs)'),
        detailBlock('Cancellation Reason', escapeHtml(reasonLabel))
      ].join('');

  const notesHtml = notes
      ? ('<p style="margin:12px 0 0;font-size:13px;color:#52525b;line-height:1.5;"><em>Note from our team:</em> ' + escapeHtml(notes) + '</p>')
        : '';

  const html = [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '<meta charset="UTF-8" />',
        '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
        '<title>Booking Cancelled - PlayBox Kashmir\u2122</title>',
        '<style>',
        "  body, table, td { font-family: 'Segoe UI', Arial, Helvetica, sans-serif; }",
        '  @media only screen and (max-width: 480px) {',
        '    .pk-container { width: 100% !important; }',
        '  }',
        '</style>',
        '</head>',
        '<body style="margin:0;padding:0;background-color:#f4f4f5;">',
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:24px 0;">',
        '  <tr>',
        '    <td align="center">',
        '      <table role="presentation" class="pk-container" width="600" cellpadding="0" cellspacing="0" style="width:600px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(185,28,28,0.12);">',
        '        <tr>',
        '          <td align="center" style="background-color:#B91C1C;padding:32px 24px;">',
        '            <img src="' + LOGO_URL + '" alt="PlayBox Kashmir" width="64" height="64" style="display:block;margin:0 auto 12px;border-radius:12px;" />',
        '            <h1 style="margin:0;color:#ffffff;font-size:22px;">Your Booking Has Been Cancelled</h1>',
        '          </td>',
        '        </tr>',
        '        <tr>',
        '          <td style="padding:32px 24px;">',
        '            <p style="margin:0 0 16px;font-size:15px;color:#27272a;">Hi ' + escapeHtml(booking.customer_name) + ',</p>',
        '            <p style="margin:0 0 24px;font-size:15px;color:#27272a;line-height:1.6;">This is to confirm that the booking below has been cancelled. ' + escapeHtml(reasonLabel) + '.</p>',
        '            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">',
        '              <tr>',
        '                <td valign="top" width="50%" style="padding-right:12px;">' + leftColumn + '</td>',
        '                <td valign="top" width="50%" style="padding-left:12px;">' + rightColumn + '</td>',
        '              </tr>',
        '            </table>',
        '            <div style="margin-top:24px;background-color:' + statusBadgeBg + ';border-left:4px solid ' + statusBadgeColor + ';border-radius:8px;padding:16px 20px;">',
        '              <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:' + statusBadgeColor + ';text-transform:uppercase;letter-spacing:0.5px;">' + statusBadgeText + '</p>',
        '              <p style="margin:0 0 4px;font-size:14px;color:#27272a;">Amount Paid: <strong>' + amountPaidDisplay + '</strong></p>',
        '              <p style="margin:0 0 4px;font-size:14px;color:#27272a;">Estimated Refund: <strong>' + refundDisplay + '</strong></p>',
        '              <p style="margin:12px 0 0;font-size:13px;color:#52525b;line-height:1.5;">' + escapeHtml(refundNote) + '</p>',
        notesHtml,
        '            </div>',
        '            <div style="text-align:center;margin:32px 0 8px;">',
        '              <a href="' + BOOK_URL + '" style="display:inline-block;background-color:#0F766E;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:14px 32px;border-radius:8px;">Book Another Slot</a>',
        '            </div>',
        '            <p style="margin:24px 0 0;font-size:13px;color:#71717a;line-height:1.6;">Refunds (if any) are processed to the original payment method within 5-7 business days. For questions about this cancellation or our policy, please read our <a href="' + CANCELLATION_URL + '" style="color:#0F766E;">Cancellation &amp; Refund Policy</a> or contact us at <a href="mailto:' + SUPPORT_EMAIL + '" style="color:#0F766E;">' + SUPPORT_EMAIL + '</a>.</p>',
        '          </td>',
        '        </tr>',
        '        <tr>',
        '          <td style="background-color:#fafafa;padding:24px;text-align:center;border-top:1px solid #e4e4e7;">',
        '            <img src="' + LOGO_URL + '" alt="PlayBox Kashmir" width="32" height="32" style="display:block;margin:0 auto 8px;border-radius:8px;" />',
        '            <p style="margin:0 0 4px;font-size:13px;color:#71717a;">PlayBox Kashmir\u2122</p>',
        '            <p style="margin:0 0 4px;font-size:13px;color:#71717a;"><a href="' + SITE_URL + '" style="color:#0F766E;text-decoration:none;">' + SITE_URL.replace('https://', '') + '</a> &middot; <a href="mailto:' + SUPPORT_EMAIL + '" style="color:#0F766E;text-decoration:none;">' + SUPPORT_EMAIL + '</a></p>',
        '            <p style="margin:12px 0 0;font-size:12px;color:#a1a1aa;">The PlayBox Kashmir\u2122 Team</p>',
        '          </td>',
        '        </tr>',
        '      </table>',
        '    </td>',
        '  </tr>',
        '</table>',
        '</body>',
        '</html>'
      ].join('\n');

  await t.sendMail({
        from: fromAddress,
        to: booking.customer_email,
        subject,
        html
  });
}


// Sends a tournament entry confirmation email once a team's registration
// payment has been captured. This is intentionally a separate, dedicated
// email template from sendBookingConfirmationEmail above -- tournament
// entries are a different product from slot bookings.
export async function sendTournamentConfirmationEmail(team, tournament) {
  const fromAddress = process.env.SMTP_FROM || process.env.SMTP_USER;
  const t = getTransporter();

const subject = 'Tournament Entry Confirmed - ' + tournament.name + ' | PlayBox Kashmir';
  const captainName = escapeHtml(team.captain_name || 'there');
  const firstName = captainName.split(' ')[0];
  const categoryLabel = tournament.category === 'invite' ? 'Invite Only' : 'Open for All';

const leftColumn = [
  detailBlock('Tournament', escapeHtml(tournament.name)),
  detailBlock('Team Name', escapeHtml(team.team_name)),
  detailBlock('Captain', captainName),
  detailBlock('Format', escapeHtml(tournament.format))
  ].join('');

const rightColumn = [
  detailBlock('Category', categoryLabel),
  detailBlock('Entry Fee Paid', '&#8377;' + escapeHtml(team.amount_paid)),
  detailBlock('Tournament Starts', formatDateNice(tournament.start_date)),
  detailBlock('Payment Status', '<span style="display:inline-block;background:#DCFCE7;color:#15803d;font-size:13px;font-weight:700;padding:5px 14px;border-radius:999px;">Paid &#10003;</span>')
  ].join('');

const html = [
  '<!DOCTYPE html>',
  '<html lang="en">',
  '<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>Tournament Entry Confirmed</title></head>',
  '<body style="margin:0;padding:0;background-color:#f3f4f6;">',
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;padding:32px 12px;font-family:\'Segoe UI\',Arial,Helvetica,sans-serif;">',
  '<tr><td align="center">',
  '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(15,118,110,0.12);">',
  '<tr><td align="center" style="background-color:#0F766E;padding:36px 24px 30px;">',
  '<img src="' + LOGO_URL + '" alt="PlayBox Kashmir" width="64" height="64" style="display:block;margin:0 auto 14px;border-radius:14px;" />',
  '<div style="font-size:22px;line-height:1.3;font-weight:700;color:#ffffff;">Your Team is Registered! &#127942;</div>',
  '</td></tr>',
  '<tr><td style="padding:32px 40px 8px;">',
  '<p style="margin:0 0 6px;font-size:16px;color:#111827;">Hey ' + firstName + ',</p>',
  '<p style="margin:0;font-size:14px;line-height:1.6;color:#4b5563;">Your entry fee has been received and <strong>' + escapeHtml(team.team_name) + '</strong> is officially registered for <strong>' + escapeHtml(tournament.name) + '</strong>. Here are your registration details:</p>',
  '</td></tr>',
  '<tr><td style="padding:20px 40px 4px;">',
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>',
  '<td valign="top" width="50%" style="padding-right:16px;">' + leftColumn + '</td>',
  '<td valign="top" width="50%">' + rightColumn + '</td>',
  '</tr></table>',
  '</td></tr>',
  '<tr><td style="padding:12px 40px 0;">',
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F0FDFA;border-left:4px solid #0F766E;border-radius:8px;"><tr><td style="padding:18px 20px;">',
  '<div style="font-size:14px;font-weight:700;color:#0F766E;margin-bottom:10px;">What happens next?</div>',
  '<ul style="margin:0;padding-left:18px;color:#374151;font-size:13.5px;line-height:1.9;">',
  '<li>Once all team slots are filled, we will randomly seed every team and draw up the bracket.</li>',
  '<li>You will receive a separate email with your seed, your first opponent, and every scheduled match date through to the final.</li>',
  '<li>Please make sure your full squad (including substitutes) is ready before the tournament start date.</li>',
  '</ul>',
  '</td></tr></table>',
  '</td></tr>',
  '<tr><td style="padding:24px 40px 36px;"><p style="margin:0;font-size:12.5px;line-height:1.7;color:#6b7280;text-align:center;">Questions about your entry? Email us at <a href="mailto:' + SUPPORT_EMAIL + '" style="color:#0F766E;font-weight:600;text-decoration:none;">' + SUPPORT_EMAIL + '</a>.</p></td></tr>',
  '</table>',
  '</td></tr>',
  '</table>',
  '</body>',
  '</html>'
  ].join('\n');

await t.sendMail({
  from: fromAddress,
  to: team.email,
  subject,
  html
});
}

// Sends each team its full fixture schedule once a tournament has been
// seeded and the bracket has been generated: their seed label, first
// opponent, first match date, and every subsequent round date they will
// play on IF they keep winning, through to the final.
export async function sendTournamentFixtureEmail(team, tournament, opponentLabel, schedule) {
  const fromAddress = process.env.SMTP_FROM || process.env.SMTP_USER;
  const t = getTransporter();

const subject = 'Your Fixtures Are Out - ' + tournament.name + ' | PlayBox Kashmir';
  const captainName = escapeHtml(team.captain_name || 'there');
  const firstName = captainName.split(' ')[0];

const scheduleRows = (schedule || []).map(function (s, i) {
  const label = (i === 0 && opponentLabel)
  ? (s.round_name + ' - vs Team ' + escapeHtml(opponentLabel))
    : (s.round_name + (i === 0 ? '' : ' (if you qualify)'));
  return detailBlock(label, formatDateNice(s.match_date));
}).join('');

const html = [
  '<!DOCTYPE html>',
  '<html lang="en">',
  '<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>Your Fixtures Are Out</title></head>',
  '<body style="margin:0;padding:0;background-color:#f3f4f6;">',
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;padding:32px 12px;font-family:\'Segoe UI\',Arial,Helvetica,sans-serif;">',
  '<tr><td align="center">',
  '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(15,118,110,0.12);">',
  '<tr><td align="center" style="background-color:#0F766E;padding:36px 24px 30px;">',
  '<img src="' + LOGO_URL + '" alt="PlayBox Kashmir" width="64" height="64" style="display:block;margin:0 auto 14px;border-radius:14px;" />',
  '<div style="font-size:22px;line-height:1.3;font-weight:700;color:#ffffff;">Your Fixtures Are Out! &#128197;</div>',
  '</td></tr>',
  '<tr><td style="padding:32px 40px 8px;">',
  '<p style="margin:0 0 6px;font-size:16px;color:#111827;">Hey ' + firstName + ',</p>',
  '<p style="margin:0;font-size:14px;line-height:1.6;color:#4b5563;">The draw for <strong>' + escapeHtml(tournament.name) + '</strong> is complete. <strong>' + escapeHtml(team.team_name) + '</strong> has been seeded as <strong>Team ' + escapeHtml(team.seed_label || '') + '</strong>. Here is your path to the final:</p>',
  '</td></tr>',
  '<tr><td style="padding:20px 40px 4px;">' + scheduleRows + '</td></tr>',
  '<tr><td style="padding:12px 40px 0;">',
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F0FDFA;border-left:4px solid #0F766E;border-radius:8px;"><tr><td style="padding:18px 20px;">',
  '<div style="font-size:13.5px;color:#374151;line-height:1.8;">Only the first match date and opponent are confirmed today. If you win, we will confirm your next opponent closer to each date -- the dates above are already reserved for you, so please block your calendar through to the final.</div>',
  '</td></tr></table>',
  '</td></tr>',
  '<tr><td style="padding:24px 40px 36px;"><p style="margin:0;font-size:12.5px;line-height:1.7;color:#6b7280;text-align:center;">Questions about your fixtures? Email us at <a href="mailto:' + SUPPORT_EMAIL + '" style="color:#0F766E;font-weight:600;text-decoration:none;">' + SUPPORT_EMAIL + '</a>.</p></td></tr>',
  '</table>',
  '</td></tr>',
  '</table>',
  '</body>',
  '</html>'
  ].join('\n');

await t.sendMail({
  from: fromAddress,
  to: team.email,
  subject,
  html
});
}
