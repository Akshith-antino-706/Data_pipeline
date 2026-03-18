import { query } from '../config/database.js';

/**
 * AI Service for content generation & strategy optimization.
 * Uses Claude API when ANTHROPIC_API_KEY is set, otherwise returns rule-based suggestions.
 */
export class AIService {

  /** Generate content for a given channel and context */
  static async generateContent({ channel, segmentLabel, tone = 'professional', goal, productContext }) {
    const apiKey = process.env.ANTHROPIC_API_KEY;

    // Get segment context
    const { rows } = await query(`
      SELECT
        segment_label,
        COUNT(*) AS size,
        ROUND(AVG(recency_days), 0) AS avg_recency,
        ROUND(AVG(total_bookings), 1) AS avg_bookings,
        MODE() WITHIN GROUP (ORDER BY nationality) AS top_nationality,
        MODE() WITHIN GROUP (ORDER BY customer_type) AS top_customer_type
      FROM customer_segments
      WHERE segment_label = $1
      GROUP BY segment_label
    `, [segmentLabel]);

    const segmentCtx = rows[0] || {};

    const prompt = `You are a senior marketing content writer for Rayna Tours, a premium tours and activities company in Dubai/UAE.

Generate marketing content for the "${channel}" channel.

SEGMENT: ${segmentLabel}
- Size: ${segmentCtx.size || 'unknown'} customers
- Avg recency: ${segmentCtx.avg_recency || 'unknown'} days
- Avg bookings: ${segmentCtx.avg_bookings || 'unknown'}
- Top nationality: ${segmentCtx.top_nationality || 'mixed'}
- Customer type: ${segmentCtx.top_customer_type || 'mixed'}

GOAL: ${goal || 'Re-engage and drive bookings'}
TONE: ${tone}
${productContext ? `PRODUCT CONTEXT: ${productContext}` : ''}

CHANNEL RULES:
- WhatsApp: Max 1024 chars. Conversational, emoji-friendly, include CTA button text.
- Email: Include subject line (max 60 chars), HTML body with clear CTA.
- SMS: Max 160 chars. Urgent, clear CTA with short URL placeholder.
- Push: Title (max 50 chars) + body (max 100 chars). Action-driven.

Use personalization variables: {{first_name}}, {{country}}, {{bookings}}

Return JSON: { "subject": "...", "body": "...", "ctaText": "...", "ctaUrl": "https://raynatours.com/..." }`;

    if (apiKey) {
      try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1024,
            messages: [{ role: 'user', content: prompt }],
          }),
        });

        const data = await response.json();
        const text = data.content?.[0]?.text || '';

        // Parse JSON from response
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return { ...parsed, aiGenerated: true, aiModel: 'claude-sonnet-4-20250514', aiPrompt: prompt };
        }
      } catch (err) {
        console.error('AI generation failed, falling back to templates:', err.message);
      }
    }

    // Fallback: rule-based content templates
    return AIService._generateFallbackContent(channel, segmentLabel, segmentCtx, tone);
  }

  /** Rule-based fallback content generation */
  static _generateFallbackContent(channel, segmentLabel, ctx, tone) {
    const templates = {
      whatsapp: {
        'High Value': {
          body: `Hi {{first_name}}! 🌟\n\nAs one of our valued guests, we have an exclusive offer just for you!\n\nBook any premium Dubai experience and get 15% off with code VIP15.\n\nDesert Safari, Yacht Cruise, Helicopter Tour — you name it!\n\nTap below to explore 👇`,
          ctaText: 'Explore VIP Offers',
        },
        'Dormant': {
          body: `Hey {{first_name}}! 👋\n\nIt's been a while since your last adventure with us. We miss you!\n\nDubai has so much more to offer — and we have a special 20% comeback discount waiting for you.\n\nValid for 48 hours only! ⏰`,
          ctaText: 'Claim My Discount',
        },
        'New Lead': {
          body: `Welcome {{first_name}}! 🎉\n\nThanks for your interest in Rayna Tours!\n\nHere are our top 3 experiences:\n1. 🏜 Desert Safari — from $49\n2. 🚤 Marina Yacht Cruise — from $79\n3. 🏙 Burj Khalifa + City Tour — from $59\n\nReady to explore Dubai?`,
          ctaText: 'Browse Tours',
        },
        _default: {
          body: `Hi {{first_name}}! 🌴\n\nDiscover amazing Dubai experiences with Rayna Tours.\n\nFrom desert safaris to yacht cruises, we have something for everyone!\n\nBook now and save up to 25%!`,
          ctaText: 'Book Now',
        },
      },
      email: {
        'High Value': {
          subject: 'Your Exclusive VIP Offer Inside, {{first_name}} ✨',
          body: `<h2>Hello {{first_name}},</h2><p>As one of our most valued guests with <strong>{{bookings}} bookings</strong>, you deserve something special.</p><p>We're offering you an <strong>exclusive 15% discount</strong> on our premium experiences:</p><ul><li>Private Desert Safari</li><li>Luxury Yacht Charter</li><li>Helicopter City Tour</li></ul><p>Use code <strong>VIP15</strong> at checkout.</p>`,
          ctaText: 'Claim Your VIP Discount',
        },
        _default: {
          subject: 'Dubai Awaits You, {{first_name}}!',
          body: `<h2>Hi {{first_name}},</h2><p>Looking for your next adventure? Rayna Tours offers the best Dubai experiences at unbeatable prices.</p><p>From <strong>$49</strong>, explore desert safaris, yacht cruises, city tours, and more.</p><p>Book today and save up to 25%!</p>`,
          ctaText: 'Explore Tours',
        },
      },
      sms: {
        'High Value': { body: '{{first_name}}, VIP offer: 15% off premium Dubai tours! Code: VIP15. Book: raynatours.com/vip' },
        'Dormant': { body: '{{first_name}}, we miss you! Come back & save 20% on Dubai tours. 48hrs only: raynatours.com/comeback' },
        _default: { body: '{{first_name}}, explore Dubai from $49! Desert safaris, yacht cruises & more. Book: raynatours.com' },
      },
      push: {
        'High Value': { subject: '🌟 VIP Offer Just For You', body: '{{first_name}}, get 15% off premium Dubai experiences!', ctaText: 'View Offer' },
        'Dormant': { subject: '👋 We Miss You!', body: '20% comeback discount waiting — 48hrs only!', ctaText: 'Claim Now' },
        _default: { subject: '🏜 Dubai Adventures Await', body: 'Desert safaris from $49. Book your next adventure!', ctaText: 'Explore' },
      },
    };

    const channelTemplates = templates[channel] || templates.email;
    const content = channelTemplates[segmentLabel] || channelTemplates._default;

    return {
      subject: content.subject || null,
      body: content.body,
      ctaText: content.ctaText || 'Learn More',
      ctaUrl: 'https://raynatours.com',
      aiGenerated: false,
      aiModel: 'rule-based',
    };
  }

  /** Analyze strategy performance and generate optimization suggestions */
  static async optimizeStrategy(strategyId) {
    // Get strategy + campaign performance
    const { rows: [strategy] } = await query(`
      SELECT s.*,
        (SELECT json_agg(json_build_object(
          'id', c.id, 'channel', c.channel, 'sent', c.sent_count, 'delivered', c.delivered_count,
          'read', c.read_count, 'clicked', c.clicked_count, 'bounced', c.bounced_count
        )) FROM campaigns c WHERE c.strategy_id = s.id AND c.status = 'completed') AS campaign_results
      FROM omnichannel_strategies s WHERE s.id = $1
    `, [strategyId]);

    if (!strategy) return null;

    const campaigns = strategy.campaign_results || [];
    const suggestions = [];

    // Rule-based optimization
    for (const camp of campaigns) {
      if (!camp || camp.sent === 0) continue;

      const deliveryRate = camp.delivered / camp.sent;
      const openRate = camp.delivered > 0 ? camp.read / camp.delivered : 0;
      const clickRate = camp.delivered > 0 ? camp.clicked / camp.delivered : 0;
      const bounceRate = camp.bounced / camp.sent;

      if (bounceRate > 0.05) {
        suggestions.push({
          type: 'content_change',
          channel: camp.channel,
          severity: 'high',
          message: `High bounce rate (${(bounceRate * 100).toFixed(1)}%) on ${camp.channel}. Clean your contact list and verify email addresses.`,
          confidence: 0.9,
        });
      }

      if (deliveryRate < 0.9) {
        suggestions.push({
          type: 'channel_change',
          channel: camp.channel,
          severity: 'medium',
          message: `Low delivery rate (${(deliveryRate * 100).toFixed(1)}%) on ${camp.channel}. Consider switching to WhatsApp for better deliverability.`,
          confidence: 0.75,
        });
      }

      if (openRate < 0.15 && camp.channel === 'email') {
        suggestions.push({
          type: 'content_change',
          channel: 'email',
          severity: 'high',
          message: `Low open rate (${(openRate * 100).toFixed(1)}%). Try A/B testing subject lines with personalization and urgency.`,
          confidence: 0.8,
        });
      }

      if (clickRate < 0.02) {
        suggestions.push({
          type: 'content_change',
          channel: camp.channel,
          severity: 'medium',
          message: `Low click rate (${(clickRate * 100).toFixed(1)}%). Improve CTA placement and copy. Use action-oriented language.`,
          confidence: 0.7,
        });
      }
    }

    // Flow optimization
    const flowSteps = strategy.flow_steps || [];
    if (flowSteps.length === 1) {
      suggestions.push({
        type: 'flow_change',
        severity: 'medium',
        message: 'Single-step flow detected. Add a follow-up message on Day 3 via a different channel for better conversion.',
        confidence: 0.7,
      });
    }

    // Score the strategy
    const avgScore = suggestions.length > 0
      ? Math.max(0, 100 - suggestions.length * 15)
      : 85;

    // Save suggestions
    await query(`
      UPDATE omnichannel_strategies
      SET ai_score = $2, ai_last_review = NOW(), ai_suggestions = $3::jsonb
      WHERE id = $1
    `, [strategyId, avgScore, JSON.stringify(suggestions)]);

    // Log optimization
    for (const s of suggestions) {
      await query(`
        INSERT INTO ai_optimization_log (strategy_id, suggestion_type, suggestion, reasoning, confidence)
        VALUES ($1, $2, $3::jsonb, $4, $5)
      `, [strategyId, s.type, JSON.stringify(s), s.message, s.confidence]);
    }

    return { strategyId, score: avgScore, suggestions };
  }
}
