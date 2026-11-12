// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import { Component } from 'react';
import type { ReactNode } from 'react';
import * as api from '@/lib/api';
import Leads from '@/app/(dashboard)/leads/page';
import {
  bucketKey, daysInRange, dubaiToday, formatDay, formatPerDay, formatPeriod, formatRange, latestKpiLabel,
  parseLeadDate, partialBucket, rangeKpis, soFarLabel,
} from '@/app/(dashboard)/leads/leadsShared';

vi.mock('@/lib/api');

const h = vi.hoisted(() => ({ isAuthenticated: false }));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: h.isAuthenticated }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {}, prefetch: () => {}, refresh: () => {} }),
  useParams: () => ({}),
  usePathname: () => '/leads',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

class FakeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] { return []; }
}

type Ret<F extends (...args: never[]) => unknown> = Awaited<ReturnType<F>>;
const as = <F extends (...args: never[]) => unknown>(_fn: F, v: unknown): Ret<F> => v as unknown as Ret<F>;

const ymd = (d: Date): string => d.toISOString().split('T')[0];
const today = (): string => ymd(new Date());
const daysAgo = (n: number): string => { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d); };

const SUMMARY = { totalChats: 1200, totalLeads: 800, newUsers: 300, oldUsers: 500, from: '2026-10-12', to: '2026-10-19' };
const TREND = { points: [{ period: '2026-10-12', leads: 10, newUsers: 4, oldUsers: 6 }] };
const DEPT = {
  periods: [{ label: 'W41', sublabel: 'Oct 6-12' }, { label: 'W42', sublabel: 'Oct 13-19', partial: true }],
  rows: [
    { receiver: '971500000001', department: 'Sales', values: [{ chats: 1500, newUsers: 3, oldUsers: 7 }, { chats: 5, newUsers: 1, oldUsers: 4 }] },
    { receiver: '971500000002', values: [{ chats: 2, newUsers: 0, oldUsers: 2 }, { chats: 0, newUsers: 0, oldUsers: 0 }] },
  ],
};
const GROUPS = { groups: [{ id: 5, name: 'UAE Sales', departments: [{ receiver: '971500000001', name: 'Sales' }] }] };

const REG_SUMMARY = { counts: { guestuser: 12, agent: 3, affiliate: 0 }, total: 12, from: '2026-10-12', to: '2026-10-19', granularity: 'day', points: [] };
const REG_PERIODS = { dimension: 'Website', periods: [{ label: 'W42', sublabel: 'Oct 13-19' }], rows: [{ name: 'raynatours.com', values: [12] }], totals: [12] };
const REG_RECORDS = {
  records: [{ source: 'guestuser', recordId: 1, data: { GuestUserId: 1, Email: 'g@x.com', CreatedAt: '2026-10-18 00:00:00', Phone: 'NULL' } }],
  total: 30,
  columns: ['GuestUserId', 'Email', 'CreatedAt', 'Phone'],
};

let fetchMock: ReturnType<typeof vi.fn<(url: string) => Promise<Response>>>;

