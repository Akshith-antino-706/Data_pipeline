// Type-only shapes for routes/products.ts, routes/segmentsV3.ts, routes/gupshup.ts.

export interface GenerateEmailBody {
  segmentLabel?: string;
  heading?: string;
  subheading?: string;
  ctaText?: string;
  ctaUrl?: string;
  couponCode?: string;
  productCount?: number;
}

export interface GenerateWaBody {
  segmentLabel?: string;
  intro?: string;
  couponCode?: string;
  productCount?: number;
}

export interface GeneralCounts {
  emailEligible: number;
  waEligible: number;
  totalContacts: number;
}

export interface CountNRow {
  n: number;
}

export interface GeneralJourneyRow {
  journey_id: number;
  name: string;
  description: string | null;
  status: string;
  audience: unknown;
  total_entries: number | null;
  total_conversions: number | null;
  total_exits: number | null;
  node_count: number | null;
  created_at: Date;
  updated_at: Date;
}

export interface SetExternalIdBody {
  externalId?: string;
  status?: string;
  category?: string | null;
}

export interface SmsTestSendBody {
  phone?: string | number;
  templateId?: string;
  name?: string;
}

export interface RcsTestSendBody {
  phone?: string | number;
  templateCode?: string;
  name?: string;
  customParams?: Record<string, unknown> | null;
  smsFallback?: string | null;
}

export interface CtmTemplateListResponse {
  templates?: import('./routesGupshup.js').RcsTemplate[];
}
