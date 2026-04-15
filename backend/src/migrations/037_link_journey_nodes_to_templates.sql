-- 037: Link journey action nodes to their content templates
-- Each action node gets a templateId so the journey engine knows which template to send

-- Helper: Update a specific node's data in a journey
CREATE OR REPLACE FUNCTION set_node_template(
  p_journey_name TEXT, p_node_id TEXT, p_template_id BIGINT
) RETURNS void AS $$
DECLARE
  i INT;
  node JSONB;
  cur_nodes JSONB;
BEGIN
  SELECT nodes INTO cur_nodes FROM journey_flows WHERE name = p_journey_name;
  IF cur_nodes IS NULL THEN RETURN; END IF;
  FOR i IN 0..jsonb_array_length(cur_nodes) - 1 LOOP
    node := cur_nodes->i;
    IF node->>'id' = p_node_id THEN
      UPDATE journey_flows
        SET nodes = jsonb_set(nodes, ARRAY[i::text, 'data', 'templateId'], to_jsonb(p_template_id))
        WHERE name = p_journey_name;
      RETURN;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════
-- ON_TRIP — Upsell Journey
-- ═══════════════════════════════════════════════════════════════
-- action-1: WhatsApp Welcome → ON_TRIP — Day 0 Welcome (409)
SELECT set_node_template('On Trip — Upsell Journey', 'action-1', (SELECT id FROM content_templates WHERE name = 'ON_TRIP — Day 0 Welcome'));
-- action-2: Push Desert Safari → ON_TRIP — Day 1 Push (410)
SELECT set_node_template('On Trip — Upsell Journey', 'action-2', (SELECT id FROM content_templates WHERE name = 'ON_TRIP — Day 1 Push Notification'));
-- action-3: WhatsApp Check-in → reuse Day 0 Welcome (409) as check-in
SELECT set_node_template('On Trip — Upsell Journey', 'action-3', (SELECT id FROM content_templates WHERE name = 'ON_TRIP — Day 0 Welcome'));
-- action-4: Email 15% off → ON_TRIP — Day 3 Mid-Trip Offer (411)
SELECT set_node_template('On Trip — Upsell Journey', 'action-4', (SELECT id FROM content_templates WHERE name = 'ON_TRIP — Day 3 Mid-Trip Offer'));
-- action-5: WhatsApp Thank you → reuse Day 0 (409)
SELECT set_node_template('On Trip — Upsell Journey', 'action-5', (SELECT id FROM content_templates WHERE name = 'ON_TRIP — Day 0 Welcome'));
-- action-6: WhatsApp Last-minute → ON_TRIP — Day 7 Review Request (413)
SELECT set_node_template('On Trip — Upsell Journey', 'action-6', (SELECT id FROM content_templates WHERE name = 'ON_TRIP — Day 7 Review Request'));
-- action-7: Email Airport transfer → ON_TRIP — Day 6 Airport Transfer (412)
SELECT set_node_template('On Trip — Upsell Journey', 'action-7', (SELECT id FROM content_templates WHERE name = 'ON_TRIP — Day 6 Airport Transfer'));

-- ═══════════════════════════════════════════════════════════════
-- FUTURE_TRAVEL — Pre-Trip Journey
-- ═══════════════════════════════════════════════════════════════
SELECT set_node_template('Future Travel — Pre-Trip Journey', 'action-1', (SELECT id FROM content_templates WHERE name = 'FUTURE_TRAVEL — Pre-Trip Guide'));
SELECT set_node_template('Future Travel — Pre-Trip Journey', 'action-2', (SELECT id FROM content_templates WHERE name = 'FUTURE_TRAVEL — Activity Picks'));
SELECT set_node_template('Future Travel — Pre-Trip Journey', 'action-3', (SELECT id FROM content_templates WHERE name = 'FUTURE_TRAVEL — Pre-Trip Guide'));
SELECT set_node_template('Future Travel — Pre-Trip Journey', 'action-4', (SELECT id FROM content_templates WHERE name = 'FUTURE_TRAVEL — Travel Checklist'));
SELECT set_node_template('Future Travel — Pre-Trip Journey', 'action-5', (SELECT id FROM content_templates WHERE name = 'FUTURE_TRAVEL — Activity Picks'));
SELECT set_node_template('Future Travel — Pre-Trip Journey', 'action-6', (SELECT id FROM content_templates WHERE name = 'FUTURE_TRAVEL — Trip Tomorrow'));

