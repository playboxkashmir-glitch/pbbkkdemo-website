// Builds the "Today's Booking Sheet" PDF sent by the daily report email
// (lib/dailyReport.js). Pure lib/pdf-lib layout code, no filesystem or
// network access, so it is safe to run inside a Vercel serverless function.
//
// Design goals (per the admin's request):
// - Fits on a single A4 landscape page so it can be printed and kept at
//   the front desk.
// - Lists every booking already on the books for the day (name, phone,
//   facility, payment status).
// - Lists any tournament matches / tournaments starting that day.
// - Lists every remaining open hour for the (single, currently
//   operational) Main Turf as its own line, in one large fill-in box
//   spanning the full width, each line paired with a blank ruled space
//   so staff can pen in walk-in bookings.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const PAGE_W = 841.89; // A4 landscape
const PAGE_H = 595.28;
const MARGIN = 26;
const INK = rgb(0.11, 0.11, 0.13);
const MUTED = rgb(0.42, 0.45, 0.5);
const LINE = rgb(0.78, 0.8, 0.84);
const ACCENT = rgb(0.06, 0.46, 0.43); // matches the site's teal brand color
const HEADER_BG = rgb(0.06, 0.46, 0.43);

// pdf-lib's built-in (WinAnsi-encoded) fonts can only render characters in
// the Windows-1252 code page. Free-text fields that ultimately come from a
// customer or an admin (names, phone numbers typed with odd punctuation,
// team names, etc.) could contain a character outside that range (e.g. the
// Rupee sign, emoji, or non-Latin scripts) - and pdf-lib throws rather than
// skipping the character. Since this PDF is generated inside an unattended
// cron job with no one to see an error, a single bad character must not be
// able to take down the whole daily report, so every dynamic string is run
// through this first and unsupported characters are swapped for '?'.
function safe(font, value) {
  const str = String(value ?? '');
  let out = '';
  for (const ch of str) {
    try {
      font.widthOfTextAtSize(ch, 10);
      out += ch;
    } catch {
      out += '?';
    }
  }
  return out;
}

