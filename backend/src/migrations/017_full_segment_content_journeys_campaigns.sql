-- ═══════════════════════════════════════════════════════════════════
-- Migration 017: FULL END-TO-END SEGMENT CONTENT, JOURNEYS, COUPONS & CAMPAIGNS
-- Fills all missing gaps: templates, journey flows, coupons, campaigns
-- for every 28 segment so the platform is fully testable
-- ═══════════════════════════════════════════════════════════════════
BEGIN;

-- ══════════════════════════════════════════════════════════════
-- STEP 1: SEGMENT-SPECIFIC COUPONS (one per segment that needs it)
-- ══════════════════════════════════════════════════════════════
DELETE FROM coupon_usage;
DELETE FROM coupons WHERE code != 'VAI20';

INSERT INTO coupons (code, description, discount_type, discount_value, min_order_value, max_discount, valid_from, valid_until, usage_limit, segment_labels, channel_types, product_types, is_active) VALUES
-- Stage 1: Cold Leads
('SOCIAL10',   'Social ad lead welcome offer',             'percentage', 10.00, 100,  500,  NOW(), NOW() + INTERVAL '90 days', 5000, '{Social Ad Leads}',                          '{whatsapp,email}',    '{tour,visa}',         true),
('BROWSE15',   'Website browser first-time offer',         'percentage', 15.00, 200,  750,  NOW(), NOW() + INTERVAL '60 days', 3000, '{Website Browsers}',                         '{email,web}',         '{tour}',              true),
('WAFIRST10',  'WhatsApp first-touch offer',               'percentage', 10.00, 100,  500,  NOW(), NOW() + INTERVAL '60 days', 5000, '{WhatsApp First-Touch}',                     '{whatsapp}',          '{tour,visa}',         true),

-- Stage 2: Warm Leads
('CART10',     'Fresh cart abandoner recovery',             'percentage', 10.00, 0,    300,  NOW(), NOW() + INTERVAL '30 days', 5000, '{Fresh Cart Abandoners (0-3 days)}',         '{whatsapp,email,sms}','{tour,visa}',         true),
('CART15',     'Stale cart abandoner extended offer',       'percentage', 15.00, 0,    500,  NOW(), NOW() + INTERVAL '30 days', 3000, '{Stale Cart Abandoners (4-14 days)}',        '{email,whatsapp}',    '{tour,visa}',         true),
('ENQUIRY10',  'Active enquirer conversion offer',         'percentage', 10.00, 100,  400,  NOW(), NOW() + INTERVAL '30 days', 5000, '{Active Enquirers}',                         '{whatsapp,email,sms}','{tour,visa}',         true),
('FLASH20',    'Hesitant browser flash sale',              'percentage', 20.00, 300,  800,  NOW(), NOW() + INTERVAL '14 days', 2000, '{Hesitant Browsers}',                        '{email,push}',        '{tour}',              true),
('PAYRETRY',   'Payment failed — retry discount',          'fixed',      50.00, 200,  NULL, NOW(), NOW() + INTERVAL '7 days',  5000, '{Payment Failed}',                           '{whatsapp,email,sms}','{tour,visa}',         true),
('FIRST15',    'Registered not booked first booking',      'percentage', 15.00, 100,  600,  NOW(), NOW() + INTERVAL '60 days', 5000, '{Registered Not Booked}',                    '{email,whatsapp}',    '{tour,visa}',         true),

-- Stage 3: Existing Customers — Reactivation
('WELCOME10',  'New customer welcome cross-sell',          'percentage', 10.00, 100,  400,  NOW(), NOW() + INTERVAL '30 days', 5000, '{New Customers (0-30 days)}',                '{email,whatsapp}',    '{tour,visa}',         true),
('REVIEW15',   'Post-trip rebook discount',                'percentage', 15.00, 200,  600,  NOW(), NOW() + INTERVAL '30 days', 3000, '{Post-Trip Review Window}',                  '{email,push}',        '{tour}',              true),
('SECOND10',   'One-time buyer second purchase',           'percentage', 10.00, 100,  500,  NOW(), NOW() + INTERVAL '45 days', 5000, '{One-Time Buyers (31-90 days)}',             '{email,whatsapp,sms}','{tour,visa}',         true),

-- Stage 4: Active B2C — Upsell/Cross-Sell
('LOYAL10',    'Repeat buyer loyalty reward',              'percentage', 10.00, 200,  500,  NOW(), NOW() + INTERVAL '60 days', 3000, '{Repeat Buyers}',                            '{email,whatsapp}',    '{tour,visa}',         true),
('VIP15',      'Frequent traveler VIP offer',              'percentage', 15.00, 300,  1000, NOW(), NOW() + INTERVAL '60 days', 1000, '{Frequent Travelers (4+ bookings)}',         '{whatsapp,email,sms}','{tour,visa}',         true),
('PREMIUM20',  'High spender premium experience',          'percentage', 20.00, 500,  2000, NOW(), NOW() + INTERVAL '90 days', 500,  '{High Spenders (5000+ AED)}',                '{email,whatsapp}',    '{tour}',              true),
('VISADEAL',   'Visa-only cross-sell tour bundle',         'fixed',     100.00, 500,  NULL, NOW(), NOW() + INTERVAL '60 days', 3000, '{Visa-Only → Tour Cross-Sell}',              '{email,whatsapp}',    '{tour}',              true),
('TOURDEAL',   'Tour-only cross-sell visa bundle',         'fixed',      75.00, 300,  NULL, NOW(), NOW() + INTERVAL '60 days', 3000, '{Tour-Only → Visa Cross-Sell}',              '{email,whatsapp}',    '{visa}',              true),

-- Stage 5: Churn Risk / Win-Back
('COOL10',     'Cooling down re-engagement',               'percentage', 10.00, 100,  400,  NOW(), NOW() + INTERVAL '30 days', 5000, '{Cooling Down (31-60 days)}',                '{email,whatsapp}',    '{tour,visa}',         true),
('RISK15',     'At risk win-back offer',                   'percentage', 15.00, 100,  600,  NOW(), NOW() + INTERVAL '30 days', 3000, '{At Risk (61-120 days)}',                    '{email,whatsapp,sms}','{tour,visa}',         true),
('HIBER20',    'Hibernating deep discount',                'percentage', 20.00, 100,  800,  NOW(), NOW() + INTERVAL '30 days', 2000, '{Hibernating (121-180 days)}',               '{email,whatsapp,sms}','{tour,visa}',         true),
('VIPBACK25',  'Lost high-value VIP comeback',             'percentage', 25.00, 200,  1500, NOW(), NOW() + INTERVAL '30 days', 500,  '{Lost High-Value (180+ days, 3000+ AED)}',   '{email,whatsapp,sms}','{tour,visa}',         true),
('LOSTDEAL',   'Lost regular win-back',                    'percentage', 20.00, 100,  700,  NOW(), NOW() + INTERVAL '30 days', 2000, '{Lost Regular (180+ days, <3000 AED)}',      '{email,whatsapp}',    '{tour,visa}',         true),

-- Stage 6: Advocacy
('REFER20',    'Referral program reward',                  'percentage', 20.00, 200,  800,  NOW(), NOW() + INTERVAL '90 days', 5000, '{Happy Reviewers (4-5 Stars)}',              '{email,whatsapp}',    '{tour,visa}',         true),
('AMBDOR15',   'Social advocate ambassador perk',          'percentage', 15.00, 200,  600,  NOW(), NOW() + INTERVAL '90 days', 1000, '{Social Media Advocates}',                   '{email,whatsapp}',    '{tour,visa}',         true),
('NPSREFER',   'NPS promoter referral bonus',              'percentage', 20.00, 200,  800,  NOW(), NOW() + INTERVAL '90 days', 2000, '{NPS Promoters}',                            '{email,whatsapp}',    '{tour,visa}',         true),

-- Stage 7: Special
('CORPVOL10',  'B2B corporate volume discount',            'percentage', 10.00, 1000, 5000, NOW(), NOW() + INTERVAL '90 days', 500,  '{B2B & Corporate}',                          '{email}',             '{tour,visa}',         true),
('BDAY25',     'Birthday month special',                   'percentage', 25.00, 100,  1000, NOW(), NOW() + INTERVAL '30 days', 5000, '{Birthday Month}',                           '{email,whatsapp,sms}','{tour,visa}',         true),
('FLEX10',     'High cancellation risk flex booking',      'percentage', 10.00, 100,  400,  NOW(), NOW() + INTERVAL '30 days', 3000, '{High Cancellation Risk}',                   '{email,whatsapp}',    '{tour,visa}',         true);


-- ══════════════════════════════════════════════════════════════
-- STEP 2: CONTENT TEMPLATES — 2-3 per segment (aligned to flow_steps)
-- Each segment gets templates for its designated channels
-- ══════════════════════════════════════════════════════════════

-- ──── 1. Social Ad Leads ────
INSERT INTO content_templates (name, channel, status, segment_label, subject, body, body_plain, cta_url, cta_text, variables) VALUES
('Social Ad Leads — Web Retarget', 'web', 'approved', 'Social Ad Leads',
 NULL,
 '<div style="max-width:400px;padding:20px;background:#fff;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.1)"><img src="https://raynatours.com/images/logo.png" width="120" style="margin-bottom:12px"/><h3 style="color:#1a1a2e;margin:0">Explore Dubai Like Never Before</h3><p style="color:#555;font-size:14px">Book your dream experience today. Use code <b>SOCIAL10</b> for 10% off!</p><a href="{{cta_url}}" style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;margin-top:12px">Explore Now</a></div>',
 'Explore Dubai like never before! Use code SOCIAL10 for 10% off. {{cta_url}}',
 'https://raynatours.com/tours?utm_source=social&utm_medium=retarget', 'Explore Now',
 '{first_name,cta_url}'),

('Social Ad Leads — WA Catalog', 'whatsapp', 'approved', 'Social Ad Leads',
 NULL,
 'Hi {{first_name}}! 👋 Thanks for your interest in Rayna Tours.\n\nHere are our top experiences:\n🏜️ Desert Safari — from AED 149\n🚢 Dhow Cruise — from AED 99\n🏙️ City Tour — from AED 129\n🎢 Theme Parks — from AED 199\n\nUse code *SOCIAL10* for 10% off your first booking!\n\n👉 Browse all: https://raynatours.com/tours',
 'Hi {{first_name}}! Thanks for your interest. Use code SOCIAL10 for 10% off. Browse: https://raynatours.com/tours',
 'https://raynatours.com/tours', 'Browse Tours',
 '{first_name}'),

