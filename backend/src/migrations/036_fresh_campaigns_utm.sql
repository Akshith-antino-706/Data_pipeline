-- 036: Fresh campaigns + UTM tracking for 6-segment decision tree
-- Each segment gets campaigns (one per channel used), each campaign gets a UTM link

-- Ensure columns exist (may be missing if 001 was cached)
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS journey_id BIGINT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS journey_node_id TEXT;
ALTER TABLE utm_tracking ADD COLUMN IF NOT EXISTS campaign_name TEXT;
ALTER TABLE utm_tracking ADD COLUMN IF NOT EXISTS content_name TEXT;
ALTER TABLE utm_tracking ADD COLUMN IF NOT EXISTS auto_generated BOOLEAN DEFAULT false;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='campaigns' AND table_schema='public') THEN TRUNCATE campaigns CASCADE; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='utm_tracking' AND table_schema='public') THEN TRUNCATE utm_tracking CASCADE; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='user_utm_links' AND table_schema='public') THEN TRUNCATE user_utm_links CASCADE; END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- CAMPAIGNS — one per segment per channel
-- ═══════════════════════════════════════════════════════════════

INSERT INTO campaigns (name, strategy_id, segment_label, channel, template_id, status, journey_id) VALUES

-- ON_TRIP campaigns
('On Trip — WhatsApp Upsell',
 (SELECT id FROM omnichannel_strategies WHERE segment_label = 'ON_TRIP'),
 'ON_TRIP', 'whatsapp',
 (SELECT id FROM content_templates WHERE segment_label = 'ON_TRIP' AND channel = 'whatsapp' LIMIT 1),
 'draft',
 (SELECT journey_id FROM journey_flows WHERE name LIKE 'On Trip%' LIMIT 1)),

('On Trip — Email Offers',
 (SELECT id FROM omnichannel_strategies WHERE segment_label = 'ON_TRIP'),
 'ON_TRIP', 'email',
 (SELECT id FROM content_templates WHERE segment_label = 'ON_TRIP' AND channel = 'email' LIMIT 1),
 'draft',
 (SELECT journey_id FROM journey_flows WHERE name LIKE 'On Trip%' LIMIT 1)),

('On Trip — Push Notifications',
 (SELECT id FROM omnichannel_strategies WHERE segment_label = 'ON_TRIP'),
 'ON_TRIP', 'push',
 (SELECT id FROM content_templates WHERE segment_label = 'ON_TRIP' AND channel = 'push' LIMIT 1),
 'draft',
 (SELECT journey_id FROM journey_flows WHERE name LIKE 'On Trip%' LIMIT 1)),

-- FUTURE_TRAVEL campaigns
('Future Travel — WhatsApp Engagement',
 (SELECT id FROM omnichannel_strategies WHERE segment_label = 'FUTURE_TRAVEL'),
 'FUTURE_TRAVEL', 'whatsapp',
 (SELECT id FROM content_templates WHERE segment_label = 'FUTURE_TRAVEL' AND channel = 'whatsapp' LIMIT 1),
 'draft',
 (SELECT journey_id FROM journey_flows WHERE name LIKE 'Future Travel%' LIMIT 1)),

('Future Travel — Email Pre-Trip',
 (SELECT id FROM omnichannel_strategies WHERE segment_label = 'FUTURE_TRAVEL'),
 'FUTURE_TRAVEL', 'email',
 (SELECT id FROM content_templates WHERE segment_label = 'FUTURE_TRAVEL' AND channel = 'email' LIMIT 1),
 'draft',
 (SELECT journey_id FROM journey_flows WHERE name LIKE 'Future Travel%' LIMIT 1)),

('Future Travel — Push Reminders',
 (SELECT id FROM omnichannel_strategies WHERE segment_label = 'FUTURE_TRAVEL'),
 'FUTURE_TRAVEL', 'push',
 (SELECT id FROM content_templates WHERE segment_label = 'FUTURE_TRAVEL' AND channel = 'push' LIMIT 1),
 'draft',
 (SELECT journey_id FROM journey_flows WHERE name LIKE 'Future Travel%' LIMIT 1)),

-- ACTIVE_ENQUIRY campaigns
('Active Enquiry — WhatsApp Conversion',
 (SELECT id FROM omnichannel_strategies WHERE segment_label = 'ACTIVE_ENQUIRY'),
 'ACTIVE_ENQUIRY', 'whatsapp',
 (SELECT id FROM content_templates WHERE segment_label = 'ACTIVE_ENQUIRY' AND channel = 'whatsapp' LIMIT 1),
 'draft',
 (SELECT journey_id FROM journey_flows WHERE name LIKE 'Active Enquiry%' LIMIT 1)),

