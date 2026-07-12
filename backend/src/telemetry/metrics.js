// ─────────────────────────────────────────────────────────────────────────────
// Prometheus metrics + BullMQ/worker instrumentation helpers.
//
// PRINCIPLE: fully fail-safe. If `prom-client` or `@opentelemetry/api` are not
// installed, EVERY export becomes a safe no-op so the app's flow (API, DB, Redis,
// BullMQ, workers) is never affected. Nothing here ever throws into app code.
// ─────────────────────────────────────────────────────────────────────────────

let client = null;
try {
  client = (await import('prom-client')).default;
} catch {
  console.warn('[metrics] prom-client not installed — metrics disabled (no-op)');
}

let otelTrace = null;
try {
  otelTrace = (await import('@opentelemetry/api')).trace;
} catch {
  /* job-span helper degrades to a pass-through */
}

export const register = client ? client.register : null;

// Node runtime metrics: event-loop lag, GC pauses, heap, active handles — the
// signals that reveal a worker storm starving the web server.
if (client) client.collectDefaultMetrics({ prefix: 'rayna_' });

const httpDuration = client && new client.Histogram({
  name: 'rayna_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5, 10],
});

const bullJobsTotal = client && new client.Counter({
  name: 'rayna_bullmq_jobs_total',
  help: 'BullMQ jobs processed, by queue and terminal status',
  labelNames: ['queue', 'status'],
});

const bullJobDuration = client && new client.Histogram({
  name: 'rayna_bullmq_job_duration_seconds',
  help: 'BullMQ job processing duration in seconds',
  labelNames: ['queue'],
  buckets: [0.05, 0.1, 0.5, 1, 2, 5, 10, 30, 60],
});

const bullQueueDepth = client && new client.Gauge({
  name: 'rayna_bullmq_queue_depth',
  help: 'BullMQ queue depth by state (waiting/active/delayed/completed/failed/paused)',
  labelNames: ['queue', 'state'],
});

// Collapse dynamic path segments so metric label cardinality stays bounded.
function normalizeRoute(req) {
  const raw = (req.baseUrl || '') + (req.route?.path || req.path || '');
  const norm = raw
    .replace(/\/\d+/g, '/:id')
    .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '/:uuid');
  return norm || '/';
}

/** Express middleware: record request duration. Never throws into the request path. */
export function httpMetricsMiddleware(req, res, next) {
  if (!httpDuration) return next();
  let end;
  try { end = httpDuration.startTimer(); } catch { return next(); }
  res.on('finish', () => {
    try { end({ method: req.method, route: normalizeRoute(req), status: res.statusCode }); }
    catch { /* telemetry must never throw */ }
  });
  next();
}

/** GET /metrics handler for Prometheus to scrape. */
export async function metricsHandler(_req, res) {
  if (!register) return res.status(503).send('# metrics disabled (prom-client not installed)\n');
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (e) {
    res.status(500).send(`# metrics error: ${e.message}\n`);
  }
}

/**
 * Attach metric listeners to a BullMQ Worker. Non-invasive: adds `completed`/`failed`
 * listeners only — it does not change job processing, retries, or error handling.
 */
export function instrumentWorkerMetrics(worker, queue) {
  if (!client || !worker?.on) return worker;
  const observe = (job) => {
    try {
      if (job?.processedOn && job?.finishedOn) {
        bullJobDuration.observe({ queue }, (job.finishedOn - job.processedOn) / 1000);
      }
    } catch { /* ignore */ }
  };
  worker.on('completed', (job) => { try { bullJobsTotal.inc({ queue, status: 'completed' }); } catch {} observe(job); });
  worker.on('failed',    (job) => { try { bullJobsTotal.inc({ queue, status: 'failed'    }); } catch {} observe(job); });
  return worker;
}

/** Set queue-depth gauges from a BullMQ getJobCounts() result. */
export function setQueueDepth(queue, counts) {
  if (!bullQueueDepth || !counts) return;
  try {
    for (const [state, n] of Object.entries(counts)) {
      if (typeof n === 'number') bullQueueDepth.set({ queue, state }, n);
    }
  } catch { /* ignore */ }
}

/**
 * Wrap a BullMQ processor so each job runs inside a trace span (worker traces +
 * producer→worker linking). TRANSPARENT: same argument, same return value, same
 * thrown error — it only opens/closes a span around the original processor.
 */
export function traceJob(queue, processor) {
  if (!otelTrace) return processor;
  const tracer = otelTrace.getTracer('bullmq');
  return async function tracedProcessor(job) {
    return tracer.startActiveSpan(`bullmq.process ${queue}`, async (span) => {
      try {
        span.setAttribute('messaging.system', 'bullmq');
        span.setAttribute('messaging.destination.name', queue);
        span.setAttribute('messaging.message.id', String(job?.id ?? ''));
        span.setAttribute('bullmq.attempts_made', job?.attemptsMade ?? 0);
        const result = await processor(job);
        span.setStatus({ code: 1 }); // OK
        return result;
      } catch (err) {
        try { span.recordException(err); span.setStatus({ code: 2, message: err?.message }); } catch {}
        throw err; // preserve original behavior exactly
      } finally {
        try { span.end(); } catch {}
      }
    });
  };
}
