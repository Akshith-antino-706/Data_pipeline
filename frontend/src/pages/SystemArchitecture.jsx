import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Database, ArrowRight, Users, GitBranch, Mail, MessageCircle, Globe, Target,
  Plane, Hotel, Ticket, RefreshCw, Clock, ChevronDown, ChevronUp, DollarSign,
  Megaphone, FileText, Link2, Code, Activity, Layers, Shield, Zap, AlertTriangle,
  CheckCircle, Info,
} from 'lucide-react';

const fadeInUp = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.4, 0, 0.2, 1] } } };
const staggerContainer = { hidden: {}, visible: { transition: { staggerChildren: 0.06 } } };

function Section({ title, icon: Icon, color, defaultOpen, children }) {
  const [open, setOpen] = useState(defaultOpen || false);
  return (
    <motion.div variants={fadeInUp} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', overflow: 'hidden', marginBottom: 16 }}>
      <div onClick={() => setOpen(o => !o)} style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', userSelect: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon size={16} style={{ color }} />
          </div>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{title}</span>
        </div>
        {open ? <ChevronUp size={16} style={{ color: 'var(--muted-foreground)' }} /> : <ChevronDown size={16} style={{ color: 'var(--muted-foreground)' }} />}
      </div>
      {open && <div style={{ padding: '0 20px 20px', fontSize: 13, lineHeight: 1.8, color: 'var(--foreground)' }}>{children}</div>}
    </motion.div>
  );
}