function wrapText(text, font, size, maxWidth) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const trial = current ? current + ' ' + word : word;
    if (font.widthOfTextAtSize(trial, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = trial;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export async function buildDailyReportPdf(data) {
  const {
    reportDateLabel, // "Saturday, 5 September 2026"
    generatedAtLabel, // "Generated at 12:03 AM IST"
    businessName,
    bookings, // [{ time_label, customer_name, customer_phone, facility_label, payment_label }]
    events, // [string] tournament / match lines for today
    turfOpenSlots // { facilityLabel: string, hourLabels: [string] } - one label per open hour
  } = data;

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([PAGE_W, PAGE_H]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const contentW = PAGE_W - MARGIN * 2;
  let cursorY = PAGE_H - MARGIN;

  // ---------- Header band ----------
  const headerH = 34;
  page.drawRectangle({ x: 0, y: PAGE_H - headerH, width: PAGE_W, height: headerH, color: HEADER_BG });
  page.drawText(`${safe(bold, businessName)} — Today's Booking Sheet`, {
    x: MARGIN, y: PAGE_H - headerH + 11, size: 14, font: bold, color: rgb(1, 1, 1)
  });
  const dateText = reportDateLabel;
  const dateWidth = bold.widthOfTextAtSize(dateText, 12);
  page.drawText(dateText, {
    x: PAGE_W - MARGIN - dateWidth, y: PAGE_H - headerH + 18, size: 12, font: bold, color: rgb(1, 1, 1)
  });
  const genWidth = font.widthOfTextAtSize(generatedAtLabel, 8.5);
  page.drawText(generatedAtLabel, {
    x: PAGE_W - MARGIN - genWidth, y: PAGE_H - headerH + 6, size: 8.5, font, color: rgb(0.85, 0.95, 0.94)
  });

  cursorY = PAGE_H - headerH - 14;

  // ---------- Layout split: left = bookings, right = tournaments/notes ----------
  const leftW = Math.round(contentW * 0.62);
  const rightX = MARGIN + leftW + 18;
  const rightW = contentW - leftW - 18;

  // Reserve space for the open-slots box at the bottom first, so we know
  // how tall the top section can be. Fixed height now that this is a
  // single box rather than a grid sized by facility count.
  const openSlotsSectionH = 220;
  const topSectionTop = cursorY;
  const topSectionBottom = MARGIN + openSlotsSectionH + 10;
  const topSectionH = topSectionTop - topSectionBottom;

  // ---------- Left: bookings table ----------
  page.drawText(`Bookings on the Books (${bookings.length})`, {
    x: MARGIN, y: topSectionTop, size: 10.5, font: bold, color: INK
  });
  const tableTop = topSectionTop - 16;
  const cols = [
    { key: 'time_label', label: 'Time', x: 0, w: 58 },
    { key: 'customer_name', label: 'Customer', x: 58, w: 132 },
    { key: 'customer_phone', label: 'Phone', x: 190, w: 82 },
    { key: 'facility_label', label: 'Facility', x: 272, w: leftW - 272 - 78 },
    { key: 'payment_label', label: 'Payment', x: leftW - 78, w: 78 }
  ];
  const headerRowH = 14;
  cols.forEach((c) => {
    page.drawText(c.label, { x: MARGIN + c.x, y: tableTop, size: 8, font: bold, color: MUTED });
  });
  page.drawLine({
    start: { x: MARGIN, y: tableTop - 4 }, end: { x: MARGIN + leftW, y: tableTop - 4 },
    thickness: 0.75, color: LINE
  });

  // Space from topSectionTop down to topSectionBottom, minus the section
  // title + column headers (headerRowH) already drawn above, minus a
  // reserved strip at the bottom for a "+N more" notice if the list is
  // too long to show in full.
  const headerOffset = 16 + headerRowH; // gap to tableTop + the header row itself
  const footerReserve = 12;
  const availableForRows = Math.max(0, topSectionH - headerOffset - footerReserve);
  const idealRowH = 12;
  const rowH = bookings.length > 0
    ? Math.min(idealRowH, availableForRows / bookings.length)
    : idealRowH;
  const rowFont = rowH >= 10 ? 7.8 : (rowH >= 8 ? 7 : 6.2);

  let rowY = tableTop - headerRowH;
  const maxRowsToShow = rowH > 0 ? Math.max(1, Math.floor(availableForRows / rowH)) : 0;
  const shown = bookings.slice(0, Math.min(maxRowsToShow, bookings.length));

  if (shown.length === 0) {
    page.drawText('No bookings on the books yet for this day.', {
      x: MARGIN, y: rowY - 2, size: 8.5, font, color: MUTED
    });
  }

  shown.forEach((b, i) => {
    if (i % 2 === 1) {
      page.drawRectangle({
        x: MARGIN - 2, y: rowY - rowH + 3, width: leftW + 4, height: rowH,
        color: rgb(0.96, 0.97, 0.97)
      });
    }
    cols.forEach((c) => {
      const raw = String(b[c.key] ?? '');
      const truncated = raw.length > 34 ? raw.slice(0, 33) + '…' : raw;
      const text = safe(font, truncated);
      const color = c.key === 'payment_label' && /partial/i.test(raw) ? rgb(0.7, 0.42, 0.02) : INK;
      page.drawText(text, { x: MARGIN + c.x, y: rowY - rowH + 5, size: rowFont, font, color });
    });
    rowY -= rowH;
  });

  const omittedCount = bookings.length - shown.length;
  if (omittedCount > 0) {
    page.drawText(`+ ${omittedCount} more booking(s) — see the Bookings tab in the admin panel.`, {
      x: MARGIN, y: rowY - 8, size: 7.5, font, color: MUTED
    });
  }

  // ---------- Right: tournaments/events + notes ----------
  page.drawText('Tournaments & Events Today', {
    x: rightX, y: topSectionTop, size: 10.5, font: bold, color: INK
  });
  page.drawLine({
    start: { x: rightX, y: topSectionTop - 4 }, end: { x: rightX + rightW, y: topSectionTop - 4 },
    thickness: 0.75, color: LINE
  });
  let eventY = topSectionTop - 18;
  const eventLineH = 10.5;
  if (!events.length) {
    page.drawText('No tournaments or scheduled events today.', {
      x: rightX, y: eventY, size: 8, font, color: MUTED
    });
    eventY -= eventLineH;
  } else {
    for (const ev of events) {
      const lines = wrapText(safe(font, ev), font, 8, rightW);
      for (const line of lines) {
        if (eventY < topSectionBottom + 60) break;
        page.drawText(line, { x: rightX, y: eventY, size: 8, font, color: INK });
        eventY -= eventLineH;
      }
      eventY -= 2;
    }
  }

  // Notes box fills the remaining right-column space
  const notesTop = eventY - 8;
  if (notesTop > topSectionBottom + 12) {
    page.drawText('Notes', { x: rightX, y: notesTop, size: 8.5, font: bold, color: MUTED });
    let ny = notesTop - 14;
    while (ny > topSectionBottom + 4) {
      page.drawLine({ start: { x: rightX, y: ny }, end: { x: rightX + rightW, y: ny }, thickness: 0.5, color: LINE });
      ny -= 13;
    }
  }

  // ---------- Bottom: one big Main Turf open-slots box, one line per hour ----------
  const stripTop = topSectionBottom - 6;
  page.drawLine({ start: { x: MARGIN, y: stripTop + 6 }, end: { x: PAGE_W - MARGIN, y: stripTop + 6 }, thickness: 1, color: ACCENT });
  page.drawText(`Open Slots — ${safe(bold, turfOpenSlots.facilityLabel)} — write in walk-in bookings below`, {
    x: MARGIN, y: stripTop - 8, size: 10, font: bold, color: INK
  });

  const boxTop = stripTop - 18;
  const boxBottom = MARGIN;
  const boxH = boxTop - boxBottom;
  page.drawRectangle({
    x: MARGIN, y: boxBottom, width: contentW, height: boxH,
    borderColor: LINE, borderWidth: 0.75, color: rgb(1, 1, 1)
  });

  const hourLabels = turfOpenSlots.hourLabels || [];
  const padX = 16;
  const padTop = 14;

  if (hourLabels.length === 0) {
    page.drawText('Fully booked for the rest of today — no open slots to write in.', {
      x: MARGIN + padX, y: boxTop - padTop, size: 10, font: bold, color: MUTED
    });
  } else {
    // Split into two columns: left gets the smaller half, right gets the
    // rest, so the single box reads as two side-by-side fill-in lists
    // rather than one long one.
    const splitAt = Math.floor(hourLabels.length / 2);
    const leftItems = hourLabels.slice(0, splitAt);
    const rightItems = hourLabels.slice(splitAt);
    const rowsNeeded = Math.max(leftItems.length, rightItems.length, 1);

    const colGap = 24;
    const colW = (contentW - padX * 2 - colGap) / 2;
    const leftX = MARGIN + padX;
    const rightXCol = leftX + colW + colGap;

    const availableRowsH = boxH - padTop - 10;
    const rowH = Math.max(13, Math.min(22, availableRowsH / rowsNeeded));
    const labelW = 78;

    [{ x: leftX, items: leftItems }, { x: rightXCol, items: rightItems }].forEach((col) => {
      col.items.forEach((label, i) => {
        const y = boxTop - padTop - i * rowH;
        page.drawText(label, { x: col.x, y, size: 9, font: bold, color: ACCENT });
        page.drawLine({
          start: { x: col.x + labelW, y: y - 2 },
          end: { x: col.x + colW, y: y - 2 },
          thickness: 0.6, color: LINE
        });
      });
    });
  }

  page.drawText('PlayBox Kashmir™ · Automated daily report · contact@playboxkashmir.com', {
    x: MARGIN, y: 10, size: 6.5, font, color: MUTED
  });

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}
