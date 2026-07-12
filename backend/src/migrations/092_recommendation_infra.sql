-- 092_recommendation_infra.sql
--
-- Additive infrastructure for the "AI recommendation" journeys (on_trip,
-- future_trip, past_trip). Nothing in this migration modifies existing tables
-- or existing rows in a way that changes behavior for existing journeys —
-- the new column on journey_flows defaults NULL, which every existing row
-- resolves to. Renderers only branch into the new path when it's non-NULL.
--
-- Rollback (safe): DROP TABLE user_product_recommendations; DROP FUNCTION _upr_invalidate; DROP TRIGGER … ; ALTER TABLE journey_flows DROP COLUMN recommendation_type;

-- ── 1. New table: precomputed per-user recommendations ─────────────────────
-- One row per (user, recommendation_type). Daily cron refreshes; invalidated
-- when the user's booking changes.
CREATE TABLE IF NOT EXISTS user_product_recommendations (
  id                    BIGSERIAL PRIMARY KEY,
  unified_id            BIGINT      NOT NULL,
  recommendation_type   TEXT        NOT NULL,      -- 'on_trip' | 'future_trip' | 'past_trip'
  based_on_booking_id   BIGINT,                    -- rayna_tours.id (nullable when no linkable booking)
  based_on_product_id   TEXT,                      -- product they booked (excluded from picks)
  destination_city      TEXT,                      -- city the picks are for
  product_ids           JSONB       NOT NULL DEFAULT '[]'::jsonb,   -- ordered [id1..id5]
  source                TEXT,                      -- 'claude' | 'fallback' | 'fallback_no_api_key'
  rationale             TEXT,                      -- Claude's short "why these" line
  computed_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at            TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  CONSTRAINT upr_type_ck CHECK (recommendation_type IN ('on_trip','future_trip','past_trip'))
);

-- One valid row per (user, type). Older rows are DELETEd on refresh so the
-- unique constraint stays clean.
ALTER TABLE user_product_recommendations
  DROP CONSTRAINT IF EXISTS upr_unique;
ALTER TABLE user_product_recommendations
  ADD CONSTRAINT upr_unique UNIQUE (unified_id, recommendation_type);

CREATE INDEX IF NOT EXISTS idx_upr_unified_id     ON user_product_recommendations(unified_id);
CREATE INDEX IF NOT EXISTS idx_upr_expires_at     ON user_product_recommendations(expires_at);
CREATE INDEX IF NOT EXISTS idx_upr_type_expires   ON user_product_recommendations(recommendation_type, expires_at);

-- ── 2. journey_flows.recommendation_type — nullable, defaults NULL ─────────
-- Every existing row stays NULL → existing render/enroll paths see NULL →
-- skip the new logic → behave exactly as today. Only new "REC_*" journeys
-- created via the updated UI will set this.
ALTER TABLE journey_flows
  ADD COLUMN IF NOT EXISTS recommendation_type TEXT;

-- Cheap CHECK to catch typos; NULL is explicitly allowed.
ALTER TABLE journey_flows
  DROP CONSTRAINT IF EXISTS jf_recommendation_type_ck;
ALTER TABLE journey_flows
  ADD CONSTRAINT jf_recommendation_type_ck
    CHECK (recommendation_type IS NULL
        OR recommendation_type IN ('on_trip','future_trip','past_trip'));

CREATE INDEX IF NOT EXISTS idx_jf_recommendation_type
  ON journey_flows(recommendation_type)
  WHERE recommendation_type IS NOT NULL;

-- ── 3. Invalidation trigger on rayna_tours ─────────────────────────────────
-- When a booking arrives/changes for a user, their cached recs are stale
-- (based on prior booking). Delete → next daily cron recomputes.
--
-- Uses AFTER INSERT/UPDATE for minimal contention. Failsafe: swallows any
-- error so a booking insert never fails due to rec-cache cleanup.
CREATE OR REPLACE FUNCTION _upr_invalidate() RETURNS trigger AS $$
BEGIN
  BEGIN
    IF NEW.unified_id IS NOT NULL THEN
      DELETE FROM user_product_recommendations
        WHERE unified_id = NEW.unified_id;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Never block a booking write on rec-cache maintenance.
    NULL;
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_upr_invalidate_rayna_tours ON rayna_tours;
CREATE TRIGGER trg_upr_invalidate_rayna_tours
  AFTER INSERT OR UPDATE OF unified_id, travel_date, service_id, is_cancel
  ON rayna_tours
  FOR EACH ROW EXECUTE FUNCTION _upr_invalidate();

-- (We only wire the trigger to rayna_tours for now — the other RAYNA_TABLES
--  can be added later when we start reading bookings from them too. Keeping
--  it narrow avoids surprising the sync ingestion.)
