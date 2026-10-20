'use client';

import { useState, useEffect, useRef, Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import {
  Home, Users, Target, History, Heart, MessageSquare, GitBranch, FileText, BarChart3, Megaphone,
  Globe, Code, Download, Activity, Gauge, ClipboardList, BookOpen, Menu, Search, Sun, Moon, LogOut,
  PanelLeftClose, PanelLeftOpen,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import { useBusinessType } from '@/context/BusinessTypeContext';
import { RequireAuth } from './require-auth';
import { SCOPES } from '@/lib/contactTypes';

interface NavItem { href: string; icon: LucideIcon; label: string }
interface NavGroup { label: string; items: NavItem[] }

// Grouped per Sidebar.dc / Sitemap.dc. Every existing route stays reachable;
// pages the design merges elsewhere keep their own entry under the closest group,
// and pages with no home in the design sit under "More".
// Role-based menus are not possible yet (only an admin role exists), so all groups show.
const NAV_GROUPS: NavGroup[] = [
  { label: '', items: [{ href: '/dashboard', icon: Home, label: 'Home' }] },
  {
    label: 'Audience',
    items: [
      { href: '/contacts', icon: Users, label: 'Contacts' },
      { href: '/segmentation', icon: Target, label: 'Segments' },
      { href: '/segment-activity', icon: History, label: 'Segment changes' },
      { href: '/affinity', icon: Heart, label: 'Booking interests' },
      { href: '/leads', icon: MessageSquare, label: 'Leads' },
    ],
  },
  {
    label: 'Messaging',
    items: [
      { href: '/journeys', icon: GitBranch, label: 'Journeys' },
      { href: '/content', icon: FileText, label: 'Templates' },
    ],
  },
  {
    label: 'Insights',
    items: [
      { href: '/journeys/analytics', icon: BarChart3, label: 'Performance' },
      { href: '/campaigns', icon: Megaphone, label: 'Campaign results' },
      { href: '/utm', icon: Globe, label: 'Website & links' },
      { href: '/tag-manager', icon: Code, label: 'GTM & BigQuery' },
      { href: '/daily-report', icon: Download, label: 'Reports' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { href: '/data-pipeline', icon: Activity, label: 'Status center' },
      { href: '/journeys/dashboard', icon: Gauge, label: 'Journey monitor' },
      { href: '/log', icon: ClipboardList, label: 'Message log' },
    ],
  },
  { label: 'More', items: [{ href: '/system', icon: BookOpen, label: 'System docs' }] },
];

const ALL_ITEMS: NavItem[] = NAV_GROUPS.flatMap(g => g.items);

// Most-specific match wins, so /journeys/dashboard doesn't also light up /journeys.
function activeItem(pathname: string): NavItem | undefined {
  return ALL_ITEMS
    .filter(n => pathname === n.href || pathname.startsWith(n.href + '/'))
    .sort((a, b) => b.href.length - a.href.length)[0];
}

function initials(name: string | null | undefined, email: string | null | undefined): string {
  const src = (name || email || '').trim();
  if (!src) return '?';
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

function Sidebar({ collapsed, open, pathname, onToggleCollapse, onNavigate }: {
  collapsed: boolean; open: boolean; pathname: string; onToggleCollapse: () => void; onNavigate: () => void;
}) {
  const { user } = useAuth();
  const current = activeItem(pathname)?.href;
  return (
    <aside className={`shell-sidebar ${collapsed ? 'collapsed' : ''} ${open ? 'open' : ''}`} aria-label="Sidebar">
      <div className="shell-brand-row">
        <Link href="/dashboard" className="shell-brand" onClick={onNavigate} title="Home">
          <span className={`shell-logo ${collapsed ? 'shell-logo--sm' : ''}`}>
            <img src="/rayna-logo.webp" alt="Rayna Tours" />
          </span>
        </Link>
        <button
          type="button"
          className="shell-icon-btn shell-collapse"
          onClick={onToggleCollapse}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>

      <nav className="shell-nav" aria-label="Main">
        {NAV_GROUPS.map(g => (
          <div className="shell-group" key={g.label || 'root'}>
            {g.label && <span className="shell-group-label">{g.label}</span>}
            {g.items.map(({ href, icon: Icon, label }) => (
              <Link
                key={href}
                href={href}
                className="shell-nav-item"
                aria-current={href === current ? 'page' : undefined}
                onClick={onNavigate}
                title={collapsed ? label : undefined}
                aria-label={collapsed ? label : undefined}
              >
                <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
                {!collapsed && <span>{label}</span>}
              </Link>
            ))}
          </div>
        ))}
      </nav>

      <div className="shell-footer">
        <Link href="/data-pipeline" className="shell-status" onClick={onNavigate} title={collapsed ? 'Data sync status' : undefined} aria-label={collapsed ? 'Data sync status' : undefined}>
          <span className="shell-status-dot" style={{ background: 'var(--ink3)' }} aria-hidden="true" />
          {!collapsed && (
            <span className="shell-status-text"><b>Data sync</b><span>Open Status center</span></span>
          )}
        </Link>
        <div className="shell-user">
          <span className="shell-avatar" aria-hidden="true">{initials(user?.name, user?.email)}</span>
          {!collapsed && (
            <span className="shell-user-text">
              <b>{user?.name || user?.email || 'Signed in'}</b>
              <span>{user?.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : 'Admin'}</span>
            </span>
          )}
        </div>
      </div>
    </aside>
  );
}

function AudienceSwitch() {
  const { businessType, setBusinessType } = useBusinessType();
  return (
    <div className="shell-audience" role="group" aria-label="Audience">
      <span className="shell-audience-label">Audience</span>
      <div className="shell-seg">
        {SCOPES.map(type => (
          <button key={type} type="button" aria-pressed={businessType === type} onClick={() => setBusinessType(type)}>
            {type}
          </button>
        ))}
      </div>
    </div>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        className="shell-avatar"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        {initials(user?.name, user?.email)}
      </button>
      {open && (
        <div className="shell-menu" role="menu">
          <div className="shell-menu-head">
            <b>{user?.name || 'Signed in'}</b>
            {user?.email && <span>{user.email}</span>}
          </div>
          <button type="button" role="menuitem" className="shell-menu-item danger" onClick={() => { setOpen(false); logout(); }}>
            <LogOut size={16} aria-hidden="true" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function Topbar({ title, onOpenMenu }: { title: string; onOpenMenu: () => void }) {
  const { theme, toggleTheme } = useTheme();
  const nextTheme = theme === 'dark' ? 'light' : 'dark';
  return (
    <header className="shell-topbar">
      <button type="button" className="shell-ghost-btn shell-burger" onClick={onOpenMenu} aria-label="Open menu">
        <Menu size={20} />
      </button>
      <Link href="/dashboard" className="shell-logo shell-logo--mobile" aria-label="Home">
        <img src="/rayna-logo.webp" alt="Rayna Tours" />
      </Link>
      {title && <h2 className="shell-title">{title}</h2>}
      <div className="shell-search" aria-disabled="true" title="Global search is coming soon">
        <Search size={16} aria-hidden="true" />
        <span>Search (coming soon)</span>
        <span className="shell-kbd" aria-hidden="true">⌘K</span>
      </div>
      <AudienceSwitch />
      <div className="shell-actions">
        <button
          type="button"
          className="shell-ghost-btn"
          onClick={toggleTheme}
          aria-label={`Switch to ${nextTheme} theme`}
          title={`Switch to ${nextTheme} theme`}
        >
          {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
        </button>
        <UserMenu />
      </div>
    </header>
  );
}

interface ErrorBoundaryProps { children?: ReactNode }
interface ErrorBoundaryState { hasError: boolean; error: Error | null }

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };
  static getDerivedStateFromError(error: Error) { return { hasError: true, error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('ErrorBoundary:', error, info); }
  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <h2>Something went wrong</h2>
          <p>{this.state.error?.message || 'An unexpected error occurred.'}</p>
          <button className="btn btn-primary" onClick={() => { this.setState({ hasError: false }); window.location.href = '/dashboard'; }}>
            Back to Home
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Public paths render WITHOUT the sidebar/chrome when the visitor isn't logged in
// (kept in sync with middleware.js + require-auth.jsx).
const PUBLIC_PATHS = ['/leads'];

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const { isAuthenticated } = useAuth();

  // Chromeless = public page viewed while logged out → no sidebar, full-width content.
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
  const chromeless = isPublic && !isAuthenticated;

  if (chromeless) {
    return (
      <RequireAuth>
        <div className="app">
          <main className="main" style={{ marginLeft: 0, width: '100vw' }}>
            <ErrorBoundary>{children}</ErrorBoundary>
          </main>
        </div>
      </RequireAuth>
    );
  }

  const title = activeItem(pathname)?.label ?? '';

  return (
    <RequireAuth>
      <div className="app" data-sidebar={collapsed ? 'collapsed' : 'expanded'}>
        <Sidebar
          collapsed={collapsed}
          open={sidebarOpen}
          pathname={pathname}
          onToggleCollapse={() => setCollapsed(c => !c)}
          onNavigate={() => setSidebarOpen(false)}
        />
        {sidebarOpen && <button type="button" className="shell-scrim" aria-label="Close menu" onClick={() => setSidebarOpen(false)} />}

        <div className={`shell-body ${collapsed ? 'collapsed' : ''}`}>
          <Topbar title={title} onOpenMenu={() => setSidebarOpen(true)} />
          <main className="main">
            <ErrorBoundary>
              {children}
            </ErrorBoundary>
          </main>
        </div>
      </div>
    </RequireAuth>
  );
}
