-- ===================================================================
-- Migration 053: Auth Users Table (JWT Authentication)
-- Isolated auth table — does NOT touch existing users/unified_contacts
-- Safe to run repeatedly (IF NOT EXISTS + ON CONFLICT DO NOTHING)
-- ===================================================================

CREATE TABLE IF NOT EXISTS auth_users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'admin',
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Seed the single admin user
INSERT INTO auth_users (email, password_hash, name, role)
VALUES (
  'admin@raynatours.com',
  '$2b$10$4ihmxsxplHy/gek47J9NYeFeDu1QKXEJndyws8fCQw5axj2WooHUG',
  'Admin',
  'admin'
)
ON CONFLICT (email) DO NOTHING;
