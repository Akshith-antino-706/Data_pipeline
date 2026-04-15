-- 035: Fresh content templates for 6-segment decision tree model
-- Clears old templates and creates email + WhatsApp templates per segment per strategy step

-- Ensure segment_label column exists (may be missing if 001 was cached)
ALTER TABLE content_templates ADD COLUMN IF NOT EXISTS segment_label TEXT;

TRUNCATE content_templates CASCADE;

-- ═══════════════════════════════════════════════════════════════
-- 1. ON_TRIP — Upsell & Support (7 days)
-- ═══════════════════════════════════════════════════════════════

INSERT INTO content_templates (name, channel, status, segment_label, subject, body, cta_url, cta_text, variables) VALUES

('ON_TRIP — Day 0 Welcome',
 'whatsapp', 'approved', 'ON_TRIP', NULL,
 'Hi {{first_name}}! Welcome to Dubai 🌟

Your trip starts today — here are the top activities near you:
🏜️ Desert Safari with BBQ Dinner
🚤 Marina Yacht Cruise
🏙️ Burj Khalifa At The Top

Book any activity now and get 10% off with code ONTRIP10.

Need help? Reply here anytime — we are available 24/7.',
 'https://www.raynatours.com/activities', 'Browse Activities',
 ARRAY['first_name']),

('ON_TRIP — Day 1 Push Notification',
 'push', 'approved', 'ON_TRIP', 'Don''t Miss This!',
 'Desert Safari with BBQ dinner — only 3 spots left for tonight! Book now before it sells out.',
 'https://www.raynatours.com/desert-safari', 'Book Now', ARRAY[]::text[]),

('ON_TRIP — Day 3 Mid-Trip Offer',
 'email', 'approved', 'ON_TRIP',
 '{{first_name}}, exclusive mid-trip offer just for you',
 'Hi {{first_name}},

Hope you are having an amazing time in Dubai!

We have a special offer just for guests like you — 15% off any activity booked today.

🎯 Use code: MIDTRIP15

Here are our most popular experiences this week:
• Abu Dhabi City Tour — from AED 149
• Dhow Cruise Dinner — from AED 99
• Helicopter Tour — from AED 649

This offer expires at midnight tonight.

Best,
Rayna Tours Team',
 'https://www.raynatours.com/activities', 'Explore Activities',
 ARRAY['first_name']),

('ON_TRIP — Day 6 Airport Transfer',
 'email', 'approved', 'ON_TRIP',
 'Leaving soon? Don''t forget your airport transfer',
 'Hi {{first_name}},

Your trip is wrapping up — have you arranged your airport transfer yet?

🚗 Private sedan — AED 149
🚐 Private van (up to 6) — AED 199
🚌 Shared shuttle — AED 49

Book now and travel stress-free to the airport.

Safe travels!
Rayna Tours Team',
 'https://www.raynatours.com/transfers', 'Book Transfer',
 ARRAY['first_name']),

('ON_TRIP — Day 7 Review Request',
 'whatsapp', 'approved', 'ON_TRIP', NULL,
 'Hi {{first_name}}, hope you had an amazing trip! 🎉

We would love to hear about your experience. Your feedback helps other travellers and helps us improve.

⭐ Leave a quick review and get 10% off your next booking.

Thank you for choosing Rayna Tours!',
 'https://www.raynatours.com/reviews', 'Leave Review',
 ARRAY['first_name']),

-- ═══════════════════════════════════════════════════════════════
-- 2. FUTURE_TRAVEL — Pre-Trip Engagement (14 days)
-- ═══════════════════════════════════════════════════════════════

