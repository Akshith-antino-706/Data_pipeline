/** A button on a ChatHead template-create request (POST /api/v3/chathead/templates/create). */
export interface ChatheadTemplateButton {
  type?: string;
  sub_type?: string;
  otp_type?: string;
  value?: string;
  text?: string;
  example?: string;
  [extra: string]: unknown;
}

/** One carousel card as sent by the frontend (formate=carousel). */
export interface ChatheadCarouselCardInput {
  header_format?: string;
  media_file?: string;
  body?: string;
  body_examples?: unknown;
  buttons?: ChatheadTemplateButton[];
}

/** One carousel card as forwarded to ChatHead. */
export interface ChatheadCarouselCard {
  header_format: string;
  media_file: string;
  body?: string;
  body_examples?: unknown;
  buttons?: ChatheadTemplateButton[];
}

/** Body of POST /templates/create as sent by the frontend. */
export interface ChatheadTemplateBody {
  channel?: string | number;
  name?: string;
  category?: string;
  formate?: string;
  body?: string;
  body_examples?: unknown;
  header_text?: string;
  footer_text?: string;
  media_file?: string;
  buttons?: ChatheadTemplateButton[];
  cards?: ChatheadCarouselCardInput[];
  add_security_recommendation?: boolean;
  code_expiration_minutes?: string | number | null;
}

/** Payload forwarded to ChatHead account/templates/add. */
export interface ChatheadTemplatePayload {
  c: string;
  app_key: string;
  channel: number;
  name?: string;
  category?: string;
  add_security_recommendation?: boolean;
  code_expiration_minutes?: number;
  buttons?: ChatheadTemplateButton[];
  formate?: string;
  body?: string;
  body_examples?: unknown;
  footer_text?: string;
  media_file?: string;
  cards?: ChatheadCarouselCard[];
}

/** Loosely-typed JSON reply from ChatHead's PHP endpoints. */
export interface ChatheadJson {
  status?: string;
  msg?: string;
  [key: string]: unknown;
}
