/**
 * `acture-telemetry` — observe every `dispatch` and forward a structured
 * record to a configurable sink. Errors-as-data is preserved end-to-end:
 * `result` is the full `Result<unknown>` from the dispatcher, so failed
 * dispatches appear in telemetry with their error code rather than as
 * exceptions.
 *
 * The instrument is opt-in. Production hosts that want telemetry call
 * `instrumentTelemetry(registry, { sink, ... })` once at boot. Hosts
 * that don't want telemetry simply don't call it — the package adds
 * zero runtime cost if unused.
 *
 * This is dispatch *observation*, not dispatch primitive — it monkey-
 * patches `registry.dispatch` the same way `acture-devtools`'s
 * `instrumentRegistry` and `enableTierWarnings` do (per
 * `acture-hard-donts` §6: dispatch interception belongs in opt-in
 * adapter packages, not in core).
 *
 * Composition: multiple instrumenters (e.g. `acture-devtools` +
 * `acture-telemetry` + `acture-undo`) wrap each other at install time
 * in install order. Dispose in reverse install order to avoid leaving
 * dangling wrappers on the registry.
 */

import type { Context, DispatchOptions, Registry, Result } from 'acture';

/** A single observed dispatch. The shape is closed and minimal — every
 *  consumer reads the same fields. */
export interface TelemetryRecord {
  /** Monotonic in-process id, useful for correlating records across
   *  sinks or for ordering. */
  readonly seq: number;
  /** `Date.now()` at sink time. */
  readonly ts: number;
  /** Command id passed to `dispatch`. May be unknown to the registry
   *  (the result will carry `unknown_command`); the record still emits
   *  so the host can see attempted calls. */
  readonly commandId: string;
  /** The params passed by the caller. May be mutated by `redact`. */
  readonly params: unknown;
  /** The context passed to dispatch (defaults to `{}` if the caller
   *  omitted it). */
  readonly ctx: Context;
  /** The full `Result<unknown>` from the dispatcher. Errors-as-data:
   *  failed dispatches arrive here with `ok: false` and an error code,
   *  not as exceptions. */
  readonly result: Result<unknown>;
  /** Dispatch duration in milliseconds (from before `dispatch` to after
   *  it resolves). */
  readonly durationMs: number;
}

/** A telemetry sink — anything that consumes a record. The package
 *  ships one built-in (`consoleSink`); a host can pass any function:
 *  a structured logger, a network beacon, an OpenTelemetry exporter,
 *  a custom file writer, a composition of several sinks. */
export type TelemetrySink = (record: TelemetryRecord) => void;

export interface InstrumentTelemetryOptions {
  /** Where to send each record. Required. */
  readonly sink: TelemetrySink;
  /** Optional transform applied before the sink sees the record.
   *  Common use: strip secrets from `params` or `ctx` before they
   *  reach a sink. Return a new record (immutable) or the same record
   *  unchanged. Errors thrown here are caught — telemetry never breaks
   *  dispatch. */
  readonly redact?: (record: TelemetryRecord) => TelemetryRecord;
  /** Optional predicate — return `false` to drop the record before the
   *  sink (and before `redact`) sees it. Use for ratio sampling
   *  (`Math.random() < 0.1`), tier-aware sampling, or cost-based
   *  filtering. Errors thrown here are caught — the dispatch is logged
   *  on failure (defensive default). */
  readonly sampler?: (record: TelemetryRecord) => boolean;
}

interface Attached {
  readonly dispose: () => void;
}

const ATTACHED = new WeakMap<Registry, Attached>();

/**
 * Wrap `registry.dispatch` to emit a `TelemetryRecord` to `sink` for
 * every call. Idempotent per registry: calling twice returns the same
 * disposer (subsequent options are ignored; compose multiple sinks at
 * the sink level — `sink: (r) => { a(r); b(r); }` — rather than
 * installing twice).
 *
 * Returns a disposer that restores the dispatch that was in place at
 * install time. **Dispose in reverse install order** if other
 * instrumenters wrap this registry; otherwise you may leave dangling
 * wrappers.
 */
export function instrumentTelemetry(
  registry: Registry,
  options: InstrumentTelemetryOptions,
): () => void {
  const existing = ATTACHED.get(registry);
  if (existing) return existing.dispose;

  const { sink, redact, sampler } = options;
  let seq = 1;
  const originalDispatch = registry.dispatch.bind(registry);

  (registry as { dispatch: Registry['dispatch'] }).dispatch =
    async function telemetryDispatch<R>(
      id: string,
      params?: unknown,
      ctx?: Context,
      opts?: DispatchOptions,
    ): Promise<Result<R>> {
      const t0 = now();
      const result = (await originalDispatch<R>(id, params, ctx, opts)) as Result<R>;
      const record: TelemetryRecord = {
        seq: seq++,
        ts: Date.now(),
        commandId: id,
        params,
        ctx: ctx ?? {},
        result: result as Result<unknown>,
        durationMs: now() - t0,
      };
      emit(record, sink, redact, sampler);
      return result;
    };

  const attached: Attached = {
    dispose: () => {
      (registry as { dispatch: Registry['dispatch'] }).dispatch =
        originalDispatch;
      ATTACHED.delete(registry);
    },
  };
  ATTACHED.set(registry, attached);
  return attached.dispose;
}

/** A default sink that prints a one-line summary to `console.log`.
 *  Shipped as a reference / for quick wiring; production hosts will
 *  usually pass a structured-logger / OTel / network-beacon sink. */
export const consoleSink: TelemetrySink = (record) => {
  const c = (globalThis as { console?: { log?: (m: string) => void } }).console;
  if (!c?.log) return;
  const status = record.result.ok
    ? 'ok'
    : `ERR ${record.result.error.code}`;
  c.log(
    `[acture] ${record.commandId} ${status} ${record.durationMs.toFixed(1)}ms`,
  );
};

function emit(
  record: TelemetryRecord,
  sink: TelemetrySink,
  redact: InstrumentTelemetryOptions['redact'],
  sampler: InstrumentTelemetryOptions['sampler'],
): void {
  // Sampler runs first — no point redacting a record that will be
  // dropped. A throwing sampler defaults to "keep" — better to over-log
  // than to swallow records silently.
  if (sampler) {
    try {
      if (sampler(record) === false) return;
    } catch {
      // fall through — keep the record
    }
  }
  // Redact second — single place to strip secrets before any sink sees
  // them. A throwing redact returns the original record (loud-ish
  // failure for debugging; for production the host wraps its own
  // redact to swallow if it must).
  let toSend = record;
  if (redact) {
    try {
      toSend = redact(record);
    } catch {
      toSend = record;
    }
  }
  // Sink last. A throwing sink is swallowed — telemetry must NEVER
  // break dispatch. (`Result<R>` has already returned by this point;
  // we are in the post-dispatch tail.)
  try {
    sink(toSend);
  } catch {
    // intentionally swallow — see comment above
  }
}

function now(): number {
  const perf = (globalThis as { performance?: { now?: () => number } }).performance;
  if (perf?.now) return perf.now();
  return Date.now();
}