('Social Ad Leads — Welcome Email', 'email', 'approved', 'Social Ad Leads',
 'Welcome to Rayna Tours — Your Dubai Adventure Starts Here!',
 '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><div style="background:linear-gradient(135deg,#667eea,#764ba2);padding:32px;border-radius:12px 12px 0 0;text-align:center"><img src="https://raynatours.com/images/logo-white.png" width="140"/><h1 style="color:#fff;margin:16px 0 0">Welcome, {{first_name}}!</h1></div><div style="padding:24px;background:#fff"><p>We noticed you checking out some amazing Dubai experiences. Here are our top picks for you:</p><table width="100%" cellpadding="8"><tr><td style="background:#f8f9fa;border-radius:8px;padding:16px"><b>🏜️ Desert Safari</b><br/>From AED 149</td><td style="background:#f8f9fa;border-radius:8px;padding:16px"><b>🚢 Dhow Cruise</b><br/>From AED 99</td></tr></table><div style="text-align:center;margin:24px 0"><a href="https://raynatours.com/tours" style="display:inline-block;padding:14px 32px;background:#667eea;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold">Explore All Experiences</a></div><p style="background:#f0f0ff;padding:16px;border-radius:8px;text-align:center">Use code <b>SOCIAL10</b> for 10% off your first booking!</p></div></div>',
 'Welcome to Rayna Tours! Explore our top Dubai experiences. Use code SOCIAL10 for 10% off.',
 'https://raynatours.com/tours', 'Explore All',
 '{first_name}');

-- ──── 2. Website Browsers ────
INSERT INTO content_templates (name, channel, status, segment_label, subject, body, body_plain, cta_url, cta_text, variables) VALUES
('Website Browsers — Exit Popup', 'web', 'approved', 'Website Browsers',
 NULL,
 '<div style="max-width:420px;padding:24px;background:#fff;border-radius:16px;box-shadow:0 8px 30px rgba(0,0,0,0.15);text-align:center"><h2 style="color:#1a1a2e;margin:0 0 8px">Wait! Don''t Miss Out 🎉</h2><p style="color:#555">Get <b>15% OFF</b> your first Dubai experience</p><div style="background:#f8f0ff;padding:16px;border-radius:8px;margin:16px 0;font-size:24px;font-weight:bold;color:#764ba2;letter-spacing:4px">BROWSE15</div><a href="{{cta_url}}" style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;text-decoration:none;border-radius:8px;font-weight:bold">Claim My Discount</a></div>',
 'Don''t miss out! Get 15% OFF with code BROWSE15.',
 'https://raynatours.com/tours', 'Claim Discount',
 '{cta_url}'),

('Website Browsers — Retarget Ad', 'web', 'approved', 'Website Browsers',
 NULL,
 '<div style="max-width:400px;padding:20px;background:#fff;border-radius:12px"><h3>Still Thinking About Dubai?</h3><p>Your dream experience is waiting. Prices start from just AED 99!</p><a href="https://raynatours.com/tours" style="display:inline-block;padding:12px 28px;background:#667eea;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold">Book Now</a></div>',
 'Still thinking about Dubai? Prices from AED 99. Book now!',
 'https://raynatours.com/tours', 'Book Now',
 '{first_name}'),

('Website Browsers — Best Sellers Email', 'email', 'approved', 'Website Browsers',
 'Dubai''s Best Experiences — Handpicked For You',
 '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><div style="background:linear-gradient(135deg,#ff6b6b,#ee5a24);padding:32px;border-radius:12px 12px 0 0;text-align:center"><h1 style="color:#fff;margin:0">Dubai''s Best Sellers</h1><p style="color:rgba(255,255,255,0.9)">Handpicked experiences you''ll love</p></div><div style="padding:24px;background:#fff"><p>Hi {{first_name}},</p><p>We saw you exploring our site! Here are the experiences everyone''s talking about:</p><div style="margin:16px 0;padding:16px;background:#f8f9fa;border-radius:8px;border-left:4px solid #667eea"><b>🏜️ Premium Desert Safari</b> — AED 149 • ⭐ 4.8 (2,400+ reviews)</div><div style="margin:16px 0;padding:16px;background:#f8f9fa;border-radius:8px;border-left:4px solid #667eea"><b>🚢 Marina Dhow Cruise</b> — AED 99 • ⭐ 4.7 (1,800+ reviews)</div><div style="margin:16px 0;padding:16px;background:#f8f9fa;border-radius:8px;border-left:4px solid #667eea"><b>🏙️ Dubai City Tour</b> — AED 129 • ⭐ 4.9 (3,100+ reviews)</div><div style="text-align:center;margin:24px 0"><a href="https://raynatours.com/tours" style="display:inline-block;padding:14px 32px;background:#667eea;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold">View All Experiences</a></div><p style="background:#fff3e0;padding:16px;border-radius:8px;text-align:center">🎁 Use code <b>BROWSE15</b> for 15% off your first booking!</p></div></div>',
 'Hi {{first_name}}, check out Dubai''s best sellers. Use BROWSE15 for 15% off!',
 'https://raynatours.com/tours', 'View All',
 '{first_name}');

-- ──── 3. WhatsApp First-Touch ────
INSERT INTO content_templates (name, channel, status, segment_label, subject, body, body_plain, cta_url, cta_text, variables) VALUES
('WA First-Touch — Quick Response', 'whatsapp', 'approved', 'WhatsApp First-Touch',
 NULL,
 'Hi {{first_name}}! 👋 Welcome to Rayna Tours — Dubai''s #1 tour operator.\n\nHow can I help you today?\n\n1️⃣ Tours & Activities\n2️⃣ Visa Services\n3️⃣ Hotel Bookings\n4️⃣ Custom Packages\n\nJust reply with a number or tell me what you''re looking for! 😊',
 'Hi {{first_name}}! Welcome to Rayna Tours. How can I help? Reply 1-4 or tell us what you need.',
 'https://raynatours.com', 'Browse Tours',
 '{first_name}'),

('WA First-Touch — Product Catalog', 'whatsapp', 'approved', 'WhatsApp First-Touch',
 NULL,
 '🌟 *Top Experiences in Dubai* 🌟\n\n🏜️ *Desert Safari* — AED 149\nBBQ dinner, camel ride, belly dance\n\n🚢 *Dhow Cruise* — AED 99\nDinner cruise with live entertainment\n\n🏙️ *City Tour* — AED 129\nBurj Khalifa, Old Dubai, Gold Souk\n\n🎢 *Theme Parks* — from AED 199\nFerrari World, Aquaventure, IMG\n\n✈️ *Visa Services* — from AED 299\nUAE tourist visa, fast processing\n\nUse code *WAFIRST10* for 10% off!\n\n👉 Book: https://raynatours.com/tours',
 'Top Dubai experiences from AED 99. Use WAFIRST10 for 10% off!',
 'https://raynatours.com/tours', 'Book Now',
 '{first_name}'),

('WA First-Touch — Register Invite Email', 'email', 'approved', 'WhatsApp First-Touch',
 'Complete Your Rayna Tours Profile — Get Exclusive Deals!',
 '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><div style="background:linear-gradient(135deg,#25D366,#128C7E);padding:32px;border-radius:12px 12px 0 0;text-align:center"><h1 style="color:#fff;margin:0">Hi {{first_name}}!</h1><p style="color:rgba(255,255,255,0.9)">Thanks for chatting with us on WhatsApp</p></div><div style="padding:24px;background:#fff"><p>Create your Rayna Tours account to unlock:</p><ul><li>✅ Faster bookings</li><li>✅ Exclusive member discounts</li><li>✅ Trip history & manage bookings</li><li>✅ Loyalty rewards program</li></ul><div style="text-align:center;margin:24px 0"><a href="https://raynatours.com/register" style="display:inline-block;padding:14px 32px;background:#25D366;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold">Create My Account</a></div></div></div>',
 'Hi {{first_name}}, create your Rayna Tours account to unlock exclusive deals and faster bookings.',
 'https://raynatours.com/register', 'Register Now',
 '{first_name}');

-- ──── 4. Fresh Cart Abandoners (0-3 days) ────
INSERT INTO content_templates (name, channel, status, segment_label, subject, body, body_plain, cta_url, cta_text, variables) VALUES
('Fresh Cart — WA Reminder 1h', 'whatsapp', 'approved', 'Fresh Cart Abandoners (0-3 days)',
 NULL,
 'Hi {{first_name}}! 👋\n\nYou left something behind! Your selected experience is still available:\n\n🎯 *{{product_name}}*\n💰 {{price}}\n\nComplete your booking before it sells out!\n\n👉 {{cart_url}}\n\n⏰ Prices may change — book now to lock in your rate.',
 'Hi {{first_name}}, you left {{product_name}} in your cart. Complete your booking: {{cart_url}}',
 '{{cart_url}}', 'Complete Booking',
 '{first_name,product_name,price,cart_url}'),

('Fresh Cart — Email Social Proof', 'email', 'approved', 'Fresh Cart Abandoners (0-3 days)',
 'You Left Something Amazing Behind! ⏰',
 '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><div style="background:linear-gradient(135deg,#ff6b6b,#ee5a24);padding:32px;border-radius:12px 12px 0 0;text-align:center"><h1 style="color:#fff;margin:0">Your Cart Is Waiting!</h1></div><div style="padding:24px;background:#fff"><p>Hi {{first_name}},</p><p>You were so close to booking an amazing experience:</p><div style="border:2px solid #667eea;border-radius:12px;padding:20px;margin:16px 0;text-align:center"><h3 style="margin:0 0 8px">{{product_name}}</h3><p style="font-size:24px;font-weight:bold;color:#667eea;margin:0">{{price}}</p><p style="color:#888;margin:4px 0">⭐ 4.8 average rating • 2,000+ happy travelers</p></div><div style="text-align:center;margin:24px 0"><a href="{{cart_url}}" style="display:inline-block;padding:14px 32px;background:#ff6b6b;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;font-size:16px">Complete My Booking</a></div><p style="background:#f8f9fa;padding:16px;border-radius:8px;text-align:center;font-size:14px">💡 <b>12 other travelers</b> are viewing this experience right now</p></div></div>',
 'Hi {{first_name}}, you left {{product_name}} ({{price}}) in your cart. Complete your booking now!',
 '{{cart_url}}', 'Complete Booking',
 '{first_name,product_name,price,cart_url}'),

('Fresh Cart — SMS Last Chance', 'sms', 'approved', 'Fresh Cart Abandoners (0-3 days)',
 NULL,
 'Rayna Tours: Hi {{first_name}}, your cart is about to expire! Complete your booking & get 10% OFF with code CART10. Book now: {{cart_url}}',
 'Your cart is about to expire! Use CART10 for 10% off. Book: {{cart_url}}',
 '{{cart_url}}', 'Book Now',
 '{first_name,cart_url}');

