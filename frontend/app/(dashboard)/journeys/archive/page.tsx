'use client';

/**
 * Journey Archive — completed journeys that were exported to S3 (read-only).
 *
 * Laid out like Performance (/journeys/analytics): "At a glance" totals, then the journeys table
 * with the same search, filters, sorting, pages, CSV, step breakdown, "Steps on [day]" and message
 * previews (ArchiveTable). Everything comes from the archive files in S3 via
 * /api/v3/journey-archive — never the live database.
 */

import ArchiveTable from './ArchiveTable';
import styles from '../analytics/analytics.module.css';

export default function JourneyArchivePage() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Journey Archive</h1>
        <p className={styles.subtitle}>Finished journeys moved to S3 storage · read-only, final numbers at the time each was archived</p>
      </header>

      <ArchiveTable />
    </div>
  );
}
