/**
 * Type-only shapes for ChatHeadV1Service (ChatHead v1 WhatsApp broadcast API).
 */

/** One broadcast recipient; `vars` are extra per-recipient template variables. */
export interface ChatHeadContact {
  phone?: string | null;
  name?: string | null;
  vars?: Record<string, unknown> | null;
}

/** data_files row returned by buildAndSaveDataFile. */
export interface ChatHeadDataFile {
  id: number;
  filename: string;
  content: string;
  /** Rows whose header image (`img`) was filled from the template/global default. */
  mediaFilled?: number;
}

/** Options for buildAndSaveDataFile (a bare string is still accepted as the filename). */
export interface BuildDataFileOptions {
  filename?: string | null;
  /** Header image used for rows that carry no `img`, e.g. the template's own artwork. */
  defaultMedia?: string | null;
}

/** JSON body returned by ChatHead's upload / broadcast endpoints. */
export interface ChatHeadV1Response {
  status?: string;
  msg?: string;
  data?: { name?: string; broadcast_id?: string | number };
  error?: string;
}

export interface ChatHeadUploadResult {
  ok: boolean;
  response: string;
  parsed: ChatHeadV1Response | null;
  chatheadFilename: string | null;
}

export interface CreateBroadcastArgs {
  dataFileId: number;
  dataFilename: string;
  channelId: number;
  channelName?: string | null;
  templateId: number;
  templateName?: string | null;
  name: string;
  sendTime: Date | string;
}

export interface CreateBroadcastResult {
  id: number;
  status: string;
  chatheadBroadcastId: string | number | null;
  raw: string | ChatHeadV1Response | null;
}

export interface SendBroadcastArgs extends Omit<CreateBroadcastArgs, 'dataFileId' | 'dataFilename'> {
  contacts: ChatHeadContact[];
  filename?: string | null;
  /** Explicit header image; when absent the template's own header image is looked up. */
  defaultMedia?: string | null;
}

export interface SendBroadcastResult {
  success: boolean;
  stage?: string;
  error?: string;
  broadcast?: CreateBroadcastResult;
  dataFileId: number;
}
