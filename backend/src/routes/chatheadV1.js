/**
 * ChatHead v1 API — channels/templates lookup, broadcast send, and ledger reads.
 * Mounted at /api/v3/chathead.
 */
import express from 'express';
import db from '../config/database.js';
import ChatHeadV1Service from '../services/ChatHeadV1Service.js';

const router = express.Router();

const CH_BASE = 'https://ser1.chathead.io/apis/v1/services';
const CLIENT  = 'rayna';

// GET /api/v3/chathead/channels — passthrough of ChatHead's channel list
router.get('/channels', async (_req, res) => {
  try {
    const r = await fetch(`${CH_BASE}/account/channels/list/?c=${CLIENT}`);
    const j = await r.json();
    res.json({ success: true, data: j.data || [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/v3/chathead/templates?channel=40 — templates for a channel
router.get('/templates', async (req, res) => {
  const channel = req.query.channel;
  if (!channel) return res.status(400).json({ success: false, error: 'channel is required' });
  try {
    const r = await fetch(`${CH_BASE}/account/templates/list/?c=${CLIENT}&channel=${encodeURIComponent(channel)}`);
    const j = await r.json();
    res.json({ success: true, data: j.data || [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/v3/chathead/templates/:id/preview — raw HTML body
router.get('/templates/:id/preview', async (req, res) => {
  try {
    const r = await fetch(`${CH_BASE}/account/templates/content/?c=${CLIENT}&template_id=${encodeURIComponent(req.params.id)}`);
    const body = await r.text();
    res.json({ success: true, data: { content: body, bytes: body.length } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v3/chathead/broadcasts — fire a broadcast via ChatHeadV1Service
//
// Body: { contacts[]?, dataFileId?, channelId, templateId, name, sendTime?, filename? }
// Either contacts[] (build new file + upload + send) OR dataFileId (reuse existing).
router.post('/broadcasts', async (req, res) => {
  const {
    contacts, dataFileId, filename, channelId, channelName,
    templateId, templateName, name, sendTime,
  } = req.body || {};

  if (!channelId)  return res.status(400).json({ success: false, error: 'channelId required' });
  if (!templateId) return res.status(400).json({ success: false, error: 'templateId required' });
  if (!name)       return res.status(400).json({ success: false, error: 'name required' });

  const useExisting = !!dataFileId;
  if (!useExisting && (!Array.isArray(contacts) || !contacts.length)) {
    return res.status(400).json({ success: false, error: 'contacts[] or dataFileId required' });
  }

  const when = sendTime ? new Date(sendTime) : new Date(Date.now() + 2 * 60 * 1000);

  try {
    let result;
    if (useExisting) {
      // Look up the existing data file, skip build/upload
      const { rows: [row] } = await db.query(
        'SELECT id, filename, chathead_filename FROM data_files WHERE id = $1', [dataFileId]
      );
      if (!row) return res.status(404).json({ success: false, error: `data_file ${dataFileId} not found` });
      if (!row.chathead_filename) {
        return res.status(400).json({
          success: false,
          error: `data_file ${dataFileId} has no chathead_filename — upload was never confirmed by ChatHead. Re-upload first.`,
        });
      }
      const broadcast = await ChatHeadV1Service.createBroadcast({
        dataFileId:   row.id,
        dataFilename: row.chathead_filename,         // ← what ChatHead returned at upload time
        channelId:    Number(channelId), channelName,
        templateId:   Number(templateId), templateName,
        name,
        sendTime: when,
      });
      result = { success: broadcast.status !== 'failed', broadcast, dataFileId: row.id, reused: true };
    } else {
      result = await ChatHeadV1Service.sendBroadcast({
        contacts,
        filename: filename || `wa-${Date.now()}.data`,
        channelId:    Number(channelId), channelName,
        templateId:   Number(templateId), templateName,
        name,
        sendTime: when,
      });
    }
    res.json({ success: result.success, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v3/chathead/data-files/register
// FE uploads to ChatHead directly (browser → /broadcast/data/add/index.php) and
// then calls this endpoint to record the result in our data_files ledger. The FE
// passes both the user's logical `filename` and the `chatheadFilename` returned
// by ChatHead (data.name from upload response — usually timestamp-prefixed like
// `1780488210ak_test.data`).
router.post('/data-files/register', async (req, res) => {
  const { filename, chatheadFilename, contacts, fileBytes, uploadResponse, notes } = req.body || {};
  if (!filename || !filename.endsWith('.data')) {
    return res.status(400).json({ success: false, error: 'filename ending in .data is required' });
  }
  if (!chatheadFilename) {
    return res.status(400).json({ success: false, error: 'chatheadFilename (data.name from ChatHead upload) is required' });
  }
  if (!Array.isArray(contacts) || !contacts.length) {
    return res.status(400).json({ success: false, error: 'contacts[] is required' });
  }
  try {
    const { rows: [row] } = await db.query(
      `INSERT INTO data_files (filename, chathead_filename, contact_count, contacts, file_bytes,
                               upload_status, upload_response, uploaded_at, notes)
       VALUES ($1, $2, $3, $4::jsonb, $5, 'uploaded', $6, NOW(), $7)
       ON CONFLICT (filename) DO UPDATE SET
         chathead_filename = EXCLUDED.chathead_filename,
         contact_count     = EXCLUDED.contact_count,
         contacts          = EXCLUDED.contacts,
         file_bytes        = EXCLUDED.file_bytes,
         upload_status     = EXCLUDED.upload_status,
         upload_response   = EXCLUDED.upload_response,
         uploaded_at       = EXCLUDED.uploaded_at,
         notes             = EXCLUDED.notes
       RETURNING id, filename, chathead_filename, contact_count, upload_status, uploaded_at`,
      [filename, chatheadFilename, contacts.length, JSON.stringify(contacts), fileBytes ?? null,
       JSON.stringify(uploadResponse ?? null), notes ?? null]
    );
    res.json({ success: true, data: row });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v3/chathead/data-files — build + upload a .data file via NODE (legacy / fallback)
//   ⚠️ Known to silently drop files with non-`sample.data` filenames.
//   Prefer the browser-XHR upload + /data-files/register flow.
router.post('/data-files', async (req, res) => {
  const { contacts, filename } = req.body || {};
  if (!Array.isArray(contacts) || !contacts.length) {
    return res.status(400).json({ success: false, error: 'contacts[] is required' });
  }
  try {
    const dataFile = await ChatHeadV1Service.buildAndSaveDataFile(
      contacts,
      filename || `wa-${Date.now()}.data`,
    );
    const upload = await ChatHeadV1Service.uploadDataFile(dataFile);
    res.json({
      success: upload.ok,
      data: {
        id:           dataFile.id,
        filename:     dataFile.filename,
        contactCount: contacts.length,
        upload,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/v3/chathead/broadcasts — list our historic broadcasts (joined with data_files)
router.get('/broadcasts', async (req, res) => {
  const limit = Math.min(200, Number(req.query.limit) || 50);
  try {
    const { rows } = await db.query(
      `SELECT b.id, b.name, b.channel_id, b.channel_name, b.template_id, b.template_name,
              b.subject, b.send_time, b.status, b.chathead_broadcast_id,
              b.response_payload->>'msg' AS chathead_msg,
              b.fired_at, b.notes,
              d.id                AS data_file_id,
              d.filename          AS data_filename,
              d.chathead_filename AS chathead_filename,
              d.contact_count
         FROM chathead_broadcasts b
         LEFT JOIN data_files d ON d.id = b.data_file_id
        ORDER BY b.id DESC
        LIMIT $1`, [limit]);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/v3/chathead/data-files — list our uploaded .data files
router.get('/data-files', async (req, res) => {
  const limit = Math.min(200, Number(req.query.limit) || 50);
  try {
    const { rows } = await db.query(
      `SELECT id, filename, contact_count, file_bytes, upload_status, uploaded_at, created_at
         FROM data_files ORDER BY id DESC LIMIT $1`, [limit]);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