('Active Enquiry — Email Offers',
 (SELECT id FROM omnichannel_strategies WHERE segment_label = 'ACTIVE_ENQUIRY'),
 'ACTIVE_ENQUIRY', 'email',
 (SELECT id FROM content_templates WHERE segment_label = 'ACTIVE_ENQUIRY' AND channel = 'email' LIMIT 1),
 'draft',
 (SELECT journey_id FROM journey_flows WHERE name LIKE 'Active Enquiry%' LIMIT 1)),

-- PAST_ENQUIRY campaigns
('Past Enquiry — WhatsApp Win Back',
 (SELECT id FROM omnichannel_strategies WHERE segment_label = 'PAST_ENQUIRY'),
 'PAST_ENQUIRY', 'whatsapp',
 (SELECT id FROM content_templates WHERE segment_label = 'PAST_ENQUIRY' AND channel = 'whatsapp' LIMIT 1),
 'draft',
 (SELECT journey_id FROM journey_flows WHERE name LIKE 'Past Enquiry%' LIMIT 1)),

('Past Enquiry — Email Re-Engage',
 (SELECT id FROM omnichannel_strategies WHERE segment_label = 'PAST_ENQUIRY'),
 'PAST_ENQUIRY', 'email',
 (SELECT id FROM content_templates WHERE segment_label = 'PAST_ENQUIRY' AND channel = 'email' LIMIT 1),
 'draft',
 (SELECT journey_id FROM journey_flows WHERE name LIKE 'Past Enquiry%' LIMIT 1)),

-- PAST_BOOKING campaigns
('Past Booking — WhatsApp Loyalty',
 (SELECT id FROM omnichannel_strategies WHERE segment_label = 'PAST_BOOKING'),
 'PAST_BOOKING', 'whatsapp',
 (SELECT id FROM content_templates WHERE segment_label = 'PAST_BOOKING' AND channel = 'whatsapp' LIMIT 1),
 'draft',
 (SELECT journey_id FROM journey_flows WHERE name LIKE 'Past Booking%' LIMIT 1)),

('Past Booking — Email Cross-Sell',
 (SELECT id FROM omnichannel_strategies WHERE segment_label = 'PAST_BOOKING'),
 'PAST_BOOKING', 'email',
 (SELECT id FROM content_templates WHERE segment_label = 'PAST_BOOKING' AND channel = 'email' LIMIT 1),
 'draft',
 (SELECT journey_id FROM journey_flows WHERE name LIKE 'Past Booking%' LIMIT 1)),

-- PROSPECT campaigns
('Prospect — Email Nurture',
 (SELECT id FROM omnichannel_strategies WHERE segment_label = 'PROSPECT'),
 'PROSPECT', 'email',
 (SELECT id FROM content_templates WHERE segment_label = 'PROSPECT' AND channel = 'email' LIMIT 1),
 'draft',
 (SELECT journey_id FROM journey_flows WHERE name LIKE 'Prospect%' LIMIT 1));

-- ═══════════════════════════════════════════════════════════════
-- UTM TRACKING — one per campaign, auto-linked
-- ═══════════════════════════════════════════════════════════════

INSERT INTO utm_tracking (campaign_id, template_id, segment_label, channel, utm_source, utm_medium, utm_campaign, utm_content, full_url, base_url, campaign_name, content_name, auto_generated)
SELECT
  c.id,
  c.template_id,
  c.segment_label,
  c.channel,
  'AI_marketer',
  c.channel::text,
  LOWER(REPLACE(REPLACE(c.segment_label, ' ', '_'), '-', '_')) || '_' || c.channel::text,
  c.channel::text || '_' || c.id,
  'https://www.raynatours.com/activities?utm_source=AI_marketer&utm_medium=' || c.channel::text
    || '&utm_campaign=' || LOWER(REPLACE(REPLACE(c.segment_label, ' ', '_'), '-', '_')) || '_' || c.channel::text
    || '&utm_content=' || c.channel::text || '_' || c.id,
  'https://www.raynatours.com/activities',
  c.name,
  ct.name,
  true
FROM campaigns c
LEFT JOIN content_templates ct ON ct.id = c.template_id;
