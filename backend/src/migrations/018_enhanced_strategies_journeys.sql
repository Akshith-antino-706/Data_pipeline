-- ═══════════════════════════════════════════════════════════════════
-- Migration 018: ENHANCED STRATEGIES & JOURNEY FLOWS
-- - Detailed 8-12 step flows per strategy with conditions & escalation
-- - Persistent follow-up until conversion
-- - Enquiry-based product recommendations
-- - Department-aware messaging
-- ═══════════════════════════════════════════════════════════════════
BEGIN;

-- ══════════════════════════════════════════════════════════════
-- STEP 1: UPDATE ALL 28 STRATEGIES WITH DETAILED FLOW STEPS
-- Each strategy now has 8-12 steps with day, channel, action,
-- condition, goal, and escalation logic
-- ══════════════════════════════════════════════════════════════

-- 1. Social Ad Leads
UPDATE omnichannel_strategies SET flow_steps = '[
  {"day": 0, "channel": "web", "action": "Retarget ad on social — show product they clicked", "type": "trigger"},
  {"day": 0, "channel": "whatsapp", "action": "Auto-reply: Hi! Saw your interest — here are top picks", "type": "action"},
  {"day": 1, "channel": "email", "action": "Welcome email + best sellers + SOCIAL10 coupon", "type": "action"},
  {"day": 2, "channel": "whatsapp", "action": "Check: Did they reply? If YES → send tailored quote", "type": "condition", "condition": "replied_wa = true → send_quote"},
  {"day": 3, "channel": "web", "action": "Retarget with viewed-product carousel ad", "type": "action"},
  {"day": 5, "channel": "email", "action": "Social proof email: 2400+ travelers loved this experience", "type": "action"},
  {"day": 7, "channel": "whatsapp", "action": "Follow-up: Offer expires in 48h — SOCIAL10 for 10% off", "type": "action", "condition_next": "If no reply"},
  {"day": 10, "channel": "sms", "action": "Last touch: Flash deal 20% off — 24h only", "type": "action"},
  {"day": 14, "channel": "email", "action": "Final: New arrivals + testimonials + free cancellation guarantee", "type": "action"},
  {"day": 21, "channel": "whatsapp", "action": "Soft re-engage: New seasonal experiences launched — interested?", "type": "action", "goal": "registration_or_booking"}
]'::jsonb, description = 'Multi-touch retargeting flow: Social ad click → WhatsApp engagement → Email nurture → Escalating offers until registration or booking. 10-step, 21-day journey.'
WHERE segment_label = 'Social Ad Leads';

-- 2. Website Browsers
UPDATE omnichannel_strategies SET flow_steps = '[
  {"day": 0, "channel": "web", "action": "Exit-intent popup: 15% OFF first booking (BROWSE15)", "type": "trigger"},
  {"day": 1, "channel": "web", "action": "Retarget ad: Still thinking about Dubai?", "type": "action"},
  {"day": 2, "channel": "email", "action": "Best sellers email: Top 5 Dubai experiences with reviews", "type": "action", "condition": "email_captured = true"},
  {"day": 4, "channel": "web", "action": "Dynamic retarget: Show exact products they browsed", "type": "action"},
  {"day": 5, "channel": "email", "action": "Price drop alert on viewed items", "type": "action"},
  {"day": 7, "channel": "push", "action": "Push notification: Flash sale — 20% OFF popular experiences", "type": "action"},
  {"day": 10, "channel": "email", "action": "Curated guide: Ultimate Dubai Itinerary (3/5/7 days)", "type": "action"},
  {"day": 14, "channel": "web", "action": "Retarget with testimonial video ad", "type": "action"},
  {"day": 21, "channel": "email", "action": "Final: Seasonal special + urgency (limited availability)", "type": "action", "goal": "registration_or_booking"}
]'::jsonb, description = 'Browser-to-buyer conversion: Exit popup → Retarget → Email nurture with social proof → Escalating discounts. 9-step, 21-day journey.'
WHERE segment_label = 'Website Browsers';

-- 3. WhatsApp First-Touch
UPDATE omnichannel_strategies SET flow_steps = '[
  {"day": 0, "channel": "whatsapp", "action": "Instant reply: Welcome + how can I help? (1/2/3/4 menu)", "type": "trigger"},
  {"day": 0, "channel": "whatsapp", "action": "Based on reply → send relevant product catalog", "type": "condition", "condition": "reply_choice → route_to_catalog"},
  {"day": 1, "channel": "whatsapp", "action": "Follow-up: Did you find what you need? Send top 3 picks", "type": "action"},
  {"day": 2, "channel": "whatsapp", "action": "Share customer review photos + ratings for their interest area", "type": "action"},
  {"day": 3, "channel": "email", "action": "Register invite: Create account to unlock member prices", "type": "action"},
  {"day": 5, "channel": "whatsapp", "action": "Check: Still interested? Send limited-time offer WAFIRST10", "type": "action", "condition_next": "If no booking yet"},
  {"day": 7, "channel": "whatsapp", "action": "Personalized quote based on their enquiry (dept-aware)", "type": "action"},
  {"day": 10, "channel": "email", "action": "Nudge: Your quote is valid for 48h + similar traveler stories", "type": "action"},
  {"day": 14, "channel": "whatsapp", "action": "Soft check-in: Plans changed? We can adjust dates/options", "type": "action"},
  {"day": 21, "channel": "whatsapp", "action": "Final gentle touch: New experiences added — take a look?", "type": "action", "goal": "booking"}
]'::jsonb, description = 'WhatsApp-first nurture: Auto-menu → Product routing → Persistent follow-up with quotes → Registration → Booking push. 10-step, 21-day journey.'
WHERE segment_label = 'WhatsApp First-Touch';

