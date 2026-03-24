-- ══════════════════════════════════════════════════════════════════
-- Migration 020: Sync Call Enhancements (18 Mar 2026)
--
-- Phase 1: Segment logic display + new segments + cross-dept routing
-- Phase 2: Extended journeys with conversion goals
-- Phase 3: UTM ↔ Campaign linking
-- Phase 4: AI approval flow improvements
-- ══════════════════════════════════════════════════════════════════

BEGIN;

-- ══════════════════════════════════════════════════════════════════
-- PHASE 1A: Add segment_logic (human-readable filter explanation)
-- ══════════════════════════════════════════════════════════════════

ALTER TABLE segment_definitions ADD COLUMN IF NOT EXISTS segment_logic TEXT;
ALTER TABLE segment_definitions ADD COLUMN IF NOT EXISTS data_sources TEXT[];
ALTER TABLE segment_definitions ADD COLUMN IF NOT EXISTS department_filter TEXT;

-- Populate segment_logic for all 28 existing segments
UPDATE segment_definitions SET segment_logic = CASE segment_name
  WHEN 'Social Ad Leads' THEN 'Clicked a Meta/Google/Instagram ad → never registered or booked. Source: ad click tracking.'
  WHEN 'Website Browsers' THEN 'Visited raynatours.com ≥1 session → never registered or enquired. Source: GA4 BigQuery.'
  WHEN 'WhatsApp First-Touch' THEN 'Sent first WhatsApp message → never registered or booked. Source: WhatsApp chat logs.'
  WHEN 'Fresh Cart Abandoners (0-3 days)' THEN 'Added to cart in last 0-3 days → did not complete checkout. Source: GA4 begin_checkout events.'
  WHEN 'Stale Cart Abandoners (4-14 days)' THEN 'Cart abandoned 4-14 days ago → still no purchase. Source: GA4 begin_checkout without purchase.'
  WHEN 'Active Enquirers' THEN 'Enquired in last 7 days via chat/ticket/WhatsApp → never booked. Source: MySQL chats + tickets.'
  WHEN 'Hesitant Browsers' THEN 'Viewed 5+ products but never enquired or booked. Source: GA4 view_item events.'
  WHEN 'Payment Failed' THEN 'Attempted payment but it failed → booking not completed. Source: GA4 payment_failure events + booking data.'
  WHEN 'Registered Not Booked' THEN 'Created account on raynatours.com → never made a booking. Source: customer registration date vs booking date.'
  WHEN 'New Customers (0-30 days)' THEN 'First booking within last 30 days → still in onboarding window. Source: booking data first_booking_date.'
  WHEN 'Post-Trip Review Window' THEN 'Trip completed in last 7 days → review/feedback window open. Source: booking data trip_end_date.'
  WHEN 'One-Time Buyers (31-90 days)' THEN 'Made exactly 1 booking, 31-90 days ago → ripe for second purchase. Source: booking count + recency.'
  WHEN 'Repeat Buyers' THEN 'Made 2-3 bookings → building loyalty. Source: booking count.'
  WHEN 'Frequent Travelers (4+ bookings)' THEN 'Made 4+ bookings → VIP customer. Source: booking count ≥4.'
  WHEN 'High Spenders (5000+ AED)' THEN 'Total lifetime spend ≥5000 AED → premium segment. Source: booking revenue sum.'
  WHEN 'Visa-Only → Tour Cross-Sell' THEN 'Booked visa service only → never booked a tour. Source: booking data bill_type = visa only.'
  WHEN 'Tour-Only → Visa Cross-Sell' THEN 'Booked tour only → never used visa service. Source: booking data bill_type = tours only.'
  WHEN 'Cooling Down (31-60 days)' THEN 'Last activity 31-60 days ago → engagement dropping. Source: last_active_date recency.'
  WHEN 'At Risk (61-120 days)' THEN 'Last activity 61-120 days ago → high churn risk. Source: last_active_date recency.'
  WHEN 'Hibernating (121-180 days)' THEN 'Last activity 121-180 days ago → nearly lost. Source: last_active_date recency.'
  WHEN 'Lost High-Value (180+ days, 3000+ AED)' THEN 'Inactive 180+ days + lifetime spend ≥3000 AED → lost VIP. Source: recency + revenue.'
  WHEN 'Lost Regular (180+ days, <3000 AED)' THEN 'Inactive 180+ days + lifetime spend <3000 AED → lost regular. Source: recency + revenue.'
  WHEN 'Happy Reviewers (4-5 Stars)' THEN 'Left a 4-5 star review → potential advocate. Source: review data.'
  WHEN 'Social Media Advocates' THEN 'Shared on social media or tagged @raynatours → brand ambassador potential. Source: social tracking.'
  WHEN 'NPS Promoters' THEN 'NPS score 9-10 → highly likely to recommend. Source: NPS survey data.'
  WHEN 'B2B & Corporate' THEN 'Customer type = B2B or Corporate → business account. Source: customer_type field.'
  WHEN 'Birthday Month' THEN 'Birthday falls in current month → celebration opportunity. Source: customer date_of_birth.'
  WHEN 'High Cancellation Risk' THEN 'Cancelled 2+ bookings OR raised refund request → flight risk. Source: cancellation + refund data.'
  ELSE segment_logic
