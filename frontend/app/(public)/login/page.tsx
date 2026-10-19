'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui';
import s from '../auth.module.css';

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
          <h2>Reach every traveller at the right moment.</h2>
          <p>Journeys, sends and insights for Rayna Tours — for the marketing team only.</p>
        </div>
        <span className={s.foot}>Trouble signing in? Ask your admin.</span>
      </aside>

      <main className={s.main}>
        <div className={s.panel}>
          <div>
            <h1>Sign in</h1>
            <p className={s.note}>Use your Rayna work email.</p>
          </div>

          <form onSubmit={handleSubmit} className={s.form} noValidate>
            <div className={s.field}>
              <label htmlFor="email" className={s.label}>Work email</label>
              <input
                id="email"
                className={s.input}
                type="email"
                placeholder="you@raynatours.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                autoFocus
              />
            </div>

            <div className={s.field}>
              <label htmlFor="password" className={s.label}>Password</label>
              <div className={s.pwWrap}>
                <input
                  id="password"
                  className={`${s.input} ${s.pwInput}`}
                  type={showPassword ? 'text' : 'password'}
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

          <Link href="/" className={s.back}>
            <ArrowLeft size={14} aria-hidden />
            Back to home
          </Link>
        </div>
      </main>
    </div>
  );
}
