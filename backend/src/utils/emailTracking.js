/**
 * Shared email tracking utilities — used by both test-sends and journey workers.
 *
 * Provides:
 *   - injectClickTracking()  — wraps every href with the click-tracking redirect + UTM params
 *   - injectOpenPixel()      — appends a 1×1 open-tracking pixel before </body>
 */

/**
 * Replace every href link in the HTML with a click-tracking redirect that:
 *  1. Records the click against the send-log row
 *  2. Appends UTM params + rid to the destination URL
 *  3. Redirects the recipient to the real page
 *
 * @param {string} html            - Email HTML body
 * @param {object} opts
 * @param {number} opts.logId      - email_send_log.id
 * @param {string} opts.baseUrl    - Backend base URL for tracking endpoints
 * @param {string} opts.campaign   - utm_campaign value (e.g. "day1_welcome" or "j5_action_2")
 * @param {string} opts.content    - utm_content value (e.g. "test_send_day1" or "journey_on_trip")
 * @param {string} opts.source     - utm_source value (default "AI_marketer")
 * @param {string} opts.medium     - utm_medium value (default "email")
 * @param {number|string} opts.unifiedId - recipient's unified_id for rid param
 * @param {number|string} [opts.journeyId] - journey ID to append to utm_content
 * @param {string}        [opts.nodeId]    - node ID (e.g. "trigger-1") to append to utm_content
 */
export function injectClickTracking(html, { logId, baseUrl, campaign, content, source = 'AI_marketer', medium = 'email', unifiedId, journeyId, nodeId }) {
  // Build utm_content with journey info if provided
  let utmContent = content;
  if (journeyId) utmContent += `_j${journeyId}`;
  if (nodeId) utmContent += `_${nodeId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

  return html.replace(/href="(https?:\/\/[^"]+)"/g, (match, originalUrl) => {
    // Skip our own tracking URLs and mailto links
    if (
      originalUrl.includes('/api/track/') ||
      originalUrl.includes('/api/v3/utm/') ||
      originalUrl.startsWith('mailto:')
    ) return match;

    try {
      const dest = new URL(originalUrl);
      dest.searchParams.set('utm_source', source);
      dest.searchParams.set('utm_medium', medium);
      dest.searchParams.set('utm_campaign', campaign);
      dest.searchParams.set('utm_content', utmContent);
      if (unifiedId) dest.searchParams.set('rid', String(unifiedId));
      if (journeyId) dest.searchParams.set('journeyId', String(journeyId));
      if (nodeId) dest.searchParams.set('nodeId', nodeId);

      const trackUrl = `${baseUrl}/api/track/email-send/click/${logId}?url=${encodeURIComponent(dest.toString())}`;
      return `href="${trackUrl}"`;
    } catch {
      return match; // malformed URL — leave as-is
    }
  });
}

/**
 * Inject a 1×1 open-tracking pixel into the email HTML.
 *
 * @param {string} html     - Email HTML body
 * @param {number} logId    - email_send_log.id
 * @param {string} baseUrl  - Backend base URL for tracking endpoints
 * @returns {string} HTML with pixel injected
 */
export function injectOpenPixel(html, logId, baseUrl) {
  const pixel = `<img src="${baseUrl}/api/track/email-send/open/${logId}" width="1" height="1" style="display:none" alt="" />`;
  if (html.includes('</body>')) {
    return html.replace('</body>', `${pixel}</body>`);
  }
  return html + pixel;
}
