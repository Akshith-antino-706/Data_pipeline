import type { ReactNode, TableHTMLAttributes } from 'react';

export interface TableProps extends TableHTMLAttributes<HTMLTableElement> {
  /** Accessible name for the scroll region. */
  label?: string;
  children: ReactNode;
}

/** Scrollable bordered wrapper around a plain <table>; style comes from .ui-table. */
export function Table({ label, className, children, ...rest }: TableProps) {
  return (
    <div className="ui-table-wrap" role={label ? 'region' : undefined} aria-label={label} tabIndex={label ? 0 : undefined}>
      <table className={['ui-table', className ?? ''].filter(Boolean).join(' ')} {...rest}>{children}</table>
    </div>
  );
}
