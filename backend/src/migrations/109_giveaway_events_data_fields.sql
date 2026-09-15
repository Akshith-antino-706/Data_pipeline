-- Align giveaway_events with the producer's `data` object (all values are strings).
-- value arrives like "AED 1,200" and expiry format is unknown → store verbatim as TEXT.
-- Add img (11th data key). rank stays INT (parsed defensively on ingest; empty → NULL).
ALTER TABLE giveaway_events ADD COLUMN IF NOT EXISTS img TEXT;
ALTER TABLE giveaway_events ADD COLUMN IF NOT EXISTS giveaway_banner TEXT;
ALTER TABLE giveaway_events ALTER COLUMN value  TYPE TEXT USING value::text;
ALTER TABLE giveaway_events ALTER COLUMN expiry TYPE TEXT USING expiry::text;
