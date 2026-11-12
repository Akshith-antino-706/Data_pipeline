'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui';
import s from '../auth.module.css';

export default function LeadsAccessPage() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    if (!token.trim()) {
      setError('Enter the access token to continue.');
      return;
    }
    setLoading(true);
    try {
      // Not under /api — in production every /api/* path is proxied to the Express backend.
      const response = await fetch('/leads-access/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || 'Access denied');
      const requested = new URLSearchParams(window.location.search).get('next') || '/leads';
      const destination = requested === '/leads' || requested.startsWith('/leads?') ? requested : '/leads';
      router.replace(destination);
      router.refresh();
    } catch (err) {
      setError((err as Error).message || 'Access denied');
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
          <h2>Leads and registration data.</h2>
          <p>This area is protected by a separate access token.</p>
        </div>
        <span className={s.foot}>Need a token? Ask your admin.</span>
      </aside>

      <main className={s.main}>
        <div className={s.panel}>
          <div className={s.panelHead}>
            <h1>Protected Leads</h1>
            <p className={s.note}>Enter the access token to view leads and registration data.</p>
          </div>

          <form onSubmit={handleSubmit} className={s.form}>
            {error && <div role="alert" className={s.alert}>{error}</div>}
            <div className={s.field}>
              <label htmlFor="leads-token" className={s.label}>Access token</label>
              <div className={s.pwWrap}>
                <input
                  id="leads-token"
                  className={`${s.input} ${s.pwInput}`}
                  type={showToken ? 'text' : 'password'}
                  value={token}
                  onChange={event => setToken(event.target.value)}
                  autoComplete="off"
                  autoFocus
                  placeholder="Enter token"
                  aria-invalid={error ? true : undefined}
                />
                <button type="button" className={s.reveal} onClick={() => setShowToken(value => !value)} aria-label={showToken ? 'Hide token' : 'Show token'}>
                  {showToken ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
                  {showToken ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
            <Button type="submit" variant="primary" size="lg" className={s.submit} disabled={loading}>
              {loading && <Loader2 size={16} className={s.spin} aria-hidden />}
              {loading ? 'Checking…' : 'Continue'}
            </Button>
          </form>
        </div>
      </main>
    </div>
  );
}
