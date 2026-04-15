-- 042: B2B strategies, journeys, and content templates
-- Separate from B2C — focuses on partnerships, volume deals, commission structures

-- Ensure segment_label column exists (may be missing if 001 was cached)
ALTER TABLE content_templates ADD COLUMN IF NOT EXISTS segment_label TEXT;

-- ── B2B Segment Definitions ────────────────────────────────────
INSERT INTO segment_definitions (segment_number, stage_id, segment_name, segment_description, customer_type, priority, sql_criteria, key_points) VALUES
(7, (SELECT stage_id FROM funnel_stages WHERE stage_number = 2),
 'B2B_ACTIVE_PARTNER', 'Active B2B partner — booking regularly in last 30 days',
 'B2B', 'Critical',
 $$contact_type = 'B2B' AND total_tour_bookings > 0 AND last_booking_at >= NOW() - INTERVAL '30 days'$$,
 '["Maintain relationship with account manager","Share new product inventory","Offer volume-based commission tiers","Provide marketing collateral","Invite to partner events"]'::jsonb),

(8, (SELECT stage_id FROM funnel_stages WHERE stage_number = 3),
 'B2B_DORMANT_PARTNER', 'Dormant B2B partner — no bookings in 30+ days',
 'B2B', 'High',
 $$contact_type = 'B2B' AND total_tour_bookings > 0 AND last_booking_at < NOW() - INTERVAL '30 days'$$,
 '["Re-engage with new products & pricing","Offer reactivation commission boost","Share competitor analysis","Assign dedicated account manager","Invite to webinar/training"]'::jsonb),

(9, (SELECT stage_id FROM funnel_stages WHERE stage_number = 2),
 'B2B_NEW_LEAD', 'New B2B lead — enquired but never booked',
 'B2B', 'High',
 $$contact_type = 'B2B' AND total_chats > 0 AND (total_tour_bookings = 0 OR total_tour_bookings IS NULL)$$,
 '["Fast response with partnership proposal","Share commission structure","Provide product catalog & API access","Offer trial booking at reduced commission","Schedule onboarding call"]'::jsonb),

(10, (SELECT stage_id FROM funnel_stages WHERE stage_number = 4),
 'B2B_PROSPECT', 'B2B prospect — travel agency/operator not yet engaged',
 'B2B', 'Medium',
 $$contact_type = 'B2B' AND (total_chats = 0 OR total_chats IS NULL) AND (total_tour_bookings = 0 OR total_tour_bookings IS NULL)$$,
 '["Send partnership introduction","Highlight commission rates & volume benefits","Share success stories from existing partners","Offer free product demo","Invite to B2B portal"]'::jsonb);

-- ── B2B Strategies ─────────────────────────────────────────────
INSERT INTO omnichannel_strategies (name, description, segment_label, channels, status, flow_steps) VALUES

('B2B Active Partner — Nurture & Upsell',
 'Keep active B2B partners engaged with new products, volume deals, and commission updates.',
 'B2B_ACTIVE_PARTNER', ARRAY['email','whatsapp']::channel_type[], 'active',
 '[
   {"day":0,"channel":"email","action":"This month''s new products & updated commission rates","type":"product_update"},
   {"day":7,"channel":"whatsapp","action":"Hit 50 bookings this month? Unlock our premium commission tier","type":"volume_incentive"},
   {"day":14,"channel":"email","action":"Top-selling products from your peers — are you offering these?","type":"competitive_intel"},
   {"day":21,"channel":"email","action":"Monthly performance report + next month''s hot deals","type":"report"},
   {"day":28,"channel":"whatsapp","action":"Thank you for a great month! Here''s what''s coming next","type":"relationship"}
 ]'::jsonb),

('B2B Dormant Partner — Re-activation',
 'Re-engage B2B partners who stopped booking with incentives and new products.',
 'B2B_DORMANT_PARTNER', ARRAY['email','whatsapp']::channel_type[], 'active',
 '[
   {"day":0,"channel":"email","action":"We miss working with you! Here''s what''s new at Rayna Tours","type":"re_engage"},
   {"day":3,"channel":"whatsapp","action":"Exclusive reactivation offer: 2% extra commission for 30 days","type":"incentive"},
   {"day":7,"channel":"email","action":"Your competitors are selling these — updated product catalog inside","type":"competitive"},
   {"day":14,"channel":"email","action":"Free training session: how top partners earn 3x more commission","type":"training"},
   {"day":21,"channel":"whatsapp","action":"Last chance: reactivation bonus expires in 7 days","type":"urgency"}
 ]'::jsonb),

