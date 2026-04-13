-- 034: Fresh strategies & journeys aligned with 3-step decision tree segmentation
-- Clears old 28-segment model and replaces with 6 booking-status segments

-- ── Step 1: Clean old data ─────────────────────────────────────
TRUNCATE journey_events CASCADE;
TRUNCATE journey_entries CASCADE;
TRUNCATE journey_flows CASCADE;
TRUNCATE omnichannel_strategies CASCADE;
TRUNCATE segment_customers CASCADE;
TRUNCATE segment_definitions CASCADE;
TRUNCATE funnel_stages CASCADE;

-- ── Step 2: Fresh funnel stages (maps to booking lifecycle) ────
INSERT INTO funnel_stages (stage_number, stage_name, stage_description, stage_color) VALUES
  (1, 'Active Travellers',   'Customers currently on trip or with upcoming travel',     '#22c55e'),
  (2, 'Enquiry Pipeline',    'Customers who have enquired but not yet booked',          '#f59e0b'),
  (3, 'Past Customers',      'Customers with completed bookings — cross-sell & rebook', '#8b5cf6'),
  (4, 'Prospects',           'Contacts who have never engaged with Rayna',              '#64748b');

-- ── Step 3: Fresh segment definitions (6 segments) ─────────────
INSERT INTO segment_definitions (segment_number, stage_id, segment_name, segment_description, customer_type, priority, sql_criteria, key_points) VALUES

-- Stage 1: Active Travellers
(1, (SELECT stage_id FROM funnel_stages WHERE stage_number = 1),
 'ON_TRIP', 'Currently travelling — travel date to travel date + 7 days',
 'B2C', 'Critical',
 $$booking_status = 'ON_TRIP'$$,
 '["Upsell local activities & experiences","Send destination tips & weather updates","Offer upgrade opportunities","Provide 24/7 support contact","Cross-sell transfer & dining"]'::jsonb),

(2, (SELECT stage_id FROM funnel_stages WHERE stage_number = 1),
 'FUTURE_TRAVEL', 'Booked but travel date is still ahead',
 'B2C', 'High',
 $$booking_status = 'FUTURE_TRAVEL'$$,
 '["Build excitement with destination content","Upsell add-ons (tours, transfers, visas)","Send pre-trip checklist & packing tips","Offer travel insurance & airport services","Share itinerary planning tools"]'::jsonb),

-- Stage 2: Enquiry Pipeline
(3, (SELECT stage_id FROM funnel_stages WHERE stage_number = 2),
 'ACTIVE_ENQUIRY', 'Chatted on WhatsApp in last 30 days but not booked',
 'B2C', 'Critical',
 $$booking_status = 'ACTIVE_ENQUIRY'$$,
 '["Send personalised offer within 2 hours","Share social proof & reviews","Create urgency with limited availability","Offer first-booking discount","Follow up with alternative options"]'::jsonb),

(4, (SELECT stage_id FROM funnel_stages WHERE stage_number = 2),
 'PAST_ENQUIRY', 'Enquired 30+ days ago, never converted to booking',
 'B2C', 'Medium',
 $$booking_status = 'PAST_ENQUIRY'$$,
 '["Re-engage with new seasonal offers","Share trending destinations & deals","Send win-back coupon code","Highlight new products since last enquiry","Use social proof from similar travellers"]'::jsonb),

-- Stage 3: Past Customers
(5, (SELECT stage_id FROM funnel_stages WHERE stage_number = 3),
 'PAST_BOOKING', 'Completed past trips — cross-sell & rebook opportunity',
 'B2C', 'High',
 $$booking_status = 'PAST_BOOKING'$$,
 '["Request review within 3 days of trip end","Cross-sell complementary services","Offer loyalty/repeat booking discount","Send personalised destination recommendations","Invite to referral program"]'::jsonb),

-- Stage 4: Prospects
(6, (SELECT stage_id FROM funnel_stages WHERE stage_number = 4),
 'PROSPECT', 'Never engaged with Rayna — awareness & acquisition',
 'B2C', 'Low',
 $$booking_status = 'PROSPECT'$$,
 '["Send welcome & brand introduction","Share top destinations & experiences","Offer first-time booking incentive","Highlight unique selling points","Drive to website with compelling CTAs"]'::jsonb);

-- ── Step 4: Fresh strategies (one per segment) ─────────────────

INSERT INTO omnichannel_strategies (name, description, segment_label, channels, status, flow_steps) VALUES

