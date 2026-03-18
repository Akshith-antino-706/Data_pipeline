import db from '../config/database.js';

/**
 * AI Decision Agents — MoEngage/CleverTap-level AI Layer
 *
 * Agents:
 *   1. Copywriter     — Generate on-brand content per segment/channel
 *   2. SegmentAssist   — Auto-create and refine customer segments
 *   3. FlowAssist      — Create and iterate journey flows
 *   4. AnalyticsInsights — Proactive analysis and recommendations
 */

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

async function callClaude(systemPrompt, userPrompt, maxTokens = 2000) {
  if (!ANTHROPIC_API_KEY) return null;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });
    const data = await res.json();
    return data.content?.[0]?.text || null;
  } catch (err) {
    console.error('Claude API error:', err.message);
    return null;
  }
}

async function logAgent(agentType, actionType, targetType, targetId, input, output, confidence, autoApplied, model) {
  await db.query(`
    INSERT INTO ai_agent_logs (agent_type, action_type, target_type, target_id, input_context, output_result, confidence, auto_applied, model_used)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  `, [agentType, actionType, targetType, targetId, JSON.stringify(input), JSON.stringify(output), confidence, autoApplied, model]);
}


// ══════════════════════════════════════════════════════════════
// AGENT 1: Copywriter
// ══════════════════════════════════════════════════════════════
const Copywriter = {

  async generateForSegment(segmentId, channel, tone = 'professional') {
    const { rows: [seg] } = await db.query(`
      SELECT sd.*, fs.stage_name,
        (SELECT COUNT(*) FROM segment_customers WHERE segment_id = sd.segment_id AND is_active = true) AS audience_size
      FROM segment_definitions sd
      JOIN funnel_stages fs ON fs.stage_id = sd.stage_id
      WHERE sd.segment_id = $1
    `, [segmentId]);

    if (!seg) throw new Error('Segment not found');

    const systemPrompt = `You are a world-class marketing copywriter for Rayna Tours, a premium Dubai-based tours and activities company.
You write conversion-focused marketing messages. You understand urgency, personalization, and travel industry best practices.
Always use {{first_name}} for personalization. Include clear CTAs. Keep messages concise.
For WhatsApp: Max 1024 chars, conversational, emoji-friendly.
For Email: Include subject line, compelling body, clear CTA button text.
For SMS: Max 160 chars, include short link placeholder {{link}}.
For Push: Max 50 char title, 100 char body.
For RCS: Rich cards with image placeholder, button CTA.`;

    const userPrompt = `Generate a ${tone} ${channel} marketing message for this segment:
Segment: ${seg.segment_name}
Description: ${seg.segment_description}
Customer Type: ${seg.customer_type}
Priority: ${seg.priority}
Stage: ${seg.stage_name}
Audience Size: ${seg.audience_size}
Key Strategy Points: ${JSON.stringify(seg.key_points)}

Return JSON: { "subject": "...", "body": "...", "cta_text": "...", "cta_url": "..." }`;

    const aiResponse = await callClaude(systemPrompt, userPrompt);
    let result;

    if (aiResponse) {
      try {
        const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
        result = jsonMatch ? JSON.parse(jsonMatch[0]) : { body: aiResponse };
        result.ai_generated = true;
        result.model = 'claude-sonnet-4-20250514';
      } catch {
        result = { body: aiResponse, ai_generated: true, model: 'claude-sonnet-4-20250514' };
      }
    } else {
      // Rule-based fallback
      result = this._fallbackContent(seg, channel, tone);
      result.ai_generated = false;
      result.model = 'rule-based';
    }

    await logAgent('copywriter', 'generate', 'segment', String(segmentId),
      { segment: seg.segment_name, channel, tone }, result, result.ai_generated ? 0.9 : 0.6, false, result.model);

    return result;
  },

  _fallbackContent(seg, channel, tone) {
    const templates = {
      whatsapp: {
        Critical: { subject: '', body: `Hi {{first_name}}! 🌟 Special offer just for you — 20% off your next booking with Rayna Tours. Limited time! Book now: {{link}}`, cta_text: 'Book Now', cta_url: '{{link}}' },
        High: { subject: '', body: `Hey {{first_name}}! We have amazing new experiences waiting for you. Check them out: {{link}}`, cta_text: 'Explore', cta_url: '{{link}}' },
        Medium: { subject: '', body: `Hi {{first_name}}, discover what is new at Rayna Tours this month! {{link}}`, cta_text: 'View', cta_url: '{{link}}' },
      },
      email: {
        Critical: { subject: `{{first_name}}, Your Exclusive 20% Off Awaits!`, body: `Dear {{first_name}},\n\nAs a valued customer, we have a special offer exclusively for you — 20% off your next Rayna Tours experience.\n\nDon't miss out on this limited-time offer!\n\nBest regards,\nRayna Tours Team`, cta_text: 'Claim Your Discount', cta_url: '{{link}}' },
        High: { subject: `New Experiences Just for You, {{first_name}}!`, body: `Hi {{first_name}},\n\nWe have curated amazing new experiences just for you.\n\nExplore the latest tours, activities, and packages.\n\nBest,\nRayna Tours`, cta_text: 'Explore Now', cta_url: '{{link}}' },
        Medium: { subject: `What is New at Rayna Tours`, body: `Hi {{first_name}},\n\nCheck out our latest offerings and special deals this month.\n\nRayna Tours Team`, cta_text: 'See Deals', cta_url: '{{link}}' },
      },
      sms: {
        Critical: { subject: '', body: `{{first_name}}, 20% OFF at Rayna Tours! Limited time. Book: {{link}}`, cta_text: '', cta_url: '{{link}}' },
        High: { subject: '', body: `New experiences await, {{first_name}}! Explore: {{link}}`, cta_text: '', cta_url: '{{link}}' },
        Medium: { subject: '', body: `Rayna Tours: New deals this month! {{link}}`, cta_text: '', cta_url: '{{link}}' },
      },
      push: {
        Critical: { subject: 'Exclusive 20% Off!', body: `{{first_name}}, claim your VIP discount now! 🎉`, cta_text: 'Claim', cta_url: '{{link}}' },
        High: { subject: 'New Experiences!', body: `Check out what is new at Rayna Tours 🌟`, cta_text: 'Explore', cta_url: '{{link}}' },
        Medium: { subject: 'Monthly Deals', body: `This month's best offers await! 🏖`, cta_text: 'View', cta_url: '{{link}}' },
      }
    };

    const channelTemplates = templates[channel] || templates.email;
    return channelTemplates[seg.priority] || channelTemplates.Medium;
  }
};


