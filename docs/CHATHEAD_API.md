# ChatHead API Reference (v1)

Formal v1 API from ChatHead. Base: `https://ser1.chathead.io`. Auth via `c={account}` query param (no Bearer, no cookie). Source: [chathead-api-docs.html](../chathead-api-docs.html) — verified live 2026-06-01.

For Rayna, **`c=rayna`** throughout.

---

## Endpoints

| # | Method | Path | Purpose |
|---|---|---|---|
| 01 | GET  | `/apis/v1/services/account/channels/list/` | List channels |
| 02 | GET  | `/apis/v1/services/account/templates/list/` | List templates per channel |
| 03 | GET  | `/apis/v1/services/account/templates/content/` | Get rendered template HTML body |
| 04 | POST | `/apis/v1/services/broadcast/data/add/` | Upload recipient `.data` file |
| 05 | GET  | `/apis/v1/services/broadcast/add/` | Create + schedule broadcast |

---

## 01 — List channels

```http
GET /apis/v1/services/account/channels/list/?c=rayna
```

**Response (verified):**
```json
{
  "status": "success",
  "msg": "Channel List!",
  "data": [
    { "id": "113", "name": "B2C Outbound Marketing", "connection": "971504708595" },
    { "id": "40",  "name": "B2C Marketing ",         "connection": "971561793788" }
  ]
}
```

Returns all channels (not filtered by type). Account has ~30+ channels including B2C/B2B Marketing + Sales + Support. Use the `name` field to disambiguate.

---

## 02 — List templates per channel

```http
GET /apis/v1/services/account/templates/list/?c=rayna&channel=40
```

**Response (verified, channel 40 = B2C Marketing, 272 templates):**
```json
{
  "status": "success",
  "msg": "Template List!",
  "data": [
    {
      "id": "176",
      "type": "whatsapp",
      "name": "Dubai Visa",
      "template_code": "8811506e-af50-4caf-899e-fb5df54c1653"
    }
  ]
}
```

`template_code` is the Meta external UUID. The shorter `id` is what `/broadcast/add/` expects as `template_id`.

---

## 03 — Get template content

```http
GET /apis/v1/services/account/templates/content/?c=rayna&template_id=1089
```

**Returns plain HTML/text body**, not a JSON envelope (`Content-Type: text/html`).

Example response for `template_id=1089` (chathead introduction):
```
🚀 Still handling business WhatsApp on one phone?
Introducing *ChatHead* – *_Multi Agent WhatsApp Inbox_* …
```

⚠️ Some template IDs return empty body — likely media-only templates (e.g. `template_id=176` Dubai Visa returns 0 bytes). Text-only templates return the message body verbatim. May contain `{{var}}` placeholders to substitute server-side.

---

## 04 — Upload recipient data file

```http
POST /apis/v1/services/broadcast/data/add/
Content-Type: multipart/form-data
```

**Form fields:**
| Field | Type | Notes |
|---|---|---|
| `Filedata` | file | Must have `.data` extension, `Content-Type: application/octet-stream` |
| `client` | string | Account identifier (`rayna`) |

**Example:**
```bash
curl -X POST 'https://ser1.chathead.io/apis/v1/services/broadcast/data/add/' \
  -F 'Filedata=@recipients.data;type=application/octet-stream' \
  -F 'client=rayna'
```

⚠️ **Only `.data` extension accepted.** Other extensions are rejected by the server.

Response payload not yet documented by ChatHead — capture and document when first used.

---

## 05 — Create + schedule broadcast

```http
GET /apis/v1/services/broadcast/add/
```

**Query parameters (all required):**
| Param | Type | Notes |
|---|---|---|
| `c` | string | `rayna` |
| `name` | string | Display name (URL-encoded) |
| `channel` | int | Channel ID from endpoint 01 |
| `subject` | string | Subject line (URL-encoded) |
| `data_file` | string | Filename returned by endpoint 04 |
| `template_id` | int | ID from endpoint 02 |
| `send_time` | string | `YYYY-MM-DD HH:MM:SS`, URL-encoded |

**Response:**
```json
{ "status": "success", "msg": "Broadcast Added!", "data": { "broadcast_id": 212 } }
```

---

## Typical flow

1. `GET /account/channels/list/` → pick channel ID
2. `GET /account/templates/list/?channel=…` → pick template ID
3. `POST /broadcast/data/add/` with `Filedata=@recipients.data` → note filename
4. `GET /broadcast/add/?…&data_file=<filename>&template_id=…` → broadcast queued

---

## Known channels (Rayna account)

| ID | Name | WABA number |
|---|---|---|
| 32 | Seacation Marketing | 971506153614 |
| 33 | Corporate Sales | 97142087511 |
| 37 | B2B India Marketing | 912066838852 |
| 39 | Corporate Marketing | 97142087188 |
| 40 | B2C Marketing | 971561793788 |
| 113 | B2C Outbound Marketing | 971504708595 |
| 119 | Int. Visa - UAE Sales | 971561794005 |

Full list via endpoint 01. IDs are stable across v1 and the older UI XHR routes.

---

## Gaps vs requirements

ChatHead v1 ships read endpoints + send shape but does **not** address:

- Bearer-token auth (still `c=` query param)
- Single-recipient direct send (still file-upload broadcast)
- Per-recipient delivery report
- Webhooks for delivery / opt-out / failure events
- Contact list CRUD (replaced with opaque `.data` file uploads)
- Opt-in status check
- Carousel template support
- Idempotency keys / structured error codes / rate limits

See [CHATHEAD_API_REQUIREMENTS.md](CHATHEAD_API_REQUIREMENTS.md) for the full ask.

---

## Deprecated — UI XHR routes (previous interim API)

We previously scripted against these UI endpoints (cookie-authed). They still work but should be migrated to v1:

| Old | New v1 equivalent |
|---|---|
| `POST /apis/v1/broadcasts/lists/channels/` (cookie) | `GET /services/account/channels/list/?c=rayna` |
| `POST /apis/v1/contacts/lists/lists` (cookie) | — (no equivalent; lists replaced by `.data` upload) |
| `POST /apis/v1/account/templates/get` (cookie) | `GET /services/account/templates/list/?c=rayna&channel=…` |
| `POST /apis/v1/account/template_content_pre/show` (cookie) | `GET /services/account/templates/content/?c=rayna&template_id=…` |
| `POST /apis/v1/files/upload/do` (cookie) | `POST /services/broadcast/data/add/` (different shape — `.data` only) |
| `POST /apis/v1/broadcasts/add/broadcast` (cookie, `lists[]=…`) | `GET /services/broadcast/add/?data_file=…&…` |

Sister APIs unrelated to v1:
- `GET https://chathead.io/apis/wa/first_msg/` — read-only first-message lookup, no auth (see [FirstMessageService.js](../backend/src/services/FirstMessageService.js))
- `POST http://chathead.io/apis/email/send/index.php` — email send with Bearer auth (see [reference_chathead_email_api.md](../../.claude/projects/-Users-akshithkumaryv-Downloads-Rayna-data-pipeline/memory/reference_chathead_email_api.md))