-- 1. ON_TRIP
('On Trip — Upsell & Support',
 'Engage customers during their trip with local activities, upgrades, and support.',
 'ON_TRIP', ARRAY['whatsapp','email','push']::channel_type[], 'active',
 '[
   {"day":0,"channel":"whatsapp","action":"Welcome to Dubai! Here are today''s top activities near you","type":"message"},
   {"day":1,"channel":"push","action":"Don''t miss: Desert Safari with BBQ dinner — limited spots today","type":"notification"},
   {"day":2,"channel":"whatsapp","action":"How''s your trip? Need any help with transfers or bookings?","type":"message"},
   {"day":3,"channel":"email","action":"Exclusive mid-trip offer: 15% off any activity booked today","type":"offer","conditions":{"if_not":"booked_activity"}},
   {"day":5,"channel":"whatsapp","action":"2 days left! Top experiences you haven''t tried yet","type":"recommendation"},
   {"day":6,"channel":"email","action":"Leaving soon? Book airport transfer & last-minute experiences","type":"urgency"},
   {"day":7,"channel":"whatsapp","action":"Hope you had an amazing trip! Share your experience for 10% off next visit","type":"review_request"}
 ]'::jsonb),

-- 2. FUTURE_TRAVEL
('Future Travel — Pre-Trip Engagement',
 'Build excitement and upsell add-ons before the customer travels.',
 'FUTURE_TRAVEL', ARRAY['email','whatsapp']::channel_type[], 'active',
 '[
   {"day":0,"channel":"email","action":"Your trip is coming up! Here''s your personalised pre-trip guide","type":"content"},
   {"day":2,"channel":"whatsapp","action":"Have you planned your activities yet? Top picks for your destination","type":"recommendation"},
   {"day":4,"channel":"email","action":"Add these must-do experiences to your itinerary","type":"cross_sell","conditions":{"if_not":"has_tour_booking"}},
   {"day":6,"channel":"email","action":"Travel checklist: visa, insurance, transfers — all sorted?","type":"checklist"},
   {"day":8,"channel":"whatsapp","action":"Need airport pickup? Book your transfer now","type":"upsell","conditions":{"if_not":"has_transfer"}},
   {"day":10,"channel":"email","action":"5 insider tips for your destination from our travel experts","type":"content"},
   {"day":12,"channel":"whatsapp","action":"Almost time! Weather forecast & what to pack","type":"content"},
   {"day":14,"channel":"push","action":"Your trip starts tomorrow! Everything you need in one place","type":"reminder"}
 ]'::jsonb),

-- 3. ACTIVE_ENQUIRY
('Active Enquiry — Convert to Booking',
 'Fast follow-up to convert recent WhatsApp enquiries into bookings.',
 'ACTIVE_ENQUIRY', ARRAY['whatsapp','email']::channel_type[], 'active',
 '[
   {"day":0,"channel":"whatsapp","action":"Thanks for your enquiry! Here''s a personalised quote based on what you asked","type":"quote"},
   {"day":1,"channel":"whatsapp","action":"Customers who booked this loved it — 4.8 star reviews","type":"social_proof","conditions":{"if_not":"booked"}},
   {"day":2,"channel":"email","action":"Your dream trip is waiting — complete your booking with 10% off","type":"offer","conditions":{"if_not":"booked"}},
   {"day":3,"channel":"whatsapp","action":"Only 3 spots left for this experience — book now to secure yours","type":"urgency","conditions":{"if_not":"booked"}},
   {"day":5,"channel":"email","action":"Still thinking? Here are similar experiences you might love","type":"alternatives","conditions":{"if_not":"booked"}},
   {"day":7,"channel":"whatsapp","action":"Last chance: your 10% discount expires today","type":"final_offer","conditions":{"if_not":"booked"}}
 ]'::jsonb),

