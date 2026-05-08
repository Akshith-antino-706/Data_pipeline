-- 054: Replace legacy content_templates with the 7 day-templates that serve all segmentations.
--
-- Why: The Content/Templates UI was listing 29 legacy seeded rows from migration 035
-- (ON_TRIP / FUTURE_TRAVEL / ACTIVE_ENQUIRY / PAST_ENQUIRY / PAST_BOOKING / PROSPECT). The
-- production journey now uses only the 7 file-based, server-rendered Day 1..Day 7 templates
-- (mail_templates/dayN-*-dynamic.html, rendered by Day{N}*Renderer.js). This migration
-- nulls dependent FKs, deletes the legacy rows, and inserts 7 representative rows so the
-- Content UI lists exactly the templates that actually get sent.
--
-- The body field for each new row is a brief descriptor + pointer to the renderer/template
-- file pair. Actual sends bypass content_templates.body and use the file-based renderer
-- directly. Editing body in the UI will NOT affect produced emails until the rendering
-- pipeline is rewired to read from DB.

BEGIN;

-- 1. Null out FKs on dependent tables so the cascade-less deletes succeed
UPDATE campaigns      SET template_id = NULL WHERE template_id IS NOT NULL;
UPDATE message_log    SET template_id = NULL WHERE template_id IS NOT NULL;
UPDATE utm_tracking   SET template_id = NULL WHERE template_id IS NOT NULL;

-- 2. Self-FK on content_templates (parent_id) — null first to allow row deletion
UPDATE content_templates SET parent_id = NULL WHERE parent_id IS NOT NULL;

-- 3. Wipe legacy rows
DELETE FROM content_templates;

-- 4. Reset id sequence so the 7 new rows get clean ids 1..7
SELECT setval(pg_get_serial_sequence('content_templates', 'id'), 1, false);

-- 5. Insert 7 day-template rows. status='approved' so they pass any approval filter.
--    segment_label = 'ALL' since these templates serve every segment per project decision.
INSERT INTO content_templates (name, channel, status, segment_label, subject, body, cta_url, cta_text, variables) VALUES

('Day 1 - Welcome to Rayna Tours',
 'email', 'approved', 'ALL',
 'Day 1 - Welcome to Rayna Tours',
 'Server-rendered template. Source: mail_templates/day1-welcome-dynamic.html · Renderer: backend/src/services/Day1WelcomeRenderer.js · Hero, 4-category strip (Holidays/Cruises/Visas/Activities), our-promise 3-up, ratings 2x2.',
 'https://www.raynatours.com',
 'Explore',
 ARRAY['first_name', 'unified_id']),

('Day 2 - Cruise Spotlight',
 'email', 'approved', 'ALL',
 'Day 2 - Cruise Spotlight',
 'Server-rendered template. Source: mail_templates/day2-cruise-dynamic.html · Renderer: backend/src/services/Day2CruiseRenderer.js · Hero cruise, 5 saver cruise packages, departure-city 2x2, regional cruise picks, fleet logos.',
 'https://www.raynatours.com/cruises',
 'Explore Cruises',
 ARRAY['first_name', 'unified_id']),

('Day 3 - Visa Made Easy',
 'email', 'approved', 'ALL',
 'Day 3 - Visa Made Easy',
 'Server-rendered template. Source: mail_templates/day3-visa-dynamic.html · Renderer: backend/src/services/Day3VisaRenderer.js · International visa cards 2-up, popular destinations 4-up, eVisa rows, our-promise 3-up.',
 'https://www.raynatours.com/visas',
 'Apply Now',
 ARRAY['first_name', 'unified_id']),

('Day 4 - Dream Holidays',
 'email', 'approved', 'ALL',
 'Day 4 - Dream Holidays',
 'Server-rendered template. Source: mail_templates/day4-holidays-dynamic.html · Renderer: backend/src/services/Day4HolidaysRenderer.js · Summer Escapes / Eid Packages / Romantic Holidays / Adventure 2x2 grids, exclusive Eid offer, our-promise, ratings 2x2.',
 'https://www.raynatours.com/holidays',
 'View Package',
 ARRAY['first_name', 'unified_id']),

('Day 5 - Top Activities',
 'email', 'approved', 'ALL',
 'Day 5 - Top Activities',
 'Server-rendered template. Source: mail_templates/day5-activities-dynamic.html · Renderer: backend/src/services/Day5ActivitiesRenderer.js · 6 activity sections (Top Cities/Thrill/Family Fun/Must-Visit/Cruises & Waterparks/Wildlife) 2x2 grids, perk strip, our-promise, ratings 2x2.',
 'https://www.raynatours.com/activities',
 'Explore',
 ARRAY['first_name', 'unified_id']),

('Day 6 - Destination Spotlight',
 'email', 'approved', 'ALL',
 'Day 6 - Destination Spotlight',
 'Server-rendered template. Source: mail_templates/day6-destination-dynamic.html · Renderer: backend/src/services/Day6DestinationRenderer.js · Destination hero, holiday packages, top things to do, cruises, dark closing CTA, our-promise, ratings 2x2.',
 'https://www.raynatours.com',
 'Plan My Trip',
 ARRAY['first_name', 'unified_id', 'destination']),

('Day 7 - You Left Something Behind',
 'email', 'approved', 'ALL',
 'Day 7 - You Left Something Behind',
 'Server-rendered template. Source: mail_templates/day7-abandoned-cart-dynamic.html · Renderer: backend/src/services/Day7AbandonedCartRenderer.js · Abandoned-cart hero, abandoned product cards 2-up, trust platforms 2x2 on mobile, final CTA strip.',
 'https://www.raynatours.com/cart',
 'Complete Booking',
 ARRAY['first_name', 'unified_id', 'cart_items']);

COMMIT;