-- 4. Fresh Cart Abandoners (0-3 days)
UPDATE omnichannel_strategies SET flow_steps = '[
  {"day": 0, "channel": "whatsapp", "action": "1h: Cart reminder — your selected experience is still available!", "type": "trigger"},
  {"day": 0, "channel": "email", "action": "4h: Cart email + social proof (X travelers viewing this now)", "type": "action"},
  {"day": 1, "channel": "sms", "action": "Urgency SMS: Your cart expires today! CART10 for 10% off", "type": "action"},
  {"day": 1, "channel": "whatsapp", "action": "Check: Did they complete? If NO → offer help with booking", "type": "condition", "condition": "booking_completed = false → offer_assistance"},
  {"day": 2, "channel": "email", "action": "Alternative suggestions: Similar experiences at better price points", "type": "action"},
  {"day": 2, "channel": "whatsapp", "action": "Personal touch: Is there anything holding you back? We can help", "type": "action"},
  {"day": 3, "channel": "email", "action": "Final push: Cart expiring + CART10 last chance + free cancellation", "type": "action"},
  {"day": 3, "channel": "sms", "action": "Last SMS: 10% OFF expires tonight. Complete your booking now", "type": "action", "goal": "cart_completion"}
]'::jsonb, description = 'Urgent cart recovery: 1h WA → 4h email → Next day SMS → Help offer → Alternatives → Final deadline. 8-step, 3-day high-intensity journey.'
WHERE segment_label = 'Fresh Cart Abandoners (0-3 days)';

-- 5. Stale Cart Abandoners (4-14 days)
UPDATE omnichannel_strategies SET flow_steps = '[
  {"day": 0, "channel": "email", "action": "Your cart is still here! Now with 15% OFF (CART15)", "type": "trigger"},
  {"day": 1, "channel": "whatsapp", "action": "Alternative products based on what they browsed", "type": "action"},
  {"day": 3, "channel": "email", "action": "What other travelers booked instead — social proof", "type": "action"},
  {"day": 5, "channel": "web", "action": "Retarget ad: Come back + 15% OFF flash banner", "type": "action"},
  {"day": 7, "channel": "whatsapp", "action": "Personal check: Is price the issue? Let me find best deal", "type": "action", "condition_next": "If no engagement"},
  {"day": 9, "channel": "email", "action": "Curated: Budget-friendly alternatives from AED 49", "type": "action"},
  {"day": 12, "channel": "whatsapp", "action": "Final offer: 20% OFF + free cancellation guarantee", "type": "action"},
  {"day": 14, "channel": "email", "action": "Last email: New experiences added + seasonal deals", "type": "action", "goal": "booking"}
]'::jsonb, description = 'Extended cart recovery: Higher discount → Alternatives → Budget options → Escalating offers. 8-step, 14-day journey.'
WHERE segment_label = 'Stale Cart Abandoners (4-14 days)';

-- 6. Active Enquirers
UPDATE omnichannel_strategies SET flow_steps = '[
  {"day": 0, "channel": "whatsapp", "action": "Personal follow-up based on ENQUIRY TYPE: Visa/Tour/Cruise/Package", "type": "trigger"},
  {"day": 0, "channel": "whatsapp", "action": "Send relevant dept catalog: What they enquired about + top picks", "type": "action", "condition": "match_enquiry_department → send_relevant_catalog"},
  {"day": 1, "channel": "email", "action": "Tailored options email: 3 curated options matching their enquiry", "type": "action"},
  {"day": 2, "channel": "whatsapp", "action": "Check: Did they review options? Offer to customize/adjust", "type": "condition", "condition": "email_opened = true → personalize, else → resend"},
  {"day": 3, "channel": "sms", "action": "Limited time: ENQUIRY10 for 10% off — valid 48h", "type": "action"},
  {"day": 5, "channel": "whatsapp", "action": "Share what similar enquirers booked: Social proof with reviews", "type": "action"},
  {"day": 7, "channel": "email", "action": "Price comparison: Why Rayna vs competitors (value proposition)", "type": "action", "condition_next": "If no booking"},
  {"day": 10, "channel": "whatsapp", "action": "Flexible options: Different dates/group sizes/budget ranges", "type": "action"},
  {"day": 14, "channel": "email", "action": "Seasonal urgency: Limited availability for their travel dates", "type": "action"},
  {"day": 21, "channel": "whatsapp", "action": "Gentle re-engage: Plans still on? Happy to help anytime", "type": "action"},
  {"day": 30, "channel": "email", "action": "Monthly digest: New experiences + best deals in their category", "type": "action", "goal": "booking"}
]'::jsonb, description = 'Enquiry-to-booking conversion: Department-aware follow-up → Tailored options based on what they asked about → Persistent nurture until conversion. 11-step, 30-day journey.'
WHERE segment_label = 'Active Enquirers';

-- 7. Hesitant Browsers
UPDATE omnichannel_strategies SET flow_steps = '[
  {"day": 0, "channel": "email", "action": "Price drop alert on products they viewed 5+ times", "type": "trigger"},
  {"day": 2, "channel": "web", "action": "Retarget with exact viewed items + scarcity badge", "type": "action"},
  {"day": 3, "channel": "email", "action": "Curated top-3 from their browsing history + reviews", "type": "action"},
  {"day": 5, "channel": "push", "action": "Flash sale: 20% OFF (FLASH20) on popular items — 24h only", "type": "action"},
  {"day": 7, "channel": "email", "action": "Comparison guide: Their viewed products side-by-side", "type": "action", "condition_next": "If no click"},
  {"day": 10, "channel": "web", "action": "Retarget with video testimonial from similar traveler", "type": "action"},
  {"day": 14, "channel": "email", "action": "Free cancellation guarantee + best price promise", "type": "action"},
  {"day": 21, "channel": "email", "action": "New arrivals in categories they browsed", "type": "action", "goal": "booking"}
]'::jsonb, description = 'Hesitant-to-decisive: Price drop alerts → Retarget with viewed items → Social proof → Escalating urgency. 8-step, 21-day journey.'
WHERE segment_label = 'Hesitant Browsers';

