-- 093_daily_category_picks.sql
--
-- Global daily category picks for past-trip AI recommendations.
--
-- Unlike on_trip / future_trip (per-user picks in user_product_recommendations
-- based on each user's booking), past_trip serves GLOBAL top-5 picks per
-- category. Same 5 products shown to every recipient that day.
--
-- Categories: 'activities' | 'holidays' | 'cruises'
--   (mapped to sets of products.category values — see CategoryPicksService.CATEGORY_MAP)
--
-- Rollback: DROP TABLE daily_category_picks;

CREATE TABLE IF NOT EXISTS daily_category_picks (
  id                BIGSERIAL PRIMARY KEY,
  category          TEXT        NOT NULL,      -- 'activities' | 'holidays' | 'cruises'
  computed_date     DATE        NOT NULL,      -- Dubai date this row is for
  product_ids       JSONB       NOT NULL DEFAULT '[]'::jsonb,  -- ordered [id1..id5]
  source            TEXT,                      -- 'claude' | 'fallback_trending' | 'fallback_no_api_key'
  rationale         TEXT,
  candidate_count   INTEGER     DEFAULT 0,
  computed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT dcp_category_ck CHECK (category IN ('activities','holidays','cruises'))
);

ALTER TABLE daily_category_picks DROP CONSTRAINT IF EXISTS dcp_unique;
ALTER TABLE daily_category_picks
  ADD CONSTRAINT dcp_unique UNIQUE (category, computed_date);

CREATE INDEX IF NOT EXISTS idx_dcp_category_date
  ON daily_category_picks(category, computed_date DESC);