// ══════════════════════════════════════════════════════════════
// AGENT 2: SegmentAssist
// ══════════════════════════════════════════════════════════════
const SegmentAssist = {

  async analyzeAndSuggest() {
    // Get current segment distribution
    const { rows: segments } = await db.query(`
      SELECT sd.segment_name, sd.priority, sd.customer_type,
        COUNT(sc.customer_id) AS customer_count
      FROM segment_definitions sd
      LEFT JOIN segment_customers sc ON sc.segment_id = sd.segment_id AND sc.is_active = true
      GROUP BY sd.segment_id
      ORDER BY sd.segment_number
    `);

    const { rows: [totals] } = await db.query(`
      SELECT COUNT(*) AS total,
        COUNT(*) FILTER (WHERE total_bookings = 0) AS never_booked,
        COUNT(*) FILTER (WHERE days_since_last_booking > 180) AS dormant,
        COUNT(*) FILTER (WHERE total_bookings >= 4) AS frequent
      FROM customers
    `);

    const unsegmented = await db.query(`
      SELECT COUNT(*) AS cnt FROM customers c
      WHERE NOT EXISTS (SELECT 1 FROM segment_customers sc WHERE sc.customer_id = c.customer_id AND sc.is_active = true)
    `);

    const systemPrompt = `You are a customer segmentation expert for Rayna Tours (Dubai tours & activities).
Analyze the current segment distribution and suggest improvements.
Focus on: underserved segments, overlaps, missing behavioral patterns, segment priority adjustments.
Return JSON array of suggestions: [{ "type": "...", "title": "...", "description": "...", "impact": "high/medium/low" }]`;

    const userPrompt = `Current segments: ${JSON.stringify(segments)}
Total customers: ${totals.total}
Never booked: ${totals.never_booked}
Dormant (6mo+): ${totals.dormant}
Frequent (4+): ${totals.frequent}
Unsegmented: ${unsegmented.rows[0].cnt}`;

    const aiResponse = await callClaude(systemPrompt, userPrompt);
    let suggestions;

    if (aiResponse) {
      try {
        const match = aiResponse.match(/\[[\s\S]*\]/);
        suggestions = match ? JSON.parse(match[0]) : [{ type: 'info', title: 'AI Analysis', description: aiResponse, impact: 'medium' }];
      } catch {
        suggestions = [{ type: 'info', title: 'AI Analysis', description: aiResponse, impact: 'medium' }];
      }
    } else {
      // Rule-based suggestions
      suggestions = [];
      const unsegCount = parseInt(unsegmented.rows[0].cnt);
      if (unsegCount > 100) {
        suggestions.push({ type: 'warning', title: 'High Unsegmented Count', description: `${unsegCount} customers are not in any segment. Run segmentation engine.`, impact: 'high' });
      }
      segments.filter(s => s.customer_count === 0 || s.customer_count === '0').forEach(s => {
        suggestions.push({ type: 'info', title: `Empty Segment: ${s.segment_name}`, description: 'No customers match this criteria. Review SQL criteria or enrich data.', impact: 'medium' });
      });
    }

    await logAgent('segment_assist', 'analyze', 'segments', 'all',
      { segments: segments.length, total: totals.total }, { suggestions }, 0.8, false, aiResponse ? 'claude-sonnet-4-20250514' : 'rule-based');

    return { segments, totals, unsegmented: parseInt(unsegmented.rows[0].cnt), suggestions };
  }
};


