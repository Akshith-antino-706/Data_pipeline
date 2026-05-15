export const BRAND = {
  name:        'Rayna Tours',
  legalName:   'Rayna Tours & Travels LLC',
  logoUrl:     'https://d2cazmkfw8kdtj.cloudfront.net/assets/Images/AGT-06437/raynatourslogo.png',
  copyrightYear: '2026',
};

export const CONTACT = {
  email:      'help@raynatours.com',
  phone:      '+971 4 208 7112',
  phoneLink:  'tel:+97142087112',
  address:    'Abu Dhabi & Dubai, UAE',
  fullAddress:'Rayna Tours and Travels | Dubai, UAE',
};

export const LINKS = {
  home:        'https://www.raynatours.com',
  unsubscribe: 'https://www.raynatours.com/unsubscribe',
  preferences: 'https://www.raynatours.com/email-preferences',
  privacy:     'https://www.raynatours.com/privacy-policy',
  terms:       'https://www.raynatours.com/terms-of-service',
  help:        'https://www.raynatours.com/help',
  blog:        'https://www.raynatours.com/blog',
};

export const STATS = [
  { value: '25M+',   label: 'Guests served and counting'   },
  { value: '1,500+', label: 'Professionals across regions' },
  { value: '1,000+', label: 'Experiences to choose from'   },
  { value: '25+',    label: 'Operating companies'          },
];

export const FOOTER_COPY = {
  ratingsEyebrow:     "Don't just take our word for it",
  ratingsTitle:       'Verified by the Platforms You Already Trust',
  ratingsDescription: 'Our ratings are earned — not curated. Check us on any major review platform and see what real travellers say.',
  optInLine:          'You are receiving this email because you subscribed to our newsletter.',
  copyrightLine:      () => `© ${BRAND.copyrightYear} ${BRAND.legalName}. All rights reserved.`,
};
