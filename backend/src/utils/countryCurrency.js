/**
 * Country → ISO-4217 currency code, with FLEXIBLE matching: full names, ISO2/ISO3
 * codes and common variants ("UK", "USA", "KSA"…), case/space/punctuation-insensitive.
 *
 * Used by utils/marketPlan.resolveMarket to pick the DISPLAY currency for the
 * `default` market plan. Unknown / blank country → null → caller falls back to AED
 * (the base currency), so a price is NEVER mislabeled or dropped.
 */

const MAP = Object.create(null);
const reg = (code, ...names) => { for (const n of names) MAP[n] = code; };

// ── Gulf / Middle East ──
reg('AED', 'united arab emirates', 'uae', 'ae', 'are', 'emirates');
reg('SAR', 'saudi arabia', 'ksa', 'sa', 'sau', 'saudi', 'kingdom of saudi arabia');
reg('QAR', 'qatar', 'qa', 'qat');
reg('KWD', 'kuwait', 'kw', 'kwt');
reg('OMR', 'oman', 'om', 'omn');
reg('BHD', 'bahrain', 'bh', 'bhr');
reg('IRR', 'iran', 'ir', 'irn', 'islamic republic of iran');
reg('ILS', 'israel', 'il', 'isr', 'palestine', 'ps', 'pse', 'palestinian territory');
reg('JOD', 'jordan', 'jo', 'jor');
reg('LBP', 'lebanon', 'lb', 'lbn');
reg('SYP', 'syria', 'sy', 'syr', 'syrian arab republic');
reg('YER', 'yemen', 'ye', 'yem');

// ── South Asia ──
reg('INR', 'india', 'in', 'ind', 'bharat', 'republic of india');
reg('PKR', 'pakistan', 'pk', 'pak');
reg('BDT', 'bangladesh', 'bd', 'bgd');
reg('LKR', 'sri lanka', 'lk', 'lka', 'srilanka');
reg('NPR', 'nepal', 'np', 'npl');
reg('BTN', 'bhutan', 'bt', 'btn');
reg('MVR', 'maldives', 'mv', 'mdv');
reg('AFN', 'afghanistan', 'af', 'afg');

// ── Europe (euro area + EUR users) ──
reg('EUR', 'germany', 'de', 'deu', 'france', 'fr', 'fra', 'italy', 'it', 'ita',
    'spain', 'es', 'esp', 'portugal', 'pt', 'prt', 'netherlands', 'nl', 'nld', 'holland',
    'belgium', 'be', 'bel', 'austria', 'at', 'aut', 'ireland', 'ie', 'irl',
    'finland', 'fi', 'fin', 'greece', 'gr', 'grc', 'slovakia', 'sk', 'svk',
    'slovenia', 'si', 'svn', 'estonia', 'ee', 'est', 'latvia', 'lv', 'lva',
    'lithuania', 'lt', 'ltu', 'luxembourg', 'lu', 'lux', 'malta', 'mt', 'mlt',
    'cyprus', 'cy', 'cyp', 'croatia', 'hr', 'hrv', 'monaco', 'mc', 'andorra', 'ad',
    'san marino', 'sm', 'vatican', 'va', 'montenegro', 'me', 'mne', 'kosovo', 'xk');
reg('GBP', 'united kingdom', 'uk', 'gb', 'gbr', 'great britain', 'england', 'scotland',
    'wales', 'northern ireland', 'britain');
