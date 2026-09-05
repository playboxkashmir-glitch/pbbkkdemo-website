// Vercel Serverless Function: Dashboard summary stats
// Returns today's bookings/revenue, this week, this month, a breakdown by sport,
// a daily revenue trend for the last 7 days, and a peak-booking-hours breakdown
// so the Admin Dashboard cards and charts can be powered by real data.

import { query } from '../../lib/db.js';
import { requireAuth } from '../../lib/auth.js';
import { runDailyReport } from '../../lib/dailyReport.js';

const PEAK_BUCKETS = [
  { key: 'morning', label: 'Morning', range: '6-9 AM' },
  { key: 'day', label: 'Day', range: '9-5 PM' },
  { key: 'evening', label: 'Evening', range: '5-10 PM' },
  { key: 'night', label: 'Night', range: '10-11 PM' }
  ];

export default async function handler(req, res) {
  // Invoked once a day by the Vercel Cron Job in vercel.json (an
  // unauthenticated request as far as the admin session goes - Vercel
  // Cron cannot hold the admin login cookie), so this branch is checked
  // first and uses its own shared-secret check instead of requireAuth.
  if (req.query.resource === 'daily-report') {
    return handleDailyReport(req, res);
  }

    const user = requireAuth(req, res);
    if (!user) return;

  if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
        const today = await query(
                `SELECT COUNT(*) AS count, COALESCE(SUM(amount),0) AS revenue
                       FROM bookings WHERE booking_date = CURRENT_DATE AND status IN ('confirmed','completed')`
              );

      const yesterday = await query(
              `SELECT COUNT(*) AS count, COALESCE(SUM(amount),0) AS revenue
                     FROM bookings WHERE booking_date = CURRENT_DATE - INTERVAL '1 day' AND status IN ('confirmed','completed')`
            );

      const week = await query(
              `SELECT COUNT(*) AS count FROM bookings
                     WHERE booking_date >= date_trunc('week', CURRENT_DATE) AND status IN ('confirmed','completed')`
            );

      const month = await query(
              `SELECT COALESCE(SUM(amount),0) AS revenue FROM bookings
                     WHERE booking_date >= date_trunc('month', CURRENT_DATE) AND status IN ('confirmed','completed')`
            );

      const lastWeekSame = await query(
        `SELECT COUNT(*) AS count FROM bookings
               WHERE booking_date >= date_trunc('week', CURRENT_DATE) - INTERVAL '7 days'
                 AND booking_date <= CURRENT_DATE - INTERVAL '7 days'
                 AND status IN ('confirmed','completed')`
      );

      const lastMonthSame = await query(
        `SELECT COALESCE(SUM(amount),0) AS revenue FROM bookings
               WHERE booking_date >= date_trunc('month', CURRENT_DATE - INTERVAL '1 month')
                 AND booking_date <= CURRENT_DATE - INTERVAL '1 month'
                 AND status IN ('confirmed','completed')`
      );

      const bySport = await query(
              `SELECT f.sport_name, COUNT(*) AS count
                     FROM bookings b JOIN facilities f ON f.id = b.facility_id
                            WHERE b.status IN ('confirmed','completed')
                                   GROUP BY f.sport_name
                                          ORDER BY count DESC`
            );

      const last7Raw = await query(
              `SELECT booking_date::text AS date, COALESCE(SUM(amount),0) AS revenue
                     FROM bookings
                            WHERE booking_date >= CURRENT_DATE - INTERVAL '6 days' AND booking_date <= CURRENT_DATE
                                     AND status IN ('confirmed','completed')
                                            GROUP BY booking_date
                                                   ORDER BY booking_date`
            );

      const peakRaw = await query(
              `SELECT
                       CASE
                                  WHEN split_part(start_time, ':', 1)::int BETWEEN 6 AND 8 THEN 'morning'
                                             WHEN split_part(start_time, ':', 1)::int BETWEEN 9 AND 16 THEN 'day'
                                                        WHEN split_part(start_time, ':', 1)::int BETWEEN 17 AND 21 THEN 'evening'
                                                                   ELSE 'night'
                                                                            END AS bucket,
                                                                                     COUNT(*) AS count
                                                                                            FROM bookings
                                                                                                   WHERE status IN ('confirmed','completed')
                                                                                                          GROUP BY bucket`
            );

      // Fill in every day of the last 7 days, even ones with no revenue yet
      const revenueByDate = {};
        last7Raw.rows.forEach((r) => { revenueByDate[r.date] = Number(r.revenue); });
        const last7Days = [];
        for (let i = 6; i >= 0; i--) {
                const d = new Date();
                d.setDate(d.getDate() - i);
                const key = d.toISOString().slice(0, 10);
                last7Days.push({
                          date: key,
                          label: d.toLocaleDateString('en-IN', { weekday: 'short' }),
                          revenue: revenueByDate[key] || 0
                });
        }

      // Normalize peak-hour buckets so all four always appear, in a fixed order
      const countsByBucket = {};
        peakRaw.rows.forEach((r) => { countsByBucket[r.bucket] = Number(r.count); });
        const peakHours = PEAK_BUCKETS.map((b) => ({
                key: b.key,
                label: b.label,
                range: b.range,
                count: countsByBucket[b.key] || 0
        }));

      return res.status(200).json({
        today: today.rows[0],
        yesterday: yesterday.rows[0],
        week: week.rows[0],
        month: month.rows[0],
        lastWeekSame: lastWeekSame.rows[0],
        lastMonthSame: lastMonthSame.rows[0],
        bySport: bySport.rows,
        last7Days,
        peakHours
      });
  } catch (err) {
        console.error('Reports summary error:', err);
        return res.status(500).json({ error: 'Server error while generating report summary.' });
  }
}

// ---- Daily "Today's Booking Sheet" email, triggered by Vercel Cron ----
// Accepts either the admin session cookie (so it can also be triggered
// manually from the admin panel / for testing) or a
// `Authorization: Bearer <CRON_SECRET>` header, which is what Vercel Cron
// is configured (in vercel.json) to send. Without a configured
// CRON_SECRET this endpoint refuses every request, so it fails closed
// rather than being left open to the public internet.
async function handleDailyReport(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization || '';
  const hasValidCronSecret = !!cronSecret && authHeader === `Bearer ${cronSecret}`;

  if (!hasValidCronSecret) {
    const user = requireAuth(req, res);
    if (!user) return;
  }

  try {
    const result = await runDailyReport();
    return res.status(200).json(result);
  } catch (err) {
    console.error('Daily report error:', err);
    return res.status(500).json({ error: 'Server error while generating the daily report.' });
  }
}
