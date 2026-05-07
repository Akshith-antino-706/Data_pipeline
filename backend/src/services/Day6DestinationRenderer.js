/**
 * Day6DestinationRenderer
 *
 * Pure renderer for the destination-spotlight email (Singapore / Bangkok /
 * Phuket / etc.). Uses simple `{{KEY}}` substitution and 6 helper-generated
 * HTML blocks: HERO_BUTTONS, STATS_BLOCK, HOLIDAY_PACKAGES_BLOCK,
 * TOP_THINGS_BLOCK, CRUISES_BLOCK, RATINGS_BLOCK.
 *
 * Faithful port of the team's destination generator.js.
 */

import { readFileSync } from 'node:fs';

// ── card builders ─────────────────────────────────────────────────────────

function generateHeroButtons(buttons) {
  return buttons.map((btn, index) => `
    <td align="center" class="btn-stack" style="border: 1px solid rgba(255,255,255,0.55); background-color: rgba(16,16,16,0.32);">
      <a href="${btn.link}" style="display: inline-block; min-width: 126px; padding: 15px 28px; font-family: Arial, Helvetica, sans-serif; font-size: 12px; line-height: 16px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: #ffffff; text-decoration: none;">${btn.text}</a>
    </td>
    ${index < buttons.length - 1 ? '<td width="12" class="btn-gap" style="width: 12px; font-size: 0; line-height: 0;">&nbsp;</td>' : ''}
  `).join('');
}

function generateStats(stats) {
  return stats.map((stat, index) => {
    const border = index < stats.length - 1 ? 'border-right: 1px solid rgba(255,255,255,0.22);' : '';
    return `
      <td width="25%" align="center" valign="top" class="stats-col" style="padding: 0 8px; ${border}">
        <div style="padding: 0 0 8px 0; font-family: Arial, Helvetica, sans-serif; font-size: 24px; line-height: 28px; font-weight: 700; color: #ffffff;">${stat.value}</div>
        <div style="font-family: Arial, Helvetica, sans-serif; font-size: 11px; line-height: 18px; color: #f0ece5;">${stat.label}</div>
      </td>`;
  }).join('');
}

/**
 * 2-column grid of dark-overlay cards (used for holidays / things to do / cruises).
 * Uses inline-block divs in a font-size:0 parent so 2x2 layout holds reliably
 * on both desktop and mobile across all major email clients.
 */
function generateGridItems(items, buttonText) {
  const card = (item) => `
    <div class="grid-cell" style="display:inline-block; width:50%; vertical-align:top; font-size:0; line-height:0;">
      <div style="margin:0 4px 8px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" height="280" style="border-collapse: collapse; height: 280px; width:100%;">
          <tr>
            <td valign="bottom" height="220" style="height: 220px; background-color: #101010; background-image: linear-gradient(to bottom, rgba(0,0,0,0.3), rgba(0,0,0,0.7)), url('${item.image}'); background-size: cover; background-position: center; background-repeat: no-repeat; padding: 40px 20px 20px 20px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse; width: 100%">
                <tr><td align="left" style="font-family: Arial, sans-serif; font-size: 8px; line-height: 12px; font-weight: 700; letter-spacing: 1.8px; text-transform: uppercase; color: #ffffff;"><span style="opacity: 0.8">${item.category}</span></td></tr>
                <tr><td align="left" style="font-family: Georgia, serif; font-size: 18px; line-height: 24px; font-weight: 400; color: #ffffff; padding-top: 6px;">${item.title}</td></tr>
                <tr><td align="left" style="font-family: Arial, sans-serif; font-size: 11px; line-height: 16px; color: #e0e0e0; padding-top: 6px;">${item.duration}</td></tr>
                <tr><td align="left" style="font-family: Georgia, serif; font-size: 16px; line-height: 20px; font-weight: 700; color: #ffffff; padding-top: 6px;">${item.price}</td></tr>
                <tr><td align="left" style="padding-top: 10px"><a href="${item.link}" style="font-family: Arial, sans-serif; font-size: 9px; line-height: 12px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: #1a1a1a; text-decoration: none; background-color: #ffffff; display: inline-block; padding: 8px 16px;">${buttonText}</a></td></tr>
              </table>
            </td>
          </tr>
        </table>
      </div>
    </div>`;
  // Wrap all cards in a single row with a font-size:0 parent so inline-block divs flow without whitespace gaps.
  return `
    <tr>
      <td style="padding:0;">
        <div style="font-size:0; line-height:0; text-align:left;">
          ${items.map(card).join('')}
        </div>
      </td>
    </tr>`;
}