('FUTURE_TRAVEL — Pre-Trip Guide',
 'email', 'approved', 'FUTURE_TRAVEL',
 'Your trip is coming up! Here''s your personalised guide',
 'Hi {{first_name}},

Your trip is just around the corner — exciting times ahead!

Here is your personalised pre-trip guide:

📋 BEFORE YOU GO
• Passport valid for 6+ months? ✓
• Visa sorted? We can help if not
• Travel insurance? Highly recommended
• SIM card / eSIM? Available at the airport

🌟 TOP EXPERIENCES TO ADD
• Desert Safari with BBQ — AED 149
• Dubai Marina Yacht Cruise — AED 299
• Burj Khalifa At The Top — AED 169

📱 Download our app for easy booking on the go.

See you soon!
Rayna Tours Team',
 'https://www.raynatours.com/activities', 'Plan Your Activities',
 ARRAY['first_name']),

('FUTURE_TRAVEL — Activity Picks',
 'whatsapp', 'approved', 'FUTURE_TRAVEL', NULL,
 'Hi {{first_name}}! Your trip is coming up soon 🎉

Have you planned your activities yet? Here are our top picks:

🏜️ Desert Safari — AED 149
🚤 Yacht Cruise — AED 299
🏙️ Burj Khalifa — AED 169
🚁 Helicopter Tour — AED 649

Reply with the activity name and we will book it for you instantly!',
 'https://www.raynatours.com/activities', 'View All',
 ARRAY['first_name']),

('FUTURE_TRAVEL — Travel Checklist',
 'email', 'approved', 'FUTURE_TRAVEL',
 'Travel checklist: Is everything sorted?',
 'Hi {{first_name}},

Quick checklist before your trip:

✅ Flight booked
⬜ Visa arranged — Need help? We process visas in 24-48 hours
⬜ Airport transfer booked — From AED 49
⬜ Travel insurance — Protect your trip from AED 29
⬜ Activities planned — Don''t miss the best experiences

Let us handle the rest so you can focus on enjoying your trip.

Rayna Tours Team',
 'https://www.raynatours.com', 'Complete Your Checklist',
 ARRAY['first_name']),

('FUTURE_TRAVEL — Trip Tomorrow',
 'push', 'approved', 'FUTURE_TRAVEL',
 'Your trip starts tomorrow!',
 'Everything is set for your trip! Check your itinerary and make sure you have not missed anything. Have an amazing time!',
 'https://www.raynatours.com', 'View Itinerary', ARRAY[]::text[]),

-- ═══════════════════════════════════════════════════════════════
-- 3. ACTIVE_ENQUIRY — Conversion Sprint (7 days)
-- ═══════════════════════════════════════════════════════════════

('ACTIVE_ENQUIRY — Personalised Quote',
 'whatsapp', 'approved', 'ACTIVE_ENQUIRY', NULL,
 'Hi {{first_name}}, thanks for your enquiry! 😊

Based on what you asked about, here is your personalised quote. We have handpicked the best options for you.

💰 Special offer: Book within 48 hours and get 10% off with code ENQUIRY10.

Want to customise anything? Just reply here and we will sort it out!',
 'https://www.raynatours.com', 'View Quote',
 ARRAY['first_name']),

('ACTIVE_ENQUIRY — Social Proof',
 'whatsapp', 'approved', 'ACTIVE_ENQUIRY', NULL,
 'Hi {{first_name}}, just wanted to share — this experience has a 4.8⭐ rating from 2,000+ travellers!

Here is what recent customers said:
"Best experience in Dubai!" — Sarah, UK
"Absolutely worth every dirham" — Ahmed, UAE
"My kids loved it!" — Priya, India

Your 10% discount (ENQUIRY10) is still active. Shall I book it for you?',
 NULL, NULL, ARRAY['first_name']),

