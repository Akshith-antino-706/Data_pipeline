// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import * as api from '@/lib/api';
import type { OverviewWebsite } from '@/lib/api';
import WebsiteOverview, { periodFrom, fmtNum } from '@/app/(dashboard)/utm/WebsiteOverview';

vi.mock('@/lib/api');

const bodyText = (): string => document.body.textContent ?? '';
const off = { available: false, reason: 'unavailable' } as const;

const full: OverviewWebsite = {
  range: { from: '2026-09-20', to: '2026-10-19', days: 30 },
  eventsPerDay: { available: true, days: [{ date: '2026-10-18', events: 1200 }, { date: '2026-10-19', events: 34 }] },
  topEvents: { available: true, events: [{ name: 'view_item', count: 900, uniqueUsers: 410 }, { name: 'purchase', count: 12, uniqueUsers: 11 }] },
  topPages: { available: true, pages: [{ url: 'https://www.raynatours.com/dubai/desert-safari?x=1', count: 321 }, { url: 'weird path', count: 2 }] },
  lastHour: { available: true, count: 17 },
  utmLinks: { available: true,
    totals: { links: 5000, clickedLinks: 230, clicks: 412, campaigns: 2, uniqueUsers: 198 },
    campaigns: [
      { campaignId: 7, name: 'Spring sale', segment: 'Upcoming trip', channel: 'email', links: 4000, clickedLinks: 200, clicks: 380, lastClick: '2026-10-18T10:00:00Z' },
      { campaignId: 8, name: null, segment: null, channel: null, links: 1000, clickedLinks: 30, clicks: 32, lastClick: null },
    ] },
};

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Website overview', () => {
  it('renders KPIs, top events, top pages and campaigns from real data', async () => {
    vi.mocked(api.getOverviewWebsite).mockResolvedValue(full);
    render(<WebsiteOverview />);
    await screen.findByText('1,234'); // total events = sum of days
    expect(screen.getByText('17')).toBeTruthy();
    expect(screen.getByText('5,000')).toBeTruthy();
    expect(screen.getByText('412')).toBeTruthy();
    expect(screen.getByText('Tracking is live')).toBeTruthy();
    expect(screen.getByText('view_item')).toBeTruthy();
    expect(screen.getByText('/dubai/desert-safari?x=1')).toBeTruthy();
    expect(screen.getByText('weird path')).toBeTruthy();
    expect(screen.getByText('Spring sale')).toBeTruthy();
    expect(screen.getByText('Campaign #8')).toBeTruthy();
    expect(screen.getByText('Never')).toBeTruthy();
    expect(screen.getByRole('img', { name: /1,234 in total/ })).toBeTruthy();
    expect(bodyText()).not.toContain('NaN');
  });

  it('period picker refetches with a from date for the chosen range', async () => {
    vi.mocked(api.getOverviewWebsite).mockResolvedValue(full);
    render(<WebsiteOverview />);
    await screen.findByText('1,234');
    expect(api.getOverviewWebsite).toHaveBeenLastCalledWith(periodFrom(30));
    fireEvent.change(screen.getByLabelText('Period'), { target: { value: '7' } });
    await waitFor(() => expect(api.getOverviewWebsite).toHaveBeenLastCalledWith(periodFrom(7)));
  });

  it('shows "Not available right now" for every unavailable section, never fake numbers', async () => {
    vi.mocked(api.getOverviewWebsite).mockResolvedValue({ range: full.range, eventsPerDay: off, topEvents: off, topPages: off, lastHour: off, utmLinks: off });
    render(<WebsiteOverview />);
    await waitFor(() => expect(screen.getAllByText('Not available right now').length).toBe(8));
    expect(screen.queryByText('0')).toBeNull();
    expect(bodyText()).not.toContain('NaN');
  });

  it('shows empty states when sections are available but empty', async () => {
    vi.mocked(api.getOverviewWebsite).mockResolvedValue({ ...full,
      eventsPerDay: { available: true, days: [] }, topEvents: { available: true, events: [] }, topPages: { available: true, pages: [] },
      lastHour: { available: true, count: 0 },
      utmLinks: { available: true, totals: { links: 0, clickedLinks: 0, clicks: 0, campaigns: 0, uniqueUsers: 0 }, campaigns: [] } });
    render(<WebsiteOverview />);
    await screen.findByText('No website events in this period');
    expect(screen.getByText('No events this hour')).toBeTruthy();
    expect(screen.getByText('No tracked links yet')).toBeTruthy();
  });

  it('shows an error with retry when the request fails, and recovers', async () => {
    vi.mocked(api.getOverviewWebsite).mockRejectedValueOnce(new Error('HTTP 500')).mockResolvedValue(full);
    render(<WebsiteOverview />);
    await screen.findByText("Couldn't load website activity");
    expect(screen.getByText('HTTP 500')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('1,234');
  });

  it('treats a malformed payload as an error, not as zeros', async () => {
    vi.mocked(api.getOverviewWebsite).mockResolvedValue({} as OverviewWebsite);
    render(<WebsiteOverview />);
    await screen.findByText("Couldn't load website activity");
    expect(bodyText()).not.toContain('NaN');
  });

  it('fmtNum never yields NaN', () => {
    expect(fmtNum(Number.NaN)).toBe('–');
    expect(fmtNum(undefined)).toBe('–');
    expect(fmtNum(1500)).toBe('1,500');
  });
});
