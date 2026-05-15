---
"acture-telemetry": minor
---

Initial release. Observes every `dispatch` via a configurable sink. Optional pass-through `redact` callback (strip secrets) and `sampler` callback (filter/ratio) — both single-function shapes, no mini-DSL. One built-in `consoleSink` for quick wiring; multiple destinations are user-side sink composition (`sink: (r) => { a(r); b(r); }`). Errors-as-data preserved end-to-end: `record.result` is the full `Result<unknown>` from the dispatcher. Telemetry never breaks dispatch — sampler / redact / sink are each wrapped in `try`/`catch`. Idempotent per registry; the disposer restores the dispatch captured at install time. Hand-written equivalent: `docs/hand-written-telemetry.md`.