-- ──── 5. Stale Cart Abandoners (4-14 days) ────
INSERT INTO content_templates (name, channel, status, segment_label, subject, body, body_plain, cta_url, cta_text, variables) VALUES
('Stale Cart — Email 15% Off', 'email', 'approved', 'Stale Cart Abandoners (4-14 days)',
 'We Saved Your Cart + 15% OFF Just For You! 🎁',
 '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><div style="background:linear-gradient(135deg,#ffa726,#ff7043);padding:32px;border-radius:12px 12px 0 0;text-align:center"><h1 style="color:#fff;margin:0">Your Cart Is Still Here!</h1><p style="color:rgba(255,255,255,0.9)">And we''ve added a special treat 🎁</p></div><div style="padding:24px;background:#fff"><p>Hi {{first_name}},</p><p>Your selected experience is still available, and we''d love to sweeten the deal:</p><div style="background:linear-gradient(135deg,#fff3e0,#ffe0b2);padding:20px;border-radius:12px;text-align:center;margin:16px 0"><p style="font-size:32px;font-weight:bold;color:#e65100;margin:0">15% OFF</p><p style="margin:4px 0">Use code <b>CART15</b> at checkout</p></div><div style="text-align:center;margin:24px 0"><a href="{{cart_url}}" style="display:inline-block;padding:14px 32px;background:#ffa726;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold">Complete My Booking</a></div><p style="color:#888;text-align:center;font-size:13px">⏰ Offer expires in 48 hours</p></div></div>',
 'Hi {{first_name}}, your cart is waiting! Use CART15 for 15% off. Book: {{cart_url}}',
 '{{cart_url}}', 'Complete Booking',
 '{first_name,cart_url}'),

('Stale Cart — WA Alternatives', 'whatsapp', 'approved', 'Stale Cart Abandoners (4-14 days)',
 NULL,
 'Hi {{first_name}}! 😊\n\nStill thinking about your Dubai trip? We have some similar experiences you might love:\n\n🏜️ Desert Safari Premium — AED 199\n🚢 Luxury Dhow Cruise — AED 149\n🎢 Combo: Theme Park + City Tour — AED 299\n\nPlus, use code *CART15* for 15% off any booking!\n\n👉 Browse: https://raynatours.com/tours',
 'Hi {{first_name}}, here are similar experiences you''ll love. Use CART15 for 15% off!',
 'https://raynatours.com/tours', 'Browse',
 '{first_name}');

-- ──── 6. Active Enquirers ────
INSERT INTO content_templates (name, channel, status, segment_label, subject, body, body_plain, cta_url, cta_text, variables) VALUES
('Active Enquirers — WA Follow-Up', 'whatsapp', 'approved', 'Active Enquirers',
 NULL,
 'Hi {{first_name}}! 😊\n\nThank you for your enquiry about our Dubai experiences.\n\nI''d love to help you find the perfect activity. Based on what you''re looking for, I recommend:\n\n⭐ Our team has curated the best options for you\n\nWould you like me to send you a custom quote? Just reply YES!\n\nUse code *ENQUIRY10* for 10% off when you book 🎉',
 'Hi {{first_name}}, thanks for your enquiry. Reply YES for a custom quote. Use ENQUIRY10 for 10% off.',
 'https://raynatours.com/tours', 'Get Quote',
 '{first_name}'),

('Active Enquirers — Email Tailored Options', 'email', 'approved', 'Active Enquirers',
 'Your Personalized Dubai Experience Options Are Ready!',
 '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><div style="background:linear-gradient(135deg,#4caf50,#2e7d32);padding:32px;border-radius:12px 12px 0 0;text-align:center"><h1 style="color:#fff;margin:0">Your Options Are Ready!</h1></div><div style="padding:24px;background:#fff"><p>Hi {{first_name}},</p><p>Thanks for your interest! Based on your enquiry, we''ve curated these experiences:</p><div style="margin:16px 0;padding:16px;background:#e8f5e9;border-radius:8px;border-left:4px solid #4caf50"><b>Option 1: Popular Choice</b><br/>Desert Safari Premium — AED 199<br/>⭐ 4.8 (2,400+ reviews)</div><div style="margin:16px 0;padding:16px;background:#e8f5e9;border-radius:8px;border-left:4px solid #4caf50"><b>Option 2: Best Value</b><br/>City Tour + Dhow Cruise Combo — AED 199<br/>⭐ 4.9 (1,500+ reviews)</div><div style="text-align:center;margin:24px 0"><a href="https://raynatours.com/tours" style="display:inline-block;padding:14px 32px;background:#4caf50;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold">Book Now — 10% OFF with ENQUIRY10</a></div></div></div>',
 'Hi {{first_name}}, your personalized options are ready. Use ENQUIRY10 for 10% off!',
 'https://raynatours.com/tours', 'Book Now',
 '{first_name}'),

('Active Enquirers — SMS Limited Time', 'sms', 'approved', 'Active Enquirers',
 NULL,
 'Rayna Tours: {{first_name}}, your enquiry options are ready! Book in 48hrs & save 10% with code ENQUIRY10. Browse: https://raynatours.com/tours',
 'Your options are ready! Book in 48hrs with ENQUIRY10 for 10% off.',
 'https://raynatours.com/tours', 'Book',
 '{first_name}');

-- ──── 7. Hesitant Browsers ────
INSERT INTO content_templates (name, channel, status, segment_label, subject, body, body_plain, cta_url, cta_text, variables) VALUES
('Hesitant Browsers — Price Drop Email', 'email', 'approved', 'Hesitant Browsers',
 '🔥 Price Drop Alert — Your Viewed Experiences Are On Sale!',
 '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><div style="background:linear-gradient(135deg,#e91e63,#c2185b);padding:32px;border-radius:12px 12px 0 0;text-align:center"><h1 style="color:#fff;margin:0">🔥 Price Drop Alert!</h1></div><div style="padding:24px;background:#fff"><p>Hi {{first_name}},</p><p>Great news! Experiences you viewed recently have dropped in price:</p><div style="text-align:center;margin:24px 0"><a href="https://raynatours.com/tours" style="display:inline-block;padding:14px 32px;background:#e91e63;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold">See Updated Prices</a></div><p style="background:#fce4ec;padding:16px;border-radius:8px;text-align:center">🎁 EXTRA 20% OFF with code <b>FLASH20</b> — 24 hours only!</p></div></div>',
 'Hi {{first_name}}, prices dropped on experiences you viewed! Extra 20% off with FLASH20.',
 'https://raynatours.com/tours', 'See Prices',
 '{first_name}'),

('Hesitant Browsers — Push Flash Sale', 'push', 'approved', 'Hesitant Browsers',
 NULL,
 '⚡ Flash Sale! 20% OFF Dubai experiences you browsed. Code: FLASH20. Ends tonight! 🏃',
 'Flash Sale! 20% OFF with FLASH20. Ends tonight!',
 'https://raynatours.com/tours', 'Shop Now',
 '{first_name}');

-- ──── 8. Payment Failed ────
INSERT INTO content_templates (name, channel, status, segment_label, subject, body, body_plain, cta_url, cta_text, variables) VALUES
('Payment Failed — WA Retry', 'whatsapp', 'approved', 'Payment Failed',
 NULL,
 'Hi {{first_name}},\n\nWe noticed your payment didn''t go through for your booking. No worries — these things happen! 😊\n\nHere''s your secure payment link to try again:\n👉 {{payment_url}}\n\nAlternatively, you can pay via:\n💳 Credit/Debit Card\n🏦 Bank Transfer\n💰 Cash on arrival\n\nNeed help? Just reply here and our team will assist you.\n\nPlus, use code *PAYRETRY* for AED 50 off! 🎁',
 'Hi {{first_name}}, your payment didn''t go through. Retry: {{payment_url}} Use PAYRETRY for AED 50 off.',
 '{{payment_url}}', 'Retry Payment',
 '{first_name,payment_url}'),

('Payment Failed — Email Alt Methods', 'email', 'approved', 'Payment Failed',
 'Oops! Your Payment Needs Attention — We''re Here to Help',
 '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><div style="background:linear-gradient(135deg,#ff9800,#f57c00);padding:32px;border-radius:12px 12px 0 0;text-align:center"><h1 style="color:#fff;margin:0">Payment Didn''t Go Through</h1><p style="color:rgba(255,255,255,0.9)">Don''t worry — we''ve saved your booking!</p></div><div style="padding:24px;background:#fff"><p>Hi {{first_name}},</p><p>Your recent payment attempt was unsuccessful. Your booking is still reserved for the next 24 hours.</p><h3>Try Again With These Options:</h3><div style="margin:12px 0;padding:12px;background:#f8f9fa;border-radius:8px">💳 <b>Credit/Debit Card</b></div><div style="margin:12px 0;padding:12px;background:#f8f9fa;border-radius:8px">🏦 <b>Bank Transfer</b></div><div style="margin:12px 0;padding:12px;background:#f8f9fa;border-radius:8px">💰 <b>Apple Pay / Google Pay</b></div><div style="text-align:center;margin:24px 0"><a href="{{payment_url}}" style="display:inline-block;padding:14px 32px;background:#ff9800;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold">Complete Payment — AED 50 OFF (PAYRETRY)</a></div></div></div>',
 'Hi {{first_name}}, your payment didn''t go through. Retry with alternative methods. Use PAYRETRY for AED 50 off.',
 '{{payment_url}}', 'Complete Payment',
 '{first_name,payment_url}'),

('Payment Failed — SMS Support', 'sms', 'approved', 'Payment Failed',
 NULL,
 'Rayna Tours: {{first_name}}, your payment needs attention. Retry now & save AED 50 with code PAYRETRY: {{payment_url}} Need help? Call +971-4-XXX-XXXX',
 'Payment needs attention. Use PAYRETRY for AED 50 off. Retry: {{payment_url}}',
 '{{payment_url}}', 'Retry',
 '{first_name,payment_url}');

-- ──── 9. Registered Not Booked ────
INSERT INTO content_templates (name, channel, status, segment_label, subject, body, body_plain, cta_url, cta_text, variables) VALUES
('Registered Not Booked — Welcome Email', 'email', 'approved', 'Registered Not Booked',
 'Welcome to Rayna Tours — Here''s 15% OFF Your First Booking! 🎉',
 '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><div style="background:linear-gradient(135deg,#667eea,#764ba2);padding:32px;border-radius:12px 12px 0 0;text-align:center"><h1 style="color:#fff;margin:0">Welcome Aboard! 🎉</h1></div><div style="padding:24px;background:#fff"><p>Hi {{first_name}},</p><p>Thanks for registering with Rayna Tours! We''re thrilled to have you.</p><p>To kick things off, here''s an exclusive welcome offer:</p><div style="background:linear-gradient(135deg,#667eea,#764ba2);padding:24px;border-radius:12px;text-align:center;margin:16px 0"><p style="color:#fff;font-size:32px;font-weight:bold;margin:0">15% OFF</p><p style="color:rgba(255,255,255,0.9);margin:4px 0">Your first booking • Code: <b>FIRST15</b></p></div><div style="text-align:center;margin:24px 0"><a href="https://raynatours.com/tours" style="display:inline-block;padding:14px 32px;background:#667eea;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold">Start Exploring</a></div></div></div>',
 'Welcome to Rayna Tours! Use FIRST15 for 15% off your first booking.',
 'https://raynatours.com/tours', 'Explore',
 '{first_name}'),

