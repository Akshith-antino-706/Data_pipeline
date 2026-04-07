import { BrowserRouter, Routes, Route, NavLink, Link, useLocation } from 'react-router-dom';
import { Component, Suspense, lazy, useState, useEffect, createContext, useContext, useCallback } from 'react';
import { LayoutDashboard, Zap, Target, GitBranch, Menu, X, Link2, Ticket, Shield, Code, FileText, Sun, Moon, Database, Download, Users, UserCheck } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
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
const DataPipeline = lazy(() => import('./pages/DataPipeline'));
const DailyReport = lazy(() => import('./pages/DailyReport'));
const Customers = lazy(() => import('./pages/Customers'));
const UnifiedContacts = lazy(() => import('./pages/UnifiedContacts'));

// Theme Context
const ThemeContext = createContext();

export function useTheme() {
  return useContext(ThemeContext);
}

function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    try {
      return localStorage.getItem('app-theme') || 'dark';
    } catch {
      return 'dark';
    }
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'light') {
      root.classList.remove('dark');
      root.classList.add('light');
    } else {
      root.classList.remove('light');
      root.classList.add('dark');
    }
    try { localStorage.setItem('app-theme', theme); } catch {}
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setThemeState(prev => prev === 'dark' ? 'light' : 'dark');
  }, []);

  const setTheme = useCallback((t) => {
    setThemeState(t);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

const NAV = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/segments', icon: Target, label: 'Segments' },
  { to: '/journeys', icon: GitBranch, label: 'Journeys' },
  { to: '/strategies', icon: Zap, label: 'Strategies' },
  { to: '/content', icon: FileText, label: 'Content' },
  { to: '/utm', icon: Link2, label: 'UTM Tracking' },
  { to: '/coupons', icon: Ticket, label: 'Coupons' },
  { to: '/approvals', icon: Shield, label: 'Approvals' },
  { to: '/gtm', icon: Code, label: 'GTM & BigQuery' },
  { to: '/customers', icon: Users, label: 'Customers' },
  { to: '/contacts', icon: UserCheck, label: 'Unified Contacts' },
  { to: '/data-pipeline', icon: Database, label: 'Data Pipeline' },
  { to: '/daily-report', icon: Download, label: 'Daily Report' },
];

const pageTransition = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.25, ease: [0.4, 0, 0.2, 1] }
};

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
    <motion.div className="not-found" {...pageTransition}>
      <h1>404</h1>
      <p>Page not found. The page you are looking for does not exist.</p>
      <Link to="/" className="btn btn-primary">Back to Dashboard</Link>
    </motion.div>
  );
}

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <div className="theme-toggle">
      <motion.button
        className="theme-toggle-btn"
        onClick={toggleTheme}
        aria-label="Toggle theme"
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
      >
        {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        <span>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
      </motion.button>
    </div>
  );
}

function AnimatedRoutes() {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait">
      <motion.div key={location.pathname} {...pageTransition}>
        <Routes location={location}>
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
          <Route path="/customers" element={<Customers />} />
          <Route path="/contacts" element={<UnifiedContacts />} />
          <Route path="/data-pipeline" element={<DataPipeline />} />
          <Route path="/daily-report" element={<DailyReport />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </motion.div>
    </AnimatePresence>
  );
}

function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
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
          <h1>Rayna Tours</h1>
          <span className="logo-sub">Omnichannel Platform</span>
        </div>
        <nav>
          {NAV.map(({ to, icon: Icon, label }, index) => (
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
        <ThemeToggle />
      </motion.aside>

      <main className="main">
        <ErrorBoundary>
          <Suspense fallback={<div className="spinner">Loading...</div>}>
            <AnimatedRoutes />
          </Suspense>
        </ErrorBoundary>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AppShell />
      </BrowserRouter>
    </ThemeProvider>
  );
}
