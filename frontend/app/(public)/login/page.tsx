'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader, Eye, EyeOff, Mail, Lock, Route, Send, BarChart3 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui';
import s from '../auth.module.css';

/** What the workspace does — product description only, no figures. */
const FEATURES = [
  { icon: Route, title: 'Journeys', text: 'Automated email, WhatsApp and SMS flows for each audience.' },
  { icon: Send, title: 'Sends', text: 'Every message tracked from sent to opened, clicked and booked.' },
  { icon: BarChart3, title: 'Insights', text: 'Segments, website activity and performance at a glance.' },
];

export default function LoginPage() {
  const { isAuthenticated, login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (isAuthenticated) router.replace('/dashboard');
  }, [isAuthenticated, router]);

  if (isAuthenticated) return null;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!email || !password) {
      toast.error('Please enter both email and password');
      return;
    }

    setLoading(true);
    try {
      await login(email, password);
      toast.success('Welcome back!');
      router.replace('/dashboard');
    } catch (err) {
      toast.error((err as Error).message || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={s.page}>
      <aside className={s.brand}>
        <span className={s.logoWrap}>
          <img src="/rayna-logo.webp" alt="Rayna Tours" className={s.logo} />
        </span>
        <div className={s.pitch}>
          <span className={s.eyebrow}>Marketing workspace</span>
          <h2>Reach every traveller at the right moment.</h2>
          <p>Journeys, sends and insights for Rayna Tours, in one place for the marketing team.</p>
          <ul className={s.features}>
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <li key={title} className={s.feature}>
                <span className={s.featureIcon} aria-hidden><Icon size={16} /></span>
                <span className={s.featureText}><b>{title}</b><span>{text}</span></span>
              </li>
            ))}
          </ul>
        </div>
        <span className={s.foot}>© Rayna Tours · Internal use only</span>
      </aside>

      <main className={s.main}>
        <div className={s.panel}>
          <div className={s.panelHead}>
            <h1>Welcome back</h1>
            <p className={s.note}>Sign in with your Rayna work email.</p>
          </div>

          <form onSubmit={handleSubmit} className={s.form} noValidate>
            <div className={s.field}>
              <label htmlFor="email" className={s.label}>Work email</label>
              <div className={s.inputWrap}>
                <Mail size={16} className={s.inputIcon} aria-hidden />
                <input
                  id="email"
                  className={`${s.input} ${s.withIcon}`}
                  type="email"
                  placeholder="you@raynatours.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  autoFocus
                />
              </div>
            </div>

            <div className={s.field}>
              <label htmlFor="password" className={s.label}>Password</label>
              <div className={s.pwWrap}>
                <Lock size={16} className={s.inputIcon} aria-hidden />
                <input
                  id="password"
                  className={`${s.input} ${s.withIcon} ${s.pwInput}`}
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className={s.reveal}
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <Button type="submit" variant="primary" size="lg" className={s.submit} disabled={loading}>
              {loading ? <Loader size={16} className={s.spin} aria-hidden /> : null}
              {loading ? 'Signing in...' : 'Sign in'}
            </Button>
          </form>

          <div className={s.panelFoot}>
            <Link href="/" className={s.back}>
              <ArrowLeft size={14} aria-hidden />
              Back to home
            </Link>
            <span>Trouble signing in? Ask your admin.</span>
          </div>
        </div>
      </main>
    </div>
  );
}