-- 4. PAST_ENQUIRY
('Past Enquiry — Win Back',
 'Re-engage customers who enquired 30+ days ago but never booked.',
 'PAST_ENQUIRY', ARRAY['email','whatsapp']::channel_type[], 'active',
 '[
   {"day":0,"channel":"email","action":"We missed you! New experiences & deals since your last visit","type":"re_engage"},
   {"day":3,"channel":"email","action":"Trending now: Top 5 experiences our customers are loving","type":"inspiration"},
   {"day":7,"channel":"whatsapp","action":"Special comeback offer: 15% off your first booking — just for you","type":"win_back_offer"},
   {"day":10,"channel":"email","action":"Did you know? We now offer holidays, cruises & visa services too","type":"awareness","conditions":{"if_not":"clicked"}},
   {"day":14,"channel":"email","action":"Your friends are travelling — join them with our group deals","type":"social_proof"},
   {"day":21,"channel":"whatsapp","action":"Final reminder: Your 15% welcome-back code expires in 48 hours","type":"final_offer","conditions":{"if_not":"booked"}}
 ]'::jsonb),

-- 5. PAST_BOOKING
('Past Booking — Cross-Sell & Loyalty',
 'Engage past customers with reviews, cross-sell, referrals, and rebook offers.',
 'PAST_BOOKING', ARRAY['email','whatsapp']::channel_type[], 'active',
 '[
   {"day":1,"channel":"whatsapp","action":"How was your experience? We''d love your honest review","type":"review_request"},
   {"day":3,"channel":"email","action":"Rate your trip & get 10% off your next booking","type":"review_incentive","conditions":{"if_not":"reviewed"}},
   {"day":7,"channel":"email","action":"Loved your tour? You might also enjoy these experiences","type":"cross_sell"},
   {"day":10,"channel":"whatsapp","action":"Need a visa for your next trip? We handle it end-to-end","type":"cross_sell","conditions":{"if_not":"has_visa_booking"}},
   {"day":14,"channel":"email","action":"Refer a friend & both get AED 50 off your next trip","type":"referral"},
   {"day":21,"channel":"email","action":"Planning your next adventure? Early-bird deals just for you","type":"rebook"},
   {"day":28,"channel":"whatsapp","action":"Your loyalty discount is waiting — 12% off any experience this month","type":"loyalty_offer","conditions":{"if_not":"booked"}}
 ]'::jsonb),

-- 6. PROSPECT
('Prospect — Awareness & First Booking',
 'Introduce Rayna Tours to new prospects and drive first booking.',
 'PROSPECT', ARRAY['email']::channel_type[], 'active',
 '[
   {"day":0,"channel":"email","action":"Welcome to Rayna Tours — Dubai''s #1 travel experience platform","type":"welcome"},
   {"day":3,"channel":"email","action":"Top 10 must-do experiences in Dubai & Abu Dhabi","type":"inspiration"},
   {"day":6,"channel":"email","action":"First-time traveller? Here''s why 500,000+ customers trust us","type":"social_proof"},
   {"day":9,"channel":"email","action":"Exclusive first-booking offer: 20% off any activity","type":"first_booking_offer","conditions":{"if_not":"booked"}},
   {"day":12,"channel":"email","action":"Holiday packages, desert safaris, yacht cruises — explore all","type":"catalog"},
   {"day":14,"channel":"email","action":"Your 20% first-booking discount expires tomorrow","type":"urgency","conditions":{"if_not":"booked"}}
 ]'::jsonb);

-- ── Step 5: Fresh journeys (one per segment) ───────────────────

INSERT INTO journey_flows (name, description, status, nodes, edges, goal_type, goal_value) VALUES

