/**
 * `acture-telemetry` — observe every dispatch and forward a structured
 * record to a configurable sink. Errors-as-data preserved end-to-end.
 *
 * Surface:
 *
 *     import { instrumentTelemetry, consoleSink } from 'acture-telemetry';
 *
 *     const stop = instrumentTelemetry(registry, {
 *       sink: consoleSink,
 *       sampler: (record) => !record.commandId.startsWith('app.dev.'),
 *       redact: (r) => ({ ...r, params: stripSecrets(r.params) }),
 *     });
 *     // later, on teardown:
 *     stop();
 *
 * Multiple sinks: compose them on the user side (`sink: (r) => { a(r); b(r); }`)
 * rather than installing the instrument twice.
 *
 * The hand-written equivalent — what an agent would write into the
 * target project instead of installing this package — is
 * `docs/hand-written-telemetry.md`.
 */

export { instrumentTelemetry, consoleSink } from './telemetry.js';
export type {
  InstrumentTelemetryOptions,
  TelemetryRecord,
  TelemetrySink,
} from './telemetry.js';
