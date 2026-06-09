'use client';

import { useState, Component } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { LayoutDashboard, Target, GitBranch, Menu, X, Link2, Code, FileText, Sun, Moon, Database, Download, UserCheck, Megaphone, Activity, Mail, LogOut, MessageCircle, MessageSquare } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import { useBusinessType } from '@/context/BusinessTypeContext';
import { RequireAuth } from './require-auth';

const NAV = [
  { href: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/segmentation', icon: Target, label: 'Segmentation' },
  { href: '/segment-activity', icon: Activity, label: 'Segment Activity' },
  { href: '/contacts', icon: UserCheck, label: 'Contacts' },
  { href: '/journeys', icon: GitBranch, label: 'Journeys' },
  { href: '/campaigns', icon: Megaphone, label: 'Campaigns' },
  { href: '/content', icon: FileText, label: 'Content' },
  { href: '/utm', icon: Link2, label: 'UTM Tracking' },
  { href: '/gtm', icon: Code, label: 'GTM & BigQuery' },
  { href: '/data-pipeline', icon: Database, label: 'Data Pipeline' },
  { href: '/daily-report', icon: Download, label: 'Daily Report' },
  { href: '/test-sends', icon: Mail, label: 'Test Sends' },
  { href: '/chathead', icon: MessageCircle, label: 'WhatsApp (ChatHead)' },
  { href: '/rcs', icon: MessageSquare, label: 'RCS Send' },
  { href: '/system', icon: FileText, label: 'System Docs' },
];

function SidebarFooter() {
  const { theme, toggleTheme } = useTheme();
  const { logout } = useAuth();
  return (
    <div className="sidebar-footer">
      <button className="sidebar-footer-btn" onClick={toggleTheme} aria-label="Toggle theme">
        {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
      </button>
      <div className="sidebar-footer-divider" />
      <button className="sidebar-footer-btn sidebar-footer-logout" onClick={logout} aria-label="Sign out">
        <LogOut size={15} />
        <span>Sign Out</span>
      </button>
    </div>
  );
}

function BusinessTypeSwitcher() {
  const { businessType, setBusinessType } = useBusinessType();
  return (
    <div className="biz-switcher">
      <span className="biz-switcher-label">Scope</span>
      <div className="biz-switcher-pills">
        {['All', 'B2C', 'B2B'].map(type => (
          <button
            key={type}
            onClick={() => setBusinessType(type)}
            className={`biz-pill ${businessType === type ? 'active' : ''}`}
          >
            {type}
          </button>
        ))}
      </div>
    </div>
  );
}


class ErrorBoundary extends Component {
  state = { hasError: false, error: null };
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  componentDidCatch(error, info) { console.error('ErrorBoundary:', error, info); }
  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <h2>Something went wrong</h2>
          <p>{this.state.error?.message || 'An unexpected error occurred.'}</p>
          <button className="btn btn-primary" onClick={() => { this.setState({ hasError: false }); window.location.href = '/'; }}>
            Back to Dashboard
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function DashboardLayout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();

  return (
    <RequireAuth>
      <div className="app">
        <button
          className="mobile-menu-btn btn btn-ghost btn-icon"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          style={{ position: 'fixed', top: 12, left: 12, zIndex: 150 }}
          aria-label="Toggle menu"
        >
          {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
        </button>

        <motion.aside
          className={`sidebar ${sidebarOpen ? 'open' : ''}`}
          initial={{ x: -10, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
        >
          <div className="logo">
            <img src="/rayna-logo.webp" alt="Rayna Tours" style={{ height: 36, objectFit: 'contain' }} />
            <span className="logo-sub">Omnichannel Platform</span>
          </div>
          <BusinessTypeSwitcher />
          <nav>
            {NAV.map(({ href, icon: Icon, label }) => {
              const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={`nav-item ${isActive ? 'active' : ''}`}
                  onClick={() => setSidebarOpen(false)}
                >
                  <Icon size={18} />
                  <span>{label}</span>
                </Link>
              );
            })}
          </nav>
          <SidebarFooter />
        </motion.aside>

        <main className="main">
          <ErrorBoundary>
            {children}
          </ErrorBoundary>
        </main>
      </div>
    </RequireAuth>
  );
}