('Registered Not Booked — WA Best Sellers', 'whatsapp', 'approved', 'Registered Not Booked',
 NULL,
 'Hey {{first_name}}! 😊\n\nWelcome to the Rayna Tours family! Here are our best sellers to get you started:\n\n🔥 *Most Popular:*\n🏜️ Desert Safari — AED 149\n🚢 Dhow Cruise Dinner — AED 99\n🏙️ Full Day City Tour — AED 129\n\n🎁 Use code *FIRST15* for 15% off your first booking!\n\n👉 Browse all: https://raynatours.com/tours',
 'Welcome! Here are our best sellers. Use FIRST15 for 15% off.',
 'https://raynatours.com/tours', 'Browse',
 '{first_name}'),

('Registered Not Booked — Push First Booking', 'push', 'approved', 'Registered Not Booked',
 NULL,
 '🎁 {{first_name}}, your 15% welcome discount is waiting! Book your first Dubai experience now. Code: FIRST15',
 'Your 15% welcome discount is waiting! Code: FIRST15',
 'https://raynatours.com/tours', 'Book Now',
 '{first_name}');

-- ──── 10. New Customers (0-30 days) ────
INSERT INTO content_templates (name, channel, status, segment_label, subject, body, body_plain, cta_url, cta_text, variables) VALUES
('New Customer — Confirmation Email', 'email', 'approved', 'New Customers (0-30 days)',
 'Booking Confirmed! 🎉 Here''s Everything You Need',
 '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><div style="background:linear-gradient(135deg,#4caf50,#2e7d32);padding:32px;border-radius:12px 12px 0 0;text-align:center"><h1 style="color:#fff;margin:0">Booking Confirmed! 🎉</h1></div><div style="padding:24px;background:#fff"><p>Hi {{first_name}},</p><p>Your adventure is all set! Here are some tips to make it unforgettable:</p><ul><li>📍 Arrive 15 mins early</li><li>📷 Bring your camera</li><li>☀️ Wear comfortable clothes & sunscreen</li><li>💧 Stay hydrated</li></ul><h3>Enhance Your Trip:</h3><div style="margin:12px 0;padding:12px;background:#e8f5e9;border-radius:8px">🏜️ <b>Add Desert Safari</b> — AED 149 (10% off with WELCOME10)</div><div style="margin:12px 0;padding:12px;background:#e8f5e9;border-radius:8px">🚢 <b>Add Dhow Cruise</b> — AED 99 (10% off with WELCOME10)</div><div style="text-align:center;margin:24px 0"><a href="https://raynatours.com/tours" style="display:inline-block;padding:14px 32px;background:#4caf50;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold">Add More Experiences</a></div></div></div>',
 'Booking confirmed! Enhance your trip with add-ons. Use WELCOME10 for 10% off.',
 'https://raynatours.com/tours', 'Add Experiences',
 '{first_name}'),

('New Customer — WA Cross-Sell', 'whatsapp', 'approved', 'New Customers (0-30 days)',
 NULL,
 'Hi {{first_name}}! 🎉\n\nYour booking is confirmed! We''re excited for your upcoming experience.\n\nMake the most of your Dubai trip with these add-ons:\n\n🏜️ Desert Safari — AED 149\n🚢 Dhow Cruise — AED 99\n📸 Photography Package — AED 199\n\nUse code *WELCOME10* for 10% off!\n\nNeed any help? Just message us here 😊',
 'Hi {{first_name}}, booking confirmed! Add more experiences with WELCOME10 for 10% off.',
 'https://raynatours.com/tours', 'Add Experiences',
 '{first_name}');

-- ──── 11. Post-Trip Review Window ────
INSERT INTO content_templates (name, channel, status, segment_label, subject, body, body_plain, cta_url, cta_text, variables) VALUES
('Post-Trip — Review Email', 'email', 'approved', 'Post-Trip Review Window',
 'How Was Your Experience? 🌟 Share & Get 15% OFF Next Trip!',
 '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><div style="background:linear-gradient(135deg,#ffd54f,#ffb300);padding:32px;border-radius:12px 12px 0 0;text-align:center"><h1 style="color:#333;margin:0">How Was Your Trip? 🌟</h1></div><div style="padding:24px;background:#fff"><p>Hi {{first_name}},</p><p>We hope you had an amazing time! Your feedback helps us improve and helps other travelers discover great experiences.</p><div style="text-align:center;margin:24px 0"><a href="https://raynatours.com/review" style="display:inline-block;padding:14px 32px;background:#ffb300;color:#333;text-decoration:none;border-radius:8px;font-weight:bold;font-size:16px">⭐ Leave a Review</a></div><p style="background:#fff8e1;padding:16px;border-radius:8px;text-align:center">🎁 Share your review & get <b>15% OFF</b> your next booking! Code: <b>REVIEW15</b></p></div></div>',
 'How was your trip? Leave a review and get 15% off your next booking with REVIEW15!',
 'https://raynatours.com/review', 'Leave Review',
 '{first_name}'),

('Post-Trip — WA Photo Share', 'whatsapp', 'approved', 'Post-Trip Review Window',
 NULL,
 'Hi {{first_name}}! 😊\n\nWe hope you loved your experience! 📸\n\nGot any great photos from your trip? Share them with us and we''ll feature the best ones on our page!\n\nAlso, we''d love your honest review:\n👉 https://raynatours.com/review\n\nAs a thank you, here''s *15% off* your next booking: *REVIEW15* 🎁',
 'Share your trip photos and get 15% off your next booking with REVIEW15!',
 'https://raynatours.com/review', 'Review',
 '{first_name}'),

('Post-Trip — Push Rebook', 'push', 'approved', 'Post-Trip Review Window',
 NULL,
 '🏖️ Ready for another adventure, {{first_name}}? Book again & get 15% OFF with code REVIEW15!',
 'Book again and get 15% off with REVIEW15!',
 'https://raynatours.com/tours', 'Book Again',
 '{first_name}');

-- ──── 12. One-Time Buyers (31-90 days) ────
INSERT INTO content_templates (name, channel, status, segment_label, subject, body, body_plain, cta_url, cta_text, variables) VALUES
('One-Time Buyer — Recommendations Email', 'email', 'approved', 'One-Time Buyers (31-90 days)',
 'Loved Your Last Trip? Here Are Your Next Adventures! 🗺️',
 '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><div style="background:linear-gradient(135deg,#5c7cfa,#3f51b5);padding:32px;border-radius:12px 12px 0 0;text-align:center"><h1 style="color:#fff;margin:0">Your Next Adventure Awaits 🗺️</h1></div><div style="padding:24px;background:#fff"><p>Hi {{first_name}},</p><p>Travelers like you also loved these experiences:</p><div style="margin:16px 0;padding:16px;background:#e8eaf6;border-radius:8px;border-left:4px solid #5c7cfa"><b>🏜️ Overnight Desert Camp</b> — AED 399</div><div style="margin:16px 0;padding:16px;background:#e8eaf6;border-radius:8px;border-left:4px solid #5c7cfa"><b>🚁 Helicopter Tour</b> — AED 599</div><div style="margin:16px 0;padding:16px;background:#e8eaf6;border-radius:8px;border-left:4px solid #5c7cfa"><b>🌊 Yacht Charter</b> — AED 799</div><div style="text-align:center;margin:24px 0"><a href="https://raynatours.com/tours" style="display:inline-block;padding:14px 32px;background:#5c7cfa;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold">Explore & Save 10% (SECOND10)</a></div></div></div>',
 'Loved your last trip? Explore similar experiences. Use SECOND10 for 10% off!',
 'https://raynatours.com/tours', 'Explore',
 '{first_name}'),

('One-Time Buyer — WA Similar Picks', 'whatsapp', 'approved', 'One-Time Buyers (31-90 days)',
 NULL,
 'Hi {{first_name}}! 👋\n\nTravelers who booked similar experiences also loved:\n\n🏜️ *Overnight Desert Camp* — AED 399\n🚁 *Helicopter Tour* — AED 599\n🌊 *Yacht Charter* — AED 799\n\nReady for round 2? Use code *SECOND10* for 10% off! 🎉\n\n👉 https://raynatours.com/tours',
 'Travelers like you also loved these experiences. Use SECOND10 for 10% off!',
 'https://raynatours.com/tours', 'Book',
 '{first_name}'),

('One-Time Buyer — SMS Loyalty', 'sms', 'approved', 'One-Time Buyers (31-90 days)',
 NULL,
 'Rayna Tours: {{first_name}}, book your 2nd experience & earn double loyalty points! 10% off with SECOND10: https://raynatours.com/tours',
 'Book your 2nd experience with SECOND10 for 10% off + double loyalty points!',
 'https://raynatours.com/tours', 'Book',
 '{first_name}');

-- ──── 13. Repeat Buyers ────
INSERT INTO content_templates (name, channel, status, segment_label, subject, body, body_plain, cta_url, cta_text, variables) VALUES
('Repeat Buyers — Loyalty Email', 'email', 'approved', 'Repeat Buyers',
 'You''re a Valued Member! Exclusive Loyalty Rewards Inside 🏆',
 '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><div style="background:linear-gradient(135deg,#9c27b0,#7b1fa2);padding:32px;border-radius:12px 12px 0 0;text-align:center"><h1 style="color:#fff;margin:0">Loyalty Rewards 🏆</h1></div><div style="padding:24px;background:#fff"><p>Hi {{first_name}},</p><p>As one of our valued repeat customers, you''re now eligible for our loyalty program:</p><ul><li>🎯 Priority booking access</li><li>💰 10% off every booking (LOYAL10)</li><li>🎁 Birthday special offers</li><li>⭐ Free upgrades on select experiences</li></ul><div style="text-align:center;margin:24px 0"><a href="https://raynatours.com/loyalty" style="display:inline-block;padding:14px 32px;background:#9c27b0;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold">Join Loyalty Program</a></div></div></div>',
 'You''re eligible for our loyalty program! 10% off every booking with LOYAL10.',
 'https://raynatours.com/loyalty', 'Join Program',
 '{first_name}'),

