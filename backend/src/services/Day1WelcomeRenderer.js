/**
 * Day1WelcomeRenderer
 *
 * Pure renderer for the Day-1 welcome email. Takes the data.json shape
 * produced by Day1WelcomeDataService and a template HTML string, returns
 * the final HTML ready for EmailChannel.send.
 *
 * Block-injection design — placeholders:
 *   Scalars : LOGO_URL, HERO_BG_IMAGE, HERO_TITLE, HERO_SUBTITLE,
 *             HERO_BUTTON_TEXT, HERO_BUTTON_LINK,
 *             EXCLUSIVE_TITLE, EXCLUSIVE_HEADLINE,
 *             EXCLUSIVE_BUTTON_TEXT, EXCLUSIVE_BUTTON_LINK
 *   Blocks  : HERO_STATS (4-col stats inside hero),
 *             CATEGORIES_BLOCK (4 sections: Holidays/Cruises/Visas/Activities,
 *                               each with 4 destination cards),
 *             RATINGS_BLOCK (2x2 ratings grid)
 *
 * Faithful port of the team's generator.js.
 */

import { readFileSync } from 'node:fs';

// ── card builders ─────────────────────────────────────────────────────────

function generateStats(stats) {
  return stats.map((stat, i) => {
    const border = i < stats.length - 1 ? 'border-right: 1px solid rgba(255, 255, 255, 0.22);' : '';
    return `
      <td width="25%" align="center" valign="top" class="stats-col" style="padding: 0 8px; ${border}">
        <div style="padding: 0 0 8px 0; font-family: Arial, Helvetica, sans-serif; font-size: 24px; line-height: 28px; font-weight: 700; color: #ffffff;">${stat.value}</div>
        <div style="font-family: Arial, Helvetica, sans-serif; font-size: 11px; line-height: 18px; color: #f0ece5;">${stat.label}</div>
      </td>`;
  }).join('');
}

function generateCategories(sections) {
  return sections.map(section => {
    const itemsHtml = section.items.map(item => `
      <td class="service-col service-col-pad" width="25%" valign="top" style="padding: 0 4px; width: 25%">
        <a href="${item.link}" style="text-decoration: none; display: block" class="service-col-inner">
          <img src="${item.image}" alt="${item.name}" width="270" style="display: block; width: 100%; max-width: 270px; height: auto; border: 0;" />
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse;">
            <tr>
              <td align="center" valign="middle" height="48" style="height: 48px; padding: 6px; border: 1px solid #e5e2dc; border-top: 2px solid #1a1a1a; background-color: #f5f2ec; font-family: Arial, Helvetica, sans-serif; font-size: 12px; line-height: 16px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #1a1a1a;">
                ${item.name}
              </td>
            </tr>
          </table>
        </a>
      </td>`).join('');

    return `
      <tr>
        <td style="padding: 0 16px 16px 16px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse; border: 1px solid #eeebe5; border-left: 4px solid #1a1a1a;">
            <tr>
              <td style="padding: 18px 18px 14px 18px; border-bottom: 1px solid #eeebe5;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse">
                  <tr>
                    <td align="left" valign="middle" style="padding: 0">
                      <span style="width: 40px; height: 45px; text-align: center; vertical-align: middle; margin-right: 5px; display: inline-block; font-size: 24px; line-height: 45px;">${section.icon}</span>
                      <span style="vertical-align: middle; display: inline-block; padding: 0; font-family: Arial, Helvetica, sans-serif; font-size: 18px; line-height: 26px; font-weight: 700; color: #1a1a1a;">${section.title}</span>
                    </td>
                    <td class="service-head-right" align="right" valign="middle" style="font-family: Arial, Helvetica, sans-serif; font-size: 11px; line-height: 16px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase;">
                      <a href="${section.link}" style="color: #1a1a1a; text-decoration: none">Explore All &rarr;</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding: 14px 12px 18px 12px">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="service-grid" style="width: 100%; border-collapse: collapse">
                  <tr>${itemsHtml}</tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>`;
  }).join('');
}

function generateRatings(ratings) {
  const rows = [];
  for (let i = 0; i < ratings.length; i += 2) {
    const left  = ratings[i];
    const right = ratings[i + 1];

    const cell = (item, paddingStyle) => `
        <td width="50%" valign="top" class="ratings-col" style="${paddingStyle}">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse; border: 1px solid ${item.styles.border}; background-color: ${item.styles.bg};">
            <tr>
              <td align="center" style="padding: 18px 12px 16px 12px">
                <div style="padding: 0 0 8px 0"><img class="ratings-logo" src="${item.logo}" alt="${item.platform}" style="height: 22px; max-height: 22px; width: auto; display: block; margin: 0 auto;" /></div>
                <div style="padding: 0 0 8px 0; font-family: Arial, Helvetica, sans-serif; font-size: 14px; line-height: 18px; color: ${item.styles.starColor};">${item.stars}</div>
                <div style="padding: 0 0 3px 0; font-family: Arial, Helvetica, sans-serif; font-size: 16px; line-height: 20px; font-weight: 700; color: #1a1a1a;">${item.rating}</div>
                <div style="font-family: Arial, Helvetica, sans-serif; font-size: 10px; line-height: 14px; color: #888888;">${item.reviews}</div>
              </td>
            </tr>
          </table>
        </td>`;

    rows.push(`
      <tr>
        ${cell(left, 'padding: 0 5px 10px 0')}
        ${right ? cell(right, 'padding: 0 0 10px 5px') : '<td></td>'}
      </tr>`);
  }
  return rows.join('');
}

// ── public API ────────────────────────────────────────────────────────────

export function renderDay1Welcome(templateOrPath, data) {
  const template = templateOrPath.includes('<')
    ? templateOrPath
    : readFileSync(templateOrPath, 'utf8');

  let html = template;

  html = html.split('{{LOGO_URL}}').join(data.logoUrl);
  html = html.split('{{HERO_BG_IMAGE}}').join(data.hero.backgroundImage);
  html = html.split('{{HERO_TITLE}}').join(data.hero.title);
  html = html.split('{{HERO_SUBTITLE}}').join(data.hero.subtitle);
  html = html.split('{{HERO_BUTTON_TEXT}}').join(data.hero.button.text);
  html = html.split('{{HERO_BUTTON_LINK}}').join(data.hero.button.link);
  html = html.split('{{HERO_STATS}}').join(generateStats(data.hero.stats));
  html = html.split('{{CATEGORIES_BLOCK}}').join(generateCategories(data.sections));
  html = html.split('{{EXCLUSIVE_TITLE}}').join(data.exclusiveOffer.title);
  html = html.split('{{EXCLUSIVE_HEADLINE}}').join(data.exclusiveOffer.headline);
  html = html.split('{{EXCLUSIVE_BUTTON_TEXT}}').join(data.exclusiveOffer.buttonText);
  html = html.split('{{EXCLUSIVE_BUTTON_LINK}}').join(data.exclusiveOffer.buttonLink);
  html = html.split('{{RATINGS_BLOCK}}').join(generateRatings(data.ratings));

  return html;
}

export const _internals = { generateStats, generateCategories, generateRatings };

export default renderDay1Welcome;