beforeEach(() => {
  for (const fn of Object.values(api)) {
    if (vi.isMockFunction(fn)) fn.mockResolvedValue({});
  }
  h.isAuthenticated = false;
  localStorage.clear();
  window.history.replaceState(null, '', '/leads');
  fetchMock = vi.fn<(url: string) => Promise<Response>>(() => Promise.resolve({ ok: false } as unknown as Response));
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('ResizeObserver', FakeObserver);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

const bodyText = (): string => document.body.textContent ?? '';
const deptTable = () => screen.findByRole('region', { name: 'Leads by department' });
const findDept = async (name: string) => within(await deptTable()).findByText(name);
const noBadText = () => { expect(bodyText()).not.toContain('NaN'); expect(bodyText()).not.toContain('undefined'); };

function mockWhatsapp() {
  vi.mocked(api.getChatLeadsSummary).mockResolvedValue(as(api.getChatLeadsSummary, SUMMARY));
  vi.mocked(api.getChatLeadsTrend).mockResolvedValue(as(api.getChatLeadsTrend, TREND));
  vi.mocked(api.getChatLeadsDepartmentPeriods).mockResolvedValue(as(api.getChatLeadsDepartmentPeriods, DEPT));
}
function mockRegistration() {
  vi.mocked(api.getRegistrationSummary).mockResolvedValue(as(api.getRegistrationSummary, REG_SUMMARY));
  vi.mocked(api.getRegistrationPeriods).mockResolvedValue(as(api.getRegistrationPeriods, REG_PERIODS));
  vi.mocked(api.getRegistrationLeads).mockResolvedValue(as(api.getRegistrationLeads, REG_RECORDS));
}

class Boundary extends Component<{ onError: (e: Error) => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: Error) { this.props.onError(e); }
  render() { return this.state.failed ? <div>crashed</div> : this.props.children; }
}

describe('Leads page — WhatsApp / Email tabs', () => {
  it('loads WhatsApp KPIs, trend and department table with the default filters', async () => {
    mockWhatsapp();
    render(<Leads />);
    await findDept('Sales');
    expect(api.getChatLeadsSummary).toHaveBeenCalledWith(daysAgo(7), today());
    expect(api.getChatLeadsTrend).toHaveBeenCalledWith(daysAgo(7), today(), 'day');
    expect(api.getChatLeadsDepartmentPeriods).toHaveBeenCalledWith('week', 7);
    expect(api.getDepartmentGroups).toHaveBeenCalled();
    expect(within(screen.getByRole('region', { name: 'Total chats' })).getByText('1,200')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Leads' })).getByText('800')).toBeTruthy();
    expect(within(screen.getByRole('tab', { name: /WhatsApp chats/ })).getByText('1,200')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'New contacts' })).getByText('300')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'New contacts' })).getByText('38% of leads')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Returning' })).getByText('500')).toBeTruthy();
    // Human dates (no raw ISO) and the 4 headline KPIs derived from the mocked summary + trend
    expect(within(screen.getByRole('region', { name: 'Total chats' })).getByText('12 – 19 Oct 2026')).toBeTruthy();
    expect(bodyText()).not.toContain('2026-10-12 to 2026-10-19');
    expect(within(screen.getByRole('region', { name: 'Average per day' })).getByText('150')).toBeTruthy(); // 1,200 ÷ 8 days
    expect(screen.getByRole('region', { name: 'Average per day' }).textContent).toContain('chats a day · over 8 days');
    const busiestDay = screen.getByRole('region', { name: 'Busiest day' });
    expect(within(busiestDay).getByText('Mon, 12 Oct')).toBeTruthy();
    expect(within(busiestDay).getByText('10 leads')).toBeTruthy();
    // Busiest department is derived from the department table (Sales: 1,500 + 5 of 1,507 chats)
    const busiest = screen.getByRole('region', { name: 'Busiest department' });
    expect(within(busiest).getByText('Sales')).toBeTruthy();
    expect(busiest.textContent).toContain('1,505 chats · 100%');
    expect(bodyText()).toContain('Oct 13-19 · so far');
    expect(screen.getByText('No department match')).toBeTruthy();
    expect(screen.getByText('1,500')).toBeTruthy();
    expect(bodyText()).toContain('2 receivers');
    noBadText();
  });

  it('shows "No data for the selected range." for an empty trend and the empty state when nothing loads', async () => {
    vi.mocked(api.getChatLeadsSummary).mockResolvedValue(as(api.getChatLeadsSummary, { totalChats: 0, totalLeads: 0, from: '2026-10-12', to: '2026-10-19' }));
    vi.mocked(api.getChatLeadsTrend).mockResolvedValue(as(api.getChatLeadsTrend, { points: [] }));
    const first = render(<Leads />);
    await screen.findByText('No data for the selected range.');
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
    noBadText();
    first.unmount();

    vi.mocked(api.getChatLeadsSummary).mockResolvedValue(as(api.getChatLeadsSummary, null));
    vi.mocked(api.getChatLeadsDepartmentPeriods).mockResolvedValue(as(api.getChatLeadsDepartmentPeriods, { periods: [], rows: [] }));
    render(<Leads />);
    await screen.findByText('Select a date range to get started');
    noBadText();
  });

  it('shows skeletons while loading', async () => {
    vi.mocked(api.getChatLeadsSummary).mockReturnValue(new Promise(() => {}));
    vi.mocked(api.getChatLeadsDepartmentPeriods).mockReturnValue(new Promise(() => {}));
    render(<Leads />);
    await screen.findByLabelText('Loading lead analytics');
    expect(screen.getByLabelText('Loading department data')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Loading\.\.\./ })).toBeTruthy();
  });

  it('shows API errors for summary and department fetches without crashing', async () => {
    vi.mocked(api.getChatLeadsSummary).mockRejectedValue(new Error('HTTP 500'));
    vi.mocked(api.getChatLeadsDepartmentPeriods).mockRejectedValue(new Error('dept down'));
    vi.mocked(api.getDepartmentGroups).mockRejectedValue(new Error('groups down'));
    render(<Leads />);
    await screen.findByText('HTTP 500');
    await screen.findByText('dept down');
    expect(screen.queryByText('Select a date range to get started')).toBeNull();
    noBadText();
  });

  it('switching to Email Tickets fetches mail endpoints and remembers the tab', async () => {
    mockWhatsapp();
    vi.mocked(api.getMailLeadsSummary).mockResolvedValue(as(api.getMailLeadsSummary, { totalEmails: 42, totalLeads: 40, from: 'a', to: 'b' }));
    render(<Leads />);
    await findDept('Sales');
    fireEvent.click(screen.getByRole('tab', { name: /Email enquiries/ }));
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Total emails' })).getByText('42')).toBeTruthy());
    expect(api.getMailLeadsSummary).toHaveBeenCalledWith(daysAgo(7), today());
    expect(api.getMailLeadsTrend).toHaveBeenCalledWith(daysAgo(7), today(), 'day');
    expect(api.getMailLeadsDepartmentPeriods).toHaveBeenCalledWith('week', 7);
    expect(screen.queryByRole('region', { name: 'New contacts' })).toBeNull();
    expect(localStorage.getItem('leads-active-tab')).toBe('mail');
    expect(window.location.search).toBe('?tab=mail');
    expect(screen.getByRole('tab', { name: /Email enquiries/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('restores the saved tab from localStorage', async () => {
    localStorage.setItem('leads-active-tab', 'mail');
    render(<Leads />);
    await waitFor(() => expect(api.getMailLeadsSummary).toHaveBeenCalled());
    expect(api.getChatLeadsSummary).not.toHaveBeenCalled();
  });

  it('quick presets, Apply button and trend granularity call the API with the right args', async () => {
    mockWhatsapp();
    render(<Leads />);
    await findDept('Sales');
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    await waitFor(() => expect(api.getChatLeadsSummary).toHaveBeenLastCalledWith(today(), today()));
    fireEvent.click(screen.getByRole('button', { name: 'Weekly' }));
    await waitFor(() => expect(api.getChatLeadsTrend).toHaveBeenLastCalledWith(today(), today(), 'week'));
    const [fromInput] = document.querySelectorAll('input[type="date"]');
    fireEvent.change(fromInput, { target: { value: '2026-09-01' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(api.getChatLeadsSummary).toHaveBeenLastCalledWith('2026-09-01', today()));
  });

  it('month picker loads that calendar month', async () => {
    mockWhatsapp();
    render(<Leads />);
    await findDept('Sales');
    const year = new Date().getFullYear();
    const monthSelect = screen.getByDisplayValue('Select month…');
    fireEvent.change(monthSelect, { target: { value: `${year}-02` } });
    const lastDay = new Date(year, 2, 0).getDate();
    await waitFor(() => expect(api.getChatLeadsSummary).toHaveBeenLastCalledWith(`${year}-02-01`, `${year}-02-${lastDay}`));
    expect((monthSelect as HTMLSelectElement).value).toBe(`${year}-02`);
  });

  it('department period unit / count / reset re-fetch with the right args', async () => {
    mockWhatsapp();
    render(<Leads />);
    await findDept('Sales');
    fireEvent.click(screen.getByRole('button', { name: 'Month on Month' }));
    await waitFor(() => expect(api.getChatLeadsDepartmentPeriods).toHaveBeenLastCalledWith('month', 3));
    fireEvent.click(screen.getByRole('button', { name: 'Week on Week' }));
    await findDept('Sales');
    fireEvent.change(screen.getByDisplayValue('Last 7'), { target: { value: '12' } });
    await waitFor(() => expect(api.getChatLeadsDepartmentPeriods).toHaveBeenLastCalledWith('week', 12));
    expect(screen.getByText('Filtered')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Reset/ }));
    await waitFor(() => expect(api.getChatLeadsDepartmentPeriods).toHaveBeenLastCalledWith('week', 7));
    await waitFor(() => expect(screen.queryByText('Filtered')).toBeNull());
  });

  it('expanding a department row loads its new users and "Show more" pages with an offset', async () => {
    mockWhatsapp();
    // Phase 1 (firstMsg:false) returns the list at once; phase 2 (firstMsg:true) fills in the texts.
    vi.mocked(api.getChatLeadsDepartmentUsers).mockImplementation((_r, _f, _t, opts) => Promise.resolve(as(api.getChatLeadsDepartmentUsers,
      opts?.offset
        ? { users: [{ wa_id: '971555000222', ...(opts.firstMsg ? { first_msg: null } : {}) }], has_more: false }
        : { users: [{ wa_id: '971555000111', wa_name: 'Ali', first_msg_at: '2026-10-18 10:00', ...(opts?.firstMsg ? { first_msg: 'Hi there' } : {}) }], has_more: true })));
    render(<Leads />);
    fireEvent.click(await findDept('Sales'));
    await screen.findByText('Ali', { exact: false });
    expect(api.getChatLeadsDepartmentUsers).toHaveBeenCalledWith('971500000001', daysAgo(49), today(), { onlyNew: true, limit: 50, firstMsg: false });
    await screen.findByText('Hi there');
    expect(api.getChatLeadsDepartmentUsers).toHaveBeenCalledWith('971500000001', daysAgo(49), today(), { onlyNew: true, limit: 50, offset: 0, firstMsg: true });
    expect(bodyText()).toContain('New contacts for Sales · showing 1+');
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    await screen.findByText('971555000222');
    expect(api.getChatLeadsDepartmentUsers).toHaveBeenCalledWith('971500000001', daysAgo(49), today(), { onlyNew: true, limit: 50, offset: 1, firstMsg: false });
    await screen.findByText('(not available)');
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
    noBadText();
    // collapse
    fireEvent.click(await findDept('Sales'));
    expect(screen.queryByText('Hi there')).toBeNull();
  });

  it('expanding a row shows the users error and an empty message', async () => {
    mockWhatsapp();
    vi.mocked(api.getChatLeadsDepartmentUsers).mockRejectedValueOnce(new Error('users failed'));
    render(<Leads />);
    fireEvent.click(await findDept('Sales'));
    await screen.findByText('users failed');
    fireEvent.click(screen.getByText('No department match'));
    await screen.findByText('No new users found for this department in the current window.');
  });

  it('compares KPIs with the previous period and with the same period last year', async () => {
    mockWhatsapp();
    vi.mocked(api.getChatLeadsSummary).mockImplementation((from: string) => Promise.resolve(as(api.getChatLeadsSummary,
      from === daysAgo(7) ? SUMMARY : { ...SUMMARY, totalChats: 1000, totalLeads: 1000 })));
    render(<Leads />);
    await findDept('Sales');
    // previous window = the 8 days right before the current 8-day window
    expect(api.getChatLeadsSummary).toHaveBeenCalledWith(daysAgo(15), daysAgo(8));
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Total chats' })).getByText('▲ 20% vs previous period')).toBeTruthy());
    expect(within(screen.getByRole('region', { name: 'Leads' })).getByText('▼ 20% vs previous period')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Compare with'), { target: { value: 'year' } });
    const shift = (s: string) => `${Number(s.slice(0, 4)) - 1}${s.slice(4)}`;
    await waitFor(() => expect(api.getChatLeadsSummary).toHaveBeenCalledWith(shift(daysAgo(7)), shift(today())));
    expect(api.getChatLeadsSummary).toHaveBeenLastCalledWith(daysAgo(7), today());
    await screen.findByText('▲ 20% vs same period last year');
    noBadText();
  });

  it('shows no comparison when the previous-period call fails or has no data', async () => {
    mockWhatsapp();
    vi.mocked(api.getChatLeadsSummary).mockImplementation((from: string) =>
      from === daysAgo(7) ? Promise.resolve(as(api.getChatLeadsSummary, SUMMARY)) : Promise.reject(new Error('prev down')));
    render(<Leads />);
    await findDept('Sales');
    expect(screen.queryByText(/vs previous period/)).toBeNull();
    expect(screen.queryByText('prev down')).toBeNull();
    noBadText();
  });

  it('department table shows totals and the latest full period vs the one before', async () => {
    mockWhatsapp();
    vi.mocked(api.getChatLeadsDepartmentPeriods).mockResolvedValue(as(api.getChatLeadsDepartmentPeriods, {
      periods: [{ label: 'W40' }, { label: 'W41' }, { label: 'W42', partial: true }],
      rows: [{ receiver: '1', department: 'Sales', values: [{ chats: 100, newUsers: 1, oldUsers: 1 }, { chats: 150, newUsers: 1, oldUsers: 1 }, { chats: 9, newUsers: 0, oldUsers: 0 }] }],
    }));
    render(<Leads />);
    const table = await deptTable();
    await within(table).findByText('Sales');
    expect(table.textContent).toContain('W41 vs W40');
    expect(within(table).getByText('259')).toBeTruthy();
    expect(within(table).getByText('▲ 50%')).toBeTruthy();
  });

  it('shows a session countdown for public visitors and skips the check when signed in', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ expiresAt: Date.now() + 90_000 }) } as unknown as Response);
    const first = render(<Leads />);
    await screen.findByText(/Secure session · 0[01]:\d\d/);
    expect(fetchMock).toHaveBeenCalledWith('/leads-access/verify');
    first.unmount();
    fetchMock.mockClear();
    document.cookie = 'rayna-auth=1; path=/';
    try {
      render(<Leads />);
      await waitFor(() => expect(api.getDepartmentGroups).toHaveBeenCalled());
      expect(fetchMock).not.toHaveBeenCalled();
      expect(screen.queryByText(/Secure session/)).toBeNull();
    } finally {
      document.cookie = 'rayna-auth=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    }
  });
});

