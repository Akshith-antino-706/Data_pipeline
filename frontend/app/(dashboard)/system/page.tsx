'use client';

import { useId, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import s from './page.module.css';
import {
  Database, ArrowRight, Users, GitBranch, Mail, MessageCircle, Globe, Target,
  Plane, Hotel, Ticket, RefreshCw, Clock, ChevronDown, ChevronUp, DollarSign,
  Megaphone, FileText, Link2, Code, Activity, Layers, Shield, Zap, AlertTriangle,
  CheckCircle, Info,
} from 'lucide-react';

interface SectionProps {
  title: string;
  icon: LucideIcon;
  defaultOpen?: boolean;
  children?: React.ReactNode;
}

function Section({ title, icon: Icon, defaultOpen, children }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen || false);
  const bodyId = useId();
  return (
    <section className={s.section}>
      <button type="button" className={s.toggle} aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(o => !o)}>
        <span className={s.toggleMain}>
          <span className={s.iconTile} aria-hidden><Icon size={16} /></span>
          <span className={s.title}>{title}</span>
        </span>
        {open ? <ChevronUp size={16} className={s.chev} aria-hidden /> : <ChevronDown size={16} className={s.chev} aria-hidden />}
      </button>
      {open && <div id={bodyId} className={s.body}>{children}</div>}
    </section>
  );
}

interface TblProps {
  headers: string[];
  rows: React.ReactNode[][];
}

