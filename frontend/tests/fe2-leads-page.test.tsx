// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import { Component } from 'react';
import type { ReactNode } from 'react';
import * as api from '@/lib/api';
import Leads from '@/app/(dashboard)/leads/page';

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
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

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
    expect(bodyText()).toContain('2026-10-12 to 2026-10-19');
    // Busiest department is derived from the department table (Sales: 1,500 + 5 of 1,507 chats)
    const busiest = screen.getByRole('region', { name: 'Busiest department' });
    expect(within(busiest).getByText('Sales')).toBeTruthy();
    expect(busiest.textContent).toContain('1,505 chats · 100%');
    expect(bodyText()).toContain('Oct 13-19 · PARTIAL');
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

  it('quick presets, Load button and trend granularity call the API with the right args', async () => {
    mockWhatsapp();
    render(<Leads />);
    await findDept('Sales');
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    await waitFor(() => expect(api.getChatLeadsSummary).toHaveBeenLastCalledWith(today(), today()));
    fireEvent.click(screen.getByRole('button', { name: 'Weekly' }));
    await waitFor(() => expect(api.getChatLeadsTrend).toHaveBeenLastCalledWith(today(), today(), 'week'));
    const [fromInput] = document.querySelectorAll('input[type="date"]');
    fireEvent.change(fromInput, { target: { value: '2026-09-01' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Load' }));
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
    vi.mocked(api.getChatLeadsDepartmentUsers)
      .mockResolvedValueOnce(as(api.getChatLeadsDepartmentUsers, { users: [{ wa_id: '971555000111', wa_name: 'Ali', first_msg: 'Hi there', first_msg_at: '2026-10-18 10:00' }], has_more: true }))
      .mockResolvedValueOnce(as(api.getChatLeadsDepartmentUsers, { users: [{ wa_id: '971555000222' }], has_more: false }));
    render(<Leads />);
    fireEvent.click(await findDept('Sales'));
    await screen.findByText('Hi there');
    expect(api.getChatLeadsDepartmentUsers).toHaveBeenCalledWith('971500000001', daysAgo(49), today(), { onlyNew: true, limit: 50 });
    expect(bodyText()).toContain('New contacts for Sales · showing 1+');
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    await screen.findByText('971555000222');
    expect(api.getChatLeadsDepartmentUsers).toHaveBeenLastCalledWith('971500000001', daysAgo(49), today(), { onlyNew: true, limit: 50, offset: 1 });
    expect(screen.getByText('(not available)')).toBeTruthy();
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
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.getByText('raynatours.com')).toBeTruthy();
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
