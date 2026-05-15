# The hand-written telemetry instrument — a reproducible reference

**Status:** reference artifact. This document makes acture's dev-tool-first
promise *true in the code* for the telemetry consumer surface: a developer can
observe every dispatch with **zero `acture-*` dependency** by hand-writing the
instrument primitive, following this reference.

Read [`docs/positioning.md`](positioning.md) first — it is canonical. The
short version: `acture-telemetry` (the npm package) is an *optional
accelerator*. The dispatch-wrap, the record shape, the sampler/redact/sink
composition — all of it can be code the target project *owns outright*. This
doc is the legible reference an agent adapts; `packages/telemetry/src/` is the
tested implementation an agent installs instead, if the team chooses to.

The doc has the same status, structure, and faithfulness commitment as
[`docs/hand-written-registry.md`](hand-written-registry.md) and
[`docs/hand-written-command-sequence.md`](hand-written-command-sequence.md).

---

## When to hand-write vs. install `acture-telemetry`

| | Hand-write (this doc) | `pnpm add acture-telemetry` |
| --- | --- | --- |
| Dependency added | none | one (`acture` is already a peer) |
| Code the team owns | ~30 lines, in their repo | the import surface |
| Errors-as-data preserved | yes (uses the same `Result`) | yes |
| `consoleSink` reference | hand-write a one-liner | imported |
| Maintenance | the team's | acture's |
| Composition with other dispatch wrappers | identical pattern | identical pattern |

Hand-writing is the right call when the project wants the *observation* without
the *dependency* — a small command set, a single bespoke sink the project
already maintains, or a team that prefers to own every line. Installing
`acture-telemetry` is the right call when the team wants the tested behaviour
(sampler/redact ordering, defensive try/catch, idempotency) without
re-deriving it. **It is a per-project trade, made deliberately — never a
default.**

The two paths are compatible: a project can hand-write today and swap in
`acture-telemetry` later (or vice versa). The shapes below are deliberately
the same shapes `acture-telemetry` exports, so the migration is mechanical.

---

## The minimal instrument

This is a complete, self-contained telemetry observer. Copy it into the target
project (e.g. `src/telemetry.ts`), adapt the names, delete what the project
doesn't need. It has **no dependencies** beyond `acture`'s `Registry` /
`Result` types (and even those can be locally typed if the project hand-wrote
the registry).

```ts
/* ── Types: mirror the acture-telemetry shape ────────────────────────── */

import type { Context, Registry, Result } from 'acture';
// or import the equivalents you defined in your own hand-written registry.

export interface TelemetryRecord {
  readonly seq: number;
  readonly ts: number;
  readonly commandId: string;
  readonly params: unknown;
  readonly ctx: Context;
  readonly result: Result<unknown>;
  readonly durationMs: number;
}

export type TelemetrySink = (record: TelemetryRecord) => void;

export interface InstrumentTelemetryOptions {
  sink: TelemetrySink;
  redact?: (record: TelemetryRecord) => TelemetryRecord;
  sampler?: (record: TelemetryRecord) => boolean;
}

/* ── Instrument: wrap dispatch, observe ──────────────────────────────── */

export function instrumentTelemetry(
  registry: Registry,
  { sink, redact, sampler }: InstrumentTelemetryOptions,
): () => void {
  const original = registry.dispatch.bind(registry);
  let seq = 1;

  (registry as { dispatch: Registry['dispatch'] }).dispatch =
    async function instrumented<R>(id, params, ctx, opts) {
      const t0 = performance.now();
      const result = await original<R>(id, params, ctx, opts);
      const record: TelemetryRecord = {
        seq: seq++,
        ts: Date.now(),
        commandId: id,
        params,
        ctx: ctx ?? {},
        result: result as Result<unknown>,
        durationMs: performance.now() - t0,
      };
      // sampler → redact → sink. Each is wrapped so a throwing
      // callback never breaks dispatch.
      try {
        if (sampler && sampler(record) === false) return result;
      } catch { /* fall through, keep the record */ }
      let toSend = record;
      try {
        if (redact) toSend = redact(record);
      } catch { toSend = record; }
      try {
        sink(toSend);
      } catch { /* swallow — telemetry must never break dispatch */ }
      return result;
    };

  return () => {
    (registry as { dispatch: Registry['dispatch'] }).dispatch = original;
  };
}

/* ── A reference sink (one-liner). ───────────────────────────────────── */

export const consoleSink: TelemetrySink = (r) => {
  const status = r.result.ok ? 'ok' : `ERR ${r.result.error.code}`;
  console.log(`[telemetry] ${r.commandId} ${status} ${r.durationMs.toFixed(1)}ms`);
};
```