('B2B New Lead — Onboarding',
 'Convert new B2B enquiries into active partners with structured onboarding.',
 'B2B_NEW_LEAD', ARRAY['email','whatsapp']::channel_type[], 'active',
 '[
   {"day":0,"channel":"email","action":"Welcome! Your Rayna Tours partnership proposal & commission rates","type":"proposal"},
   {"day":1,"channel":"whatsapp","action":"Hi! I''m your dedicated account manager. Let''s set up your account","type":"personal"},
   {"day":3,"channel":"email","action":"Getting started guide: API access, booking portal, marketing materials","type":"onboarding"},
   {"day":5,"channel":"whatsapp","action":"Ready to try? First 5 bookings at 0% commission — on us","type":"trial_offer"},
   {"day":7,"channel":"email","action":"Success stories: how partners like you earn AED 50K+ monthly","type":"social_proof"},
   {"day":10,"channel":"whatsapp","action":"Your trial offer expires in 4 days. Book your first customer now!","type":"urgency"}
 ]'::jsonb),

('B2B Prospect — Partnership Outreach',
 'Introduce Rayna Tours partnership program to new B2B prospects.',
 'B2B_PROSPECT', ARRAY['email']::channel_type[], 'active',
 '[
   {"day":0,"channel":"email","action":"Partner with Rayna Tours — Dubai''s #1 travel platform for agencies","type":"introduction"},
   {"day":5,"channel":"email","action":"Commission structure: earn up to 15% on every booking","type":"commission"},
   {"day":10,"channel":"email","action":"500+ partners trust us — here''s what they say","type":"testimonials"},
   {"day":15,"channel":"email","action":"Ready to start? Apply for your partner account today","type":"cta"}
 ]'::jsonb);

-- ── B2B Content Templates ──────────────────────────────────────
INSERT INTO content_templates (name, channel, status, segment_label, subject, body, cta_url, cta_text, variables) VALUES

-- Active Partner
('B2B_ACTIVE — Product Update',
 'email', 'approved', 'B2B_ACTIVE_PARTNER',
 'New products & updated commission rates for {{month}}',
 'Dear {{first_name}},

Here are this month''s highlights for our B2B partners:

📦 NEW PRODUCTS ADDED
• Luxury Desert Glamping — AED 1,499 (your commission: AED 149)
• Abu Dhabi Full Day Tour — AED 199 (your commission: AED 30)
• Dubai Frame + Garden Glow Combo — AED 149 (your commission: AED 22)

📊 YOUR COMMISSION RATES
• Standard: 12%
• Volume (50+ bookings/month): 15%
• Premium (100+ bookings/month): 18%

💰 YOUR MTD PERFORMANCE
• Bookings this month: {{booking_count}}
• Commission earned: AED {{commission_earned}}

Keep selling — you are {{bookings_to_next_tier}} bookings away from the next commission tier!

Rayna Tours B2B Team',
 'https://b2b.raynatours.com', 'View Full Catalog',
 ARRAY['first_name', 'month', 'booking_count', 'commission_earned', 'bookings_to_next_tier']),

('B2B_ACTIVE — Volume Incentive',
 'whatsapp', 'approved', 'B2B_ACTIVE_PARTNER', NULL,
 'Hi {{first_name}}! Great month so far 📊

You have {{booking_count}} bookings this month. Hit 50 and unlock our premium commission tier: 15% on ALL products!

That is {{bookings_to_next_tier}} more bookings to go. Your clients will love these trending products:
🏜️ Desert Safari — best seller
🚤 Yacht Cruise — premium margin
🏙️ Burj Khalifa — always in demand

Need marketing materials? Reply MATERIALS and we will send you everything.',
 NULL, NULL,
 ARRAY['first_name', 'booking_count', 'bookings_to_next_tier']),

-- Dormant Partner
('B2B_DORMANT — Re-engage',
 'email', 'approved', 'B2B_DORMANT_PARTNER',
 'We miss working with you, {{first_name}}! Here''s what''s new',
 'Dear {{first_name}},

It has been a while since your last booking with us, and we have been busy adding new products and improving our partner program.

🆕 WHAT''S NEW
• 45+ new products added
• Improved booking portal with real-time availability
• New API endpoints for seamless integration
• Dedicated WhatsApp support line for partners

🎁 REACTIVATION OFFER
Book 10 customers this month and get 2% EXTRA commission on all bookings for 30 days.

We value our partnership and would love to work together again.

Rayna Tours B2B Team',
 'https://b2b.raynatours.com', 'Explore New Products',
 ARRAY['first_name']),