-- Journey 1: ON_TRIP
('On Trip — Upsell Journey',
 'Engage customers during their 7-day trip with activities, upgrades, and support.', 'active',
 '[{"id":"trigger-1","type":"trigger","position":{"x":250,"y":0},"data":{"label":"Customer starts trip","triggerType":"segment_entry","segmentLabel":"ON_TRIP"}},{"id":"action-1","type":"action","position":{"x":250,"y":100},"data":{"label":"WhatsApp: Welcome + activities","channel":"whatsapp"}},{"id":"wait-1","type":"wait","position":{"x":250,"y":200},"data":{"label":"Wait 1 day","waitDays":1}},{"id":"action-2","type":"action","position":{"x":250,"y":300},"data":{"label":"Push: Desert Safari offer","channel":"push"}},{"id":"wait-2","type":"wait","position":{"x":250,"y":400},"data":{"label":"Wait 1 day","waitDays":1}},{"id":"action-3","type":"action","position":{"x":250,"y":500},"data":{"label":"WhatsApp: Check-in","channel":"whatsapp"}},{"id":"wait-3","type":"wait","position":{"x":250,"y":600},"data":{"label":"Wait 1 day","waitDays":1}},{"id":"condition-1","type":"condition","position":{"x":250,"y":700},"data":{"label":"Booked activity?","condition":"booked_activity"}},{"id":"action-4","type":"action","position":{"x":100,"y":800},"data":{"label":"Email: 15% off","channel":"email"}},{"id":"action-5","type":"action","position":{"x":400,"y":800},"data":{"label":"WhatsApp: Thank you","channel":"whatsapp"}},{"id":"wait-4","type":"wait","position":{"x":250,"y":900},"data":{"label":"Wait 2 days","waitDays":2}},{"id":"action-6","type":"action","position":{"x":250,"y":1000},"data":{"label":"WhatsApp: Last-minute tips","channel":"whatsapp"}},{"id":"action-7","type":"action","position":{"x":250,"y":1100},"data":{"label":"Email: Airport transfer","channel":"email"}},{"id":"goal-1","type":"goal","position":{"x":250,"y":1200},"data":{"label":"Trip completed + upsold","goalType":"booking"}}]'::jsonb,
 '[{"id":"e1","source":"trigger-1","target":"action-1"},{"id":"e2","source":"action-1","target":"wait-1"},{"id":"e3","source":"wait-1","target":"action-2"},{"id":"e4","source":"action-2","target":"wait-2"},{"id":"e5","source":"wait-2","target":"action-3"},{"id":"e6","source":"action-3","target":"wait-3"},{"id":"e7","source":"wait-3","target":"condition-1"},{"id":"e8","source":"condition-1","target":"action-4","label":"No"},{"id":"e9","source":"condition-1","target":"action-5","label":"Yes"},{"id":"e10","source":"action-4","target":"wait-4"},{"id":"e11","source":"action-5","target":"wait-4"},{"id":"e12","source":"wait-4","target":"action-6"},{"id":"e13","source":"action-6","target":"action-7"},{"id":"e14","source":"action-7","target":"goal-1"}]'::jsonb,
 'booking', 'upsell_during_trip'),

-- Journey 2: FUTURE_TRAVEL
('Future Travel — Pre-Trip Journey',
 'Build excitement and upsell add-ons in the 14 days before travel.', 'active',
 '[{"id":"trigger-1","type":"trigger","position":{"x":250,"y":0},"data":{"label":"Future booking detected","triggerType":"segment_entry","segmentLabel":"FUTURE_TRAVEL"}},{"id":"action-1","type":"action","position":{"x":250,"y":100},"data":{"label":"Email: Pre-trip guide","channel":"email"}},{"id":"wait-1","type":"wait","position":{"x":250,"y":200},"data":{"label":"Wait 2 days","waitDays":2}},{"id":"action-2","type":"action","position":{"x":250,"y":300},"data":{"label":"WhatsApp: Activity picks","channel":"whatsapp"}},{"id":"wait-2","type":"wait","position":{"x":250,"y":400},"data":{"label":"Wait 2 days","waitDays":2}},{"id":"action-3","type":"action","position":{"x":250,"y":500},"data":{"label":"Email: Must-do experiences","channel":"email"}},{"id":"wait-3","type":"wait","position":{"x":250,"y":600},"data":{"label":"Wait 2 days","waitDays":2}},{"id":"action-4","type":"action","position":{"x":250,"y":700},"data":{"label":"Email: Travel checklist","channel":"email"}},{"id":"wait-4","type":"wait","position":{"x":250,"y":800},"data":{"label":"Wait 2 days","waitDays":2}},{"id":"action-5","type":"action","position":{"x":250,"y":900},"data":{"label":"WhatsApp: Airport transfer","channel":"whatsapp"}},{"id":"wait-5","type":"wait","position":{"x":250,"y":1000},"data":{"label":"Wait 4 days","waitDays":4}},{"id":"action-6","type":"action","position":{"x":250,"y":1100},"data":{"label":"Push: Trip tomorrow","channel":"push"}},{"id":"goal-1","type":"goal","position":{"x":250,"y":1200},"data":{"label":"Add-on booked","goalType":"booking"}}]'::jsonb,
 '[{"id":"e1","source":"trigger-1","target":"action-1"},{"id":"e2","source":"action-1","target":"wait-1"},{"id":"e3","source":"wait-1","target":"action-2"},{"id":"e4","source":"action-2","target":"wait-2"},{"id":"e5","source":"wait-2","target":"action-3"},{"id":"e6","source":"action-3","target":"wait-3"},{"id":"e7","source":"wait-3","target":"action-4"},{"id":"e8","source":"action-4","target":"wait-4"},{"id":"e9","source":"wait-4","target":"action-5"},{"id":"e10","source":"action-5","target":"wait-5"},{"id":"e11","source":"wait-5","target":"action-6"},{"id":"e12","source":"action-6","target":"goal-1"}]'::jsonb,
 'booking', 'addon_before_trip'),

