/**
 * EmailQAService — post-send QA report for a rendered email.
 *
 * Produces a structured report:
 *   1. grammar       — Claude-found grammar/spelling/clarity issues
 *   2. missingContent— Claude-found empty sections, unfilled {{placeholders}}, missing alt/images
 *   3. urls          — every href/src extracted + HTTP-checked (ok / broken / timeout)
 *   4. spamRisk      — heuristic Low/Medium/High + reasons (NOT real inbox placement)
 *   5. errors        — Claude-found other issues (broken HTML, accessibility, rendering)
 *
 * Claude does 1/2/5 in a single structured call; 3 is plain HTTP; 4 is rules + Claude hints.
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL  = process.env.CLAUDE_MODEL || 'claude-sonnet-4-5';

// ── Extract all URLs (href + src) from HTML ──────────────────────────────
function extractUrls(html) {
  const urls = new Set();
  const re = /(?:href|src)\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const u = m[1].trim();
    if (/^https?:\/\//i.test(u)) urls.add(u);
  }
  return [...urls];
}

// ── HTTP-check a single URL (HEAD, fall back to GET) ─────────────────────
async function checkUrl(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    let res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: ctrl.signal });
    // Some servers reject HEAD — retry with GET
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, { method: 'GET', redirect: 'follow', signal: ctrl.signal });
    }
    clearTimeout(timer);
    return { url, status: res.status, ok: res.ok, finalUrl: res.url !== url ? res.url : undefined };
  } catch (err) {
    clearTimeout(timer);
    return { url, status: 0, ok: false, error: err.name === 'AbortError' ? 'timeout' : err.message };
  }
}

// ── Heuristic spam-risk score (NOT real inbox placement) ─────────────────
function spamRisk(html, subject) {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const reasons = [];
  let score = 0; // higher = riskier

  const spamWords = ['free', 'winner', 'congratulations', 'act now', 'limited time', 'click here', 'guarantee', 'risk-free', 'cash', '100%', 'urgent', 'buy now', 'order now', 'cheap', 'discount'];
  const hits = spamWords.filter(w => text.toLowerCase().includes(w));
  if (hits.length >= 4) { score += 2; reasons.push(`Many spam-trigger words (${hits.slice(0,5).join(', ')})`); }
  else if (hits.length >= 2) { score += 1; reasons.push(`Some spam-trigger words (${hits.join(', ')})`); }

  // ALL-CAPS in subject
  if (subject && subject.replace(/[^A-Z]/g, '').length > subject.replace(/[^A-Za-z]/g, '').length * 0.5 && subject.length > 8) {
    score += 1; reasons.push('Subject is heavily upper-case');
  }
  // Excessive exclamation
  const bangs = (text.match(/!/g) || []).length;
  if (bangs >= 5) { score += 1; reasons.push(`Excessive exclamation marks (${bangs})`); }

  // Image-to-text ratio
  const imgCount = (html.match(/<img/gi) || []).length;
  if (imgCount > 0 && text.length < 200) { score += 1; reasons.push('Image-heavy with very little text'); }

  // Unsubscribe link present (good — lowers risk)
  const hasUnsub = /unsubscribe/i.test(html);
  if (hasUnsub) reasons.push('✓ Has unsubscribe link');
  else { score += 1; reasons.push('No unsubscribe link (hurts deliverability)'); }

  const level = score >= 3 ? 'High' : score >= 1 ? 'Medium' : 'Low';
  const likely = level === 'High' ? 'May land in Spam' : level === 'Medium' ? 'Could be promotions/spam' : 'Likely Inbox';
  return { level, likelyPlacement: likely, score, reasons };
}

// ── Claude content/grammar/error analysis (single structured call) ───────
async function claudeAnalyze(html, subject) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const text = html.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 12000);
  const hasPlaceholders = /\{\{[^}]+\}\}/.test(html);

  if (!apiKey) {
    return { grammar: [], missingContent: hasPlaceholders ? ['Unfilled {{placeholders}} found'] : [], errors: ['Claude key missing — content analysis skipped'], source: 'no_api_key' };
  }

  const system = `You are an email QA reviewer. Analyze the email and return ONLY a JSON object with this exact shape:
{
  "grammar": ["each grammar/spelling/clarity issue as a short string"],
  "missingContent": ["empty sections, unfilled placeholders, missing/blank fields, missing alt text, broken-looking content"],
  "errors": ["any other issues: rendering, accessibility, broken structure, inconsistent branding"]
}
Be concise and specific. Empty arrays if none. No prose outside the JSON.`;
  const user = `SUBJECT: ${subject || '(none)'}\n\nEMAIL TEXT:\n${text}`;

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 1500, temperature: 0.2, system, messages: [{ role: 'user', content: user }] }),
    });
    if (!res.ok) throw new Error(`Claude HTTP ${res.status}`);
    const data = await res.json();
    const textBlock = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    const json = textBlock.match(/\{[\s\S]*\}/);
    if (!json) throw new Error('No JSON in Claude response');
    const parsed = JSON.parse(json[0]);
    return {
      grammar: parsed.grammar || [],
      missingContent: parsed.missingContent || [],
      errors: parsed.errors || [],
      source: 'claude',
    };
  } catch (err) {
    return { grammar: [], missingContent: hasPlaceholders ? ['Unfilled {{placeholders}} found'] : [], errors: [`Claude analysis failed: ${err.message}`], source: 'fallback' };
  }
}

/**
 * Full QA report for an email's rendered HTML + subject.
 */