-- 8. Payment Failed
UPDATE omnichannel_strategies SET flow_steps = '[
  {"day": 0, "channel": "whatsapp", "action": "Instant: Payment didn''t go through — retry link + PAYRETRY (AED 50 off)", "type": "trigger"},
  {"day": 0, "channel": "email", "action": "Payment failed email: Alternative methods (card/bank/Apple Pay)", "type": "action"},
  {"day": 0, "channel": "sms", "action": "Quick SMS: Payment needs attention — tap to retry", "type": "action"},
  {"day": 1, "channel": "whatsapp", "action": "Check: Resolved? If NO → offer manual booking assistance", "type": "condition", "condition": "payment_completed = false → offer_help"},
  {"day": 1, "channel": "email", "action": "Step-by-step payment troubleshooting guide", "type": "action"},
  {"day": 2, "channel": "whatsapp", "action": "Offer: Pay at counter option / bank transfer details", "type": "action"},
  {"day": 3, "channel": "email", "action": "Final: Booking reserved 24h more — AED 50 off to complete now", "type": "action"},
  {"day": 3, "channel": "sms", "action": "Last chance: Your booking expires today. Retry: link", "type": "action", "goal": "payment_completion"}
]'::jsonb, description = 'Payment recovery: Instant retry link → Alt payment methods → Manual assistance → Deadline urgency. 8-step, 3-day high-priority journey.'
WHERE segment_label = 'Payment Failed';

-- 9. Registered Not Booked
UPDATE omnichannel_strategies SET flow_steps = '[
  {"day": 0, "channel": "email", "action": "Welcome series: Account created! Here''s 15% OFF first booking (FIRST15)", "type": "trigger"},
  {"day": 1, "channel": "whatsapp", "action": "Best sellers by category: Tours / Visa / Packages — pick your adventure", "type": "action"},
  {"day": 3, "channel": "email", "action": "How it works guide: Browse → Book → Enjoy (3 easy steps)", "type": "action"},
  {"day": 5, "channel": "whatsapp", "action": "Share top-rated experience with photos + traveler review", "type": "action"},
  {"day": 7, "channel": "push", "action": "First booking 15% OFF — FIRST15 expiring in 7 days!", "type": "action"},
  {"day": 10, "channel": "email", "action": "What other new members booked: Popularity-based reco", "type": "action", "condition_next": "If no booking"},
  {"day": 14, "channel": "whatsapp", "action": "Personal touch: Need help choosing? Tell me your travel dates", "type": "action"},
  {"day": 21, "channel": "email", "action": "Budget picks: Experiences from AED 49 — no excuses!", "type": "action"},
  {"day": 30, "channel": "whatsapp", "action": "Re-engage: New seasonal launches — check them out", "type": "action"},
  {"day": 45, "channel": "email", "action": "Final: FIRST15 extended one last time — book before it''s gone", "type": "action", "goal": "first_booking"}
]'::jsonb, description = 'Dormant account activation: Welcome → Best sellers → How it works → Social proof → Budget options → Extended offer. 10-step, 45-day nurture.'
WHERE segment_label = 'Registered Not Booked';

-- 10. New Customers (0-30 days)
UPDATE omnichannel_strategies SET flow_steps = '[
  {"day": 0, "channel": "email", "action": "Booking confirmed! Tips for your experience + add-on suggestions", "type": "trigger"},
  {"day": 1, "channel": "whatsapp", "action": "Pre-trip: Meeting point / timing / what to bring reminders", "type": "action"},
  {"day": 3, "channel": "whatsapp", "action": "Cross-sell: Complement your trip — Desert Safari / Dhow Cruise / City Tour", "type": "action"},
  {"day": 5, "channel": "email", "action": "Complete your Dubai itinerary: Add these popular combos (WELCOME10)", "type": "action"},
  {"day": 7, "channel": "whatsapp", "action": "Check: Trip done? Ask for quick rating (1-5 stars)", "type": "condition", "condition": "trip_completed → ask_review"},
  {"day": 8, "channel": "email", "action": "Post-trip: Review request + share photos for feature", "type": "action"},
  {"day": 10, "channel": "whatsapp", "action": "Recommend next experience based on what they booked", "type": "action"},
  {"day": 14, "channel": "email", "action": "Second booking offer: 10% OFF (WELCOME10) — based on similar travelers", "type": "action"},
  {"day": 21, "channel": "whatsapp", "action": "New experiences launched this week — personalized picks", "type": "action"},
  {"day": 30, "channel": "email", "action": "Monthly: Your travel summary + loyalty points + upcoming deals", "type": "action", "goal": "repeat_booking"}
]'::jsonb, description = 'New customer delight: Confirmation → Pre-trip → Cross-sell → Review → Repeat booking push. 10-step, 30-day journey.'
WHERE segment_label = 'New Customers (0-30 days)';

-- 11. Post-Trip Review Window
UPDATE omnichannel_strategies SET flow_steps = '[
  {"day": 0, "channel": "email", "action": "How was your experience? Leave a review → get 15% OFF next trip", "type": "trigger"},
  {"day": 1, "channel": "whatsapp", "action": "Share your best photos! We''ll feature them on our page", "type": "action"},
  {"day": 2, "channel": "email", "action": "Check: Review submitted? If YES → thank + send REVIEW15", "type": "condition", "condition": "review_submitted → send_reward"},
  {"day": 3, "channel": "push", "action": "Rebook offer: 15% OFF your next adventure (REVIEW15)", "type": "action"},
  {"day": 5, "channel": "whatsapp", "action": "Based on your trip: Here are 3 experiences you''d love next", "type": "action"},
  {"day": 7, "channel": "email", "action": "Google Review request: Help other travelers discover us", "type": "action"},
  {"day": 10, "channel": "whatsapp", "action": "Referral: Share with friends — they get 15% off, you get 20% off", "type": "action"},
  {"day": 14, "channel": "email", "action": "Upcoming events & seasonal experiences near their travel dates", "type": "action", "goal": "review_and_rebook"}
]'::jsonb, description = 'Post-trip engagement: Review → Photo share → Google review → Rebook → Referral. 8-step, 14-day journey.'
WHERE segment_label = 'Post-Trip Review Window';

