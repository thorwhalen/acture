# v1.11 Reflection

**Authored:** 2026-05-15 by the v1.11 implementing agent. Two new packages pulled forward from Post-v1 by explicit user direction. **460 package tests** (was 443 at end of v1.10; +18 from `acture-telemetry`, +19 from `acture-undo`) + 41 example tests, all green; every package and example builds + typechecks. The suite is **18 packages** now.

v1.11 is the suite's **first post-v1 promotion**. It is also the first session after the rule-of-three rescope (`docs/redesign_takeaways.md` §6) — the framing for "what acture maintainers ship" is now YAGNI / hard-don't #2 / dev-tool-first, not a numeric-callers gate, and the new handoff (`docs/next_session.md`) replaced "Step 1: clear the callers gate" with "Step 1: settle shape decisions with the user."

## The four shape decisions (settled with the user via `AskUserQuestion`)

All four landed on the simpler / more flexible option — consistent with acture's "translate, don't decide" discipline:

1. **Telemetry `redact`** — pass-through callback `(record) => record`. No declarative key-list. The user owns the deletion / masking semantics; acture-telemetry just runs the function.
2. **Telemetry `sampler`** — function `(record) => boolean`. No fraction shortcut. `Math.random() < 0.1` is one line; tier-aware sampling is just as easy.
3. **Undo effect lifecycle** — host callback `onEffect(effect, { isUndo, isRedo })`. No typed enum. acture-undo NEVER enacts effects; it routes the lifecycle signal and the host decides what an effect MEANS.
4. **Undo transaction failure** — partial stays applied. No magic auto-rewind. Mid-transaction failure leaves prior mutations applied; the entry is still pushed; the caller can `undo()` to rewind explicitly. Matches errors-as-data; the host stays in control.

## What v1.11 shipped

### `acture-telemetry@1.0.0` — the smaller of the two

A middleware-style adapter that observes every `dispatch` and forwards a structured record to a configurable sink. The record shape is closed and minimal (`seq`, `ts`, `commandId`, `params`, `ctx`, `result`, `durationMs`). Errors-as-data preserved end-to-end: `record.result` is the full `Result<unknown>` from the dispatcher — a failed dispatch arrives with `{ ok: false, error: { code, message, details? } }`, the same shape every other surface sees.

