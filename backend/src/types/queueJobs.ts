/**
 * Shared type-only definitions for the BullMQ journey queues
 * (src/services/queue/index.ts + workers.ts).
 */
import type { JobsOptions, Queue, Worker } from 'bullmq';

/** Channel keys accepted by getQueue / enqueueBatch / pauseQueue etc. */
export type QueueChannel = 'email' | 'whatsapp' | 'sms' | 'rcs' | 'welcome' | 'gtmJourney';

/** Journey graph node as stored in journey_flows.nodes (JSONB). */
export interface JourneyNode {
  id: string;
  type?: string;
  data?: { track?: string; [key: string]: unknown };
  [key: string]: unknown;
}

/** Journey graph edge as stored in journey_flows.edges (JSONB). */
export interface JourneyEdge {
  source: string;
  target: string;
  [key: string]: unknown;
}

export type JourneyNodeMap = Record<string, JourneyNode>;

/** Payload of journey-email / journey-wa / journey-sms / journey-rcs jobs (built in JourneyService.processJourney). */
export interface JourneySendJobData {
  entryId: string | number;
  customerId: string | number;
  journeyId: string;
  nodeId: string;
  runId?: string | null;
  channel: string;
  templateId: string;
  htmlTemplateId?: string | number | null;
  waChannelId?: string | null;
  waChannelName?: string | null;
  waTemplateId?: string | null;
  waTemplateName?: string | null;
  rcsTemplateCode?: string | null;
  rcsTemplateName?: string | null;
  rcsCustomParams?: Record<string, string> | null;
  emailCredential?: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  isIndian?: boolean | null;
  track?: string;
  autoPaired?: boolean;
  originalChannel?: string;
  templateVariables?: Record<string, unknown>;
  enqueuedDubaiDate?: string;
  firstActionNodeId?: string | null;
  /** Legacy in-flight jobs only: embedded journey graph. */
  edges?: JourneyEdge[];
  nodes?: JourneyNodeMap;
  /** Legacy/test-only: not set by current producers. */
  testIntervalMin?: number | null;
}

/** Payload of welcome-email jobs (WelcomeEmailService). */
export interface WelcomeJobData {
  unifiedId?: string | number;
  eventName?: string;
  eventId?: string | number;
}

/** Payload of gtm-journey jobs (GtmJourneyService / ContinuousJourneyService). */
export interface GtmJourneyJobData {
  entryId?: string | number;
  journeyId?: string | number;
  unifiedId?: string | number;
  eventId?: string | number | null;
  nodeId?: string | null;
  itemId?: string | number | null;
}

export type QueueJobData = JourneySendJobData | WelcomeJobData | GtmJourneyJobData;

export interface BatchJobInput {
  name?: string;
  data: QueueJobData;
  opts?: JobsOptions;
}

export interface JourneyQueues {
  email: Queue;
  wa: Queue;
  sms: Queue;
  rcs: Queue;
  welcome: Queue;
  gtmJourney: Queue;
}

export interface JourneyWorkers {
  email: Worker<JourneySendJobData>;
  wa: Worker<JourneySendJobData>;
  sms: Worker<JourneySendJobData>;
  rcs: Worker<JourneySendJobData>;
  welcome: Worker<WelcomeJobData>;
  gtmJourney: Worker<GtmJourneyJobData>;
}

/** Normalised per-message send outcome used by the WA / SMS / RCS processors. */
export interface ChannelSendResult {
  success: boolean;
  provider?: string | null;
  externalId?: string | null;
  error?: string | null;
  simulated?: boolean;
  blocked?: boolean;
}
