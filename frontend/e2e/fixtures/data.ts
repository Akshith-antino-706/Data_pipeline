import type { Json } from './mocks';

const iso = (d: number) => new Date(Date.UTC(2026, 9, d, 8, 30)).toISOString();

export const contacts: { [key: string]: Json }[] = [
  { id: 101, name: 'Aisha Khan', email: 'aisha@example.com', phone: '+971500000001', country: 'UAE', booking_status: 'FUTURE_TRAVEL', product_tier: 'LUXURY', geography: 'LOCAL', total_tour_bookings: 2, total_package_bookings: 1, total_booking_revenue: '4520.50' },
  { id: 102, name: 'Rahul Mehta', email: 'rahul@example.com', phone: '+919800000002', country: 'India', booking_status: 'PAST_BOOKING', product_tier: 'STANDARD', geography: 'INTERNATIONAL', total_tour_bookings: 1, total_booking_revenue: '899.00' },
  { id: 103, name: 'Sara Lopez', email: 'sara@example.com', mobile: '+34600000003', country: 'Spain', booking_status: 'ACTIVE_ENQUIRY', total_booking_revenue: '0' },
];

export const unifiedStats: Json = {
  total_contacts: 1250, with_travel: 400, multi_source: 120, countries: 42,
  total_revenue: '985432.75', total_bookings: 3120, conversations_7d: 88,
};

export const journeyNodes: Json = [
  { id: 'n1', type: 'trigger', data: { label: 'Journey entry' }, position: { x: 0, y: 0 } },
  { id: 'n2', type: 'action', data: { label: 'Welcome email', channel: 'email', templateId: 7, templateName: 'Welcome' }, position: { x: 0, y: 120 } },
  { id: 'n3', type: 'wait', data: { label: 'Wait', waitDays: 2 }, position: { x: 0, y: 240 } },
  { id: 'n4', type: 'action', data: { label: 'Follow-up WhatsApp', channel: 'whatsapp' }, position: { x: 0, y: 360 } },
];

export const journeys: { [key: string]: Json }[] = [
  { journey_id: 11, id: 11, name: 'Welcome Series', description: 'Onboarding flow', segment_name: 'New Leads', status: 'active', journey_type: 'segment', total_entries: 320, node_count: 4, total_conversions: 12, conversion_rate: '3.75', nodes: journeyNodes, created_at: iso(1), updated_at: iso(10), snapshot_count: 320 },
  { journey_id: 12, id: 12, name: 'Win-back Campaign', description: 'Re-engage lapsed', segment_name: 'Lapsed', status: 'paused', journey_type: 'segment', total_entries: 80, node_count: 4, total_conversions: 2, conversion_rate: '2.50', nodes: journeyNodes, created_at: iso(2), updated_at: iso(9), snapshot_count: 80 },
];

export const journeyDetail: Json = {
  ...journeys[0],
  edges: [{ id: 'e1', source: 'n1', target: 'n2' }, { id: 'e2', source: 'n2', target: 'n3' }, { id: 'e3', source: 'n3', target: 'n4' }],
  entryStats: { total_entries: '320', active: '200', completed: '100', exited_booked: '12', unsubscribed_during_journey: '3' },
  nodeAnalytics: [], nodeEntryCounts: [], nodeUnsubCounts: {}, node_stats: {}, node_statuses: { n2: 'sending' },
};

export const campaignAnalytics: Json = {
  campaigns: [{ channel: 'email', journey_node_id: 'n2', template_id: 7, target_count: '320', sent_count: '300', delivered_count: '290', read_count: '150', gtm_click_count: '20', click_count: '40', bounce_count: '10', fail_count: '0' }],
  gtm_clicks: { n2: 20 }, opens: { n2: 150 }, delivered_by_node: { n2: 290 }, bounced_by_node: { n2: 10 },
  target_count: '320',
  totals: { total_sent: 300, total_read: 150, total_clicked: 40 },
};

export function sendLogRows(page: number, limit: number, status: string | null, total: number): Json[] {
  const statuses = ['sent', 'opened', 'clicked', 'failed', 'queued'];
  const start = (page - 1) * limit;
  const count = Math.max(0, Math.min(limit, total - start));
  return Array.from({ length: count }, (_, i) => {
    const n = start + i + 1;
    const st = status || statuses[n % statuses.length];
    return {
      id: n, unified_id: 100 + n, email: `user${n}@example.com`, contact_name: `User ${n}`, subject: `Subject ${n}`,
      template_label: 'Welcome', day_number: 1, source: 'journey', journey_id: 11, node_id: 'n2', external_id: null,
      provider: 'ses', status: st, error_message: st === 'failed' ? 'Mailbox full' : null,
      sent_at: iso(5), opened_at: null, clicked_at: null, duration_ms: 120, created_at: iso(5), uc_name: `User ${n}`,
      email_unsubscribed: 'No',
    };
  });
}