describe('Leads page — department groups (signed in)', () => {
  it('is hidden for the public view', async () => {
    mockWhatsapp();
    render(<Leads />);
    await findDept('Sales');
    expect(screen.queryByRole('heading', { name: /Department groups/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Manage department groups' })).toBeNull();
  });

  it('lists groups, filters the department table by group, and clears the filter', async () => {
    h.isAuthenticated = true;
    mockWhatsapp();
    vi.mocked(api.getDepartmentGroups).mockResolvedValue(as(api.getDepartmentGroups, GROUPS));
    render(<Leads />);
    await screen.findByRole('heading', { name: /Department groups/ });
    expect(screen.getByRole('button', { name: 'Manage department groups' })).toBeTruthy();
    await screen.findByText('· 1 dept');
    fireEvent.change(screen.getByDisplayValue('All departments'), { target: { value: '5' } });
    await waitFor(() => expect(screen.queryByText('No department match')).toBeNull());
    expect(bodyText()).toContain('1 receivers');
    fireEvent.click(screen.getByTitle('Clear group filter'));
    expect(screen.getByText('No department match')).toBeTruthy();
  });

  it('shows the empty groups message and opens the Add Group modal', async () => {
    h.isAuthenticated = true;
    mockWhatsapp();
    render(<Leads />);
    await screen.findByText(/No groups yet/);
    fireEvent.click(screen.getByRole('button', { name: /Add Group/ }));
    await screen.findByText('Add Department Group');
    expect(api.getDepartments).toHaveBeenCalled();
  });

  it('deletes a group only after confirming in the dialog and reloads the list', async () => {
    h.isAuthenticated = true;
    mockWhatsapp();
    vi.mocked(api.getDepartmentGroups).mockResolvedValue(as(api.getDepartmentGroups, GROUPS));
    render(<Leads />);
    await screen.findByText('· 1 dept');
    fireEvent.click(screen.getByTitle('Delete'));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('Delete group "UAE Sales"?');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(api.deleteDepartmentGroup).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTitle('Delete'));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete group' }));
    await waitFor(() => expect(api.deleteDepartmentGroup).toHaveBeenCalledWith(5));
    await waitFor(() => expect(api.getDepartmentGroups).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('shows an inline error when deleting a group fails', async () => {
    h.isAuthenticated = true;
    mockWhatsapp();
    vi.mocked(api.getDepartmentGroups).mockResolvedValue(as(api.getDepartmentGroups, GROUPS));
    vi.mocked(api.deleteDepartmentGroup).mockRejectedValue(new Error('in use'));
    render(<Leads />);
    await screen.findByText('· 1 dept');
    fireEvent.click(screen.getByTitle('Delete'));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete group' }));
    await screen.findByText('in use');
    expect(screen.getByText("Couldn't delete the group")).toBeTruthy();
  });

  it('shows each department\'s group in the table', async () => {
    h.isAuthenticated = true;
    mockWhatsapp();
    vi.mocked(api.getDepartmentGroups).mockResolvedValue(as(api.getDepartmentGroups, GROUPS));
    render(<Leads />);
    const table = await deptTable();
    await within(table).findByText('UAE Sales');
    expect(within(table).getAllByText('—').length).toBeGreaterThan(0);
  });

  it('Edit opens the modal pre-filled with the group', async () => {
    h.isAuthenticated = true;
    mockWhatsapp();
    vi.mocked(api.getDepartmentGroups).mockResolvedValue(as(api.getDepartmentGroups, GROUPS));
    render(<Leads />);
    await screen.findByText('· 1 dept');
    fireEvent.click(screen.getByTitle('Edit'));
    await screen.findByText('Edit Department Group');
    expect((screen.getByPlaceholderText('e.g. UAE Sales') as HTMLInputElement).value).toBe('UAE Sales');
  });
});

describe('Leads page — Registrations tab', () => {
  async function openRegistrations() {
    render(<Leads />);
    fireEvent.click(screen.getByRole('tab', { name: /Registrations/ }));
    await screen.findByText('g@x.com');
  }

  it('renders summary, period table and records with formatted cells', async () => {
    mockRegistration();
    await openRegistrations();
    expect(api.getRegistrationSummary).toHaveBeenCalledWith('guestuser', daysAgo(7), today(), 'day');
    expect(api.getRegistrationPeriods).toHaveBeenCalledWith('guestuser', 'week', 7);
    expect(api.getRegistrationLeads).toHaveBeenCalledWith({ source: 'guestuser', from: daysAgo(7), to: today(), search: '', limit: 25, page: 1 });
    expect(screen.getByText('Guest User Id')).toBeTruthy();
    expect(screen.getByText('Created At')).toBeTruthy();
    expect(screen.getByText('2026-10-18')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Guest Users records' })).getByText('—')).toBeTruthy();
    expect(screen.getByText('raynatours.com')).toBeTruthy();
    // no chart points → busiest shows a dash, not "NaN"/"undefined"/"Invalid Date"
    expect(within(screen.getByRole('region', { name: 'Busiest day' })).getByText('No registrations in this range')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Guest Users registered' })).getByText('12 – 19 Oct 2026')).toBeTruthy();
    expect(bodyText()).not.toContain('Invalid Date');
    expect(screen.getByText('No registrations in the selected range.')).toBeTruthy();
    expect(bodyText()).toContain('30 records · page 1 of 2');
    const group = screen.getByRole('radiogroup', { name: 'Registration type' });
    expect(within(group).getByRole('radio', { name: /Guest Users/ }).textContent).toContain('12');
    noBadText();
  });

  it('pagination, search, rows-per-page and source switching call getRegistrationLeads correctly', async () => {
    mockRegistration();
    await openRegistrations();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(api.getRegistrationLeads).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' }).hasAttribute('disabled')).toBe(true));

    const search = screen.getByPlaceholderText(/Search guest users/);
    fireEvent.change(search, { target: { value: '  bob  ' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    await waitFor(() => expect(api.getRegistrationLeads).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'bob', page: 1 })));
    fireEvent.click(await screen.findByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(api.getRegistrationLeads).toHaveBeenLastCalledWith(expect.objectContaining({ search: '' })));

    fireEvent.click(screen.getByRole('button', { name: '50' }));
    await waitFor(() => expect(api.getRegistrationLeads).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 50, page: 1 })));

    fireEvent.click(screen.getByRole('radio', { name: /Agents/ }));
    await waitFor(() => expect(api.getRegistrationLeads).toHaveBeenLastCalledWith(expect.objectContaining({ source: 'agent' })));
    expect(api.getRegistrationPeriods).toHaveBeenLastCalledWith('agent', 'week', 7);
    expect(localStorage.getItem('leads-registration-source')).toBe('agent');

    fireEvent.click(screen.getByRole('button', { name: 'Day on Day' }));
    await waitFor(() => expect(api.getRegistrationPeriods).toHaveBeenLastCalledWith('agent', 'day', 7));
    fireEvent.click(screen.getByRole('button', { name: '30 days' }));
    await waitFor(() => expect(api.getRegistrationPeriods).toHaveBeenLastCalledWith('agent', 'day', 30));
  });

  it('shows empty messages for no records and no periods', async () => {
    vi.mocked(api.getRegistrationSummary).mockResolvedValue(as(api.getRegistrationSummary, { ...REG_SUMMARY, counts: {}, total: 0 }));
    vi.mocked(api.getRegistrationPeriods).mockResolvedValue(as(api.getRegistrationPeriods, { dimension: 'Website', periods: [], rows: [], totals: [] }));
    vi.mocked(api.getRegistrationLeads).mockResolvedValue(as(api.getRegistrationLeads, { records: [], total: 0, columns: [] }));
    render(<Leads />);
    fireEvent.click(screen.getByRole('tab', { name: /Registrations/ }));
    await screen.findByText('No guest users registered in this range.');
    expect(screen.getByText('No registrations in these periods.')).toBeTruthy();
    expect(bodyText()).toContain('0 records · page 1 of 1');
    noBadText();
  });

  it('shows skeletons while registrations load', async () => {
    vi.mocked(api.getRegistrationSummary).mockReturnValue(new Promise(() => {}));
    vi.mocked(api.getRegistrationPeriods).mockReturnValue(new Promise(() => {}));
    vi.mocked(api.getRegistrationLeads).mockReturnValue(new Promise(() => {}));
    render(<Leads />);
    fireEvent.click(screen.getByRole('tab', { name: /Registrations/ }));
    await screen.findByLabelText('Loading registration records');
    expect(screen.getByLabelText('Loading lead analytics')).toBeTruthy();
    expect(screen.getByLabelText('Loading department data')).toBeTruthy();
  });

  it('shows each registration API error', async () => {
    vi.mocked(api.getRegistrationSummary).mockRejectedValue(new Error('summary failed'));
    vi.mocked(api.getRegistrationPeriods).mockRejectedValue(new Error('periods failed'));
    vi.mocked(api.getRegistrationLeads).mockRejectedValue(new Error('records failed'));
    render(<Leads />);
    fireEvent.click(screen.getByRole('tab', { name: /Registrations/ }));
    await screen.findByText('summary failed');
    await screen.findByText('periods failed');
    await screen.findByText('records failed');
    noBadText();
  });

  // BUG: app/(dashboard)/leads/page.tsx:380 / :307 — RegistrationPanel stores whatever the API
  // returns and then reads `records.records.length` and `periodData.periods.map` without guards.
  // A payload missing those keys (e.g. `{}` from an error envelope) crashes the whole page.
  it('survives registration payloads without records/periods keys', async () => {
    const onError = vi.fn<(e: Error) => void>();
    render(<Boundary onError={onError}><Leads /></Boundary>);
    fireEvent.click(screen.getByRole('tab', { name: /Registrations/ }));
    await waitFor(() => expect(api.getRegistrationLeads).toHaveBeenCalled());
    await new Promise(r => setTimeout(r, 50));
    expect(onError).not.toHaveBeenCalled();
    expect(screen.queryByText('crashed')).toBeNull();
  });
});

describe('Leads page — tabs, KPIs and today-partial marking', () => {
  it('renders each tab icon inline with its label inside the same tab element', async () => {
    mockWhatsapp();
    render(<Leads />);
    await findDept('Sales');
    for (const name of [/WhatsApp chats/, /Email enquiries/, /Registrations/]) {
      const tab = screen.getByRole('tab', { name });
      // one inline wrapper per tab (Tailwind preflight makes a bare <svg> block-level)
      expect(tab.children).toHaveLength(1);
      const row = tab.firstElementChild as HTMLElement;
      expect(row.tagName).toBe('SPAN');
      expect(row.className).toContain('tabLabel');
      const icon = row.querySelector('svg');
      expect(icon).toBeTruthy();
      expect(icon?.parentElement).toBe(row);
      expect(row.textContent).toMatch(name);
    }
    expect(screen.getByRole('tab', { name: /WhatsApp chats/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: /Registrations/ }).getAttribute('aria-selected')).toBe('false');
  });

  it('computes the 4 KPIs from the mocked data and marks today as partial', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T08:00:00Z')); // 12:00 in Dubai
    vi.mocked(api.getChatLeadsSummary).mockResolvedValue(as(api.getChatLeadsSummary,
      { totalChats: 1400, totalLeads: 900, newUsers: 300, oldUsers: 600, from: '2026-10-14', to: '2026-10-20' }));
    vi.mocked(api.getChatLeadsTrend).mockResolvedValue(as(api.getChatLeadsTrend, { points: [
      { period: '2026-10-14', leads: 10, newUsers: 4, oldUsers: 6 },
      { period: '2026-10-15', leads: 1040, newUsers: 40, oldUsers: 1000 },
      { period: '2026-10-16', leads: 12, newUsers: 2, oldUsers: 10 },
      { period: '2026-10-20', leads: 7, newUsers: 3, oldUsers: 4 },
    ] }));
    vi.mocked(api.getChatLeadsDepartmentPeriods).mockResolvedValue(as(api.getChatLeadsDepartmentPeriods, DEPT));
    render(<Leads />);
    const total = await screen.findByRole('region', { name: 'Total chats' });
    expect(within(total).getByText('1,400')).toBeTruthy();
    expect(within(total).getByText('14 – 20 Oct 2026')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Average per day' })).getByText('200')).toBeTruthy(); // 1,400 ÷ 7
    const busiest = screen.getByRole('region', { name: 'Busiest day' });
    expect(within(busiest).getByText('Thu, 15 Oct')).toBeTruthy();
    expect(within(busiest).getByText('1,040 leads')).toBeTruthy();
    const todayKpi = screen.getByRole('region', { name: 'Today so far' });
    expect(within(todayKpi).getByText('7')).toBeTruthy();
    expect(todayKpi.textContent).toContain('leads · Tue, 20 Oct');
    expect(screen.getByText('Today (so far)')).toBeTruthy(); // chart legend for the partial bar
    expect(bodyText()).not.toMatch(/\d{4}-\d{2}-\d{2} to/);
    noBadText();
  });

  it('Registrations: KPIs use the latest day when the range ends before today, counts use separators', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T08:00:00Z'));
    vi.mocked(api.getRegistrationSummary).mockResolvedValue(as(api.getRegistrationSummary, {
      ...REG_SUMMARY, counts: { guestuser: 1300, agent: 12345, affiliate: 0 }, total: 1300,
      points: [{ period: '2026-10-13', registrations: 1234 }, { period: '2026-10-19', registrations: 5 }],
    }));
    vi.mocked(api.getRegistrationPeriods).mockResolvedValue(as(api.getRegistrationPeriods, REG_PERIODS));
    vi.mocked(api.getRegistrationLeads).mockResolvedValue(as(api.getRegistrationLeads, REG_RECORDS));
    render(<Leads />);
    fireEvent.click(screen.getByRole('tab', { name: /Registrations/ }));
    const busiest = await screen.findByRole('region', { name: 'Busiest day' });
    expect(within(busiest).getByText('Tue, 13 Oct')).toBeTruthy();
    expect(within(busiest).getByText('1,234 registrations')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Average per day' })).getByText('163')).toBeTruthy(); // 1,300 ÷ 8
    const latest = screen.getByRole('region', { name: 'Latest day' });
    expect(within(latest).getByText('5')).toBeTruthy();
    expect(latest.textContent).toContain('registrations · Mon, 19 Oct');
    expect(screen.queryByRole('region', { name: 'Today so far' })).toBeNull();
    expect(screen.queryByText('Today (so far)')).toBeNull();
    const group = screen.getByRole('radiogroup', { name: 'Registration type' });
    expect(within(group).getByRole('radio', { name: /Agents/ }).textContent).toContain('12,345');
    expect(within(group).getByRole('radio', { name: /Guest Users/ }).getAttribute('aria-checked')).toBe('true');
    noBadText();
  });
});

describe('Leads date + KPI helpers', () => {
  it('parses safely and never returns Invalid Date', () => {
    for (const bad of ['', 'garbage', '2026-02-30', '2026-13-01', '2026-00-10', '15/10/2026', 'Invalid Date', null, undefined, 20261015]) {
      expect(parseLeadDate(bad)).toBeNull();
      expect(formatDay(bad)).toBe('—');
      expect(formatPeriod(bad, 'day')).toBe('—');
    }
    expect(formatRange('nope', 'also-nope')).toBe('—');
    expect(formatRange('2026-10-13', 'bad')).toBe('13 Oct 2026');
    expect(parseLeadDate('2026-10-15')).toEqual({ y: 2026, m: 10, d: 15, wd: 4 });
    expect(parseLeadDate('2026-10')).toEqual({ y: 2026, m: 10, d: 1, wd: 4 });
    expect(parseLeadDate('2026-10-15 23:30:00')?.d).toBe(15);
    // an instant is converted to the Dubai calendar day (UTC+4)
    expect(parseLeadDate('2026-10-19T21:00:00Z')?.d).toBe(20);
    expect(dubaiToday(new Date('2026-10-19T21:00:00Z'))).toBe('2026-10-20');
    expect(dubaiToday(new Date('2026-10-19T19:59:00Z'))).toBe('2026-10-19');
  });

  it('formats days, ranges and chart periods for humans', () => {
    expect(formatDay('2026-10-15')).toBe('Thu, 15 Oct');
    expect(formatDay('2026-10-15', { year: true })).toBe('Thu, 15 Oct 2026');
    expect(formatRange('2026-10-13', '2026-10-20')).toBe('13 – 20 Oct 2026');
    expect(formatRange('2026-09-28', '2026-10-04')).toBe('28 Sep – 4 Oct 2026');
    expect(formatRange('2025-12-28', '2026-01-03')).toBe('28 Dec 2025 – 3 Jan 2026');
    expect(formatRange('2026-10-15', '2026-10-15')).toBe('15 Oct 2026');
    expect(formatPeriod('2026-10-15', 'day')).toBe('15 Oct');
    expect(formatPeriod('2026-10-13', 'week')).toBe('w/c 13 Oct');
    expect(formatPeriod('2026-10-01', 'month')).toBe('Oct 2026');
    expect(formatPeriod('2026-10-15', 'day', 'kpi')).toBe('Thu, 15 Oct');
    expect(formatPeriod('2026-10-15', 'day', 'full')).toBe('Thu, 15 Oct 2026');
    expect(formatPeriod('2026-10-13', 'week', 'full')).toBe('w/c 13 Oct 2026');
    expect(soFarLabel('day')).toBe('Today (so far)');
    expect(soFarLabel('week')).toBe('This week (so far)');
    expect(latestKpiLabel('day', true)).toBe('Today so far');
    expect(latestKpiLabel('month', false)).toBe('Latest month');
    expect(formatPerDay(null)).toBe('—');
    expect(formatPerDay(12.345)).toBe('12.3');
    expect(formatPerDay(1234.4)).toBe('1,234');
  });

  it('buckets, counts days and finds the partial bucket', () => {
    expect(bucketKey('2026-10-15', 'week')).toBe('2026-10-12'); // Monday
    expect(bucketKey('2026-10-18', 'week')).toBe('2026-10-12'); // Sunday → same week
    expect(bucketKey('2026-10-15', 'month')).toBe('2026-10-01');
    expect(bucketKey('bad', 'day')).toBeNull();
    expect(daysInRange('2026-10-13', '2026-10-20')).toBe(8);
    expect(daysInRange('2026-10-20', '2026-10-13')).toBeNull();
    expect(daysInRange('a', 'b')).toBeNull();
    expect(partialBucket('2026-10-13', '2026-10-20', 'day', '2026-10-20')).toBe('2026-10-20');
    expect(partialBucket('2026-10-01', '2026-10-31', 'week', '2026-10-20')).toBe('2026-10-19');
    expect(partialBucket('2026-10-01', '2026-10-31', 'month', '2026-10-20')).toBe('2026-10-01');
    expect(partialBucket('2026-10-01', '2026-10-19', 'day', '2026-10-20')).toBeNull();
  });

  it('derives the 4 KPIs only from the range, total and points', () => {
    const points = [{ period: '2026-10-14', value: 3 }, { period: '2026-10-15', value: 9 }, { period: '2026-10-20', value: 2 }];
    expect(rangeKpis({ from: '2026-10-14', to: '2026-10-20', granularity: 'day', total: 70, points, today: '2026-10-20' })).toEqual({
      days: 7, perDay: 10, busiest: { period: '2026-10-15', value: 9 }, latest: { period: '2026-10-20', value: 2, partial: true },
    });
    // range ends before today → latest = the last day, 0 when it has no point
    expect(rangeKpis({ from: '2026-10-14', to: '2026-10-19', granularity: 'day', total: 12, points, today: '2026-10-20' }).latest)
      .toEqual({ period: '2026-10-19', value: 0, partial: false });
    // invalid range / no activity → nulls, never NaN
    expect(rangeKpis({ from: 'a', to: 'b', granularity: 'day', total: 5, points: [], today: '2026-10-20' }))
      .toEqual({ days: null, perDay: null, busiest: null, latest: null });
    expect(rangeKpis({ from: '2026-10-14', to: '2026-10-20', granularity: 'day', total: undefined, points: [{ period: '2026-10-14', value: 0 }], today: '2026-10-20' }))
      .toMatchObject({ perDay: null, busiest: null });
  });
});
