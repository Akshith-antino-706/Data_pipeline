# Observability — Phase 1 (OTel + Prometheus + Tempo + Grafana)

Full tracking of **API, DB, Redis, BullMQ, and workers** — traces, metrics, dashboards.
Everything here is **additive and fail-safe**: if the stack is down or deps aren't
installed, the app runs exactly as before (telemetry no-ops with a warning).

## What you get
- **Traces** (Tempo): every HTTP request → Express → `pg` queries → `ioredis` calls, plus
  a span per BullMQ job. Click a slow request and see which SQL query ate the time.
- **Metrics** (Prometheus):
  - API: request rate + p50/p95/p99 latency per route
  - Node runtime: **event-loop lag**, GC, heap, RSS (catches worker-storm starvation)
  - BullMQ: queue depth (waiting/active/delayed/…), job throughput, job duration
  - DB: `postgres_exporter` (connections, tps, cache hit, locks, pg_stat_statements)
  - Redis: `redis_exporter` (memory, ops, keyspace)
  - Host + containers: `node_exporter`, `cAdvisor`
- **Dashboards** (Grafana): a starter "Rayna Overview" is auto-provisioned.

## 1. Install backend deps (one time)
```bash
cd backend && npm install
```
Adds `@opentelemetry/*` + `prom-client`. Requires **Node ≥ 20.6** (for `--import`).
Nothing else in the app changes.

## 2. Point the backend at Tempo + set service name
Add to `backend/.env` (or the backend container env):
```
TELEMETRY_ENABLED=true
OTEL_SERVICE_NAME=rayna-backend
OTEL_EXPORTER_OTLP_ENDPOINT=http://tempo:4318
# optional: sample a fraction of traces in high traffic
# OTEL_TRACES_SAMPLER=parentbased_traceidratio
# OTEL_TRACES_SAMPLER_ARG=0.2
```
Kill switch: `TELEMETRY_ENABLED=false` disables tracing entirely (metrics still work).

The backend `start` script already loads OTel:
`node --import ./src/telemetry/otel.mjs server.js`
(Use `npm run start:no-telemetry` to run without it.)

## 3. Bring up the stack
```bash
cp observability/.env.example observability/.env   # then edit values
# find your app network name if unsure:
docker network ls | grep default
docker compose -f observability/docker-compose.observability.yml --env-file observability/.env up -d
```

## 4. Open Grafana
- Grafana:    http://<host>:3002  (login from your .env)
- Prometheus: http://<host>:9090
- Tempo API:  http://<host>:3200

Dashboards → **Rayna → Rayna Overview**. For richer infra views, import these community
dashboards (Grafana → Import by ID): **1860** (Node/host), **9628** (PostgreSQL),
**763** (Redis), **11159** (Node.js app).

## Answering the questions this was built for
- **Why is the API slow?** → Overview dashboard: p95 latency per route.
- **Which query is the bottleneck?** → Grafana → Explore → Tempo → open a slow trace →
  read the `pg` span durations. Cross-check with `postgres_exporter` + pg_stat_statements.
- **Redis / BullMQ / workers?** → queue depth + job throughput + duration panels, and
  Redis exporter panels.

## Safety notes
- `/metrics` on the backend is unauthenticated by design (Prometheus scrape). Keep it
  reachable only on the internal network / behind the firewall — do not expose publicly.
- Put Grafana behind auth/VPN. Change the default admin password.
- Use a **read-only** DB user for `postgres_exporter`.
- This stack shares the app's docker network but runs as separate containers — it does
  not restart or modify the backend, DB, Redis, or workers.
