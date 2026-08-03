// Vercel Serverless Function: create a Razorpay order
// Uses RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET from environment variables.
// The secret is NEVER exposed to the browser.
//
// SECURITY: the amount charged is always computed here from the facility's
// price stored in the database (plus promo code + convenience fee), and is
// NEVER trusted from the client. This prevents a tampered "amount" field in
// the request from letting someone pay less than the real price.
import { query } from '../lib/db.js';

// Default values, used only if not overridden by a row in the settings
// table (see below). Kept in sync with assets/js/booking.js CONFIG, which
// reads the same keys from GET /api/settings -- single source of truth.
const DEFAULT_PEAK_HOURS = [18, 19, 20, 21];
const DEFAULT_INAUGURAL_DISCOUNT_PCT = 15;
// Flat amount (before convenience fee) a customer pays to reserve a slot
// without paying in full up front. The remaining balance is due later.
const DEFAULT_RESERVE_AMOUNT = 500;
const TERMS_VERSION = '2026-07-26'; // bump when Terms/Privacy/Cancellation policy text changes

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) {
        return res.status(500).json({ error: 'Payment gateway is not configured.' });
    }

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
        const { facility_id, booking_date, hours, promo_code } = body;
        const currency = body.currency || 'INR';

        if (!facility_id || !booking_date || !Array.isArray(hours) || hours.length === 0 || hours.length > 12) {
            return res.status(400).json({ error: 'facility_id, booking_date and a valid hours[] array (1-12 entries) are required.' });
        }
        if (body.terms_accepted !== true) {
            return res.status(400).json({ error: 'You must accept the Terms & Conditions, Privacy Policy and Cancellation Policy before payment.' });
        }
        if (!hours.every(function(h) { return Number.isInteger(h) && h >= 0 && h < 26; })) {
            return res.status(400).json({ error: 'hours[] must contain valid hour numbers.' });
        }

        const facRows = await query('SELECT id, base_price, peak_price FROM facilities WHERE option_id = $1 AND is_active = true', [facility_id]);
        if (facRows.rows.length === 0) {
            return res.status(400).json({ error: 'Unknown or unavailable facility.' });
        }
        const facility = facRows.rows[0];
        const basePrice = Number(facility.base_price);
        const peakPrice = Number(facility.peak_price);

        let PEAK_HOURS = DEFAULT_PEAK_HOURS;
        let INAUGURAL_DISCOUNT_PCT = DEFAULT_INAUGURAL_DISCOUNT_PCT;
        let RESERVE_AMOUNT = DEFAULT_RESERVE_AMOUNT;
        let convenienceFee = 0;

        const settingsRows = await query("SELECT key, value FROM settings WHERE key IN ('convenience_fee','peak_hours','inaugural_discount_pct','reserve_amount')");
        settingsRows.rows.forEach(function(row) {
            if (row.key === 'convenience_fee') {
                const fee = parseFloat(row.value);
                if (!isNaN(fee)) convenienceFee = fee;
            } else if (row.key === 'peak_hours') {
                if (Array.isArray(row.value) && row.value.length) PEAK_HOURS = row.value;
            } else if (row.key === 'inaugural_discount_pct') {
                const pct = parseFloat(row.value);
                if (!isNaN(pct)) INAUGURAL_DISCOUNT_PCT = pct;
            } else if (row.key === 'reserve_amount') {
                const resAmt = parseFloat(row.value);
                if (!isNaN(resAmt)) RESERVE_AMOUNT = resAmt;
            }
        });

        let basePriceTotal = 0;
        hours.forEach(function(h) {
            const isPeak = PEAK_HOURS.indexOf(h % 24) !== -1;
            basePriceTotal += isPeak ? peakPrice : basePrice;
        });

        const inauguralDiscount = Math.round(basePriceTotal * INAUGURAL_DISCOUNT_PCT / 100);
        const afterInaugural = basePriceTotal - inauguralDiscount;

        let promoDiscount = 0;
        let appliedPromoCode = null;
        if (promo_code) {
            const promoRows = await query('SELECT code, type, value, min_amount FROM promo_codes WHERE code = $1 AND is_active = true', [String(promo_code).trim().toUpperCase()]);
            if (promoRows.rows.length) {
                const promo = promoRows.rows[0];
                const minAmount = Number(promo.min_amount);
                if (afterInaugural >= minAmount) {
                    promoDiscount = promo.type === 'percent' ? Math.round(afterInaugural * Number(promo.value) / 100) : Number(promo.value);
                    appliedPromoCode = promo.code;
                }
            }
        }

        const discountedSubtotal = afterInaugural - promoDiscount;
        const totalAmount = Math.round((discountedSubtotal + convenienceFee) * 100) / 100;

        // "Reserve" bookings let a customer hold a slot by paying a small flat
        // amount (plus the convenience fee) now, with the remaining balance due
        // later. This is a completely separate, smaller charge from the full
        // totalAmount above -- Razorpay only ever sees whichever one amount is
        // actually being collected in this request.
        const paymentMode = body.payment_mode === 'reserve' ? 'reserve' : 'full';
            // Tiered reserve: RESERVE_AMOUNT per every ₹2000 (or part thereof) of basePriceTotal
            const reserveTierMultiplier = Math.max(1, Math.ceil(basePriceTotal / 2000));
            const tieredReserveAmount = RESERVE_AMOUNT * reserveTierMultiplier;
            const reserveAmount = Math.round((tieredReserveAmount + convenienceFee) * 100) / 100;
        const isReserve = paymentMode === 'reserve' && reserveAmount < totalAmount;
        const chargeAmount = isReserve ? reserveAmount : totalAmount;
        const balanceDue = isReserve ? Math.round((totalAmount - reserveAmount) * 100) / 100 : 0;

        const amount = Math.round(chargeAmount * 100);

        if (!Number.isInteger(amount) || amount <= 0) {
            return res.status(400).json({ error: 'Computed amount is invalid.' });
        }

        const notes = Object.assign({}, body.notes, {
            facility_id: facility_id,
            booking_date: booking_date,
            rate: basePriceTotal,
            promo_code: appliedPromoCode,
            amount: totalAmount,
            is_reserve: isReserve,
            full_amount: totalAmount,
            reserve_amount: isReserve ? reserveAmount : null,
            balance_due: balanceDue,
            terms_accepted: body.terms_accepted,
            terms_version: TERMS_VERSION,
        });

        const auth = Buffer.from(keyId + ':' + keySecret).toString('base64');
        const rpRes = await fetch('https://api.razorpay.com/v1/orders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Basic ' + auth,
            },
            body: JSON.stringify({
                amount: amount,
                currency: currency,
                receipt: body.receipt || undefined,
                notes: notes,
            }),
        });

        const data = await rpRes.json();
        if (!rpRes.ok) {
            const message = (data && data.error && data.error.description) || 'Order creation failed.';
            return res.status(rpRes.status).json({ error: message });
        }

        return res.status(200).json({
            id: data.id,
            amount: data.amount,
            currency: data.currency,
            is_reserve: isReserve,
            full_amount: totalAmount,
            reserve_amount: isReserve ? reserveAmount : null,
            balance_due: balanceDue,
        })
    } catch (err) {
        console.error('Create order error:', err);
        return res.status(500).json({ error: 'Server error while creating order.' });
    }
}
