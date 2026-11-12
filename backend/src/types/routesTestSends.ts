/** Types local to src/routes/testSends.ts. */
import type { EmailSendArgs, EmailSendResult } from './channels.js';

export type QueryParams = Record<string, string | undefined>;

/** unified_contacts row resolved from a request's `emails[]`. */
export interface Recipient {
  unified_id: number | string;
  email: string;
}

/** Any email transport class (ChatheadEmailChannel / EmailChannel). */
export interface EmailTransport {
  send(args: EmailSendArgs): Promise<EmailSendResult>;
}

/** Result of one transport send, or the synthetic failure built when it throws. */
export type SendAttemptResult = Omit<EmailSendResult, 'provider'> & { provider?: string | null };

export interface SendAndLogArgs {
  EmailChannel: EmailTransport;
  recipient: Recipient;
  subject: string;
  html: string;
  templateLabel: string;
  dayNumber: number;
  source?: string;
  journeyId?: number | null;
  nodeId?: string | null;
}

export interface SendOutcome {
  email: string;
  unifiedId?: number | string;
  sendLogId?: number | string | null;
  success: boolean;
  externalId?: string | null;
  error?: string | null;
  ms?: number;
}

/** Failure row written by parallelMap when `fn` throws. */
export interface ParallelFailure {
  email: string | undefined;
  success: false;
  error: string;
}

export interface BatchJob {
  status: string;
  total?: number;
  sent?: number;
  failed?: number;
  results?: unknown[];
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface ResolvedTemplate {
  html: string;
  subject: string;
  dynamic: boolean;
}