-- ═══════════════════════════════════════════════════════════════
-- ACTIVE_ENQUIRY — Conversion Sprint
-- ═══════════════════════════════════════════════════════════════
SELECT set_node_template('Active Enquiry — Conversion Sprint', 'action-1', (SELECT id FROM content_templates WHERE name = 'ACTIVE_ENQUIRY — Personalised Quote'));
SELECT set_node_template('Active Enquiry — Conversion Sprint', 'action-2', (SELECT id FROM content_templates WHERE name = 'ACTIVE_ENQUIRY — Social Proof'));
SELECT set_node_template('Active Enquiry — Conversion Sprint', 'action-3', (SELECT id FROM content_templates WHERE name = 'ACTIVE_ENQUIRY — 10% Off Offer'));
SELECT set_node_template('Active Enquiry — Conversion Sprint', 'action-4', (SELECT id FROM content_templates WHERE name = 'ACTIVE_ENQUIRY — Urgency'));
SELECT set_node_template('Active Enquiry — Conversion Sprint', 'action-5', (SELECT id FROM content_templates WHERE name = 'ACTIVE_ENQUIRY — Alternatives'));
SELECT set_node_template('Active Enquiry — Conversion Sprint', 'action-6', (SELECT id FROM content_templates WHERE name = 'ACTIVE_ENQUIRY — Final Offer'));

-- ═══════════════════════════════════════════════════════════════
-- PAST_ENQUIRY — Win Back Journey
-- ═══════════════════════════════════════════════════════════════
SELECT set_node_template('Past Enquiry — Win Back Journey', 'action-1', (SELECT id FROM content_templates WHERE name = 'PAST_ENQUIRY — We Missed You'));
SELECT set_node_template('Past Enquiry — Win Back Journey', 'action-2', (SELECT id FROM content_templates WHERE name = 'PAST_ENQUIRY — Trending Now'));
SELECT set_node_template('Past Enquiry — Win Back Journey', 'action-3', (SELECT id FROM content_templates WHERE name = 'PAST_ENQUIRY — 15% Comeback Offer'));
SELECT set_node_template('Past Enquiry — Win Back Journey', 'action-4', (SELECT id FROM content_templates WHERE name = 'PAST_ENQUIRY — We Missed You'));
SELECT set_node_template('Past Enquiry — Win Back Journey', 'action-5', (SELECT id FROM content_templates WHERE name = 'PAST_ENQUIRY — 15% Comeback Offer'));
SELECT set_node_template('Past Enquiry — Win Back Journey', 'action-6', (SELECT id FROM content_templates WHERE name = 'PAST_ENQUIRY — Trending Now'));
SELECT set_node_template('Past Enquiry — Win Back Journey', 'action-7', (SELECT id FROM content_templates WHERE name = 'PAST_ENQUIRY — Final Reminder'));

-- ═══════════════════════════════════════════════════════════════
-- PAST_BOOKING — Cross-Sell & Loyalty
-- ═══════════════════════════════════════════════════════════════
SELECT set_node_template('Past Booking — Cross-Sell & Loyalty', 'action-1', (SELECT id FROM content_templates WHERE name = 'PAST_BOOKING — Review Request'));
SELECT set_node_template('Past Booking — Cross-Sell & Loyalty', 'action-2', (SELECT id FROM content_templates WHERE name = 'PAST_BOOKING — Review + Discount'));
SELECT set_node_template('Past Booking — Cross-Sell & Loyalty', 'action-3', (SELECT id FROM content_templates WHERE name = 'PAST_BOOKING — Cross-Sell'));
SELECT set_node_template('Past Booking — Cross-Sell & Loyalty', 'action-4', (SELECT id FROM content_templates WHERE name = 'PAST_BOOKING — Visa Cross-Sell'));
SELECT set_node_template('Past Booking — Cross-Sell & Loyalty', 'action-5', (SELECT id FROM content_templates WHERE name = 'PAST_BOOKING — Referral Program'));
SELECT set_node_template('Past Booking — Cross-Sell & Loyalty', 'action-6', (SELECT id FROM content_templates WHERE name = 'PAST_BOOKING — Cross-Sell'));
SELECT set_node_template('Past Booking — Cross-Sell & Loyalty', 'action-7', (SELECT id FROM content_templates WHERE name = 'PAST_BOOKING — Loyalty Discount'));

-- ═══════════════════════════════════════════════════════════════
-- PROSPECT — Awareness Nurture
-- ═══════════════════════════════════════════════════════════════
SELECT set_node_template('Prospect — Awareness Nurture', 'action-1', (SELECT id FROM content_templates WHERE name = 'PROSPECT — Welcome Email'));
SELECT set_node_template('Prospect — Awareness Nurture', 'action-2', (SELECT id FROM content_templates WHERE name = 'PROSPECT — Top Experiences'));
SELECT set_node_template('Prospect — Awareness Nurture', 'action-3', (SELECT id FROM content_templates WHERE name = 'PROSPECT — Social Proof'));
SELECT set_node_template('Prospect — Awareness Nurture', 'action-4', (SELECT id FROM content_templates WHERE name = 'PROSPECT — First Booking Offer'));
SELECT set_node_template('Prospect — Awareness Nurture', 'action-5', (SELECT id FROM content_templates WHERE name = 'PROSPECT — Top Experiences'));
SELECT set_node_template('Prospect — Awareness Nurture', 'action-6', (SELECT id FROM content_templates WHERE name = 'PROSPECT — First Booking Offer'));

-- Cleanup helper function
DROP FUNCTION set_node_template(TEXT, TEXT, BIGINT);