function Tbl({ headers, rows }) {
  return (
    <div style={{ overflowX: 'auto', margin: '12px 0' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: 'var(--secondary)' }}>
            {headers.map(h => <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted-foreground)', whiteSpace: 'nowrap' }}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
              {row.map((cell, j) => <td key={j} style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Flow({ steps }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '12px 0' }}>
      {steps.map((step, i) => (
        <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span style={{ padding: '6px 12px', borderRadius: 6, background: step.color || 'var(--secondary)', color: step.textColor || 'var(--foreground)', fontSize: 12, fontWeight: 500, border: '1px solid var(--border)' }}>{step.label}</span>
          {i < steps.length - 1 && <ArrowRight size={14} style={{ color: 'var(--muted-foreground)' }} />}
        </span>
      ))}
    </div>
  );
}

function M({ children }) {
  return <code style={{ padding: '2px 6px', borderRadius: 4, background: 'var(--secondary)', fontSize: 12, fontFamily: 'monospace' }}>{children}</code>;
}

function Callout({ type, children }) {
  const configs = {
    info: { bg: '#3b82f610', border: '#3b82f640', icon: Info, color: '#3b82f6' },
    warning: { bg: '#f59e0b10', border: '#f59e0b40', icon: AlertTriangle, color: '#f59e0b' },
    success: { bg: '#22c55e10', border: '#22c55e40', icon: CheckCircle, color: '#22c55e' },
  };
  const c = configs[type] || configs.info;
  return (
    <div style={{ display: 'flex', gap: 10, padding: '12px 16px', borderRadius: 8, background: c.bg, border: `1px solid ${c.border}`, margin: '12px 0', fontSize: 13 }}>
      <c.icon size={16} style={{ color: c.color, flexShrink: 0, marginTop: 2 }} />
      <div>{children}</div>
    </div>
  );
}

export default function SystemArchitecture() {
  return (
    <motion.div initial="hidden" animate="visible" variants={staggerContainer} style={{ display: 'flex', flexDirection: 'column', gap: 4, maxWidth: 1100 }}>

      <motion.div variants={fadeInUp} style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>System Architecture & Documentation</h2>
        <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--muted-foreground)', lineHeight: 1.6 }}>
          Complete technical documentation for the Rayna Tours Omnichannel Marketing Platform.
          This page covers every data flow, table relationship, business logic, and automation in the system.
          If you are new to this project, read sections 1-7 in order.
        </p>
      </motion.div>

      {/* ══════════════════════════════════════════════════════════ */}
      <Section title="1. System Overview — What This Platform Does" icon={Layers} color="#8b5cf6" defaultOpen={true}>
        <p>This is an <strong>omnichannel marketing automation platform</strong> for Rayna Tours, Dubai's largest tour operator. It does 5 things:</p>

        <ol style={{ paddingLeft: 20 }}>
          <li><strong>Collects data</strong> from 6 sources (booking APIs, CRM, WhatsApp, website analytics, product catalog)</li>
          <li><strong>Unifies customers</strong> into a single identity by matching phone numbers and emails across all sources</li>
          <li><strong>Segments customers</strong> using a 3-step decision tree (booking status → product tier → geography)</li>
          <li><strong>Runs automated journeys</strong> — multi-step email/WhatsApp campaigns with branching logic</li>
          <li><strong>Detects conversions</strong> — tracks UTM clicks → website behavior → actual bookings to measure ROI</li>
        </ol>

        <p><strong>The daily loop:</strong></p>
        <Flow steps={[
          { label: 'Data syncs in', color: '#3b82f620' },
          { label: 'Contacts unified', color: '#22c55e20' },
          { label: 'Segments computed', color: '#f59e0b20' },
          { label: 'Journeys process', color: '#8b5cf620' },
          { label: 'Messages sent', color: '#ef444420' },
          { label: 'Conversions detected', color: '#22c55e20' },
          { label: 'Customers move segments', color: '#f59e0b20' },
        ]} />

        <Callout type="info">
          <strong>B2B vs B2C:</strong> The platform handles both. B2C customers (tourists) get travel deals and experience recommendations.
          B2B customers (travel agencies, partners) get commission structures, volume incentives, and partnership offers.
          A global switcher in the sidebar controls which mode the entire UI shows.
        </Callout>
      </Section>

      {/* ══════════════════════════════════════════════════════════ */}
      <Section title="2. Data Sources — Where Data Comes From" icon={Database} color="#3b82f6">
        <p>The platform pulls data from <strong>6 external sources</strong>. Each has its own sync mechanism, schedule, and conflict resolution.</p>

        <h4 style={{ marginTop: 20 }}>2.1 Rayna Booking APIs (Tours, Hotels, Visas, Flights)</h4>
        <p>The core booking data comes from Rayna's internal ACICO system via 4 REST API endpoints.</p>

        <Tbl headers={['Endpoint', 'URL Path', 'Response Key', 'Local Table', 'Conflict Key']} rows={[
          ['Tours', '/tours-sync', 'BillToursList', 'rayna_tours', 'billno + tours_name + tour_date'],
          ['Hotels', '/hotel-sync', 'Hotel_booking', 'rayna_hotels', 'billno + hotel_name + check_in_date'],
          ['Visas', '/visa-sync', 'VisaInformation', 'rayna_visas', 'billno + guest_name + visa_type'],
          ['Flights', '/flight-sync', 'Tkt_Information', 'rayna_flights', 'billno + passenger_name + flight_no'],
        ]} />

        <p><strong>How it works step by step:</strong></p>
        <ol style={{ paddingLeft: 20 }}>
          <li>Reads <M>last_synced_at</M> from <M>sync_metadata</M> table for each endpoint</li>
          <li>If first run, defaults to 7 days ago. Otherwise starts from last sync date</li>
          <li>Loops <strong>one day at a time</strong> from start → today, calling the API with DateFrom/DateTo</li>
          <li>Maps API fields to PostgreSQL columns (e.g., <M>billDate</M> → <M>bill_date</M>)</li>
          <li>Drops rows with null conflict keys (can't upsert without unique identifier)</li>
          <li>Deduplicates within batch using JSON-stringified conflict key</li>
          <li>Batch upserts 500 rows at a time with <M>ON CONFLICT DO UPDATE SET</M></li>
          <li>Saves raw API response to <M>data_backups/</M> directory as JSON file</li>
          <li>Updates <M>sync_metadata</M> with row count, status, and timestamp</li>
        </ol>

        <Callout type="warning">
          <strong>Existing records get fully refreshed:</strong> When the same booking comes in again (same conflict key), ALL fields are updated — status changes, price changes, contact details.
          The <M>synced_at</M> timestamp is set to NOW() on every upsert. The auto-generated <M>id</M> (SERIAL) stays the same.
        </Callout>

        <p><strong>Visa API has 3 extra fields</strong> that other APIs don't: <M>apply_date</M>, <M>applicant_name</M>, <M>passport_number</M> (added in migration 033).</p>

        <p><strong>Three sync strategies:</strong></p>
        <Tbl headers={['Strategy', 'When', 'Chunking', 'Purpose']} rows={[
          ['Incremental', 'Daily 6 AM Dubai (cron)', 'Day-by-day from last sync', 'Pick up new bookings'],
          ['Catch-up', 'Daily 4 AM Dubai (cron)', 'Week-by-week, last 30 days', 'Catch modifications, cancellations, status changes'],
          ['Historical', 'Manual trigger only', 'Month-by-month', 'Backfill old data (e.g., 6 months)'],
        ]} />

        <h4 style={{ marginTop: 20 }}>2.2 MySQL Contacts & Chats</h4>
        <p>Customer contacts come from one MySQL server, WhatsApp chats from another.</p>

        <Tbl headers={['Data', 'MySQL Server', 'Key Columns Synced', 'Sync Frequency']} rows={[
          ['Contacts', '95.211.169.194:3306', 'id, name, email, mobile, company_name, country, contact_type', 'Every 10 minutes'],
          ['Chats', '5.79.64.193:3306', 'id, wa_id (phone), wa_name, country, last_msg_at, tags', 'Every 10 minutes'],
          ['Travel Data', '95.211.169.194:3306', 'Booking records with contact, dates, amounts', 'Every 10 minutes'],
          ['Tickets', '95.211.169.194:3306', 'Support tickets with subject, status, priority', 'Every 10 minutes'],
        ]} />

        <p>All MySQL syncs are <strong>incremental by timestamp</strong> — only rows with <M>updated_at</M> or <M>created_at</M> newer than last sync are fetched. Page size: 5,000 rows. Batch upsert: 500 rows.</p>

        <h4 style={{ marginTop: 20 }}>2.3 GA4 / BigQuery Events</h4>
        <p>Website analytics from Google Analytics 4, synced via BigQuery API. Contains page views, clicks, form submissions, and purchase events. Each event has a <M>user_pseudo_id</M> which gets linked to <M>unified_id</M> via email or phone matching.</p>

        <h4 style={{ marginTop: 20 }}>2.4 GTM Real-Time Events</h4>
        <p>Google Tag Manager pushes events in <strong>real-time</strong> via HTTP POST to <M>/api/v3/gtm/event</M>. These include form submissions, clicks, and e-commerce events. The raw payload is stored in <M>gtm_events.raw_payload</M> (JSONB) which contains fields like <M>emailId</M>, <M>contactNumber</M>, <M>product_interest</M>.</p>

        <Callout type="info">
          <strong>How GTM identifies users:</strong> When a user clicks a UTM link, the landing page URL includes <M>?rid=UNIFIED_ID</M>.
          The GTM tag reads this <M>rid</M> parameter and includes it in all subsequent events, allowing us to attribute all website behavior to a specific customer.
        </Callout>

        <h4 style={{ marginTop: 20 }}>2.5 Product Catalog</h4>
        <p><strong>880 products</strong> from <M>data-projects-flax.vercel.app/api/generate-feed?format=json</M>. Includes tours, holidays, cruises, yachts across 89 cities and 127 categories. Synced daily at 6 AM Dubai. Each product has: name, type, price, city, URL, image, productId.</p>

        <p><strong>Key files:</strong></p>
        <Tbl headers={['File', 'Responsibility']} rows={[
          ['backend/src/services/RaynaSyncService.js', 'Rayna API sync — 4 endpoints, 3 strategies, date formatting, backup'],
          ['backend/src/services/MySQLSyncService.js', 'MySQL → PostgreSQL sync — contacts, chats, tickets, travel_data'],
          ['backend/src/services/BigQuerySyncService.js', 'GA4 events from Google BigQuery'],
          ['backend/src/services/GTMService.js', 'Real-time GTM event receiver + tag script generator'],
          ['backend/src/services/ProductAffinityService.js', 'Product catalog sync + affinity scoring'],
        ]} />
      </Section>

      {/* ══════════════════════════════════════════════════════════ */}
      <Section title="3. Unified Contacts — The Single Source of Truth" icon={Users} color="#22c55e">
        <p>The <M>unified_contacts</M> table is the <strong>central customer table</strong>. Every customer across all sources gets exactly one row here. This is how the system resolves "is this the same person?" across WhatsApp chats, booking records, website visits, and CRM data.</p>

        <h4 style={{ marginTop: 20 }}>3.1 How Identity Resolution Works</h4>
        <p>Two matching keys are used:</p>
        <ul style={{ paddingLeft: 20 }}>
          <li><strong>phone_key:</strong> Last 10 digits of any phone number, after removing all non-digits. Example: <M>+971-50-123-4567</M> → <M>0501234567</M></li>
          <li><strong>email_key:</strong> Lowercase trimmed email. Example: <M>John@Example.com </M> → <M>john@example.com</M></li>
        </ul>

        <p><strong>Phone validation rules (must pass all):</strong></p>
        <ul style={{ paddingLeft: 20 }}>
          <li>At least 7 digits after removing non-numeric characters</li>
          <li>Not all zeros (e.g., <M>0000000</M> is rejected)</li>
          <li>Not in junk list: <M>0, 00, 000, NA, N/A, na</M></li>
        </ul>

        <h4 style={{ marginTop: 20 }}>3.2 Which Sources Create New Rows?</h4>
        <p>Only 4 steps can <strong>INSERT</strong> new rows into unified_contacts. Everything else only UPDATEs existing rows.</p>

        <Tbl headers={['Step', 'Source', 'Match Key', 'What Gets Created', 'Conflict Handling']} rows={[
          ['syncNewContacts()', 'contacts_raw (MySQL CRM)', 'email_key', 'name, email, phone, company, city, country', 'ON CONFLICT DO NOTHING — first email wins, never updated after'],
          ['syncChats()', 'chat_contacts (WhatsApp)', 'phone_key', 'phone, name, country, sources=chat', 'ON CONFLICT DO NOTHING — but UPDATE step follows to refresh chat counts'],
          ['syncNewRaynaContacts()', 'rayna_tours/hotels/visas/flights', 'phone_key then email_key', 'name, phone, email, country, sources=rayna', 'Only creates if neither phone nor email exists'],
          ['syncNewGTMContacts()', 'gtm_events + ga4_events', 'email_key then phone_key', 'email, phone, name, country, city, sources=gtm/ga4', 'Only creates if neither email nor phone exists'],
        ]} />

        <Callout type="warning">
          <strong>Important gap:</strong> <M>syncNewContacts()</M> uses <M>ON CONFLICT DO NOTHING</M>, meaning if a contact's name, phone, or company changes in the CRM, those changes flow into <M>contacts_raw</M> but <strong>never propagate to unified_contacts</strong>. This is by design to prevent accidental overwrites, but means CRM updates require manual intervention.
        </Callout>

        <h4 style={{ marginTop: 20 }}>3.3 Full Sync Pipeline (12 Steps)</h4>
        <p>This runs every night at <strong>3:30 AM Dubai time</strong> via <M>UnifiedContactSync.run()</M>. Order matters — each step depends on the previous one.</p>

        <Tbl headers={['Order', 'Method', 'What It Does', 'Creates Rows?', 'Updates Rows?']} rows={[
          ['1', 'refreshChatContacts()', 'Aggregates raw chats by wa_id into chat_contacts table (total_chats, first/last timestamps)', 'No', 'chat_contacts only'],
          ['2', 'syncNewContacts()', 'INSERT new contacts from CRM by email_key', 'Yes', 'No (DO NOTHING)'],
          ['3', 'syncChats()', 'INSERT chat-only customers by phone_key, then UPDATE chat counts on existing contacts', 'Yes', 'Yes (chat fields)'],
          ['4', 'syncTravelBookings()', 'UPDATE travel booking counts and types on unified_contacts by phone_key', 'No', 'Yes (travel fields)'],
          ['5', 'syncRaynaBookings()', 'UPDATE Rayna booking counts by phone_key (primary) then email_key (fallback)', 'No', 'Yes (booking counts, revenue)'],
          ['6', 'syncNewRaynaContacts()', 'INSERT new contacts from Rayna bookings where phone AND email don\'t exist', 'Yes', 'No'],
          ['7', 'syncUnsubscribed()', 'Flag email_unsubscribed = Yes for contacts in unsubscribed table', 'No', 'Yes (email status)'],
          ['8', 'syncGA4GTM()', 'Link GA4/GTM events to unified_contacts by email then phone, update event counts', 'No', 'Yes (ga4 fields)'],
          ['9', 'syncNewGTMContacts()', 'INSERT new contacts from GTM/GA4 events where email AND phone don\'t exist', 'Yes', 'No'],
          ['10', 'relinkRawTables()', 'Stamp unified_id back onto raw tables (chats, rayna_*, ga4_events) for new contacts', 'No', 'Raw tables only'],
          ['11', 'computeSegments()', 'Assign booking_status, product_tier, geography, is_indian, segment_label', 'No', 'Yes (segment fields)'],
          ['12', 'computeOccasions()', 'Auto-enter/exit users for upcoming local holidays', 'user_occasions', 'Yes (occasion fields)'],
        ]} />

        <Callout type="info">
          <strong>Why relinkRawTables() runs after new contacts are created:</strong> Steps 6 and 9 create new unified_contacts rows. But the raw booking/event records that led to their creation still have <M>unified_id = NULL</M>. Step 10 goes back and stamps the new <M>unified_id</M> onto those raw records so they're properly linked for future queries.
        </Callout>

        <p><strong>Key file:</strong> <M>backend/src/services/UnifiedContactSync.js</M> — this is the most important file in the project. All 12 steps are methods on this class.</p>
      </Section>

      {/* ══════════════════════════════════════════════════════════ */}
      <Section title="4. Segmentation — 3-Step Decision Tree" icon={Target} color="#f59e0b">
        <p>Every customer gets a <strong>segment label</strong> computed by <M>computeSegments()</M>. This runs as step 11 of the nightly sync. The logic is a priority-based waterfall — the first matching status wins.</p>

        <h4 style={{ marginTop: 20 }}>4.1 Step 1: Booking Status (6 states)</h4>
        <p>Evaluated in strict priority order. Once a customer matches, they skip all remaining checks.</p>

        <Tbl headers={['Priority', 'Status', 'SQL Condition', 'Real-World Meaning', 'Example']} rows={[
          ['1 (highest)', 'ON_TRIP', 'tour_date/check_in_date/from_datetime is within today to +7 days', 'Customer is currently on their trip in Dubai', 'Tour date was 3 days ago, still within 7-day window'],
          ['2', 'FUTURE_TRAVEL', 'tour_date/check_in_date/from_datetime > today', 'Customer has a booking but hasn\'t travelled yet', 'Tour booked for next month'],
          ['3', 'ACTIVE_ENQUIRY', 'Chatted on WhatsApp in last 30 days AND zero bookings', 'Customer asked about a trip but hasn\'t booked', 'Sent message "how much is desert safari?" 5 days ago'],
          ['4', 'PAST_BOOKING', 'Has any booking (tour/hotel/visa/flight)', 'Customer travelled before — cross-sell opportunity', 'Booked a desert safari 3 months ago'],
          ['5', 'PAST_ENQUIRY', 'Chatted on WhatsApp 30+ days ago AND never booked', 'Enquiry went cold — win-back target', 'Asked about hotels 45 days ago, never followed up'],
          ['6 (lowest)', 'PROSPECT', 'None of the above', 'Contact exists but never engaged with Rayna', 'Email imported from a list, never chatted or booked'],
        ]} />

        <Callout type="warning">
          <strong>The +7 day trip window:</strong> We don't have explicit check-out dates or trip end dates from the API. So we assume every trip lasts 7 days from the tour_date/check_in_date. This is a <strong>default assumption</strong> — a 1-day desert safari and a 7-day holiday package both use the same +7 window.
        </Callout>

        <Callout type="info">
          <strong>ON_TRIP checks all 3 booking types:</strong> Tours (tour_date), Hotels (check_in_date), AND Flights (from_datetime). If ANY of these fall within the 7-day window, the customer is ON_TRIP. Same for FUTURE_TRAVEL — any future date across all 3 types qualifies.
        </Callout>

        <h4 style={{ marginTop: 20 }}>4.2 Step 2: Product Tier (LUXURY / STANDARD)</h4>
        <p>Checked independently of booking status. If a customer has <strong>even one</strong> booking matching luxury keywords, they're LUXURY forever.</p>
        <p><strong>Luxury keywords searched in tour/service names:</strong> premium, private, vip, yacht, helicopter, limousine, luxury, megayacht, falcon, chauffeur</p>
        <p>STANDARD = has bookings but none match luxury keywords. Customers with no bookings get NULL (no tier).</p>

        <h4 style={{ marginTop: 20 }}>4.3 Step 3: Geography (LOCAL / INTERNATIONAL)</h4>
        <ul style={{ paddingLeft: 20 }}>
          <li><strong>LOCAL:</strong> country = "United Arab Emirates" (Rayna operates in UAE)</li>
          <li><strong>INTERNATIONAL:</strong> any other non-empty country</li>
          <li><strong>INDIAN (sub-tag):</strong> phone starts with 91 OR country = India OR nationality = India. This is an <strong>overlay</strong>, not a replacement — a customer can be INTERNATIONAL + INDIAN. The INDIAN tag means WhatsApp is included as a channel (Indians heavily use WhatsApp).</li>
        </ul>

        <p><strong>Final label example:</strong> <M>ON_TRIP / LUXURY / INTERNATIONAL / INDIAN</M></p>

        <h4 style={{ marginTop: 20 }}>4.4 B2B Segments (separate from B2C)</h4>
        <p>B2B customers (travel agencies, partners) have their own 4 segments based on <M>contact_type = 'B2B'</M>:</p>

        <Tbl headers={['Segment', 'Criteria', 'Focus']} rows={[
          ['B2B_ACTIVE_PARTNER', 'B2B + bookings in last 30 days', 'Nurture, volume incentives, commission tier upgrades'],
          ['B2B_DORMANT_PARTNER', 'B2B + no bookings in 30+ days', 'Reactivation with bonus commission offers'],
          ['B2B_NEW_LEAD', 'B2B + chatted but never booked', 'Onboarding, trial offer (5 bookings at 0% commission)'],
          ['B2B_PROSPECT', 'B2B + never chatted, never booked', 'Partnership introduction, commission structure showcase'],
        ]} />
      </Section>

      {/* ══════════════════════════════════════════════════════════ */}
      <Section title="5. Holiday Occasions — Automatic Festive Campaigns" icon={Globe} color="#8b5cf6">
        <p>The occasion system automatically assigns customers to festive campaigns based on their <strong>country/nationality</strong>. It runs as step 12 of the nightly sync.</p>

        <h4 style={{ marginTop: 20 }}>5.1 How It Works</h4>
        <ol style={{ paddingLeft: 20 }}>
          <li><strong>14 days before</strong> a holiday, <M>computeOccasions()</M> finds all customers whose country matches the holiday's country</li>
          <li>Creates a <M>user_occasions</M> entry (status = 'active')</li>
          <li>Sets <M>unified_contacts.current_occasion</M> = holiday name, <M>occasion_offer_tag</M> = coupon code</li>
          <li>The occasion <strong>overlaps</strong> with their regular segment — a customer can be PAST_BOOKING + Diwali at the same time</li>
          <li>Journey sends holiday-specific messages using <M>{`{{holiday_name}}`}</M> and <M>{`{{offer_tag}}`}</M> variables</li>
          <li><strong>After the holiday passes</strong>, the entry is auto-exited and occasion fields cleared</li>
        </ol>

        <p><strong>Country matching rules:</strong></p>
        <Tbl headers={['Customer Profile', 'Gets These Holidays', 'Why']} rows={[
          ['country = India', 'All Indian festivals', 'Direct country match'],
          ['is_indian = true (phone starts with 91)', 'All Indian festivals', 'Indian diaspora in UAE — they celebrate Indian festivals'],
          ['geography = LOCAL (UAE resident)', 'All UAE holidays', 'Lives in UAE, affected by local holidays'],
          ['country = United Kingdom', 'UK holidays', 'Direct country match'],
          ['country = Russia / Saudi / etc.', 'Their respective holidays', 'Direct country match'],
        ]} />

        <Callout type="info">
          <strong>Why Diwali email shows Diwali offers:</strong> Each holiday has a unique <M>offer_tag</M> (e.g., DIWALI26, UAENAT26). The content templates use <M>{`{{holiday_name}}`}</M> and <M>{`{{offer_tag}}`}</M> as template variables. So when the journey processes a Diwali occasion entry, the email literally says "Diwali Festival of Lights — exclusive holiday packages" with coupon code DIWALI26. Not a generic "holiday offer".
        </Callout>

        <p><strong>50 holidays</strong> across 10 countries currently seeded. <strong>Tables:</strong> <M>holidays_calendar</M> (dates + offers), <M>user_occasions</M> (assignments)</p>
      </Section>

      {/* ══════════════════════════════════════════════════════════ */}
      <Section title="6. Journey Engine — How Messages Get Sent" icon={GitBranch} color="#10b981">
        <p>Each segment has a <strong>visual journey flow</strong> — a directed graph of nodes and edges that defines what messages to send, when, and with what logic.</p>

        <h4 style={{ marginTop: 20 }}>6.1 Node Types</h4>
        <Tbl headers={['Type', 'What It Does', 'Key Data Fields', 'Example']} rows={[
          ['trigger', 'Entry point — defines how customers enter the journey', 'triggerType, segmentLabel', 'Customer enters ON_TRIP segment'],
          ['action', 'Send a message via a channel. Has a templateId linking to content_templates', 'channel, label, templateId', 'Send WhatsApp: "Welcome to Dubai!"'],
          ['wait', 'Pause for N days before proceeding to next node', 'waitDays', 'Wait 3 days'],
          ['condition', 'Branch into Yes/No paths based on real customer data', 'condition (booked, clicked, opened_email)', 'Did they book? → Yes: thank you / No: send offer'],
          ['goal', 'Journey completion marker', 'goalType', 'Trip completed + upsold'],
        ]} />

        <h4 style={{ marginTop: 20 }}>6.2 How processJourney() Works</h4>
        <p>Called daily at 5 AM Dubai for each active journey. Processes entries in batches of 100.</p>

        <ol style={{ paddingLeft: 20 }}>
          <li>Fetches all <M>journey_entries</M> with <M>status = 'active'</M> for this journey</li>
          <li>For each entry, looks up the <M>current_node_id</M> in the journey's node map</li>
          <li><strong>If WAIT node:</strong> Checks if enough days have elapsed since the last journey_event. If not → skip (customer waits). If yes → advance to next node</li>
          <li><strong>If ACTION node:</strong> Logs a <M>journey_events</M> record with <M>event_type = 'action_sent'</M>, including the <M>templateId</M>. Then advances to next node</li>
          <li><strong>If CONDITION node:</strong> Actually evaluates the condition:
            <ul style={{ paddingLeft: 20 }}>
              <li><M>booked</M>: Checks rayna_tours/hotels/visas/flights for any booking with bill_date after the entry's entered_at</li>
              <li><M>clicked_link</M>: Checks user_utm_links for any click on this journey's campaign UTM links</li>
              <li><M>opened_email</M>: Checks journey_events for an email_opened event</li>
            </ul>
            Then follows the Yes or No edge to the appropriate next node
          </li>
          <li><strong>If GOAL node:</strong> Marks entry as 'completed'</li>
          <li>If no outgoing edges → marks entry as 'completed' (end of flow)</li>
        </ol>

        <Callout type="warning">
          <strong>Each user has their own timeline:</strong> If 10 users entered the journey 3 days ago and a new user enters today, the old users are at Day 3 (getting the urgency message) while the new user is at Day 0 (getting the welcome message). There is no global "journey day" — each entry tracks its own position independently via <M>current_node_id</M> and timing via <M>journey_events</M> timestamps.
        </Callout>

        <h4 style={{ marginTop: 20 }}>6.3 Journey ↔ Template Linking</h4>
        <p>Each action node has a <M>templateId</M> field that points to a specific row in <M>content_templates</M>. This means when the journey engine reaches an action node, it knows exactly which email/WhatsApp template to render. The template contains the actual message body, subject line, CTAs, coupon codes, and <M>{`{{variables}}`}</M> for personalization.</p>

        <p><strong>11 active journeys:</strong> 6 B2C + 4 B2B + 1 Holiday Occasion. <strong>Key file:</strong> <M>backend/src/services/JourneyService.js</M></p>
      </Section>

      {/* ══════════════════════════════════════════════════════════ */}
      <Section title="7. Template Approval Pipeline (Gupshup) — WhatsApp + SMS" icon={Shield} color="#0ea5e9">
        <p>Email goes out directly over SMTP, but WhatsApp and SMS both require <strong>external approval before any message can be sent</strong>. WhatsApp templates are reviewed by Meta via Gupshup's template API; Indian SMS templates must be DLT-registered under a Principal Entity ID with TRAI. The pipeline enforces both — no WA/SMS message ships until the template is <M>external_status = 'approved'</M>.</p>

        <h4 style={{ marginTop: 20 }}>7.1 Approval States</h4>
        <Tbl headers={['external_status', 'Meaning', 'Sendable?']} rows={[
          ['not_submitted', 'Template exists locally, never sent to Gupshup', 'No'],
          ['pending', 'Submitted — awaiting Meta (WA) or DLT registration (SMS)', 'No'],
          ['approved', 'Cleared by Gupshup/Meta/TRAI — ready to send', 'Yes'],
          ['rejected', 'Rejected with a reason stored in external_rejection_reason', 'No'],
          ['paused', 'Temporarily blocked by Meta (e.g. quality rating dropped)', 'No'],
          ['disabled', 'Provider disabled this template', 'No'],
          ['error', 'Submission failed — see external_payload for raw response', 'No'],
        ]} />

        <h4 style={{ marginTop: 20 }}>7.2 How It Flows</h4>
        <ol style={{ paddingLeft: 20 }}>
          <li><strong>Template authored</strong> on the Content page (or seeded by <M>seed_journey_content.js</M>) — starts as <M>not_submitted</M></li>
          <li><strong>Submit for approval</strong> — UI button on Content page calls <M>POST /api/v3/gupshup/templates/:id/submit</M>. WA templates go to Gupshup's template API; SMS templates need a DLT Content Template ID set separately via <M>set-external-id</M> once registered</li>
          <li><strong>Status updates</strong> arrive via Gupshup webhook at <M>POST /api/v3/gupshup/webhook/wa</M>. Alternatively the UI can poll via <M>check-status</M></li>
          <li><strong>Every send</strong> (journey engine or manual test-send) calls <M>GupshupService.assertApproved()</M> first. Non-approved templates fail with a clean "not approved" error and log a <M>send_blocked</M> event — they <strong>never reach the provider</strong></li>
          <li><strong>Delivery</strong> for approved templates routes through <M>GupshupService.sendWhatsApp()</M> or <M>sendSMS()</M>, which include DLT headers (Principal Entity ID, Content Template ID) where required</li>
        </ol>

        <Callout type="info">
          <strong>Simulation mode:</strong> Until Gupshup keys land in <M>.env</M>, the whole pipeline runs in simulation — submissions mark templates <M>pending</M> with a fake external ID, and sends return <M>simulated: true</M> without hitting any provider. Use <M>POST /templates/:id/force-approve</M> (Content page → "Force approve (dev)") to flip a template to approved for end-to-end testing. The button auto-hides once real keys are configured.
        </Callout>

        <h4 style={{ marginTop: 20 }}>7.3 DLT for SMS (India)</h4>
        <p>Indian SMS has a second approval layer — <strong>DLT registration via TRAI</strong>. Every sender ID, header, and content template must be registered with your telecom operator (Jio/Airtel/Vi) and assigned a 19-digit Content Template ID <strong>before</strong> Gupshup will dispatch. Our pipeline stores that DLT ID as <M>external_template_id</M>, and the send method attaches it as <M>dltTemplateId</M> on every outgoing request.</p>
        <Tbl headers={['DLT Field', 'Env Var', 'Purpose']} rows={[
          ['Principal Entity ID', 'DLT_PRINCIPAL_ENTITY_ID', 'Your brand on TRAI (19 digits)'],
          ['Telemarketer ID', 'DLT_TELEMARKETER_ID', 'Gupshup\'s telemarketer registration'],
          ['Header / Sender Mask', 'DLT_HEADER_ID + GUPSHUP_SMS_SENDER_ID', '6-char sender e.g. RAYNAT'],
          ['Content Template ID', 'stored per-template in external_template_id', 'Specific to each approved message'],
        ]} />

        <h4 style={{ marginTop: 20 }}>7.4 Audit Trail</h4>
        <p>Every state transition (submit, webhook update, manual sync, blocked send) writes a row to <M>template_approval_events</M>. Use <M>GET /api/v3/gupshup/templates/:id/events</M> to see the full history, including the provider's raw response stored in the <M>details</M> JSONB.</p>

        <Callout type="warning">
          <strong>The approval gate cannot be bypassed in production.</strong> Even if a journey node has a valid templateId, <M>processJourney()</M> will skip the send (logging <M>event_type = 'action_blocked'</M>) rather than fall back to raw text. WhatsApp's 24-hour session window would let <M>sendText</M> work for some users, but it can't match the approved copy, so we don't use it — every customer gets the same reviewed message, or no message at all.
        </Callout>

        <p><strong>Key files:</strong> <M>backend/src/services/GupshupService.js</M>, <M>backend/src/routes/gupshup.js</M>, <M>backend/src/migrations/047_gupshup_approval.sql</M></p>
      </Section>

      {/* ══════════════════════════════════════════════════════════ */}
      <Section title="8. Conversion Detection — How We Know It Worked" icon={Zap} color="#ef4444">
        <p>The <strong>ConversionDetector</strong> answers the question: "did the journey messages actually lead to a booking?" It checks 3 signals, runs daily at 5 AM Dubai.</p>

        <h4 style={{ marginTop: 20 }}>7.1 The Three Signals</h4>
        <Tbl headers={['Signal', 'Source', 'Strength', 'What It Tells Us']} rows={[
          ['UTM Click', 'user_utm_links (click_count > 0)', 'Intent', 'Customer clicked the link in our email/WhatsApp — they\'re interested'],
          ['GTM Event', 'gtm_events (purchase, begin_checkout)', 'Engagement', 'Customer started buying on the website — strong conversion signal'],
          ['Rayna Booking', 'rayna_tours/hotels/visas/flights (bill_date > entered_at)', 'Definitive', 'Actual confirmed booking exists — this is the real conversion'],
        ]} />

        <h4 style={{ marginTop: 20 }}>7.2 ConversionDetector.runAll() — 5 Steps</h4>
        <ol style={{ paddingLeft: 20 }}>
          <li><strong>checkUTMClicks():</strong> For active journey entries, checks if the customer clicked any UTM link for this journey's campaigns. Logs it as a <M>utm_clicked</M> event (doesn't convert yet, just tracks engagement)</li>
          <li><strong>checkGTMEvents():</strong> Checks gtm_events and ga4_events for purchase/begin_checkout events from customers in active journeys. If found → <M>status = 'converted'</M>, <M>exit_reason = 'gtm_purchase'</M></li>
          <li><strong>checkRaynaBookings():</strong> For each of the 4 Rayna tables, checks if any booking has a <M>bill_date</M> newer than the customer's <M>entered_at</M>. This is the <strong>definitive conversion</strong> — they actually booked. Sets <M>status = 'converted'</M></li>
          <li><strong>exitStaleEntries():</strong> Checks if a customer's <M>booking_status</M> no longer matches the journey's segment. Example: customer was ACTIVE_ENQUIRY when they entered, but <M>computeSegments()</M> moved them to PAST_BOOKING because they booked. The old journey entry is exited with <M>exit_reason = 'segment_changed'</M></li>
          <li><strong>autoEnroll():</strong> For each active journey, finds customers in that segment who aren't yet enrolled and creates new <M>journey_entries</M> for them. This is how new customers automatically start receiving messages</li>
        </ol>

        <Callout type="success">
          <strong>The full conversion loop:</strong> Customer gets email → clicks UTM link (tracked) → views Burj Khalifa on website (GTM tracks) → adds to cart (GTM tracks) → books the tour (Rayna API sync picks it up) → ConversionDetector detects the booking → marks journey entry as converted → stops all future messages → computeSegments() moves them from ACTIVE_ENQUIRY to PAST_BOOKING → autoEnroll() puts them in the "Past Booking — Cross-Sell" journey → they start getting review requests and cross-sell offers instead
        </Callout>

        <p><strong>Key file:</strong> <M>backend/src/services/ConversionDetector.js</M></p>
      </Section>

      {/* ══════════════════════════════════════════════════════════ */}
      <Section title="9. Product Affinity — Personalized Recommendations" icon={DollarSign} color="#f59e0b">
        <p>When a customer browses the Rayna Tours website, GTM tracks which products they view, add to cart, or purchase. The <strong>ProductAffinityService</strong> scores these interactions and recommends products in journey messages.</p>

        <h4 style={{ marginTop: 20 }}>8.1 Scoring Weights</h4>
        <Tbl headers={['GTM Event', 'Weight', 'Why']} rows={[
          ['purchase', '100 points', 'Strongest signal — they already bought it, recommend similar'],
          ['begin_checkout', '50 points', 'Very strong — they almost paid, might need a nudge'],
          ['add_to_cart', '25 points', 'Medium — they\'re seriously considering it'],
          ['add_to_wishlist', '15 points', 'Soft intent — saving for later'],
          ['view_item / page_view', '5 points', 'Browsing — weakest individually but most common'],
        ]} />

        <p><strong>Score formula:</strong> <M>(purchases × 100) + (checkouts × 50) + (carts × 25) + (wishlists × 15) + (views × 5)</M></p>

        <p><strong>Example:</strong> Customer viewed Burj Khalifa 3 times (15 pts) + added to cart once (25 pts) = <strong>affinity score 40</strong>. Desert Safari viewed once = score 5. So Burj Khalifa is the primary recommendation for this customer.</p>

        <h4 style={{ marginTop: 20 }}>8.2 How Recommendations Work</h4>
        <p><M>getTemplateProducts(unifiedId)</M> returns:</p>
        <ul style={{ paddingLeft: 20 }}>
          <li><strong>Primary product:</strong> Their highest-affinity product with a reason ("Still in your cart", "You were viewing this", "You almost booked this")</li>
          <li><strong>Recommendations:</strong> Similar products from the same category + popular products to fill remaining slots</li>
        </ul>

        <Callout type="info">
          <strong>Product matching:</strong> The affinity table stores product names from GTM events, but the products table has product data from the catalog API. They're linked by matching <M>LOWER(product_name)</M> or by finding the productId in the URL. This linking allows us to show price, image, and booking URL in the recommendation.
        </Callout>

        <p><strong>880 products</strong> across 89 cities, 127 categories. <strong>Key file:</strong> <M>backend/src/services/ProductAffinityService.js</M></p>
      </Section>

      {/* ══════════════════════════════════════════════════════════ */}
      <Section title="10. Campaign & UTM Tracking Chain" icon={Megaphone} color="#6366f1">
        <p>The full chain from customer segment to tracked click:</p>

        <Flow steps={[
          { label: 'Segment (ON_TRIP)' },
          { label: 'Strategy (Upsell & Support)' },
          { label: 'Journey (7-day flow)' },
          { label: 'Campaign (WA Upsell)' },
          { label: 'Template (Day 0 Welcome)' },
          { label: 'UTM Link (campaign-level)' },
          { label: 'User Link (per-user token)' },
          { label: 'Click → rid → GTM → attribution' },
        ]} />

        <h4 style={{ marginTop: 20 }}>9.1 Data Counts</h4>
        <Tbl headers={['Layer', 'Count', 'Stored In']} rows={[
          ['Segments', '10 (6 B2C + 4 B2B)', 'segment_definitions'],
          ['Strategies', '11 (6 B2C + 4 B2B + 1 Occasion)', 'omnichannel_strategies'],
          ['Journeys', '11 (each with 10-15 nodes)', 'journey_flows'],
          ['Campaigns', '15 (one per segment per channel)', 'campaigns'],
          ['Templates', '65 (one per journey action node, rebuilt 2026-04-21)', 'content_templates'],
          ['UTM Links', '15 (one per campaign)', 'utm_tracking'],
          ['User Links', 'Generated per user per campaign', 'user_utm_links'],
        ]} />

        <h4 style={{ marginTop: 20 }}>9.2 UTM User-Level Tracking</h4>
        <p>Each customer gets a <strong>unique token</strong> per campaign. When they click:</p>
        <ol style={{ paddingLeft: 20 }}>
          <li>Hit <M>/api/v3/utm/track/:token</M></li>
          <li>Server records <M>click_count++</M>, <M>first_clicked_at</M>, <M>last_clicked_at</M></li>
          <li>302 redirect to destination URL with <M>?rid=UNIFIED_ID</M></li>
          <li>GTM on the website reads <M>rid</M> parameter</li>
          <li>All subsequent events (page views, cart, purchase) are attributed to this customer</li>
        </ol>

        <p><strong>Key files:</strong> <M>backend/src/services/UTMService.js</M>, <M>backend/src/routes/utm.js</M></p>
      </Section>

      {/* ══════════════════════════════════════════════════════════ */}
      <Section title="11. Cron Schedule — What Runs When" icon={Clock} color="#f97316">
        <p>All automated jobs with their exact timing (Dubai timezone = UTC+4):</p>

        <Tbl headers={['Dubai Time', 'UTC', 'Cron Expression', 'Job', 'Service', 'Duration']} rows={[
          ['Every 10 min', '—', '*/10 * * * *', 'MySQL sync: contacts, chats, tickets, travel_data', 'MySQLSyncService.pullAllTables()', '~30s'],
          ['3:15 AM', '23:15', '15 23 * * *', 'Server pull: departments, department_emails', 'MySQLSyncService.pullServerTables()', '~10s'],
          ['3:30 AM', '23:30', '30 23 * * *', 'Full unified sync (12 steps) + daily segment snapshot', 'UnifiedContactSync.run() + snapshotDailySegments()', '~2-5 min'],
          ['4:00 AM', '00:00', '0 0 * * *', 'Rayna API 30-day catch-up (re-fetch modifications)', 'RaynaSyncService.syncCatchUp(30)', '~10-20 min'],
          ['5:00 AM', '01:00', '0 1 * * *', 'Journey engine: conversion detection + process all journeys', 'ConversionDetector.runAll() + JourneyService.processJourney()', '~1-3 min'],
          ['6:00 AM', '02:00', '0 2 * * *', 'Rayna API incremental sync + product catalog + affinity refresh', 'RaynaSyncService.syncAll() + ProductAffinityService.runAll()', '~5-10 min'],
        ]} />

        <Callout type="info">
          <strong>Why this order matters:</strong> MySQL data syncs first (contacts, chats). Then unified sync runs to merge and segment. Then Rayna catch-up picks up any modified bookings. Then the journey engine runs with up-to-date segments. Finally, incremental Rayna sync and product refresh happen last.
        </Callout>
      </Section>

      {/* ══════════════════════════════════════════════════════════ */}
      <Section title="12. Database Tables — Complete Reference" icon={Database} color="#06b6d4">
        <h4>Core Identity & Booking Tables</h4>
        <Tbl headers={['Table', 'Rows', 'Purpose', 'Key Columns']} rows={[
          ['unified_contacts', '~1.6M', 'Single source of truth for all customers', 'unified_id (PK), email_key, phone_key, booking_status, product_tier, geography, is_indian, current_occasion'],
          ['rayna_tours', '~100K', 'Tour bookings from Rayna API', 'id (serial PK), billno, tour_date, guest_contact, grnty_email, unified_id (FK), total_sell'],
          ['rayna_hotels', '~4K', 'Hotel bookings from Rayna API', 'id, billno, check_in_date, guest_contact, unified_id, total_sell'],
          ['rayna_visas', '~26K', 'Visa bookings from Rayna API', 'id, billno, guest_name, visa_type, apply_date, passport_number, unified_id'],
          ['rayna_flights', '~1K', 'Flight bookings from Rayna API', 'id, billno, flight_no, from_datetime, unified_id, selling_price'],
          ['chats', '~406K', 'WhatsApp chat records', 'id (MySQL PK), wa_id, wa_name, last_msg_at, unified_id'],
          ['chat_contacts', '~150K', 'Aggregated 1 row per unique WA phone', 'wa_id (PK), total_chats, first_chat_at, last_chat_at'],
          ['ga4_events', '~1.2M', 'GA4 analytics events from BigQuery', 'event_name, event_ts, page_location, unified_id'],
          ['gtm_events', '~60', 'Real-time GTM events from website', 'event_name, page_url, raw_payload (JSONB), unified_id'],
          ['products', '880', 'Product catalog from Rayna API', 'product_id (PK), name, type, category, sale_price, url, image_url'],
          ['user_product_affinity', 'Dynamic', 'Per-user product interest scores', 'unified_id, product_name, affinity_score, view/cart/purchase counts'],
        ]} />

        <h4 style={{ marginTop: 20 }}>Segmentation & Occasion Tables</h4>
        <Tbl headers={['Table', 'Rows', 'Purpose', 'Key Columns']} rows={[
          ['segment_definitions', '10', 'Segment rules and metadata', 'segment_name, customer_type (B2B/B2C), sql_criteria, priority, key_points'],
          ['funnel_stages', '4', 'Groups segments into lifecycle stages', 'stage_name, stage_color, sort_order'],
          ['segment_daily_log', 'Daily', 'Daily snapshot of segment counts', 'log_date, segment_label, total_count, entered, exited, converted, reached'],
          ['holidays_calendar', '50', 'Holiday dates per country', 'holiday_name, holiday_date, country, offer_tag, entry_days (default 14)'],
          ['user_occasions', 'Dynamic', 'Customer ↔ holiday assignments', 'unified_id, holiday_id, status (active/exited), entered_at, exited_at'],
        ]} />

        <h4 style={{ marginTop: 20 }}>Journey & Campaign Tables</h4>
        <Tbl headers={['Table', 'Rows', 'Purpose', 'Key Columns']} rows={[
          ['omnichannel_strategies', '11', 'Strategy playbooks with step-by-step flow', 'name, segment_label, channels[], flow_steps (JSON array)'],
          ['journey_flows', '11', 'Visual journey graphs', 'nodes (JSON), edges (JSON), goal_type, total_entries, total_conversions'],
          ['journey_entries', 'Dynamic', 'One row per customer per journey enrollment', 'journey_id, customer_id (=unified_id), current_node_id, status, entered_at'],
          ['journey_events', 'Dynamic', 'Action log per node per entry', 'entry_id, node_id, event_type, channel, details (JSON)'],
          ['campaigns', '15', 'Campaigns linking segment → template', 'segment_label, channel, template_id, journey_id, sent/delivered/read/click counts'],
          ['content_templates', '65', 'Message templates for email/WA/SMS (one per journey action node)', 'channel, subject, body, external_provider, external_template_id, external_status, external_approved_at'],
          ['template_approval_events', 'Dynamic', 'Audit trail of every Gupshup approval state change', 'template_id, provider, event_type (submitted/status_update/status_checked/send_blocked), previous_status, new_status, details (JSONB)'],
          ['utm_tracking', '15', 'Campaign-level UTM links', 'campaign_id, utm_source/medium/campaign/content, full_url, clicks, conversions'],
          ['user_utm_links', 'Dynamic', 'Per-user unique tracking tokens', 'utm_id, unified_id, token, click_count, first/last_clicked_at'],
          ['sync_metadata', '~15', 'Last sync timestamp per table', 'table_name, last_synced_at, rows_synced, sync_status, error_message'],
        ]} />

        <h4 style={{ marginTop: 20 }}>content_templates — Gupshup Approval Columns</h4>
        <Tbl headers={['Column', 'Type', 'Purpose']} rows={[
          ['external_provider', 'TEXT', "'gupshup' — which provider owns the approval (null for email)"],
          ['external_template_id', 'TEXT', 'Gupshup template UUID (WA) or DLT Content Template ID (SMS)'],
          ['external_status', 'TEXT', "not_submitted | pending | approved | rejected | paused | disabled | error"],
          ['external_category', 'TEXT', 'WA: MARKETING/UTILITY/AUTHENTICATION  |  SMS: transactional/promotional/service'],
          ['external_language', 'TEXT', "Language code, default 'en'"],
          ['external_submitted_at / approved_at / rejected_at', 'TIMESTAMPTZ', 'Timestamps per state transition'],
          ['external_rejection_reason', 'TEXT', "Meta's reason when status is rejected"],
          ['external_last_checked_at', 'TIMESTAMPTZ', 'Last time we polled Gupshup for this template'],
          ['external_payload', 'JSONB', "Raw response from Gupshup's last interaction (for debugging)"],
        ]} />
      </Section>

      {/* ══════════════════════════════════════════════════════════ */}
      <Section title="13. API Endpoints — Complete Reference" icon={Code} color="#94a3b8">
        <h4>Unified Contacts & Segmentation</h4>
        <Tbl headers={['Method', 'Endpoint', 'Purpose', 'Key Params']} rows={[
          ['GET', '/api/v3/unified-contacts', 'Paginated contact list', 'page, limit, search, sortBy, contactType, bookingStatus, productTier, geography'],
          ['GET', '/api/v3/unified-contacts/:id', 'Contact detail + booking tables (tours/hotels/visas/flights/chats)', 'id = unified_id'],
          ['GET', '/api/v3/unified-contacts/segmentation-tree', 'Dashboard data: totals, status counts, 3-way breakdown', 'businessType (B2B/B2C)'],
          ['GET', '/api/v3/unified-contacts/segment-customers', 'Customers for a specific segment combo', 'bookingStatus, productTier, geography, search, page'],
          ['GET', '/api/v3/unified-contacts/segment-activity', 'Daily segment log (entries/exits/reach)', 'days, segment'],
          ['POST', '/api/v3/unified-contacts/sync', 'Manually trigger full 12-step unified sync', 'None'],
          ['POST', '/api/v3/unified-contacts/snapshot-daily', 'Capture today\'s segment counts', 'None'],
          ['GET', '/api/v3/unified-contacts/segment-activity/download', 'CSV export of daily log', 'days, segment'],
          ['GET', '/api/v3/unified-contacts/segment-customers/download', 'CSV export of segment customers', 'bookingStatus'],
        ]} />

        <h4 style={{ marginTop: 20 }}>Rayna Sync</h4>
        <Tbl headers={['Method', 'Endpoint', 'Purpose']} rows={[
          ['GET', '/api/v3/rayna-sync/status', 'Sync status + row counts for all 4 tables'],
          ['POST', '/api/v3/rayna-sync/trigger', 'Incremental sync all 4 endpoints'],
          ['POST', '/api/v3/rayna-sync/trigger/:endpoint', 'Sync one endpoint (tours/hotels/visas/flights)'],
          ['POST', '/api/v3/rayna-sync/catch-up', 'Re-fetch last N days {body: days: 90}'],
          ['POST', '/api/v3/rayna-sync/historical/:endpoint', 'Backfill N months {body: months: 6}'],
        ]} />

        <h4 style={{ marginTop: 20 }}>Journeys & Conversion</h4>
        <Tbl headers={['Method', 'Endpoint', 'Purpose']} rows={[
          ['GET', '/api/v3/journeys', 'List all journeys'],
          ['GET', '/api/v3/journeys/:id', 'Journey detail + entry stats + node analytics'],
          ['POST', '/api/v3/journeys/:id/process', 'Process one journey (advance nodes)'],
          ['POST', '/api/v3/journeys/process-all', 'Process all active journeys'],
          ['POST', '/api/v3/journeys/detect-conversions', 'Run full ConversionDetector.runAll()'],
          ['POST', '/api/v3/journeys/:id/enroll', 'Enroll segment customers into journey'],
        ]} />

        <h4 style={{ marginTop: 20 }}>Product Affinity & UTM</h4>
        <Tbl headers={['Method', 'Endpoint', 'Purpose']} rows={[
          ['POST', '/api/v3/affinity/sync', 'Sync products + refresh affinity scores'],
          ['GET', '/api/v3/affinity/user/:id', 'User\'s product affinity scores (top N)'],
          ['GET', '/api/v3/affinity/user/:id/recommendations', 'Personalized product recommendations'],
          ['GET', '/api/v3/affinity/user/:id/template-products', 'Products formatted for email/WA templates'],
          ['GET', '/api/v3/utm/track/:token', 'Track click + 302 redirect with rid param'],
          ['POST', '/api/v3/gtm/event', 'Receive real-time GTM events from website'],
        ]} />

        <h4 style={{ marginTop: 20 }}>Gupshup Approval (WhatsApp + SMS)</h4>
        <Tbl headers={['Method', 'Endpoint', 'Purpose']} rows={[
          ['GET',  '/api/v3/gupshup/config', 'Whether WA + SMS credentials are live or simulated'],
          ['POST', '/api/v3/gupshup/templates/:id/submit', 'Submit a WA/SMS template for Gupshup/Meta approval'],
          ['POST', '/api/v3/gupshup/templates/:id/check-status', 'Poll Gupshup for current template status'],
          ['POST', '/api/v3/gupshup/templates/:id/set-external-id', 'Manually set external ID (e.g. DLT Content Template ID)'],
          ['POST', '/api/v3/gupshup/templates/:id/force-approve', 'Dev bypass — flip to approved without calling Gupshup'],
          ['GET',  '/api/v3/gupshup/templates/:id/events', 'Audit trail of approval state transitions'],
          ['POST', '/api/v3/gupshup/bulk-submit', 'Submit every not_submitted WA/SMS template'],
          ['POST', '/api/v3/gupshup/webhook/wa', 'Gupshup template-status webhook (Meta approvals)'],
          ['POST', '/api/v3/gupshup/webhook/sms', 'Gupshup SMS delivery receipts'],
        ]} />
      </Section>

      {/* ══════════════════════════════════════════════════════════ */}
      <Section title="14. Frontend Pages & Navigation" icon={Activity} color="#e2b340">
        <Tbl headers={['Page', 'Route', 'What It Shows', 'Key API Calls']} rows={[
          ['Dashboard', '/', 'KPIs, segment chart, revenue table, quick actions', 'getSegmentationTree, getSegmentActivity'],
          ['Segmentation', '/segmentation', '3-step decision tree: status cards → tier × geo → customer drill-down', 'getSegmentationTree, getSegmentCustomers'],
          ['Segment Activity', '/segment-activity', 'Daily entries/exits/conversions/reach table + customer detail + CSV download', 'getSegmentActivity, getSegmentCustomers'],
          ['Contacts', '/contacts', 'Unified contact list + detail modal with expandable booking tables', 'getUnifiedContacts, getUnifiedContact'],
          ['Journeys', '/journeys', 'Visual flow builder with drag-drop nodes, analytics, enrollments', 'getJourneys, getJourney, processJourney'],
          ['Campaigns', '/campaigns', 'Campaign list with metrics per channel + segment', 'getCampaigns, createCampaign, executeCampaign'],
          ['Content', '/content', '65 templates with preview, AI generation, Gupshup approval workflow for WA/SMS', 'getTemplates, createTemplate, submitTemplateForApproval, checkGupshupStatus'],
          ['UTM Tracking', '/utm', 'Campaign UTM links + per-user token generation + click stats', 'getUTMLinks, generateUserLinks'],
          ['GTM & BigQuery', '/gtm', 'GTM tag setup, event log, GA4 sync status', 'getGTMEvents, getGA4Status'],
          ['Data Pipeline', '/data-pipeline', 'All sync statuses, row counts, manual sync triggers', 'getSyncStatus, triggerSync'],
          ['Daily Report', '/daily-report', 'Daily data reports with table downloads', 'getDailyReport, downloadReport'],
          ['System Docs', '/system', 'This page — complete project documentation', 'None (static)'],
        ]} />

        <p><strong>Global B2B/B2C Switcher:</strong> Toggle in the sidebar bottom. Changes <M>businessType</M> context which is read by Dashboard, Segmentation, Contacts, and Segment Activity pages to filter all data. Persisted in localStorage.</p>
      </Section>

      {/* ══════════════════════════════════════════════════════════ */}
      <Section title="15. Environment & Deployment" icon={Shield} color="#64748b">
        <h4>Environment Variables (.env file)</h4>
        <Tbl headers={['Variable', 'Purpose', 'Example Value']} rows={[
          ['DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASS', 'PostgreSQL connection', 'localhost, 5432, rayna_data_pipe'],
          ['RAYNA_API_URL', 'Rayna booking API base URL', 'http://raynaacico.dyndns.tv:8091'],
          ['RAYNA_API_TOKEN', 'Bearer token for Rayna API', '9e57a50bde40c697b2522f...'],
          ['RAYNA_SYNC_ENABLED', 'Enable/disable cron sync jobs', 'true'],
          ['MYSQL_SYNC_BATCH_SIZE', 'Rows per batch for MySQL upserts', '500'],
          ['PORT', 'Backend HTTP port', '3001'],
          ['ALLOWED_ORIGINS', 'CORS allowed frontend origins', 'http://localhost:5173, https://raynadata.netlify.app'],
          ['VITE_API_URL', 'Frontend → Backend API base URL (Netlify env var)', 'https://qh6hjtm8-3001.inc1.devtunnels.ms'],
          ['SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS', 'Email sending via SMTP/SendGrid', 'smtp.sendgrid.net, 587'],
        ]} />

        <h4 style={{ marginTop: 20 }}>Gupshup — WhatsApp + SMS Approval & Send</h4>
        <p>All of these are optional — if absent, the approval pipeline runs in simulation mode (submissions marked <M>pending</M> with fake external IDs, sends return <M>{`{simulated: true}`}</M>). Drop them into <M>backend/.env</M> when ready to go live.</p>
        <Tbl headers={['Variable', 'Channel', 'Purpose']} rows={[
          ['GUPSHUP_API_KEY',        'WA', 'Gupshup API key from dashboard → API section'],
          ['GUPSHUP_APP_NAME',       'WA', 'Your Gupshup app name (exact)'],
          ['GUPSHUP_APP_ID',         'WA', 'Numeric app ID under Account Details'],
          ['GUPSHUP_WA_SOURCE',      'WA', 'Registered WhatsApp Business number (international, no +)'],
          ['GUPSHUP_WA_NAMESPACE',   'WA', 'Template namespace UUID from Gupshup dashboard'],
          ['GUPSHUP_CALLBACK_SECRET','WA', 'Shared secret for verifying incoming webhook POSTs'],
          ['GUPSHUP_SMS_USER_ID',    'SMS', 'Gupshup SMS API user ID'],
          ['GUPSHUP_SMS_PASSWORD',   'SMS', 'Gupshup SMS API password'],
          ['GUPSHUP_SMS_SENDER_ID',  'SMS', '6-char DLT-registered sender mask, e.g. RAYNAT'],
          ['DLT_PRINCIPAL_ENTITY_ID','SMS', '19-digit Principal Entity ID from TRAI DLT portal'],
          ['DLT_TELEMARKETER_ID',    'SMS', 'DLT Telemarketer ID (Gupshup provides)'],
          ['DLT_HEADER_ID',          'SMS', 'DLT Header ID for your sender mask'],
        ]} />
        <Callout type="info">
          Per-template DLT Content Template IDs (issued by TRAI when each SMS template is registered) are stored on individual <M>content_templates</M> rows via <M>POST /api/v3/gupshup/templates/:id/set-external-id</M> — not as env vars.
        </Callout>

        <h4 style={{ marginTop: 20 }}>Deployment Architecture</h4>
        <Tbl headers={['Component', 'Where', 'URL']} rows={[
          ['Frontend', 'Netlify', 'raynadata.netlify.app'],
          ['Backend', 'Local + VS Code port forwarding', 'localhost:3001 → devtunnels.ms'],
          ['Database', 'PostgreSQL 14 (local)', 'localhost:5432'],
          ['Product API', 'Vercel', 'data-projects-flax.vercel.app'],
          ['Rayna Booking API', 'Rayna ACICO server', 'raynaacico.dyndns.tv:8091'],
          ['MySQL (contacts)', 'Remote MySQL', '95.211.169.194:3306'],
          ['MySQL (chats)', 'Remote MySQL', '5.79.64.193:3306'],
        ]} />

        <h4 style={{ marginTop: 20 }}>Key File Structure</h4>
        <pre style={{ background: 'var(--secondary)', padding: 16, borderRadius: 8, fontSize: 12, overflow: 'auto', lineHeight: 1.6 }}>{`backend/
  server.js                          # Express app + cron jobs + route registration
  src/
    config/database.js               # PostgreSQL pool connection
    services/
      UnifiedContactSync.js          # ★ Core: 12-step sync + segmentation + occasions
      RaynaSyncService.js            # Rayna API sync (4 endpoints, 3 strategies)
      MySQLSyncService.js            # MySQL → PG incremental sync
      JourneyService.js              # Journey CRUD + flow execution engine
      ConversionDetector.js          # UTM + GTM + booking conversion detection
      ProductAffinityService.js      # Product sync + affinity scoring
      UnifiedContactService.js       # Contacts API queries + segmentation tree
      GTMService.js                  # GTM event receiver + tag generator
      BigQuerySyncService.js         # GA4 BigQuery sync
      UTMService.js                  # UTM link management + user tokens
    routes/
      unifiedContacts.js             # /api/v3/unified-contacts/*
      raynaSync.js                   # /api/v3/rayna-sync/*
      journeys.js                    # /api/v3/journeys/*
      productAffinity.js             # /api/v3/affinity/*
      utm.js                         # /api/v3/utm/*
      gtm.js                         # /api/v3/gtm/*
    migrations/
      033-042                        # Recent migrations (visa fields → B2B setup)

frontend/
  src/
    App.jsx                          # Router, nav, ThemeProvider, BusinessTypeProvider
    api.js                           # All API fetch functions
    pages/
      Dashboard.jsx                  # Overview KPIs + charts
      CustomerSegmentation.jsx       # 3-step decision tree visual
      SegmentActivity.jsx            # Daily entries/exits/reach table
      UnifiedContacts.jsx            # Contact list + booking detail modal
      Journeys.jsx                   # Visual flow builder
      Campaigns.jsx                  # Campaign management
      Content.jsx                    # Template management
      UTMTracking.jsx                # UTM + user-level links
      GTMIntegration.jsx             # GTM setup + events
      DataPipeline.jsx               # Sync status dashboard
      DailyReport.jsx                # Daily reports
      SystemArchitecture.jsx         # This documentation page`}</pre>
      </Section>

      {/* ══════════════════════════════════════════════════════════ */}
      <Section title="16. Troubleshooting & Common Issues" icon={AlertTriangle} color="#ef4444">
        <Tbl headers={['Problem', 'Likely Cause', 'How to Fix']} rows={[
          ['Segment counts show 0', 'computeSegments() hasn\'t run yet', 'Trigger sync: POST /api/v3/unified-contacts/sync'],
          ['New Rayna bookings not showing', 'Incremental sync hasn\'t run or API is down', 'Check: GET /api/v3/rayna-sync/status, then POST /api/v3/rayna-sync/trigger'],
          ['Customer not in unified_contacts', 'Phone/email doesn\'t match or is junk (0000000)', 'Check raw tables for their guest_contact/grnty_email, fix data quality'],
          ['Journey messages not sending', 'processJourney() not run, or no journey_entries', 'POST /api/v3/journeys/process-all, check if autoEnroll ran'],
          ['Conversion not detected', 'ConversionDetector hasn\'t run, or booking bill_date < entered_at', 'POST /api/v3/journeys/detect-conversions, check dates'],
          ['CORS error on Netlify', 'Backend ALLOWED_ORIGINS missing the Netlify URL', 'Add URL to ALLOWED_ORIGINS in server.js'],
          ['Port 3443 in use error', 'Previous backend instance not killed', 'Kill process: lsof -ti :3443 | xargs kill -9'],
          ['Empty product affinity', 'No GTM events captured yet (GTM tag not live)', 'Deploy GTM tag on raynatours.com, wait for events'],
          ['Occasion segment not triggering', 'Holiday is >90 days away, or country doesn\'t match', 'Check holidays_calendar.entry_days (now 90) and customer country field'],
          ['B2B filter shows no data', 'contact_type is null for most contacts', 'Contacts with no type default to B2C; check chat_departments for B2B flag'],
          ['WA/SMS test-send fails "not approved"', 'Template hasn\'t been Gupshup-approved yet', 'Content page → "Submit for approval", then "Check status" when ready. Or "Force approve (dev)" in simulation mode'],
          ['Submit-for-approval returns simulated', 'GUPSHUP_API_KEY not set in backend/.env', 'Normal in dev — simulation is the intended fallback. Add keys when going live'],
          ['SMS stuck pending forever', 'DLT Content Template ID never set', 'Register template on TRAI portal, then POST /api/v3/gupshup/templates/:id/set-external-id with the 19-digit ID'],
          ['Gupshup webhook never fires', 'Callback URL not configured on Gupshup dashboard, or not publicly reachable', 'Set POST https://<your-public-host>/api/v3/gupshup/webhook/wa in Gupshup dashboard → Inbox Settings'],
          ['journey_events shows action_blocked', 'Journey tried to send via unapproved template', 'Approve the template via Gupshup pipeline. Blocked sends do not retry automatically — next cron cycle will retry once status becomes approved'],
        ]} />
      </Section>

    </motion.div>
  );
}
