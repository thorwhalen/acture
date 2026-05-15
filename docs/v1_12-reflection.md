# v1.12 Reflection

**Authored:** 2026-05-15 by the v1.12 implementing agent. New package `acture-test-property` pulled forward from Post-v1 as the first half of the autonomous v1.12 + v1.13 chain. **489 package tests** (was 460 at end of v1.11; +29 from `acture-test-property`) + 41 example tests, all green; every package and example builds + typechecks. The suite is **19 packages** now.

v1.12 is the first session run in **autonomous-chain mode** per the rewritten `docs/next_session.md`: pre-committed scope, no Step-1 `AskUserQuestion` for shape, escalate only on the "truly stuck" criteria (none fired). The user's standing instruction was "make the best choices … just go on coding."

## Decisions made autonomously (would have been Step-1 questions in v1.11)

All decisions landed on the simpler / more flexible option — consistent with acture's "translate, don't decide" discipline.

1. **Tool-library = fast-check.** Realistic alternatives (jsverify, hand-rolled property runners) are not industry-standard; fast-check is the dominant JS property-testing library. Documented as the user's choice in the README's Decision 1 lines; one binding only.
2. **Zod-to-arbitrary mapping = in-package mapper.** The handoff's preferred option was `@fast-check/zod`, but `npm view @fast-check/zod` returns 404 — the package does not exist on npm. Shipped the YAGNI-respecting fallback per the handoff: a small in-package mapper covering the JSON-Schema-representable subset (`string`, `number`, `boolean`, `literal`, `enum`, `array`, `object`, `union`, `optional`, `nullable`). The same subset acture's `toJsonSchema` projection already serializes — the package speaks exactly the subset every other adapter sees.
3. **Unsupported Zod types = loud throw.** `UnsupportedZodTypeError` with a clear hint ("constrain the schema, or pass `schemaToArbitrary`"). Silent skipping would mean a "valid" failing sequence the user couldn't reproduce.
4. **Invariants = end-of-sequence.** Per the handoff: "pick one and document it; end-of-sequence is simpler and matches e2e's `replayTest`." Per-step is a future option if a concrete need surfaces.
5. **State reset = JSON-clone snapshot, with override hook.** acture's state-model constraint already requires JSON-serializable state (`acture-greenfield-state-model`), so `JSON.parse(JSON.stringify(initial))` is faithful for the default case. Hosts with non-JSON state pass `resetState`.
6. **No 9th consumer surface.** Per the handoff: "test-property is the e2e surface's property-test variant; it doesn't add a 9th surface." The primer's consumer-surface list does not need to grow.

No `AskUserQuestion` was raised. No "truly stuck" criterion fired.

## What v1.12 shipped

### `acture-test-property@1.0.0`

Fast-check arbitraries over the command registry. Three layers:

1. **Zod → fast-check.** `zodToArbitrary(schema)` walks Zod's internal `_def` (probing both Zod 3's `typeName` and Zod 4's `type` discriminators) and emits a `fc.Arbitrary` for the JSON-Schema-representable subset. Tested by sampling against the source schema's `safeParse` — every generated value validates.
2. **Registry-level arbitraries.** `commandArbitrary(registry, { tiers? })` draws a command from `registry.list({ tiers })` and chains `zodToArbitrary(cmd.params)` to produce a `SequenceStep`. `sequenceArbitrary(registry, { length, tiers, schemaToArbitrary })` wraps it in `fc.array` with `{ minLength, maxLength }`.
3. **The property runner.** `propertyTest({ registry, adapter, invariants, runs?, sequenceLength?, tiers?, schemaToArbitrary?, ctx?, resetState?, seed? })` glues `fc.assert(fc.asyncProperty(...))`, `replaySequence` (from `acture-e2e-playwright`), `adapter.getState()`, and the user's invariants. State is reset between runs. A failing invariant or failing dispatch throws `PropertyTestFailure` carrying `.sequence` (the shrunk sequence) and `.invariantName`.

29 tests across two files: 20 in `arbitraries.test.ts` covering primitives, composite Zod types, end-to-end schema validation of generated values, registry filters, sequence-length bounds, and the unsupported-Zod throw; 9 in `property.test.ts` covering happy-path, counter-example with sequence attached, deterministic shrinking with a fixed seed, replay-determinism of the shrunk sequence, dispatch-failure-as-property-failure, both zustand and redux adapter coverage, and state reset (default + custom hook).

`minor` changeset. Hand-written equivalent: `docs/hand-written-test-property.md` (~60 lines, faithful to the package's exported shapes). Consumer skill: `acture-test-property`.

### The dependency-on-`acture-e2e-playwright` question (decided, documented)

The package depends on `acture-e2e-playwright` for `replaySequence`, `CommandSequence`, `SequenceStep`. That's intentional and the same answer the v1.7 design surfaced: the pure sequence engine lives in `acture-e2e-playwright` and is reused. Playwright itself is type-only in `acture-e2e-playwright`'s main entry and lives in the `./fixture` entry — `acture-test-property` does not pull Playwright in. If a future increment splits the sequence engine into its own package, `acture-test-property`'s import swaps; the contract is identical.

### Consistency updates

- `docs/roadmap.md` — status snapshot (19 packages, 489 tests, 25 skills, 6 reference docs), v1.12 Done entry, tracking table.
- `docs/v1_12-reflection.md` — this file.
- `docs/hand-written-test-property.md` — the agent-written equivalent reference.
- `.claude/skills/acture-test-property/SKILL.md` — consumer skill, mirrors the `acture-telemetry` / `acture-undo` template.
- The architecture primer's consumer-surface list is deliberately **not** updated: per the handoff, test-property is the e2e surface's property-test variant, not a 9th surface.

## Hard-don'ts check (pre-merge ritual)

- **#1 inner-platform creep.** No mini-DSL for invariants (just `(state) => boolean`), no declarative redact/sampler in arbitraries, no cloner option (use `resetState`). ✓
- **#2 god-package.** One fast-check binding only. No Jest matcher, no HTML report, no CI integration, no `fc.commands` model. Each is its own future package if real demand surfaces. ✓
- **#3 translate, don't decide.** The package projects the registry; the user owns invariants, schema-to-arbitrary override, reset semantics, tier filter, seed. ✓
- **#6 no React in core.** Package depends on `acture` core, `fast-check`, `acture-e2e-playwright` — none of those drag React in. ✓
- **Dev-tool-first.** Hand-written equivalent shipped before the package was wired (`docs/hand-written-test-property.md`); README leads with the dev-tool-first banner. ✓

## What's next

Publish-time work for v1.12 follows the standard release workflow (push to main → Version Packages PR → merge → publish run → verify with `npm view acture-test-property version`).

Then **v1.13 — Python companion (PyPI)**, the other half of the autonomous chain. Per the handoff, that increment ends the chain: post-v1.13, the agent rewrites `docs/next_session.md` as a fresh handoff surfacing the remaining post-v1 options (`acture-state-jotai`, `acture-state-valtio`, `acture-sandbox`) for the user to steer.