('Repeat Buyers — WA Premium Upgrade', 'whatsapp', 'approved', 'Repeat Buyers',
 NULL,
 'Hi {{first_name}}! 🌟\n\nAs one of our top customers, we''d love to offer you a *free upgrade* on your next booking!\n\n🏜️ Desert Safari → *Premium VIP Safari*\n🚢 Dhow Cruise → *Luxury Yacht Dinner*\n🏙️ City Tour → *Private Guided Tour*\n\nJust mention "UPGRADE" when booking or use code *LOYAL10* for 10% off!\n\n👉 https://raynatours.com/tours',
 'Free upgrade on your next booking! Use LOYAL10 for 10% off.',
 'https://raynatours.com/tours', 'Book & Upgrade',
 '{first_name}');

-- ──── 14. Frequent Travelers (4+ bookings) ────
INSERT INTO content_templates (name, channel, status, segment_label, subject, body, body_plain, cta_url, cta_text, variables) VALUES
('Frequent Traveler — WA VIP Concierge', 'whatsapp', 'approved', 'Frequent Travelers (4+ bookings)',
 NULL,
 'Hi {{first_name}}! 🌟\n\nWelcome to the *Rayna VIP Club*! As one of our most valued travelers, you now have:\n\n👑 Dedicated concierge support\n🎯 Priority bookings\n💎 Exclusive experiences\n🎁 15% off always: *VIP15*\n\nI''m your personal concierge — message me anytime for:\n• Custom itineraries\n• Group bookings\n• Special requests\n\nHow can I make your next trip extraordinary? ✨',
 'Welcome to Rayna VIP Club! 15% off with VIP15. I''m your dedicated concierge.',
 'https://raynatours.com/vip', 'VIP Access',
 '{first_name}'),

('Frequent Traveler — Exclusive Email', 'email', 'approved', 'Frequent Travelers (4+ bookings)',
 '👑 VIP Exclusive: New Experiences Just For You',
 '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><div style="background:linear-gradient(135deg,#ffd700,#daa520);padding:32px;border-radius:12px 12px 0 0;text-align:center"><h1 style="color:#333;margin:0">👑 VIP Exclusive</h1><p style="color:#555">Experiences reserved for our top travelers</p></div><div style="padding:24px;background:#fff"><p>Hi {{first_name}},</p><p>As a Rayna VIP, you get early access to our newest premium experiences:</p><div style="margin:16px 0;padding:16px;background:#fffde7;border-radius:8px;border-left:4px solid #ffd700"><b>🏝️ Private Island Escape</b> — AED 1,999<br/><i>Available only to VIP members</i></div><div style="margin:16px 0;padding:16px;background:#fffde7;border-radius:8px;border-left:4px solid #ffd700"><b>🚁 Sunset Helicopter + Fine Dining</b> — AED 2,499<br/><i>Limited to 10 bookings/month</i></div><div style="text-align:center;margin:24px 0"><a href="https://raynatours.com/vip-experiences" style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#ffd700,#daa520);color:#333;text-decoration:none;border-radius:8px;font-weight:bold">View VIP Experiences — 15% OFF (VIP15)</a></div></div></div>',
 'VIP exclusive new experiences just for you. Use VIP15 for 15% off.',
 'https://raynatours.com/vip-experiences', 'View VIP',
 '{first_name}'),

('Frequent Traveler — SMS Early Access', 'sms', 'approved', 'Frequent Travelers (4+ bookings)',
 NULL,
 'Rayna VIP: {{first_name}}, new premium experiences just launched! Get early access + 15% off with VIP15. Book: https://raynatours.com/vip-experiences',
 'New premium experiences! Early access + 15% off with VIP15.',
 'https://raynatours.com/vip-experiences', 'Book',
 '{first_name}');

-- ──── 15. High Spenders (5000+ AED) ────
INSERT INTO content_templates (name, channel, status, segment_label, subject, body, body_plain, cta_url, cta_text, variables) VALUES
('High Spender — Premium Catalog Email', 'email', 'approved', 'High Spenders (5000+ AED)',
 '💎 Premium Collection — Curated Luxury Experiences',
 '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><div style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:32px;border-radius:12px 12px 0 0;text-align:center"><h1 style="color:#ffd700;margin:0">💎 Premium Collection</h1></div><div style="padding:24px;background:#fff"><p>Hi {{first_name}},</p><p>As a distinguished Rayna Tours patron, we''ve curated our finest experiences for you:</p><div style="margin:16px 0;padding:20px;background:linear-gradient(135deg,#f5f5f5,#eeeeee);border-radius:12px"><b>🏝️ Maldives Luxury Package</b> — from AED 8,999<br/>Private villa, sunset cruise, spa</div><div style="margin:16px 0;padding:20px;background:linear-gradient(135deg,#f5f5f5,#eeeeee);border-radius:12px"><b>🚁 Platinum Sky Experience</b> — AED 3,499<br/>Helicopter tour + rooftop fine dining</div><div style="text-align:center;margin:24px 0"><a href="https://raynatours.com/premium" style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#1a1a2e,#16213e);color:#ffd700;text-decoration:none;border-radius:8px;font-weight:bold">View Premium Collection — 20% OFF (PREMIUM20)</a></div></div></div>',
 'Premium luxury experiences curated for you. Use PREMIUM20 for 20% off.',
 'https://raynatours.com/premium', 'View Premium',
 '{first_name}'),

('High Spender — WA Luxury Invite', 'whatsapp', 'approved', 'High Spenders (5000+ AED)',
 NULL,
 'Hi {{first_name}},\n\nAs one of our most valued guests, I''d like to personally invite you to our *exclusive experiences*:\n\n💎 *Platinum Sky Experience* — AED 3,499\nHelicopter tour + rooftop fine dining\n\n🏝️ *Private Island Day* — AED 1,999\nBeach, water sports, BBQ\n\n🚤 *Luxury Yacht Evening* — AED 2,499\nPrivate yacht + gourmet dinner\n\nUse code *PREMIUM20* for an exclusive 20% off.\n\nShall I arrange something special for you? 🌟',
 'Exclusive luxury experiences for you. Use PREMIUM20 for 20% off.',
 'https://raynatours.com/premium', 'View',
 '{first_name}');

-- ──── 16. Visa-Only → Tour Cross-Sell ────
INSERT INTO content_templates (name, channel, status, segment_label, subject, body, body_plain, cta_url, cta_text, variables) VALUES
('Visa Cross-Sell — Tour Reco Email', 'email', 'approved', 'Visa-Only → Tour Cross-Sell',
 'Your Visa Is Sorted! Now Explore The Best of Dubai 🏙️',
 '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><div style="background:linear-gradient(135deg,#00bcd4,#00838f);padding:32px;border-radius:12px 12px 0 0;text-align:center"><h1 style="color:#fff;margin:0">Visa ✅ Now Plan Your Trip!</h1></div><div style="padding:24px;background:#fff"><p>Hi {{first_name}},</p><p>Now that your visa is sorted, make the most of your Dubai visit:</p><div style="margin:16px 0;padding:16px;background:#e0f7fa;border-radius:8px;border-left:4px solid #00bcd4"><b>🏜️ Desert Safari</b> — AED 149 (bestseller!)</div><div style="margin:16px 0;padding:16px;background:#e0f7fa;border-radius:8px;border-left:4px solid #00bcd4"><b>🚢 Dhow Cruise</b> — AED 99</div><div style="margin:16px 0;padding:16px;background:#e0f7fa;border-radius:8px;border-left:4px solid #00bcd4"><b>🎢 Theme Park Pass</b> — AED 199</div><div style="text-align:center;margin:24px 0"><a href="https://raynatours.com/tours" style="display:inline-block;padding:14px 32px;background:#00bcd4;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold">Browse Tours — AED 100 OFF (VISADEAL)</a></div></div></div>',
 'Visa sorted! Plan your Dubai trip with tours from AED 99. Use VISADEAL for AED 100 off.',
 'https://raynatours.com/tours', 'Browse Tours',
 '{first_name}'),

('Visa Cross-Sell — WA Bundle', 'whatsapp', 'approved', 'Visa-Only → Tour Cross-Sell',
 NULL,
 'Hi {{first_name}}! 🎉\n\nYour visa is processed! Now let''s plan the fun part 🏖️\n\n*Best Dubai Experiences:*\n🏜️ Desert Safari — AED 149\n🚢 Dhow Cruise — AED 99\n🏙️ City Tour — AED 129\n🎢 Theme Parks — from AED 199\n\n💰 Use code *VISADEAL* for AED 100 off your first tour!\n\n👉 https://raynatours.com/tours',
 'Visa processed! Book tours with VISADEAL for AED 100 off.',
 'https://raynatours.com/tours', 'Book Tour',
 '{first_name}');

-- ──── 17. Tour-Only → Visa Cross-Sell ────
INSERT INTO content_templates (name, channel, status, segment_label, subject, body, body_plain, cta_url, cta_text, variables) VALUES
('Tour Visa Cross-Sell — Email', 'email', 'approved', 'Tour-Only → Visa Cross-Sell',
 'Need a Visa? We''ve Got You Covered — AED 75 OFF! ✈️',
 '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><div style="background:linear-gradient(135deg,#26a69a,#00897b);padding:32px;border-radius:12px 12px 0 0;text-align:center"><h1 style="color:#fff;margin:0">Visa Made Easy ✈️</h1></div><div style="padding:24px;background:#fff"><p>Hi {{first_name}},</p><p>Planning another trip? Let us handle your visa so you can focus on the fun:</p><ul><li>✅ Fast processing (2-5 business days)</li><li>✅ 100% online application</li><li>✅ Expert document guidance</li><li>✅ UAE, Schengen, UK, US & more</li></ul><div style="text-align:center;margin:24px 0"><a href="https://raynatours.com/visa" style="display:inline-block;padding:14px 32px;background:#26a69a;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold">Apply Now — AED 75 OFF (TOURDEAL)</a></div></div></div>',
 'Need a visa? Fast processing from Rayna Tours. Use TOURDEAL for AED 75 off.',
 'https://raynatours.com/visa', 'Apply Now',
 '{first_name}'),

('Tour Visa Cross-Sell — WA', 'whatsapp', 'approved', 'Tour-Only → Visa Cross-Sell',
 NULL,
 'Hi {{first_name}}! ✈️\n\nPlanning your next trip? We can handle your visa!\n\n🌍 *Visa Services:*\n• UAE Tourist Visa — from AED 299\n• Schengen Visa — from AED 499\n• UK Visa — from AED 599\n\n✅ Fast processing\n✅ Expert guidance\n✅ Online application\n\nUse code *TOURDEAL* for AED 75 off!\n\n👉 Apply: https://raynatours.com/visa',
 'Need a visa? Apply with TOURDEAL for AED 75 off.',
 'https://raynatours.com/visa', 'Apply',
 '{first_name}');

