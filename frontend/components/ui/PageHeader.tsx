import Link from 'next/link';
import type { ReactNode } from 'react';

export interface Crumb {
  label: string;
  href?: string;
}

export interface PageHeaderProps {
  title: ReactNode;
  breadcrumbs?: Crumb[];
  description?: ReactNode;
  /** Status chip / "updated" text shown next to the title. */
  meta?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ title, breadcrumbs, description, meta, actions }: PageHeaderProps) {
  return (
    <header className="ui-page-header">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav className="ui-crumbs" aria-label="Breadcrumb">
          <ol>
            {breadcrumbs.map((c, i) => {
              const last = i === breadcrumbs.length - 1;
              return (
                <li key={`${c.label}-${i}`}>
                  {c.href && !last
                    ? <Link href={c.href}>{c.label}</Link>
                    : <span aria-current={last ? 'page' : undefined}>{c.label}</span>}
                </li>
              );
            })}
          </ol>
        </nav>
      )}
      <div className="ui-page-header-row">
        <h1>{title}</h1>
        {meta}
        {actions && <div className="ui-page-header-actions">{actions}</div>}
      </div>
      {description && <p className="ui-page-header-desc">{description}</p>}
    </header>
  );
}
