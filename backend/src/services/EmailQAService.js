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

export default { analyzeEmail };
