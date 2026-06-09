# RCS (Gupshup RBM) — Implementation & Production Handoff

Per-message RCS template send via Gupshup's **legacy GatewayAPI/rest** endpoint (the same gateway as SMS), with full DLR + inbound-event tracking and opt-out enforcement. Built to mirror Gupshup's documented `SendMessage` shape.

## What ships

| Layer | File | Purpose |
|---|---|---|
| DB | [backend/src/migrations/064_rcs_messages.sql](../backend/src/migrations/064_rcs_messages.sql) | `rcs_messages`, `rcs_events`, `rcs_optouts` tables (idempotent) |
| Service | [backend/src/services/GupshupService.js](../backend/src/services/GupshupService.js) | `sendRCS`, `recordRcsDlr`, `recordRcsInboundEvent`, `isRCSConfigured` |
| Routes | [backend/src/routes/gupshup.js](../backend/src/routes/gupshup.js) | send / config / history / webhook — mounted at `/api/v3/gupshup` |
| UI | [frontend/app/(dashboard)/rcs/page.jsx](../frontend/app/(dashboard)/rcs/page.jsx) | Send form + live history table |
| Nav | [frontend/app/(dashboard)/layout.jsx](../frontend/app/(dashboard)/layout.jsx) | "RCS Send" sidebar link |
| Smoke test | [backend/scripts/test_rcs_send.js](../backend/scripts/test_rcs_send.js) | CLI single-send + row dump |

## Key design decisions

| Decision | Why |
|---|---|
| RCS reuses **SMS** `userid`/`password` | Same Gupshup enterprise account; RBM rides the GatewayAPI/rest gateway, not the WA API. |
| Template approval **not** in our `content_templates` | RCS templates are approved in the Gupshup Converse dashboard. Caller passes the already-approved `templateCode`; no `assertApproved` call. |
| Tracking row inserted **before** the HTTP call | Status starts `queued`; DLR callbacks join on `external_id` later. No lost sends. |
| Webhook always returns **200** | Gupshup retries on non-2xx — 200 prevents retry loops while parsing edge cases. |
| `customParams` sent as a **stringified** JSON value | Required by Gupshup's `SendMessage` `templateMessage.customParams` spec. |
| Simulation mode when creds missing | Whole pipeline testable before keys land; returns `simulated: true` + a `sim_rcs_*` id. |

## Environment variables

```
# RCS auth = existing SMS auth (do NOT add new userid/password)
GUPSHUP_SMS_USER_ID=...
GUPSHUP_SMS_PASSWORD=...

# RCS bot identity
GUPSHUP_RCS_BOT_ID=...          # required for isRCSConfigured() = true
GUPSHUP_RCS_BOT_CATEGORY=...    # display only
GUPSHUP_RCS_BOT_BRAND=...       # display only

# Optional endpoint override (staging). Default:
# https://enterprise.smsgupshup.com/GatewayAPI/rest
GUPSHUP_API_URL=
```

`isRCSConfigured()` is true only when `GUPSHUP_SMS_USER_ID && GUPSHUP_SMS_PASSWORD && GUPSHUP_RCS_BOT_ID` are all set. Otherwise every send runs in simulation mode.

## API

Base: `/api/v3/gupshup`

| Method | Path | Body / Query | Returns |
|---|---|---|---|
| GET | `/rcs/config` | — | `{ configured, apiUrl, bot:{id,category,brand} }` |
| POST | `/rcs/send` | `{ templateCode, recipients[], customParams? }` | `{ sent, failed, total, results[] }` |
| GET | `/rcs/messages` | `?limit=50` (max 200) | recent `rcs_messages` rows |
| GET | `/rcs/events` | `?limit=50` (max 200) | recent `rcs_events` rows |
| POST | `/webhook/rcs` | Gupshup callback | `200` always |

`recipients` accepts either `["919876543210", ...]` or `[{ phone, customParams }]`. A global `customParams` applies to all; per-recipient overrides it. Phones are normalized (leading `+` stripped); country code required.

### Send example

```bash
curl -X POST http://localhost:3001/api/v3/gupshup/rcs/send \
  -H 'Content-Type: application/json' \
  -d '{
    "templateCode": "test_raynapromo",
    "recipients": ["919876543210"],
    "customParams": { "DISCOUNT": "20%" }
  }'
```

### Outbound payload (what we POST to Gupshup)

`application/x-www-form-urlencoded`:

```
method=SendMessage
send_to=919876543210
msg={"contentMessage":{"templateMessage":{"templateCode":"test_raynapromo","customParams":"{\"DISCOUNT\":\"20%\"}"}}}
msg_type=TEXT
userid=<SMS_USER_ID>
auth_scheme=plain
password=<SMS_PASSWORD>
v=1.1
format=json
```

Success = `response.status === 'success'`; `external_id` = `response.id`.

## Webhook → tracking

Point the Gupshup console's RCS **Chatbot Webhook** at:

```
<publicUrl>/api/v3/gupshup/webhook/rcs
```

| Callback `type` | Handler | Effect |
|---|---|---|
| `message-event` (DLR: sent/delivered/read/failed) | `recordRcsDlr` | Updates matching `rcs_messages` row by `external_id` (`gsId`); sets `delivered_at`/`read_at`/`failed_at`. |
| `message` (inbound: text/button_reply/url_action/…) | `recordRcsInboundEvent` | Inserts an `rcs_events` row. |

