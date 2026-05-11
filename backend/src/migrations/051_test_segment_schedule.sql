-- Tracks an active test-segment send schedule. One row per active run.
-- next_day_to_send: 1..7. When >7 the sequence is complete and is_running flips false.

CREATE TABLE IF NOT EXISTS test_segment_schedule (
  id                SERIAL PRIMARY KEY,
  is_running        BOOLEAN     NOT NULL DEFAULT FALSE,
  started_at        TIMESTAMPTZ,
  next_day_to_send  INT         NOT NULL DEFAULT 1,
  last_sent_day     INT,
  last_sent_at      TIMESTAMPTZ,
  destination_key   TEXT        DEFAULT 'singapore',
  loop              BOOLEAN     NOT NULL DEFAULT FALSE,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add emails column (stores recipient email list as JSONB array)
ALTER TABLE test_segment_schedule ADD COLUMN IF NOT EXISTS emails JSONB DEFAULT '[]';

-- Seed a single inactive row so the service can always do an UPDATE
INSERT INTO test_segment_schedule (id, is_running, next_day_to_send)
VALUES (1, FALSE, 1)
ON CONFLICT (id) DO NOTHING;