END
WHERE segment_logic IS NULL;

-- Set data_sources
UPDATE segment_definitions SET data_sources = CASE segment_name
  WHEN 'Social Ad Leads' THEN ARRAY['ga4_events', 'utm_tracking']
  WHEN 'Website Browsers' THEN ARRAY['ga4_events', 'ga4_user_profiles']
  WHEN 'WhatsApp First-Touch' THEN ARRAY['mysql_chats']
  WHEN 'Fresh Cart Abandoners (0-3 days)' THEN ARRAY['ga4_events']
  WHEN 'Stale Cart Abandoners (4-14 days)' THEN ARRAY['ga4_events']
  WHEN 'Active Enquirers' THEN ARRAY['mysql_chats', 'mysql_tickets']
  WHEN 'Hesitant Browsers' THEN ARRAY['ga4_events', 'ga4_user_profiles']
  WHEN 'Payment Failed' THEN ARRAY['ga4_events', 'mysql_travel_data']
  WHEN 'Registered Not Booked' THEN ARRAY['customers']
  WHEN 'New Customers (0-30 days)' THEN ARRAY['mysql_travel_data', 'customers']
  WHEN 'Post-Trip Review Window' THEN ARRAY['mysql_travel_data']
  WHEN 'One-Time Buyers (31-90 days)' THEN ARRAY['mysql_travel_data', 'customers']
  WHEN 'Repeat Buyers' THEN ARRAY['mysql_travel_data', 'customers']
  WHEN 'Frequent Travelers (4+ bookings)' THEN ARRAY['mysql_travel_data', 'customers']
  WHEN 'High Spenders (5000+ AED)' THEN ARRAY['mysql_travel_data', 'customers']
  WHEN 'Visa-Only → Tour Cross-Sell' THEN ARRAY['mysql_travel_data']
  WHEN 'Tour-Only → Visa Cross-Sell' THEN ARRAY['mysql_travel_data']
  WHEN 'Cooling Down (31-60 days)' THEN ARRAY['customers']
  WHEN 'At Risk (61-120 days)' THEN ARRAY['customers']
  WHEN 'Hibernating (121-180 days)' THEN ARRAY['customers']
  WHEN 'Lost High-Value (180+ days, 3000+ AED)' THEN ARRAY['customers']
  WHEN 'Lost Regular (180+ days, <3000 AED)' THEN ARRAY['customers']
  WHEN 'Happy Reviewers (4-5 Stars)' THEN ARRAY['mysql_tickets']
  WHEN 'Social Media Advocates' THEN ARRAY['ga4_events', 'utm_tracking']
  WHEN 'NPS Promoters' THEN ARRAY['mysql_tickets']
  WHEN 'B2B & Corporate' THEN ARRAY['customers', 'mysql_contacts']
  WHEN 'Birthday Month' THEN ARRAY['customers']
  WHEN 'High Cancellation Risk' THEN ARRAY['mysql_travel_data', 'mysql_tickets']
  ELSE ARRAY['customers']
END
WHERE data_sources IS NULL;

-- Set department_filter for enquiry-related segments
UPDATE segment_definitions SET department_filter = CASE segment_name
  WHEN 'Active Enquirers' THEN 'All departments — shows which dept the customer connected with'
  WHEN 'Visa-Only → Tour Cross-Sell' THEN 'Visa Dept, Intl Visa Dept'
  WHEN 'Tour-Only → Visa Cross-Sell' THEN 'Tours Dept, Packages Dept'
  WHEN 'B2B & Corporate' THEN 'B2B Sales, MICE & Corporate'
  WHEN 'High Cancellation Risk' THEN 'Cancellations Dept, Refunds Dept'
  ELSE NULL