-- 12. One-Time Buyers (31-90 days)
UPDATE omnichannel_strategies SET flow_steps = '[
  {"day": 0, "channel": "email", "action": "Personalized recommendations based on their FIRST booking category", "type": "trigger"},
  {"day": 3, "channel": "whatsapp", "action": "What similar travelers booked next — social proof picks", "type": "action"},
  {"day": 5, "channel": "email", "action": "Upgrade offer: Premium version of what they did last time", "type": "action"},
  {"day": 7, "channel": "whatsapp", "action": "Cross-category: If they did tours → suggest visa, if visa → suggest tours", "type": "action", "condition": "match_previous_category → cross_sell"},
  {"day": 10, "channel": "sms", "action": "Loyalty points offer: Book now, earn double points (SECOND10)", "type": "action"},
  {"day": 14, "channel": "email", "action": "Combo deal: Bundle their favorite + a new experience at 15% OFF", "type": "action", "condition_next": "If no engagement"},
  {"day": 21, "channel": "whatsapp", "action": "Trip planning: Traveling again soon? Share dates for custom quote", "type": "action"},
  {"day": 30, "channel": "email", "action": "Monthly digest: New experiences in their preferred category", "type": "action"},
  {"day": 45, "channel": "whatsapp", "action": "SECOND10 extended: Your exclusive 10% off is still waiting", "type": "action"},
  {"day": 60, "channel": "email", "action": "Final: Best-of-season deals before they become At Risk", "type": "action", "goal": "second_booking"}
]'::jsonb, description = 'Second purchase push: Category-based recos → Cross-sell → Combos → Loyalty points → Extended nurture until 2nd booking. 10-step, 60-day journey.'
WHERE segment_label = 'One-Time Buyers (31-90 days)';

-- 13. Repeat Buyers
UPDATE omnichannel_strategies SET flow_steps = '[
  {"day": 0, "channel": "email", "action": "Loyalty program invite: Unlock VIP perks + LOYAL10 always-on discount", "type": "trigger"},
  {"day": 2, "channel": "whatsapp", "action": "Premium upgrade offer: Free upgrade on their most-booked experience", "type": "action"},
  {"day": 5, "channel": "email", "action": "Exclusive: Early access to new experiences before general release", "type": "action"},
  {"day": 7, "channel": "push", "action": "Push: Exclusive flash deal for repeat customers only", "type": "action"},
  {"day": 10, "channel": "whatsapp", "action": "Personal concierge: Want a custom itinerary? Just tell me dates", "type": "action"},
  {"day": 14, "channel": "email", "action": "VIP perks reminder: Priority booking, free upgrades, birthday gifts", "type": "action", "condition_next": "If no booking in 30 days"},
  {"day": 21, "channel": "whatsapp", "action": "Seasonal exclusive: Limited-edition experience only for loyalists", "type": "action"},
  {"day": 30, "channel": "email", "action": "Monthly VIP newsletter: Insider picks + member-only deals", "type": "action", "goal": "loyalty_and_repeat"}
]'::jsonb, description = 'Loyalty building: VIP invite → Upgrades → Early access → Concierge → Exclusive deals. 8-step, 30-day recurring cycle.'
WHERE segment_label = 'Repeat Buyers';

-- 14. Frequent Travelers (4+ bookings)
UPDATE omnichannel_strategies SET flow_steps = '[
  {"day": 0, "channel": "whatsapp", "action": "VIP Club welcome: Dedicated concierge assigned — I''m your go-to!", "type": "trigger"},
  {"day": 1, "channel": "email", "action": "VIP catalog: Premium & exclusive experiences (VIP15 always active)", "type": "action"},
  {"day": 3, "channel": "whatsapp", "action": "Exclusive invite: Private island / helicopter / yacht (limited spots)", "type": "action"},
  {"day": 5, "channel": "email", "action": "Travel calendar: Upcoming seasonal highlights matched to their history", "type": "action"},
  {"day": 7, "channel": "sms", "action": "VIP early access: New premium experience launching — book first", "type": "action"},
  {"day": 10, "channel": "whatsapp", "action": "Custom itinerary offer: Tell me your next travel window", "type": "action"},
  {"day": 14, "channel": "email", "action": "Ambassador program: Free experiences for content creation", "type": "action"},
  {"day": 21, "channel": "whatsapp", "action": "Surprise & delight: Complimentary upgrade on next booking", "type": "action"},
  {"day": 30, "channel": "email", "action": "VIP quarterly review: Your year in travel + upcoming perks", "type": "action", "goal": "vip_retention"}
]'::jsonb, description = 'VIP retention: Dedicated concierge → Premium catalog → Exclusive experiences → Ambassador program → Surprise perks. 9-step, 30-day VIP cycle.'
WHERE segment_label = 'Frequent Travelers (4+ bookings)';