-- ──── 18. Cooling Down (31-60 days) ────
INSERT INTO content_templates (name, channel, status, segment_label, subject, body, body_plain, cta_url, cta_text, variables) VALUES
('Cooling Down — What''s New Email', 'email', 'approved', 'Cooling Down (31-60 days)',
 'What''s New at Rayna Tours — Fresh Experiences Await! 🌟',
 '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><div style="background:linear-gradient(135deg,#42a5f5,#1e88e5);padding:32px;border-radius:12px 12px 0 0;text-align:center"><h1 style="color:#fff;margin:0">What''s New! 🌟</h1></div><div style="padding:24px;background:#fff"><p>Hi {{first_name}},</p><p>It''s been a while! Here''s what''s new since your last visit:</p><div style="margin:16px 0;padding:16px;background:#e3f2fd;border-radius:8px"><b>🆕 Night Desert Safari</b> — Under the stars experience</div><div style="margin:16px 0;padding:16px;background:#e3f2fd;border-radius:8px"><b>🆕 Ain Dubai Experience</b> — World''s largest observation wheel</div><div style="text-align:center;margin:24px 0"><a href="https://raynatours.com/tours" style="display:inline-block;padding:14px 32px;background:#42a5f5;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold">Explore New Experiences — 10% OFF (COOL10)</a></div></div></div>',
 'Check out what''s new at Rayna Tours! Use COOL10 for 10% off.',
 'https://raynatours.com/tours', 'Explore',
 '{first_name}'),

('Cooling Down — WA Soft Reminder', 'whatsapp', 'approved', 'Cooling Down (31-60 days)',
 NULL,
 'Hi {{first_name}}! 😊\n\nIt''s been a while since your last adventure. We miss you!\n\nHere''s what''s trending right now:\n🌙 Night Desert Safari ⭐ 4.9\n🎡 Ain Dubai Experience ⭐ 4.8\n🚤 Speed Boat Tour ⭐ 4.7\n\nUse code *COOL10* for 10% off your next booking!\n\n👉 https://raynatours.com/tours',
 'We miss you! Check out trending experiences. Use COOL10 for 10% off.',
 'https://raynatours.com/tours', 'Book',
 '{first_name}');

-- ──── 19. At Risk (61-120 days) ────
INSERT INTO content_templates (name, channel, status, segment_label, subject, body, body_plain, cta_url, cta_text, variables) VALUES
('At Risk — We Miss You Email', 'email', 'approved', 'At Risk (61-120 days)',
 'We Miss You, {{first_name}}! Here''s 15% OFF to Come Back 💝',
 '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><div style="background:linear-gradient(135deg,#ef5350,#c62828);padding:32px;border-radius:12px 12px 0 0;text-align:center"><h1 style="color:#fff;margin:0">We Miss You! 💝</h1></div><div style="padding:24px;background:#fff"><p>Hi {{first_name}},</p><p>It''s been a while since your last adventure with us. We''d love to welcome you back!</p><div style="background:linear-gradient(135deg,#ffebee,#ffcdd2);padding:24px;border-radius:12px;text-align:center;margin:16px 0"><p style="font-size:32px;font-weight:bold;color:#c62828;margin:0">15% OFF</p><p style="margin:4px 0">Your comeback booking • Code: <b>RISK15</b></p></div><div style="text-align:center;margin:24px 0"><a href="https://raynatours.com/tours" style="display:inline-block;padding:14px 32px;background:#ef5350;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold">Book Now — 15% OFF</a></div></div></div>',
 'We miss you! Come back with 15% off using code RISK15.',
 'https://raynatours.com/tours', 'Book Now',
 '{first_name}'),

('At Risk — WA Comeback Deal', 'whatsapp', 'approved', 'At Risk (61-120 days)',
 NULL,
 'Hi {{first_name}}! 👋\n\nWe noticed it''s been a while since your last trip. We''d love to welcome you back with an exclusive deal:\n\n🎁 *15% OFF* any experience\nCode: *RISK15*\n\nHere''s what''s popular right now:\n🏜️ Desert Safari — AED 149\n🚢 Dhow Cruise — AED 99\n\nReady to plan your comeback? 😊\n\n👉 https://raynatours.com/tours',
 'We miss you! Get 15% off your comeback booking with RISK15.',
 'https://raynatours.com/tours', 'Book',
 '{first_name}'),

('At Risk — SMS Last Chance', 'sms', 'approved', 'At Risk (61-120 days)',
 NULL,
 'Rayna Tours: {{first_name}}, we miss you! Come back & save 15% with code RISK15. Valid 7 days only: https://raynatours.com/tours',
 'We miss you! 15% off with RISK15. Valid 7 days.',
 'https://raynatours.com/tours', 'Book',
 '{first_name}');

-- ──── 20. Hibernating (121-180 days) ────
INSERT INTO content_templates (name, channel, status, segment_label, subject, body, body_plain, cta_url, cta_text, variables) VALUES
('Hibernating — Deep Discount Email', 'email', 'approved', 'Hibernating (121-180 days)',
 'A LOT Has Changed! Come Back & Save 20% 🎉',
 '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><div style="background:linear-gradient(135deg,#7e57c2,#512da8);padding:32px;border-radius:12px 12px 0 0;text-align:center"><h1 style="color:#fff;margin:0">So Much Has Changed! 🎉</h1></div><div style="padding:24px;background:#fff"><p>Hi {{first_name}},</p><p>Since your last visit, we''ve added amazing new experiences. Here''s your exclusive comeback offer:</p><div style="background:#ede7f6;padding:24px;border-radius:12px;text-align:center;margin:16px 0"><p style="font-size:36px;font-weight:bold;color:#512da8;margin:0">20% OFF</p><p style="margin:4px 0">Code: <b>HIBER20</b></p></div><div style="text-align:center;margin:24px 0"><a href="https://raynatours.com/tours" style="display:inline-block;padding:14px 32px;background:#7e57c2;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold">Rediscover Dubai</a></div></div></div>',
 'A lot has changed since your last visit! Come back with 20% off: HIBER20.',
 'https://raynatours.com/tours', 'Explore',
 '{first_name}'),

('Hibernating — WA New Experiences', 'whatsapp', 'approved', 'Hibernating (121-180 days)',
 NULL,
 'Hi {{first_name}}! 😊\n\nLong time no see! We''ve been busy adding new experiences:\n\n🌙 *Night Desert Safari* — NEW!\n🎡 *Ain Dubai* — World''s largest wheel\n🚤 *Speed Boat Tour* — Adrenaline rush!\n🏖️ *Private Beach Day* — Ultimate relaxation\n\n🎁 Welcome back with *20% OFF*: *HIBER20*\n\n👉 https://raynatours.com/tours',
 'Long time no see! New experiences + 20% off with HIBER20.',
 'https://raynatours.com/tours', 'Explore',
 '{first_name}'),

('Hibernating — SMS Final Reminder', 'sms', 'approved', 'Hibernating (121-180 days)',
 NULL,
 'Rayna Tours: {{first_name}}, 20% OFF awaits! New experiences added since your last visit. Use HIBER20: https://raynatours.com/tours',
 'New experiences + 20% off with HIBER20!',
 'https://raynatours.com/tours', 'Book',
 '{first_name}');

-- ──── 21. Lost High-Value (180+ days, 3000+ AED) ────
INSERT INTO content_templates (name, channel, status, segment_label, subject, body, body_plain, cta_url, cta_text, variables) VALUES
('Lost VIP — Personal Letter Email', 'email', 'approved', 'Lost High-Value (180+ days, 3000+ AED)',
 'A Personal Note From the Rayna Tours Team 💌',
 '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><div style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:32px;border-radius:12px 12px 0 0;text-align:center"><h1 style="color:#ffd700;margin:0">A Personal Note 💌</h1></div><div style="padding:24px;background:#fff"><p>Dear {{first_name}},</p><p>As one of our most valued guests, I wanted to personally reach out. We''ve truly missed having you explore with us.</p><p>As a token of our appreciation for your past travels with Rayna Tours, we''d like to offer you:</p><div style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:24px;border-radius:12px;text-align:center;margin:16px 0"><p style="color:#ffd700;font-size:32px;font-weight:bold;margin:0">25% OFF</p><p style="color:#fff;margin:4px 0">Your VIP comeback package • Code: <b>VIPBACK25</b></p></div><div style="text-align:center;margin:24px 0"><a href="https://raynatours.com/vip-comeback" style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#ffd700,#daa520);color:#333;text-decoration:none;border-radius:8px;font-weight:bold">Claim VIP Package</a></div><p style="font-style:italic;color:#555">Warm regards,<br/>The Rayna Tours Team</p></div></div>',
 'Dear {{first_name}}, we miss you! Here''s an exclusive 25% off VIP comeback package: VIPBACK25.',
 'https://raynatours.com/vip-comeback', 'Claim Package',
 '{first_name}'),

('Lost VIP — WA Comeback Package', 'whatsapp', 'approved', 'Lost High-Value (180+ days, 3000+ AED)',
 NULL,
 'Dear {{first_name}},\n\nI''m reaching out personally because you''re one of our most valued guests.\n\nWe''ve prepared an exclusive *VIP Comeback Package* just for you:\n\n👑 *25% OFF* any experience\n🎁 Free upgrade on premium bookings\n🚗 Complimentary hotel pickup\n\nCode: *VIPBACK25*\n\nWould you like me to curate a personalized itinerary for your next visit? 🌟',
 'VIP comeback package: 25% off + free upgrades with VIPBACK25.',
 'https://raynatours.com/vip-comeback', 'Claim',
 '{first_name}'),

('Lost VIP — SMS Exclusive Invite', 'sms', 'approved', 'Lost High-Value (180+ days, 3000+ AED)',
 NULL,
 'Rayna Tours VIP: {{first_name}}, an exclusive 25% OFF comeback package awaits you. Code: VIPBACK25. Claim: https://raynatours.com/vip-comeback',
 'Exclusive 25% off VIP comeback package: VIPBACK25.',
 'https://raynatours.com/vip-comeback', 'Claim',
 '{first_name}');

