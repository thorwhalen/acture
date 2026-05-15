---
name: acture-test-property
description: Build a property-testing consumer surface in a target project — fast-check arbitraries over the command registry, random `CommandSequence`s replayed end-to-end, invariants asserted at the end of each sequence. Covers the property-runner choice (fast-check / hand-rolled), the agent-written vs `acture-test-property` package paths, the Zod-to-arbitrary subset, the end-of-sequence invariant rule, and the counter-example reproducibility contract (shrunk sequence attached to the thrown error). Use when adding property tests / fuzzing over commands, or when working ON the `acture-test-property` package. Triggers on "property testing", "fast-check", "fuzz the registry", "invariant testing", "random command sequences", "shrinking", "counter-example".
---

# acture test-property — fuzzing the registry

Property testing is a **projection of the registry over fast-check**: every command becomes a generator (drawn from its Zod schema), every random `CommandSequence` is replayed through the same sequence engine that drives macros and e2e tests, and invariants run end-of-sequence against `adapter.getState()`. On a counter-example, the shrunk sequence is attached to the thrown error and can be replayed deterministically through `replaySequence` — a fuzzer that produces a non-reproducible counter-example is no better than no fuzzer.

> **Load `acture-consumer-integration` first.** Property-testing is a consumer — this skill covers property-testing specifics; the foundational pattern (the dev-tool-first rule, the per-consumer hand-write-vs-install choice, the tool-library-is-the-user's-choice rule) lives there.

## Two decisions to surface (per `acture-consumer-integration`)

### Decision 1 — the property-test library (the tool-library choice — the user's)

Property testing rests on a runner. Realistic choices: **fast-check** — the dominant JS property-testing library, with shrinking, async support, and stateful-model APIs. **jsverify** exists but is largely unmaintained. A hand-rolled `for (i = 0; i < runs; i++)` loop is workable for small surfaces but loses shrinking. **fast-check is the user's likely choice; ship one binding only**. The `acture-test-property` package binds to fast-check directly; if the project picks something else, agent-write following the same shapes.

### Decision 2 — agent-written vs package-reuse

- **Agent-written** — write the layer directly into the project: a small Zod→arbitrary mapper (cover only the constructs the project's commands actually use), `commandArb` / `sequenceArb` over `registry.list({ tiers })`, and a `propertyTest` runner that calls `fc.assert(fc.asyncProperty(...))` and replays via the project's own command-sequence module. ~60 lines, owned, two install lines (`fast-check`). The reproducible reference is [`docs/hand-written-test-property.md`](../../../docs/hand-written-test-property.md) — adapt it directly.
- **Package-reuse** — install `acture-test-property`. `propertyTest({ registry, adapter, invariants, runs?, sequenceLength?, tiers?, schemaToArbitrary?, ctx?, resetState?, seed? })`. Plus `commandArbitrary`, `sequenceArbitrary`, `zodToArbitrary`, `PropertyTestFailure`, `UnsupportedZodTypeError`. Cost: a dev dependency to track plus a runtime dep on `acture-e2e-playwright` (for `replaySequence`).

Surface both; follow a stated preference if one exists; otherwise ask. Record the choice in the project's adoption notes (`acture-consumer-integration` §Step 4).

## The build — what every path produces, and what to get right

Whatever runner and path, the property-test layer must honour these — they are what makes the surface a faithful registry projection, not a parallel system:

- **Arbitraries draw from the registry, not from a static list.** Adding a command means automatically adding a tested fuzz target. The arbitrary calls `registry.list({ tiers })` at construction time; commands registered after that are not generated (this is fine — call `sequenceArbitrary` inside the test body if you need dynamic discovery).
- **Tier filter respected.** Default to `tiers: ['stable']`. Generating `@internal` commands would bypass the internalToken protocol; generating `@experimental` ones courts noisy churn. The user can widen the filter explicitly.
- **The generated `params` validates against the command's Zod schema.** That is the whole point — generated sequences are dispatchable without `schema_violation` errors crowding the property out. The mapper produces values in the schema's accepted set; anything else is a mapper bug.
- **The Zod subset is the same subset every other adapter sees.** acture's `toJsonSchema` projection covers `string / number / boolean / literal / enum / array / object / union / optional / nullable`. The property-test mapper covers exactly that subset. **Unsupported types throw loudly**, with a clear error and a hint (constrain the schema, or pass `schemaToArbitrary`). Silent skipping would mean a "valid" failing sequence the user couldn't reproduce.
- **Sequences are replayed through `replaySequence` from `acture-e2e-playwright`** (or the hand-written equivalent from `docs/hand-written-command-sequence.md`). The same engine that powers macros and e2e tests powers property tests — one shape, three consumers.
- **Invariants run end-of-sequence, not per step.** End-of-sequence is the simpler contract; it matches `replayTest`'s pattern; it lets the user write coarser, more meaningful invariants ("the graph is still a valid DAG"). Per-step is a future option if a concrete need surfaces — right now, write a coarser invariant or shorten the sequence.
- **A failing dispatch is a property failure.** Invariants assume the sequence ran to completion. `replaySequence` runs with `stopOnError: false` so every step is observed; if any returned `ok: false`, fail the property and attach the sequence.
- **State is reset between runs.** Otherwise sequence N's state pollutes sequence N+1's invariant, and the counter-example reproducer fails to reproduce. The default reset is a `JSON.parse(JSON.stringify(initial))` snapshot taken at the start of `propertyTest`; for non-JSON state (rare under acture's state-model constraint), pass a custom `resetState`.
- **The shrunk sequence is attached to the thrown error.** fast-check's shrinking is the whole point — surfacing a 20-step counter-example when a 3-step one suffices wastes the user's time. The thrown `PropertyTestFailure` carries `.sequence` and `.invariantName`; the user replays via `replaySequence(registry, err.sequence)` for deterministic reproduction.
- **Defaults are runnable, not pathological.** `runs: 100`, `sequenceLength: { min: 1, max: 10 }`, `tiers: ['stable']`. A user who calls `propertyTest({ registry, adapter, invariants })` gets a useful run, not a hang.

## When working ON `acture-test-property`

The same positioning applies inward (per `acture-consumer-integration` §"When you are working ON a consumer-specific package"):

- The package **projects** the registry into fast-check; it does not *decide* what invariants are correct, what shape the state has, what reset semantics the host uses, or what "good fuzzing" means for this project (hard-don't #3). Invariants, `resetState`, `schemaToArbitrary`, and the tier filter are all caller-supplied.
- **One runner binding only — fast-check.** No god-package (`acture-test-property-jsverify`, `acture-test-property-stateful`). Each is its own future package if real demand surfaces (hard-don't #2).
- The package depends on `acture-e2e-playwright`'s sequence engine, *not* on Playwright runtime. That dependency is intentional: `acture-e2e-playwright`'s `replaySequence` is the same engine macros use; the test-property package gets a tested replay path for free without re-deriving it. (If `acture-e2e-playwright` ever splits its pure sequence engine into a separate package, swap the import; the contract is identical.)
- The Zod-to-arbitrary mapper covers the JSON-Schema-representable subset and no more. Adding `z.date()` support to the package is a deliberate scope decision: a host with one date field can pass `schemaToArbitrary`. Adding it to the package commits the mapper to whatever interop semantics the rest of the workspace settles on for dates (which is "not yet").
- **Reset semantics are JSON-clone-by-default.** Non-JSON state is rare under acture's state-model constraint (JSON-serializable is one of the four hard constraints — `acture-greenfield-state-model`). For exceptions, the user passes `resetState`; the package doesn't grow a `cloner` option (inner-platform temptation, hard-don't #1).

## What NOT to build (wait for a real need)

No Vitest / Jest matchers — the thrown `PropertyTestFailure` is already a perfectly good test failure; runners catch and format it. No HTML report — fast-check produces a structured counter-example; format it the way the host runner formats failures. No CI integration — it's a function call; run it in whatever test job already runs. No per-step invariant checking — pick coarser invariants or shorter sequences. No `acture-test-property-stateful` (fast-check's `fc.commands` model) — the flat sequence model is the same shape your e2e tests and macros use; introducing a second shape for fuzzing alone is duplication. YAGNI applied softly.

## See also

- `acture-consumer-integration` — the foundational consumer pattern this builds on.
- [`docs/hand-written-test-property.md`](../../../docs/hand-written-test-property.md) — the ~60-line agent-written equivalent.
- `acture-e2e` — the sibling consumer that uses the same sequence engine; a property test is e2e with random sequences and end-of-sequence invariants.
- `acture-macros` — the sibling consumer that records sequences instead of generating them.
- `acture-command-record-shape` — the `params: ZodType<P>` field the mapper reads.
- `acture-schema-bridge` — the Zod-to-JSON-Schema projection whose supported subset matches this package's mapper.
- `packages/test-property/src/` — the tested implementation; a worked example to adapt for custom mappers.