function generateRatings(ratingsData) {
  const platforms = ratingsData.platforms;
  const card = (item) => `
    <div class="rating-cell" style="display:inline-block; width:50%; vertical-align:top; font-size:0; line-height:0;">
      <div style="margin:0 5px 10px; border:1px solid ${item.borderColor}; background-color:${item.bgColor};">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; border-collapse:collapse;">
          <tr>
            <td align="center" style="padding: 18px 12px 16px 12px">
              <div style="padding: 0 0 8px 0"><img src="${item.logo}" alt="${item.name}" style="height: 22px; max-height: 26px; width: auto; display: block; margin: 0 auto;" /></div>
              <div style="padding: 0 0 8px 0; font-family: Arial, sans-serif; font-size: 14px; line-height: 18px; color: ${item.starColor};">${item.stars}</div>
              <div style="padding: 0 0 3px 0; font-family: Arial, sans-serif; font-size: 16px; line-height: 20px; font-weight: 700; color: #1a1a1a;">${item.rating}</div>
              <div style="font-family: Arial, sans-serif; font-size: 10px; line-height: 14px; color: #888888;">${item.reviews}</div>
            </td>
          </tr>
        </table>
      </div>
    </div>`;
  // Wrap all platforms in a single row with a font-size:0 parent so inline-block divs flow without whitespace gaps.
  return `
    <tr>
      <td style="padding:0;">
        <div style="font-size:0; line-height:0; text-align:center;">
          ${platforms.map(card).join('')}
        </div>
      </td>
    </tr>`;
}

// ── public API ────────────────────────────────────────────────────────────

export function renderDay6Destination(templateOrPath, data) {
  const template = typeof templateOrPath === 'string' && templateOrPath.includes('<')
    ? templateOrPath
    : readFileSync(templateOrPath, 'utf8');

  const replacements = {
    '{{TOPBAR_HTML}}':                data.topbarHtml,
    '{{HERO_BG}}':                    data.hero.backgroundImage,
    '{{HERO_TAGLINE}}':               data.hero.tagline,
    '{{HERO_TITLE}}':                 data.hero.title,
    '{{HERO_SUBTITLE}}':              data.hero.subtitle,
    '{{HERO_DESC}}':                  data.hero.description,
    '{{HERO_BUTTONS}}':               generateHeroButtons(data.hero.buttons),
    '{{STATS_BLOCK}}':                generateStats(data.stats),

    '{{HOLIDAY_PACKAGES_TITLE}}':     data.holidayPackages.title,
    '{{HOLIDAY_PACKAGES_SUBTITLE}}':  data.holidayPackages.subtitle,
    '{{HOLIDAY_PACKAGES_DESC}}':      data.holidayPackages.description,
    '{{HOLIDAY_PACKAGES_BLOCK}}':     generateGridItems(data.holidayPackages.items, 'View Package &rarr;'),

    '{{TOP_THINGS_TITLE}}':           data.topThingsToDo.title,
    '{{TOP_THINGS_SUBTITLE}}':        data.topThingsToDo.subtitle,
    '{{TOP_THINGS_DESC}}':            data.topThingsToDo.description,
    '{{TOP_THINGS_BLOCK}}':           generateGridItems(data.topThingsToDo.items, 'Book Now &rarr;'),

    '{{CRUISES_TITLE}}':              data.cruises.title,
    '{{CRUISES_SUBTITLE}}':           data.cruises.subtitle,
    '{{CRUISES_DESC}}':               data.cruises.description,
    '{{CRUISES_BLOCK}}':              generateGridItems(data.cruises.items, 'Book Now &rarr;'),

    '{{VISA_SUBTITLE}}':              data.visa.subtitle,
    '{{VISA_TITLE}}':                 data.visa.title,
    '{{VISA_META}}':                  data.visa.meta,
    '{{VISA_PRICE}}':                 data.visa.price,
    '{{VISA_PRICE_LABEL}}':           data.visa.priceLabel,
    '{{VISA_BUTTON_TEXT}}':           data.visa.buttonText,
    '{{VISA_BUTTON_LINK}}':           data.visa.buttonLink,

    '{{RATINGS_TITLE}}':              data.ratings.title,
    '{{RATINGS_SUBTITLE}}':           data.ratings.subtitle,
    '{{RATINGS_DESC}}':               data.ratings.description,
    '{{RATINGS_BLOCK}}':              generateRatings(data.ratings),

    '{{LAST_PART_TITLE}}':            data.lastPart.title,
    '{{LAST_PART_SUBTITLE}}':         data.lastPart.subtitle,
    '{{LAST_PART_DESC}}':             data.lastPart.description,
    '{{LAST_PART_BUTTON_TEXT}}':      data.lastPart.buttonText,
    '{{LAST_PART_BUTTON_LINK}}':      data.lastPart.buttonLink,
  };

  let html = template;
  for (const [k, v] of Object.entries(replacements)) {
    html = html.split(k).join(String(v ?? ''));
  }
  return html;
}

export const _internals = {
  generateHeroButtons, generateStats, generateGridItems, generateRatings,
};

export default renderDay6Destination;
