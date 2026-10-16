/** Types for src/services/AIAgents.ts and AIService.ts (type-only module). */

/** Subset of the Anthropic Messages API JSON response that is read. */
export interface ClaudeMessagesResponse {
  content?: { type?: string; text?: string }[];
  [key: string]: unknown;
}

/** Generated marketing copy (AI JSON or rule-based fallback). */
export interface CopyContent {
  subject?: string;
  body?: string;
  cta_text?: string;
  cta_url?: string;
  ai_generated?: boolean;
  model?: string;
  [key: string]: unknown;
}

/** Journey node as read by FlowAssist. */
export interface FlowNode {
  id?: string;
  type?: string;
  data?: { channel?: string; [key: string]: unknown };
  [key: string]: unknown;
}

export interface FlowSuggestion {
  type: string;
  node_id?: string;
  title: string;
  description: string;
  impact: string;
  [key: string]: unknown;
}

export interface FlowResult {
  suggestions?: FlowSuggestion[];
  overall_score: number;
  [key: string]: unknown;
}

/** AIService.generateContent() argument object. */
export interface GenerateContentArgs {
  channel: string;
  segmentLabel: string;
  tone?: string;
  goal?: string;
  productContext?: string;
}

/** One rule-based fallback template in AIService. */
export interface FallbackTemplate {
  subject?: string;
  body: string;
  ctaText?: string;
}
