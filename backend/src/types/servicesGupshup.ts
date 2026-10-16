/**
 * Type-only shapes for GupshupService (WhatsApp / SMS / RCS via Gupshup).
 */

export type TemplateId = number | string;

/** Error thrown by the RCS template API on 401/403. */
export type UnauthorizedError = Error & { unauthorized?: boolean };

/** content_templates row (only the columns GupshupService reads). */
export interface GupshupTemplateRow {
  id: number;
  name?: string | null;
  channel: string;
  body?: string | null;
  subject?: string | null;
  category?: string | null;
  external_status?: string | null;
  external_template_id?: string | null;
  external_category?: string | null;
  external_language?: string | null;
}

export interface TemplateSubmitResult {
  simulated: boolean;
  externalId: string | null;
  status: string;
  category: string;
  raw: unknown;
}

export interface RcsTemplateSummary {
  code: string;
  name: string;
  gsTemplateId: string | null;
  templateId: string | null;
  status: string | null;
  type: string | null;
  lastUpdate: string | null;
}

export interface RcsTemplateButton {
  text: string;
  action: string;
}

/** Normalised result of sendWhatsApp / sendSMS / sendRCS. */
export interface GupshupSendResult {
  success: boolean;
  simulated?: boolean;
  provider: string;
  externalId?: string | null;
  raw?: unknown;
  error?: string;
  blocked?: boolean;
}

export interface GupshupBulkResult extends GupshupSendResult {
  transactionId?: string | null;
  count?: number;
}

export interface SendWhatsAppArgs {
  to: string;
  templateId: TemplateId;
  params?: string[];
}

export interface SendSMSArgs {
  to: string;
  templateId: TemplateId;
  messageBody?: string | null;
}

export interface SendRCSArgs {
  to: string;
  templateCode: string;
  customParams?: Record<string, unknown> | null;
  smsFallback?: string | null;
}

export interface RcsBulkContact {
  phone: string;
  vars?: Record<string, unknown>;
}

export interface SendRcsBulkArgs {
  contacts: RcsBulkContact[];
  templateCode: string;
  varKeys?: string[];
  msgId?: string | null;
}

/** Template-event webhook payload from Gupshup. */
export interface GupshupWebhookPayload {
  type?: string;
  templateId?: string;
  status?: string;
  reason?: string;
  template?: { id?: string; status?: string };
}
