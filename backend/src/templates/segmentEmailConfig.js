/**
 * Segment-specific email template configurations
 *
 * Maps all 28 segments to a base template layout + custom content:
 *   heading, body, subject, CTA, coupon, urgency banner
 *
 * Base layouts: cart-abandonment, exclusive-coupon, product-recommendation,
 *               wishlist-reminder, welcome-back
 */

const SEGMENT_EMAIL_CONFIG = {

  // ═══════════════════════════════════════════════
  // STAGE 1: AWARENESS (Segments 29-31)
  // ═══════════════════════════════════════════════

  'Social Ad Leads': {
    baseTemplate: 'product-recommendation',
    subject: 'Welcome to Rayna Tours — Discover Dubai Like Never Before!',
    email_heading: 'Discover the Magic of Dubai',
    email_body: `Thank you for your interest in Rayna Tours! Whether you're planning a thrilling desert safari, a stunning city tour, or an unforgettable dinner cruise — we've got the perfect experience for you.<br /><br />As a special welcome, enjoy an exclusive discount on your first booking. Explore our top-rated experiences handpicked just for you.`,
    coupon_code: 'WELCOME10',
    coupon_discount: 'Flat 10% Off Your First Booking',
    coupon_expiry: '7 days',
    cta_url: 'https://www.raynatours.com',
    cta_text: 'Explore Now',
  },

  'Website Browsers': {
    baseTemplate: 'product-recommendation',
    subject: 'Still Exploring? Here Are Dubai\'s Top Experiences!',
    email_heading: 'Your Dream Dubai Trip Awaits',
    email_body: `We noticed you were exploring some amazing experiences on Rayna Tours. From iconic landmarks to hidden gems, Dubai has something incredible for everyone.<br /><br />Based on what caught your eye, here are our most popular experiences — all at special prices. Don't miss out!`,
    coupon_code: 'EXPLORE15',
    coupon_discount: 'Flat 15% Off',
    coupon_expiry: '5 days',
    cta_url: 'https://www.raynatours.com',
    cta_text: 'Browse Experiences',
  },

  'WhatsApp First-Touch': {
    baseTemplate: 'exclusive-coupon',
    subject: 'Thanks for Connecting! Here\'s Your Exclusive Offer',
    email_heading: 'Great to Connect With You!',
    email_body: `Thank you for reaching out to us on WhatsApp! We're thrilled to help you plan an unforgettable experience in Dubai and beyond.<br /><br />As a thank you for connecting, here's an exclusive coupon for your first booking with Rayna Tours. Whether it's a desert safari, city tour, or theme park — we've got you covered!`,
    coupon_code: 'WAFIRST10',
    coupon_discount: 'Flat 10% Off',
    coupon_expiry: '72 hours',
    cta_url: 'https://www.raynatours.com',
    cta_text: 'Book Now',
  },

  // ═══════════════════════════════════════════════
  // STAGE 2: CONSIDERATION (Segments 32-36)
  // ═══════════════════════════════════════════════

  'Fresh Cart Abandoners (0-3 days)': {
    baseTemplate: 'cart-abandonment',
    subject: 'Your Adventure Awaits — Complete Your Booking!',
    email_heading: 'Your Adventure Awaits',
    email_body: `We noticed you left something amazing in your cart. This experience is in high demand and availability is limited. Complete your booking now to secure your spot!`,
    cta_url: 'https://www.raynatours.com/cart',
    cta_text: 'Complete Booking',
    urgency_icon: 'cart',
    urgency_text: 'Your Cart Will Expire Soon',
  },

  'Stale Cart Abandoners (4-14 days)': {
    baseTemplate: 'product-recommendation',
    subject: 'We Saved Your Cart + An Exclusive Discount!',
    email_heading: 'Your Cart is Still Waiting',
    email_body: `It's been a few days since you were browsing some incredible experiences on Rayna Tours. We don't want you to miss out!<br /><br />As a special gesture, here's an exclusive discount to help you complete your booking. Your selected experiences are still available — but availability is limited.`,
    coupon_code: 'COMEBACK15',
    coupon_discount: 'Flat 15% Off',
    coupon_expiry: '48 hours',
    cta_url: 'https://www.raynatours.com/cart',
    cta_text: 'Complete Booking',
  },

  'Active Enquirers': {
    baseTemplate: 'product-recommendation',
    subject: 'Your Enquiry Update — Special Prices Inside!',
    email_heading: 'Your Travel Enquiry is Important to Us',
    email_body: `Thank you for your recent enquiry with Rayna Tours! We understand you're looking for the perfect experience.<br /><br />Based on your interests, we've curated the best options at exclusive prices. Book now and let us turn your travel dreams into reality!`,
    coupon_code: 'ENQUIRY10',
    coupon_discount: 'Flat 10% Off',
    coupon_expiry: '5 days',
    cta_url: 'https://www.raynatours.com',
    cta_text: 'View Recommendations',
  },

  'Hesitant Browsers': {
    baseTemplate: 'exclusive-coupon',
    subject: 'Still Deciding? Here\'s Something to Help!',
    email_heading: 'We Know Choosing is Hard!',
    email_body: `We've noticed you've been exploring some fantastic experiences. Making decisions can be tough — especially when everything looks amazing!<br /><br />To help you take the leap, here's a special coupon exclusively for you. This offer won't last long, so grab it while you can!`,
    coupon_code: 'DECIDE20',
    coupon_discount: 'Flat 20% Off',
    coupon_expiry: '24 hours',
    cta_url: 'https://www.raynatours.com',
    cta_text: 'Use Coupon Now',
  },

  'Payment Failed': {
    baseTemplate: 'cart-abandonment',
    subject: 'Oops! Your Payment Didn\'t Go Through — Let\'s Fix It',
    email_heading: 'Your Booking is Almost Done!',
    email_body: `It looks like there was an issue processing your payment. Don't worry — your selected experience is still reserved for you!<br /><br />Please try again with a different payment method or contact our 24/7 support team for assistance. We're here to help you secure your adventure!`,
    cta_url: 'https://www.raynatours.com/cart',
    cta_text: 'Retry Payment',
    urgency_icon: 'cart',
    urgency_text: 'Your Reservation is Held for 24 Hours',
  },

  // ═══════════════════════════════════════════════
  // STAGE 3: CONVERSION (Segments 37-40)
  // ═══════════════════════════════════════════════

  'Registered Not Booked': {
    baseTemplate: 'product-recommendation',
    subject: 'Welcome Aboard! Here\'s Your First Booking Discount',
    email_heading: 'Let\'s Get You Started!',
    email_body: `Welcome to Rayna Tours! We're so glad you registered. You're just one step away from an incredible experience in Dubai, Abu Dhabi, and beyond.<br /><br />As a welcome gift, enjoy a special discount on your first booking. Choose from 3,000+ experiences and start your adventure today!`,
    coupon_code: 'FIRSTBOOK20',
    coupon_discount: 'Flat 20% Off Your First Booking',
    coupon_expiry: '7 days',
    cta_url: 'https://www.raynatours.com',
    cta_text: 'Book Your First Experience',
  },

  'New Customers (0-30 days)': {
    baseTemplate: 'product-recommendation',
    subject: 'Loved Your First Trip? Here\'s What\'s Next!',
    email_heading: 'Your Next Adventure is Calling',
    email_body: `We hope you had an amazing experience with Rayna Tours! Based on what you loved, we've picked more incredible experiences you'll enjoy.<br /><br />Explore our handpicked recommendations and book your next adventure at a special returning customer price.`,
    coupon_code: 'NEXTTRIP10',
    coupon_discount: 'Flat 10% Off Your Next Booking',
    coupon_expiry: '14 days',
    cta_url: 'https://www.raynatours.com',
    cta_text: 'Discover More',
  },

  'Post-Trip Review Window': {
    baseTemplate: 'welcome-back',
    subject: 'How Was Your Experience? Share & Save!',
    email_heading: 'How Was Your Trip?',
    email_body: `We'd love to hear about your recent experience with Rayna Tours! Your feedback helps us improve and helps other travelers make great choices.<br /><br />Share your review and unlock an exclusive discount on your next booking as a thank you!`,
    coupon_code: 'REVIEW15',
    coupon_discount: '15% Off After Your Review',
    coupon_expiry: '30 days',
    cta_url: 'https://www.raynatours.com/review',
    cta_text: 'Write a Review',
  },

  'One-Time Buyers (31-90 days)': {
    baseTemplate: 'product-recommendation',
    subject: 'It\'s Been a While — Your Next Dubai Adventure Awaits!',
    email_heading: 'Ready for Round Two?',
    email_body: `It's been a while since your last booking with Rayna Tours. We've added lots of new experiences and exciting deals just for returning customers like you.<br /><br />Don't miss these exclusive picks curated based on your last trip. Book today and save!`,
    coupon_code: 'RETURN15',
    coupon_discount: 'Flat 15% Off',
    coupon_expiry: '7 days',
    cta_url: 'https://www.raynatours.com',
    cta_text: 'Explore New Experiences',
  },

  // ═══════════════════════════════════════════════
  // STAGE 4: GROWTH (Segments 41-45)
  // ═══════════════════════════════════════════════

  'Repeat Buyers': {
    baseTemplate: 'product-recommendation',
    subject: 'Your Loyalty Deserves a Reward — Exclusive Picks Inside!',
    email_heading: 'Handpicked Just for You',
    email_body: `As one of our valued repeat customers, we've curated a special selection of experiences based on your booking history. From hidden gems to trending activities — these are chosen just for you.<br /><br />Plus, enjoy a loyalty discount on your next booking!`,
    coupon_code: 'LOYAL10',
    coupon_discount: 'Flat 10% Loyalty Discount',
    coupon_expiry: '14 days',
    cta_url: 'https://www.raynatours.com',
    cta_text: 'View My Picks',
  },

  'Frequent Travelers (4+ bookings)': {
    baseTemplate: 'exclusive-coupon',
    subject: 'VIP Access: Exclusive Experiences & Premium Discounts',
    email_heading: 'Your VIP Perks Are Here!',
    email_body: `As a frequent Rayna Tours traveler, you deserve the best! We're rolling out the red carpet with exclusive VIP experiences, priority bookings, and premium discounts reserved only for travelers like you.<br /><br />Explore luxury desert camps, private yacht charters, and exclusive guided tours at unbeatable prices.`,
    coupon_code: 'VIP20',
    coupon_discount: 'Flat 20% VIP Discount',
    coupon_expiry: '30 days',
    cta_url: 'https://www.raynatours.com/vip',
    cta_text: 'Access VIP Deals',
  },

  'High Spenders (5000+ AED)': {
    baseTemplate: 'product-recommendation',
    subject: 'Premium Collection — Curated for Distinguished Travelers',
    email_heading: 'The Premium Collection',
    email_body: `As one of our most valued guests, we've assembled an exclusive collection of premium experiences designed for discerning travelers like you.<br /><br />From private helicopter tours to luxury yacht dinners — each experience is crafted to deliver unforgettable moments. Enjoy preferred pricing as our distinguished guest.`,
    coupon_code: 'PREMIUM15',
    coupon_discount: 'Flat 15% Off Premium Experiences',
    coupon_expiry: '30 days',
    cta_url: 'https://www.raynatours.com/premium',
    cta_text: 'Explore Premium',
  },

  'Visa-Only → Tour Cross-Sell': {
    baseTemplate: 'product-recommendation',
    subject: 'Your Visa is Ready — Now Explore Dubai\'s Best Experiences!',
    email_heading: 'Visa Done. Adventure Begins!',
    email_body: `Congratulations on processing your visa through Rayna Tours! Now that your travel documents are sorted, it's time to plan the fun part.<br /><br />Discover Dubai's most popular tours, desert safaris, theme parks, and more. We've handpicked these based on your destination — book now and save!`,
    coupon_code: 'VISA2TOUR15',
    coupon_discount: 'Flat 15% Off Your First Tour',
    coupon_expiry: '14 days',
    cta_url: 'https://www.raynatours.com/tours',
    cta_text: 'Browse Tours',
  },

  'Tour-Only → Visa Cross-Sell': {
    baseTemplate: 'exclusive-coupon',
    subject: 'Planning Your Next Trip? Get Your Visa Hassle-Free!',
    email_heading: 'Need a Visa? We\'ve Got You Covered!',
    email_body: `Planning to explore beyond Dubai? Rayna Tours offers hassle-free visa processing for 50+ countries — fast, reliable, and with dedicated support at every step.<br /><br />As a valued customer, enjoy a special discount on visa services. Apply now and travel worry-free!`,
    coupon_code: 'TOUR2VISA',
    coupon_discount: 'AED 50 Off Visa Services',
    coupon_expiry: '30 days',
    cta_url: 'https://www.raynatours.com/visa',
    cta_text: 'Apply for Visa',
  },

  // ═══════════════════════════════════════════════
  // STAGE 5: WIN-BACK (Segments 46-50)
  // ═══════════════════════════════════════════════

  'Cooling Down (31-60 days)': {
    baseTemplate: 'wishlist-reminder',
    subject: 'We Miss You! Come Back for New Adventures',
    email_heading: 'We Miss You!',
    email_body: `It's been a while since your last visit to Rayna Tours. We've been busy adding new experiences, seasonal specials, and trending activities just for you.<br /><br />Don't miss out — <b style="color:#2f2f2f">prices are subject to change</b> based on demand. Book now to lock in today's rate!`,
    cta_url: 'https://www.raynatours.com',
    cta_text: 'See What\'s New',
  },

  'At Risk (61-120 days)': {
    baseTemplate: 'product-recommendation',
    subject: 'It\'s Been Too Long — Here\'s 20% Off to Welcome You Back!',
    email_heading: 'Let\'s Reignite Your Wanderlust',
    email_body: `We haven't seen you in a while and we miss having you with us! A lot has changed — new experiences, better prices, and exclusive deals.<br /><br />As a special "welcome back" gesture, here's a generous discount. Don't let this offer slip away!`,
    coupon_code: 'WEBACK20',
    coupon_discount: 'Flat 20% Off',
    coupon_expiry: '5 days',
    cta_url: 'https://www.raynatours.com',
    cta_text: 'Claim Your Discount',
  },

  'Hibernating (121-180 days)': {
    baseTemplate: 'welcome-back',
    subject: 'A Special Surprise Just for You — 25% Off Everything!',
    email_heading: 'We Haven\'t Forgotten You!',
    email_body: `It's been a long time, and we want you back! Rayna Tours has grown with hundreds of new experiences across Dubai, Abu Dhabi, Singapore, Thailand, and more.<br /><br />To show how much we value you, here's our biggest discount — exclusively for you. This is our way of saying "we miss you!"`,
    coupon_code: 'MISSYOU25',
    coupon_discount: 'Flat 25% Off Any Experience',
    coupon_expiry: '7 days',
    cta_url: 'https://www.raynatours.com',
    cta_text: 'Come Back & Save',
  },

  'Lost High-Value (180+ days, 3000+ AED)': {
    baseTemplate: 'welcome-back',
    subject: 'Your VIP Welcome Back — Premium Offer Inside',
    email_heading: 'A Premium Welcome Back',
    email_body: `As one of our most valued guests, we've missed having you with us. We remember the incredible experiences you've enjoyed, and we'd love to create more unforgettable memories together.<br /><br />We've prepared an exclusive VIP offer just for you — our way of saying "come back to the Rayna family." This premium discount is reserved exclusively for distinguished travelers like you.`,
    coupon_code: 'VIPBACK30',
    coupon_discount: 'Flat 30% Off — VIP Exclusive',
    coupon_expiry: '14 days',
    cta_url: 'https://www.raynatours.com/vip',
    cta_text: 'Redeem VIP Offer',
  },

  'Lost Regular (180+ days, <3000 AED)': {
    baseTemplate: 'welcome-back',
    subject: 'We Miss You! Here\'s 20% Off to Come Back',
    email_heading: 'Long Time No See!',
    email_body: `It's been a while since we've seen you, and we'd love to welcome you back! Rayna Tours has grown so much — new tours, new destinations, and better prices than ever.<br /><br />Here's a special offer to get you back on your next adventure. Explore, book, and create new memories with us!`,
    coupon_code: 'REBACK20',
    coupon_discount: 'Flat 20% Off',
    coupon_expiry: '7 days',
    cta_url: 'https://www.raynatours.com',
    cta_text: 'Explore Deals',
  },

  // ═══════════════════════════════════════════════
  // STAGE 6: ADVOCACY (Segments 51-53)
  // ═══════════════════════════════════════════════

  'Happy Reviewers (4-5 Stars)': {
    baseTemplate: 'welcome-back',
    subject: 'Thank You for the Love! Share & Earn Rewards',
    email_heading: 'Thank You for Being Amazing!',
    email_body: `Your kind review made our day! We're thrilled you had such a wonderful experience with Rayna Tours.<br /><br />We'd love it if you could share the joy with friends and family. For every friend who books using your referral, you'll earn AED 50 in R-Points — plus they get 10% off their first booking!`,
    coupon_code: 'REFER50',
    coupon_discount: 'AED 50 R-Points Per Referral',
    coupon_expiry: '90 days',
    cta_url: 'https://www.raynatours.com/refer',
    cta_text: 'Share & Earn',
  },

  'Social Media Advocates': {
    baseTemplate: 'exclusive-coupon',
    subject: 'You\'re a Rayna Star! Exclusive Ambassador Perks Inside',
    email_heading: 'Welcome to the Ambassador Club!',
    email_body: `Thank you for sharing your Rayna Tours experiences on social media! Your authentic stories inspire thousands of travelers to explore Dubai and beyond.<br /><br />As a social media advocate, you now have access to exclusive ambassador perks — early access to new experiences, special discounts, and exclusive events. Here's your first Ambassador reward!`,
    coupon_code: 'AMBASSADOR20',
    coupon_discount: 'Flat 20% Ambassador Discount',
    coupon_expiry: '60 days',
    cta_url: 'https://www.raynatours.com',
    cta_text: 'Access Perks',
  },

  'NPS Promoters': {
    baseTemplate: 'welcome-back',
    subject: 'You Rated Us 9+! Here\'s Your Thank You Gift',
    email_heading: 'You\'re One of Our Biggest Fans!',
    email_body: `Thank you for rating us so highly! Your support means the world to the Rayna Tours team. Customers like you are the reason we strive to create exceptional experiences every single day.<br /><br />As a token of our gratitude, here's an exclusive gift. Share Rayna Tours with friends and you'll both enjoy rewards!`,
    coupon_code: 'NPSVIP15',
    coupon_discount: 'Flat 15% Off + AED 50 Referral Bonus',
    coupon_expiry: '60 days',
    cta_url: 'https://www.raynatours.com/refer',
    cta_text: 'Refer & Earn',
  },

  // ═══════════════════════════════════════════════
  // STAGE 7: SPECIAL (Segments 54-56)
  // ═══════════════════════════════════════════════

  'B2B & Corporate': {
    baseTemplate: 'exclusive-coupon',
    subject: 'Corporate Partnership — Exclusive Group & Event Rates',
    email_heading: 'Corporate Solutions by Rayna Tours',
    email_body: `Looking for team-building activities, corporate retreats, or group travel solutions? Rayna Tours offers customized corporate packages across Dubai, Abu Dhabi, and international destinations.<br /><br />From private desert experiences to luxury team outings — we handle everything so you can focus on what matters. Enjoy special corporate rates on all bookings.`,
    coupon_code: 'CORP15',
    coupon_discount: '15% Corporate Discount on Group Bookings',
    coupon_expiry: '90 days',
    cta_url: 'https://www.raynatours.com/corporate',
    cta_text: 'Request Corporate Quote',
  },

  'Birthday Month': {
    baseTemplate: 'welcome-back',
    subject: 'Happy Birthday! Celebrate with a Special Gift from Rayna Tours!',
    email_heading: 'Happy Birthday to You!',
    email_body: `Wishing you the happiest of birthdays from the entire Rayna Tours family! Birthdays are meant for celebrations, adventure, and creating unforgettable memories.<br /><br />As our birthday gift to you, enjoy an exclusive discount on any experience. Whether it's a dinner cruise, desert safari, or theme park — celebrate in style!`,
    coupon_code: 'BDAY25',
    coupon_discount: 'Flat 25% Birthday Discount',
    coupon_expiry: '30 days (valid during birthday month)',
    cta_url: 'https://www.raynatours.com',
    cta_text: 'Celebrate Now',
  },

  'High Cancellation Risk': {
    baseTemplate: 'wishlist-reminder',
    subject: 'Don\'t Miss Out — Your Experience is Almost Here!',
    email_heading: 'Your Experience is Around the Corner',
    email_body: `Just a friendly reminder — your upcoming experience with Rayna Tours is approaching! We've got everything ready to make it an unforgettable adventure.<br /><br />Remember, Rayna Tours offers <b style="color:#2f2f2f">free cancellation</b> and instant confirmation. But we know you'll have an amazing time. Here are some add-ons to enhance your experience!`,
    cta_url: 'https://www.raynatours.com/bookings',
    cta_text: 'View My Booking',
  },
};

export default SEGMENT_EMAIL_CONFIG;