function Tbl({ headers, rows }: TblProps) {
  return (
    <div className={s.tbl}>
      <table className="ui-table">
        <thead>
          <tr>{headers.map(h => <th key={h}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface FlowStep {
  label: string;
}

function Flow({ steps }: { steps: FlowStep[] }) {
  return (
    <div className={s.flow}>
      {steps.map((step, i) => (
        <span key={i} className={s.flowItem}>
          <span className={s.step}>{step.label}</span>
          {i < steps.length - 1 && <ArrowRight size={14} className={s.arrow} aria-hidden />}
        </span>
      ))}
    </div>
  );
}

function M({ children }: { children?: React.ReactNode }) {
  return <code className={s.code}>{children}</code>;
}

type CalloutType = 'info' | 'warning' | 'success';

function Callout({ type, children }: { type: CalloutType; children?: React.ReactNode }) {
  const Icon = type === 'warning' ? AlertTriangle : type === 'success' ? CheckCircle : Info;
  return (
    <div className={`${s.callout} ${s[type]}`}>
      <Icon size={16} aria-hidden />
      <div className={s.calloutText}>{children}</div>
    </div>
  );
}

export default function SystemArchitecture() {
  return (
    <div className={s.page}>
      <PageHeader
        title="System Architecture & Documentation"
        description="How the Rayna Tours marketing data pipeline works, end to end: where data comes from, how contacts are unified and segmented, how journeys send messages, what runs when, and how it is deployed. Written against the code as of 23 Oct 2026. New to the project? Read sections 1–6 in order."
      />

      {/* ══════════════════════════════════════════════════════════ */}
      <Section title="1. System Overview — What This Platform Does" icon={Layers} defaultOpen={true}>
        <p>This is an <strong>omnichannel marketing automation platform</strong> for Rayna Tours. It does five things:</p>
        <ol style={{ paddingLeft: 20 }}>
          <li><strong>Brings data in</strong> from the Rayna Billing API, phpAdmin (MySQL contacts and WhatsApp chats), the registration-data API, Google Tag Manager / GA4 (BigQuery) and the product feed.</li>
          <li><strong>Unifies every person</strong> into one row in <M>unified_contacts</M> by matching phone numbers and emails across all sources.</li>
          <li><strong>Segments contacts</strong> by booking status, product tier and geography, plus custom segments you define in the UI.</li>
          <li><strong>Runs journeys</strong> — multi-step email / WhatsApp / SMS flows, either from a segment (fixed) or in real time from website and giveaway events (continuous).</li>
          <li><strong>Measures what happened</strong> — opens, clicks, deliveries, failures, unsubscribes, website visits via UTM links, and real bookings.</li>
        </ol>

        <p><strong>The daily loop:</strong></p>
        <Flow steps={[
          { label: 'Nightly syncs pull data' },
          { label: 'Contacts unified' },
          { label: 'Segments refreshed' },
          { label: 'Journeys board people' },
          { label: 'Queues send messages' },
          { label: 'Tracking records results' },
          { label: 'Dashboards read rollups' },
        ]} />

        <h4 style={{ marginTop: 20 }}>1.1 The stack</h4>
        <Tbl headers={['Layer', 'Technology', 'Notes']} rows={[
          ['Backend', 'Node 20, Express 5, TypeScript (strict, no any), run with tsx', <><M>backend/server.ts</M> registers routes, middleware and every cron</>],
          ['Frontend', 'Next.js 15 (App Router), React 19, TypeScript, React Query, Tailwind v4 tokens', <><M>frontend/app/(dashboard)/*</M>, shared UI in <M>components/ui</M></>],
          ['Database', 'PostgreSQL on Amazon RDS', '~1.7M unified contacts, ~75M email send-log rows; migrations 001–119'],
          ['Queues', 'Redis + BullMQ (6 queues)', 'journey-email, journey-wa, journey-sms, journey-rcs, welcome-email, gtm-journey'],
          ['Events', 'RabbitMQ (CloudAMQP)', 'Giveaway / affiliate events consumed by a separate process'],
          ['Email', 'SMTP (Amazon SES) or SendGrid, per-journey credentials', 'SES delivery/bounce/complaint events arrive on a signed SNS webhook'],
          ['WhatsApp', 'ChatHead (broadcast API) — Gupshup as fallback', 'Delivery counters polled from ChatHead every 15 min'],
          ['SMS / RCS', 'Gupshup (DLT-registered templates for India)', 'Template must be approved before a send'],
          ['AI', 'Claude (Anthropic SDK)', 'Daily template rendering, product rankings, recommendations, Email QA'],
          ['Hosting', 'One EC2 host running Docker Compose', 'redis, backend, giveaway-consumer, frontend — deployed by GitHub Actions on push to main'],
        ]} />

        <Callout type="info">
          <strong>Audience switcher (All / B2C / B2B / Affiliate):</strong> the control in the top bar sets <M>businessType</M>, which Home, Contacts, Segments, the Status center and most reports pass to the API as a filter. It is remembered in the browser. "All" sends no filter.
        </Callout>
      </Section>

      {/* ══════════════════════════════════════════════════════════ */}
      <Section title="2. Data Sources — Where Data Comes From" icon={Database}>
        <p>Six external sources feed the database. Each has its own job, schedule and conflict rule. Every schedule below is Dubai time.</p>

        <h4 style={{ marginTop: 20 }}>2.1 Rayna Billing API → rayna_* tables (1:00 AM daily)</h4>
        <p><M>DailyBillingSync</M> pulls yesterday's bookings from the Rayna Billing API (<M>RAYNA_BILLING_API_URL</M>, bearer token) and upserts them into six product tables.</p>
        <Tbl headers={['Table', 'Holds', 'Linked to a contact by']} rows={[
          ['rayna_tours', 'Tour and activity bookings', 'unified_id (set when the contact is matched)'],
          ['rayna_hotels', 'Hotel bookings', 'unified_id'],
          ['rayna_visas', 'Visa applications', 'unified_id'],
          ['rayna_flights', 'Flight tickets', 'unified_id'],
          ['rayna_packages', 'Holiday packages', 'unified_id'],
          ['rayna_others', 'Everything else on a bill', 'unified_id'],
        ]} />
        <ol style={{ paddingLeft: 20 }}>
          <li>Fetch yesterday's records from the API.</li>
          <li>Upsert into the six tables (existing bills are refreshed, so cancellations and price changes come through — <M>is_cancel</M> is respected everywhere revenue is summed).</li>
          <li>Incremental <M>unified_contacts</M> update: new people are created, existing ones get booking counts and revenue refreshed.</li>
          <li>Snapshot today's segment counts into <M>segment_daily_log</M>.</li>
          <li>Clear the dashboard caches.</li>
        </ol>
        <Callout type="warning">
          The job retries 3 times, 10 minutes apart, and the whole pipeline re-runs on retry (steps are idempotent). It does <strong>not</strong> write to <M>sync_metadata</M> — the six <M>rayna_*</M> rows there are frozen at a May-2026 error from a retired sync and are ignored by the UI. Freshness for this feed is read from the tables themselves (<M>MAX(created_at)</M>), shown on the Status center as "Last data received".
        </Callout>

        <h4 style={{ marginTop: 20 }}>2.2 phpAdmin MySQL → Postgres</h4>
        <p>Two MySQL servers (<M>MYSQL_*</M> = contacts/CRM, <M>MYSQL2_*</M> = WhatsApp chats). All of these syncs are <strong>incremental by timestamp</strong> — they only read rows newer than the last successful run, using a watermark stored in <M>sync_metadata</M>.</p>
        <Tbl headers={['Job', 'When', 'Service', 'What it does']} rows={[
          ['Chats sync', '3:30 AM daily', 'ChatsSyncService', 'Insert-only pull of new WhatsApp chats into chats, then backfills unified_id'],
          ['Email unsubscribe sync', '2:00 AM daily', 'UnsubscribeSyncService', 'Copies the unsubscribe list into unified_contacts.email_unsubscribe (never re-subscribes someone who opted out on our side)'],
          ['WhatsApp unsubscribe sync', '2:15 AM daily', 'WhatsAppUnsubscribeSyncService', 'Same for WhatsApp opt-outs'],
          ['phpAdmin contacts sync', 'Sunday 5:00 AM', 'PhpAdminWeeklySync', 'New CRM contacts into unified_contacts'],
          ['Chat leads (read live)', 'On request', 'routes/chatLeads', 'Department / agent lead figures for the Leads page are read straight from MySQL (cached)'],
        ]} />

        <h4 style={{ marginTop: 20 }}>2.3 Registration-data API (12:30 AM daily)</h4>
        <p>The last 7 days of affiliate, guest-user and agent sign-ups are upserted into <M>affiliate_data</M>, <M>guestuser_data</M> and <M>agent_data</M>, then <M>RegistrationContactSync</M> links each registration to a contact (creating one if needed) with <M>contact_type</M> Affiliate, B2B or B2C.</p>

        <h4 style={{ marginTop: 20 }}>2.4 Website events — GTM (real time) and GA4 (BigQuery)</h4>
        <p>The tracking snippet from <M>GET /api/v3/gtm/snippet</M> posts events to <M>POST /api/v3/gtm/events</M> as they happen (page views, cart, checkout, purchase, form submits). They land in <M>gtm_events</M> with the raw payload as JSONB. GA4 exports can also be pulled from BigQuery by <M>BigQuerySyncService</M> into <M>ga4_events</M> when <M>BQ_*</M> credentials are set.</p>
        <Callout type="info">
          <strong>How a visitor becomes a known contact:</strong> every link we send carries a per-person token. The click handler redirects to the website with <M>?rid=&lt;unified_id&gt;</M>; the GTM tag includes that <M>rid</M> in every later event, so browsing and purchases are attributed to the right person. Events can also start <strong>continuous journeys</strong> (section 5).
        </Callout>

        <h4 style={{ marginTop: 20 }}>2.5 Product feed (Monday 5:00 AM) and availability check (Monday 6:00 AM)</h4>
        <p>All tours, holidays, cruises and yachts are pulled from the enriched product feed into <M>products</M> (writes <M>sync_metadata.products_enriched_sync</M>). An hour later every product URL is checked and dead ones are marked unavailable so they never appear in recommendations.</p>

        <h4 style={{ marginTop: 20 }}>2.6 ChatHead (WhatsApp)</h4>
        <p>ChatHead is the WhatsApp provider. <M>FirstMessageService</M> fetches the first message of each chat, and <M>WhatsAppDeliverySync</M> polls delivery counters for recent broadcasts every 15 minutes into <M>chathead_broadcasts</M> and <M>whatsapp_send_log</M> (ChatHead has no webhooks).</p>

        <p><strong>Key files:</strong></p>
        <Tbl headers={['File', 'Responsibility']} rows={[
          ['backend/src/services/DailyBillingSync.ts', 'Rayna Billing API → rayna_* → contacts → daily snapshot'],
          ['backend/src/services/ChatsSyncService.ts, UnsubscribeSyncService.ts, WhatsAppUnsubscribeSyncService.ts, PhpAdminWeeklySync.ts', 'MySQL → Postgres syncs'],
          ['backend/src/services/RegistrationContactSync.ts', 'Registration feeds → contacts'],
          ['backend/src/services/GTMService.ts, BigQuerySyncService.ts', 'Website events'],
          ['backend/src/services/ProductService.ts, ProductAffinityService.ts', 'Product catalogue and availability'],
          ['backend/src/services/ChatHeadV1Service.ts, WhatsAppDeliverySync.ts, FirstMessageService.ts', 'WhatsApp provider integration'],
        ]} />
      </Section>

      {/* ══════════════════════════════════════════════════════════ */}
      <Section title="3. Unified Contacts — The Single Source of Truth" icon={Users}>
        <p><M>unified_contacts</M> is the central table: one row per person across bookings, chats, registrations and website events. Everything else (segments, journeys, send logs, revenue) hangs off its <M>id</M>.</p>

        <h4 style={{ marginTop: 20 }}>3.1 Identity keys</h4>
        <ul style={{ paddingLeft: 20 }}>
          <li><strong>phone_key:</strong> digits only, last 10 digits. <M>+971-50-123-4567</M> → <M>0501234567</M>. Numbers with fewer than 7 digits, all zeros, or junk values (<M>0</M>, <M>NA</M>, <M>N/A</M>) are rejected.</li>
          <li><strong>email_key:</strong> lower-cased, trimmed. <M>John@Example.com </M> → <M>john@example.com</M>.</li>
        </ul>
        <p>Matching tries phone first, then email (bookings), or email first, then phone (website events). A person is created only when neither key already exists.</p>

        <h4 style={{ marginTop: 20 }}>3.2 Two ways the table is updated</h4>
        <Tbl headers={['Path', 'When', 'Scope', 'Service']} rows={[
          ['Incremental (normal)', 'Every night inside the 1 AM billing sync, plus the registration and phpAdmin syncs', 'Only new or changed people; never deletes', 'DailyBillingSync.incrementalContactUpdate, RegistrationContactSync, PhpAdminWeeklySync'],
          ['Full rebuild (manual)', 'POST /api/v3/rayna-sync/rebuild-contacts, or after a bulk ingest', 'Rebuilds the whole table from the raw tables', 'UnifiedContactBuilder.rebuild'],
        ]} />
        <Callout type="warning">
          <strong>The full rebuild truncates and re-creates the table.</strong> Never run it on production during the day, and never while journeys are sending. The audit lists removing or locking these rebuild endpoints as a priority.
        </Callout>

        <h4 style={{ marginTop: 20 }}>3.3 UnifiedContactSync.run() — the 14 steps, in order</h4>
        <Tbl headers={['#', 'Step', 'What it does']} rows={[
          ['1', 'refreshChatContacts', 'Aggregate raw chats by WhatsApp id into chat_contacts (totals, first/last chat)'],
          ['2', 'syncNewContacts', 'Insert new CRM contacts by email_key (never overwrites an existing person)'],
          ['3', 'syncChats', 'Insert chat-only people by phone_key, then refresh chat counts on existing ones'],
          ['4', 'syncRaynaBookings', 'Refresh booking counts, dates and revenue from the six rayna_* tables'],
          ['5', 'syncNewRaynaContacts', 'Create people who booked but had no contact yet'],
          ['6', 'syncCRMBookings', 'Booking columns that come from the CRM'],
          ['7', 'syncUnsubscribed', 'Apply email opt-outs'],
          ['8', 'syncGA4GTM', 'Link website events to people and update event counts'],
          ['9', 'syncNewGTMContacts', 'Create people first seen on the website (email or phone captured)'],
          ['10', 'relinkRawTables', 'Stamp the new unified_id back onto chats, rayna_* and event rows'],
          ['11', 'syncRaynaContactsToUsers', 'Keep the users view in step with contacts'],
          ['12', 'computeSegments', 'booking_status, product_tier, geography, is_indian, segment label'],
          ['13', 'computeOccasions', 'Enter / exit people for upcoming holidays by country'],
          ['14', 'classifyUserContactTypes', 'B2C / B2B / Affiliate from departments and registrations'],
        ]} />

        <h4 style={{ marginTop: 20 }}>3.4 Other columns kept fresh by crons</h4>
        <Tbl headers={['Columns', 'Job', 'When']} rows={[
          ['email validity, formatted mobile, country from code', 'ContactEnrichmentService', '1:30 AM daily'],
          ['market_plan, currency_code', 'Contact market/currency refresh (utils/marketPlan)', '5:45 AM daily, after the 5:30 AM FX refresh'],
          ['is_on_trip and travel-date based flags', 'Segmentation snapshot refresh', '2:00 AM daily'],
          ['email_unsubscribe, wa_unsubscribe', 'Unsubscribe syncs + the public unsubscribe page', '2:00 / 2:15 AM, and instantly on click'],
          ['top 3 services / products (user_affinity_top3)', 'BookingAffinityService.build', '4:30 AM daily'],
        ]} />

        <p><strong>Key files:</strong> <M>backend/src/services/UnifiedContactSync.ts</M> (the 14 steps), <M>UnifiedContactService.ts</M> (every read the UI makes: list, detail, stats, segmentation tree), <M>UnifiedContactBuilder.ts</M> (full rebuild), <M>ContactEnrichmentService.ts</M>.</p>
      </Section>

      {/* ══════════════════════════════════════════════════════════ */}
      <Section title="4. Segmentation — Booking Status, Tier, Geography and Custom Segments" icon={Target}>
        <p>Every contact carries a computed label made of three parts. The first matching booking status wins; tier and geography are evaluated independently.</p>

        <h4 style={{ marginTop: 20 }}>4.1 Booking status (priority order)</h4>
        <Tbl headers={['Priority', 'Status', 'Rule', 'Plain meaning']} rows={[
          ['1', 'ON_TRIP', 'A tour date, hotel check-in or flight is within today … +7 days', 'In Dubai right now'],
          ['2', 'FUTURE_TRAVEL', 'Any booking dated after today', 'Booked, not travelled yet'],
          ['3', 'ACTIVE_ENQUIRY', 'Chatted on WhatsApp in the last 30 days and never booked', 'Asking, hasn\'t bought'],
          ['4', 'PAST_BOOKING', 'Has at least one past booking', 'Travelled before — cross-sell'],
          ['5', 'PAST_ENQUIRY', 'Chatted 30+ days ago and never booked', 'Went cold — win-back'],
          ['6', 'PROSPECT', 'None of the above', 'Known contact, never engaged'],
        ]} />
        <Callout type="warning">
          <strong>+7 days is an assumption.</strong> The booking data has no check-out or trip-end date, so every trip is treated as 7 days long for ON_TRIP.
        </Callout>

        <h4 style={{ marginTop: 20 }}>4.2 Product tier and geography</h4>
        <ul style={{ paddingLeft: 20 }}>
          <li><strong>LUXURY</strong> if any booking name contains premium, private, vip, yacht, helicopter, limousine, luxury, megayacht, falcon or chauffeur; otherwise <strong>STANDARD</strong>; no tier without bookings.</li>
          <li><strong>LOCAL</strong> = United Arab Emirates, <strong>INTERNATIONAL</strong> = any other country. <strong>is_indian</strong> is an overlay (phone starts with 91, country or nationality India) used for channel choice and pricing.</li>
          <li><strong>market_plan / currency_code</strong> (INR, SAR, USD, AED) are derived from country + is_indian and drive the prices shown in emails (FX rates refreshed daily at 5:30 AM into <M>fx_rates</M>).</li>
        </ul>

        <h4 style={{ marginTop: 20 }}>4.3 Audiences (contact_type)</h4>
        <p>B2C (travellers), B2B (agents and partners) and Affiliate are set from registration feeds, departments (<M>department_groups</M>) and chats. Every list, chart and journey audience can be filtered by this.</p>

        <h4 style={{ marginTop: 20 }}>4.4 Custom segments</h4>
        <p>The Segments page lets you build your own segments from conditions (country, status, booking dates, channels, custom fields…). <M>CustomSegmentService</M> turns the conditions into parameterised SQL — values are never interpolated. Custom segments have a status, a live count, and can be the audience of a journey.</p>

        <h4 style={{ marginTop: 20 }}>4.5 Snapshots and history</h4>
        <Tbl headers={['Table', 'Written by', 'Used for']} rows={[
          ['segment_daily_log', 'Daily billing sync (step 4)', 'Segment changes page: entered / exited / converted per day'],
          ['segmentation_tree_snapshot', 'Snapshot refresh, 2:00 AM (B2C → B2B → All, sequentially)', 'Home and Segments pages read the snapshot instead of scanning 1.7M rows'],
          ['user_segment_revenue', 'Nightly', 'Revenue per segment (cancelled bills excluded)'],
        ]} />
        <p><strong>Key files:</strong> <M>UnifiedContactSync.computeSegments</M>, <M>SegmentEngine.ts</M>, <M>CustomSegmentService.ts</M>, <M>UnifiedContactService.refreshSegmentationSnapshot</M>.</p>
      </Section>

      {/* ══════════════════════════════════════════════════════════ */}
      <Section title="5. Journeys — Fixed, Continuous and Giveaway" icon={GitBranch}>
        <p>A journey is a graph of nodes (who joins → send → wait → branch → finish). There are three ways people enter, and two tables that hold them.</p>

        <Tbl headers={['Kind', 'Who joins', 'Entries table', 'Engine', 'Example']} rows={[
          ['Fixed (segment)', 'Everyone in a segment / custom segment at start, snapshotted once (modes: full, sample, test_users)', 'journey_entries', 'Journey Engine every 5 min; new eligible people boarded daily at 4:00 AM', 'Past-booking cross-sell, 7-day welcome series'],
          ['Continuous (GTM / event)', 'One person at a time, the moment a website event matches the trigger', 'gtm_journey_entries', 'Continuous engine every 1 min fires due per-person steps', 'Abandoned cart, visa page visit'],
          ['Giveaway / Affiliate', 'Events from RabbitMQ (giveaway sign-ups, affiliate events)', 'gtm_journey_entries', 'giveaway-consumer process (separate container), then the continuous engine', 'Giveaway thank-you flow'],
        ]} />
        <Callout type="info">
          <strong>Counting people:</strong> "Joined", "Sending today" and the People tab read <em>both</em> entry tables. A GTM journey with 0 in <M>journey_entries</M> is not empty — look in <M>gtm_journey_entries</M>.
        </Callout>

        <h4 style={{ marginTop: 20 }}>5.1 Node types</h4>
        <Tbl headers={['Type', 'Does', 'Key fields']} rows={[
          ['trigger', 'Entry point: segment, custom segment, GTM event or giveaway source; optional scheduled start and from-date', 'triggerType, segmentLabel, triggerEvent, scheduled_start_at'],
          ['action', 'Send a message on one channel using a template', 'channel (email / whatsapp / sms / rcs / both), templateId, credential'],
          ['wait', 'Pause N days (JOURNEY_WAIT_SECS_PER_DAY shortens this for testing)', 'waitDays'],
          ['condition', 'Yes / No branch on real data: booked, clicked, opened', 'condition'],
          ['gtm', 'Wait for a specific website event before continuing', 'eventName'],
          ['goal', 'Marks the entry completed', '—'],
        ]} />

        <h4 style={{ marginTop: 20 }}>5.2 How a send actually happens</h4>
        <ol style={{ paddingLeft: 20 }}>
          <li>The engine claims due entries with <M>FOR UPDATE SKIP LOCKED</M> so two workers never take the same person.</li>
          <li>Each action becomes a BullMQ job (queue per channel) with a deterministic <M>jobId</M>, so a retry can't double-send.</li>
          <li>The worker renders the template for that person (variables, recommendations, prices in their currency), checks the unsubscribe flags and the completeness guard (missing data → row in <M>journey_skip_log</M>, nothing sent).</li>
          <li>Email goes through the journey's SMTP credential; WhatsApp through ChatHead broadcast (Gupshup fallback); SMS / RCS through Gupshup after <M>assertApproved</M>.</li>
          <li>The result is written to <M>email_send_log</M> / <M>whatsapp_send_log</M> / <M>sms_send_log</M> and a <M>journey_events</M> row; the entry moves to the next node or <M>next_fire_at</M>.</li>
          <li>Exits: conversion (booking after entry), unsubscribe, segment changed, goal reached, or manual stop.</li>
        </ol>
        <Callout type="warning">
          <strong>Rate limits:</strong> <M>JOURNEY_EMAIL_CONCURRENCY</M>, <M>JOURNEY_EMAIL_RATE_MAX</M> / <M>_WINDOW</M> cap outbound email. The Redis that holds these queues must never evict (compose sets <M>noeviction</M>) — losing it loses queued sends.
        </Callout>

        <h4 style={{ marginTop: 20 }}>5.3 Pages</h4>
        <Tbl headers={['Route', 'What it is']} rows={[
          ['/journeys', 'List with status, joined count and sending-today figures'],
          ['/journeys/new', 'Create wizard: What is this journey for? → who joins → flow builder (nothing is created until Save)'],
          ['/journeys/[id]', 'Flow (first tab), Testing, People (loaded on click), Settings; old ?id= links redirect here'],
          ['/journeys/analytics', 'Performance: per-journey and per-node figures from journey_node_stats, server-paged, default last 7 days'],
          ['/journeys/dashboard', 'Journey monitor: queue and engine health'],
        ]} />
        <p><strong>Key files:</strong> <M>JourneyService.ts</M> (fixed journeys, entries, timeline, conversions), <M>ContinuousJourneyService.ts</M> and <M>GtmJourneyService.ts</M> (event journeys), <M>GiveawayJourneyService.ts</M> + <M>src/giveaway-consumer.ts</M>, <M>services/queue/index.ts</M> and <M>workers.ts</M>, <M>SkipLogService.ts</M>.</p>
      </Section>

      {/* ══════════════════════════════════════════════════════════ */}
      <Section title="6. Channels — Email, WhatsApp, SMS/RCS and Tracking" icon={Mail}>
        <h4>6.1 Email</h4>
        <ul style={{ paddingLeft: 20 }}>
          <li><strong>Provider:</strong> SMTP by default (<M>SMTP_*</M>, Amazon SES), SendGrid if <M>EMAIL_PROVIDER=sendgrid</M>. Journeys can carry their own credential (<M>journey_email_credential</M>), and giveaways use <M>GIVEAWAY_SMTP_*</M>.</li>
          <li><strong>Tracking:</strong> an open pixel and rewritten links record opens and clicks in <M>email_send_log</M> with user agent and IP; UTM links add website visits.</li>
          <li><strong>SES events:</strong> <M>POST /api/webhooks/ses</M> receives SNS notifications (signature verified) for deliveries, bounces and complaints into <M>ses_events</M>; bounces and complaints flag the contact.</li>
          <li><strong>Unsubscribe:</strong> every email carries a signed link to <M>/api/unsubscribe</M>; confirming sets <M>email_unsubscribe</M>, records a reason in <M>unsubscribe_log</M>, and the nightly MySQL sync can never undo it. A "change email" form is on the same page.</li>
          <li><strong>Welcome email:</strong> a GTM sign-up event can trigger an immediate welcome (<M>WELCOME_ENABLED</M>, <M>WELCOME_DELAY_MIN</M>) via the welcome-email queue.</li>
        </ul>

        <h4 style={{ marginTop: 20 }}>6.2 WhatsApp</h4>
        <ul style={{ paddingLeft: 20 }}>
          <li><strong>ChatHead</strong> is the live provider: a journey action with a ChatHead channel + template fires a broadcast; delivery counters are polled every 15 minutes into <M>whatsapp_send_log</M> / <M>whatsapp_delivery_stats</M>.</li>
          <li><strong>Gupshup</strong> is the fallback per-message API (simulated when its keys are missing). Templates must be approved by Meta first — see section 7.</li>
          <li>WhatsApp opt-outs are synced nightly and respected at send time.</li>
        </ul>

        <h4 style={{ marginTop: 20 }}>6.3 SMS and RCS (Gupshup)</h4>
        <p>SMS to Indian numbers needs DLT registration: sender id (<M>GUPSHUP_SMS_SENDER_ID</M>) and a per-template DLT content id stored on the template. RCS uses <M>GUPSHUP_RCS_*</M> with SMS fallback. Both call <M>GupshupService.assertApproved</M> before sending; results go to <M>sms_send_log</M>.</p>

        <h4 style={{ marginTop: 20 }}>6.4 What gets logged, and where to look</h4>
        <Tbl headers={['Question', 'Page', 'Backed by']} rows={[
          ['Did this person get the email? Was it opened / clicked / failed?', 'Message log (/log), filter by email, journey and node', 'email_send_log (created_at is used so failed sends appear)'],
          ['How many went out in the last 14 days per channel?', 'Home', 'daily_send_counts (filled nightly at 12:45 AM) — no live scan of the 75M-row log'],
          ['What failed in the last 24 hours?', 'Status center', 'email_send_log, whatsapp_send_log, sms_send_log'],
          ['Why was someone skipped?', 'Journey → People, Message log', 'journey_skip_log'],
          ['Per-node opens, clicks, unsubscribes, failures', 'Performance (/journeys/analytics)', 'journey_node_stats rollup, refreshed every 30 min'],
        ]} />
      </Section>

      {/* ══════════════════════════════════════════════════════════ */}
      <Section title="7. Templates, AI Content and Approvals" icon={FileText}>
        <h4>7.1 Templates (/content)</h4>
        <p>Templates live in <M>content_templates</M> (channel, subject, body, variables). The Templates page lists them by channel and status, previews them in a sandboxed frame, and <M>/content/new</M> and <M>/content/[id]</M> create and edit. Production email layouts are managed as <M>base_templates</M> (<M>BaseTemplateService</M>); win-back emails J01–J22 are Liquid templates rendered by <M>LiquidRenderer</M>.</p>

        <h4 style={{ marginTop: 20 }}>7.2 The 7-day series and daily AI rendering</h4>
        <p>Seven daily emails (Welcome, Cruise, Visa, Holidays, Activities, Destination, Abandoned cart) each have a Data service (collects facts), a Ranking service (Claude picks the best items) and a Renderer. At <strong>3:00 AM</strong> all seven are re-rendered from fresh data into <M>daily_ai_templates</M>, before the journey engine starts the day's sends. Rankings are cached for an hour so Claude is called once per batch, not once per email.</p>

        <h4 style={{ marginTop: 20 }}>7.3 Recommendations pipeline (nightly)</h4>
        <Tbl headers={['Time', 'Job', 'Writes', 'Feeds']} rows={[
          ['3:35 AM', 'AI recommendation compute', 'user_product_recommendations (5 picks per person for on-trip / future-trip / past-trip)', 'Recommendation journeys'],
          ['3:45 AM', 'Category picks', 'daily_category_picks (top 5 per category; 3 Claude calls)', 'Past-trip recommendations'],
          ['4:00 AM', 'Past-trip compute', 'Per PAST_BOOKING person, pure SQL (~15–20 min)', 'Past-trip emails'],
          ['4:30 AM', 'Booking affinity', 'user_affinity_top3 (top 3 services and products per person)', 'Booking interests page, profiles, template variables'],
          ['2:30 AM', 'Per-user re-enrolment', 'journey_entries (ON CONFLICT DO NOTHING)', 'Recommendation journeys pick up newly eligible people'],
        ]} />

        <h4 style={{ marginTop: 20 }}>7.4 Email QA (3:30 AM)</h4>
        <p><M>EmailQAService</M> scans every template attached to a journey node (broken links, missing variables, image problems, spam triggers) into <M>email_qa_reports</M>, one row per template, refreshed daily. The report is the eye button on the Performance page.</p>

        <h4 style={{ marginTop: 20 }}>7.5 WhatsApp and SMS approval states (Gupshup)</h4>
        <Tbl headers={['external_status', 'Meaning', 'Sendable?']} rows={[
          ['not_submitted', 'Exists locally only', 'No'],
          ['pending', 'Submitted, waiting for Meta (WA) or DLT (SMS)', 'No'],
          ['approved', 'Cleared', 'Yes'],
          ['rejected / paused / disabled / error', 'Provider blocked it (reason stored on the template)', 'No'],
        ]} />
        <p>Every transition writes <M>template_approval_events</M>. Status updates arrive on <M>POST /api/v3/gupshup/webhook/wa</M> (optionally gated by <M>GUPSHUP_WEBHOOK_SECRET</M>) or by polling <M>check-status</M>. A blocked send logs <M>action_blocked</M> and is retried on a later cycle once approved — never sent as raw text.</p>
      </Section>

      {/* ══════════════════════════════════════════════════════════ */}
      <Section title="8. Conversions and Analytics — How We Know It Worked" icon={Zap}>
        <h4>8.1 Three signals</h4>
        <Tbl headers={['Signal', 'Source', 'Strength']} rows={[
          ['Click on our link', 'user_utm_links / utm_visits', 'Interest'],
          ['Website event', 'gtm_events (begin_checkout, purchase)', 'Strong intent'],
          ['Real booking', 'rayna_* bill dated after the person entered the journey, is_cancel <> 1', 'Definitive — this is what "converted" means'],
        ]} />
        <p><M>ConversionDetector.runAll()</M> and the journey engine check these per entry, with a per-contact conversion window, and exit converted people so they stop receiving the flow. Giveaway / GTM entries that purchased are shown as converted too.</p>

        <h4 style={{ marginTop: 20 }}>8.2 Where the dashboard numbers come from</h4>
        <Tbl headers={['Page', 'API', 'How it stays fast']} rows={[
          ['Home', '/api/v3/overview/home and /home/:section', 'Each card is its own request with a cache, a timeout and background completion; the 14-day chart reads daily_send_counts'],
          ['Performance', '/api/v3/overview/insights, /journeys/analytics/table', 'Insights computed in one scan and cached; the table is paged on the server from journey_node_stats'],
          ['Status center', '/api/v3/overview/status, /rayna-sync/mapping-stats', 'Status polls every 30 s; mapping-stats runs 9 SELECTs, cached 60 s per audience'],
          ['Message log', '/api/v3/overview/messages, /send-track', 'Counts stop at 10,000 ("10,000+") and are cached for 2 minutes'],
          ['Website & links', '/api/v3/overview/website, /utm', 'Server paging, 20 per page, default last 7 days'],
        ]} />
        <Callout type="success">
          All overview endpoints are <strong>read-only</strong> and tests assert that only SELECT statements are issued. The 30-minute <M>journey_node_stats</M> rollup runs journeys one at a time so it never thrashes the send-log table.
        </Callout>
      </Section>

      {/* ══════════════════════════════════════════════════════════ */}
      <Section title="9. Website & Links — UTM Tracking Chain" icon={Link2}>
        <Flow steps={[
          { label: 'Journey node' },
          { label: 'UTM link (utm_tracking)' },
          { label: 'Per-person token (user_utm_links)' },
          { label: 'Click → /api/v3/utm/track/:token' },
          { label: '302 to site with ?rid=' },
          { label: 'GTM events attributed' },
        ]} />
        <ol style={{ paddingLeft: 20 }}>
          <li>A link is created on the Website & links page (source / medium / campaign / content) or automatically for a journey node.</li>
          <li>At send time each recipient gets a unique token; the email carries the tokenised URL.</li>
          <li>The click handler increments <M>click_count</M>, stores first / last click, records a <M>utm_visits</M> row, and redirects with <M>rid</M>.</li>
          <li>The GTM snippet reads <M>rid</M> and attaches it to every event, so page views, carts and purchases land on the right person.</li>
        </ol>
        <p>The page shows links with clicks and visits, paged 20 at a time, default last 7 days, and a link builder. Sections with no data are hidden. <strong>Key files:</strong> <M>UTMService.ts</M>, <M>routes/utm.ts</M>, <M>routes/gtm.ts</M>.</p>
      </Section>

      {/* ══════════════════════════════════════════════════════════ */}
      <Section title="10. Leads and Booking Interests" icon={MessageCircle}>
        <h4>10.1 Leads (/leads)</h4>
        <p>Chat and email leads by department and agent, read from the phpAdmin databases through <M>routes/chatLeads.ts</M> (<M>/api/v3/chat-leads/summary</M>, <M>/trend</M>, <M>/mail-summary</M>, <M>/mail-trend</M>). Department groupings come from <M>department_groups</M> (migration 114).</p>
        <Callout type="warning">
          The audit found the chat-leads routes reachable without authentication (finding N-S1). Until that is fixed, treat this data as exposed to anyone with the URL.
        </Callout>

        <h4 style={{ marginTop: 20 }}>10.2 Booking interests (/affinity)</h4>
        <p><M>BookingAffinityService</M> groups each person's bookings into their top 3 services and top 3 products (built nightly at 4:30 AM into <M>user_affinity_top3</M>). The page shows a summary, top products, a product drill-down, the customers behind each product, and a CSV export. The same data appears on contact profiles and as <M>affinityVars</M> inside templates.</p>
      </Section>

      {/* ══════════════════════════════════════════════════════════ */}
      <Section title="11. Cron Schedule — What Runs When" icon={Clock}>
        <p>Every schedule is registered in <M>backend/server.ts</M> and runs in <strong>Asia/Dubai</strong> time with <M>noOverlap</M>. Overnight order matters: data in (12:30–1:30) → contacts and segments (2:00–2:30) → content and AI (3:00–4:30) → prices (5:30–5:45).</p>
        <Tbl headers={['Dubai time', 'Cron', 'Job', 'Writes']} rows={[
          ['12:30 AM', '30 0 * * *', 'Registration data sync (affiliate / guest / agent) + contact link', 'affiliate_data, guestuser_data, agent_data, unified_contacts'],
          ['12:45 AM', '45 0 * * *', 'Daily send counts (only if DAILY_SEND_COUNTS_ENABLED=true)', 'daily_send_counts'],
          ['1:00 AM', '0 1 * * *', 'Daily billing sync (3 retries, 10 min apart)', 'rayna_*, unified_contacts, segment_daily_log'],
          ['1:30 AM', '30 1 * * *', 'Contact enrichment (email validity, mobile format, country)', 'unified_contacts'],
          ['2:00 AM', '0 2 * * *', 'Email unsubscribe sync (MySQL → RDS)', 'unified_contacts.email_unsubscribe'],
          ['2:00 AM', '0 2 * * *', 'Segmentation tree snapshot (B2C → B2B → All)', 'segmentation_tree_snapshot'],
          ['2:15 AM', '15 2 * * *', 'WhatsApp unsubscribe sync', 'unified_contacts.wa_unsubscribe'],
          ['2:30 AM', '30 2 * * *', 'Per-user re-enrolment into recommendation journeys', 'journey_entries'],
          ['3:00 AM', '0 3 * * *', 'Daily AI templates (7-day series re-rendered via Claude)', 'daily_ai_templates'],
          ['3:30 AM', '30 3 * * *', 'Chats sync (insert-only) + unified_id backfill', 'chats'],
          ['3:30 AM', '30 3 * * *', 'Email QA reports for every journey template', 'email_qa_reports'],
          ['3:35 AM', '35 3 * * *', 'AI recommendation compute', 'user_product_recommendations'],
          ['3:45 AM', '45 3 * * *', 'Daily category picks', 'daily_category_picks'],
          ['4:00 AM', '0 4 * * *', 'Past-trip compute', 'past-trip recommendation rows'],
          ['4:00 AM', '0 4 * * *', 'Fixed-journey boarding of newly eligible people', 'journey_entries'],
          ['4:30 AM', '30 4 * * *', 'Booking affinity build', 'user_affinity_top3'],
          ['5:00 AM Sunday', '0 5 * * 0', 'phpAdmin contacts weekly sync', 'unified_contacts'],
          ['5:00 AM Monday', '0 5 * * 1', 'Enriched products sync', 'products, sync_metadata'],
          ['5:30 AM', '30 5 * * *', 'FX rates refresh (AED → INR / SAR / USD)', 'fx_rates'],
          ['5:45 AM', '45 5 * * *', 'Contact market / currency refresh', 'unified_contacts.market_plan, currency_code'],
          ['6:00 AM Monday', '0 6 * * 1', 'Product URL availability check (~30 min)', 'products.available'],
          ['Every 1 min', '* * * * *', 'Continuous (GTM / giveaway) journey engine', 'gtm_journey_entries, send logs'],
          ['Every 1 min', '* * * * *', 'Journey auto-start for scheduled journeys', 'journeys.status'],
          ['Every 5 min', '*/5 * * * *', 'Fixed journey engine (due entries → queue jobs)', 'journey_entries, queues'],
          ['Every 15 min', '*/15 * * * *', 'WhatsApp delivery sync from ChatHead', 'chathead_broadcasts, whatsapp_send_log'],
          ['Every 30 min', '*/30 * * * *', 'Journey analytics rollup (JOURNEY_STATS_CRON)', 'journey_node_stats'],
        ]} />
        <Callout type="info">
          The Status center lists these jobs with their next run, last run and result. Jobs that write <M>sync_metadata</M> show rows and duration; engines and snapshots do not, so they show "Scheduled".
        </Callout>
      </Section>

      {/* ══════════════════════════════════════════════════════════ */}
      <Section title="12. Database Tables — Reference" icon={Database}>
        <p>Schema lives in <M>backend/src/migrations/001 … 119</M>, applied by hand with the deploy. Sizes are approximate production figures.</p>

        <h4 style={{ marginTop: 20 }}>People and bookings</h4>
        <Tbl headers={['Table', 'Size', 'Purpose', 'Key columns']} rows={[
          ['unified_contacts', '~1.7M', 'One row per person', 'id, email, mobile, email_key, phone_key, contact_type, booking_status, product_tier, geography, is_indian, is_on_trip, market_plan, currency_code, email_unsubscribe, wa_unsubscribe, sources'],
          ['rayna_tours / hotels / visas / flights / packages / others', 'tours is the largest', 'Bookings from the billing API', 'bill_no, bill_date, selling_price, is_cancel, is_b2b, guest contact fields, unified_id'],
          ['chats, chat_contacts', 'hundreds of thousands', 'WhatsApp conversations and one row per number', 'wa_id, wa_name, first_msg_text, last_msg_at, unified_id'],
          ['affiliate_data, guestuser_data, agent_data', 'Registrations', 'Sign-ups from the registration-data API', 'registration date, type, unified_id'],
          ['gtm_events, ga4_events, utm_visits', 'Events', 'Website behaviour', 'event_name, raw_payload, unified_id, journey_id, node_id'],
          ['products, daily_category_picks, user_product_recommendations, user_affinity_top3', 'Catalogue + picks', 'Recommendation data', 'product_id, category, available, sale_price, url'],
          ['department_groups, fx_rates, market_prices', 'Small', 'Reference data', '—'],
        ]} />

        <h4 style={{ marginTop: 20 }}>Segments and journeys</h4>
        <Tbl headers={['Table', 'Purpose', 'Key columns']} rows={[
          ['custom_segments', 'User-defined segments and their status', 'name, conditions (JSON), status, last_count'],
          ['segment_daily_log, segmentation_tree_snapshot, user_segment_revenue', 'History and precomputed counts', 'log_date / snapshot date, counts, revenue'],
          ['journeys (journey_flows)', 'The graph', 'nodes, edges, journey_type, trigger_event, trigger_source, status, scheduled_start_at, test_mode'],
          ['journey_entries', 'People in fixed journeys', 'journey_id, contact_id, current_node_id, status, entered_at, next_fire_at, exit_reason'],
          ['gtm_journey_entries', 'People in continuous / giveaway journeys', 'journey_id, contact_id, state, next_fire_at, purchased'],
          ['journey_events, journey_skip_log', 'Audit of every step and every skip', 'entry_id, node_id, event_type, reason'],
          ['journey_node_stats, journey_node_rankings, journey_node_emails', 'Analytics rollups', 'journey_id, node_id, sent, opened, clicked, failed, unsub'],
          ['giveaway_events, giveaway_affiliate_events', 'Raw events from RabbitMQ', 'event data (JSONB), processed flags'],
        ]} />

        <h4 style={{ marginTop: 20 }}>Messages and tracking</h4>
        <Tbl headers={['Table', 'Size', 'Purpose']} rows={[
          ['email_send_log', '~75M', 'Every email attempt: status, sent_at, opened_at, clicked_at, error_message, journey_id, node_id, ua / ip. Indexed on created_at.'],
          ['whatsapp_send_log, whatsapp_events, whatsapp_delivery_stats, chathead_broadcasts', 'Large', 'WhatsApp sends and delivery outcomes'],
          ['sms_send_log', 'Medium', 'SMS / RCS sends'],
          ['daily_send_counts', '1 row per day per channel', 'Feeds the Home 14-day chart (migration 119)'],
          ['ses_events', 'Large', 'Deliveries, bounces, complaints from SES'],
          ['unsubscribe_log, contact_email_history', 'Medium', 'Opt-outs with reason; email changes'],
          ['utm_tracking, user_utm_links', 'Medium', 'Campaign links and per-person tokens'],
          ['content_templates, base_templates, daily_ai_templates, email_qa_reports, template_approval_events', 'Small', 'Content and its QA / approval history'],
          ['sync_metadata', 'Small', 'Watermark, rows, duration and status per sync job'],
          ['auth_users, auth_refresh_tokens', 'Small', 'Logins (bcrypt), hashed refresh tokens'],
        ]} />
        <Callout type="warning">
          <strong>Pending on production:</strong> migrations 118 (giveaway affiliate events) and 119 (daily send counts) are part of the current release. Index suggestions from the audit (section E of the audit report) have not been applied.
        </Callout>
      </Section>

      {/* ══════════════════════════════════════════════════════════ */}
      <Section title="13. API Endpoints — Reference" icon={Code}>
        <p>All routes are mounted in <M>backend/server.ts</M>. Everything under <M>/api</M> passes the rate limiters and <M>apiAuthGate</M> (JWT, HS256, 15-minute access tokens with hashed refresh tokens) except the public endpoints listed first.</p>

        <h4 style={{ marginTop: 20 }}>Public (no login)</h4>
        <Tbl headers={['Method', 'Path', 'Purpose', 'Protection']} rows={[
          ['POST', '/api/webhooks/ses', 'SES / SNS delivery, bounce and complaint events', 'SNS signature verified'],
          ['GET / POST', '/api/unsubscribe, /confirm, /change-email', 'Unsubscribe page and actions', 'Signed token (timing-safe compare)'],
          ['GET', '/api/v3/utm/track/:token', 'Click tracking + redirect', 'Per-person token'],
          ['POST', '/api/v3/gtm/events', 'Website events from the tag', 'Origin allow-list'],
          ['POST', '/api/v3/gupshup/webhook/wa, /webhook/sms', 'Template status and SMS receipts', 'Optional GUPSHUP_WEBHOOK_SECRET'],
          ['POST', '/api/auth/login, /refresh, /logout', 'Session', 'Login rate limit'],
        ]} />

        <h4 style={{ marginTop: 20 }}>Authenticated — by mount</h4>
        <Tbl headers={['Mount', 'Router', 'Main endpoints']} rows={[
          ['/api/v3/overview', 'overview.ts', 'GET /home, /home/:section, /insights, /status, /messages, /website — read-only, cached'],
          ['/api/v3/unified-contacts', 'unifiedContacts.ts', 'GET / (list), /:id, /stats, /segmentation-tree, /segment-customers, /segment-activity (+ CSV downloads); POST /sync'],
          ['/api/v3/custom-segments', 'customSegments.ts', 'CRUD, /count, /status, /customers'],
          ['/api/v3/segments', 'segmentsV3.ts', 'Segment definitions and runs'],
          ['/api/v3/journeys', 'journeys.ts', 'CRUD, /:id/entries, /:id/timeline, /:id/start|pause|stop, /:id/test-send, /analytics/table, /process'],
          ['/api/v3/utm', 'utm.ts', 'Links (paged), /track/:token, user links'],
          ['/api/v3/gtm', 'gtm.ts', '/snippet, /datalayer, /tracking-bundle, /events, /analytics'],
          ['/api/v3/rayna-sync', 'raynaSync.ts', 'GET /status, /mapping-stats (Status center); POST /trigger, /daily-sync, /ingest, /rebuild-contacts, /refresh-mapping (write — restrict)'],
          ['/api/v3/mysql-sync, /api/v3/sync', 'mysqlSync.ts, sync.ts', 'Sync status and manual triggers'],
          ['/api/v3/daily-report', 'dailyReport.ts', 'Report data and downloads'],
          ['/api/v3/affinity, /booking-affinity, /products', 'productAffinity.ts, bookingAffinity.ts, products.ts', 'Recommendations, booking interests (summary, top-products, customers, CSV), catalogue'],
          ['/api/v3/chat-leads', 'chatLeads.ts', '/summary, /trend, /mail-summary, /mail-trend'],
          ['/api/v3/gupshup', 'gupshup.ts', 'Template submit, check-status, set-external-id, events, bulk-submit'],
          ['/api/v3/chathead, /api/v3/giveaways', 'chatheadV1.ts, giveaways.ts', 'WhatsApp broadcasts, giveaway events'],
          ['/api/v3/base-templates, /api/v2/content', 'baseTemplates.ts, content.ts', 'Templates CRUD and previews'],
          ['/api/v3/agents, /api/v2/strategies, /recommendations', 'agents.ts, strategies.ts, recommendations.ts', 'AI agents and strategy suggestions (Claude)'],
          ['/api/v3/test, /api/v3/test-sends', 'testE2E.ts, testSends.ts', 'Internal testing helpers'],
          ['/api (analytics)', 'analytics.ts', 'KPIs, scorecard, departments, agents, channels'],
        ]} />
        <Callout type="info">
          Validation helpers live in <M>src/utils/validate.ts</M>; errors shown to users are translated to plain language by <M>frontend/lib/friendlyError.ts</M>. Roles (<M>requireRole</M>) exist in the middleware but are not yet applied to the write endpoints — on the audit list.
        </Callout>
      </Section>

      {/* ══════════════════════════════════════════════════════════ */}
      <Section title="14. Frontend Pages & Navigation" icon={Activity}>
        <p>Next.js App Router, every page under <M>app/(dashboard)</M> behind <M>middleware.ts</M> (needs the <M>rayna-auth</M> cookie). Shared design system in <M>components/ui</M> (Button, Field, Chip, Card, Tabs, Table, States, ConfirmDialog, PageHeader) with tokens in <M>app/globals.css</M>; light theme by default, dark supported.</p>
        <Tbl headers={['Menu', 'Page', 'Route', 'Shows', 'Main APIs']} rows={[
          ['—', 'Home', '/dashboard', 'KPIs, sending today, 14-day sends, segment distribution, contacts by source, top journeys', 'overview/home, overview/home/:section'],
          ['Audience', 'Contacts', '/contacts, /contacts/[id]', 'Searchable, sortable, filterable list; profile with bookings, chats, sends, interests', 'unified-contacts'],
          ['Audience', 'Segments', '/segmentation, /all-segments, /[slug], /custom/[id]', 'Tree by status × tier × geography; custom segment builder', 'unified-contacts/segmentation-tree, custom-segments'],
          ['Audience', 'Segment changes', '/segment-activity', 'Daily entered / exited / converted with CSV', 'unified-contacts/segment-activity'],
          ['Audience', 'Booking interests', '/affinity', 'Top services and products per customer', 'booking-affinity'],
          ['Audience', 'Leads', '/leads', 'Chat and email leads by department and agent', 'chat-leads'],
          ['Messaging', 'Journeys', '/journeys, /new, /[id], /analytics, /dashboard', 'See section 5', 'journeys'],
          ['Messaging', 'Templates', '/content, /new, /[id]', 'Templates by channel with preview, edit, approval', 'content, base-templates, gupshup'],
          ['Insights', 'Performance', '/journeys/analytics', 'Insights + per-journey table, paged, default 7 days', 'overview/insights, journeys/analytics/table'],
          ['Insights', 'Website & links', '/utm', 'UTM links, clicks and visits, link builder', 'overview/website, utm'],
          ['Insights', 'GTM & BigQuery', '/tag-manager', 'Tag snippet, live events, GA4 status', 'gtm'],
          ['Insights', 'Reports', '/daily-report', 'Daily data report downloads', 'daily-report'],
          ['Operations', 'Status center', '/data-pipeline', 'Overall health, data sources, queues, failed sends, what we hold, bookings by product, scheduled jobs', 'overview/status, rayna-sync/mapping-stats'],
          ['Operations', 'Journey monitor', '/journeys/dashboard', 'Engine and queue health', 'overview/status'],
          ['Operations', 'Message log', '/log', 'Every send with status, opens, clicks, errors; filters by channel, journey, node', 'overview/messages, send-track'],
          ['More', 'System docs', '/system', 'This page', '—'],
          ['hidden', 'Campaign results', '/campaigns', 'Kept but removed from the menu', 'campaigns'],
          ['unlinked', 'New send', '/sends/new', 'One-off send wizard (exists, not in the menu)', '—'],
        ]} />
        <Callout type="info">
          <strong>Conventions:</strong> real data only (sections with nothing to show are hidden rather than filled with placeholders); loaders while a request runs, a plain-language error with retry when it fails; counts above 10,000 shown as "10,000+"; dates shown in Dubai time.
        </Callout>
      </Section>

      {/* ══════════════════════════════════════════════════════════ */}
      <Section title="15. Environment, Deployment & Tests" icon={Shield}>
        <h4>15.1 Where it runs</h4>
        <Tbl headers={['Container', 'Image / command', 'Role', 'Limits']} rows={[
          ['redis', 'redis:7-alpine, noeviction, 1.5 GB', 'BullMQ queues, caches, idempotency keys', '1.8 GB'],
          ['backend', 'backend/Dockerfile → tsx server.ts, port 3001', 'API + crons + queue workers', '3 GB, Node heap 2.5 GB'],
          ['giveaway-consumer', 'same image → tsx src/giveaway-consumer.ts', 'Single RabbitMQ consumer (one replica only)', '512 MB'],
          ['frontend', 'frontend/Dockerfile → Next standalone, port 5176→3000', 'The UI', '1 GB'],
        ]} />
        <p><strong>Deploy:</strong> push to <M>main</M> → GitHub Action (<M>.github/workflows/deploy.yml</M>) SSHes to the EC2 host, <M>git reset --hard origin/main</M>, <M>docker compose build && up -d</M>, then prunes only if every service is running. <strong>CI</strong> (<M>ci.yml</M>) runs lint, typecheck, tests and the Next build on every pull request. Secrets live in <M>backend/.env</M> on the server (git-ignored). There is currently one environment (production); a separate dev environment with its own scrubbed database is planned.</p>

        <h4 style={{ marginTop: 20 }}>15.2 Environment variables (backend/.env)</h4>
        <Tbl headers={['Group', 'Variables', 'Notes']} rows={[
          ['Server', 'PORT, NODE_ENV, ALLOWED_ORIGINS, TRACKING_BASE_URL, JWT_SECRET', 'NODE_ENV=production enables the strict checks (no localhost tracking URLs, SMTP required)'],
          ['Postgres', 'DATABASE_URL or DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASS', 'DEV_DB_* keys are unused'],
          ['Redis', 'REDIS_URL', 'Set by compose to redis://redis:6379'],
          ['Email', 'EMAIL_PROVIDER, SMTP_HOST / PORT / USER / PASS / SECURE, EMAIL_FROM, EMAIL_FROM_NAME, IMAP_*', 'IMAP is used for reply / bounce reading'],
          ['Giveaways', 'GIVEAWAY_RABBITMQ_URL, GIVEAWAY_SMTP_*, GIVEAWAY_FROM, GIVEAWAY_SEND_ENABLED', 'Consumer is log-only until SEND_ENABLED=true'],
          ['WhatsApp / SMS / RCS', 'CHATHEAD_API_TOKEN, CHATHEAD_FROM_*, GUPSHUP_API_URL, GUPSHUP_SMS_*, GUPSHUP_RCS_*, GUPSHUP_CTM_*, GUPSHUP_WEBHOOK_SECRET', 'Missing Gupshup keys = simulation mode'],
          ['Data sources', 'RAYNA_BILLING_API_URL / TOKEN, RAYNA_SYNC_BATCH_SIZE, MYSQL_* and MYSQL2_*, BQ_PROJECT_ID / DATASET / FULL_TABLE / SYNC_*', 'service-account.json is mounted for BigQuery'],
          ['Journeys', 'JOURNEY_WAIT_SECS_PER_DAY, JOURNEY_EMAIL_CONCURRENCY, JOURNEY_EMAIL_RATE_MAX / _WINDOW, JOURNEY_TEST_EMAILS, TEST_EMAIL, JOURNEY_STATS_CRON', '—'],
          ['Features', 'WELCOME_ENABLED, WELCOME_EMAILS, WELCOME_DELAY_MIN, DAILY_SEND_COUNTS_ENABLED, OVERVIEW_PREWARM, GTM_CONTAINER_ID', '—'],
          ['AI', 'ANTHROPIC_API_KEY', 'Used by the nightly content jobs and AI agents'],
          ['Frontend (build arg)', 'NEXT_PUBLIC_API_URL', 'Baked into the image at build time'],
        ]} />

        <h4 style={{ marginTop: 20 }}>15.3 Running locally</h4>
        <pre>{`backend/   npm run dev        # tsx watch server.ts  (needs .env; crons start immediately)
           npm run typecheck  # tsc --noEmit
           npm run lint       # eslint — any use of \`any\` fails
           npm test           # vitest; DB and network are always mocked (tests/setup.ts)

frontend/  NEXT_PUBLIC_API_URL=http://localhost:3001 npm run dev
           npm run typecheck && npx eslint "**/*.{ts,tsx}"
           npm test           # vitest + jsdom + Testing Library
           npm run e2e        # Playwright, runs a scratch copy on port 5199 with every API mocked`}</pre>
        <Callout type="warning">
          Starting the backend locally with the production <M>.env</M> runs every cron against the production database and can send real messages. Use a copy of <M>.env</M> with crons and sending disabled, or wait for the dev environment.
        </Callout>

        <h4 style={{ marginTop: 20 }}>15.4 Tests</h4>
        <Tbl headers={['Suite', 'Count', 'What it covers']} rows={[
          ['Backend (vitest)', '106 files, ~2,250 tests', 'Routes, services, crons, queues, webhooks, SQL guards — every DB and HTTP call mocked'],
          ['Frontend unit (vitest + Testing Library)', '37 files, ~530 tests', 'Every page: typical, empty, loading and error states; no network'],
          ['Frontend browser (Playwright)', '9 specs, 44 tests', 'Navigation, journeys, templates, log, login, performance, website — all APIs mocked; an unmocked call fails the test'],
        ]} />

        <h4 style={{ marginTop: 20 }}>15.5 Key file map</h4>
        <pre>{`backend/
  server.ts                      # Express app, middleware, route mounts, all crons
  src/config/                    # database.ts (pg pool), mysql.ts, redis
  src/middleware/auth.ts         # JWT gate, requireRole
  src/routes/                    # 32 routers (see section 13)
  src/services/                  # 80 services: syncs, journeys, channels, AI, analytics
  src/services/queue/            # BullMQ queues + workers
  src/services/channels/         # EmailChannel, JourneyEmailSender, ChatheadEmailChannel
  src/crons/dailySendCounts.ts   # nightly send-count rollup
  src/giveaway-consumer.ts       # standalone RabbitMQ consumer
  src/migrations/001..119.sql    # schema history
  tests/                         # vitest suites (setup.ts forces dummy DB hosts)

frontend/
  app/(dashboard)/               # one folder per page (see section 14)
  app/(dashboard)/layout.tsx     # sidebar groups, audience switcher
  components/ui/                 # design system
  lib/api.ts                     # every API call, typed
  lib/friendlyError.ts           # provider errors → plain language
  context/                       # auth, business type, theme
  e2e/                           # Playwright specs + fixtures/mocks.ts
  tests/                         # unit tests`}</pre>
      </Section>

      {/* ══════════════════════════════════════════════════════════ */}
      <Section title="16. Troubleshooting & Common Issues" icon={AlertTriangle}>
        <Tbl headers={['Symptom', 'Likely cause', 'What to do']} rows={[
          ['Status center shows rayna_* sources with "billno does not exist" errors', 'Stale sync_metadata rows from a retired sync (May 2026); DailyBillingSync does not write there', 'Ignore — the UI hides them. Team: delete those rows or make DailyBillingSync write real ones'],
          ['Home cards slow or "still working"', 'A section query timed out and is completing in the background', 'Wait for the next poll; check OVERVIEW_PREWARM and DAILY_SEND_COUNTS_ENABLED; the index list in the audit speeds the 14-day queries'],
          ['Sending today / 14-day chart empty', 'daily_send_counts not filled (migration 119 missing or DAILY_SEND_COUNTS_ENABLED not true)', 'Apply 119, set the flag, restart; the job backfills 90 s after boot'],
          ['Journey shows 0 joined but people are receiving messages', 'It is a GTM / giveaway journey — people are in gtm_journey_entries', 'The UI reads both tables now; if you still see 0, restart the backend'],
          ['Queue health missing on Status center', 'Redis unreachable from the backend', 'docker compose ps redis; the card is hidden when queues cannot be read'],
          ['Failed emails not in Message log', 'Filtering on sent_at (null for failures)', 'Fixed — the log uses created_at; refresh the page'],
          ['Giveaway emails fail with SMTP 535', 'GIVEAWAY_SMTP_* credentials rejected', 'Team: rotate the giveaway SMTP password and update .env'],
          ['"Session expired" immediately after login', 'JWT_SECRET changed or clocks skewed', 'Log in again; check JWT_SECRET is set once and not rotated between replicas'],
          ['CORS error in the browser', 'Origin missing from ALLOWED_ORIGINS', 'Add the frontend URL to ALLOWED_ORIGINS in backend/.env and restart'],
          ['WA / SMS send returns "not approved" or simulated', 'Template not approved, or Gupshup keys missing', 'Templates page → submit / check status; add GUPSHUP_* keys for live sends'],
          ['Counts say 10,000+', 'Deliberate cap to keep the log fast', 'Narrow the filters (journey, node, status, date)'],
          ['Local backend hangs on /api/health', 'No Redis running locally', 'Start Redis (or Docker compose) before the backend'],
          ['Migration 118 / 119 errors on deploy', 'Not applied on production yet', 'Team: apply in order after a snapshot; the code tolerates their absence but features stay empty'],
          ['Contacts tests fail locally (4 tests)', 'Uncommitted edits in contacts/ and context/BusinessTypeContext.tsx', 'Those files belong to another branch of work; the failures are not from main'],
        ]} />
      </Section>

    </div>
  );
}