('ACTIVE_ENQUIRY — 10% Off Offer',
 'email', 'approved', 'ACTIVE_ENQUIRY',
 '{{first_name}}, your dream trip is waiting — 10% off inside',
 'Hi {{first_name}},

You were looking at some amazing experiences — do not let them slip away!

🎁 Your exclusive offer: 10% OFF
🔑 Code: ENQUIRY10
⏰ Expires in: 48 hours

Why book with Rayna Tours?
✓ Best price guarantee
✓ Free cancellation on most activities
✓ 500,000+ happy customers
✓ 24/7 support

Complete your booking today and save.

Rayna Tours Team',
 'https://www.raynatours.com', 'Complete Booking',
 ARRAY['first_name']),

('ACTIVE_ENQUIRY — Urgency',
 'whatsapp', 'approved', 'ACTIVE_ENQUIRY', NULL,
 'Hi {{first_name}}, quick update — only 3 spots left for the experience you enquired about! 🔥

These sell out fast, especially on weekends. Your 10% code (ENQUIRY10) is still valid.

Want me to lock in your spot? Just say yes!',
 NULL, NULL, ARRAY['first_name']),

('ACTIVE_ENQUIRY — Alternatives',
 'email', 'approved', 'ACTIVE_ENQUIRY',
 'Still thinking? Here are more options you might love',
 'Hi {{first_name}},

Not quite sure yet? No worries — here are some similar experiences our customers love:

🏜️ Desert Safari Packages — from AED 99
🚤 Water Sports Bundle — from AED 199
🏙️ City Tour Combos — from AED 129
🎢 Theme Park Tickets — from AED 249

Mix and match to create your perfect trip. Your 10% code (ENQUIRY10) works on all of these.

Rayna Tours Team',
 'https://www.raynatours.com/activities', 'Explore Options',
 ARRAY['first_name']),

('ACTIVE_ENQUIRY — Final Offer',
 'whatsapp', 'approved', 'ACTIVE_ENQUIRY', NULL,
 'Hi {{first_name}}, last chance! ⏰

Your 10% discount code ENQUIRY10 expires today at midnight.

This is the lowest price we can offer. After today, it goes back to full price.

Reply YES and I will book it for you right now! 🎯',
 NULL, NULL, ARRAY['first_name']),

-- ═══════════════════════════════════════════════════════════════
-- 4. PAST_ENQUIRY — Win Back (21 days)
-- ═══════════════════════════════════════════════════════════════

('PAST_ENQUIRY — We Missed You',
 'email', 'approved', 'PAST_ENQUIRY',
 'We missed you, {{first_name}}! New experiences await',
 'Hi {{first_name}},

It has been a while since we last heard from you — and a lot has changed!

🆕 NEW this season:
• Luxury yacht dinner cruises
• Abu Dhabi Grand Mosque + Louvre combo
• Helicopter tours over Palm Jumeirah
• Exclusive desert glamping overnight

🎁 Welcome back offer: 15% off any booking
🔑 Code: COMEBACK15

We would love to help you plan your next adventure.

Rayna Tours Team',
 'https://www.raynatours.com/activities', 'Explore New Experiences',
 ARRAY['first_name']),

('PAST_ENQUIRY — Trending Now',
 'email', 'approved', 'PAST_ENQUIRY',
 'Trending: Top 5 experiences this month',
 'Hi {{first_name}},

Here is what everyone is booking right now:

1. 🏜️ Premium Desert Safari — AED 299 (was AED 399)
2. 🚤 Marina Yacht Party — AED 499 (new!)
3. 🏙️ Burj Khalifa + Aquarium Combo — AED 249
4. 🎢 IMG Worlds + Legoland Bundle — AED 379
5. 🚁 Helicopter Sightseeing — AED 649

Your 15% comeback code (COMEBACK15) works on all of these.

Do not miss out — book your favourite before prices go up!

Rayna Tours Team',
 'https://www.raynatours.com', 'Book Now',
 ARRAY['first_name']),