('B2B_DORMANT — Reactivation Offer',
 'whatsapp', 'approved', 'B2B_DORMANT_PARTNER', NULL,
 'Hi {{first_name}}! 👋

We have an exclusive offer just for you: 2% EXTRA commission on all bookings for the next 30 days!

Your clients are searching for Dubai experiences — let us help you sell more.

Reply ACTIVATE to claim your bonus commission now!',
 NULL, NULL, ARRAY['first_name']),

-- New Lead
('B2B_NEW_LEAD — Partnership Proposal',
 'email', 'approved', 'B2B_NEW_LEAD',
 'Your Rayna Tours partnership proposal — earn up to 18% commission',
 'Dear {{first_name}},

Thank you for your interest in partnering with Rayna Tours!

🏢 WHO WE ARE
Dubai''s #1 travel experience platform with 500+ products across tours, holidays, cruises, visas, and flights.

💰 YOUR COMMISSION STRUCTURE
• Standard tier: 12% commission
• Volume tier (50+/month): 15% commission
• Premium tier (100+/month): 18% commission
• All commissions paid weekly via bank transfer

🚀 WHAT YOU GET
• Access to 500+ bookable products
• Real-time availability & instant confirmation
• White-label booking portal
• API integration (optional)
• Dedicated account manager
• Marketing materials & co-branded content

📞 NEXT STEPS
Reply to this email or call us to set up your partner account. We can have you selling within 24 hours.

Rayna Tours B2B Team',
 'https://b2b.raynatours.com/register', 'Apply for Partnership',
 ARRAY['first_name']),

('B2B_NEW_LEAD — Trial Offer',
 'whatsapp', 'approved', 'B2B_NEW_LEAD', NULL,
 'Hi {{first_name}}! I am your dedicated Rayna Tours account manager 🤝

Ready to try us out? Here is a special offer:

🎁 First 5 bookings at 0% commission — completely FREE for you to test

No commitment, no minimum volume. Just book 5 customers and see the quality for yourself.

Reply START and I will set up your account right now!',
 NULL, NULL, ARRAY['first_name']),

-- Prospect
('B2B_PROSPECT — Introduction',
 'email', 'approved', 'B2B_PROSPECT',
 'Partner with Dubai''s #1 travel platform — earn up to 18%',
 'Dear {{first_name}},

Are you a travel agency or tour operator looking to offer Dubai experiences to your clients?

Partner with Rayna Tours and access:
✓ 500+ tours, activities & holiday packages
✓ Up to 18% commission on every booking
✓ Real-time availability & instant confirmation
✓ Weekly commission payments
✓ Dedicated account manager

Join 500+ travel partners already earning with us.

Rayna Tours B2B Team',
 'https://b2b.raynatours.com/register', 'Become a Partner',
 ARRAY['first_name']),

('B2B_PROSPECT — Commission Details',
 'email', 'approved', 'B2B_PROSPECT',
 'Earn up to 18% commission — here''s how',
 'Dear {{first_name}},

Here is exactly how much you can earn with Rayna Tours:

💰 COMMISSION TIERS
• 1-49 bookings/month: 12% commission
• 50-99 bookings/month: 15% commission
• 100+ bookings/month: 18% commission

📊 EXAMPLE EARNINGS
• 30 bookings/month (avg AED 300) = AED 1,080/month
• 75 bookings/month (avg AED 300) = AED 3,375/month
• 150 bookings/month (avg AED 300) = AED 8,100/month

Our top partners earn AED 50,000+ per month.

Ready to start?

Rayna Tours B2B Team',
 'https://b2b.raynatours.com/register', 'Start Earning',
 ARRAY['first_name']);

-- ── B2B Journeys ───────────────────────────────────────────────

INSERT INTO journey_flows (name, description, status, nodes, edges, goal_type, goal_value) VALUES

