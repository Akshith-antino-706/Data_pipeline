'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, KeyRound, Loader2, LockKeyhole } from 'lucide-react';

export default function LeadsAccessPage() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    if (!token.trim()) {
      setError('Enter the access token to continue.');
      return;
    }
    setLoading(true);
    try {
      const response = await fetch('/api/leads-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Access denied');
      const requested = new URLSearchParams(window.location.search).get('next') || '/leads';
      const destination = requested === '/leads' || requested.startsWith('/leads?') ? requested : '/leads';
      router.replace(destination);
      router.refresh();
    } catch (err) {
      setError(err.message || 'Access denied');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#f7f8fa' }}>
      <section style={{ width: '100%', maxWidth: 420, padding: 32, borderRadius: 16, background: '#fff', border: '1px solid #e5e7eb', boxShadow: '0 18px 45px rgba(15,23,42,0.10)' }}>
        <img src="/rayna-logo.webp" alt="Rayna Tours" style={{ height: 52, display: 'block', margin: '0 auto 24px', objectFit: 'contain' }} />
        <div style={{ width: 48, height: 48, margin: '0 auto 14px', borderRadius: 12, display: 'grid', placeItems: 'center', background: 'rgba(14,165,233,0.12)', color: '#0284c7' }}>
          <LockKeyhole size={23} />
        </div>
        <h1 style={{ margin: 0, textAlign: 'center', fontSize: 22, color: '#111827' }}>Protected Leads</h1>
        <p style={{ margin: '8px 0 24px', textAlign: 'center', color: '#6b7280', fontSize: 14, lineHeight: 1.5 }}>Enter the access token to view leads and registration data.</p>

        <form onSubmit={handleSubmit}>
          <label htmlFor="leads-token" style={{ display: 'block', marginBottom: 7, color: '#374151', fontSize: 13, fontWeight: 600 }}>Access token</label>
          <div style={{ position: 'relative' }}>
            <KeyRound size={17} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
            <input id="leads-token" type={showToken ? 'text' : 'password'} value={token} onChange={event => setToken(event.target.value)} autoComplete="off" autoFocus placeholder="Enter token" style={{ width: '100%', boxSizing: 'border-box', padding: '11px 42px 11px 39px', borderRadius: 9, border: `1px solid ${error ? '#dc2626' : '#d1d5db'}`, background: '#fff', color: '#111827', fontSize: 14, outline: 'none' }} />
            <button type="button" onClick={() => setShowToken(value => !value)} aria-label={showToken ? 'Hide token' : 'Show token'} style={{ position: 'absolute', right: 11, top: '50%', transform: 'translateY(-50%)', padding: 2, border: 0, background: 'transparent', color: '#9ca3af', cursor: 'pointer', display: 'flex' }}>
              {showToken ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div>
          {error && <div role="alert" style={{ marginTop: 8, color: '#dc2626', fontSize: 12.5 }}>{error}</div>}
          <button type="submit" disabled={loading} style={{ width: '100%', marginTop: 18, padding: '11px 16px', border: 0, borderRadius: 9, background: '#111827', color: '#fff', fontSize: 14, fontWeight: 600, cursor: loading ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: loading ? 0.75 : 1 }}>
            {loading && <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />}
            {loading ? 'Checking…' : 'Continue'}
          </button>
        </form>
      </section>
    </main>
  );
}
