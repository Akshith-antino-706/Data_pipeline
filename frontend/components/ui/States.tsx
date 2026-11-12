import type { CSSProperties, ReactNode } from 'react';
import { AlertCircle, Inbox } from 'lucide-react';

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ title, description, icon, action }: EmptyStateProps) {
  return (
    <div className="ui-empty">
      <div className="ui-empty-icon" aria-hidden="true">{icon ?? <Inbox size={20} />}</div>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

export interface ErrorStateProps {
  title?: ReactNode;
  description?: ReactNode;
  /** Raw error text, shown collapsed under "Technical details". */
  details?: string;
  action?: ReactNode;
}

export function ErrorState({ title = 'Something went wrong', description, details, action }: ErrorStateProps) {
  return (
    <div className="ui-error" role="alert">
      <div className="ui-error-icon" aria-hidden="true"><AlertCircle size={20} /></div>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
      {details && (
        <details>
          <summary>Technical details</summary>
          <pre>{details}</pre>
        </details>
      )}
    </div>
  );
}

export interface SkeletonProps {
  width?: CSSProperties['width'];
  height?: CSSProperties['height'];
  radius?: CSSProperties['borderRadius'];
  className?: string;
}

export function Skeleton({ width = '100%', height = 14, radius, className }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={['ui-skel', className ?? ''].filter(Boolean).join(' ')}
      style={{ display: 'block', width, height, borderRadius: radius }}
    />
  );
}