-- B2B Active Partner Journey
('B2B Active Partner — Nurture Journey',
 'Monthly engagement cycle for active B2B partners.', 'active',
 '[{"id":"trigger-1","type":"trigger","position":{"x":250,"y":0},"data":{"label":"Active B2B partner","triggerType":"segment_entry","segmentLabel":"B2B_ACTIVE_PARTNER"}},{"id":"action-1","type":"action","position":{"x":250,"y":100},"data":{"label":"Email: Product update","channel":"email"}},{"id":"wait-1","type":"wait","position":{"x":250,"y":200},"data":{"label":"Wait 7 days","waitDays":7}},{"id":"action-2","type":"action","position":{"x":250,"y":300},"data":{"label":"WhatsApp: Volume incentive","channel":"whatsapp"}},{"id":"wait-2","type":"wait","position":{"x":250,"y":400},"data":{"label":"Wait 7 days","waitDays":7}},{"id":"action-3","type":"action","position":{"x":250,"y":500},"data":{"label":"Email: Competitive intel","channel":"email"}},{"id":"wait-3","type":"wait","position":{"x":250,"y":600},"data":{"label":"Wait 7 days","waitDays":7}},{"id":"action-4","type":"action","position":{"x":250,"y":700},"data":{"label":"Email: Monthly report","channel":"email"}},{"id":"goal-1","type":"goal","position":{"x":250,"y":800},"data":{"label":"Month completed","goalType":"booking"}}]'::jsonb,
 '[{"id":"e1","source":"trigger-1","target":"action-1"},{"id":"e2","source":"action-1","target":"wait-1"},{"id":"e3","source":"wait-1","target":"action-2"},{"id":"e4","source":"action-2","target":"wait-2"},{"id":"e5","source":"wait-2","target":"action-3"},{"id":"e6","source":"action-3","target":"wait-3"},{"id":"e7","source":"wait-3","target":"action-4"},{"id":"e8","source":"action-4","target":"goal-1"}]'::jsonb,
 'booking', 'b2b_active_nurture'),

-- B2B Dormant Partner Journey
('B2B Dormant Partner — Reactivation Journey',
 'Re-engage dormant B2B partners over 21 days.', 'active',
 '[{"id":"trigger-1","type":"trigger","position":{"x":250,"y":0},"data":{"label":"Partner went dormant","triggerType":"segment_entry","segmentLabel":"B2B_DORMANT_PARTNER"}},{"id":"action-1","type":"action","position":{"x":250,"y":100},"data":{"label":"Email: We miss you","channel":"email"}},{"id":"wait-1","type":"wait","position":{"x":250,"y":200},"data":{"label":"Wait 3 days","waitDays":3}},{"id":"action-2","type":"action","position":{"x":250,"y":300},"data":{"label":"WhatsApp: Reactivation offer","channel":"whatsapp"}},{"id":"wait-2","type":"wait","position":{"x":250,"y":400},"data":{"label":"Wait 4 days","waitDays":4}},{"id":"condition-1","type":"condition","position":{"x":250,"y":500},"data":{"label":"Booked?","condition":"booked"}},{"id":"action-3","type":"action","position":{"x":100,"y":600},"data":{"label":"Email: Training invite","channel":"email"}},{"id":"goal-1","type":"goal","position":{"x":400,"y":600},"data":{"label":"Reactivated!","goalType":"booking"}},{"id":"wait-3","type":"wait","position":{"x":100,"y":700},"data":{"label":"Wait 7 days","waitDays":7}},{"id":"action-4","type":"action","position":{"x":100,"y":800},"data":{"label":"WhatsApp: Last chance","channel":"whatsapp"}},{"id":"goal-2","type":"goal","position":{"x":100,"y":900},"data":{"label":"Reactivated or lost","goalType":"booking"}}]'::jsonb,
 '[{"id":"e1","source":"trigger-1","target":"action-1"},{"id":"e2","source":"action-1","target":"wait-1"},{"id":"e3","source":"wait-1","target":"action-2"},{"id":"e4","source":"action-2","target":"wait-2"},{"id":"e5","source":"wait-2","target":"condition-1"},{"id":"e6","source":"condition-1","target":"action-3","label":"No"},{"id":"e7","source":"condition-1","target":"goal-1","label":"Yes"},{"id":"e8","source":"action-3","target":"wait-3"},{"id":"e9","source":"wait-3","target":"action-4"},{"id":"e10","source":"action-4","target":"goal-2"}]'::jsonb,
 'booking', 'b2b_reactivation'),

