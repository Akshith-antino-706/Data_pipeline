-- 041: Occasion strategy, journey, and content templates

-- Ensure columns exist (may be missing if 001 was cached or 036 rolled back)
ALTER TABLE content_templates ADD COLUMN IF NOT EXISTS segment_label TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS journey_id BIGINT;

-- ── Strategy ───────────────────────────────────────────────────
INSERT INTO omnichannel_strategies (name, description, segment_label, channels, status, flow_steps) VALUES
('Holiday Occasion — Festive Offers',
 'Auto-triggered 14 days before local holidays. Sends holiday-specific offers based on user country.',
 'OCCASION',
 ARRAY['email','whatsapp']::channel_type[],
 'active',
 '[
   {"day":0,"channel":"email","action":"Holiday is coming! Early-bird {{holiday_name}} offers just for you","type":"festive_intro"},
   {"day":3,"channel":"whatsapp","action":"{{holiday_name}} is around the corner! Book now with code {{offer_tag}}","type":"offer"},
   {"day":7,"channel":"email","action":"{{holiday_name}} week — top experiences & packages at special prices","type":"curated_deals"},
   {"day":10,"channel":"whatsapp","action":"Only 4 days to {{holiday_name}}! Last chance for {{offer_tag}} discount","type":"urgency"},
   {"day":13,"channel":"email","action":"{{holiday_name}} tomorrow! Final offers expiring tonight","type":"final_push"}
 ]'::jsonb);

-- ── Content Templates (occasion-aware with {{holiday_name}} variable) ──

INSERT INTO content_templates (name, channel, status, segment_label, subject, body, cta_url, cta_text, variables) VALUES

('OCCASION — Day 0 Festive Intro Email',
 'email', 'approved', 'OCCASION',
 '{{holiday_name}} is coming! Special offers inside',
 'Hi {{first_name}},

{{holiday_name}} is just around the corner — and we have something special for you!

🎉 EXCLUSIVE {{holiday_name}} OFFERS

Whether you are planning a family getaway, an adventure trip, or a relaxing break — we have curated the best {{holiday_name}} experiences just for you.

🎁 Use code: {{offer_tag}}
✓ Valid on all tours, activities & packages
✓ Limited period — book before {{holiday_name}}!

Start exploring and make this {{holiday_name}} unforgettable.

Rayna Tours Team',
 'https://www.raynatours.com/activities', 'Explore {{holiday_name}} Offers',
 ARRAY['first_name', 'holiday_name', 'offer_tag']),

('OCCASION — Day 3 WhatsApp Offer',
 'whatsapp', 'approved', 'OCCASION', NULL,
 'Hi {{first_name}}! 🎉

{{holiday_name}} is around the corner! We have exclusive deals just for this occasion:

🏜️ Desert Safari — Special {{holiday_name}} edition
🚤 Yacht Cruise — Celebrate on the water
🏙️ City Tour Combos — Festive pricing
🎢 Theme Parks — Family {{holiday_name}} packages

🎁 Use code {{offer_tag}} for extra discount!

Reply BOOK and I will help you find the perfect {{holiday_name}} experience!',
 'https://www.raynatours.com/activities', 'View Deals',
 ARRAY['first_name', 'holiday_name', 'offer_tag']),

('OCCASION — Day 7 Curated Deals Email',
 'email', 'approved', 'OCCASION',
 '{{holiday_name}} week — curated experiences at special prices',
 'Hi {{first_name}},

It is {{holiday_name}} week! Here are our top curated experiences for this special occasion:

⭐ MOST POPULAR THIS {{holiday_name}}

1. 🏜️ Premium Desert Safari — festive dinner included
2. 🚤 Marina Yacht Party — {{holiday_name}} celebration cruise
3. 🏙️ Burj Khalifa + Dinner Combo — special {{holiday_name}} package
4. 🎢 Theme Park Bundle — family {{holiday_name}} fun
5. 🚁 Helicopter Tour — see the city lit up for {{holiday_name}}

These are our most booked experiences during {{holiday_name}} — availability is limited!

🎁 Your code {{offer_tag}} is still valid.

Rayna Tours Team',
 'https://www.raynatours.com/activities', 'Book {{holiday_name}} Experience',
 ARRAY['first_name', 'holiday_name', 'offer_tag']),

('OCCASION — Day 10 WhatsApp Urgency',
 'whatsapp', 'approved', 'OCCASION', NULL,
 'Hi {{first_name}}! ⏰

Only 4 days until {{holiday_name}}! Spots are filling up fast.

Our {{holiday_name}} experiences are 80% sold out. Do not miss your chance!

🎁 Code {{offer_tag}} — last few days to use it!

Reply YES and I will lock in your spot right now 🎯',
 NULL, NULL,
 ARRAY['first_name', 'holiday_name', 'offer_tag']),