-- 15. High Spenders (5000+ AED)
UPDATE omnichannel_strategies SET flow_steps = '[
  {"day": 0, "channel": "email", "action": "Premium collection: Curated luxury experiences (PREMIUM20 for 20% off)", "type": "trigger"},
  {"day": 2, "channel": "whatsapp", "action": "Personal luxury advisor: Private island, helicopter, yacht options", "type": "action"},
  {"day": 5, "channel": "email", "action": "Concierge portfolio: Full-service travel planning brochure", "type": "action"},
  {"day": 7, "channel": "whatsapp", "action": "Exclusive event invite: VIP-only seasonal gala/experience", "type": "action"},
  {"day": 10, "channel": "email", "action": "Premium partnerships: Luxury hotel + tour packages", "type": "action"},
  {"day": 14, "channel": "sms", "action": "Priority booking: New premium experience — reserve before launch", "type": "action"},
  {"day": 21, "channel": "whatsapp", "action": "Surprise: Complimentary luxury add-on with next booking", "type": "action"},
  {"day": 30, "channel": "email", "action": "Quarterly premium digest: New luxury offerings + VIP perks", "type": "action", "goal": "premium_retention"}
]'::jsonb, description = 'Premium client retention: Luxury catalog → Personal advisor → Exclusive events → Complimentary add-ons. 8-step, 30-day cycle.'
WHERE segment_label = 'High Spenders (5000+ AED)';

-- 16. Visa-Only → Tour Cross-Sell
UPDATE omnichannel_strategies SET flow_steps = '[
  {"day": 0, "channel": "email", "action": "Visa sorted! Now plan the fun — top tours for your DESTINATION", "type": "trigger", "condition": "match_visa_destination → show_relevant_tours"},
  {"day": 2, "channel": "whatsapp", "action": "What to do in Dubai: Curated itinerary based on visa type/duration", "type": "action"},
  {"day": 5, "channel": "email", "action": "Bundle deal: Tour + transfer combo — save AED 100 (VISADEAL)", "type": "action"},
  {"day": 7, "channel": "whatsapp", "action": "Travel tips: Must-do experiences for their nationality/origin", "type": "action"},
  {"day": 10, "channel": "email", "action": "Other visa holders loved these: Social proof by nationality", "type": "action", "condition_next": "If no tour booking"},
  {"day": 14, "channel": "whatsapp", "action": "Group activity? Let me plan an itinerary for your travel dates", "type": "action"},
  {"day": 21, "channel": "email", "action": "Travel approaching: Last chance to add experiences to your trip", "type": "action"},
  {"day": 28, "channel": "whatsapp", "action": "Arriving soon? Book last-minute activities — instant confirmation", "type": "action", "goal": "tour_booking"}
]'::jsonb, description = 'Visa-to-tour cross-sell: Destination-aware recommendations → Bundle deals → Nationality-based social proof → Pre-arrival push. 8-step, 28-day journey.'
WHERE segment_label = 'Visa-Only → Tour Cross-Sell';

-- 17. Tour-Only → Visa Cross-Sell
UPDATE omnichannel_strategies SET flow_steps = '[
  {"day": 0, "channel": "email", "action": "Planning another trip? We handle visas so you focus on fun", "type": "trigger"},
  {"day": 3, "channel": "whatsapp", "action": "Visa made easy: UAE/Schengen/UK/US — 2-5 business day processing", "type": "action"},
  {"day": 5, "channel": "email", "action": "Tour + Visa bundle: Save AED 75 when you add visa (TOURDEAL)", "type": "action"},
  {"day": 7, "channel": "whatsapp", "action": "Check: Traveling internationally? Let me check visa requirements", "type": "action"},
  {"day": 10, "channel": "email", "action": "Visa success stories: 98% approval rate + process walkthrough", "type": "action", "condition_next": "If no visa purchase"},
  {"day": 14, "channel": "whatsapp", "action": "Document checklist: Here''s exactly what you need for your visa", "type": "action"},
  {"day": 21, "channel": "email", "action": "Peak season alert: Apply now to avoid processing delays", "type": "action", "goal": "visa_purchase"}
]'::jsonb, description = 'Tour-to-visa cross-sell: Convenience pitch → Bundle savings → Document guidance → Urgency for peak season. 7-step, 21-day journey.'
WHERE segment_label = 'Tour-Only → Visa Cross-Sell';

-- 18-22. Win-Back stages (Cooling → At Risk → Hibernating → Lost High → Lost Regular)
UPDATE omnichannel_strategies SET flow_steps = '[
  {"day": 0, "channel": "email", "action": "What''s new: Fresh experiences added since your last visit", "type": "trigger"},
  {"day": 2, "channel": "whatsapp", "action": "Trending now: Top 3 experiences other travelers are loving", "type": "action"},
  {"day": 5, "channel": "email", "action": "Re-engagement: COOL10 for 10% off — we''d love to see you back", "type": "action"},
  {"day": 7, "channel": "push", "action": "Push: Flash deal on their previously booked category", "type": "action"},
  {"day": 10, "channel": "whatsapp", "action": "Personalized: Based on your past trips, you''d love these", "type": "action", "condition_next": "If no engagement"},
  {"day": 14, "channel": "email", "action": "Seasonal calendar: Upcoming events & limited experiences", "type": "action"},
  {"day": 21, "channel": "whatsapp", "action": "Soft touch: Miss traveling? We have new budget-friendly options", "type": "action"},
  {"day": 30, "channel": "email", "action": "Monthly digest: Best deals + new arrivals in your categories", "type": "action", "goal": "reactivation"}
]'::jsonb, description = 'Cooling down re-engagement: New content → Trending → Discount → Category-based → Monthly digest. 8-step, 30-day journey.'
WHERE segment_label = 'Cooling Down (31-60 days)';

