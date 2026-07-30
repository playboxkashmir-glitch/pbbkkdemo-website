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



-- ============================================================
-- Tournaments module
-- ============================================================

CREATE TABLE IF NOT EXISTS tournaments (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('open','invite')),
  format TEXT NOT NULL CHECK (format IN ('5-a-side','6-a-side','7-a-side')),
  num_teams INTEGER NOT NULL CHECK (num_teams IN (4,8,16,32)),
  substitutes_allowed INTEGER NOT NULL DEFAULT 3,
  start_date DATE NOT NULL,
  registration_deadline DATE,
  entry_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  duration_notes TEXT,
  rules TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','full','seeded','in_progress','completed','cancelled')),
  seeded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

-- For invite-only tournaments: one row per team slot. Emails can be left
-- blank when creating the tournament and filled in / edited later from
-- the admin panel. Only these emails may register for the tournament.
CREATE TABLE IF NOT EXISTS tournament_invite_emails (
  id SERIAL PRIMARY KEY,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  slot_index INTEGER NOT NULL,
  email TEXT,
  used BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

CREATE UNIQUE INDEX IF NOT EXISTS unique_invite_slot ON tournament_invite_emails (tournament_id, slot_index);

CREATE TABLE IF NOT EXISTS tournament_teams (
  id SERIAL PRIMARY KEY,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  team_name TEXT NOT NULL,
  captain_name TEXT NOT NULL,
  contact_number TEXT NOT NULL,
  email TEXT NOT NULL,
  seed_label TEXT,
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending','paid','failed')),
  amount_paid NUMERIC(10,2),
  razorpay_order_id TEXT,
  razorpay_payment_id TEXT,
  terms_accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

CREATE UNIQUE INDEX IF NOT EXISTS unique_team_email_per_tournament ON tournament_teams (tournament_id, email);
CREATE INDEX IF NOT EXISTS idx_tournament_teams_tournament ON tournament_teams (tournament_id);

CREATE TABLE IF NOT EXISTS tournament_players (
  id SERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES tournament_teams(id) ON DELETE CASCADE,
  player_name TEXT NOT NULL,
  jersey_number TEXT,
  is_substitute BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

CREATE TABLE IF NOT EXISTS tournament_matches (
  id SERIAL PRIMARY KEY,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round INTEGER NOT NULL,
  round_name TEXT NOT NULL,
  match_index INTEGER NOT NULL,
  team1_id INTEGER REFERENCES tournament_teams(id),
  team2_id INTEGER REFERENCES tournament_teams(id),
  match_date DATE,
  winner_id INTEGER REFERENCES tournament_teams(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

CREATE INDEX IF NOT EXISTS idx_tournament_matches_tournament ON tournament_matches (tournament_id);
