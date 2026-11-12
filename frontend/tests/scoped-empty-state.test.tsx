// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ScopedEmptyState } from '@/components/ui';
import { BusinessTypeProvider, useBusinessType } from '@/context/BusinessTypeContext';

afterEach(() => { cleanup(); });
beforeEach(() => { try { localStorage.clear(); } catch { /* ignore */ } });

/** Shows the live scope next to the empty state, so a test can see it change. */
function ScopeProbe() {
  const { businessType } = useBusinessType();
  return <output data-testid="scope">{businessType}</output>;
}

const mount = (scope: string, ui: React.ReactElement) => {
  localStorage.setItem('business-type', scope);
  return render(<BusinessTypeProvider>{ui}<ScopeProbe /></BusinessTypeProvider>);
};

describe('ScopedEmptyState — "no results" that knows the audience scope', () => {
  it('narrowed scope + searching: says only that audience was searched and offers all audiences', async () => {
    const onWidened = vi.fn();
    mount('B2B', <ScopedEmptyState title="No contacts found for “kishor”." searching noun="contacts" onWidened={onWidened} />);
    await screen.findByText('B2B');
    expect(screen.getByText('No contacts found for “kishor”.')).toBeTruthy();
    expect(screen.getByText(/Only B2B contacts were searched — the contact may be in another audience\./)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Search all audiences' }));
    expect(await screen.findByText('All')).toBeTruthy();   // the scope really changed
    expect(onWidened).toHaveBeenCalledTimes(1);
    // Once on All, the hint and the button are gone — just the page's own message.
    expect(screen.queryByText(/Only B2B/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Search all audiences' })).toBeNull();
  });

  it('scope All: a plain message, no hint, no button', async () => {
    mount('All', <ScopedEmptyState title="No journeys match your filters" searching noun="journeys" description="Try another filter." />);
    await screen.findByText('All');
    expect(screen.getByText('No journeys match your filters')).toBeTruthy();
    expect(screen.getByText('Try another filter.')).toBeTruthy();
    expect(screen.queryByText(/were searched/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Search all audiences' })).toBeNull();
  });

  it('not searching: no hint even with a narrowed scope (an empty list is just empty)', async () => {
    mount('B2C', <ScopedEmptyState title="No segments with this status" searching={false} noun="segments" />);
    await screen.findByText('B2C');
    expect(screen.queryByText(/were searched/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Search all audiences' })).toBeNull();
  });

  it('keeps the page’s own description and buttons alongside the hint', async () => {
    mount('Affiliate', <ScopedEmptyState title="No customers found" searching noun="customers" description="Try a different search." action={<button>Clear filters</button>} />);
    await screen.findByText('Affiliate');
    // Description and hint share one paragraph, so check the text rather than separate elements.
    const text = document.body.textContent ?? '';
    expect(text).toContain('Try a different search.');
    expect(text).toContain('Only Affiliate customers were searched');
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Search all audiences' })).toBeTruthy();
  });
});