-- B2B New Lead Journey
('B2B New Lead — Onboarding Journey',
 'Convert B2B enquiries into active partners over 10 days.', 'active',
 '[{"id":"trigger-1","type":"trigger","position":{"x":250,"y":0},"data":{"label":"New B2B enquiry","triggerType":"segment_entry","segmentLabel":"B2B_NEW_LEAD"}},{"id":"action-1","type":"action","position":{"x":250,"y":100},"data":{"label":"Email: Partnership proposal","channel":"email"}},{"id":"wait-1","type":"wait","position":{"x":250,"y":200},"data":{"label":"Wait 1 day","waitDays":1}},{"id":"action-2","type":"action","position":{"x":250,"y":300},"data":{"label":"WhatsApp: Account manager intro","channel":"whatsapp"}},{"id":"wait-2","type":"wait","position":{"x":250,"y":400},"data":{"label":"Wait 2 days","waitDays":2}},{"id":"action-3","type":"action","position":{"x":250,"y":500},"data":{"label":"Email: Onboarding guide","channel":"email"}},{"id":"wait-3","type":"wait","position":{"x":250,"y":600},"data":{"label":"Wait 2 days","waitDays":2}},{"id":"action-4","type":"action","position":{"x":250,"y":700},"data":{"label":"WhatsApp: Trial offer","channel":"whatsapp"}},{"id":"wait-4","type":"wait","position":{"x":250,"y":800},"data":{"label":"Wait 2 days","waitDays":2}},{"id":"action-5","type":"action","position":{"x":250,"y":900},"data":{"label":"WhatsApp: Trial expiring","channel":"whatsapp"}},{"id":"goal-1","type":"goal","position":{"x":250,"y":1000},"data":{"label":"Partner activated","goalType":"booking"}}]'::jsonb,
 '[{"id":"e1","source":"trigger-1","target":"action-1"},{"id":"e2","source":"action-1","target":"wait-1"},{"id":"e3","source":"wait-1","target":"action-2"},{"id":"e4","source":"action-2","target":"wait-2"},{"id":"e5","source":"wait-2","target":"action-3"},{"id":"e6","source":"action-3","target":"wait-3"},{"id":"e7","source":"wait-3","target":"action-4"},{"id":"e8","source":"action-4","target":"wait-4"},{"id":"e9","source":"wait-4","target":"action-5"},{"id":"e10","source":"action-5","target":"goal-1"}]'::jsonb,
 'booking', 'b2b_onboarding'),

-- B2B Prospect Journey
('B2B Prospect — Outreach Journey',
 'Introduce partnership program to new B2B prospects over 15 days.', 'active',
 '[{"id":"trigger-1","type":"trigger","position":{"x":250,"y":0},"data":{"label":"New B2B prospect","triggerType":"segment_entry","segmentLabel":"B2B_PROSPECT"}},{"id":"action-1","type":"action","position":{"x":250,"y":100},"data":{"label":"Email: Introduction","channel":"email"}},{"id":"wait-1","type":"wait","position":{"x":250,"y":200},"data":{"label":"Wait 5 days","waitDays":5}},{"id":"action-2","type":"action","position":{"x":250,"y":300},"data":{"label":"Email: Commission details","channel":"email"}},{"id":"wait-2","type":"wait","position":{"x":250,"y":400},"data":{"label":"Wait 5 days","waitDays":5}},{"id":"action-3","type":"action","position":{"x":250,"y":500},"data":{"label":"Email: Testimonials","channel":"email"}},{"id":"wait-3","type":"wait","position":{"x":250,"y":600},"data":{"label":"Wait 5 days","waitDays":5}},{"id":"action-4","type":"action","position":{"x":250,"y":700},"data":{"label":"Email: Apply CTA","channel":"email"}},{"id":"goal-1","type":"goal","position":{"x":250,"y":800},"data":{"label":"Applied for partnership","goalType":"registration"}}]'::jsonb,
 '[{"id":"e1","source":"trigger-1","target":"action-1"},{"id":"e2","source":"action-1","target":"wait-1"},{"id":"e3","source":"wait-1","target":"action-2"},{"id":"e4","source":"action-2","target":"wait-2"},{"id":"e5","source":"wait-2","target":"action-3"},{"id":"e6","source":"action-3","target":"wait-3"},{"id":"e7","source":"wait-3","target":"action-4"},{"id":"e8","source":"action-4","target":"goal-1"}]'::jsonb,
 'registration', 'b2b_outreach');
