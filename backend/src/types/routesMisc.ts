/** Result of spawning incremental_sync.py (routes/mysqlSync). */
export interface PythonSyncResult {
  exitCode: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
}

/**
 * Methods routes/mysqlSync calls on MySQLSyncService that the service does NOT
 * implement (pre-existing bug: those endpoints throw → 500). Typed here so the
 * route compiles unchanged; remove once the service gains them or the routes go.
 */
export interface MissingMySQLSyncMethods {
  getSyncStatus(): Promise<unknown>;
  discoverSchema(): Promise<unknown>;
}

/** Same situation for routes/gtm GET /tracking-bundle → GTMService.getTrackingBundle (not implemented). */
export interface MissingGTMMethods {
  getTrackingBundle(): unknown;
}

import type { DataCleaningService } from '../services/DataCleaningService.js';

type CleanPhoneResult = ReturnType<typeof DataCleaningService.cleanPhone>;
type PhoneCountryInfo = NonNullable<NonNullable<CleanPhoneResult>['countryInfo']>;

/** Response body of POST /api/v2/enrichment/preview (routes/enrichment). */
export interface EnrichmentPreview {
  phone: CleanPhoneResult;
  email: ReturnType<typeof DataCleaningService.cleanEmail>;
  gender: ReturnType<typeof DataCleaningService.inferGender>;
  inferredNationality?: PhoneCountryInfo['nationality'];
  inferredCountry?: PhoneCountryInfo['country'];
}

/** In-process no-op stand-in for a Redis client (routes/segmentsV3 /general-counts). */
export interface RedisCacheStub {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', ttlSeconds: number): Promise<void>;
}

import type CustomSegmentService from '../services/CustomSegmentService.js';

/**
 * routes/customSegments POST /preview-count passes `operator` as a 2nd argument,
 * but CustomSegmentService.getCountPreview only takes `conditions` (the operator
 * is silently ignored — pre-existing behaviour, kept as-is).
 */
export type CountPreviewWithOperator = (
  conditions: Parameters<typeof CustomSegmentService.getCountPreview>[0],
  operator: unknown,
) => ReturnType<typeof CustomSegmentService.getCountPreview>;

/** The subset of an AWS SES event-publishing notification that routes/sesWebhook reads. */
export interface SesEventMessage {
  eventType?: string;
  notificationType?: string;
  mail?: { messageId?: string; destination?: string[] };
  bounce?: { bounceType?: string; bouncedRecipients?: Array<{ emailAddress?: string }> };
  complaint?: { complaintFeedbackType?: string; complainedRecipients?: Array<{ emailAddress?: string }> };
  delivery?: { recipients?: string[] };
  open?: { userAgent?: string; ipAddress?: string };
  click?: { userAgent?: string; ipAddress?: string; link?: string };
}
