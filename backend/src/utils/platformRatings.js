const STAR_FILLED  = '&#9733;';
const STAR_EMPTY   = '<span style="color:#dddddd">&#9733;</span>';
const FOUR_AND_DIM = STAR_FILLED.repeat(4) + STAR_EMPTY;
const FIVE_FILLED  = STAR_FILLED.repeat(5);

export const PLATFORMS = [
  {
    key:     'rayna',
    name:    'Rayna Tours',
    logo:    'https://d2cazmkfw8kdtj.cloudfront.net/assets/Images/AGT-06437/raynatourslogo.png',
    rating:  '4.5',
    scale:   '4/5',
    reviews: '25 Million Customers',
    stars:   FOUR_AND_DIM,
    colors:  { star: '#f5a623', border: '#f0e5c0', bg: '#fffdf4' },
  },
  {
    key:     'trustpilot',
    name:    'Trustpilot',
    logo:    'https://cdn.trustpilot.net/brand-assets/4.3.0/logo-black.svg',
    rating:  '4.7',
    scale:   '4/5',
    reviews: '34,655 Reviews',
    stars:   FOUR_AND_DIM,
    colors:  { star: '#00b67a', border: '#b8e8d0', bg: '#f4fcf8' },
  },
  {
    key:     'tripadvisor',
    name:    'Tripadvisor',
    logo:    'https://static.tacdn.com/img2/brand_refresh/Tripadvisor_lockup_horizontal_secondary_registered.svg',
    rating:  '4.6',
    scale:   '4.5/5',
    reviews: '12,882 Reviews',
    stars:   FOUR_AND_DIM,
    colors:  { star: '#00aa6c', border: '#b8e8d0', bg: '#f4fcf8' },
  },
  {
    key:     'google',
    name:    'Google',
    logo:    'https://www.google.com/images/branding/googlelogo/2x/googlelogo_color_272x92dp.png',
    rating:  '4.3',
    scale:   '5/5',
    reviews: '1,693 Reviews',
    stars:   FIVE_FILLED,
    colors:  { star: '#fbbc04', border: '#f5cfc8', bg: '#fff8f6' },
  },
];

// ── per-template adapters ─────────────────────────────────────────────────
// Templates were authored with different field names. Adapters keep the
// canonical PLATFORMS as the single source of truth while preserving the
// shape each renderer expects.

export const platformsForDay1 = () => PLATFORMS.map(p => ({
  platform: p.name,
  logo:     p.logo,
  stars:    p.stars,
  rating:   p.rating,
  reviews:  p.reviews,
  styles:   { border: p.colors.border, bg: p.colors.bg, starColor: p.colors.star },
}));

export const platformsForDay2 = () => PLATFORMS.map(p => ({
  name:        p.name,
  logo:        p.logo,
  rating:      p.rating,
  stars:       p.stars,
  reviews:     p.reviews,
  borderColor: p.colors.border,
  bgColor:     p.colors.bg,
  starColor:   p.colors.star,
}));

export const platformsForDay4 = () => PLATFORMS.map(p => ({
  platform: p.name,
  logo:     p.logo,
  scale:    p.scale,
  rating:   p.rating,
  reviews:  p.reviews,
  color:    p.colors.star,
  border:   p.colors.border,
  bg:       p.colors.bg,
}));

export const platformsForDay5 = () => PLATFORMS.map(p => ({
  name:    p.name,
  logo:    p.logo,
  rating:  p.rating,
  stars:   p.stars,
  reviews: p.reviews,
  color:   p.colors.star,
  bg:      p.colors.bg,
}));

export const platformsForDay6 = () => PLATFORMS.map(p => ({
  name:        p.name,
  logo:        p.logo,
  rating:      p.rating,
  stars:       p.stars,
  reviews:     p.reviews,
  borderColor: p.colors.border,
  bgColor:     p.colors.bg,
  starColor:   p.colors.star,
}));

export const platformsForDay3 = () => Object.fromEntries(
  PLATFORMS.map(p => [p.key, {
    platform: p.name,
    score:    p.rating,
    reviews:  p.reviews,
    stars:    p.stars,
  }])
);

export const platformsForDay7 = () => PLATFORMS.map(p => ({
  name:       p.name,
  stars_html: `<span style="color:${p.colors.star};">${'&#9733;'.repeat(p.stars === '&#9733;'.repeat(5) ? 5 : 4)}</span>${p.stars === '&#9733;'.repeat(5) ? '' : '<span style="color:#ddd;">&#9733;</span>'}`,
  score:      p.rating,
  reviews:    p.reviews,
  name_color: p.colors.star,
}));
