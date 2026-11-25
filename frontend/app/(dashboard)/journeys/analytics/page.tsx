'use client';

/**
 * Performance (/journeys/analytics) — how journeys and messages are doing, in plain words.
 *
 *  - Top: period picker, "At a glance" numbers and charts (InsightsOverview, one API call).
 *  - Bottom: "Your journeys" (JourneysTable) — all-time rollup, paged on the server; a journey's
 *    step breakdown loads only when its row is opened.
 *
 * Also opens without a login with the access token (same as Leads, lib/leadsAccess): then it is
 * read-only — no refresh, re-run checks, CSV or links into the signed-in app.
 *
 * At ≥1025px the page fits one screen and the journeys table scrolls inside its card.
 */

import InsightsOverview from './InsightsOverview';
import JourneysTable from './JourneysTable';
import { useAuth } from '@/context/AuthContext';
import { StatusChip } from '@/components/ui';
import { useTokenAccessSession, formatSessionLeft } from '@/lib/useTokenAccessSession';
import styles from './analytics.module.css';

export default function JourneyAnalyticsPage() {
  const { isAuthenticated } = useAuth();
  const sessionSecondsLeft = useTokenAccessSession();

  return (
    <div className={styles.page}>
      {!isAuthenticated && (
        <div className={styles.brand}>
          <img src="/rayna-logo.webp" alt="Rayna Tours" className={styles.brandLogo} />
        </div>
      )}
      <header className={styles.header}>
        <h1 className={styles.title}>Performance</h1>
        <p className={styles.subtitle}>How your journeys and messages are doing</p>
        {sessionSecondsLeft != null && (
          <span className={styles.sessionChip} title="You will be asked for the access token again when this timer ends">
            <StatusChip tone={sessionSecondsLeft === 0 ? 'bad' : 'ok'}>Secure session · {formatSessionLeft(sessionSecondsLeft)}</StatusChip>
          </span>
        )}
      </header>

      <InsightsOverview />

      <JourneysTable readOnly={!isAuthenticated} />
    </div>
  );
}
