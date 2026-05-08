import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Mail, Lock, ArrowLeft, Loader } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.4, 0, 0.2, 1] } },
};

export default function LoginPage() {
  const { isAuthenticated, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  if (isAuthenticated) return <Navigate to="/" replace />;

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!email || !password) {
      toast.error('Please enter both email and password');
      return;
    }

    setLoading(true);
    try {
      await login(email, password);
      toast.success('Welcome back!');
      navigate('/', { replace: true });
    } catch (err) {
      toast.error(err.message || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page" style={{ background: '#ffffff' }}>
      <motion.div
        className="login-card"
        variants={fadeUp}
        initial="hidden"
        animate="show"
        style={{ background: '#fff', borderColor: '#eee' }}
      >
        {/* Brand header */}
        <div className="login-brand">
          <img src="/rayna-logo.webp" alt="Rayna Tours" style={{ height: 56, objectFit: 'contain', margin: '0 auto', display: 'block' }} />
          <h1 style={{ color: '#111' }}>Rayna Tours</h1>
          <p style={{ color: '#111' }}>Omnichannel Platform</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="login-form">
          <div className="login-field">
            <label htmlFor="email" style={{ color: '#555' }}>Email</label>
            <div className="login-input-wrap">
              <Mail size={16} className="login-input-icon" style={{ color: '#999' }} />
              <input
                id="email"
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                autoFocus
                style={{ background: '#fafafa', border: '1px solid #e5e5e5', color: '#111' }}
              />
            </div>
          </div>

          <div className="login-field">
            <label htmlFor="password" style={{ color: '#555' }}>Password</label>
            <div className="login-input-wrap">
              <Lock size={16} className="login-input-icon" style={{ color: '#999' }} />
              <input
                id="password"
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                style={{ background: '#fafafa', border: '1px solid #e5e5e5', color: '#111' }}
              />
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-lg login-submit"
            disabled={loading}
            style={{ background: '#111', color: '#fff', border: 'none' }}
          >
            {loading ? <Loader size={16} className="spin" /> : null}
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        {/* Back link */}
        <Link to="/landing" className="login-back" style={{ color: '#999' }}>
          <ArrowLeft size={14} />
          Back to home
        </Link>
      </motion.div>
    </div>
  );
}
