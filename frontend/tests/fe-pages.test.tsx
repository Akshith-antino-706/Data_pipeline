// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import * as api from '@/lib/api';
import { BusinessTypeProvider } from '@/context/BusinessTypeContext';
import UtmPage from '@/app/(dashboard)/utm/page';
import ContactsPage from '@/app/(dashboard)/contacts/page';
import ContactProfile from '@/app/(dashboard)/contacts/[id]/page';
import CampaignDetail from '@/app/(dashboard)/campaigns/[id]/page';

vi.mock('@/lib/api');

const nav = vi.hoisted(() => ({
  push: vi.fn<(href: string) => void>(),
  params: { id: '1' } as Record<string, string>,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: nav.push, back: () => {}, prefetch: () => {}, refresh: () => {} }),
  useParams: () => nav.params,
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

beforeEach(() => {
  // Every lib/api export is an auto-mock; default each to an empty successful response.
  for (const fn of Object.values(api)) {
    if (vi.isMockFunction(fn)) fn.mockResolvedValue({});
  }
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const bodyText = (): string => document.body.textContent ?? '';

describe('UTM page', () => {
  // The page keeps the open tab in ?tab=; start every test on the default tab.
  beforeEach(() => { window.history.replaceState(null, '', '/utm'); });

  it('renders email visits with valid, invalid and missing destination_url without crashing', async () => {
    vi.mocked(api.getEmailUtmLog).mockResolvedValue({ data: { total: 4, rows: [
      { id: 1, email: 'a@x.com', destination_url: 'https://raynatours.com/dubai/tours?x=1', created_at: '2026-10-01T00:00:00Z' },
      { id: 2, email: 'b@x.com', destination_url: 'not a url %%%', created_at: '2026-10-01T00:00:00Z' },
      { id: 3, email: 'c@x.com', destination_url: '', created_at: 'garbage-date' },
      { id: 4, email: 'd@x.com', created_at: '2026-10-01T00:00:00Z' },
    ] } });
    render(<UtmPage />);
    await screen.findByText('a@x.com');
    expect(screen.getByText('/dubai/tours')).toBeTruthy();
    expect(screen.getByText('not a url %%%')).toBeTruthy();
    expect(screen.getByText('d@x.com')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Website & links' })).toBeTruthy();
    expect(bodyText()).not.toContain('NaN');
    expect(bodyText()).not.toContain('Invalid Date');
  });

  it('link builder rejects an invalid URL with an error toast and does not call the API', async () => {
    vi.mocked(api.getUTMSegments).mockResolvedValue({ data: [{ segment_name: 'Upcoming trip', utm_count: '0', campaign_count: '0', customer_count: 5 }] });
    render(<UtmPage />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Link builder' }));
    const audience = await screen.findByRole('option', { name: 'Upcoming trip (5 people)' });
    fireEvent.change(audience.closest('select') as HTMLSelectElement, { target: { value: 'Upcoming trip' } });
    fireEvent.change(screen.getByDisplayValue('https://www.raynatours.com/activities'), { target: { value: 'not a url' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. Spring_Sale_Email'), { target: { value: 'spring' } });
    fireEvent.click(screen.getByRole('button', { name: /Create link/ }));
    await screen.findByText(/Please enter a valid landing page URL/);
    expect(api.buildUTM).not.toHaveBeenCalled();
  });

  it('survives API errors and null payloads', async () => {
    vi.mocked(api.getEmailUtmLog).mockRejectedValue(new Error('HTTP 500'));
    vi.mocked(api.getEmailUtmSummary).mockResolvedValue(null);
    vi.mocked(api.getUTMAnalytics).mockRejectedValue(new Error('HTTP 502'));
    vi.mocked(api.getUTMSegments).mockResolvedValue(null);
    vi.mocked(api.getOverviewWebsite).mockRejectedValue(new Error('HTTP 502'));
    render(<UtmPage />);
    await waitFor(() => expect(api.getEmailUtmLog).toHaveBeenCalled());
    await screen.findByText(/Couldn't load email visits/);
    fireEvent.click(screen.getByRole('tab', { name: 'Campaign links' }));
    await screen.findByText(/Couldn't load campaign links/);
    expect(bodyText()).not.toContain('NaN');
  });
});

describe('Contacts list page', () => {
  const renderContacts = () => render(<BusinessTypeProvider><ContactsPage /></BusinessTypeProvider>);

  it('formatAED handles numeric strings from the API (regression)', async () => {
    vi.mocked(api.getUnifiedStats).mockResolvedValue({ data: { total_contacts: 10, total_bookings: 3, total_revenue: '12345.6' } } as unknown as Awaited<ReturnType<typeof api.getUnifiedStats>>);
    renderContacts();
    await screen.findByText('AED 12,346');
  });

  it('formatAED renders AED 0 for null / non-numeric revenue, never NaN', async () => {
    vi.mocked(api.getUnifiedStats).mockResolvedValue({ data: { total_contacts: 0, total_bookings: 0, total_revenue: 'abc' } } as unknown as Awaited<ReturnType<typeof api.getUnifiedStats>>);
    renderContacts();
    await screen.findByText('AED 0');
    expect(bodyText()).not.toContain('NaN');
  });

  it('row revenue as string is formatted; list API error does not crash', async () => {
    vi.mocked(api.getUnifiedContacts).mockResolvedValue({ data: [
      { id: 1, name: 'Ann', email: 'ann@x.com', total_booking_revenue: '2500.4' },
      { id: 2, name: 'Bob', email: 'bob@x.com', total_booking_revenue: 'oops' },
    ], total: 2, totalPages: 1 });
    renderContacts();
    await screen.findByText('Ann');
    expect(screen.getByText('AED 2,500')).toBeTruthy();
    expect(bodyText()).not.toContain('NaN');
    cleanup();
    vi.mocked(api.getUnifiedContacts).mockRejectedValue(new Error('HTTP 503'));
    renderContacts();
    await waitFor(() => expect(api.getUnifiedContacts).toHaveBeenCalled());
  });
});

describe('Contact profile page', () => {
  beforeEach(() => { nav.params = { id: '42' }; });
  const contact = (extra: Record<string, unknown>) => ({ data: { id: 42, name: 'Zed', email: 'z@x.com', ...extra } });

  it('status chip falls back to a neutral tone and readable label for an unknown booking_status (regression)', async () => {
    vi.mocked(api.getUnifiedContact).mockResolvedValue(contact({ booking_status: 'SOME_NEW_STATUS' }));
    render(<ContactProfile />);
    const chips = await screen.findAllByText('Some new status');
    expect(chips.length).toBeGreaterThan(0);
    for (const chip of chips) expect(chip.classList.contains('ui-chip--mute')).toBe(true);
  });

  it('known status uses its mapped tone', async () => {
    vi.mocked(api.getUnifiedContact).mockResolvedValue(contact({ booking_status: 'FUTURE_TRAVEL' }));
    render(<ContactProfile />);
    const chips = await screen.findAllByText('Upcoming trip');
    for (const chip of chips) expect(chip.classList.contains('ui-chip--info')).toBe(true);
  });

  it('activity timeline merges bookings, GTM events and journey emails, newest first', async () => {
    vi.mocked(api.getUnifiedContact).mockResolvedValue(contact({
      booking_status: 'PAST_BOOKING', total_tour_bookings: 1,
      rayna_tours: [{ bill_no: 'B1', service_name: 'Desert safari', booking_date: '01/03/2025', selling_price: '640', is_cancel: '0' }],
    }));
    vi.mocked(api.getContactGTMEvents).mockResolvedValue({ summary: [{ event_name: 'page_view', count: 1, total_value: '0' }], events: [{ event_name: 'page_view', page_url: 'https://x.com/dubai', created_at: '2026-05-02T10:00:00Z' }] });
    vi.mocked(api.getContactJourneys).mockResolvedValue({ data: [{ journey_id: 7, name: 'Welcome', journey_status: 'active', entry_status: 'active', nodes: [{ node_id: 'n1', subject: 'Hi', delivered: true, sent_at: '2025-06-01T09:00:00Z' }] }] });
    render(<ContactProfile />);
    const web = await screen.findByText('Page view · /dubai');
    const mail = screen.getByText('Sent email “Hi”');
    const booking = screen.getByText('Booked Desert safari — AED 640');
    expect(web.compareDocumentPosition(mail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(mail.compareDocumentPosition(booking) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(bodyText()).not.toMatch(/NaN|undefined|Invalid Date/);
  });

  it('shows "Contact not found" when the API errors', async () => {
    vi.mocked(api.getUnifiedContact).mockRejectedValue(new Error('HTTP 404'));
    render(<ContactProfile />);
    await screen.findByText(/Contact not found/);
  });

  // BUG app/(dashboard)/contacts/[id]/page.tsx:86 - formatAED does `(n || 0).toLocaleString(...)`;
  // when the API sends total_booking_revenue as a numeric string (PG NUMERIC), String#toLocaleString
  // ignores the options and prints the raw "12345.6" instead of "AED 12,346".
  it('profile formatAED formats string revenue', async () => {
    vi.mocked(api.getUnifiedContact).mockResolvedValue(contact({ booking_status: 'ON_TRIP', total_booking_revenue: '12345.6' }));
    render(<ContactProfile />);
    await screen.findByRole('heading', { level: 1, name: 'Zed' });
    expect(bodyText()).toContain('AED 12,346');
  });
});

describe('Campaign (journey) detail page', () => {
  beforeEach(() => { nav.params = { id: '9' }; });

  const journey = {
    data: {
      name: 'J', status: 'active', total_entries: 'x',
      nodes: [
        { id: 'n0', type: 'trigger' },
        { id: 'n1', type: 'action', data: { channel: 'email', templateName: 'T1' } },
        { id: 'n2', type: 'action', data: { channel: 'whatsapp' } },
      ],
    },
  };

  it('sent counts never render NaN for garbage / missing counts (regression)', async () => {
    vi.mocked(api.getJourney).mockResolvedValue(journey);
    vi.mocked(api.getJourneyCampaignAnalytics).mockResolvedValue({ data: {
      target_count: 'abc',
      campaigns: [
        { journey_node_id: 'n1', channel: 'email', sent_count: 'abc', target_count: '', bounce_count: 'NaN', fail_count: null },
        { journey_node_id: 'n2', channel: 'whatsapp', sent_count: null, target_count: null, bounce_count: null, fail_count: 'x' },
      ],
      totals: { total_sent: undefined, total_read: null },
    } });
    vi.mocked(api.getJourneyAnalytics).mockResolvedValue({ data: { nodeStats: [{ node_id: 'n1', event_type: 'action_sent', count: 'zz' }], funnelData: [] } });
    vi.mocked(api.getJourneyGtmNodeStats).mockResolvedValue({ data: {}, allEventTypes: ['purchase'] });
    render(<CampaignDetail />);
    await screen.findByText('T1');
    expect(bodyText()).not.toContain('NaN');
    // Expand an action node to pull analytics + GTM stats, and check again.
    fireEvent.click(screen.getByText('T1'));
    await waitFor(() => expect(api.getJourneyGtmNodeStats).toHaveBeenCalled());
    await waitFor(() => expect(bodyText()).not.toContain('NaN'));
  });

  // BUG app/(dashboard)/campaigns/[id]/page.tsx:57 - fmt() is `Number(n || 0).toLocaleString()`,
  // so a non-numeric string total (e.g. totals.total_clicked: 'abc') renders "NaN" in the stat tile.
  it('header stat tiles do not show NaN for non-numeric totals', async () => {
    vi.mocked(api.getJourney).mockResolvedValue(journey);
    vi.mocked(api.getJourneyCampaignAnalytics).mockResolvedValue({ data: { target_count: '1', campaigns: [], totals: { total_clicked: 'abc' } } });
    render(<CampaignDetail />);
    await screen.findByText('T1');
    expect(bodyText()).not.toContain('NaN');
  });

  it('numeric-string counts are shown as numbers', async () => {
    vi.mocked(api.getJourney).mockResolvedValue(journey);
    vi.mocked(api.getJourneyCampaignAnalytics).mockResolvedValue({ data: {
      target_count: '10',
      campaigns: [{ journey_node_id: 'n1', channel: 'email', sent_count: '1234', target_count: '10', bounce_count: '0', fail_count: '0' }],
      totals: { total_sent: 1234 },
    } });
    render(<CampaignDetail />);
    await screen.findByText('T1');
    expect(screen.getAllByText('1,234').length).toBeGreaterThan(0);
  });

  it('both initial APIs failing shows "Journey not found" instead of crashing', async () => {
    vi.mocked(api.getJourney).mockRejectedValue(new Error('HTTP 500'));
    vi.mocked(api.getJourneyCampaignAnalytics).mockRejectedValue(new TypeError('Failed to fetch'));
    render(<CampaignDetail />);
    await screen.findByText('Journey not found');
  });
});
