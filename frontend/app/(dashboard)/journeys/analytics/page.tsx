'use client';

/**
 * Performance (/journeys/analytics) — how journeys and messages are doing, in plain words.
 *
 *  - Top: period picker, "At a glance" numbers and charts (InsightsOverview, one API call).
 *  - Bottom: "Your journeys" (JourneysTable) — all-time rollup, paged on the server; a journey's
 *    step breakdown loads only when its row is opened.
 *
 * At ≥1025px the page fits one screen and the journeys table scrolls inside its card.
 */

import InsightsOverview from './InsightsOverview';
import JourneysTable from './JourneysTable';
import styles from './analytics.module.css';

export default function JourneyAnalyticsPage() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Performance</h1>
        <p className={styles.subtitle}>How your journeys and messages are doing</p>
      </header>

      <InsightsOverview />

      <JourneysTable />
    </div>
  );
}
