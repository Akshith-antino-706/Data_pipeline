/**
 * Shared shapes for the email channel transports (EmailChannel, ChatheadEmailChannel,
 * JourneyEmailSender). Every transport returns a subset of EmailSendResult.
 */

export interface EmailSendArgs {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}

export interface EmailSendResult {
  success: boolean;
  provider?: string;
  externalId?: string | null;
  error?: string;
  simulated?: boolean;
  skipped?: boolean;
  blocked?: boolean;
  reason?: string;
  durationMs?: number;
  status?: number;
  body?: ChatheadApiResponse | null;
  raw?: string | null;
  providerResponse?: SendGridErrorResponse;
}

/** JSON body returned by the AWS Email relay. */
export interface ChatheadApiResponse {
  status?: string;
  message_id?: string;
  id?: string;
  msg?: string;
  message?: string;
}

export interface ChatheadSendArgs {
  to?: string;
  subject?: string;
  html?: string;
  fromAddress?: string | null;
}

export interface JourneyEmailArgs {
  emailCredential?: string;
  to: string;
  subject: string;
  html: string;
  /** Contact id — when set, SMTP sends carry RFC 8058 one-click List-Unsubscribe headers. */
  unifiedId?: string | number | null;
}

export interface SendGridErrorResponse {
  errors?: Array<{ message?: string }>;
}

/** One SendGrid event-webhook entry (only the fields parseWebhook reads). */
export interface SendGridWebhookEvent {
  sg_message_id?: string;
  email?: string;
  event?: string;
  timestamp?: number;
  url?: string;
  reason?: string;
  ip?: string;
  useragent?: string;
}