reg('CHF', 'switzerland', 'ch', 'che', 'liechtenstein', 'li', 'lie');
reg('NOK', 'norway', 'no', 'nor');
reg('SEK', 'sweden', 'se', 'swe');
reg('DKK', 'denmark', 'dk', 'dnk');
reg('ISK', 'iceland', 'is', 'isl');
reg('PLN', 'poland', 'pl', 'pol');
reg('CZK', 'czech republic', 'cz', 'cze', 'czechia');
reg('HUF', 'hungary', 'hu', 'hun');
reg('RON', 'romania', 'ro', 'rou');
reg('BGN', 'bulgaria', 'bg', 'bgr');
reg('RSD', 'serbia', 'rs', 'srb');
reg('BAM', 'bosnia and herzegovina', 'ba', 'bih', 'bosnia');
reg('ALL', 'albania', 'al', 'alb');
reg('MKD', 'north macedonia', 'mk', 'mkd', 'macedonia');
reg('UAH', 'ukraine', 'ua', 'ukr');
reg('BYN', 'belarus', 'by', 'blr');
reg('MDL', 'moldova', 'md', 'mda');
reg('RUB', 'russia', 'ru', 'rus', 'russian federation');
reg('TRY', 'turkey', 'tr', 'tur', 'turkiye', 'türkiye');
reg('GEL', 'georgia', 'ge', 'geo');
reg('AMD', 'armenia', 'am', 'arm');
reg('AZN', 'azerbaijan', 'az', 'aze');

// ── Americas ──
reg('USD', 'united states', 'us', 'usa', 'united states of america', 'america',
    'ecuador', 'ec', 'ecu', 'el salvador', 'sv', 'slv', 'panama', 'pa', 'pan',
    'puerto rico', 'pr', 'timor-leste', 'east timor', 'tl');
reg('CAD', 'canada', 'ca', 'can');
reg('MXN', 'mexico', 'mx', 'mex');
reg('BRL', 'brazil', 'br', 'bra', 'brasil');
reg('ARS', 'argentina', 'ar', 'arg');
reg('CLP', 'chile', 'cl', 'chl');
reg('COP', 'colombia', 'co', 'col');
reg('PEN', 'peru', 'pe', 'per');
reg('UYU', 'uruguay', 'uy', 'ury');
reg('PYG', 'paraguay', 'py', 'pry');
reg('BOB', 'bolivia', 'bo', 'bol');
reg('VES', 'venezuela', 've', 'ven');
reg('GTQ', 'guatemala', 'gt', 'gtm');
reg('HNL', 'honduras', 'hn', 'hnd');
reg('NIO', 'nicaragua', 'ni', 'nic');
reg('CRC', 'costa rica', 'cr', 'cri');
reg('DOP', 'dominican republic', 'do', 'dom');
reg('CUP', 'cuba', 'cu', 'cub');
reg('JMD', 'jamaica', 'jm', 'jam');
reg('TTD', 'trinidad and tobago', 'tt', 'tto', 'trinidad');
reg('BSD', 'bahamas', 'bs', 'bhs');
reg('BBD', 'barbados', 'bb', 'brb');
reg('HTG', 'haiti', 'ht', 'hti');
reg('GYD', 'guyana', 'gy', 'guy');
reg('SRD', 'suriname', 'sr', 'sur');
reg('BZD', 'belize', 'bz', 'blz');

// ── Africa ──
reg('EGP', 'egypt', 'eg', 'egy');
reg('MAD', 'morocco', 'ma', 'mar');
reg('DZD', 'algeria', 'dz', 'dza');
reg('TND', 'tunisia', 'tn', 'tun');
reg('LYD', 'libya', 'ly', 'lby');
reg('SDG', 'sudan', 'sd', 'sdn');
reg('NGN', 'nigeria', 'ng', 'nga');
reg('GHS', 'ghana', 'gh', 'gha');
reg('KES', 'kenya', 'ke', 'ken');
reg('TZS', 'tanzania', 'tz', 'tza');
reg('UGX', 'uganda', 'ug', 'uga');
reg('ETB', 'ethiopia', 'et', 'eth');
reg('ZAR', 'south africa', 'za', 'zaf', 'lesotho', 'ls', 'namibia', 'na', 'eswatini',
    'sz', 'swaziland');
reg('BWP', 'botswana', 'bw', 'bwa');
reg('ZMW', 'zambia', 'zm', 'zmb');
reg('MWK', 'malawi', 'mw', 'mwi');
reg('MZN', 'mozambique', 'mz', 'moz');
reg('AOA', 'angola', 'ao', 'ago');
reg('RWF', 'rwanda', 'rw', 'rwa');
reg('BIF', 'burundi', 'bi', 'bdi');
reg('SOS', 'somalia', 'so', 'som');
reg('DJF', 'djibouti', 'dj', 'dji');
reg('ERN', 'eritrea', 'er', 'eri');
reg('XOF', 'senegal', 'sn', 'sen', 'ivory coast', 'ci', 'civ', "cote d'ivoire",
    'cote divoire', 'mali', 'ml', 'mli', 'burkina faso', 'bf', 'bfa', 'niger', 'ne', 'ner',
    'togo', 'tg', 'tgo', 'benin', 'bj', 'ben', 'guinea-bissau', 'gw');