UPDATE omnichannel_strategies SET flow_steps = '[
  {"day": 0, "channel": "email", "action": "We miss you! 15% OFF comeback booking (RISK15)", "type": "trigger"},
  {"day": 2, "channel": "whatsapp", "action": "Exclusive comeback deal based on their BOOKING HISTORY", "type": "action", "condition": "match_past_bookings → personalized_offer"},
  {"day": 5, "channel": "sms", "action": "Last chance: RISK15 expires in 7 days", "type": "action"},
  {"day": 7, "channel": "email", "action": "What''s changed: New experiences, better prices, more destinations", "type": "action"},
  {"day": 10, "channel": "whatsapp", "action": "Flexible booking: Free cancellation + date change guarantee", "type": "action", "condition_next": "If no response"},
  {"day": 14, "channel": "email", "action": "Budget-friendly: Great experiences starting from AED 49", "type": "action"},
  {"day": 21, "channel": "whatsapp", "action": "Personal message: Is there anything we could do better?", "type": "action"},
  {"day": 30, "channel": "email", "action": "Final re-engagement: Extended offer + new seasonal experiences", "type": "action"},
  {"day": 45, "channel": "whatsapp", "action": "Quarterly check-in: New launches in categories you loved", "type": "action", "goal": "winback_booking"}
]'::jsonb, description = 'At-risk win-back: History-based offers → Escalating discounts → Flexibility → Budget options → Quarterly check-in. 9-step, 45-day journey.'
WHERE segment_label = 'At Risk (61-120 days)';

UPDATE omnichannel_strategies SET flow_steps = '[
  {"day": 0, "channel": "email", "action": "A lot has changed! 20% OFF deep discount welcome back (HIBER20)", "type": "trigger"},
  {"day": 3, "channel": "whatsapp", "action": "Showcase: Completely new experiences we''ve added since their last visit", "type": "action"},
  {"day": 7, "channel": "sms", "action": "HIBER20 reminder: 20% OFF — limited time reactivation offer", "type": "action"},
  {"day": 10, "channel": "email", "action": "Traveler spotlight: Customer stories from their nationality/region", "type": "action", "condition_next": "If no engagement"},
  {"day": 14, "channel": "whatsapp", "action": "Budget picks: Amazing experiences from AED 49 — no barrier to return", "type": "action"},
  {"day": 21, "channel": "email", "action": "Final: HIBER20 extended one last time + seasonal highlights", "type": "action"},
  {"day": 30, "channel": "whatsapp", "action": "Soft re-engage: We''d love you back. Any travel plans?", "type": "action", "goal": "reactivation"}
]'::jsonb, description = 'Hibernating win-back: Deep discount → New showcase → Budget options → Extended offer. 7-step, 30-day journey.'
WHERE segment_label = 'Hibernating (121-180 days)';

UPDATE omnichannel_strategies SET flow_steps = '[
  {"day": 0, "channel": "email", "action": "Personal letter from team: We genuinely miss you + 25% VIP comeback", "type": "trigger"},
  {"day": 2, "channel": "whatsapp", "action": "VIP comeback package: 25% OFF + free upgrade + hotel pickup (VIPBACK25)", "type": "action"},
  {"day": 5, "channel": "sms", "action": "Exclusive VIP invitation — your private concierge is waiting", "type": "action"},
  {"day": 7, "channel": "email", "action": "Your travel history: Celebrating your journeys with us + what''s new", "type": "action"},
  {"day": 10, "channel": "whatsapp", "action": "Custom itinerary: Let me plan your perfect return trip", "type": "action", "condition_next": "If no response"},
  {"day": 14, "channel": "email", "action": "Premium new additions: Luxury experiences crafted for travelers like you", "type": "action"},
  {"day": 21, "channel": "whatsapp", "action": "Extended: VIPBACK25 valid one more week — your VIP status is permanent", "type": "action"},
  {"day": 30, "channel": "email", "action": "Quarterly: Premium digest + your account perks still waiting", "type": "action", "goal": "vip_recovery"}
]'::jsonb, description = 'Lost VIP recovery: Personal outreach → VIP package → Travel history → Custom itinerary → Quarterly premium digest. 8-step, 30-day high-touch journey.'
WHERE segment_label = 'Lost High-Value (180+ days, 3000+ AED)';

UPDATE omnichannel_strategies SET flow_steps = '[
  {"day": 0, "channel": "email", "action": "Long time no see! 20% OFF to welcome you back (LOSTDEAL)", "type": "trigger"},
  {"day": 3, "channel": "whatsapp", "action": "Flash sale alert: Best Dubai experiences at lowest prices ever", "type": "action"},
  {"day": 7, "channel": "email", "action": "Budget-friendly picks: Amazing experiences from AED 49", "type": "action"},
  {"day": 10, "channel": "whatsapp", "action": "What''s changed: New experiences + better prices + easier booking", "type": "action", "condition_next": "If no engagement"},
  {"day": 14, "channel": "email", "action": "Social proof: What recent travelers are saying (by nationality)", "type": "action"},
  {"day": 21, "channel": "whatsapp", "action": "LOSTDEAL extended: 20% OFF valid one more week", "type": "action"},
  {"day": 30, "channel": "email", "action": "Quarterly seasonal deals: Best time to visit + lowest prices", "type": "action", "goal": "winback_booking"}
]'::jsonb, description = 'Lost regular win-back: Welcome back offer → Flash sale → Budget picks → Social proof → Extended offer. 7-step, 30-day journey.'
WHERE segment_label = 'Lost Regular (180+ days, <3000 AED)';

-- 23-25. Advocacy
UPDATE omnichannel_strategies SET flow_steps = '[
  {"day": 0, "channel": "email", "action": "Thank you for your review! Join our referral program (REFER20)", "type": "trigger"},
  {"day": 2, "channel": "whatsapp", "action": "Share on Google/TripAdvisor → unlock AED 50 credit", "type": "action"},
  {"day": 5, "channel": "email", "action": "Referral details: Your friends get 15% off, you get 20% off", "type": "action"},
  {"day": 7, "channel": "whatsapp", "action": "Feature request: Can we use your review in our marketing?", "type": "action"},
  {"day": 10, "channel": "email", "action": "Your referral dashboard: Track shares, earnings, rewards", "type": "action"},
  {"day": 14, "channel": "whatsapp", "action": "Milestone: Refer 3 friends → unlock free experience", "type": "action"},
  {"day": 21, "channel": "email", "action": "Next booking: REFER20 for your next adventure + referral update", "type": "action", "goal": "referral_activation"}
]'::jsonb, description = 'Referral activation: Review amplification → Google/TripAdvisor → Referral program → Milestone rewards. 7-step, 21-day journey.'
WHERE segment_label = 'Happy Reviewers (4-5 Stars)';

