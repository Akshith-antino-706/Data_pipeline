import type { SesEventMessage } from './routesMisc.js';

/** The SNS envelope fields routes/sesWebhook reads. */
export interface U2SnsPayload {
  Type?: string;
  SubscribeURL: string;
  Message: string | SesEventMessage;
}

/** Optional journey/node reference accepted by several UTM routes. */
export interface U2JourneyNodeBody {
  journeyId?: string | number;
  nodeId?: string;
}

import type { ChatHeadContact } from './servicesChatHead.js';

/** Body of POST /api/v3/chathead/broadcasts. */
export interface U2ChBroadcastBody {
  contacts: ChatHeadContact[];
  dataFileId?: number;
  filename?: string;
  channelId?: string | number;
  channelName?: string;
  templateId?: string | number;
  templateName?: string;
  name: string;
  sendTime?: string;
}

/** Body of POST /api/v3/chathead/data-files/register. */
export interface U2ChRegisterBody {
  filename?: string;
  chatheadFilename?: string;
  contacts?: unknown[];
  fileBytes?: number;
  uploadResponse?: unknown;
  notes?: string;
}

/** Body of POST /api/v3/chathead/data-files. */
export interface U2ChDataFileBody {
  contacts?: ChatHeadContact[];
  filename?: string;
}

/** Body of POST /api/v3/chathead/test-send. */
export interface U2ChTestSendBody {
  phone?: string;
  name?: string;
  channelId?: string;
  channelName?: string;
  templateId?: string;
  templateName?: string;
}

/** data_files row selected by /broadcasts when reusing an existing file. */
export interface U2DataFileRow {
  id: number;
  filename: string;
  chathead_filename: string | null;
}

/** sync_metadata row as read by routes/raynaSync (type alias so it fits QueryResultRow). */
export type U2SyncMetaRow = {
  table_name: string;
  /** nullable in the DB; typed non-null because callers filter falsy values before use */
  last_synced_at: Date;
  rows_synced: number | null;
  sync_status: string | null;
  error_message: string | null;
  sync_duration_ms: number | null;
};

/** COUNT(*) results — pg returns bigint as string. */
export type U2CountRow = { count: string };
export type U2CRow = { c: string };
export type U2LatestRow = { latest: Date | null };