reg('XAF', 'cameroon', 'cm', 'cmr', 'chad', 'td', 'tcd', 'central african republic', 'cf',
    'republic of the congo', 'congo', 'cg', 'cog', 'gabon', 'ga', 'gab', 'equatorial guinea', 'gq');
reg('CDF', 'democratic republic of the congo', 'cd', 'cod', 'dr congo', 'drc');
reg('MGA', 'madagascar', 'mg', 'mdg');
reg('MUR', 'mauritius', 'mu', 'mus');
reg('SCR', 'seychelles', 'sc', 'syc');
reg('KMF', 'comoros', 'km', 'com');
reg('CVE', 'cape verde', 'cv', 'cpv', 'cabo verde');
reg('GMD', 'gambia', 'gm', 'gmb');
reg('GNF', 'guinea', 'gn', 'gin');
reg('LRD', 'liberia', 'lr', 'lbr');
reg('SLL', 'sierra leone', 'sl', 'sle');
reg('MRU', 'mauritania', 'mr', 'mrt');
reg('USD', 'zimbabwe', 'zw', 'zwe');   // ZWL effectively unusable → USD

// ── Asia-Pacific ──
reg('CNY', 'china', 'cn', 'chn', "people's republic of china", 'peoples republic of china');
reg('HKD', 'hong kong', 'hk', 'hkg');
reg('MOP', 'macau', 'mo', 'mac', 'macao');
reg('TWD', 'taiwan', 'tw', 'twn');
reg('JPY', 'japan', 'jp', 'jpn');
reg('KRW', 'south korea', 'kr', 'kor', 'korea', 'republic of korea');
reg('MNT', 'mongolia', 'mn', 'mng');
reg('SGD', 'singapore', 'sg', 'sgp');
reg('MYR', 'malaysia', 'my', 'mys');
reg('IDR', 'indonesia', 'id', 'idn');
reg('THB', 'thailand', 'th', 'tha');
reg('VND', 'vietnam', 'vn', 'vnm', 'viet nam');
reg('PHP', 'philippines', 'ph', 'phl');
reg('KHR', 'cambodia', 'kh', 'khm');
reg('LAK', 'laos', 'la', 'lao');
reg('MMK', 'myanmar', 'mm', 'mmr', 'burma');
reg('BND', 'brunei', 'bn', 'brn');
reg('KZT', 'kazakhstan', 'kz', 'kaz');
reg('UZS', 'uzbekistan', 'uz', 'uzb');
reg('TMT', 'turkmenistan', 'tm', 'tkm');
reg('TJS', 'tajikistan', 'tj', 'tjk');
reg('KGS', 'kyrgyzstan', 'kg', 'kgz');

// ── Oceania ──
reg('AUD', 'australia', 'au', 'aus', 'kiribati', 'ki', 'tuvalu', 'tv', 'nauru', 'nr');
reg('NZD', 'new zealand', 'nz', 'nzl');
reg('FJD', 'fiji', 'fj', 'fji');
reg('PGK', 'papua new guinea', 'pg', 'png');
reg('WST', 'samoa', 'ws', 'wsm');
reg('TOP', 'tonga', 'to', 'ton');
reg('VUV', 'vanuatu', 'vu', 'vut');
reg('SBD', 'solomon islands', 'sb', 'slb');

/** Normalize a country string for lookup: lowercase, trim, strip dots, collapse spaces. */
export function normalizeCountry(country) {
  return String(country || '').toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
}

/** ISO currency code for a country (name/code/variant), or null when unknown/blank. */
export function currencyForCountry(country) {
  const n = normalizeCountry(country);
  return n ? (MAP[n] || null) : null;
}

export default { currencyForCountry, normalizeCountry };
