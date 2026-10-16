// Shapes read by app/(dashboard)/content/page.tsx (content templates + test-send QA).

/** One row of GET /api/v2/content/templates (and getTemplate). */
export interface ContentTemplate {
  id: number;
  name?: string;
  channel: string;
  status: string;
  subject?: string | null;
  body?: string;
  body_plain?: string;
  html_body?: string;
  cta_text?: string;
  segment_label?: string;
  updated_at?: string;
}

/** Contact row from GET /api/v3/test-sends/contacts. */
export interface TestSendRecipient {
  id?: number | string;
  email?: string;
  actual_email?: string;
  contact_type?: string;
  booking_status?: string;
  name?: string;
  country?: string;
}

/** Real IMAP inbox-placement result. */
export interface InboxPlacement {
  available?: boolean;
  placement?: string;
  error?: string;
  foundAt?: string;
  note?: string;
}

export interface QaUrlResult {
  ok?: boolean;
  status?: number | string;
  error?: string;
  url?: string;
}

/** Email QA report (analyze-email / stored qa-report). */
export interface QaReportData {
  error?: string;
  subject?: string;
  generatedAt?: string;
  placement?: InboxPlacement;
  spamRisk?: { level?: string; reasons?: string[] };
  grammar?: string[];
  missingContent?: string[];
  errors?: string[];
  urls?: { total?: number; broken?: number; results?: QaUrlResult[] };
  analysisSource?: string;
}

export interface QaReportState {
  template: ContentTemplate;
  report: QaReportData | null;
}

export interface TemplatePreviewState {
  template: ContentTemplate;
  html: string | null;
  loading: boolean;
  ai?: boolean;
}

export interface PreviewFit {
  scale: number;
  height: number | null;
  contentW?: number | null;
  contentH?: number;
}
