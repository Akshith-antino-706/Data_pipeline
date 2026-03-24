/**
 * Segment-specific product recommendations with real Rayna Tours URLs
 * Used in campaign + journey emails for personalized product cards
 */

const BASE = 'https://www.raynatours.com';
const CDN = 'https://d31sl6cu4pqx6g.cloudfront.net';

const SEGMENT_PRODUCTS = {
  'Active Enquirers': [
    { product_url: `${BASE}/dubai/desert-safari-tours/evening-desert-safari-e-508805`, product_image: `${CDN}/City-Images/13668/dubai-city.png`, product_category: 'Desert Safari', product_name: 'Evening Desert Safari', product_rating: '4.8', product_reviews: '3,464', product_price: '149', product_strike_price: '199' },
    { product_url: `${BASE}/dubai/burj-khalifa-tickets/burj-khalifa-at-the-top-tickets-e-18`, product_image: `${CDN}/City-Images/13236/abu-dhabi.jpg`, product_category: 'City Tour', product_name: 'Burj Khalifa At The Top Tickets', product_rating: '4.9', product_reviews: '2,459', product_price: '169', product_strike_price: '199' },
  ],
  'At Risk (61-120 days)': [
    { product_url: `${BASE}/dubai/desert-safari-tours/evening-desert-safari-e-508805`, product_image: `${CDN}/City-Images/13668/dubai-city.png`, product_category: 'Desert Safari', product_name: 'Evening Desert Safari', product_rating: '4.8', product_reviews: '3,464', product_price: '149', product_strike_price: '199' },
    { product_url: `${BASE}/dubai/culture-and-attractions/miracle-garden-dubai-e-4832`, product_image: `${CDN}/City-Images/14644/ras-al-khaimah-city.png`, product_category: 'Attractions', product_name: 'Miracle Garden Dubai', product_rating: '4.7', product_reviews: '1,794', product_price: '89', product_strike_price: '120' },
  ],
  'B2B & Corporate': [
    { product_url: `${BASE}/dubai-packages/super-saver-dubai-holiday-541`, product_image: `${CDN}/City-Images/13668/dubai-city.png`, product_category: 'Package', product_name: 'Super Saver Dubai Holiday', product_rating: '4.8', product_reviews: '1,360', product_price: '999', product_strike_price: '1,299' },
    { product_url: `${BASE}/dubai-packages/dubai-group-departures-with-indian-meals-614`, product_image: `${CDN}/City-Images/13236/abu-dhabi.jpg`, product_category: 'Group Package', product_name: 'Dubai Group Departures with Indian Meals', product_rating: '4.7', product_reviews: '1,179', product_price: '1,499', product_strike_price: '1,899' },
  ],
  'Birthday Month': [
    { product_url: `${BASE}/dubai/water-parks/atlantis-aquaventure-waterpark-e-3625`, product_image: `${CDN}/City-Images/13668/dubai-city.png`, product_category: 'Water Park', product_name: 'Atlantis Aquaventure Waterpark', product_rating: '4.9', product_reviews: '1,270', product_price: '299', product_strike_price: '350' },
    { product_url: `${BASE}/dubai/theme-parks/aya-universe-dubai-e-508739`, product_image: `${CDN}/City-Images/13236/abu-dhabi.jpg`, product_category: 'Attractions', product_name: 'AYA Universe Dubai', product_rating: '4.8', product_reviews: '1,033', product_price: '129', product_strike_price: '149' },
  ],
  'Cooling Down (31-60 days)': [
    { product_url: `${BASE}/dubai/culture-and-attractions/miracle-garden-dubai-e-4832`, product_image: `${CDN}/City-Images/14644/ras-al-khaimah-city.png`, product_category: 'Attractions', product_name: 'Miracle Garden Dubai', product_rating: '4.7', product_reviews: '1,794', product_price: '89', product_strike_price: '120' },
    { product_url: `${BASE}/dubai/city-tours/dubai-city-tour-e-33`, product_image: `${CDN}/City-Images/13668/dubai-city.png`, product_category: 'City Tour', product_name: 'Dubai City Tour', product_rating: '4.8', product_reviews: '1,205', product_price: '129', product_strike_price: '169' },
  ],
  'Frequent Travelers (4+ bookings)': [
    { product_url: `${BASE}/dubai-cruises/aroya-arabian-gulf-cruise-423`, product_image: `${CDN}/City-Images/13236/abu-dhabi.jpg`, product_category: 'Cruise', product_name: 'Aroya Arabian Gulf Cruise', product_rating: '4.9', product_reviews: '1,735', product_price: '2,499', product_strike_price: '2,999' },
    { product_url: `${BASE}/dubai-cruises/eid-special-departure-aboard-msc-euribia-404`, product_image: `${CDN}/City-Images/13668/dubai-city.png`, product_category: 'Cruise', product_name: 'MSC Euribia Eid Special', product_rating: '4.8', product_reviews: '1,996', product_price: '1,999', product_strike_price: '2,499' },
  ],
  'Fresh Cart Abandoners (0-3 days)': [
    { product_url: `${BASE}/dubai/desert-safari-tours/evening-desert-safari-e-508805`, product_image: `${CDN}/City-Images/13668/dubai-city.png`, product_category: 'Desert Safari', product_name: 'Evening Desert Safari', product_rating: '4.8', product_reviews: '3,464', product_price: '149', product_strike_price: '199' },
    { product_url: `${BASE}/dubai/burj-khalifa-tickets/burj-khalifa-at-the-top-tickets-e-18`, product_image: `${CDN}/City-Images/13236/abu-dhabi.jpg`, product_category: 'City Tour', product_name: 'Burj Khalifa At The Top', product_rating: '4.9', product_reviews: '2,459', product_price: '169', product_strike_price: '199' },
  ],
  'Visa-Only → Tour Cross-Sell': [
    { product_url: `${BASE}/dubai/desert-safari-tours/evening-desert-safari-e-508805`, product_image: `${CDN}/City-Images/13668/dubai-city.png`, product_category: 'Desert Safari', product_name: 'Evening Desert Safari', product_rating: '4.8', product_reviews: '3,464', product_price: '149', product_strike_price: '199' },
    { product_url: `${BASE}/dubai-packages/dubai-stopover-delight-545`, product_image: `${CDN}/City-Images/13236/abu-dhabi.jpg`, product_category: 'Package', product_name: 'Dubai Stopover Delight', product_rating: '4.7', product_reviews: '1,217', product_price: '599', product_strike_price: '799' },
  ],
  'Tour-Only → Visa Cross-Sell': [
    { product_url: `${BASE}/visas/dubai-visa`, product_image: `${CDN}/City-Images/13668/dubai-city.png`, product_category: 'Visa', product_name: 'Dubai Visa — Fast Processing', product_rating: '4.9', product_reviews: '6,472', product_price: '299', product_strike_price: '399' },
    { product_url: `${BASE}/visas/schengen-visa`, product_image: `${CDN}/City-Images/13236/abu-dhabi.jpg`, product_category: 'Visa', product_name: 'Schengen Visa', product_rating: '4.7', product_reviews: '1,008', product_price: '499', product_strike_price: '599' },
  ],
  'High Spenders (5000+ AED)': [
    { product_url: `${BASE}/dubai-cruises/aroya-arabian-gulf-cruise-423`, product_image: `${CDN}/City-Images/13236/abu-dhabi.jpg`, product_category: 'Luxury Cruise', product_name: 'Aroya Arabian Gulf Cruise', product_rating: '4.9', product_reviews: '1,735', product_price: '2,499', product_strike_price: '2,999' },
    { product_url: `${BASE}/dubai-packages/super-saver-dubai-holiday-541`, product_image: `${CDN}/City-Images/13668/dubai-city.png`, product_category: 'Premium Package', product_name: 'Super Saver Dubai Holiday', product_rating: '4.8', product_reviews: '1,360', product_price: '999', product_strike_price: '1,299' },
  ],
};

// Default products for segments without specific mapping
const DEFAULT_PRODUCTS = [
  { product_url: `${BASE}/dubai/desert-safari-tours/evening-desert-safari-e-508805`, product_image: `${CDN}/City-Images/13668/dubai-city.png`, product_category: 'Desert Safari', product_name: 'Evening Desert Safari', product_rating: '4.8', product_reviews: '3,464', product_price: '149', product_strike_price: '199' },
  { product_url: `${BASE}/dubai/burj-khalifa-tickets/burj-khalifa-at-the-top-tickets-e-18`, product_image: `${CDN}/City-Images/13236/abu-dhabi.jpg`, product_category: 'City Tour', product_name: 'Burj Khalifa At The Top Tickets', product_rating: '4.9', product_reviews: '2,459', product_price: '169', product_strike_price: '199' },
];

export function getSegmentProducts(segmentName) {
  return SEGMENT_PRODUCTS[segmentName] || DEFAULT_PRODUCTS;
}

export default SEGMENT_PRODUCTS;
