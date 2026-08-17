/**
 * ChatHeadV1Service
 *
 * Wraps the 3-step ChatHead v1 broadcast send:
 *   1. buildAndSaveDataFile(contacts)  → row in data_files, returns { id, filename, content }
 *   2. uploadDataFile(dataFileRow)      → POST /broadcast/data/add/   (Filedata + client=rayna)
 *   3. createBroadcast({...})           → GET  /broadcast/add/        (returns broadcast row)
 *
 * Both writes (data_files row + chathead_broadcasts row) are recorded so we can
 * audit and replay even though ChatHead's API returns minimal feedback.
 *
 * .data file format (NDJSON, CRLF line endings):
 *   {"id":"1","d":"919019533772","name":"Akshith"}\r\n
 *   {"id":"2","d":"918412014471","name":"Malik"}\r\n
 */
import db from '../config/database.js';

const BASE = 'https://ser1.chathead.io/apis/v1/services';
const CLIENT = 'rayna';

// Upload contract (verified 2026-06-03 against the official Postman collection):
//   • URL must end in /index.php — without it, the request 200s with empty body
//     and the file is silently dropped (this caused our earlier `Valid data`
//     loop and the misdiagnosis that only sample.data worked).
//   • Form field is `c` (account identifier), NOT `client`.
//   • Response: { status: "success", msg: "File uploaded!", data: { name } }
//     where `name` is timestamp-prefixed (e.g. `1780487805ak_test.data`).
//     That returned name is what must be passed to /broadcast/add/?data_file=…
const UPLOAD_URL = `${BASE}/broadcast/data/add/index.php`;

export class ChatHeadV1Service {

  // ── Step 1: build NDJSON + persist to data_files ────────────────────────

  /**
   * @param {Array<{phone:string, name?:string}>} contacts
   * @param {string} [filename]  defaults to `auto-<unix>.data`
   * @returns {{id:number, filename:string, content:string}}
   */
  static async buildAndSaveDataFile(contacts, filename = null) {
    if (!Array.isArray(contacts) || !contacts.length) {
      throw new Error('buildAndSaveDataFile: contacts must be a non-empty array');
    }
    const cleaned = contacts.map((c, i) => ({
      id:   String(i + 1),
      d:    String(c.phone || '').replace(/^\+/, '').replace(/\s+/g, ''),
      name: c.name || '',
    }));
    if (cleaned.some(r => !/^\d{10,15}$/.test(r.d))) {
      throw new Error('buildAndSaveDataFile: every contact needs a valid phone (10-15 digits, no +)');
    }

    const content = cleaned.map(r => JSON.stringify(r)).join('\r\n') + '\r\n';
    const name    = filename || `auto-${Date.now()}.data`;
    if (!name.endsWith('.data')) {
      throw new Error('filename must end with .data — ChatHead rejects other extensions');
    }

    const { rows: [row] } = await db.query(
      `INSERT INTO data_files (filename, contact_count, contacts, file_bytes, upload_status)
       VALUES ($1, $2, $3::jsonb, $4, 'pending')
       RETURNING id, filename`,
      [name, cleaned.length, JSON.stringify(cleaned), Buffer.byteLength(content, 'utf8')]
    );
    return { id: row.id, filename: row.filename, content };
  }

  // ── Step 2: upload to ChatHead ─────────────────────────────────────────

  static async uploadDataFile({ id, filename, content }) {
    const form = new FormData();
    const blob = new Blob([content], { type: 'application/octet-stream' });
    form.append('Filedata', blob, filename);
    form.append('c', CLIENT);                       // ← field is `c`, not `client`

    let resBody = '';
    let parsed = null;
    let chatheadFilename = null;
    let status = 'failed';

    try {
      const res = await fetch(UPLOAD_URL, { method: 'POST', body: form });
      resBody = await res.text();
      try { parsed = JSON.parse(resBody); } catch { /* keep as text */ }

      if (parsed?.status === 'success' && parsed?.data?.name) {
        status = 'uploaded';
        chatheadFilename = parsed.data.name;
      }
    } catch (err) {
      resBody = `fetch-error: ${err.message}`;
    }

    await db.query(
      `UPDATE data_files
         SET upload_status     = $2,
             upload_response   = $3,
             chathead_filename = $4,
             uploaded_at       = NOW()
       WHERE id = $1`,
      [id, status, resBody, chatheadFilename]
    );
    return { ok: status === 'uploaded', response: resBody, parsed, chatheadFilename };
  }