UPDATE omnichannel_strategies SET flow_steps = '[
  {"day": 0, "channel": "email", "action": "We love your posts! Apply to be a Rayna Ambassador", "type": "trigger"},
  {"day": 3, "channel": "whatsapp", "action": "Ambassador perks: Free experiences + 15% commission + featured content", "type": "action"},
  {"day": 7, "channel": "email", "action": "Content brief: Next experience we''d love you to cover + guidelines", "type": "action"},
  {"day": 10, "channel": "whatsapp", "action": "Your UGC featured! Thank you — here''s your next free experience", "type": "action"},
  {"day": 14, "channel": "email", "action": "Monthly ambassador newsletter: Upcoming experiences to cover", "type": "action"},
  {"day": 21, "channel": "whatsapp", "action": "Exclusive: New experience launch — cover it first! AMBDOR15", "type": "action", "goal": "ambassador_activation"}
]'::jsonb, description = 'Social ambassador: Application → Content brief → UGC feature → Monthly program. 6-step, 21-day journey.'
WHERE segment_label = 'Social Media Advocates';

UPDATE omnichannel_strategies SET flow_steps = '[
  {"day": 0, "channel": "email", "action": "Thank you for being a promoter! Your referral code: NPSREFER", "type": "trigger"},
  {"day": 3, "channel": "whatsapp", "action": "Google review request: Help others discover Rayna Tours", "type": "action"},
  {"day": 7, "channel": "email", "action": "Referral program: Friends get 15% off, you earn 20% off", "type": "action"},
  {"day": 14, "channel": "whatsapp", "action": "Milestone check: How many referrals — unlock VIP status at 5", "type": "action"},
  {"day": 21, "channel": "email", "action": "Promoter exclusive: Early access to seasonal deals", "type": "action", "goal": "referral_growth"}
]'::jsonb, description = 'NPS promoter activation: Referral code → Google review → Referral program → VIP milestone. 5-step, 21-day journey.'
WHERE segment_label = 'NPS Promoters';

-- 26-28. Special segments
UPDATE omnichannel_strategies SET flow_steps = '[
  {"day": 0, "channel": "email", "action": "Corporate catalog: Group tours, MICE, team building + volume pricing", "type": "trigger"},
  {"day": 3, "channel": "whatsapp", "action": "Account manager intro: Dedicated B2B support — share requirements", "type": "action"},
  {"day": 5, "channel": "email", "action": "Custom proposal based on THEIR ENQUIRY: Packages / Hotels / Visa", "type": "action", "condition": "match_ticket_subject → tailored_proposal"},
  {"day": 7, "channel": "whatsapp", "action": "Follow-up: Proposal review — any adjustments needed?", "type": "action"},
  {"day": 10, "channel": "email", "action": "Case study: How similar companies used our corporate services", "type": "action", "condition_next": "If no booking"},
  {"day": 14, "channel": "whatsapp", "action": "Volume discount: CORPVOL10 for 10+ pax bookings", "type": "action"},
  {"day": 21, "channel": "email", "action": "Seasonal corporate packages: Team outings / conferences / incentive trips", "type": "action"},
  {"day": 30, "channel": "whatsapp", "action": "Quarterly check-in: Upcoming group travel plans? Let us help", "type": "action"},
  {"day": 60, "channel": "email", "action": "Annual review: Partnership opportunities + new corporate services", "type": "action", "goal": "corporate_booking"}
]'::jsonb, description = 'Corporate growth: Catalog → Account manager → Enquiry-based proposal → Case studies → Volume deals → Quarterly check-in. 9-step, 60-day B2B cycle.'
WHERE segment_label = 'B2B & Corporate';

UPDATE omnichannel_strategies SET flow_steps = '[
  {"day": 0, "channel": "email", "action": "Happy Birthday! 🎂 25% OFF any experience — our gift to you (BDAY25)", "type": "trigger"},
  {"day": 1, "channel": "whatsapp", "action": "Birthday special packages: Desert party / Yacht cruise / Beach day", "type": "action"},
  {"day": 3, "channel": "email", "action": "Celebrate with friends: Group booking discounts for birthday parties", "type": "action"},
  {"day": 5, "channel": "whatsapp", "action": "Reminder: BDAY25 valid all month — treat yourself!", "type": "action"},
  {"day": 7, "channel": "sms", "action": "Birthday week special: Extra surprise with any booking this week", "type": "action"},
  {"day": 14, "channel": "email", "action": "Mid-month: BDAY25 still active — don''t miss your birthday treat", "type": "action"},
  {"day": 21, "channel": "whatsapp", "action": "Last week: Birthday offer expiring — book before month ends!", "type": "action"},
  {"day": 28, "channel": "email", "action": "Final: BDAY25 expires tomorrow — last chance for birthday discount", "type": "action", "goal": "birthday_booking"}
]'::jsonb, description = 'Birthday celebration: Day-of greeting → Special packages → Group deals → Weekly reminders until month end. 8-step, 28-day journey.'
WHERE segment_label = 'Birthday Month';