-- Journey 3: ACTIVE_ENQUIRY
('Active Enquiry — Conversion Sprint',
 'Fast 7-day follow-up to convert WhatsApp enquiries into bookings.', 'active',
 '[{"id":"trigger-1","type":"trigger","position":{"x":250,"y":0},"data":{"label":"WhatsApp enquiry received","triggerType":"segment_entry","segmentLabel":"ACTIVE_ENQUIRY"}},{"id":"action-1","type":"action","position":{"x":250,"y":100},"data":{"label":"WhatsApp: Personalised quote","channel":"whatsapp"}},{"id":"wait-1","type":"wait","position":{"x":250,"y":200},"data":{"label":"Wait 1 day","waitDays":1}},{"id":"condition-1","type":"condition","position":{"x":250,"y":300},"data":{"label":"Booked?","condition":"booked"}},{"id":"action-2","type":"action","position":{"x":100,"y":400},"data":{"label":"WhatsApp: Social proof","channel":"whatsapp"}},{"id":"goal-1","type":"goal","position":{"x":400,"y":400},"data":{"label":"Converted!","goalType":"booking"}},{"id":"wait-2","type":"wait","position":{"x":100,"y":500},"data":{"label":"Wait 1 day","waitDays":1}},{"id":"action-3","type":"action","position":{"x":100,"y":600},"data":{"label":"Email: 10% off offer","channel":"email"}},{"id":"wait-3","type":"wait","position":{"x":100,"y":700},"data":{"label":"Wait 1 day","waitDays":1}},{"id":"action-4","type":"action","position":{"x":100,"y":800},"data":{"label":"WhatsApp: Urgency","channel":"whatsapp"}},{"id":"wait-4","type":"wait","position":{"x":100,"y":900},"data":{"label":"Wait 2 days","waitDays":2}},{"id":"action-5","type":"action","position":{"x":100,"y":1000},"data":{"label":"Email: Alternatives","channel":"email"}},{"id":"wait-5","type":"wait","position":{"x":100,"y":1100},"data":{"label":"Wait 2 days","waitDays":2}},{"id":"action-6","type":"action","position":{"x":100,"y":1200},"data":{"label":"WhatsApp: Final offer","channel":"whatsapp"}},{"id":"goal-2","type":"goal","position":{"x":100,"y":1300},"data":{"label":"Converted or exited","goalType":"booking"}}]'::jsonb,
 '[{"id":"e1","source":"trigger-1","target":"action-1"},{"id":"e2","source":"action-1","target":"wait-1"},{"id":"e3","source":"wait-1","target":"condition-1"},{"id":"e4","source":"condition-1","target":"action-2","label":"No"},{"id":"e5","source":"condition-1","target":"goal-1","label":"Yes"},{"id":"e6","source":"action-2","target":"wait-2"},{"id":"e7","source":"wait-2","target":"action-3"},{"id":"e8","source":"action-3","target":"wait-3"},{"id":"e9","source":"wait-3","target":"action-4"},{"id":"e10","source":"action-4","target":"wait-4"},{"id":"e11","source":"wait-4","target":"action-5"},{"id":"e12","source":"action-5","target":"wait-5"},{"id":"e13","source":"wait-5","target":"action-6"},{"id":"e14","source":"action-6","target":"goal-2"}]'::jsonb,
 'booking', 'convert_enquiry'),

