// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import * as api from '@/lib/api';
import GroupDepartmentModal from '@/app/(dashboard)/leads/GroupDepartmentModal';

vi.mock('@/lib/api');
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {}, prefetch: () => {}, refresh: () => {} }),
  useParams: () => ({}),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

type Depts = Awaited<ReturnType<typeof api.getDepartments>>;
const depts = (d: unknown): Depts => d as unknown as Depts;

const DEPARTMENTS = {
  departments: [
    { receiver: '971500000001', name: 'Sales' },
    { receiver: '971500000002', name: 'Support', assigned: true, group_id: 9, group_name: 'Other' },
    { receiver: 971500000003, name: '' },
  ],
};

beforeEach(() => {
  for (const fn of Object.values(api)) {
    if (vi.isMockFunction(fn)) fn.mockResolvedValue({});
  }
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no network in tests'))));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const bodyText = (): string => document.body.textContent ?? '';
const checkbox = (label: string): HTMLInputElement => {
  const el = screen.getByText(label).closest('label')?.querySelector('input[type="checkbox"]');
  if (!(el instanceof HTMLInputElement)) throw new Error(`no checkbox for ${label}`);
  return el;
};

describe('GroupDepartmentModal', () => {
  it('renders nothing and does not fetch when closed', () => {
    const { container } = render(<GroupDepartmentModal open={false} />);
    expect(container.innerHTML).toBe('');
    expect(api.getDepartments).not.toHaveBeenCalled();
  });

  it('renders departments; one assigned elsewhere is disabled and labelled', async () => {
    vi.mocked(api.getDepartments).mockResolvedValue(depts(DEPARTMENTS));
    render(<GroupDepartmentModal open />);
    await screen.findByText('Sales');
    expect(screen.getByText('Add Department Group')).toBeTruthy();
    expect(screen.getByText('(no name)')).toBeTruthy();
    expect(checkbox('Support').disabled).toBe(true);
    expect(checkbox('Sales').disabled).toBe(false);
    expect(bodyText()).toContain('in “Other”');
    expect(bodyText()).toContain('Departments — 0 selected');
    expect(bodyText()).not.toContain('NaN');
    expect(bodyText()).not.toContain('undefined');
  });

  it('shows "No departments found" for an empty list and for a payload without departments', async () => {
    vi.mocked(api.getDepartments).mockResolvedValue(depts({ departments: [] }));
    const { unmount } = render(<GroupDepartmentModal open />);
    await screen.findByText('No departments found');
    unmount();
    vi.mocked(api.getDepartments).mockResolvedValue(depts({}));
    render(<GroupDepartmentModal open />);
    await screen.findByText('No departments found');
  });

  it('shows a loader (no list, no empty text) while departments are loading', async () => {
    vi.mocked(api.getDepartments).mockReturnValue(new Promise<Depts>(() => {}));
    render(<GroupDepartmentModal open />);
    await waitFor(() => expect(api.getDepartments).toHaveBeenCalled());
    expect(screen.queryByText('No departments found')).toBeNull();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('shows the API error message when departments fail to load', async () => {
    vi.mocked(api.getDepartments).mockRejectedValue(new Error('HTTP 500'));
    render(<GroupDepartmentModal open />);
    await screen.findByText('HTTP 500');
  });

  it('validates name and selection before saving', async () => {
    vi.mocked(api.getDepartments).mockResolvedValue(depts(DEPARTMENTS));
    render(<GroupDepartmentModal open />);
    await screen.findByText('Sales');
    fireEvent.click(screen.getByRole('button', { name: 'Create Group' }));
    expect(screen.getByText('Group name is required')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('e.g. UAE Sales'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Group' }));
    expect(screen.getByText('Group name is required')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('e.g. UAE Sales'), { target: { value: 'UAE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Group' }));
    expect(screen.getByText('Select at least one department')).toBeTruthy();
    expect(api.createDepartmentGroup).not.toHaveBeenCalled();
  });

  it('creates a group with the trimmed name and selected departments, then calls onSaved/onClose', async () => {
    vi.mocked(api.getDepartments).mockResolvedValue(depts(DEPARTMENTS));
    const onSaved = vi.fn();
    const onClose = vi.fn();
    render(<GroupDepartmentModal open onSaved={onSaved} onClose={onClose} />);
    await screen.findByText('Sales');
    fireEvent.change(screen.getByPlaceholderText('e.g. UAE Sales'), { target: { value: '  UAE Sales  ' } });
    fireEvent.click(checkbox('Sales'));
    fireEvent.click(checkbox('(no name)'));
    expect(bodyText()).toContain('Departments — 2 selected');
    fireEvent.click(checkbox('(no name)'));
    expect(bodyText()).toContain('Departments — 1 selected');
    fireEvent.click(screen.getByRole('button', { name: 'Create Group' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.createDepartmentGroup).toHaveBeenCalledWith({ name: 'UAE Sales', departments: [{ receiver: '971500000001', name: 'Sales' }] });
    expect(api.updateDepartmentGroup).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalled();
  });

  it('edit mode pre-fills, keeps the group\'s own departments selectable, and calls updateDepartmentGroup', async () => {
    vi.mocked(api.getDepartments).mockResolvedValue(depts(DEPARTMENTS));
    const onClose = vi.fn();
    render(<GroupDepartmentModal open onClose={onClose} editGroup={{ id: 9, name: 'Other', departments: [{ receiver: '971500000002' }] }} />);
    await screen.findByText('Support');
    expect(screen.getByText('Edit Department Group')).toBeTruthy();
    expect((screen.getByPlaceholderText('e.g. UAE Sales') as HTMLInputElement).value).toBe('Other');
    expect(checkbox('Support').disabled).toBe(false);
    expect(checkbox('Support').checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Save Group' }));
    await waitFor(() => expect(api.updateDepartmentGroup).toHaveBeenCalledWith(9, { name: 'Other', departments: [{ receiver: '971500000002', name: 'Support' }] }));
    expect(api.createDepartmentGroup).not.toHaveBeenCalled();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('shows the save error and stays open when saving fails', async () => {
    vi.mocked(api.getDepartments).mockResolvedValue(depts(DEPARTMENTS));
    vi.mocked(api.createDepartmentGroup).mockRejectedValue(new Error('Department already grouped'));
    const onClose = vi.fn();
    render(<GroupDepartmentModal open onClose={onClose} />);
    await screen.findByText('Sales');
    fireEvent.change(screen.getByPlaceholderText('e.g. UAE Sales'), { target: { value: 'X' } });
    fireEvent.click(checkbox('Sales'));
    fireEvent.click(screen.getByRole('button', { name: 'Create Group' }));
    await screen.findByText('Department already grouped');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('filters by name and by receiver number', async () => {
    vi.mocked(api.getDepartments).mockResolvedValue(depts(DEPARTMENTS));
    render(<GroupDepartmentModal open />);
    await screen.findByText('Sales');
    const search = screen.getByPlaceholderText('Search departments…');
    fireEvent.change(search, { target: { value: 'SUPP' } });
    expect(screen.queryByText('Sales')).toBeNull();
    expect(screen.getByText('Support')).toBeTruthy();
    fireEvent.change(search, { target: { value: '0003' } });
    expect(screen.getByText('(no name)')).toBeTruthy();
    expect(screen.queryByText('Support')).toBeNull();
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(screen.getByText('No departments found')).toBeTruthy();
  });

  it('closes on Close and Cancel but not on clicks inside the dialog', async () => {
    vi.mocked(api.getDepartments).mockResolvedValue(depts(DEPARTMENTS));
    const onClose = vi.fn();
    render(<GroupDepartmentModal open onClose={onClose} />);
    await screen.findByText('Sales');
    fireEvent.click(screen.getByText('Add Department Group'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