Order of operations: `sampler` → `redact` → `sink`. Each is wrapped in `try`/`catch` — telemetry must NEVER break dispatch. A throwing sampler defaults to "keep" (over-log rather than swallow silently). One built-in `consoleSink`; multi-destination is user-side composition (`sink: (r) => { a(r); b(r); }`) — no fan-out, ordering, or failure policy inside the package (hard-don't #3).

18 tests covering: every dispatch is recorded; errors-as-data preserved; redact rewrites before sink; sampler drops before redact; throwing callbacks don't break dispatch; idempotent per registry; disposer restores; consoleSink format; composition with a pre-existing dispatch wrapper.

`minor` changeset. Hand-written equivalent: `docs/hand-written-telemetry.md` (~30 lines, faithful to the package's exported shapes). Consumer skill: `acture-telemetry`.

### `acture-undo@1.0.0` — the larger of the two

Patch-based undo/redo over a `PatchCapableAdapter`. `createUndoHistory(adapter, registry, options?)` returns `{ undo, redo, canUndo, canRedo, clear, transaction, entries, dispose }`.

Two dispatch-layer instruments are installed on construction:
1. **`adapter.setStateWithPatches`** — wrapped to append the `{ patches, inversePatches }` it produces into a per-capture buffer.
2. **`registry.dispatch`** — wrapped to mark capture boundaries (one capture window per dispatch unless a transaction is open) and to collect `Result<R>.effects?` from successful dispatches.

On close, the buffer becomes one `UndoEntry`. The `inversePatches` field is *pre-reversed* at push time (each `setStateWithPatches`'s inverse is *prepended* to the running list), so `applyPatches(state, inversePatches)` is ONE call to roll back the whole entry — regardless of how many `setStateWithPatches` calls it spans.

Transactions group N dispatches into one entry via a simple capture-owner state machine: when `captureOwner === 'transaction'`, the per-dispatch wrapper sees it and does NOT close on dispatch end (the transaction owns the close). Effects fire `onEffect(effect, { isUndo, isRedo })` at three lifecycle points: apply, undo, redo. A throwing `onEffect` is swallowed.

19 tests covering: basic undo/redo, multiple mutations per dispatch, multiple dispatches, limit enforcement (drop oldest), clear, transaction grouping, partial-failure semantics, nested-transaction throw, effect lifecycle (apply / undo / redo), throwing onEffect doesn't break, mutations from `{ ok: false }` dispatches still get a patches-only entry, empty captures produce no entry, unknown-command attempts produce no entry, dispose restores, composition with a pre-existing dispatch wrapper.

`minor` changeset. Hand-written equivalent: `docs/hand-written-undo.md` (~80 lines, faithful to the package's exported shapes). Consumer skill: `acture-undo`.

### The composition question (escalation point that didn't fire)

The v1.11 handoff flagged the `instrumentRegistry` hook-chain question as an escalation point. Investigation showed it doesn't need escalation: `acture-devtools`'s `instrumentRegistry` and `enableTierWarnings` already monkey-patch `dispatch` by capturing the *current* dispatch at install time and replacing it. Multiple instrumenters compose naturally — each one wraps the dispatch it captured. The known limitation is dispose-order (the disposer restores the install-time reference, so disposing an outer wrapper while inner wrappers still reference its captured dispatch leaves dangling wrappers). In practice, instrumenters are installed once at host boot and never disposed; tests dispose in reverse install order. All three READMEs (`acture-telemetry`, `acture-undo`, and the existing `acture-devtools` docs) state the contract.

**No core change was needed.** `acture` core and `acture-devtools` are unchanged this increment.

### Consistency updates

- `acture-architecture-primer` consumer-surface list: #5 telemetry and #6 undo/redo now reference the shipped artifacts (no longer "post-v1").
- `acture-consumer-integration`: per-tool table gained telemetry and undo rows; "See also" enumerates all eight per-surface skills now (palette / hotkeys / MCP / AI / macros / e2e / telemetry / undo).
- `acture-state-adapter`: no longer marks undo as "post-v1"; description and body updated to reference `acture-undo` as the consumer of `PatchCapableAdapter`.
- `docs/roadmap.md`: telemetry / undo moved from Post-v1 to v1.11 Done; tracking table updated; "Next" section reframed (the substantive remaining post-v1 items are Python companion, `acture-sandbox`, `acture-test-property`, additional state adapters).

## Hard-don'ts audit

Ran `.claude/skills/acture-hard-donts/SKILL.md` against the v1.11 increment.

1. **No conditional logic in command metadata.** ✅ Zero `CommandRecord` changes. The two new packages observe; they don't extend the metadata surface.
2. **No god-package.** ✅ Each new package is a *single accelerator*. Telemetry has *one* built-in sink (console); other sinks compose at the user level. Undo has *one* shape (linear patch stack); branched / time-travel / OT / CRDT are explicitly out.
3. **No business logic in adapter packages.** ✅ Telemetry observes (the host's sink/sampler/redact decide everything). Undo records (the host's onEffect callback decides what an effect MEANS). Neither package decides what to log, what's reversible, or what an effect is.
4. **No `if (mode === ...)` in shared helpers.** ✅ Neither package has positioning-path awareness.
5. **No `eval()`-ing LLM-produced strings.** ✅ N/A. Both packages route through the existing dispatcher.
6. **No coupling the registry to React.** ✅ Both packages are plain TS. No React imports. No `react` peer.
7. **No promoting `@experimental` to `@stable` without a migration story.** ✅ N/A — both packages debut at `1.0.0`.
8. **No bundling a UI kit.** ✅ N/A.
9. **No marketing on category.** ✅ Both READMEs lead with the concrete win — telemetry: "Observes every `dispatch` and forwards a structured record to a configurable sink"; undo: "Patch-based undo/redo over a `PatchCapableAdapter`."
10. **No assuming the LLM's chosen function is authorization.** ✅ N/A.

**Scope discipline (YAGNI + hard-don't #2 — replaces the old "rule of three" framing per §6).** Each package was scoped tight: one sink, one undo flavour, no tool-bound bindings (no `acture-telemetry-otel`, no `acture-telemetry-pino`, no branched undo, no time-travel UI). What the README's "What it does NOT do" sections list deliberately omitted is real demand for future packages, not speculative infrastructure declined today.

**Positioning check (merge-ritual #6).** Could a developer get telemetry / undo with zero `acture-*` dependency? **Yes** — `docs/hand-written-telemetry.md` is ~30 lines, `docs/hand-written-undo.md` is ~80 lines; both are faithful to the package's exported shapes so the migration is mechanical. Each package's README points at its hand-written reference. The dev-tool-first principle holds for both.

## Stat sheet

| Metric | v1.10 end | v1.11 end | Δ |
| --- | --- | --- | --- |
| Packages | 16 | 18 | +2 (`acture-telemetry`, `acture-undo`) |
| Worked examples | 4 | 4 | 0 |
| Tests (packages) | 443 | 460 (was 441 + 2 from v1.10 mcp-spec) | +18 telemetry, +19 undo |
| Tests (examples) | 41 | 41 | 0 |
| Skills | 22 | 24 | +2 (`acture-telemetry`, `acture-undo`) |
| Reproducibility / recipe docs | 3 | 5 | +2 (`hand-written-telemetry.md`, `hand-written-undo.md`) |
| CommandRecord fields | 15 | 15 | 0 — closed surface still holds |
| Pending changesets | 0 | 2 (`acture-telemetry` + `acture-undo`, both `minor`) | — |

CI green across the workspace: `pnpm -r build`, `pnpm -r typecheck`, `pnpm -r test` all pass. `changeset status` confirms the two pending changesets bump exactly those two packages, no cascade.

## Release readiness

- ✅ All 18 packages typecheck and build; 4 example apps build + pass.
- ✅ Full workspace green; hard-don'ts audit clean; positioning check passes.
- ✅ Two pending changesets — both `minor` at debut, no cascade.

**v1.11 is DONE.** Next session: see `docs/next_session.md`.
