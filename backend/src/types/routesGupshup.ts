/** Outcome of a Gupshup SMS test send (service result, or the caught-error shape). */
export interface SmsSendOutcome {
  success?: boolean;
  simulated?: boolean;
  blocked?: boolean;
  provider?: string;
  externalId?: string | null;
  error?: unknown;
}

/** A node of the Gupshup CTM RCS template component tree (walked recursively). */
export interface RcsNode {
  type?: string;
  text?: { body?: string };
  image?: { url?: string };
  button?: { text?: string; action?: { type?: string; value?: string } };
  [key: string]: unknown;
}

export interface RcsTemplate {
  id?: string;
  gsTemplateId?: string;
  status?: string;
  createdOn?: string;
  channelParams?: { elementName?: string; templateType?: string };
  components?: RcsNode[];
}

export interface RcsButton {
  text: string;
  action: string;
}
