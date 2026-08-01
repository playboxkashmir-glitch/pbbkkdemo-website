// Vercel Serverless Function: Generic key/value site settings
// (e.g. business hours, peak hours, contact info) stored as JSONB.
// GET -> return all settings as a { key: value } object. PUBLIC: read-only
// site configuration must be readable by the public website without an admin
// session, so GET intentionally is NOT behind requireAuth.
// PUT -> upsert one setting: { key, value }. Requires an authenticated admin session.
//
// This file also exposes two PUBLIC, unauthenticated logging endpoints used
// by the site's cookie consent banner and anonymous visit funnel tracking:
//   POST ?log=consent -> records the visitor's cookie preference choice.
//   POST ?log=visit -> records a visit event (unique visitor seen, reached
//   booking, completed booking) so visits vs bookings can be compared.
import { query } from '../../lib/db.js';
import { requireAuth } from '../../lib/auth.js';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      const rows = await query('SELECT key, value FROM settings');
      const settings = {};
      for (const row of rows.rows) {
        settings[row.key] = row.value;
      }
      return res.status(200).json(settings);
    } catch (err) {
      console.error('List settings error:', err);
      return res.status(500).json({ error: 'Server error while fetching settings.' });
    }
  }

  if (req.method === 'POST' && req.query.log === 'consent') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const choice = String(body.choice || '').toLowerCase();
      if (choice !== 'all' && choice !== 'custom' && choice !== 'none') {
        return res.status(400).json({ error: 'choice must be all, custom, or none.' });
      }
      const analyticsAllowed = choice === 'all' ? true : (choice === 'custom' ? !!body.analytics : false);
      const personalizationAllowed = choice === 'all' ? true : (choice === 'custom' ? !!body.personalization : false);
      const page = typeof body.page === 'string' ? body.page.slice(0, 200) : null;
      const shouldLogIp = analyticsAllowed || personalizationAllowed;
      const forwarded = req.headers['x-forwarded-for'];
      const ip = shouldLogIp ? (forwarded ? String(forwarded).split(',')[0].trim() : ((req.socket && req.socket.remoteAddress) || null)) : null;
      const ua = shouldLogIp ? (req.headers['user-agent'] || null) : null;
      await query(
        'INSERT INTO consent_logs (consent_choice, ip_address, user_agent, page_path, analytics_allowed, personalization_allowed) VALUES ($1, $2, $3, $4, $5, $6)',
        [choice, ip, ua, page, analyticsAllowed, personalizationAllowed]
      );
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error('Consent log error:', err);
      return res.status(500).json({ error: 'Server error while logging consent.' });
    }
  }

  if (req.method === 'POST' && req.query.log === 'visit') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const visitorId = typeof body.visitorId === 'string' ? body.visitorId.slice(0, 100) : '';
      if (!visitorId) {
        return res.status(400).json({ error: 'visitorId is required.' });
      }
      const reachedBooking = !!body.reachedBooking;
      const completedBooking = !!body.completedBooking;
      const forwarded = req.headers['x-forwarded-for'];
      const ip = forwarded ? String(forwarded).split(',')[0].trim() : ((req.socket && req.socket.remoteAddress) || null);
      await query(
        'INSERT INTO site_visits (visitor_id, ip_address, reached_booking, completed_booking) VALUES ($1, $2, $3, $4) ON CONFLICT (visitor_id) DO UPDATE SET last_seen = now(), ip_address = EXCLUDED.ip_address, pages_viewed = site_visits.pages_viewed + 1, reached_booking = site_visits.reached_booking OR EXCLUDED.reached_booking, completed_booking = site_visits.completed_booking OR EXCLUDED.completed_booking',
        [visitorId, ip, reachedBooking, completedBooking]
      );
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error('Visit log error:', err);
      return res.status(500).json({ error: 'Server error while logging visit.' });
    }
  }

  const user = await requireAuth(req, res);
  if (!user) return;

  if (req.method === 'PUT') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const { key, value } = body;
      if (key === undefined || value === undefined) {
        return res.status(400).json({ error: 'key and value are required.' });
      }
      const rows = await query(
        'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value RETURNING *',
        [key, JSON.stringify(value)]
      );
      return res.status(200).json({ setting: rows.rows[0] });
    } catch (err) {
      console.error('Update setting error:', err);
      return res.status(500).json({ error: 'Server error while updating setting.' });
    }
  }

  res.setHeader('Allow', 'GET, PUT');
  return res.status(405).json({ error: 'Method not allowed' });
}
