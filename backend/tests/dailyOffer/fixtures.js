// Small synthetic feed in the real feed's shape (field names match the enriched-feed JSON).
let seq = 0;

export function raw(over = {}) {
  seq += 1;
  const type = over.type || 'activities';
  const sale = over.sale ?? 100;
  const price = over.price ?? sale;
  return {
    productId: over.productId ?? seq,
    type,
    name: over.name || `${type} product ${seq}`,
    url: over.url || `https://www.raynatours.com/${type}/product-${seq}`,
    image: over.image ?? `https://img.example.com/${seq}.jpg`,
    country: over.country || 'United Arab Emirates',
    city: over.city || 'Dubai',
    category: over.category || 'Tours',
    price_availabilityStatus: over.status || 'available',
    feed_rank: over.rank ?? seq,
    country_display_order: over.countryOrder ?? 1,
    city_display_order: over.cityOrder ?? 1,
    rank_in_city: 1,
    amenity_nights: over.nights || '',
    listing_amenities: '',
    market_prices: over.market_prices || {
      default: { price, sale_price: sale, currency: 'AED' },
      IN: { price, sale_price: over.saleIN ?? sale, currency: 'AED' },
      SA: { price, sale_price: over.saleSA ?? sale, currency: 'AED' },
      AE: { price, sale_price: over.saleAE ?? sale, currency: 'AED' },
    },
  };
}

/** A feed body valid "today" for `now`. */
export function feedBody(products, now = new Date()) {
  return { generatedAt: now.toISOString(), marketPricesAt: now.toISOString(), products };
}

/** A realistic mix: 30 visas (incl. the fixed 3), 8 holiday countries, 35 activity countries, 25 cruises. */
export function sampleProducts() {
  seq = 0;                       // stable ids across "downloads", like the real feed
  const out = [];
  out.push(raw({ type: 'visa', name: 'Dubai Visa', url: 'https://www.raynatours.com/visas/dubai-visa', countryOrder: null, rank: 1833, sale: 270 }));
  out.push(raw({ type: 'visa', name: 'US Visa', url: 'https://www.raynatours.com/visas/usa-visa', countryOrder: null, rank: 1834, sale: 1000 }));
  out.push(raw({ type: 'visa', name: 'Schengen Visa', url: 'https://www.raynatours.com/visas/schengen-visa', countryOrder: 2, rank: 1755, sale: 150 }));
  for (let i = 1; i <= 30; i++) {
    out.push(raw({ type: 'visa', name: `Visa ${i}`, url: `https://www.raynatours.com/visas/v-${i}`, countryOrder: i < 2 ? i : i + 1, rank: 1700 + i, sale: 50 + i }));
  }
  for (let c = 1; c <= 8; c++) {
    for (let k = 1; k <= 8; k++) {
      out.push(raw({ type: 'holiday', country: `HolCountry${c}`, city: `HolCity${c}-${(k % 4) + 1}`, cityOrder: (k % 4) + 1, countryOrder: c, rank: 1000 + c * 10 + k, sale: 1000 + k, nights: '4N / 5D' }));
    }
  }
  for (let c = 1; c <= 35; c++) {
    for (let k = 1; k <= 4; k++) {
      out.push(raw({ type: 'activities', country: `ActCountry${c}`, city: `ActCity${c}`, countryOrder: c, rank: c * 10 + k, sale: 20 + k, price: 40 + k }));
    }
    out.push(raw({ type: 'activities', country: `ActCountry${c}`, city: `ActCity${c}`, countryOrder: c, rank: c * 10, category: 'Transfers', name: `Airport transfer ${c}`, url: `https://www.raynatours.com/x/transfers/airport-${c}` }));
  }
  for (let i = 1; i <= 25; i++) out.push(raw({ type: 'cruise', country: 'Spain', city: 'Barcelona', rank: 1500 + i, sale: 3000 + i }));
  return out;
}

/** Pad to a realistic feed size so validateFeed's row minimum is met. */
export function fullFeed(now = new Date()) {
  const products = sampleProducts();
  while (products.length < 1600) products.push(raw({ type: 'yacht', rank: 5000 + products.length }));
  return feedBody(products, now);
}
