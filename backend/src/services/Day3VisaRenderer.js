/**
 * Day3VisaRenderer
 *
 * Pure renderer for the Day-3 visa email. Takes the data.json shape produced
 * by Day3VisaDataService and a template HTML string, returns the final HTML
 * ready for EmailChannel.send.
 *
 * Block-injection design — placeholders:
 *   Scalars : HERO_BG_IMAGE, HERO_TITLE, HERO_DESCRIPTION,
 *             INTERNATIONAL_SUBTITLE, INTERNATIONAL_TITLE, INTERNATIONAL_DESCRIPTION,
 *             EVISA_SUBTITLE, EVISA_TITLE, EVISA_DESCRIPTION,
 *             POPULAR_SUBTITLE, POPULAR_TITLE,
 *             RATINGS_SUBTITLE, RATINGS_TITLE, RATINGS_DESCRIPTION,
 *             CTA_SUBTITLE, CTA_TITLE, CTA_DESCRIPTION, CTA_BUTTON_TEXT, CTA_LINK,
 *             FOOTER_ADDRESS, FOOTER_EMAIL, FOOTER_PHONE
 *   Blocks  : INTERNATIONAL_VISA_CARDS (2-col grid),
 *             EVISA_LIST_ITEMS (stacked horizontal rows),
 *             POPULAR_DESTINATION_CARDS (4-col grid),
 *             RATINGS_GRID (2x2 grid)
 *
 * Faithful port of the team's generate-email.js (visa flavor).
 */

import { readFileSync } from 'node:fs';

// ── card builders ─────────────────────────────────────────────────────────

function generateInternationalVisaCards(visas) {
  let html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse">`;

  for (let i = 0; i < visas.length; i += 2) {
    html += `<tr>`;
    for (let j = 0; j < 2; j++) {
      const index = i + j;
      if (index < visas.length) {
        const visa = visas[index];
        const padding = (j === 0) ? 'padding: 0 6px 12px 0;' : 'padding: 0 0 12px 6px;';
        html += `
        <td width="50%" valign="top" style="display: table-cell; width: 50%; ${padding}">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" height="290" style="width: 100%; height: 290px; border-collapse: collapse">
            <tr>
              <td height="160" style="height: 160px;">
                <img class="fluid-img visa-card-img" src="${visa.image}" alt="${visa.name}" width="266" style="display: block; width: 100%; height: 160px; border: 0;"/>
              </td>
            </tr>
            <tr>
              <td valign="top" height="130" style="height: 130px; background-color: #1a1a1a; padding: 14px 16px;">
                <div style="font-family: Georgia, serif; font-size: 18px; line-height: 22px; color: #ffffff; padding-bottom: 4px;">
                  ${visa.flag} ${visa.name}
                </div>
                <div style="font-family: Arial, sans-serif; font-size: 10px; line-height: 16px; color: rgba(255, 255, 255, 0.65); padding-bottom: 10px;">
                  ${visa.types}
                </div>
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse">
                  <tr>
                    <td bgcolor="#ffffff" style="background-color: #ffffff">
                      <a href="${visa.link}" style="display: inline-block; font-family: Arial, sans-serif; font-size: 9px; line-height: 14px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: #1a1a1a; text-decoration: none; padding: 8px 14px;">Apply Now &#8594;</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>`;
      } else {
        html += `<td width="50%">&nbsp;</td>`;
      }
    }
    html += `</tr>`;
  }

  html += `</table>`;
  return html;
}

