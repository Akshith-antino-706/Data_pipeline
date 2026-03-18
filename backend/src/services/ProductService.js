const BASE_URL = 'https://earnest-panda-e8edbd.netlify.app/api/all-products';

// In-memory cache (refreshes every 30 min)
let cache = { data: null, ts: 0 };
const CACHE_TTL = 30 * 60 * 1000;

const CITIES = [
  { cityId: 13236, cityName: 'Abu Dhabi', countryName: 'United Arab Emirates' },
];

export default class ProductService {

  /** Fetch all products from external API (with cache) */
  static async getAll(filters = {}) {
    if (cache.data && Date.now() - cache.ts < CACHE_TTL) {
      return this._filter(cache.data, filters);
    }

    const allProducts = [];
    for (const city of CITIES) {
      try {
        const url = `${BASE_URL}?productType=tour&cityId=${city.cityId}&cityName=${encodeURIComponent(city.cityName)}&countryName=${encodeURIComponent(city.countryName)}`;
        const res = await fetch(url, {
          headers: { 'Accept': 'application/json', 'User-Agent': 'RaynaDataPipeline/1.0' }
        });
        const json = await res.json();
        if (json.success && json.products) {
          allProducts.push(...json.products);
        }
      } catch (err) {
        console.error(`Failed to fetch products for ${city.cityName}:`, err.message);
      }
    }

    cache = { data: allProducts, ts: Date.now() };
    return this._filter(allProducts, filters);
  }

  static _filter(products, { category, minPrice, maxPrice, search } = {}) {
    let result = [...products];
    if (category) result = result.filter(p => p.item_group_id === category);
    if (minPrice) result = result.filter(p => p.salePrice >= Number(minPrice));
    if (maxPrice) result = result.filter(p => p.salePrice <= Number(maxPrice));
    if (search) {
      const s = search.toLowerCase();
      result = result.filter(p => p.name.toLowerCase().includes(s));
    }
    return result;
  }

  /** Get product categories with counts */
  static async getCategories() {
    const products = await this.getAll();
    const cats = {};
    for (const p of products) {
      if (!cats[p.item_group_id]) cats[p.item_group_id] = { category: p.item_group_id, count: 0, minPrice: Infinity, maxPrice: 0 };
      cats[p.item_group_id].count++;
      if (p.salePrice < cats[p.item_group_id].minPrice) cats[p.item_group_id].minPrice = p.salePrice;
      if (p.salePrice > cats[p.item_group_id].maxPrice) cats[p.item_group_id].maxPrice = p.salePrice;
    }
    return Object.values(cats).sort((a, b) => b.count - a.count);
  }

  /** Get a single product by ID */
  static async getById(productId) {
    const products = await this.getAll();
    return products.find(p => p.productId === Number(productId)) || null;
  }

