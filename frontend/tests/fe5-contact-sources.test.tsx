// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import ContactSourcesCard from '@/app/(dashboard)/dashboard/ContactSourcesCard';

const fmt = (v: number) => v.toLocaleString('en-US');
const sources = [
  { source: 'phpadmin', count: 600 }, { source: 'tours', count: 400 }, { source: 'agent,phpadmin', count: 30 },
  { source: 'guestuser', count: 20 }, { source: 'chats', count: 10 }, { source: 'visas', count: 9 },
  { source: 'packages', count: 8 }, { source: 'agent', count: 7 }, { source: 'packages,tours', count: 6 },
  { source: 'new_partner', count: 5 },
];
const total = 1000;
afterEach(cleanup);

describe('ContactSourcesCard', () => {
  it('By source view splits combinations and uses readable names', () => {
    render(<ContactSourcesCard total={total} sources={sources} rangeText="total contacts" fmt={fmt} />);
    const list = screen.getByRole('list', { name: 'Contacts by source' });
    expect(within(list).getByText('PHP Admin')).toBeTruthy();
    expect(within(list).getByText('630')).toBeTruthy(); // 600 + agent,phpadmin 30
    expect(within(list).getByText('Agents')).toBeTruthy();
    expect(within(list).getByText('37')).toBeTruthy(); // 7 + 30
    expect(screen.getByText(/counted in each/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/NaN|undefined|phpadmin/);
  });

  it('Combinations view shows joined readable names and Show all', () => {
    render(<ContactSourcesCard total={total} sources={sources} rangeText="total contacts" fmt={fmt} />);
    fireEvent.click(screen.getByRole('button', { name: /Combinations/ }));
    const list = screen.getByRole('list', { name: 'Contacts by source combination' });
    expect(within(list).getByText('Agents + PHP Admin')).toBeTruthy();
    expect(within(list).getAllByRole('listitem')).toHaveLength(8);
    fireEvent.click(screen.getByRole('button', { name: 'Show all 10' }));
    expect(within(list).getAllByRole('listitem')).toHaveLength(10);
    expect(within(list).getByText('New Partner')).toBeTruthy();
  });

  it('shows share of total and never NaN for bad counts', () => {
    render(<ContactSourcesCard total={0} sources={[{ source: 'tours', count: Number.NaN }]} rangeText="total contacts" fmt={fmt} />);
    expect(document.body.textContent).not.toMatch(/NaN|undefined|Infinity/);
  });
});