## Opt-out enforcement

| Trigger | Stored in `rcs_optouts.source` |
|---|---|
| DLR `failed` with `error_code = 423` | `error_423` |
| Inbound text reply `"stop"` (any case) | `stop_keyword` |
| Manual insert | `manual` |

`sendRCS` checks `rcs_optouts` first and blocks (`success:false, blocked:true, reason:'opted_out'`) before queueing.

## Status lifecycle

`queued` → `submitted` → `sent` → `delivered` → `read`, or `→ failed`. UI derives display status from timestamp columns (`read_at` > `delivered_at` > `failed_at` > `status`).

## Deploy checklist (production)

1. Run migration `064_rcs_messages.sql` against prod DB.
2. Set env vars (above); confirm `GET /rcs/config` → `configured: true`.
3. Set Gupshup console Chatbot Webhook → `<publicUrl>/api/v3/gupshup/webhook/rcs`.
4. Approve at least one RCS template in the Gupshup Converse dashboard; note its `templateCode`.
5. Smoke test: `node backend/scripts/test_rcs_send.js <phone> <templateCode>`; verify the row in `rcs_messages` and DLR transitions.
6. Confirm sidebar "RCS Send" page loads and shows `Credentials set`.

## Known gotcha

If `/rcs/send` returns `"method ... not supported"`, the account lacks the legacy `SendMessage` method. Open a Gupshup support ticket to enable **GatewayAPI/rest `SendMessage`** for the account. The UI surfaces this hint automatically.

---

## Implementation prompt (for the production dev / a fresh agent)

> Implement RCS (Rich Communication Services) sending via Gupshup's RBM, using their **legacy GatewayAPI/rest `SendMessage`** endpoint — the same gateway our SMS uses. Mirror this existing reference implementation exactly; do not invent a new auth scheme.
>
> **Auth:** RCS reuses the existing SMS credentials (`GUPSHUP_SMS_USER_ID`, `GUPSHUP_SMS_PASSWORD`). Add `GUPSHUP_RCS_BOT_ID`, `GUPSHUP_RCS_BOT_CATEGORY`, `GUPSHUP_RCS_BOT_BRAND`. Endpoint defaults to `https://enterprise.smsgupshup.com/GatewayAPI/rest`, overridable via `GUPSHUP_API_URL`. Treat RCS as "configured" only when SMS user/password **and** bot id are all set; otherwise run in simulation mode that returns a `sim_rcs_*` id without hitting the network.
>
> **DB:** Create three tables (idempotent migration, no foreign keys):
> - `rcs_messages` — every outbound send + its DLR lifecycle (`external_id`, `bot_id`, `destination`, `template_code`, `custom_params` JSONB, `status` default `queued`, `error_code`, `error_reason`, loose `entry_id`/`node_id`/`customer_id`, `request_payload`/`response_payload` JSONB, and `sent_at`/`delivered_at`/`read_at`/`failed_at` timestamps). Index `external_id`, `destination`, `status`, `entry_id`, `sent_at`.
> - `rcs_events` — every inbound callback event (`external_message_id`, `source_phone`, `event_type`, `payload`/`raw` JSONB, `received_at`). DLR status events are NOT stored here.
> - `rcs_optouts` — `phone` PK, `source` (`error_423`|`stop_keyword`|`manual`), `raw_payload`.
>
> **Send (`sendRCS`):** Inputs `{ to, templateCode, customParams?, meta? }`. Strip a leading `+` from the phone. Check `rcs_optouts` first and block if present. Insert an `rcs_messages` row (`queued`) **before** the HTTP call so callbacks can join later. Build `msg = { contentMessage: { templateMessage: { templateCode, customParams: JSON.stringify(customParams) } } }` — `customParams` MUST be a stringified JSON value. POST as `x-www-form-urlencoded` with `method=SendMessage, send_to, msg, msg_type=TEXT, userid, auth_scheme=plain, password, v=1.1, format=json`. Success = `response.status==='success'`; capture `external_id = response.id`. Update the row to `submitted`/`failed` accordingly.
>
> **Webhook (`POST /webhook/rcs`):** Always respond 200. `type==='message-event'` → DLR: update the matching `rcs_messages` row by `external_id` (`payload.gsId`), set the right timestamp for sent/delivered/read/failed, and on `error_code 423` insert an `error_423` opt-out. `type==='message'` → inbound: insert an `rcs_events` row; if it's a text reply of just "stop", insert a `stop_keyword` opt-out.
>
> **Routes** (mount under existing `/api/v3/gupshup`): `GET /rcs/config`, `POST /rcs/send` (accepts `recipients` as string[] or `{phone,customParams}[]`, loops one API call per recipient, returns `{sent,failed,total,results[]}`), `GET /rcs/messages`, `GET /rcs/events`.
>
> **UI:** A dashboard page with a compose form (template code + newline/comma-separated recipients + optional JSON custom params) and a live history table that derives status from the timestamp columns and shows delivered/read/failure. Surface a support-ticket hint if any result error matches `/method.*not.*supported/i`.
>
> **Verify:** migration runs; `/rcs/config` reports configured; `node backend/scripts/test_rcs_send.js <phone> <templateCode>` sends and the `rcs_messages` row transitions through DLRs once the Gupshup console webhook points at `/api/v3/gupshup/webhook/rcs`.