export async function analyzeEmail({ html, subject }) {
  const urls = extractUrls(html);
  // Check URLs (cap at 25 to keep it fast) + Claude analysis in parallel
  const [urlResults, content] = await Promise.all([
    Promise.all(urls.slice(0, 25).map(checkUrl)),
    claudeAnalyze(html, subject),
  ]);
  const brokenUrls = urlResults.filter(r => !r.ok);

  return {
    subject: subject || null,
    grammar: content.grammar,
    missingContent: content.missingContent,
    urls: { total: urls.length, checked: urlResults.length, broken: brokenUrls.length, results: urlResults },
    spamRisk: spamRisk(html, subject),
    errors: content.errors,
    analysisSource: content.source,
  };
}

/**
 * Real inbox-placement check via IMAP on the test seed inbox.
 * Searches INBOX and [Gmail]/Spam for a recent email matching the subject (and/or
 * the journey sender). Returns where it actually landed.
 *
 * Returns: { available, placement: 'inbox'|'spam'|'not_found', subject, foundAt, error? }
 */
export async function checkInboxPlacement({ subject, sinceMinutes = 60 } = {}) {
  const { IMAP_USER, IMAP_PASSWORD, IMAP_HOST, IMAP_PORT } = process.env;
  if (!IMAP_USER || !IMAP_PASSWORD) {
    return { available: false, error: 'IMAP not configured (set IMAP_USER / IMAP_PASSWORD)' };
  }
  const fromAddr = process.env.CHATHEAD_FROM_EMAIL || 'promotions.raynatours.com';
  const since = new Date(Date.now() - sinceMinutes * 60_000);

  const { ImapFlow } = await import('imapflow');
  const client = new ImapFlow({
    host: IMAP_HOST || 'imap.gmail.com',
    port: parseInt(IMAP_PORT || '993'),
    secure: true,
    auth: { user: IMAP_USER, pass: IMAP_PASSWORD },
    logger: false,
  });

  // Match the Rayna sending domain so we don't pick up unrelated emails
  const fromDomain = fromAddr.includes('@') ? fromAddr.split('@')[1] : fromAddr;

  const searchFolder = async (folder) => {
    try {
      const lock = await client.getMailboxLock(folder);
      try {
        // Always filter by the Rayna sender domain; narrow by subject when provided
        const criteria = { since, from: fromDomain };
        if (subject) criteria.subject = subject.slice(0, 60);
        const uids = await client.search(criteria);
        if (!uids || uids.length === 0) return null;
        let latest = null;
        for await (const msg of client.fetch(uids.slice(-5), { envelope: true })) {
          latest = {
            subject: msg.envelope?.subject,
            from: (msg.envelope?.from || []).map(f => f.address).join(','),
            date: msg.envelope?.date,
          };
        }
        return latest;
      } finally { lock.release(); }
    } catch { return null; }
  };

  try {
    await client.connect();
    const inbox = await searchFolder('INBOX');
    const spam  = inbox ? null : await searchFolder('[Gmail]/Spam');
    await client.logout();

    if (inbox) return { available: true, placement: 'inbox', subject: inbox.subject, foundAt: inbox.date };
    if (spam)  return { available: true, placement: 'spam',  subject: spam.subject,  foundAt: spam.date };
    return { available: true, placement: 'not_found', note: 'Not found yet — may still be in transit (wait ~30s and retry)' };
  } catch (err) {
    try { await client.logout(); } catch { /* ignore */ }
    return { available: false, error: err.message };
  }
}

export default { analyzeEmail, checkInboxPlacement };
