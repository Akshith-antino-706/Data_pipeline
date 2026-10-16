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

/** Body of POST /templates/create as sent by the frontend. */
export interface ChatheadTemplateBody {
  channel?: string | number;
  name?: string;
  category?: string;
  formate?: string;
  body?: string;
  body_examples?: unknown;
  footer_text?: string;
  media_file?: string;
  buttons?: ChatheadTemplateButton[];
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
}

/** Loosely-typed JSON reply from ChatHead's PHP endpoints. */
export interface ChatheadJson {
  status?: string;
  msg?: string;
  [key: string]: unknown;
}