('PAST_ENQUIRY — 15% Comeback Offer',
 'whatsapp', 'approved', 'PAST_ENQUIRY', NULL,
 'Hi {{first_name}}! 👋

We have not forgotten about you! Here is a special comeback offer:

🎁 15% OFF any booking
🔑 Code: COMEBACK15
⏰ Valid for 7 days

Over 500,000 happy customers — join them on their next adventure!

Reply BOOK and I will help you find the perfect experience.',
 NULL, NULL, ARRAY['first_name']),

('PAST_ENQUIRY — Final Reminder',
 'whatsapp', 'approved', 'PAST_ENQUIRY', NULL,
 'Hi {{first_name}}, just a heads up — your 15% comeback code (COMEBACK15) expires in 48 hours! ⏰

After that, it is back to regular prices. Do not miss this one!

Reply if you need help choosing an experience 🎯',
 NULL, NULL, ARRAY['first_name']),

-- ═══════════════════════════════════════════════════════════════
-- 5. PAST_BOOKING — Cross-Sell & Loyalty (30 days)
-- ═══════════════════════════════════════════════════════════════

('PAST_BOOKING — Review Request',
 'whatsapp', 'approved', 'PAST_BOOKING', NULL,
 'Hi {{first_name}}! Hope you had an amazing experience with us 🌟

Would you mind sharing a quick review? It really helps other travellers decide.

⭐ Rate your experience and get 10% off your next booking!

Thank you for being part of the Rayna Tours family!',
 'https://www.raynatours.com/reviews', 'Leave Review',
 ARRAY['first_name']),

('PAST_BOOKING — Review + Discount',
 'email', 'approved', 'PAST_BOOKING',
 '{{first_name}}, rate your trip and get 10% off',
 'Hi {{first_name}},

Thank you for choosing Rayna Tours! We hope you had an unforgettable experience.

📝 Share your review and unlock:
🎁 10% off your next booking
🔑 Code sent automatically after review

Your feedback matters — it helps us improve and helps other travellers make great choices.

Rayna Tours Team',
 'https://www.raynatours.com/reviews', 'Write a Review',
 ARRAY['first_name']),

('PAST_BOOKING — Cross-Sell',
 'email', 'approved', 'PAST_BOOKING',
 'Loved your trip? You''ll love these too',
 'Hi {{first_name}},

Since you enjoyed your last experience, we think you will love these:

🏜️ Haven''t tried a Desert Safari? — from AED 99
🚤 Yacht cruise under the stars — from AED 299
✈️ Day trip to Abu Dhabi — from AED 149
🎫 Theme park combos — save up to 30%

Plus, as a returning customer, you get priority booking and best price guarantee.

Ready for your next adventure?

Rayna Tours Team',
 'https://www.raynatours.com/activities', 'Explore More',
 ARRAY['first_name']),

('PAST_BOOKING — Visa Cross-Sell',
 'whatsapp', 'approved', 'PAST_BOOKING', NULL,
 'Hi {{first_name}}! Planning your next trip? 🌍

Did you know we also handle visas end-to-end?

🛂 UAE visa — from AED 299
🛂 Schengen visa — from AED 499
🛂 UK visa — from AED 599

Fast processing, hassle-free. Just send us your passport copy and we will take care of the rest!',
 'https://www.raynatours.com/visas', 'Apply for Visa',
 ARRAY['first_name']),

('PAST_BOOKING — Referral Program',
 'email', 'approved', 'PAST_BOOKING',
 'Refer a friend — you both get AED 50 off!',
 'Hi {{first_name}},

Love Rayna Tours? Share the love!

🎁 Refer a friend and you BOTH get AED 50 off your next booking.

How it works:
1. Share your unique referral link
2. Your friend books any experience
3. You both get AED 50 credited automatically

No limits — refer as many friends as you want!

Rayna Tours Team',
 'https://www.raynatours.com/referral', 'Get Your Referral Link',
 ARRAY['first_name']),