-- Journey 4: PAST_ENQUIRY
('Past Enquiry — Win Back Journey',
 'Re-engage customers who enquired 30+ days ago but never booked.', 'active',
 '[{"id":"trigger-1","type":"trigger","position":{"x":250,"y":0},"data":{"label":"Enquiry gone cold","triggerType":"segment_entry","segmentLabel":"PAST_ENQUIRY"}},{"id":"action-1","type":"action","position":{"x":250,"y":100},"data":{"label":"Email: We missed you","channel":"email"}},{"id":"wait-1","type":"wait","position":{"x":250,"y":200},"data":{"label":"Wait 3 days","waitDays":3}},{"id":"action-2","type":"action","position":{"x":250,"y":300},"data":{"label":"Email: Trending experiences","channel":"email"}},{"id":"wait-2","type":"wait","position":{"x":250,"y":400},"data":{"label":"Wait 4 days","waitDays":4}},{"id":"action-3","type":"action","position":{"x":250,"y":500},"data":{"label":"WhatsApp: 15% comeback offer","channel":"whatsapp"}},{"id":"wait-3","type":"wait","position":{"x":250,"y":600},"data":{"label":"Wait 3 days","waitDays":3}},{"id":"condition-1","type":"condition","position":{"x":250,"y":700},"data":{"label":"Clicked any link?","condition":"clicked"}},{"id":"action-4","type":"action","position":{"x":100,"y":800},"data":{"label":"Email: Full catalog","channel":"email"}},{"id":"action-5","type":"action","position":{"x":400,"y":800},"data":{"label":"WhatsApp: Personal follow-up","channel":"whatsapp"}},{"id":"wait-4","type":"wait","position":{"x":250,"y":900},"data":{"label":"Wait 4 days","waitDays":4}},{"id":"action-6","type":"action","position":{"x":250,"y":1000},"data":{"label":"Email: Social proof","channel":"email"}},{"id":"wait-5","type":"wait","position":{"x":250,"y":1100},"data":{"label":"Wait 7 days","waitDays":7}},{"id":"action-7","type":"action","position":{"x":250,"y":1200},"data":{"label":"WhatsApp: Final reminder","channel":"whatsapp"}},{"id":"goal-1","type":"goal","position":{"x":250,"y":1300},"data":{"label":"Won back","goalType":"booking"}}]'::jsonb,
 '[{"id":"e1","source":"trigger-1","target":"action-1"},{"id":"e2","source":"action-1","target":"wait-1"},{"id":"e3","source":"wait-1","target":"action-2"},{"id":"e4","source":"action-2","target":"wait-2"},{"id":"e5","source":"wait-2","target":"action-3"},{"id":"e6","source":"action-3","target":"wait-3"},{"id":"e7","source":"wait-3","target":"condition-1"},{"id":"e8","source":"condition-1","target":"action-4","label":"No"},{"id":"e9","source":"condition-1","target":"action-5","label":"Yes"},{"id":"e10","source":"action-4","target":"wait-4"},{"id":"e11","source":"action-5","target":"wait-4"},{"id":"e12","source":"wait-4","target":"action-6"},{"id":"e13","source":"action-6","target":"wait-5"},{"id":"e14","source":"wait-5","target":"action-7"},{"id":"e15","source":"action-7","target":"goal-1"}]'::jsonb,
 'booking', 'win_back_enquiry'),

-- Journey 5: PAST_BOOKING
('Past Booking — Cross-Sell & Loyalty',
 'Engage past customers with reviews, cross-sell, referrals, and rebook offers over 30 days.', 'active',
 '[{"id":"trigger-1","type":"trigger","position":{"x":250,"y":0},"data":{"label":"Trip completed","triggerType":"segment_entry","segmentLabel":"PAST_BOOKING"}},{"id":"action-1","type":"action","position":{"x":250,"y":100},"data":{"label":"WhatsApp: Review request","channel":"whatsapp"}},{"id":"wait-1","type":"wait","position":{"x":250,"y":200},"data":{"label":"Wait 2 days","waitDays":2}},{"id":"action-2","type":"action","position":{"x":250,"y":300},"data":{"label":"Email: Review + 10% off","channel":"email"}},{"id":"wait-2","type":"wait","position":{"x":250,"y":400},"data":{"label":"Wait 4 days","waitDays":4}},{"id":"action-3","type":"action","position":{"x":250,"y":500},"data":{"label":"Email: Cross-sell experiences","channel":"email"}},{"id":"wait-3","type":"wait","position":{"x":250,"y":600},"data":{"label":"Wait 3 days","waitDays":3}},{"id":"action-4","type":"action","position":{"x":250,"y":700},"data":{"label":"WhatsApp: Visa cross-sell","channel":"whatsapp"}},{"id":"wait-4","type":"wait","position":{"x":250,"y":800},"data":{"label":"Wait 4 days","waitDays":4}},{"id":"action-5","type":"action","position":{"x":250,"y":900},"data":{"label":"Email: Referral program","channel":"email"}},{"id":"wait-5","type":"wait","position":{"x":250,"y":1000},"data":{"label":"Wait 7 days","waitDays":7}},{"id":"action-6","type":"action","position":{"x":250,"y":1100},"data":{"label":"Email: Early-bird rebook","channel":"email"}},{"id":"wait-6","type":"wait","position":{"x":250,"y":1200},"data":{"label":"Wait 7 days","waitDays":7}},{"id":"action-7","type":"action","position":{"x":250,"y":1300},"data":{"label":"WhatsApp: Loyalty discount","channel":"whatsapp"}},{"id":"goal-1","type":"goal","position":{"x":250,"y":1400},"data":{"label":"Rebooked or referred","goalType":"booking"}}]'::jsonb,
 '[{"id":"e1","source":"trigger-1","target":"action-1"},{"id":"e2","source":"action-1","target":"wait-1"},{"id":"e3","source":"wait-1","target":"action-2"},{"id":"e4","source":"action-2","target":"wait-2"},{"id":"e5","source":"wait-2","target":"action-3"},{"id":"e6","source":"action-3","target":"wait-3"},{"id":"e7","source":"wait-3","target":"action-4"},{"id":"e8","source":"action-4","target":"wait-4"},{"id":"e9","source":"wait-4","target":"action-5"},{"id":"e10","source":"action-5","target":"wait-5"},{"id":"e11","source":"wait-5","target":"action-6"},{"id":"e12","source":"action-6","target":"wait-6"},{"id":"e13","source":"wait-6","target":"action-7"},{"id":"e14","source":"action-7","target":"goal-1"}]'::jsonb,
 'booking', 'cross_sell_loyalty'),