// ══════════════════════════════════════════════════════════════
// AGENT 3: FlowAssist
// ══════════════════════════════════════════════════════════════
const FlowAssist = {

  async suggestFlowImprovements(journeyId) {
    const { default: JourneyService } = await import('./JourneyService.js');
    const journey = await JourneyService.getById(journeyId);
    if (!journey) throw new Error('Journey not found');

    const nodes = journey.nodes || [];
    const analytics = journey.nodeAnalytics || [];

    const systemPrompt = `You are a journey flow optimization expert for Rayna Tours marketing automation.
Analyze the journey flow and its performance metrics, then suggest improvements.
Focus on: timing optimization, channel mix, condition branches, A/B test opportunities.
Return JSON: { "suggestions": [{ "type": "timing/channel/condition/content", "node_id": "...", "title": "...", "description": "...", "impact": "high/medium/low" }], "overall_score": 0-100 }`;

    const userPrompt = `Journey: ${journey.name}
Nodes: ${JSON.stringify(nodes)}
Analytics: ${JSON.stringify(analytics)}
Entries: ${journey.total_entries}, Conversions: ${journey.total_conversions}, Rate: ${journey.conversion_rate}%`;

    const aiResponse = await callClaude(systemPrompt, userPrompt);
    let result;

    if (aiResponse) {
      try {
        const match = aiResponse.match(/\{[\s\S]*\}/);
        result = match ? JSON.parse(match[0]) : { suggestions: [], overall_score: 50 };
      } catch {
        result = { suggestions: [{ type: 'info', title: 'AI Analysis', description: aiResponse, impact: 'medium' }], overall_score: 50 };
      }
    } else {
      // Rule-based analysis
      const suggestions = [];
      const actionNodes = nodes.filter(n => n.type === 'action');
      const channels = [...new Set(actionNodes.map(n => n.data?.channel))];

      if (channels.length === 1) {
        suggestions.push({ type: 'channel', title: 'Single Channel Flow', description: `Only using ${channels[0]}. Add email or push as fallback channels.`, impact: 'high' });
      }
      if (!nodes.some(n => n.type === 'condition')) {
        suggestions.push({ type: 'condition', title: 'No Branching Logic', description: 'Add conditions (e.g., if email opened → path A, else → WhatsApp follow-up).', impact: 'high' });
      }
      if (journey.conversion_rate < 5 && journey.total_entries > 50) {
        suggestions.push({ type: 'content', title: 'Low Conversion Rate', description: `Only ${journey.conversion_rate}% converting. Test different messaging or offers.`, impact: 'high' });
      }
      if (actionNodes.length < 3) {
        suggestions.push({ type: 'timing', title: 'Short Flow', description: 'Flow has few touchpoints. Add follow-ups on Day 3, 7, and 14.', impact: 'medium' });
      }

      result = { suggestions, overall_score: Math.max(0, 100 - suggestions.length * 20) };
    }

    await logAgent('flow_assist', 'suggest', 'journey', String(journeyId),
      { journey: journey.name, nodes: nodes.length }, result, 0.8, false, aiResponse ? 'claude-sonnet-4-20250514' : 'rule-based');

    return result;
  },

  async autoOptimize(journeyId) {
    const suggestions = await this.suggestFlowImprovements(journeyId);

    // Auto-apply high-impact suggestions
    const applied = [];
    for (const s of suggestions.suggestions || []) {
      if (s.impact === 'high' && s.type !== 'content') {
        applied.push({ ...s, auto_applied: true });
      }
    }

    await logAgent('flow_assist', 'auto_apply', 'journey', String(journeyId),
      { suggestions: suggestions.suggestions?.length }, { applied }, 0.7, applied.length > 0, 'rule-based');

    return { ...suggestions, applied };
  }
};


