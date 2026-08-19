// ─────────────────────────────────────────────────────────────────────────────
// OpenTelemetry bootstrap — loaded via `node --import ./src/telemetry/otel.mjs`.
//
// PRINCIPLE: telemetry must NEVER break or slow the app. Every step is guarded;
// on ANY failure (deps missing, collector unreachable, version mismatch) we log a
// warning and let the process run EXACTLY as before. Auto-instrumentation only wraps
// http / express / pg / ioredis — it does not change their behavior.
//
// Kill switch:  TELEMETRY_ENABLED=false   (or  OTEL_SDK_DISABLED=true)
// Endpoint:     OTEL_EXPORTER_OTLP_ENDPOINT  (default http://localhost:4318)
// Service name: OTEL_SERVICE_NAME            (default rayna-backend)
// Sampling:     OTEL_TRACES_SAMPLER / OTEL_TRACES_SAMPLER_ARG  (OTel standard env)
// ─────────────────────────────────────────────────────────────────────────────

const ENABLED =
  process.env.TELEMETRY_ENABLED !== 'false' &&
  process.env.OTEL_SDK_DISABLED !== 'true';

if (!ENABLED) {
  console.log('[otel] disabled via env — running without tracing');
} else {
  try {
    const { NodeSDK } = await import('@opentelemetry/sdk-node');
    const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');
    const { getNodeAutoInstrumentations } = await import('@opentelemetry/auto-instrumentations-node');

    const endpoint = (process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318').replace(/\/$/, '');
    if (!process.env.OTEL_SERVICE_NAME) process.env.OTEL_SERVICE_NAME = 'rayna-backend';

    const sdk = new NodeSDK({
      traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
      instrumentations: [
        getNodeAutoInstrumentations({
          // The signals we care about — API, DB, Redis:
          '@opentelemetry/instrumentation-http':    { enabled: true },
          '@opentelemetry/instrumentation-express': { enabled: true },
          '@opentelemetry/instrumentation-pg':      { enabled: true },
          '@opentelemetry/instrumentation-ioredis': { enabled: true },
          // Noise / overhead we don't want:
          '@opentelemetry/instrumentation-fs':      { enabled: false },
          '@opentelemetry/instrumentation-dns':     { enabled: false },
          '@opentelemetry/instrumentation-net':     { enabled: false },
        }),
      ],
    });

    sdk.start();
    console.log(`[otel] tracing started → ${endpoint} (service=${process.env.OTEL_SERVICE_NAME})`);

    const shutdown = () => { try { sdk.shutdown().catch(() => {}); } catch { /* ignore */ } };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
  } catch (err) {
    // Deps not installed / exporter unreachable / anything → keep the app running.
    console.warn(`[otel] init skipped (app continues normally): ${err?.message || err}`);
  }
}
