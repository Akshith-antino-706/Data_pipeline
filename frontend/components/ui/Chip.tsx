import type { HTMLAttributes, ReactNode } from 'react';

export type ChipTone = 'ok' | 'warn' | 'bad' | 'info' | 'mute' | 'gold';

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: ChipTone;
  dot?: boolean;
  children: ReactNode;
}

export function Chip({ tone = 'mute', dot = false, className, children, ...rest }: ChipProps) {
  return (
    <span className={['ui-chip', `ui-chip--${tone}`, className ?? ''].filter(Boolean).join(' ')} {...rest}>
      {dot && <span className="ui-chip-dot" aria-hidden="true" />}
      {children}
    </span>
  );
}

/** A Chip with a status dot — use for anything that runs (sends, syncs, journeys). */
export function StatusChip(props: Omit<ChipProps, 'dot'>) {
  return <Chip {...props} dot />;
}
