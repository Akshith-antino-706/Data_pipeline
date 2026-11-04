'use client';

import type { ReactNode } from 'react';
import { EmptyState, type EmptyStateProps } from './States';
import { Button } from './Button';
import { useBusinessType } from '@/context/BusinessTypeContext';

export interface ScopedEmptyStateProps extends Omit<EmptyStateProps, 'description' | 'action'> {
  /** True while the person is searching or filtering — the only time the scope hint applies. */
  searching: boolean;
  /** What the list holds, for the hint: "contacts", "journeys", "segments"… */
  noun: string;
  /** Called after the scope is widened to All (reset paging etc.). */
  onWidened?: () => void;
  /** Extra text under the title (shown before the scope hint). */
  description?: ReactNode;
  /** Page-specific buttons, shown next to "Search all audiences". */
  action?: ReactNode;
}

/**
 * EmptyState that knows the audience scope (All / B2C / B2B / Affiliate).
 *
 * A search only looks inside the chosen audience, so an empty result can simply mean
 * "wrong audience". While searching with a narrowed scope this says so and offers a
 * one-click "Search all audiences". With the scope already on All (or when nothing is
 * being searched) it is a plain EmptyState — the page's own wording, nothing extra.
 */
export function ScopedEmptyState({ searching, noun, onWidened, description, action, ...rest }: ScopedEmptyStateProps) {
  const { businessType, setBusinessType } = useBusinessType();
  const narrowed = searching && businessType !== 'All';

  const hint = narrowed
    ? `Only ${businessType} ${noun} were searched — the ${noun.replace(/s$/, '')} may be in another audience.`
    : null;

  const widen = () => { setBusinessType('All'); onWidened?.(); };

  return (
    <EmptyState
      {...rest}
      description={description || hint ? <>{description}{description && hint ? <br /> : null}{hint}</> : undefined}
      action={narrowed || action ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          {narrowed && <Button size="sm" variant="primary" onClick={widen}>Search all audiences</Button>}
          {action}
        </div>
      ) : undefined}
    />
  );
}
