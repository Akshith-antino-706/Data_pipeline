-- 088: GTM journey trigger event.
--
-- journey_type (already added) distinguishes 'normal' (segment-based, AI Claude
-- templates — the existing engine) from 'gtm' (event-triggered, per-user email).
-- trigger_event holds the single GTM event name a 'gtm' journey listens to
-- (e.g. 'view_item'). NULL for normal journeys.

ALTER TABLE journey_flows ADD COLUMN IF NOT EXISTS trigger_event TEXT;
