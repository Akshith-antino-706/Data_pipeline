/**
 * Segment-specific product recommendations with real Rayna Tours URLs
 * Scraped from raynatours.com — diverse products per segment type
 */

const BASE = 'https://www.raynatours.com';
const IMG = 'https://d31sl6cu4pqx6g.cloudfront.net';

const p = (url, img, cat, name, rating, reviews, price, strike) => ({
  product_url: `${BASE}${url}`, product_image: `${IMG}${img}`, product_category: cat,
  product_name: name, product_rating: rating, product_reviews: reviews,
  product_price: price, product_strike_price: strike,
});

// ── Product Pool ────────────────────────────────────────
const P = {
  desertSafari:   p('/dubai/desert-safari-tours/evening-desert-safari-e-508805', '/City-Images/13668/dubai-city.png', 'Desert Safari', 'Evening Desert Safari', '4.8', '3,464', '149', '199'),
  burjKhalifa:    p('/dubai/burj-khalifa-tickets/burj-khalifa-at-the-top-tickets-e-18', '/City-Images/13236/abu-dhabi.jpg', 'City Tour', 'Burj Khalifa At The Top', '4.9', '2,459', '169', '199'),
  hotAirBalloon:  p('/dubai/hot-air-balloon/hot-air-balloon-dubai-e-19390', '/City-Images/13668/dubai-city.png', 'Adventure', 'Hot Air Balloon Dubai', '4.9', '1,892', '899', '1,099'),
  cityTour:       p('/dubai/city-tours/dubai-city-tour-e-33', '/City-Images/14644/ras-al-khaimah-city.png', 'City Tour', 'Dubai City Tour', '4.8', '1,205', '79', '129'),
  aquaventure:    p('/dubai/water-parks/atlantis-aquaventure-waterpark-e-3625', '/City-Images/13668/dubai-city.png', 'Water Park', 'Atlantis Aquaventure Waterpark', '4.9', '1,270', '299', '350'),
  aquarium:       p('/dubai/theme-parks/dubai-aquarium-and-underwater-zoo-e-3636', '/City-Images/13236/abu-dhabi.jpg', 'Theme Park', 'Dubai Aquarium & Underwater Zoo', '4.7', '1,840', '159', '199'),
  burjSky:        p('/dubai/burj-khalifa-tickets/burj-khalifa-sky-tickets-e-2057', '/City-Images/13668/dubai-city.png', 'Luxury', 'Burj Khalifa Sky Lounge', '4.9', '980', '399', '499'),
  imgWorlds:      p('/dubai/theme-parks/img-worlds-of-adventure-e-4753', '/City-Images/14644/ras-al-khaimah-city.png', 'Theme Park', 'IMG Worlds of Adventure', '4.8', '1,520', '279', '329'),
  museum:         p('/dubai/culture-and-attractions/museum-of-the-future-e-5116', '/City-Images/13668/dubai-city.png', 'Culture', 'Museum of the Future', '4.9', '2,100', '149', '179'),
  dubaiParks:     p('/dubai/theme-parks/dubai-parks-and-resorts-e-4837', '/City-Images/13236/abu-dhabi.jpg', 'Theme Park', 'Dubai Parks and Resorts', '4.7', '1,360', '249', '299'),
  skiDubai:       p('/dubai/theme-parks/ski-dubai-tickets-e-172', '/City-Images/13668/dubai-city.png', 'Indoor Snow', 'Ski Dubai', '4.8', '1,690', '189', '229'),
  legoland:       p('/dubai/theme-parks/legoland-dubai-e-4996', '/City-Images/14644/ras-al-khaimah-city.png', 'Family', 'Legoland Dubai', '4.7', '1,140', '249', '299'),
  motiongate:     p('/dubai/theme-parks/motiongate-dubai-e-4998', '/City-Images/13668/dubai-city.png', 'Theme Park', 'Motiongate Dubai', '4.7', '1,080', '249', '299'),
  dolphinarium:   p('/dubai/theme-parks/dubai-dolphinarium-e-65', '/City-Images/13236/abu-dhabi.jpg', 'Family', 'Dubai Dolphinarium', '4.6', '890', '49', '79'),
  dubaiFrame:     p('/dubai/culture-and-attractions/dubai-frame-e-5066', '/City-Images/13668/dubai-city.png', 'Culture', 'Dubai Frame', '4.8', '1,450', '49', '59'),
  safariPark:     p('/dubai/culture-and-attractions/dubai-safari-park-e-5109', '/City-Images/14644/ras-al-khaimah-city.png', 'Wildlife', 'Dubai Safari Park', '4.6', '760', '49', '69'),
  kidzania:       p('/dubai/theme-parks/dubai-mall-kidzania-e-3637', '/City-Images/13236/abu-dhabi.jpg', 'Kids', 'Dubai Mall KidZania', '4.7', '920', '69', '89'),
  skyViews:       p('/dubai/burj-khalifa-tickets/sky-views-dubai-e-508481', '/City-Images/13668/dubai-city.png', 'Attractions', 'Sky Views Dubai', '4.8', '1,330', '109', '139'),
  ayaUniverse:    p('/dubai/theme-parks/aya-universe-dubai-e-508739', '/City-Images/13236/abu-dhabi.jpg', 'Attractions', 'AYA Universe Dubai', '4.8', '1,033', '99', '129'),
  dhowCruise:     p('/dubai/dhow-cruise/dhow-cruise-dinner-marina-e-87', '/City-Images/13668/dubai-city.png', 'Dinner Cruise', 'Dhow Cruise Dinner Marina', '4.8', '2,340', '149', '189'),
  miracleGarden:  p('/dubai/culture-and-attractions/miracle-garden-dubai-e-4832', '/City-Images/14644/ras-al-khaimah-city.png', 'Attractions', 'Miracle Garden Dubai', '4.7', '1,794', '89', '120'),
  abuDhabiSafari: p('/abu-dhabi/desert-safari-tours/desert-safari-abu-dhabi-e-174', '/City-Images/13236/abu-dhabi.jpg', 'Desert Safari', 'Desert Safari Abu Dhabi', '4.8', '1,650', '199', '249'),
  abuDhabiCity:   p('/abu-dhabi/city-tours/full-day-abu-dhabi-city-tour-e-4826', '/City-Images/13236/abu-dhabi.jpg', 'City Tour', 'Abu Dhabi City Tour', '4.8', '1,440', '249', '299'),
  ferrariWorld:   p('/abu-dhabi/theme-parks/ferrari-theme-park-abu-dhabi-e-4827', '/City-Images/13236/abu-dhabi.jpg', 'Theme Park', 'Ferrari World Abu Dhabi', '4.9', '1,890', '299', '349'),
  seaWorld:       p('/abu-dhabi/theme-parks/seaworld-abu-dhabi-e-508806', '/City-Images/13236/abu-dhabi.jpg', 'Theme Park', 'SeaWorld Abu Dhabi', '4.8', '1,560', '349', '399'),
  houseOfHype:    p('/dubai/theme-parks/house-of-hype-e-509318', '/City-Images/13668/dubai-city.png', 'Entertainment', 'House of Hype', '4.7', '620', '109', '129'),
  // Packages
  superSaver:     p('/dubai-packages/super-saver-dubai-holiday-541', '/City-Images/13668/dubai-city.png', 'Holiday Package', 'Super Saver Dubai Holiday (4N/5D)', '4.8', '1,360', '999', '1,299'),
  stopover:       p('/dubai-packages/dubai-stopover-delight-545', '/City-Images/13236/abu-dhabi.jpg', 'Stopover Package', 'Dubai Stopover Delight (1N/2D)', '4.7', '780', '599', '799'),
  groupDeparture: p('/dubai-packages/dubai-group-departures-with-indian-meals-614', '/City-Images/13668/dubai-city.png', 'Group Package', 'Dubai Group Departures w/ Indian Meals', '4.7', '1,179', '1,499', '1,899'),
  kidsHoliday:    p('/dubai-packages/dubai-little-explorers-kids-holiday-package-552', '/City-Images/14644/ras-al-khaimah-city.png', 'Family Package', 'Little Explorers Kids Holiday (5N/6D)', '4.8', '890', '1,899', '2,399'),
  // Cruises
  aroyaCruise:    p('/dubai-cruises/aroya-gulf-to-red-sea-passage-cruise-488', '/City-Images/13236/abu-dhabi.jpg', 'Luxury Cruise', 'Aroya Gulf to Red Sea Cruise (5N/6D)', '4.9', '1,735', '2,499', '2,999'),
  // Visa
  dubaiVisa:      p('/visas/dubai-visa', '/City-Images/13668/dubai-city.png', 'Visa', 'Dubai Visa — Fast Processing', '4.9', '6,472', '299', '399'),
  schengenVisa:   p('/visas/schengen-visa', '/City-Images/13236/abu-dhabi.jpg', 'Visa', 'Schengen Visa', '4.7', '1,008', '499', '599'),
};