UPDATE omnichannel_strategies SET flow_steps = '[
  {"day": 0, "channel": "email", "action": "Your booking is protected: Free cancellation + date change options", "type": "trigger"},
  {"day": 1, "channel": "whatsapp", "action": "Flexibility assurance: Change dates/activities at no extra cost", "type": "action"},
  {"day": 3, "channel": "email", "action": "Pre-trip excitement: What to expect + traveler tips + photos", "type": "action"},
  {"day": 5, "channel": "whatsapp", "action": "Check-in: Everything set? Any concerns about your booking?", "type": "condition", "condition": "if_concern → connect_support"},
  {"day": 7, "channel": "email", "action": "Best price guarantee: If you find cheaper, we''ll match it", "type": "action"},
  {"day": 10, "channel": "whatsapp", "action": "Add-on suggestion: Enhance with upgrade/combo (FLEX10 for 10% off)", "type": "action"},
  {"day": 14, "channel": "email", "action": "Final reassurance: Your booking details + contact for any changes", "type": "action", "goal": "prevent_cancellation"}
]'::jsonb, description = 'Cancellation prevention: Flexibility assurance → Pre-trip excitement → Concern check → Price guarantee → Add-ons. 7-step, 14-day journey.'
WHERE segment_label = 'High Cancellation Risk';


-- ══════════════════════════════════════════════════════════════
-- STEP 2: REBUILD JOURNEY FLOWS WITH DETAILED NODES + EDGES
-- Now includes: trigger, wait, condition, action, goal nodes
-- ══════════════════════════════════════════════════════════════

-- Delete old simple journeys
DELETE FROM journey_events;
DELETE FROM journey_entries;
DELETE FROM journey_flows;

-- Rebuild with rich nodes and edges from updated flow_steps
INSERT INTO journey_flows (name, description, segment_id, strategy_id, status, goal_type, goal_value, created_by, nodes, edges)
SELECT
  os.name || ' Journey',
  os.description,
  sd.segment_id,
  os.id,
  'active',
  'conversion',
  'booking',
  'system',
  -- Build detailed nodes
  (
    SELECT jsonb_agg(node ORDER BY node_order)
    FROM (
      -- Trigger node at start
      SELECT 0 AS node_order, jsonb_build_object(
        'id', 'trigger_0',
        'type', 'trigger',
        'position', jsonb_build_object('x', 250, 'y', 50),
        'data', jsonb_build_object(
          'label', 'Customer enters segment: ' || sd.segment_name,
          'segment_id', sd.segment_id,
          'trigger_type', 'segment_entry'
        )
      ) AS node

      UNION ALL

      -- Action/condition/wait nodes from flow_steps
      SELECT
        (row_number() OVER ())::int AS node_order,
        jsonb_build_object(
          'id', 'node_' || (row_number() OVER ()),
          'type', CASE
            WHEN step->>'type' = 'condition' THEN 'condition'
            WHEN step->>'condition' IS NOT NULL THEN 'condition'
            ELSE 'action'
          END,
          'position', jsonb_build_object('x', 250, 'y', 50 + (row_number() OVER ()) * 120),
          'data', jsonb_build_object(
            'label', step->>'action',
            'channel', step->>'channel',
            'day', (step->>'day')::int,
            'condition', step->>'condition',
            'condition_next', step->>'condition_next',
            'goal', step->>'goal',
            'template_id', (
              SELECT ct.id FROM content_templates ct
              WHERE ct.segment_label = sd.segment_name
                AND ct.channel::text = step->>'channel'
              ORDER BY ct.id
              LIMIT 1
            )
          )
        ) AS node
      FROM jsonb_array_elements(os.flow_steps) WITH ORDINALITY AS t(step, idx)

      UNION ALL

      -- Goal node at end
      SELECT
        (jsonb_array_length(os.flow_steps) + 1)::int AS node_order,
        jsonb_build_object(
          'id', 'goal_end',
          'type', 'goal',
          'position', jsonb_build_object('x', 250, 'y', 50 + (jsonb_array_length(os.flow_steps) + 1) * 120),
          'data', jsonb_build_object(
            'label', 'Conversion Goal: Booking / Registration',
            'goal_type', 'booking'
          )
        ) AS node
    ) sub
  ),
  -- Build edges connecting all nodes sequentially + wait indicators
  (
    SELECT jsonb_agg(edge ORDER BY edge_order)
    FROM (
      -- Trigger → first node
      SELECT 0 AS edge_order, jsonb_build_object(
        'id', 'edge_trigger',
        'source', 'trigger_0',
        'target', 'node_1',
        'type', 'default',
        'data', jsonb_build_object('label', 'Start journey')
      ) AS edge

      UNION ALL

      -- Node-to-node edges
      SELECT
        idx::int AS edge_order,
        jsonb_build_object(
          'id', 'edge_' || idx,
          'source', 'node_' || idx,
          'target', CASE
            WHEN idx < jsonb_array_length(os.flow_steps) THEN 'node_' || (idx + 1)
            ELSE 'goal_end'
          END,
          'type', CASE
            WHEN step->>'condition' IS NOT NULL OR step->>'condition_next' IS NOT NULL THEN 'conditional'
            ELSE 'default'
          END,
          'data', jsonb_build_object(
            'wait_days', CASE
              WHEN idx < jsonb_array_length(os.flow_steps)
              THEN GREATEST(0, COALESCE((os.flow_steps->(idx::int)->>'day')::int, 0) - COALESCE((step->>'day')::int, 0))
              ELSE 0
            END,
            'label', CASE
              WHEN step->>'condition_next' IS NOT NULL THEN step->>'condition_next'
              WHEN idx < jsonb_array_length(os.flow_steps) AND (os.flow_steps->(idx::int)->>'day')::int > (step->>'day')::int
              THEN 'Wait ' || ((os.flow_steps->(idx::int)->>'day')::int - (step->>'day')::int) || ' day(s)'
              ELSE 'Continue'
            END
          )
        ) AS edge
      FROM jsonb_array_elements(os.flow_steps) WITH ORDINALITY AS t(step, idx)
    ) sub
  )
FROM segment_definitions sd
JOIN omnichannel_strategies os ON os.segment_label = sd.segment_name AND os.status = 'active';


COMMIT;