('OCCASION — Day 13 Final Push Email',
 'email', 'approved', 'OCCASION',
 '{{holiday_name}} is TOMORROW — final offers expiring tonight!',
 'Hi {{first_name}},

{{holiday_name}} is tomorrow! This is your last chance to book something special.

⏰ ALL {{holiday_name}} OFFERS EXPIRE AT MIDNIGHT TONIGHT

Do not let this {{holiday_name}} pass without an unforgettable experience. Your code {{offer_tag}} works on everything.

Book now — or miss out until next year!

Rayna Tours Team',
 'https://www.raynatours.com/activities', 'Book Now — Last Chance',
 ARRAY['first_name', 'holiday_name', 'offer_tag']);

-- ── Journey Flow ───────────────────────────────────────────────

INSERT INTO journey_flows (name, description, status, nodes, edges, goal_type, goal_value) VALUES
('Holiday Occasion — Festive Journey',
 'Auto-triggered 14 days before local holidays. Sends holiday-specific offers.',
 'active',
 '[
   {"id":"trigger-1","type":"trigger","position":{"x":250,"y":0},"data":{"label":"Holiday in 14 days","triggerType":"occasion_entry","segmentLabel":"OCCASION"}},
   {"id":"action-1","type":"action","position":{"x":250,"y":100},"data":{"label":"Email: Festive intro","channel":"email","templateId":null}},
   {"id":"wait-1","type":"wait","position":{"x":250,"y":200},"data":{"label":"Wait 3 days","waitDays":3}},
   {"id":"action-2","type":"action","position":{"x":250,"y":300},"data":{"label":"WhatsApp: Holiday offer","channel":"whatsapp","templateId":null}},
   {"id":"wait-2","type":"wait","position":{"x":250,"y":400},"data":{"label":"Wait 4 days","waitDays":4}},
   {"id":"condition-1","type":"condition","position":{"x":250,"y":500},"data":{"label":"Booked?","condition":"booked"}},
   {"id":"action-3","type":"action","position":{"x":100,"y":600},"data":{"label":"Email: Curated deals","channel":"email","templateId":null}},
   {"id":"goal-1","type":"goal","position":{"x":400,"y":600},"data":{"label":"Converted!","goalType":"booking"}},
   {"id":"wait-3","type":"wait","position":{"x":100,"y":700},"data":{"label":"Wait 3 days","waitDays":3}},
   {"id":"action-4","type":"action","position":{"x":100,"y":800},"data":{"label":"WhatsApp: Urgency","channel":"whatsapp","templateId":null}},
   {"id":"wait-4","type":"wait","position":{"x":100,"y":900},"data":{"label":"Wait 3 days","waitDays":3}},
   {"id":"action-5","type":"action","position":{"x":100,"y":1000},"data":{"label":"Email: Final push","channel":"email","templateId":null}},
   {"id":"goal-2","type":"goal","position":{"x":100,"y":1100},"data":{"label":"Holiday passed","goalType":"booking"}}
 ]'::jsonb,
 '[
   {"id":"e1","source":"trigger-1","target":"action-1"},
   {"id":"e2","source":"action-1","target":"wait-1"},
   {"id":"e3","source":"wait-1","target":"action-2"},
   {"id":"e4","source":"action-2","target":"wait-2"},
   {"id":"e5","source":"wait-2","target":"condition-1"},
   {"id":"e6","source":"condition-1","target":"action-3","label":"No"},
   {"id":"e7","source":"condition-1","target":"goal-1","label":"Yes"},
   {"id":"e8","source":"action-3","target":"wait-3"},
   {"id":"e9","source":"wait-3","target":"action-4"},
   {"id":"e10","source":"action-4","target":"wait-4"},
   {"id":"e11","source":"wait-4","target":"action-5"},
   {"id":"e12","source":"action-5","target":"goal-2"}
 ]'::jsonb,
 'booking', 'occasion_festive');

-- ── Campaign ───────────────────────────────────────────────────
INSERT INTO campaigns (name, segment_label, channel, template_id, status, journey_id) VALUES
('Holiday Occasion — Email',
 'OCCASION', 'email',
 (SELECT id FROM content_templates WHERE name = 'OCCASION — Day 0 Festive Intro Email' LIMIT 1),
 'draft',
 (SELECT journey_id FROM journey_flows WHERE name = 'Holiday Occasion — Festive Journey' LIMIT 1)),
('Holiday Occasion — WhatsApp',
 'OCCASION', 'whatsapp',
 (SELECT id FROM content_templates WHERE name = 'OCCASION — Day 3 WhatsApp Offer' LIMIT 1),
 'draft',
 (SELECT journey_id FROM journey_flows WHERE name = 'Holiday Occasion — Festive Journey' LIMIT 1));