-- ──── 22. Lost Regular (180+ days, <3000 AED) ────
INSERT INTO content_templates (name, channel, status, segment_label, subject, body, body_plain, cta_url, cta_text, variables) VALUES
('Lost Regular — Win-Back Email', 'email', 'approved', 'Lost Regular (180+ days, <3000 AED)',
 'Long Time No See! 20% OFF To Welcome You Back 🎁',
 '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><div style="background:linear-gradient(135deg,#ff8a65,#e64a19);padding:32px;border-radius:12px 12px 0 0;text-align:center"><h1 style="color:#fff;margin:0">Welcome Back! 🎁</h1></div><div style="padding:24px;background:#fff"><p>Hi {{first_name}},</p><p>It''s been too long! We''d love to welcome you back with a special offer:</p><div style="background:#fbe9e7;padding:24px;border-radius:12px;text-align:center;margin:16px 0"><p style="font-size:32px;font-weight:bold;color:#e64a19;margin:0">20% OFF</p><p style="margin:4px 0">Code: <b>LOSTDEAL</b></p></div><div style="text-align:center;margin:24px 0"><a href="https://raynatours.com/tours" style="display:inline-block;padding:14px 32px;background:#ff8a65;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold">Explore & Save</a></div></div></div>',
 'Long time no see! Get 20% off with LOSTDEAL.',
 'https://raynatours.com/tours', 'Explore',
 '{first_name}'),

('Lost Regular — WA Flash Sale', 'whatsapp', 'approved', 'Lost Regular (180+ days, <3000 AED)',
 NULL,
 'Hi {{first_name}}! 👋\n\n🔥 *Flash Sale Alert!*\n\nDubai''s best experiences at unbeatable prices:\n\n🏜️ Desert Safari — AED 119 (was 149)\n🚢 Dhow Cruise — AED 79 (was 99)\n🏙️ City Tour — AED 99 (was 129)\n\nPlus use code *LOSTDEAL* for extra 20% off!\n\n⏰ Sale ends in 48 hours\n\n👉 https://raynatours.com/tours',
 'Flash sale! Best Dubai experiences at lowest prices. Extra 20% off with LOSTDEAL.',
 'https://raynatours.com/tours', 'Shop Sale',
 '{first_name}'),

('Lost Regular — Budget Email', 'email', 'approved', 'Lost Regular (180+ days, <3000 AED)',
 'Budget-Friendly Dubai Experiences Starting AED 49!',
 '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><div style="background:linear-gradient(135deg,#66bb6a,#388e3c);padding:32px;border-radius:12px 12px 0 0;text-align:center"><h1 style="color:#fff;margin:0">Budget-Friendly Picks 💰</h1></div><div style="padding:24px;background:#fff"><p>Hi {{first_name}},</p><p>Great experiences don''t have to break the bank:</p><div style="margin:12px 0;padding:12px;background:#e8f5e9;border-radius:8px">🌆 <b>Old Dubai Walk</b> — AED 49</div><div style="margin:12px 0;padding:12px;background:#e8f5e9;border-radius:8px">🕌 <b>Mosque Visit</b> — AED 59</div><div style="margin:12px 0;padding:12px;background:#e8f5e9;border-radius:8px">🛍️ <b>Shopping Tour</b> — AED 79</div><div style="text-align:center;margin:24px 0"><a href="https://raynatours.com/budget-tours" style="display:inline-block;padding:14px 32px;background:#66bb6a;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold">View All Budget Options</a></div></div></div>',
 'Budget-friendly Dubai experiences from AED 49!',
 'https://raynatours.com/budget-tours', 'View Budget',
 '{first_name}');

-- ──── 23. Happy Reviewers (4-5 Stars) ────
INSERT INTO content_templates (name, channel, status, segment_label, subject, body, body_plain, cta_url, cta_text, variables) VALUES
('Happy Reviewer — Referral Email', 'email', 'approved', 'Happy Reviewers (4-5 Stars)',
 'Love Rayna Tours? Share & Earn 20% OFF! 🤝',
 '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><div style="background:linear-gradient(135deg,#42a5f5,#1565c0);padding:32px;border-radius:12px 12px 0 0;text-align:center"><h1 style="color:#fff;margin:0">Share the Love! 🤝</h1></div><div style="padding:24px;background:#fff"><p>Hi {{first_name}},</p><p>Thank you for your amazing review! We''re glad you had a wonderful time.</p><p>Share your experience with friends & family:</p><div style="background:#e3f2fd;padding:20px;border-radius:12px;text-align:center;margin:16px 0"><p style="font-size:18px;font-weight:bold;margin:0">Your friend gets 15% OFF</p><p style="margin:4px 0">You get <b>20% OFF</b> your next booking</p><p style="margin:8px 0">Code: <b>REFER20</b></p></div><div style="text-align:center;margin:24px 0"><a href="https://raynatours.com/referral" style="display:inline-block;padding:14px 32px;background:#42a5f5;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold">Start Referring</a></div></div></div>',
 'Thank you for your review! Refer friends — they get 15% off, you get 20% off: REFER20.',
 'https://raynatours.com/referral', 'Refer Now',
 '{first_name}'),

('Happy Reviewer — WA Share Reward', 'whatsapp', 'approved', 'Happy Reviewers (4-5 Stars)',
 NULL,
 'Hi {{first_name}}! 😊\n\nThank you for your amazing review! ⭐⭐⭐⭐⭐\n\nWould you like to share it on Google and TripAdvisor too? Here''s an incentive:\n\n🎁 Share on Google → Get *20% OFF* next booking\n📱 Tag us on social → Get *extra AED 50 credit*\n\nCode: *REFER20*\n\n👉 Google Review: https://g.page/raynatours/review\n👉 TripAdvisor: https://tripadvisor.com/raynatours',
 'Thanks for your review! Share on Google for 20% off with REFER20.',
 'https://g.page/raynatours/review', 'Share Review',
 '{first_name}');

-- ──── 24. Social Media Advocates ────
INSERT INTO content_templates (name, channel, status, segment_label, subject, body, body_plain, cta_url, cta_text, variables) VALUES
('Social Advocate — UGC Email', 'email', 'approved', 'Social Media Advocates',
 'You Could Be Our Next Featured Travel Creator! 📸',
 '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><div style="background:linear-gradient(135deg,#e91e63,#ad1457);padding:32px;border-radius:12px 12px 0 0;text-align:center"><h1 style="color:#fff;margin:0">Be a Travel Creator! 📸</h1></div><div style="padding:24px;background:#fff"><p>Hi {{first_name}},</p><p>We love your social posts about your Rayna Tours experiences! Want to take it to the next level?</p><h3>Rayna Ambassador Program:</h3><ul><li>📸 Get featured on our social channels</li><li>🎁 Free experiences to review</li><li>💰 15% commission on referral bookings</li><li>🌟 Exclusive early access to new experiences</li></ul><div style="text-align:center;margin:24px 0"><a href="https://raynatours.com/ambassador" style="display:inline-block;padding:14px 32px;background:#e91e63;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold">Apply to Be an Ambassador</a></div></div></div>',
 'Be a Rayna Tours Ambassador! Get free experiences and earn commission.',
 'https://raynatours.com/ambassador', 'Apply',
 '{first_name}'),

('Social Advocate — WA Ambassador', 'whatsapp', 'approved', 'Social Media Advocates',
 NULL,
 'Hi {{first_name}}! 🌟\n\nWe love your posts about Rayna Tours! You''d be perfect for our *Ambassador Program*:\n\n📸 Featured on our channels\n🎁 Free experiences to review\n💰 15% commission on referrals\n🎯 15% off always: *AMBDOR15*\n\nInterested? Just reply YES and I''ll send you the details! 🚀',
 'Love your posts! Join our Ambassador Program — 15% off with AMBDOR15.',
 'https://raynatours.com/ambassador', 'Apply',
 '{first_name}');

-- ──── 25. NPS Promoters ────
INSERT INTO content_templates (name, channel, status, segment_label, subject, body, body_plain, cta_url, cta_text, variables) VALUES
('NPS Promoter — Referral Email', 'email', 'approved', 'NPS Promoters',
 'Thank You for Being a Rayna Promoter! Here''s Your Reward 🎁',
 '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><div style="background:linear-gradient(135deg,#4caf50,#2e7d32);padding:32px;border-radius:12px 12px 0 0;text-align:center"><h1 style="color:#fff;margin:0">Thank You, Promoter! 🎁</h1></div><div style="padding:24px;background:#fff"><p>Hi {{first_name}},</p><p>Thank you for scoring us highly in our NPS survey! As one of our biggest fans, we''d love your help spreading the word:</p><div style="background:#e8f5e9;padding:20px;border-radius:12px;text-align:center;margin:16px 0"><p style="font-size:18px;font-weight:bold;margin:0">Your Referral Code: <span style="color:#2e7d32;font-size:24px">NPSREFER</span></p><p style="margin:4px 0">You get 20% OFF • Your friend gets 15% OFF</p></div><div style="text-align:center;margin:24px 0"><a href="https://raynatours.com/referral" style="display:inline-block;padding:14px 32px;background:#4caf50;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold">Share Your Code</a></div></div></div>',
 'Thank you for being a promoter! Share code NPSREFER — you get 20% off, friends get 15% off.',
 'https://raynatours.com/referral', 'Share',
 '{first_name}'),

('NPS Promoter — WA Google Review', 'whatsapp', 'approved', 'NPS Promoters',
 NULL,
 'Hi {{first_name}}! 😊\n\nThank you for being one of our biggest supporters!\n\nWould you mind sharing your experience on Google? It really helps other travelers discover us:\n\n⭐ Google Review: https://g.page/raynatours/review\n\nAs a thank you, here''s *20% off* your next booking: *NPSREFER* 🎁',
 'Share your experience on Google! Use NPSREFER for 20% off your next booking.',
 'https://g.page/raynatours/review', 'Leave Review',
 '{first_name}');

-- ──── 26. B2B & Corporate ────
INSERT INTO content_templates (name, channel, status, segment_label, subject, body, body_plain, cta_url, cta_text, variables) VALUES
('B2B — Corporate Catalog Email', 'email', 'approved', 'B2B & Corporate',
 'Rayna Tours Corporate Solutions — Exclusive Group & MICE Packages',
 '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><div style="background:linear-gradient(135deg,#37474f,#263238);padding:32px;border-radius:12px 12px 0 0;text-align:center"><h1 style="color:#fff;margin:0">Corporate Solutions</h1><p style="color:rgba(255,255,255,0.8)">Group, MICE & Incentive Travel</p></div><div style="padding:24px;background:#fff"><p>Dear {{first_name}},</p><p>Rayna Tours offers comprehensive corporate travel solutions:</p><div style="margin:16px 0;padding:16px;background:#eceff1;border-radius:8px"><b>🏢 Corporate Team Building</b><br/>Desert camps, yacht parties, adventure days</div><div style="margin:16px 0;padding:16px;background:#eceff1;border-radius:8px"><b>🎯 MICE Events</b><br/>Meetings, conferences, gala dinners</div><div style="margin:16px 0;padding:16px;background:#eceff1;border-radius:8px"><b>✈️ Group Travel</b><br/>Customized itineraries, bulk visa processing</div><div style="text-align:center;margin:24px 0"><a href="https://raynatours.com/corporate" style="display:inline-block;padding:14px 32px;background:#37474f;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold">Download Corporate Brochure — 10% Volume Discount (CORPVOL10)</a></div></div></div>',
 'Rayna Tours corporate solutions — group travel, MICE, team building. Use CORPVOL10 for 10% off.',
 'https://raynatours.com/corporate', 'Download Brochure',
 '{first_name}'),