('PAST_BOOKING — Loyalty Discount',
 'whatsapp', 'approved', 'PAST_BOOKING', NULL,
 'Hi {{first_name}}! As a loyal Rayna Tours customer, here is something special just for you 💎

🎁 12% OFF any experience this month
🔑 Code: LOYAL12
⏰ Valid until end of month

From desert safaris to yacht cruises — pick your next adventure!

Reply BOOK to get started 🎯',
 NULL, NULL, ARRAY['first_name']),

-- ═══════════════════════════════════════════════════════════════
-- 6. PROSPECT — Awareness & First Booking (14 days)
-- ═══════════════════════════════════════════════════════════════

('PROSPECT — Welcome Email',
 'email', 'approved', 'PROSPECT',
 'Welcome to Rayna Tours — Dubai''s #1 travel platform',
 'Hi {{first_name}},

Welcome to Rayna Tours! We are Dubai''s leading travel experience platform, trusted by over 500,000 customers.

🌟 WHAT WE OFFER
• 500+ tours & activities across the UAE
• Holiday packages to 50+ destinations
• Visa services for 100+ countries
• Hotel bookings at best prices
• Flight tickets & airport transfers

🎁 FIRST-TIME OFFER
20% off your first booking with code: WELCOME20

Whether it is a desert safari, a yacht cruise, or a full holiday package — we have got you covered.

Start exploring!
Rayna Tours Team',
 'https://www.raynatours.com', 'Explore Experiences',
 ARRAY['first_name']),

('PROSPECT — Top Experiences',
 'email', 'approved', 'PROSPECT',
 'Top 10 must-do experiences in Dubai & Abu Dhabi',
 'Hi {{first_name}},

Planning a trip to the UAE? Here are the 10 experiences you absolutely cannot miss:

1. 🏜️ Desert Safari with BBQ Dinner — AED 99
2. 🏙️ Burj Khalifa At The Top — AED 169
3. 🚤 Dubai Marina Yacht Cruise — AED 299
4. 🕌 Abu Dhabi Grand Mosque Tour — AED 149
5. 🎢 IMG Worlds of Adventure — AED 249
6. 🚁 Helicopter Tour — AED 649
7. 🐪 Hot Air Balloon Ride — AED 899
8. 🏝️ Musandam Dibba Day Trip — AED 199
9. 💆 Luxury Spa Experience — AED 349
10. 🌊 Jet Ski Ride — AED 249

🎁 Remember: 20% off with code WELCOME20

Rayna Tours Team',
 'https://www.raynatours.com/activities', 'Book Your Favourite',
 ARRAY['first_name']),

('PROSPECT — Social Proof',
 'email', 'approved', 'PROSPECT',
 'Why 500,000+ customers trust Rayna Tours',
 'Hi {{first_name}},

Here is why travellers choose us:

⭐ 4.8/5 rating on Google & TripAdvisor
👥 500,000+ happy customers
🏆 12+ years in the UAE travel industry
💰 Best price guarantee
🔄 Free cancellation on most activities
📱 24/7 customer support

"Best travel company in Dubai. Super professional and great prices!" — Mohammed A.
"We booked everything through Rayna — tours, visa, hotel. Flawless!" — Jessica T.
"The desert safari was the highlight of our trip!" — Raj K.

Your 20% welcome code (WELCOME20) is still waiting.

Rayna Tours Team',
 'https://www.raynatours.com', 'Start Planning',
 ARRAY['first_name']),

('PROSPECT — First Booking Offer',
 'email', 'approved', 'PROSPECT',
 '{{first_name}}, your 20% first-booking discount is expiring',
 'Hi {{first_name}},

Quick reminder — your exclusive 20% first-booking discount expires tomorrow!

🎁 Code: WELCOME20
⏰ Expires: Tomorrow at midnight
✓ Works on any activity, tour, or package

This is the best deal we offer — it is only available for first-time customers.

Do not miss out!

Rayna Tours Team',
 'https://www.raynatours.com/activities', 'Use Discount Now',
 ARRAY['first_name']);