  // ── Step 3: create broadcast ───────────────────────────────────────────

  /**
   * @param {object} opts
   * @param {number} opts.dataFileId          row id from data_files
   * @param {string} opts.dataFilename         the .data filename to reference
   * @param {number} opts.channelId
   * @param {string} [opts.channelName]
   * @param {number} opts.templateId
   * @param {string} [opts.templateName]
   * @param {string} opts.name                 display name in ChatHead UI
   * @param {Date|string} opts.sendTime        Date or 'YYYY-MM-DD HH:MM:SS'
   *
   * Note: ChatHead's v1 docs show `subject` as required but ChatHead support
   * confirmed (2026-06-02) that we should NOT send it — they ignore it / it
   * may cause issues. We drop it entirely from the query string.
   */
  static async createBroadcast(opts) {
    const {
      dataFileId, dataFilename, channelId, channelName,
      templateId, templateName, name, sendTime,
    } = opts;

    const sendTimeStr = sendTime instanceof Date
      ? formatChatHeadDate(sendTime)
      : String(sendTime);

    const params = new URLSearchParams({
      c:           CLIENT,
      name:        name,
      channel:     String(channelId),
      // dataFilename here MUST be the value ChatHead returned in the upload
      // response (`data.name`, e.g. `1780487805ak_test.data`) — NOT the
      // user-friendly filename. Callers must pass the right one.
      data_file:   dataFilename,
      template_id: String(templateId),
      send_time:   sendTimeStr,
    });

    const url = `${BASE}/broadcast/add/?${params.toString()}`;
    let responseBody = null;
    let status = 'queued';
    let chatheadBroadcastId = null;

    try {
      const res = await fetch(url);
      responseBody = await res.text().catch(() => '');
      try { responseBody = JSON.parse(responseBody); } catch { /* keep as text */ }

      const msg = (responseBody && responseBody.msg) || '';
      if (/Broadcast Added/i.test(msg)) {
        status = 'succeeded';
        chatheadBroadcastId = responseBody?.data?.broadcast_id ?? null;
      } else if (/Valid data/i.test(msg)) {
        status = 'submitted';   // ambiguous response — params validated but not confirmed
      } else if ((responseBody && responseBody.status) === 'success') {
        status = 'submitted';
      } else {
        status = 'failed';
      }
    } catch (err) {
      responseBody = { error: err.message };
      status = 'failed';
    }

    const { rows: [row] } = await db.query(
      `INSERT INTO chathead_broadcasts (
         data_file_id, api_version, name, channel_id, channel_name,
         template_id, template_name, send_time,
         request_payload, response_payload, chathead_broadcast_id, status
       ) VALUES ($1, 'v1', $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11)
       RETURNING id, status, chathead_broadcast_id`,
      [
        dataFileId, name, channelId, channelName || null,
        templateId, templateName || null, sendTimeStr,
        JSON.stringify({ url, params: Object.fromEntries(params) }),
        JSON.stringify(responseBody),
        chatheadBroadcastId,
        status,
      ]
    );
    return { id: row.id, status: row.status, chatheadBroadcastId: row.chathead_broadcast_id, raw: responseBody };
  }

  // ── One-shot convenience: build → upload → broadcast ───────────────────

  static async sendBroadcast({
    contacts, filename, channelId, channelName, templateId, templateName,
    name, sendTime,
  }) {
    const dataFile = await this.buildAndSaveDataFile(contacts, filename);
    const upload   = await this.uploadDataFile(dataFile);
    if (!upload.ok || !upload.chatheadFilename) {
      return { success: false, stage: 'upload', error: upload.response, dataFileId: dataFile.id };
    }
    const broadcast = await this.createBroadcast({
      dataFileId:   dataFile.id,
      dataFilename: upload.chatheadFilename,        // ← timestamp-prefixed name from ChatHead
      channelId, channelName, templateId, templateName,
      name, sendTime,
    });
    return { success: broadcast.status !== 'failed', broadcast, dataFileId: dataFile.id };
  }
}

function formatChatHeadDate(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} `
       + `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export default ChatHeadV1Service;
