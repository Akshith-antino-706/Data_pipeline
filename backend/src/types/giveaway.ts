/**
 * Giveaway §3 message contract (as published by the producer to RabbitMQ / enqueued to BullMQ).
 * Fields are optional because validation runs on untrusted input; validate() checks the
 * required ones (version, id, type, to.email, subject, body).
 */
export type GiveawayType = 'participation' | 'eligible' | 'winner' | 'loser';

export interface GiveawayRecipient {
  email?: string;
  name?: string;
}

export interface GiveawayEventData {
  user?: { name?: unknown };
  giveaway?: { title?: unknown; image?: unknown; mechanic?: unknown };
  prize?: { name?: unknown; image?: unknown; type?: unknown; value?: unknown };
  winner?: { rank?: unknown; code?: unknown };
  offer?: { name?: unknown; code?: unknown; expiry?: unknown };
  participant?: { position?: unknown; points?: unknown };
}

export interface GiveawayMessage {
  version?: number;
  id?: string | number;
  type?: string;
  tenantId?: string | number;
  giveawayId?: string | number;
  to?: GiveawayRecipient;
  subject?: string;
  body?: string;
  bodyFormat?: string;
  createdAt?: string;
  data?: GiveawayEventData;
}

export type GiveawayValidation = { ok: true } | { ok: false; reason: string };

/** Return value of the BullMQ giveaway worker job processor. */
export interface GiveawayJobResult {
  dropped?: boolean;
  reason?: string;
  duplicate?: boolean;
  logged?: boolean;
}

/**
 * ioredis `SET key value NX EX seconds`. Redis accepts NX before EX, but ioredis' overloads
 * only list the EX-then-NX order, so the call sites assert to this signature.
 */
export type RedisSetNxEx = (key: string, value: string, nx: 'NX', ex: 'EX', seconds: number) => Promise<'OK' | null>;