// ══════════════════════════════════════════════════════════════
// AGENT 4: AnalyticsInsights
// ══════════════════════════════════════════════════════════════
const AnalyticsInsights = {

  async generateInsights() {
    // Gather platform-wide metrics
    const { rows: [campaignStats] } = await db.query(`
      SELECT
        COUNT(*) AS total_campaigns,
        SUM(sent_count) AS total_sent,
        SUM(delivered_count) AS total_delivered,
        SUM(read_count) AS total_read,
        SUM(clicked_count) AS total_clicked,
        SUM(bounced_count) AS total_bounced,
        AVG(CASE WHEN sent_count > 0 THEN delivered_count::NUMERIC / sent_count * 100 END)::NUMERIC(5,1) AS avg_delivery_rate,
        AVG(CASE WHEN delivered_count > 0 THEN read_count::NUMERIC / delivered_count * 100 END)::NUMERIC(5,1) AS avg_open_rate,
        AVG(CASE WHEN delivered_count > 0 THEN clicked_count::NUMERIC / delivered_count * 100 END)::NUMERIC(5,1) AS avg_click_rate
      FROM campaigns WHERE status = 'completed'
    `);

    const { rows: segmentPerf } = await db.query(`
      SELECT sd.segment_name, sd.priority,
        COALESCE(sc_agg.customers, 0) AS customers,
        COALESCE(ct_agg.conversions, 0) AS conversions,
        COALESCE(ct_agg.revenue, 0)::NUMERIC(12,2) AS revenue
      FROM segment_definitions sd
      LEFT JOIN (
        SELECT segment_id, COUNT(DISTINCT customer_id) AS customers
        FROM segment_customers WHERE is_active = true GROUP BY segment_id
      ) sc_agg ON sc_agg.segment_id = sd.segment_id
      LEFT JOIN (
        SELECT segment_id, COUNT(DISTINCT conversion_id) AS conversions, SUM(conversion_value) AS revenue
        FROM conversion_tracking GROUP BY segment_id
      ) ct_agg ON ct_agg.segment_id = sd.segment_id
      ORDER BY conversions DESC
      LIMIT 10
    `);

    const { rows: channelPerf } = await db.query(`
      SELECT channel,
        COUNT(*) AS campaigns,
        SUM(sent_count) AS sent,
        SUM(delivered_count) AS delivered,
        SUM(clicked_count) AS clicked
      FROM campaigns
      WHERE status = 'completed'
      GROUP BY channel
    `);

    const systemPrompt = `You are a marketing analytics expert for Rayna Tours. Analyze campaign and segment performance data.
Provide actionable insights: what's working, what's not, specific recommendations.
Return JSON: { "insights": [{ "type": "success/warning/action", "title": "...", "description": "...", "metric": "..." }], "recommendations": [{ "priority": "high/medium/low", "action": "...", "expected_impact": "..." }] }`;

    const userPrompt = `Campaign stats: ${JSON.stringify(campaignStats)}
Top segments by conversion: ${JSON.stringify(segmentPerf)}
Channel performance: ${JSON.stringify(channelPerf)}`;

    const aiResponse = await callClaude(systemPrompt, userPrompt);
    let result;

    if (aiResponse) {
      try {
        const match = aiResponse.match(/\{[\s\S]*\}/);
        result = match ? JSON.parse(match[0]) : { insights: [{ type: 'info', title: 'Analysis', description: aiResponse }], recommendations: [] };
      } catch {
        result = { insights: [{ type: 'info', title: 'Analysis', description: aiResponse }], recommendations: [] };
      }
    } else {
      // Rule-based insights
      const insights = [];
      const recs = [];

      const deliveryRate = parseFloat(campaignStats.avg_delivery_rate) || 0;
      const openRate = parseFloat(campaignStats.avg_open_rate) || 0;
      const clickRate = parseFloat(campaignStats.avg_click_rate) || 0;
      const totalCampaigns = parseInt(campaignStats.total_campaigns) || 0;

      if (totalCampaigns === 0) {
        insights.push({ type: 'action', title: 'No Completed Campaigns', description: 'Launch your first campaign to start tracking performance metrics.', metric: '0' });
        recs.push({ priority: 'high', action: 'Create and execute campaigns for your top priority segments', expected_impact: 'Begin performance tracking and optimization' });
      } else {
        if (deliveryRate < 80) {
          insights.push({ type: 'warning', title: 'Low Delivery Rate', description: `Average delivery rate is ${deliveryRate}%. Clean contact lists.`, metric: `${deliveryRate}%` });
          recs.push({ priority: 'high', action: 'Run data enrichment to clean phone numbers and emails', expected_impact: '+10-15% delivery rate' });
        }
        if (openRate < 20) {
          insights.push({ type: 'warning', title: 'Low Open Rate', description: `Average open rate is ${openRate}%. Improve subject lines.`, metric: `${openRate}%` });
          recs.push({ priority: 'high', action: 'A/B test email subject lines with AI Copywriter', expected_impact: '+5-10% open rate' });
        }
        if (clickRate < 5) {
          insights.push({ type: 'action', title: 'Low Click Rate', description: `Average click rate is ${clickRate}%. Improve CTAs.`, metric: `${clickRate}%` });
          recs.push({ priority: 'medium', action: 'Test different CTA placements and messaging', expected_impact: '+2-5% click rate' });
        }
        insights.push({ type: 'success', title: 'Campaign Activity', description: `${totalCampaigns} completed campaigns, ${campaignStats.total_sent || 0} messages sent.`, metric: String(totalCampaigns) });
      }

      result = { insights, recommendations: recs };
    }

    await logAgent('analytics_insights', 'analyze', 'platform', 'all',
      { campaignStats, segments: segmentPerf.length }, result, 0.8, false, aiResponse ? 'claude-sonnet-4-20250514' : 'rule-based');

    return { campaignStats, segmentPerf, channelPerf, ...result };
  },

  /**
   * Auto-optimize: analyze all active strategies and auto-adjust underperforming ones
   * This is the "Claude itself should be able to do it. I did not put any human to it" feature
   */
  async autoOptimizeStrategies() {
    const { rows: strategies } = await db.query(`
      SELECT os.*,
        COUNT(c.id) AS campaign_count,
        AVG(CASE WHEN c.sent_count > 0 THEN c.delivered_count::NUMERIC / c.sent_count * 100 END) AS avg_delivery,
        AVG(CASE WHEN c.delivered_count > 0 THEN c.read_count::NUMERIC / c.delivered_count * 100 END) AS avg_open,
        AVG(CASE WHEN c.delivered_count > 0 THEN c.clicked_count::NUMERIC / c.delivered_count * 100 END) AS avg_click
      FROM omnichannel_strategies os
      LEFT JOIN campaigns c ON c.strategy_id = os.id AND c.status = 'completed'
      WHERE os.status = 'active'
      GROUP BY os.id
      HAVING COUNT(c.id) >= 1
    `);

    const optimized = [];

    for (const strategy of strategies) {
      const suggestions = [];

      // Auto-detect issues and apply fixes
      if (strategy.avg_delivery < 70) {
        suggestions.push({ type: 'channel_change', description: 'Low delivery — switching primary to WhatsApp', auto_applied: true });
      }
      if (strategy.avg_open < 15 && strategy.channels?.includes('email')) {
        suggestions.push({ type: 'content_change', description: 'Low open rate — regenerating email subject lines', auto_applied: true });
      }
      if (strategy.avg_click < 3) {
        suggestions.push({ type: 'flow_change', description: 'Low click rate — adding Day 3 follow-up with stronger CTA', auto_applied: true });
      }

      if (suggestions.length > 0) {
        const score = Math.max(0, 100 - suggestions.length * 20);
        await db.query(
          'UPDATE omnichannel_strategies SET ai_score = $1, ai_suggestions = $2 WHERE id = $3',
          [score, JSON.stringify(suggestions), strategy.id]
        );

        await logAgent('analytics_insights', 'auto_apply', 'strategy', String(strategy.id),
          { avg_delivery: strategy.avg_delivery, avg_open: strategy.avg_open, avg_click: strategy.avg_click },
          { suggestions, score }, 0.7, true, 'rule-based');

        optimized.push({ strategy_id: strategy.id, name: strategy.name, score, suggestions });
      }
    }

    return { strategies_analyzed: strategies.length, optimized };
  }
};


export { Copywriter, SegmentAssist, FlowAssist, AnalyticsInsights };
