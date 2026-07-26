-- PlayBox Kashmir Admin Backend - Database Schema
-- Run this once against your PostgreSQL database (Vercel Postgres, Neon, Supabase, Railway, etc.)
-- psql "$DATABASE_URL" -f db/schema.sql

CREATE TABLE IF NOT EXISTS admin_users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

CREATE TABLE IF NOT EXISTS facilities (
  id SERIAL PRIMARY KEY,
  sport_key TEXT NOT NULL,
  sport_name TEXT NOT NULL,
  option_id TEXT NOT NULL UNIQUE,
  option_name TEXT NOT NULL,
  base_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  peak_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

CREATE TABLE IF NOT EXISTS promo_codes (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('percent','flat')),
  value NUMERIC(10,2) NOT NULL,
  min_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

CREATE TABLE IF NOT EXISTS bookings (
  id SERIAL PRIMARY KEY,
  booking_ref TEXT UNIQUE NOT NULL,
  facility_id INTEGER NOT NULL REFERENCES facilities(id),
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  booking_date DATE NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  rate NUMERIC(10,2) NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  payment_status TEXT NOT NULL DEFAULT 'paid' CHECK (payment_status IN ('paid','partial')),
  amount_paid NUMERIC(10,2),
  payment_method TEXT NOT NULL DEFAULT 'cash',
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('reserved','confirmed','cancelled','completed')),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','online')),
  notes TEXT,
  confirmation_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

-- Prevents double-booking the same facility/date/time while the booking is active
CREATE UNIQUE INDEX IF NOT EXISTS unique_active_slot
ON bookings (facility_id, booking_date, start_time)
WHERE status IN ('reserved','confirmed');

CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings (booking_date);
CREATE INDEX IF NOT EXISTS idx_bookings_email ON bookings (customer_email);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL
  );

-- Seed facilities matching the existing front-end booking.js CONFIG
INSERT INTO facilities (sport_key, sport_name, option_id, option_name, base_price, peak_price) VALUES
('football', 'Football & Cricket Turf', 'turf1', 'Main Turf (Football & Cricket)', 1800, 1800),
('cricket', 'Cricket Nets', 'net1', 'Net 1', 400, 500),
('cricket', 'Cricket Nets', 'net2', 'Net 2', 400, 500),
('cricket', 'Cricket Nets', 'net3', 'Net 3', 400, 500),
('pickleball', 'Pickleball Court', 'pb_a', 'Court A', 300, 400),
('pickleball', 'Pickleball Court', 'pb_b', 'Court B', 300, 400)
ON CONFLICT (option_id) DO NOTHING;
