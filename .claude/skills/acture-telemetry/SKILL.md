---
name: acture-telemetry
description: Build a telemetry consumer surface in a target project — observe every `dispatch` and forward a structured record to a configurable sink. Errors-as-data preserved end-to-end. Covers the sink-library choice (structured logger / OpenTelemetry / network beacon / custom), the agent-written vs `acture-telemetry` package paths, the sampler → redact → sink order, defensive try/catch, and the "telemetry must never break dispatch" rule. Use when adding production observability over commands, or when working ON the `acture-telemetry` package. Triggers on "telemetry", "observability", "log every dispatch", "structured logging", "OpenTelemetry", "network beacon", "audit log", "dispatch tracing".
---

# acture telemetry — observing every dispatch

Telemetry is a **projection of the registry's dispatch loop**: every call produces a structured record, forwarded to a configurable sink. The same `Result<unknown>` every other surface sees (palette, hotkeys, AI, MCP) flows through telemetry — errors-as-data, end-to-end (journal article §3.5).

> **Load `acture-consumer-integration` first.** Telemetry is a consumer — this skill covers telemetry specifics; the foundational pattern (the dev-tool-first rule, the per-consumer hand-write-vs-install choice, the tool-library-is-the-user's-choice rule) lives there.

## Two decisions to surface (per `acture-consumer-integration`)

### Decision 1 — the sink library (the tool-library choice — the user's)

Telemetry rests on a sink. Realistic choices: **a structured logger** (pino, winston, the project's own), **OpenTelemetry** (`@opentelemetry/api` + an exporter), **a network beacon** (`navigator.sendBeacon`, `fetch` to an audit endpoint), or **a custom sink** (file writer, in-memory ring, console). **This choice belongs to the project, not to acture.** acture ships one *reference* sink — `consoleSink` — for quick wiring; it is intentionally not a god-package of tool bindings.

### Decision 2 — agent-written vs package-reuse

- **Agent-written** — write the instrument directly into the project: capture `original = registry.dispatch.bind(registry)`, wrap dispatch with a closure that builds the record and calls the sink, return a disposer. ~30 lines, owned, zero acture dependency. The reproducible reference is [`docs/hand-written-telemetry.md`](../../docs/hand-written-telemetry.md) — adapt it directly.
- **Package-reuse** — install `acture-telemetry`. `instrumentTelemetry(registry, { sink, redact?, sampler? }) → dispose`. Plus `consoleSink` as a reference. Cost: a dev dependency to track.

Surface both; follow a stated preference if one exists; otherwise ask. Record the choice in the project's adoption notes (`acture-consumer-integration` §Step 4).

## The build — what every path produces, and what to get right

Whatever sink and path, the instrument must honour these — they are what makes telemetry a faithful registry projection, not a parallel system:

- **Wrap `registry.dispatch` *once*, in a `try`/`catch`-wrapped closure that calls the original and then emits a record.** The wrapper closes over `original = registry.dispatch.bind(registry)`. Disposing restores that captured reference. Multiple instrumenters compose at install time; **dispose in reverse install order**.
- **`Result<unknown>` is the full result, not just an "ok/fail" bool.** Errors-as-data: failed dispatches arrive with their `error.code`, `error.message`, `error.details?`. The sink sees the same shape every other surface sees. Don't reshape it.
- **Order: `sampler` → `redact` → `sink`.** Sampler runs first — no point redacting a record that will be dropped. Redact runs before the sink — single place to strip secrets. A sink that wants the un-redacted record (debug builds) just doesn't pass `redact`.
- **Every callback is wrapped in `try`/`catch`. Telemetry must NEVER break dispatch.** A throwing sink, redact, or sampler is swallowed; dispatch returns its `Result<R>` unchanged. A throwing *sampler* defaults to "keep" — over-log rather than swallow records silently.
- **The record shape is closed and minimal** — `{ seq, ts, commandId, params, ctx, result, durationMs }`. Resist adding fields. A host that wants `userId` or `traceId` already has `ctx`; a host that wants the command's `tier` can `registry.get(record.commandId)?.tier` inside its sink. Adding fields to the record is the inner-platform temptation (hard-don't #1).
- **One sink, composed by the host if needed.** `sink: (r) => { a(r); b(r); }` is the multi-destination pattern. The instrument owns no fan-out, no ordering, no failure policy across sinks.

## When working ON `acture-telemetry`

The same positioning applies inward (per `acture-consumer-integration` §"When you are working ON a consumer-specific package"):

- The package **observes** the registry; it does not *decide* what to log, what to filter, or what to redact (hard-don't #3). Sampler, redact, and the sink are all caller-supplied.
- No tool-library dependency is added by the package itself — `acture` is the only peer. Sink-library choice stays with the user.
- The package ships **one** reference sink (`consoleSink`). An OpenTelemetry binding, a structured-logger binding, a network-beacon binding — each is a separate accelerator and waits for a real named need (hard-don't #2: no god-package of sinks).
- If a sibling instrumenter exists in the workspace (e.g. `acture-undo`), the package follows the same monkey-patch pattern and the same install-order / dispose-order contract. Document the contract in the README; don't try to invent a shared "middleware chain" primitive in core — that's bigger surface than YAGNI calls for and lives in `acture-devtools` / `acture-telemetry` / `acture-undo` by convention.

## What NOT to build (wait for a real need)

No tool-bound sink bindings (`acture-telemetry-otel`, `acture-telemetry-pino`) — each waits until a concrete need surfaces. No buffering / batching / back-pressure layer — that lives in the sink, where the wire protocol's flush semantics live. No ring-buffered in-memory log — that's `acture-devtools`'s `instrumentRegistry`'s job; telemetry's job is to forward, not retain. No per-tier defaults baked into the package — the sink decides level by inspecting `record.commandId` / the command's tier. YAGNI applied softly.

## See also

- `acture-consumer-integration` — the foundational consumer pattern this builds on.
- [`docs/hand-written-telemetry.md`](../../docs/hand-written-telemetry.md) — the ~30-line agent-written equivalent.
- `acture-command-record-shape` — the `Result<R>` shape the record passes through.
- `acture-devtools` — `instrumentRegistry` (in-memory dispatch log) and `enableTierWarnings` (one-time `console.warn` on experimental dispatch); both use the same monkey-patch-dispatch pattern.
- `acture-undo` — the sibling instrumenter that records `Result<R>.patches?` for undo.
- `packages/telemetry/src/telemetry.ts` — the tested implementation; a worked example to adapt for hand-written sinks.
- `docs/command_dispatch_journal_article.md` §3.5 — telemetry as a multi-surface dispatch consumer.