function generateEVisaRows(items) {
  let html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse">`;

  items.forEach((item, index) => {
    const isLast = index === items.length - 1;
    const paddingBottom = isLast ? '0' : '8px';
    html += `
    <tr>
      <td style="padding: 0 0 ${paddingBottom} 0">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse; background-color: #f7f6f3;">
          <tr>
            <td class="ev-img-col" width="100" valign="top" style="display: table-cell; width: 100px">
              <img src="${item.image}" alt="${item.name}" width="100" style="display: block; width: 100px; height: 85px; border: 0;"/>
            </td>
            <td class="ev-content-col" valign="middle" style="display: table-cell; padding: 10px 14px; font-family: Arial, sans-serif;">
              <div style="font-size: 9px; line-height: 14px; color: #888888; letter-spacing: 1px; text-transform: uppercase; padding-bottom: 3px;">
                ${item.flag} eVisa &middot; ${item.country}
              </div>
              <div style="font-family: Georgia, serif; font-size: 16px; line-height: 20px; color: #1a1a1a; font-weight: 700; padding-bottom: 3px;">
                ${item.name}
              </div>
              <div style="font-size: 10px; line-height: 16px; color: #666666;">
                ${item.details}
              </div>
            </td>
            <td class="ev-action-col" width="96" valign="middle" align="center" style="display: table-cell; width: 96px; border-left: 1px solid #e8e3d8; padding: 10px 12px; font-family: Arial, sans-serif;">
              <div style="font-size: 9px; line-height: 14px; color: #2e8b57; font-weight: 700; letter-spacing: 1px; padding-bottom: 8px;">
                &#10003; ${item.status}
              </div>
              <div style="display: inline-block; border: 1px solid #1a1a1a; background-color: #ffffff;">
                <a href="${item.link}" style="display: inline-block; font-family: Arial, sans-serif; font-size: 9px; line-height: 14px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: #1a1a1a; text-decoration: none; padding: 7px 12px;">Apply &#8594;</a>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
  });

  html += `</table>`;
  return html;
}

function generatePopularDestinationCards(items) {
  let html = `<table class="pop-grid" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse"><tr>`;

  items.forEach((item, index) => {
    const paddingLeft  = index === 0 ? '0' : '4px';
    const paddingRight = index === items.length - 1 ? '0' : '4px';

    html += `
    <td class="pop-col" width="25%" valign="top" style="display: table-cell; width: 25%; padding: 0 ${paddingRight} 8px ${paddingLeft};">
      <a href="${item.link}" style="text-decoration: none">
        <img class="fluid-img" src="${item.image}" alt="${item.name}" width="131" style="display: block; width: 100%; height: 90px; border: 0;"/>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse;">
          <tr>
            <td align="center" valign="middle" height="40" style="height: 40px; background-color: #1a1a1a; font-family: Arial, sans-serif; font-size: 10px; line-height: 14px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #ffffff; padding: 6px 4px;">
              ${item.name}
            </td>
          </tr>
        </table>
      </a>
    </td>`;
  });

  html += `</tr></table>`;
  return html;
}

function generateRatingsGrid(ratings) {
  let html = `<table class="review-grid" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse">`;

  for (let i = 0; i < ratings.length; i += 2) {
    html += `<tr>`;
    for (let j = 0; j < 2; j++) {
      const index = i + j;
      if (index < ratings.length) {
        const item = ratings[index];
        const padding = (j === 0) ? 'padding: 0 5px 10px 0;' : 'padding: 0 0 10px 5px;';
        const borderColor = (item.platform === 'Trustpilot' || item.platform === 'Tripadvisor') ? '#b8e8d0'
                          : (item.platform === 'Google') ? '#f5cfc8' : '#f0e5c0';
        const bgColor     = (item.platform === 'Trustpilot' || item.platform === 'Tripadvisor') ? '#f4fcf8'
                          : (item.platform === 'Google') ? '#fff8f6' : '#fffdf4';
        const starColor   = (item.platform === 'Trustpilot') ? '#00b67a'
                          : (item.platform === 'Tripadvisor') ? '#00aa6c'
                          : (item.platform === 'Google') ? '#fbbc04' : '#f5a623';

        let logo = '';
        if (item.platform === 'Rayna Tours') logo = 'https://d2cazmkfw8kdtj.cloudfront.net/assets/Images/AGT-06437/raynatourslogo.png';
        if (item.platform === 'Trustpilot')  logo = 'https://cdn.trustpilot.net/brand-assets/4.3.0/logo-black.svg';
        if (item.platform === 'Tripadvisor') logo = 'https://static.tacdn.com/img2/brand_refresh/Tripadvisor_lockup_horizontal_secondary_registered.svg';
        if (item.platform === 'Google')      logo = 'https://www.google.com/images/branding/googlelogo/2x/googlelogo_color_272x92dp.png';

        html += `
        <td class="review-col" width="50%" valign="top" style="${padding}">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse; border: 1px solid ${borderColor}; background-color: ${bgColor};">
            <tr>
              <td align="center" style="padding: 18px 12px 16px 12px">
                <div style="padding: 0 0 8px 0">
                  <img src="${logo}" alt="${item.platform}" style="height: 22px; max-height: 22px; width: auto; display: block; margin: 0 auto;"/>
                </div>
                <div style="padding: 0 0 8px 0; font-family: Georgia, serif; font-size: 14px; line-height: 18px; color: ${starColor};">
                  ${item.stars}
                </div>
                <div style="padding: 0 0 3px 0; font-family: Georgia, serif; font-size: 16px; line-height: 20px; font-weight: 700; color: #1a1a1a;">
                  ${item.score}
                </div>
                <div style="font-family: Georgia, serif; font-size: 10px; line-height: 14px; color: #888888;">
                  ${item.reviews}
                </div>
              </td>
            </tr>
          </table>
        </td>`;
      }
    }
    html += `</tr>`;
  }

  html += `</table>`;
  return html;
}

// ── public API ────────────────────────────────────────────────────────────

/**
 * Render the Day-3 visa email HTML.
 * @param {string} templateOrPath  HTML template string OR a path to one
 * @param {object} data            data.json shape (see Day3VisaDataService)
 * @returns {string} rendered HTML
 */
export function renderDay3Visa(templateOrPath, data) {
  const template = templateOrPath.includes('<')
    ? templateOrPath
    : readFileSync(templateOrPath, 'utf8');

  let html = template;

  html = html.split('{{HERO_BG_IMAGE}}').join(data.hero.bg_image);
  html = html.split('{{HERO_TITLE}}').join(data.hero.title);
  html = html.split('{{HERO_DESCRIPTION}}').join(data.hero.description);

  html = html.split('{{INTERNATIONAL_SUBTITLE}}').join(data.international_travel.subtitle);
  html = html.split('{{INTERNATIONAL_TITLE}}').join(data.international_travel.title);
  html = html.split('{{INTERNATIONAL_DESCRIPTION}}').join(data.international_travel.description);
  html = html.split('{{INTERNATIONAL_VISA_CARDS}}').join(generateInternationalVisaCards(data.international_travel.visas));

  html = html.split('{{EVISA_SUBTITLE}}').join(data.evisa_section.subtitle);
  html = html.split('{{EVISA_TITLE}}').join(data.evisa_section.title);
  html = html.split('{{EVISA_DESCRIPTION}}').join(data.evisa_section.description);
  html = html.split('{{EVISA_LIST_ITEMS}}').join(generateEVisaRows(data.evisa_section.items));

  html = html.split('{{POPULAR_SUBTITLE}}').join(data.popular_destinations.subtitle);
  html = html.split('{{POPULAR_TITLE}}').join(data.popular_destinations.title);
  html = html.split('{{POPULAR_DESTINATION_CARDS}}').join(generatePopularDestinationCards(data.popular_destinations.items));

  html = html.split('{{RATINGS_SUBTITLE}}').join(data.ratings.subtitle);
  html = html.split('{{RATINGS_TITLE}}').join(data.ratings.title);
  html = html.split('{{RATINGS_DESCRIPTION}}').join(data.ratings.description);
  html = html.split('{{RATINGS_GRID}}').join(generateRatingsGrid(data.ratings.items));

  html = html.split('{{CTA_SUBTITLE}}').join(data.cta.subtitle);
  html = html.split('{{CTA_TITLE}}').join(data.cta.title);
  html = html.split('{{CTA_DESCRIPTION}}').join(data.cta.description);
  html = html.split('{{CTA_BUTTON_TEXT}}').join(data.cta.button_text);
  html = html.split('{{CTA_LINK}}').join(data.cta.link);

  html = html.split('{{FOOTER_ADDRESS}}').join(data.footer.address);
  html = html.split('{{FOOTER_EMAIL}}').join(data.footer.email);
  html = html.split('{{FOOTER_PHONE}}').join(data.footer.phone);

  return html;
}

export const _internals = {
  generateInternationalVisaCards, generateEVisaRows,
  generatePopularDestinationCards, generateRatingsGrid,
};

export default renderDay3Visa;
