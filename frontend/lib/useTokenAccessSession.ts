'use client';

import { useEffect, useState } from 'react';

/**
 * Access-token session for a token-protected page (lib/leadsAccess) seen by a visitor who is
 * not signed in: seconds left (null = signed in, or not known yet), and a reload when it ends,
 * so the middleware asks for the token again. Same behaviour as the Leads page.
 */
export function useTokenAccessSession(): number | null {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    const signedIn = document.cookie.split('; ').some(c => c.startsWith('rayna-auth='));
    if (signedIn) return undefined;
    let expiryTimer: number | undefined;
    let countdownTimer: number | undefined;
    let cancelled = false;
    // Not under /api — in production every /api/* path is proxied to the Express backend.
    fetch('/leads-access/verify')
      .then(response => (response.ok ? response.json() as Promise<{ expiresAt?: number }> : null))
      .then(access => {
        const expiresAt = access?.expiresAt;
        if (cancelled || !expiresAt) return;
        const update = () => setSecondsLeft(Math.max(Math.ceil((expiresAt - Date.now()) / 1000), 0));
        update();
        countdownTimer = window.setInterval(update, 1000);
        expiryTimer = window.setTimeout(() => window.location.assign(window.location.href), Math.max(expiresAt - Date.now() + 250, 250));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (expiryTimer) window.clearTimeout(expiryTimer);
      if (countdownTimer) window.clearInterval(countdownTimer);
    };
  }, []);

  return secondsLeft;
}

/** "mm:ss" for the session chip, or "--:--" while unknown. */
export function formatSessionLeft(seconds: number | null): string {
  if (seconds == null) return '--:--';
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