  /** Get top products for a segment (used by content generation) */
  static async getForSegment(segmentLabel, limit = 3) {
    const products = await this.getAll();

    // Map segment types to preferred categories
    const segmentCategories = {
      'adventure': ['desert-safari-tours', 'adventure-tours', 'water-activities'],
      'luxury': ['adventure-tours', 'sightseeing-cruises', 'dhow-cruise'],
      'family': ['theme-parks', 'water-parks', 'wildlife-zoo-and-aquarium'],
      'culture': ['culture-and-attractions', 'city-tours'],
      'budget': ['water-activities', 'culture-and-attractions'],
      'default': ['desert-safari-tours', 'theme-parks', 'city-tours', 'dhow-cruise'],
    };

    const label = (segmentLabel || '').toLowerCase();
    let preferredCats = segmentCategories.default;
    if (label.includes('vip') || label.includes('high') || label.includes('premium') || label.includes('spender')) preferredCats = segmentCategories.luxury;
    else if (label.includes('birthday') || label.includes('family')) preferredCats = segmentCategories.family;
    else if (label.includes('corporate') || label.includes('b2b')) preferredCats = segmentCategories.culture;
    else if (label.includes('budget') || label.includes('regular') || label.includes('lost regular')) preferredCats = segmentCategories.budget;

    // Score products: preferred category products first, then by discount, then by popularity
    const scored = products.map(p => ({
      ...p,
      score: (preferredCats.includes(p.item_group_id) ? 100 : 0) +
             (p.normalPrice > p.salePrice ? 50 : 0) +
             Math.random() * 20 // slight randomization
    }));

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  /** Generate HTML email body with product cards and images */
  static generateProductEmailHTML({ products, heading, subheading, ctaText, ctaUrl, couponCode, segmentLabel }) {
    const productCards = products.map(p => {
      const hasDiscount = p.normalPrice > p.salePrice;
      const discount = hasDiscount ? Math.round((1 - p.salePrice / p.normalPrice) * 100) : 0;
      return `
        <tr><td style="padding:8px 0;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
            <tr>
              <td width="140" style="vertical-align:top;">
                <img src="${p.image}" alt="${p.name}" width="140" height="100" style="display:block;object-fit:cover;border-radius:12px 0 0 12px;" />
              </td>
              <td style="padding:12px 16px;vertical-align:top;">
                <div style="font-size:15px;font-weight:700;color:#1e293b;">${p.name}</div>
                <div style="font-size:12px;color:#64748b;margin:4px 0;">${p.city || 'Abu Dhabi'} · ${(p.item_group_id || '').replace(/-/g, ' ')}</div>
                <div style="margin-top:6px;">
                  ${hasDiscount ? `<span style="text-decoration:line-through;color:#94a3b8;font-size:13px;">AED ${p.normalPrice}</span> ` : ''}
                  <span style="font-size:16px;font-weight:700;color:#f97316;">AED ${p.salePrice}</span>
                  ${hasDiscount ? ` <span style="background:#fef3c7;color:#d97706;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:600;">${discount}% OFF</span>` : ''}
                </div>
                <a href="${p.url}" style="display:inline-block;margin-top:8px;padding:6px 16px;background:#f97316;color:#fff;text-decoration:none;border-radius:6px;font-size:12px;font-weight:600;">Book Now</a>
              </td>
            </tr>
          </table>
        </td></tr>`;
    }).join('');

    const couponSection = couponCode ? `
      <tr><td style="padding:16px 0 8px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#fef3c7;border:2px dashed #f59e0b;border-radius:12px;text-align:center;padding:16px;">
          <tr><td style="padding:16px;">
            <div style="font-size:12px;color:#92400e;font-weight:600;text-transform:uppercase;">Exclusive Offer</div>
            <div style="font-size:28px;font-weight:800;color:#d97706;letter-spacing:3px;margin:8px 0;">${couponCode}</div>
            <div style="font-size:13px;color:#92400e;">Apply at checkout for your special discount</div>
          </td></tr>
        </table>
      </td></tr>` : '';

    return `
<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:20px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 6px rgba(0,0,0,0.05);">
  <!-- Header with Rayna branding -->
  <tr><td style="background:linear-gradient(135deg,#f97316,#ea580c);padding:32px 40px;text-align:center;">
    <img src="https://www.raynatours.com/images/rayna-tours-logo-dark.svg" alt="Rayna Tours" width="160" style="display:inline-block;" />
    <div style="color:#fff;font-size:24px;font-weight:800;margin-top:16px;line-height:1.3;">${heading}</div>
    ${subheading ? `<div style="color:#fed7aa;font-size:14px;margin-top:8px;">${subheading}</div>` : ''}
  </td></tr>

  <!-- Products -->
  <tr><td style="padding:24px 32px;">
    <table width="100%" cellpadding="0" cellspacing="0">
      ${productCards}
      ${couponSection}
    </table>
  </td></tr>

  <!-- CTA -->
  <tr><td style="padding:0 32px 32px;text-align:center;">
    <a href="${ctaUrl}" style="display:inline-block;padding:14px 40px;background:#f97316;color:#fff;text-decoration:none;border-radius:8px;font-size:16px;font-weight:700;">${ctaText}</a>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#1e293b;padding:24px 32px;text-align:center;">
    <div style="color:#94a3b8;font-size:12px;line-height:1.6;">
      Rayna Tours LLC · Dubai, UAE<br/>
      <a href="https://www.raynatours.com" style="color:#f97316;text-decoration:none;">raynatours.com</a> ·
      <a href="mailto:akshith@rayna.com" style="color:#f97316;text-decoration:none;">akshith@rayna.com</a><br/>
      <span style="color:#64748b;font-size:11px;">You received this email because you're a Rayna Tours customer.</span>
    </div>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;
  }

  /** Generate a WhatsApp message with product recommendations */
  static generateProductWAMessage({ products, intro, couponCode }) {
    const productLines = products.map((p, i) => {
      const hasDiscount = p.normalPrice > p.salePrice;
      const discount = hasDiscount ? ` (${Math.round((1 - p.salePrice / p.normalPrice) * 100)}% OFF!)` : '';
      return `${i + 1}. *${p.name}*\n   AED ${p.salePrice}${discount}\n   ${p.url}`;
    }).join('\n\n');

    const couponLine = couponCode ? `\n\n🎫 Use code *${couponCode}* for extra discount!` : '';

    return `${intro}\n\n${productLines}${couponLine}\n\n👉 Reply with a number to learn more!`;
  }
}