That's the whole primitive. ~30 lines, zero new dependencies, owned by the project.

---

## Why each piece is shaped this way

These are not stylistic choices — each one defends against a documented
failure mode. Keep them when you adapt the code.

- **The wrapper captures `original = registry.dispatch.bind(registry)` *once*
  at install time.** Disposing restores that captured reference. Multiple
  instrumenters can wrap each other in install order; **dispose in reverse
  install order** to avoid leaving dangling wrappers.

- **`sampler` runs before `redact`.** No point redacting a record that will
  be dropped. A throwing `sampler` defaults to "keep" — over-log rather than
  swallow records silently.

- **`redact` is a *pass-through callback*, not a declarative key-list.** A
  single function gives the host one place to strip / replace / hash secrets
  and reach into nested `params` or `ctx`. A declarative list (`{ params:
  ['email'] }`) would require the package to own the deletion semantics —
  delete? mask? replace with `[REDACTED]`? — which is a host decision.

- **Every callback is wrapped in `try`/`catch`.** Telemetry *observes* —
  it must never break dispatch. A throwing sink, redact, or sampler is
  swallowed; dispatch returns its `Result<R>` unchanged.

- **`result` is the full `Result<unknown>`, not just an "ok / fail" bool.**
  Errors-as-data is the contract every acture surface honours; the sink sees
  the same `{ ok: false, error: { code, message, details? } }` shape it would
  see from `dispatch` directly. The error code is the most useful telemetry
  signal — keep it.

- **Composition lives at the sink level, not at the install level.** The
  package supports *one* sink intentionally — multiple destinations are a
  user-side composition (`sink: (r) => { a(r); b(r); }`). Trying to support
  "multiple sinks" inside the package would force the package to own a
  failure-handling policy across sinks, an ordering, a parallel-vs-serial
  choice — those are host decisions.

- **The record `seq` is monotonic in-process, NOT a UUID.** Cross-process /
  cross-run correlation is the sink's job: a network beacon adds a session
  id, OpenTelemetry adds a trace id. The in-process `seq` is enough for
  ordering and de-duplication.

---

## What this reference deliberately omits

YAGNI applied softly — add these only when a real need appears in your
project, not for a hypothetical:

- **A buffered / batched sink wrapper.** A real network sink usually batches
  records before flushing. Wrap your own sink — the package shouldn't own
  the batching shape, the flush trigger, or the back-pressure policy.

- **A "drop oldest" / ring-buffered queue.** `acture-devtools`'s
  `instrumentRegistry` keeps a fixed-size in-memory log because its job is
  to be inspected synchronously. Telemetry's job is to *forward*, not
  buffer — leave queue management to the sink.

- **Per-tier defaults (e.g. "log experimental at INFO, stable at DEBUG").**
  That's exactly the kind of decision the sink should make: it already has
  `record.commandId` and (via a separate `registry.get(id)?.tier` lookup)
  the tier. Adding a tier-aware default to the package would mean owning a
  level vocabulary the package doesn't need.

- **OpenTelemetry / structured-logger / network-beacon adapters.** Each of
  these is a separate accelerator — a new package later if real demand
  surfaces. Today they are sinks the host wires up.

---

## Faithfulness note

The shapes here mirror `packages/telemetry/src/telemetry.ts` exactly —
`TelemetryRecord`, `TelemetrySink`, `InstrumentTelemetryOptions`, the
`instrumentTelemetry` signature, the sampler → redact → sink order, the
defensive try/catch, the `consoleSink` format. That is intentional: an agent
that hand-writes from this doc and later installs `acture-telemetry` finds the
migration mechanical. If the package's contract changes, this doc changes
with it.

## See also

- [`docs/positioning.md`](positioning.md) — canonical; the dev-tool-first principle.
- `packages/telemetry/src/` — the tested implementation this reference mirrors.
- [`docs/hand-written-registry.md`](hand-written-registry.md) — the sibling reference for the core primitive.
- [`docs/hand-written-command-sequence.md`](hand-written-command-sequence.md) — the sibling reference for the macros / e2e consumer layer.
- `acture-telemetry` consumer skill — the agent's guide to *adding* telemetry to a target project.
