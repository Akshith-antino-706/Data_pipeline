// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import * as api from '@/lib/api';
import CreateSegmentModal from '@/app/(dashboard)/segmentation/CreateSegmentModal';

vi.mock('@/lib/api');

const preview = vi.mocked(api.previewSegmentCount);
const create = vi.mocked(api.createCustomSegment);

interface SentCondition { type?: string; field?: string; operator?: string; value?: unknown; countValue?: unknown }
const lastPreviewConditions = (): SentCondition[] => preview.mock.calls[preview.mock.calls.length - 1][0] as SentCondition[];

beforeEach(() => {
  vi.mocked(api.getGTMAnalytics).mockResolvedValue({ top_events: [{ event_name: 'page_view' }, { event_name: '' }] });
  preview.mockResolvedValue({ count: 1234 });
  create.mockResolvedValue({});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });

function pickContactField(field: string): void {
  fireEvent.click(screen.getByText('Contact property'));
  fireEvent.change(screen.getByDisplayValue('Select a property...'), { target: { value: field } });
}

describe('CreateSegmentModal', () => {
  it('renders the type picker and loads GTM event names (empty names filtered)', async () => {
    render(<CreateSegmentModal onClose={() => {}} />);
    expect(screen.getByText('Contact property')).toBeTruthy();
    expect(screen.getByText('Website event (GTM)')).toBeTruthy();
    expect(api.getGTMAnalytics).toHaveBeenCalledTimes(1);
  });

  it('does not crash when GTM analytics rejects or returns null', async () => {
    vi.mocked(api.getGTMAnalytics).mockRejectedValueOnce(new Error('500'));
    render(<CreateSegmentModal onClose={() => {}} />);
    cleanup();
    vi.mocked(api.getGTMAnalytics).mockResolvedValueOnce(null);
    render(<CreateSegmentModal onClose={() => {}} />);
    expect(screen.getByText('Contact property')).toBeTruthy();
  });

  it('revenue "between": min=0 and max=0 are kept (not dropped as falsy)', async () => {
    render(<CreateSegmentModal onClose={() => {}} />);
    pickContactField('revenue');
    const min = screen.getByPlaceholderText('Min') as HTMLInputElement;
    const max = screen.getByPlaceholderText('Max') as HTMLInputElement;
    fireEvent.change(min, { target: { value: '0' } });
    expect(min.value).toBe('0');
    fireEvent.change(max, { target: { value: '0' } });
    expect(max.value).toBe('0');
    await waitFor(() => expect(preview).toHaveBeenCalled(), { timeout: 2000 });
    expect(lastPreviewConditions()[0]).toMatchObject({ field: 'revenue', operator: 'between', value: ['0', '0'] });
    await screen.findByText('1,234');
  });

  // BUG app/(dashboard)/segmentation/CreateSegmentModal.tsx:521 - the single-value Min (≥)/Max (≤)
  // input does `Number(e.target.value) || ''`, so typing 0 is turned into '' and the condition is invalid.
  it('revenue "Min (≥)": typing 0 keeps 0', () => {
    render(<CreateSegmentModal onClose={() => {}} />);
    pickContactField('revenue');
    fireEvent.change(screen.getByDisplayValue('Between'), { target: { value: 'gte' } });
    const input = screen.getByPlaceholderText('Min value') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '0' } });
    expect(input.value).toBe('0');
  });

  it('GTM count "between": min=0 is kept and makes the condition valid', async () => {
    render(<CreateSegmentModal onClose={() => {}} />);
    fireEvent.click(screen.getByText('Website event (GTM)'));
    fireEvent.change(screen.getByDisplayValue('at least (≥)'), { target: { value: 'between' } });
    const min = screen.getByPlaceholderText('min') as HTMLInputElement;
    fireEvent.change(min, { target: { value: '0' } });
    expect(min.value).toBe('0');
    await waitFor(() => expect(preview).toHaveBeenCalled(), { timeout: 2000 });
    expect(lastPreviewConditions()[0]).toMatchObject({ type: 'gtm', countValue: ['0', ''] });
  });

  it('preview API failure shows no count and does not crash', async () => {
    preview.mockRejectedValue(new Error('HTTP 500'));
    render(<CreateSegmentModal onClose={() => {}} />);
    pickContactField('revenue');
    fireEvent.change(screen.getByPlaceholderText('Min'), { target: { value: '10' } });
    await waitFor(() => expect(preview).toHaveBeenCalled(), { timeout: 2000 });
    expect(screen.queryByText('NaN')).toBeNull();
  });

  it('save is a no-op without a name, then creates with trimmed name / null description', async () => {
    const onClose = vi.fn<() => void>();
    const onCreated = vi.fn<() => void>();
    render(<CreateSegmentModal onClose={onClose} onCreated={onCreated} />);
    pickContactField('revenue');
    fireEvent.change(screen.getByPlaceholderText('Min'), { target: { value: '0' } });
    fireEvent.click(screen.getByText('Save segment'));
    expect(create).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText('e.g. High-Value Local Travelers'), { target: { value: '  VIP  ' } });
    fireEvent.change(screen.getByPlaceholderText('Optional description'), { target: { value: '   ' } });
    fireEvent.click(screen.getByText('Save segment'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(create).toHaveBeenCalledWith({
      name: 'VIP', description: null,
      conditions: [expect.objectContaining({ field: 'revenue', value: ['0', ''] })],
    });
    expect(onCreated).toHaveBeenCalled();
  });

  it('create API error keeps the modal open', async () => {
    create.mockRejectedValueOnce(new Error('HTTP 400'));
    const onClose = vi.fn<() => void>();
    render(<CreateSegmentModal onClose={onClose} />);
    pickContactField('revenue');
    fireEvent.change(screen.getByPlaceholderText('Min'), { target: { value: '5' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. High-Value Local Travelers'), { target: { value: 'X' } });
    fireEvent.click(screen.getByText('Save segment'));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('edit mode hydrates an existing segment, including 0 values', () => {
    render(<CreateSegmentModal onClose={() => {}} segment={{
      id: 7, name: 'Old', description: null,
      conditions: [{ type: 'contact', field: 'revenue', operator: 'between', value: ['0', '500'] }],
    }} />);
    expect((screen.getByPlaceholderText('Min') as HTMLInputElement).value).toBe('0');
    expect((screen.getByPlaceholderText('Max') as HTMLInputElement).value).toBe('500');
    expect(screen.getByText('Save changes')).toBeTruthy();
  });
  it('shows a plain-words summary and live count, and "Save as draft" sends status draft', async () => {
    const onClose = vi.fn<() => void>();
    render(<CreateSegmentModal onClose={onClose} />);
    pickContactField('revenue');
    fireEvent.change(screen.getByDisplayValue('Between'), { target: { value: 'gte' } });
    fireEvent.change(screen.getByPlaceholderText('Min value'), { target: { value: '5000' } });
    expect(screen.getByText('have revenue (aed) of at least 5000')).toBeTruthy();
    await screen.findByText('1,234');
    expect(screen.getByText('contacts match 1 complete rule')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('e.g. High-Value Local Travelers'), { target: { value: 'Big spenders' } });
    fireEvent.click(screen.getByText('Save as draft'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Big spenders', status: 'draft' }));
  });

  it('incomplete rules are flagged and preview failure offers a retry', async () => {
    preview.mockRejectedValueOnce(new Error('HTTP 500'));
    render(<CreateSegmentModal onClose={() => {}} />);
    pickContactField('revenue');
    expect(screen.getByText('Finish this rule or remove it. Incomplete rules are not saved.')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('Min'), { target: { value: '10' } });
    await screen.findByText("Couldn't count contacts", {}, { timeout: 2000 });
    fireEvent.click(screen.getByText('Count again'));
    await screen.findByText('1,234');
  });
});