('B2B — WA Account Manager', 'whatsapp', 'approved', 'B2B & Corporate',
 NULL,
 'Hi {{first_name}},\n\nI''m your dedicated *Rayna Tours Account Manager* for corporate bookings.\n\nHow can I assist your business?\n\n🏢 Team building events\n🎯 MICE & conferences\n✈️ Group travel & visa\n📋 Custom itineraries\n\nI can prepare a tailored proposal for your team. Just share:\n• Group size\n• Preferred dates\n• Budget range\n\nUse code *CORPVOL10* for 10% volume discount on 10+ pax! 🤝',
 'I''m your corporate account manager. Share group size and dates for a proposal. CORPVOL10 for 10% off.',
 'https://raynatours.com/corporate', 'Contact',
 '{first_name}');

-- ──── 27. Birthday Month ────
INSERT INTO content_templates (name, channel, status, segment_label, subject, body, body_plain, cta_url, cta_text, variables) VALUES
('Birthday — Greeting Email', 'email', 'approved', 'Birthday Month',
 'Happy Birthday, {{first_name}}! 🎂 Here''s 25% OFF From Us!',
 '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><div style="background:linear-gradient(135deg,#ec407a,#d81b60);padding:32px;border-radius:12px 12px 0 0;text-align:center"><h1 style="color:#fff;margin:0">🎂 Happy Birthday!</h1></div><div style="padding:24px;background:#fff"><p>Dear {{first_name}},</p><p>Wishing you the happiest of birthdays from the entire Rayna Tours family!</p><p>Celebrate with an unforgettable experience:</p><div style="background:linear-gradient(135deg,#fce4ec,#f8bbd0);padding:24px;border-radius:12px;text-align:center;margin:16px 0"><p style="font-size:36px;font-weight:bold;color:#d81b60;margin:0">25% OFF</p><p style="margin:4px 0">Your birthday treat • Code: <b>BDAY25</b></p></div><div style="text-align:center;margin:24px 0"><a href="https://raynatours.com/tours" style="display:inline-block;padding:14px 32px;background:#ec407a;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold">Celebrate With an Experience!</a></div></div></div>',
 'Happy Birthday, {{first_name}}! Here''s 25% off your next experience: BDAY25.',
 'https://raynatours.com/tours', 'Celebrate',
 '{first_name}'),

('Birthday — WA Experience Package', 'whatsapp', 'approved', 'Birthday Month',
 NULL,
 '🎂 *Happy Birthday, {{first_name}}!* 🎉\n\nFrom all of us at Rayna Tours — we hope your day is amazing!\n\nHere''s our gift to you:\n\n🎁 *25% OFF* any experience\nCode: *BDAY25*\n\n🌟 *Birthday Special Packages:*\n🏜️ Birthday Desert Party — AED 299/person\n🚤 Birthday Yacht Cruise — AED 399/person\n🏖️ Birthday Beach Day — AED 199/person\n\nTreat yourself! 🥳\n\n👉 https://raynatours.com/tours',
 'Happy Birthday! 25% off with BDAY25.',
 'https://raynatours.com/tours', 'Book',
 '{first_name}'),

('Birthday — SMS Reminder', 'sms', 'approved', 'Birthday Month',
 NULL,
 'Happy Birthday {{first_name}}! 🎂 Rayna Tours gift: 25% OFF any experience. Code: BDAY25. Celebrate: https://raynatours.com/tours',
 'Happy Birthday! 25% off with BDAY25.',
 'https://raynatours.com/tours', 'Book',
 '{first_name}');

-- ──── 28. High Cancellation Risk ────
INSERT INTO content_templates (name, channel, status, segment_label, subject, body, body_plain, cta_url, cta_text, variables) VALUES
('Cancel Risk — Flex Options Email', 'email', 'approved', 'High Cancellation Risk',
 'Your Booking Is Protected — Flexible Options Inside 🛡️',
 '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><div style="background:linear-gradient(135deg,#26a69a,#00897b);padding:32px;border-radius:12px 12px 0 0;text-align:center"><h1 style="color:#fff;margin:0">You''re Protected! 🛡️</h1></div><div style="padding:24px;background:#fff"><p>Hi {{first_name}},</p><p>We understand plans can change. That''s why we offer:</p><ul><li>✅ <b>Free cancellation</b> up to 24 hours before</li><li>✅ <b>Date change</b> at no extra cost</li><li>✅ <b>Full refund</b> for weather cancellations</li><li>✅ <b>Credit transfer</b> to any other experience</li></ul><p>Your adventure is worry-free with Rayna Tours!</p><div style="text-align:center;margin:24px 0"><a href="https://raynatours.com/tours" style="display:inline-block;padding:14px 32px;background:#26a69a;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold">Book With Confidence — 10% OFF (FLEX10)</a></div></div></div>',
 'Book with confidence! Free cancellation + 10% off with FLEX10.',
 'https://raynatours.com/tours', 'Book Now',
 '{first_name}'),

('Cancel Risk — WA Free Cancellation', 'whatsapp', 'approved', 'High Cancellation Risk',
 NULL,
 'Hi {{first_name}}! 😊\n\nJust a reminder — your booking comes with:\n\n✅ *Free cancellation* up to 24h before\n✅ *Free date change*\n✅ *Full refund* for weather issues\n\nNo risk, all reward! 🛡️\n\nPlus, use code *FLEX10* for 10% off your next booking.\n\nAny questions? I''m here to help!',
 'Your booking has free cancellation + date change. Use FLEX10 for 10% off next booking.',
 'https://raynatours.com/tours', 'Book',
 '{first_name}');


-- ══════════════════════════════════════════════════════════════
-- STEP 3: JOURNEY FLOWS — One per segment with proper nodes/edges
-- Aligned with strategy flow_steps
-- ══════════════════════════════════════════════════════════════

INSERT INTO journey_flows (name, description, segment_id, strategy_id, status, goal_type, goal_value, created_by, nodes, edges)
SELECT
  os.name || ' Journey',
  'Automated journey for segment: ' || sd.segment_name,
  sd.segment_id,
  os.id,
  'active',
  'conversion',
  'booking',
  'system',
  -- Build nodes from flow_steps
  (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', 'node_' || idx,
        'type', CASE
          WHEN idx = 0 THEN 'trigger'
          WHEN idx = jsonb_array_length(os.flow_steps) - 1 THEN 'action'
          ELSE 'action'
        END,
        'position', jsonb_build_object('x', 250, 'y', 100 + idx * 150),
        'data', jsonb_build_object(
          'label', step->>'action',
          'channel', step->>'channel',
          'day', (step->>'day')::int,
          'template_id', (
            SELECT ct.id FROM content_templates ct
            WHERE ct.segment_label = sd.segment_name
              AND ct.channel::text = step->>'channel'
            ORDER BY ct.id
            LIMIT 1
          )
        )
      )
    )
    FROM jsonb_array_elements(os.flow_steps) WITH ORDINALITY AS t(step, idx)
    WHERE idx - 1 >= 0 OR true
  ),
  -- Build edges connecting nodes sequentially
  (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', 'edge_' || idx,
        'source', 'node_' || idx,
        'target', 'node_' || (idx + 1),
        'type', 'default',
        'data', jsonb_build_object(
          'wait_days', COALESCE(
            (os.flow_steps->(idx::int + 1)->>'day')::int - (step->>'day')::int,
            0
          )
        )
      )
    ), '[]'::jsonb)
    FROM jsonb_array_elements(os.flow_steps) WITH ORDINALITY AS t(step, idx)
    WHERE idx < jsonb_array_length(os.flow_steps)
  )
FROM segment_definitions sd
JOIN omnichannel_strategies os ON os.segment_label = sd.segment_name AND os.status = 'active';


-- ══════════════════════════════════════════════════════════════
-- STEP 4: CAMPAIGNS — One per segment+channel from flow_steps
-- Links strategy, template, and segment together
-- ══════════════════════════════════════════════════════════════

INSERT INTO campaigns (name, strategy_id, segment_label, channel, template_id, status, target_count, scheduled_at, created_by)
SELECT DISTINCT ON (os.segment_label, step->>'channel')
  sd.segment_name || ' — ' || initcap(step->>'channel') || ' Campaign',
  os.id,
  sd.segment_name,
  (step->>'channel')::channel_type,
  (
    SELECT ct.id FROM content_templates ct
    WHERE ct.segment_label = sd.segment_name
      AND ct.channel::text = step->>'channel'
    ORDER BY ct.id
    LIMIT 1
  ),
  'scheduled',
  (
    SELECT COUNT(*) FROM customer_segments cs
    WHERE cs.segment_label = (
      CASE
        WHEN sd.segment_name LIKE '%B2B%' OR sd.segment_name LIKE '%Corporate%' THEN 'B2B Partner'
        WHEN sd.segment_name LIKE '%High Spend%' OR sd.segment_name LIKE '%Frequent%' OR sd.segment_name LIKE '%High Value%' THEN 'High Value'
        WHEN sd.segment_name LIKE '%New Customer%' OR sd.segment_name LIKE '%Repeat%' OR sd.segment_name LIKE '%One-Time%' OR sd.segment_name LIKE '%Converted%' THEN 'Converted'
        WHEN sd.segment_name LIKE '%Cooling%' OR sd.segment_name LIKE '%At Risk%' OR sd.segment_name LIKE '%Hibernat%' OR sd.segment_name LIKE '%Lost%' OR sd.segment_name LIKE '%Dormant%' THEN 'Dormant'
        WHEN sd.segment_name LIKE '%Engaged%' OR sd.segment_name LIKE '%Happy%' OR sd.segment_name LIKE '%Social%' OR sd.segment_name LIKE '%NPS%' THEN 'Engaged'
        ELSE 'Prospect'
      END
    )
  )::int,
  NOW() + INTERVAL '1 day',
  'system'
FROM segment_definitions sd
JOIN omnichannel_strategies os ON os.segment_label = sd.segment_name AND os.status = 'active',
LATERAL jsonb_array_elements(os.flow_steps) AS step
WHERE (step->>'channel') IN ('whatsapp', 'email', 'sms', 'push', 'web')
  AND EXISTS (
    SELECT 1 FROM content_templates ct
    WHERE ct.segment_label = sd.segment_name
      AND ct.channel::text = step->>'channel'
  )
ORDER BY os.segment_label, step->>'channel', (step->>'day')::int;


COMMIT;