END;


-- ══════════════════════════════════════════════════════════════════
-- PHASE 1B: New Segments — Holiday/Nationality, Anniversary, B2B Travel Agent
-- ══════════════════════════════════════════════════════════════════

-- Get max segment_number
DO $$
DECLARE
  max_num INT;
  special_stage_id INT;
BEGIN
  SELECT MAX(segment_number) INTO max_num FROM segment_definitions;
  -- Use stage 7 (Special Segments) or create it
  SELECT stage_id INTO special_stage_id FROM funnel_stages WHERE stage_name ILIKE '%special%' OR stage_name ILIKE '%seasonal%';
  IF special_stage_id IS NULL THEN
    INSERT INTO funnel_stages (stage_number, stage_name, stage_description, stage_color)
    VALUES (8, 'Seasonal & Special', 'Time-based and occasion-driven segments', '#e91e63')
    RETURNING stage_id INTO special_stage_id;
  END IF;

  -- Holiday/Nationality segments
  INSERT INTO segment_definitions (segment_number, stage_id, segment_name, segment_description, customer_type, priority, sql_criteria, key_points, segment_logic, data_sources, department_filter)
  VALUES
  (max_num + 1, special_stage_id, 'Diwali Travelers (Indian)',
   'Indian nationality customers — target with Diwali holiday packages in Oct-Nov.',
   'B2C', 'High',
   'nationality = ''Indian'' AND first_booking_date IS NOT NULL',
   '["Send Diwali-themed packages 45 days before", "Family tour packages to Dubai", "Festival of Lights cruise offers"]',
   'Indian nationality customers who have booked before → Diwali holiday opportunity. Source: customer nationality + booking history.',
   ARRAY['customers', 'mysql_travel_data'], NULL),

  (max_num + 2, special_stage_id, 'Christmas Travelers (European)',
   'European nationality customers — target with Christmas/New Year holiday packages in Dec.',
   'B2C', 'High',
   'nationality IN (''British'',''German'',''French'',''Italian'',''Dutch'',''Spanish'',''Russian'') AND first_booking_date IS NOT NULL',
   '["Christmas in Dubai packages", "New Year desert experiences", "Winter sun escape messaging"]',
   'European nationality customers who have booked before → Christmas/NY holiday opportunity. Source: customer nationality + booking history.',
   ARRAY['customers', 'mysql_travel_data'], NULL),

  (max_num + 3, special_stage_id, 'Eid Travelers (GCC/Arab)',
   'GCC/Arab nationality customers — target with Eid al-Fitr and Eid al-Adha packages.',
   'B2C', 'High',
   'nationality IN (''Emirati'',''Saudi'',''Kuwaiti'',''Qatari'',''Bahraini'',''Omani'',''Jordanian'',''Egyptian'',''Lebanese'') AND first_booking_date IS NOT NULL',
   '["Eid family getaway packages", "Umrah + tour combos", "Local staycation offers during Eid"]',
   'GCC/Arab nationality customers who have booked → Eid holiday opportunity. Source: customer nationality.',
   ARRAY['customers', 'mysql_travel_data'], NULL),

  (max_num + 4, special_stage_id, 'Chinese New Year Travelers',
   'Chinese/Southeast Asian nationality customers — target with CNY holiday packages in Jan-Feb.',
   'B2C', 'Medium',
   'nationality IN (''Chinese'',''Malaysian'',''Singaporean'',''Thai'',''Filipino'',''Indonesian'',''Vietnamese'') AND first_booking_date IS NOT NULL',
   '["CNY special tour packages", "Group/family tour deals", "Gold Souk shopping + desert safari combos"]',
   'Chinese/SEA nationality customers → Chinese New Year holiday opportunity. Source: customer nationality.',
   ARRAY['customers', 'mysql_travel_data'], NULL),

  (max_num + 5, special_stage_id, 'Anniversary Customers',
   'Customers whose first booking anniversary is within 30 days — celebrate and re-engage.',
   'B2C', 'Medium',
   'first_booking_date IS NOT NULL AND EXTRACT(MONTH FROM first_booking_date) = EXTRACT(MONTH FROM NOW()) AND EXTRACT(DAY FROM first_booking_date) BETWEEN EXTRACT(DAY FROM NOW()) AND EXTRACT(DAY FROM NOW()) + 30',
   '["Anniversary discount 15% off", "Remind them of their first trip", "Upgrade offer for repeat experience"]',
   'First booking anniversary falls within next 30 days → celebration + re-engage. Source: first_booking_date month/day match.',
   ARRAY['customers', 'mysql_travel_data'], NULL),

  (max_num + 6, special_stage_id, 'B2B Travel Agents',
   'Travel agents who book on behalf of clients — different treatment from B2C.',
   'B2B', 'High',
   'customer_type = ''B2B'' AND total_bookings >= 1',
   '["Agent commission structure", "Bulk booking discounts", "Dedicated account manager", "White-label materials"]',
   'B2B customer type with ≥1 booking → active travel agent. Source: customer_type = B2B + booking count.',
   ARRAY['customers', 'mysql_travel_data', 'mysql_contacts'], 'B2B Sales'),

  (max_num + 7, special_stage_id, 'Summer Vacation Planners',
   'Customers who booked during Jun-Aug in previous years — target early with summer packages.',
   'B2C', 'Medium',
   'first_booking_date IS NOT NULL AND total_bookings >= 1',
   '["Early bird summer deals in April", "Family-friendly packages", "Water park + beach resort combos"]',
   'Historically booked during summer months (Jun-Aug) → early summer targeting. Source: travel_data booking_date month.',
   ARRAY['customers', 'mysql_travel_data'], NULL)

  ON CONFLICT DO NOTHING;

  -- Create strategies for new segments
  INSERT INTO omnichannel_strategies (segment_label, name, status, channels, flow_steps)
  SELECT sd.segment_name,
    CASE sd.segment_name
      WHEN 'Diwali Travelers (Indian)' THEN 'Diwali Campaign'
      WHEN 'Christmas Travelers (European)' THEN 'Christmas Campaign'
      WHEN 'Eid Travelers (GCC/Arab)' THEN 'Eid Campaign'
      WHEN 'Chinese New Year Travelers' THEN 'CNY Campaign'
      WHEN 'Anniversary Customers' THEN 'Anniversary Celebration'
      WHEN 'B2B Travel Agents' THEN 'Agent Retention'
      WHEN 'Summer Vacation Planners' THEN 'Summer Early Bird'
    END,
    'active',
    CASE WHEN sd.customer_type = 'B2B' THEN '{email,whatsapp}'::channel_type[] ELSE '{email,whatsapp,sms}'::channel_type[] END,
    CASE sd.segment_name
      WHEN 'Diwali Travelers (Indian)' THEN '[{"day":0,"channel":"email","action":"Diwali special packages catalog"},{"day":2,"channel":"whatsapp","action":"Family tour bundle offer"},{"day":5,"channel":"sms","action":"Early bird 20% off reminder"},{"day":10,"channel":"email","action":"Last chance Diwali deals"},{"day":15,"channel":"whatsapp","action":"Festival countdown + urgency"}]'::jsonb
      WHEN 'Christmas Travelers (European)' THEN '[{"day":0,"channel":"email","action":"Christmas in Dubai packages"},{"day":3,"channel":"whatsapp","action":"New Year desert safari invite"},{"day":7,"channel":"sms","action":"Winter sun escape 15% off"},{"day":12,"channel":"email","action":"Last-minute Christmas deals"},{"day":18,"channel":"whatsapp","action":"New Year countdown offer"}]'::jsonb
      WHEN 'Eid Travelers (GCC/Arab)' THEN '[{"day":0,"channel":"email","action":"Eid family getaway packages"},{"day":2,"channel":"whatsapp","action":"Eid special staycation offers"},{"day":5,"channel":"sms","action":"Eid Mubarak + exclusive deal"},{"day":8,"channel":"email","action":"Eid al-Adha tour packages"},{"day":12,"channel":"whatsapp","action":"Final Eid booking reminder"}]'::jsonb
      WHEN 'Chinese New Year Travelers' THEN '[{"day":0,"channel":"email","action":"CNY special Dubai packages"},{"day":3,"channel":"whatsapp","action":"Group tour deals for CNY"},{"day":7,"channel":"sms","action":"Gold Souk + desert safari combo"},{"day":14,"channel":"email","action":"Last chance CNY deals"}]'::jsonb
      WHEN 'Anniversary Customers' THEN '[{"day":0,"channel":"email","action":"Happy anniversary + 15% off"},{"day":3,"channel":"whatsapp","action":"Remember your first trip? Rebook!"},{"day":7,"channel":"email","action":"Anniversary upgrade offer"}]'::jsonb
      WHEN 'B2B Travel Agents' THEN '[{"day":0,"channel":"email","action":"Agent commission update + new packages"},{"day":5,"channel":"whatsapp","action":"Bulk booking discount tier info"},{"day":10,"channel":"email","action":"White-label materials + co-branded offers"}]'::jsonb
      WHEN 'Summer Vacation Planners' THEN '[{"day":0,"channel":"email","action":"Early bird summer packages"},{"day":3,"channel":"whatsapp","action":"Family-friendly summer bundles"},{"day":7,"channel":"sms","action":"Water park + beach resort deals"},{"day":14,"channel":"email","action":"Summer countdown + limited availability"}]'::jsonb
    END
  FROM segment_definitions sd
  WHERE sd.segment_name IN ('Diwali Travelers (Indian)', 'Christmas Travelers (European)', 'Eid Travelers (GCC/Arab)', 'Chinese New Year Travelers', 'Anniversary Customers', 'B2B Travel Agents', 'Summer Vacation Planners')
  ON CONFLICT DO NOTHING;