// ── Segment → Products Mapping ──────────────────────────
const SEGMENT_PRODUCTS = {
  // AWARENESS
  'Social Ad Leads':                     [P.desertSafari, P.museum, P.dhowCruise],
  'Website Browsers':                    [P.burjKhalifa, P.aquaventure, P.miracleGarden],
  'WhatsApp First-Touch':                [P.desertSafari, P.cityTour, P.dubaiFrame],

  // CONSIDERATION
  'Fresh Cart Abandoners (0-3 days)':    [P.desertSafari, P.burjKhalifa, P.dhowCruise],
  'Stale Cart Abandoners (4-14 days)':   [P.aquaventure, P.imgWorlds, P.skyViews],
  'Active Enquirers':                    [P.cityTour, P.desertSafari, P.museum],
  'Hesitant Browsers':                   [P.dubaiFrame, P.dolphinarium, P.miracleGarden],
  'Payment Failed':                      [P.desertSafari, P.burjKhalifa, P.aquaventure],

  // CONVERSION
  'Registered Not Booked':               [P.desertSafari, P.cityTour, P.dubaiFrame],
  'New Customers (0-30 days)':           [P.dhowCruise, P.abuDhabiCity, P.skiDubai],
  'Post-Trip Review Window':             [P.miracleGarden, P.ayaUniverse, P.houseOfHype],
  'One-Time Buyers (31-90 days)':        [P.aquaventure, P.ferrariWorld, P.hotAirBalloon],

  // GROWTH
  'Repeat Buyers':                       [P.museum, P.seaWorld, P.abuDhabiSafari],
  'Frequent Travelers (4+ bookings)':    [P.aroyaCruise, P.hotAirBalloon, P.burjSky],
  'High Spenders (5000+ AED)':           [P.aroyaCruise, P.burjSky, P.superSaver],
  'Visa-Only → Tour Cross-Sell':         [P.desertSafari, P.cityTour, P.stopover],
  'Tour-Only → Visa Cross-Sell':         [P.dubaiVisa, P.schengenVisa],

  // WIN-BACK
  'Cooling Down (31-60 days)':           [P.miracleGarden, P.ayaUniverse, P.houseOfHype],
  'At Risk (61-120 days)':               [P.superSaver, P.desertSafari, P.aquaventure],
  'Hibernating (121-180 days)':          [P.dubaiFrame, P.dolphinarium, P.safariPark],
  'Lost High-Value (180+ days, 3000+ AED)': [P.aroyaCruise, P.hotAirBalloon, P.superSaver],
  'Lost Regular (180+ days, <3000 AED)': [P.dubaiFrame, P.cityTour, P.dolphinarium],

  // ADVOCACY
  'Happy Reviewers (4-5 Stars)':         [P.hotAirBalloon, P.dhowCruise, P.ferrariWorld],
  'Social Media Advocates':              [P.museum, P.skyViews, P.ayaUniverse],
  'NPS Promoters':                       [P.burjKhalifa, P.desertSafari, P.aquaventure],

  // SPECIAL
  'B2B & Corporate':                     [P.superSaver, P.groupDeparture, P.abuDhabiCity],
  'B2B Travel Agents':                   [P.superSaver, P.groupDeparture, P.stopover],
  'Birthday Month':                      [P.aquaventure, P.legoland, P.kidzania],
  'High Cancellation Risk':              [P.desertSafari, P.dubaiFrame, P.cityTour],

  // SEASONAL
  'Diwali Travelers (Indian)':           [P.groupDeparture, P.desertSafari, P.kidsHoliday],
  'Christmas Travelers (European)':      [P.dhowCruise, P.skiDubai, P.miracleGarden],
  'Eid Travelers (GCC/Arab)':            [P.kidsHoliday, P.aquaventure, P.ferrariWorld],
  'Chinese New Year Travelers':          [P.superSaver, P.desertSafari, P.dubaiParks],
  'Anniversary Customers':               [P.dhowCruise, P.hotAirBalloon, P.burjSky],
  'Summer Vacation Planners':            [P.aquaventure, P.skiDubai, P.seaWorld],
};

const DEFAULT_PRODUCTS = [P.desertSafari, P.burjKhalifa, P.cityTour];

export function getSegmentProducts(segmentName) {
  return SEGMENT_PRODUCTS[segmentName] || DEFAULT_PRODUCTS;
}

export default SEGMENT_PRODUCTS;