-- Journey 6: PROSPECT
('Prospect — Awareness Nurture',
 'Introduce Rayna Tours to new prospects and drive first booking over 14 days.', 'active',
 '[{"id":"trigger-1","type":"trigger","position":{"x":250,"y":0},"data":{"label":"New prospect","triggerType":"segment_entry","segmentLabel":"PROSPECT"}},{"id":"action-1","type":"action","position":{"x":250,"y":100},"data":{"label":"Email: Welcome to Rayna","channel":"email"}},{"id":"wait-1","type":"wait","position":{"x":250,"y":200},"data":{"label":"Wait 3 days","waitDays":3}},{"id":"action-2","type":"action","position":{"x":250,"y":300},"data":{"label":"Email: Top 10 experiences","channel":"email"}},{"id":"wait-2","type":"wait","position":{"x":250,"y":400},"data":{"label":"Wait 3 days","waitDays":3}},{"id":"action-3","type":"action","position":{"x":250,"y":500},"data":{"label":"Email: Social proof","channel":"email"}},{"id":"wait-3","type":"wait","position":{"x":250,"y":600},"data":{"label":"Wait 3 days","waitDays":3}},{"id":"action-4","type":"action","position":{"x":250,"y":700},"data":{"label":"Email: 20% first-booking offer","channel":"email"}},{"id":"wait-4","type":"wait","position":{"x":250,"y":800},"data":{"label":"Wait 3 days","waitDays":3}},{"id":"action-5","type":"action","position":{"x":250,"y":900},"data":{"label":"Email: Full catalog","channel":"email"}},{"id":"wait-5","type":"wait","position":{"x":250,"y":1000},"data":{"label":"Wait 2 days","waitDays":2}},{"id":"action-6","type":"action","position":{"x":250,"y":1100},"data":{"label":"Email: Discount expiring","channel":"email"}},{"id":"goal-1","type":"goal","position":{"x":250,"y":1200},"data":{"label":"First booking","goalType":"booking"}}]'::jsonb,
 '[{"id":"e1","source":"trigger-1","target":"action-1"},{"id":"e2","source":"action-1","target":"wait-1"},{"id":"e3","source":"wait-1","target":"action-2"},{"id":"e4","source":"action-2","target":"wait-2"},{"id":"e5","source":"wait-2","target":"action-3"},{"id":"e6","source":"action-3","target":"wait-3"},{"id":"e7","source":"wait-3","target":"action-4"},{"id":"e8","source":"action-4","target":"wait-4"},{"id":"e9","source":"wait-4","target":"action-5"},{"id":"e10","source":"action-5","target":"wait-5"},{"id":"e11","source":"wait-5","target":"action-6"},{"id":"e12","source":"action-6","target":"goal-1"}]'::jsonb,
 'booking', 'first_booking_prospect');
