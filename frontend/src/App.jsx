import { BrowserRouter, Routes, Route, NavLink, Link } from 'react-router-dom';
import { Component, Suspense, lazy, useState } from 'react';
import { LayoutDashboard, Zap, FileText, Send, Target, GitBranch, TrendingUp, Menu, X, PieChart, Link2, Ticket, Shield, Code } from 'lucide-react';
import './App.css';

// Lazy-loaded pages for code splitting
const Dashboard = lazy(() => import('./pages/Dashboard'));
const SegmentsV2 = lazy(() => import('./pages/SegmentsV2'));
const Strategies = lazy(() => import('./pages/Strategies'));
const Content = lazy(() => import('./pages/Content'));
const Campaigns = lazy(() => import('./pages/Campaigns'));
const Journeys = lazy(() => import('./pages/Journeys'));
const Funnel = lazy(() => import('./pages/Funnel'));
const RFMAnalysis = lazy(() => import('./pages/RFMAnalysis'));
const UTMTracking = lazy(() => import('./pages/UTMTracking'));
const Coupons = lazy(() => import('./pages/Coupons'));
const Approvals = lazy(() => import('./pages/Approvals'));
const GTMIntegration = lazy(() => import('./pages/GTMIntegration'));

const NAV = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/segments', icon: Target, label: 'Segments' },
  { to: '/rfm', icon: PieChart, label: 'RFM Analysis' },
  { to: '/journeys', icon: GitBranch, label: 'Journeys' },
  { to: '/funnel', icon: TrendingUp, label: 'Funnel' },
  { to: '/strategies', icon: Zap, label: 'Strategies' },
  { to: '/content', icon: FileText, label: 'Content' },
  { to: '/campaigns', icon: Send, label: 'Campaigns' },
  { to: '/utm', icon: Link2, label: 'UTM Tracking' },
  { to: '/coupons', icon: Ticket, label: 'Coupons' },
  { to: '/approvals', icon: Shield, label: 'Approvals' },
  { to: '/gtm', icon: Code, label: 'GTM & BigQuery' },
];

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

function NotFound() {
  return (
    <div className="not-found">
      <h1>404</h1>
      <p>Page not found. The page you are looking for does not exist.</p>
      <Link to="/" className="btn btn-primary">Back to Dashboard</Link>
    </div>
  );
}

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <BrowserRouter>
      <div className="app">
        <button
          className="mobile-menu-btn btn btn-ghost btn-icon"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          style={{ position: 'fixed', top: 12, left: 12, zIndex: 150 }}
          aria-label="Toggle menu"
        >
          {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
        </button>

        <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
          <div className="logo">
            <h1>Rayna</h1>
            <span className="logo-sub">Omnichannel Platform</span>
          </div>
          <nav>
            {NAV.map(({ to, icon: Icon, label }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                onClick={() => setSidebarOpen(false)}
              >
                <Icon size={18} />
                <span>{label}</span>
              </NavLink>
            ))}
          </nav>
        </aside>

        <main className="main">
          <ErrorBoundary>
            <Suspense fallback={<div className="spinner">Loading...</div>}>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/segments" element={<SegmentsV2 />} />
                <Route path="/journeys" element={<Journeys />} />
                <Route path="/funnel" element={<Funnel />} />
                <Route path="/strategies" element={<Strategies />} />
                <Route path="/content" element={<Content />} />
                <Route path="/campaigns" element={<Campaigns />} />
                <Route path="/rfm" element={<RFMAnalysis />} />
                <Route path="/utm" element={<UTMTracking />} />
                <Route path="/coupons" element={<Coupons />} />
                <Route path="/approvals" element={<Approvals />} />
                <Route path="/gtm" element={<GTMIntegration />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
    </BrowserRouter>
  );
}