END $$;


-- ══════════════════════════════════════════════════════════════════
-- PHASE 1C: Cross-department lead routing table
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS cross_dept_lead_routing (
  id BIGSERIAL PRIMARY KEY,
  source_department TEXT NOT NULL,
  target_segment TEXT NOT NULL,
  routing_rule TEXT NOT NULL,
  priority INTEGER DEFAULT 5,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO cross_dept_lead_routing (source_department, target_segment, routing_rule, priority) VALUES
  ('Visa Dept', 'Visa-Only → Tour Cross-Sell', 'Visa enquiry completed → push tour recommendation', 1),
  ('Tours Dept', 'Tour-Only → Visa Cross-Sell', 'Tour enquiry completed → push visa service', 1),
  ('Cruises Dept', 'High Spenders (5000+ AED)', 'Cruise enquiry → likely high spender, push premium', 2),
  ('Hotels Dept', 'Visa-Only → Tour Cross-Sell', 'Hotel booking → push tour add-on', 3),
  ('Packages Dept', 'Repeat Buyers', 'Package enquiry from existing customer → loyalty push', 3),
  ('B2B Sales', 'B2B Travel Agents', 'B2B lead from any dept → route to agent segment', 1),
  ('Cancellations Dept', 'High Cancellation Risk', 'Cancellation request → immediate win-back', 1),
  ('Refunds Dept', 'High Cancellation Risk', 'Refund request → flag as cancellation risk', 2),
  ('Events Dept', 'Active Enquirers', 'Event enquiry → treat as active lead', 4),
  ('General', 'Registered Not Booked', 'Generic enquiry with no booking → nurture sequence', 5)
ON CONFLICT DO NOTHING;


-- ══════════════════════════════════════════════════════════════════
-- PHASE 2A: Journey conversion tracking
-- ══════════════════════════════════════════════════════════════════

ALTER TABLE journey_flows ADD COLUMN IF NOT EXISTS conversion_event TEXT DEFAULT 'purchase';
ALTER TABLE journey_flows ADD COLUMN IF NOT EXISTS max_follow_ups INTEGER DEFAULT 10;
ALTER TABLE journey_flows ADD COLUMN IF NOT EXISTS stop_on_conversion BOOLEAN DEFAULT true;
ALTER TABLE journey_flows ADD COLUMN IF NOT EXISTS escalation_after_days INTEGER DEFAULT 14;
ALTER TABLE journey_flows ADD COLUMN IF NOT EXISTS is_looping BOOLEAN DEFAULT false;

-- Journey customer enrollment tracking (which customer is at which node)
CREATE TABLE IF NOT EXISTS journey_enrollments (
  id BIGSERIAL PRIMARY KEY,
  journey_id BIGINT NOT NULL REFERENCES journey_flows(journey_id),
  customer_id BIGINT NOT NULL REFERENCES customers(customer_id),
  current_node_id TEXT,
  status TEXT DEFAULT 'active', -- active, converted, exited, paused
  enrolled_at TIMESTAMPTZ DEFAULT NOW(),
  last_action_at TIMESTAMPTZ,
  next_action_at TIMESTAMPTZ,
  conversion_event TEXT,
  conversion_at TIMESTAMPTZ,
  total_messages_sent INTEGER DEFAULT 0,
  total_messages_opened INTEGER DEFAULT 0,
  total_messages_clicked INTEGER DEFAULT 0,
  exit_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_je_journey ON journey_enrollments(journey_id);
CREATE INDEX IF NOT EXISTS idx_je_customer ON journey_enrollments(customer_id);
CREATE INDEX IF NOT EXISTS idx_je_status ON journey_enrollments(status);
CREATE INDEX IF NOT EXISTS idx_je_next_action ON journey_enrollments(next_action_at) WHERE status = 'active';

-- Journey node execution log
CREATE TABLE IF NOT EXISTS journey_node_log (
  id BIGSERIAL PRIMARY KEY,
  enrollment_id BIGINT REFERENCES journey_enrollments(id),
  journey_id BIGINT REFERENCES journey_flows(journey_id),
  node_id TEXT NOT NULL,
  node_type TEXT NOT NULL,
  action_taken TEXT,
  campaign_id BIGINT REFERENCES campaigns(id),
  result TEXT, -- sent, skipped, failed, condition_true, condition_false
  executed_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_jnl_enrollment ON journey_node_log(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_jnl_campaign ON journey_node_log(campaign_id);


-- ══════════════════════════════════════════════════════════════════
-- PHASE 2B: Link campaigns to journeys
-- ══════════════════════════════════════════════════════════════════

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS journey_id BIGINT REFERENCES journey_flows(journey_id);
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS journey_node_id TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS read_count INTEGER DEFAULT 0;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS click_count INTEGER DEFAULT 0;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS bounce_count INTEGER DEFAULT 0;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS fail_count INTEGER DEFAULT 0;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS conversion_count INTEGER DEFAULT 0;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS revenue_total NUMERIC(12,2) DEFAULT 0;


-- ══════════════════════════════════════════════════════════════════
-- PHASE 3: UTM ↔ Campaign + Content linking
-- ══════════════════════════════════════════════════════════════════

-- Ensure utm_tracking has proper campaign linkage
ALTER TABLE utm_tracking ADD COLUMN IF NOT EXISTS auto_generated BOOLEAN DEFAULT false;
ALTER TABLE utm_tracking ADD COLUMN IF NOT EXISTS content_name TEXT;
ALTER TABLE utm_tracking ADD COLUMN IF NOT EXISTS campaign_name TEXT;

-- Generate UTM links for all campaigns that don't have one
INSERT INTO utm_tracking (campaign_id, template_id, segment_label, channel, base_url, utm_source, utm_medium, utm_campaign, utm_content, full_url, auto_generated, content_name, campaign_name)
SELECT
  c.id AS campaign_id,
  c.template_id,
  c.segment_label,
  c.channel,
  COALESCE(ct.cta_url, 'https://www.raynatours.com/activities') AS base_url,
  'rayna_platform' AS utm_source,
  c.channel::text AS utm_medium,
  LOWER(REGEXP_REPLACE(c.segment_label, '[^a-zA-Z0-9]+', '_', 'g')) AS utm_campaign,
  LOWER(REGEXP_REPLACE(c.name, '[^a-zA-Z0-9]+', '_', 'g')) AS utm_content,
  COALESCE(ct.cta_url, 'https://www.raynatours.com/activities') || '?' ||
    'utm_source=rayna_platform' ||
    '&utm_medium=' || c.channel::text ||
    '&utm_campaign=' || LOWER(REGEXP_REPLACE(c.segment_label, '[^a-zA-Z0-9]+', '_', 'g')) ||
    '&utm_content=' || LOWER(REGEXP_REPLACE(c.name, '[^a-zA-Z0-9]+', '_', 'g'))
  AS full_url,
  true,
  ct.name,
  c.name
FROM campaigns c
LEFT JOIN content_templates ct ON ct.id = c.template_id
WHERE NOT EXISTS (
  SELECT 1 FROM utm_tracking u WHERE u.campaign_id = c.id
)
ON CONFLICT DO NOTHING;


-- ══════════════════════════════════════════════════════════════════
-- PHASE 4: AI Approval enhancements
-- ══════════════════════════════════════════════════════════════════

ALTER TABLE approval_queue ADD COLUMN IF NOT EXISTS ai_analysis JSONB;
ALTER TABLE approval_queue ADD COLUMN IF NOT EXISTS conversion_rate_before NUMERIC(5,2);
ALTER TABLE approval_queue ADD COLUMN IF NOT EXISTS predicted_improvement NUMERIC(5,2);
ALTER TABLE approval_queue ADD COLUMN IF NOT EXISTS auto_approved BOOLEAN DEFAULT false;
ALTER TABLE approval_queue ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ;


COMMIT;
