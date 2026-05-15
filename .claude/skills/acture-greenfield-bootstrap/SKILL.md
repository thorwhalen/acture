---
name: acture-greenfield-bootstrap
description: The worked, end-to-end bootstrap for a greenfield command-dispatch project — the concrete file-by-file walk-through of the acture-greenfield foundation's four-step sequence, grounded in the graph-editor worked example. Covers the three core-primitive files (state, registry, commands), the "every mutation flows through dispatch" acceptance criterion and its `rg` audit, the state→registry→commands→consumer ordering discipline, and the recurring hand-write-vs-install decision points. Use when actually standing up a new acture project from scratch. Triggers on "bootstrap acture", "set up a new acture project", "scaffold command dispatch", "greenfield walkthrough", "wire up the registry and commands", "first acture app".
---

# acture greenfield — the worked bootstrap

This skill is the **concrete walk-through** of the `acture-greenfield` foundation's four-step sequence: it names the files a greenfield bootstrap produces, in order, and the discipline that holds them together.

> **Load `acture-greenfield` first.** That skill owns the sequence and the dev-tool-first positioning (hand-write the registry vs. install `acture` core — a deliberate per-project choice). This skill walks it concretely. For Step 1's detail, also load `acture-greenfield-state-model`.

## The worked reference

**`examples/greenfield/graph-editor/`** is a complete greenfield acture app — a tiny directed-graph editor. Read it alongside this skill; the file names below map to it directly. It is the thing to *adapt*, not import.

## What the bootstrap produces — three core-primitive files, in order

The core primitive is **three files**. Build them in this order; the order is the discipline.

### 1. `src/state.ts` — the state model + the adapter

The typed state schema (per `acture-greenfield-state-model`) plus the `StateAdapter` construction. In the graph-editor: `GraphState` interface, `initialGraphState`, and `state = createZustandAdapter<GraphState>({ initialState })`. The adapter is constructed here, at module scope — plain TS, no React.

### 2. `src/registry.ts` — the registry, wired

```ts
import { createRegistry } from 'acture';          // or the hand-written registry
import { state } from './state.js';
import { buildCommands } from './commands/index.js';

export const registry = createRegistry();
registry.registerAll(buildCommands(state));
```

Three lines. The registry is **plain TS, constructed outside React** — components consume it by reference; tests, an MCP server, a CLI all construct or import it the same way. (Whether `createRegistry` comes from the `acture` package or from a hand-written `./registry-impl.ts` is greenfield Step 2's decision — the *wiring* file looks identical either way, because the shapes match.)

### 3. `src/commands/index.ts` — `buildCommands(state)`

A function taking the state adapter and returning `CommandRecord[]`. Each command is a `defineCommand({ id, title, params?, when?, execute })`. The `execute` handlers are **the only place state is mutated** — they call `state.setState` / `state.setStateWithPatches`. `buildCommands` takes `state` as a parameter (rather than importing it) so commands are testable against a fresh adapter.

See `acture-command-record-shape` for the closed 15-field `CommandRecord` surface. Keep `params` schemas in the JSON-Schema-representable subset so they round-trip the day an AI/MCP surface is added.

## The acceptance criterion — every mutation flows through dispatch

This is the one criterion that makes it a *command-dispatch* app and not just an app with a registry bolted on:

> Every state mutation lives inside a command's `execute`. Nothing outside `commands/` calls `state.setState` directly.

The audit is a grep. The graph-editor enforces it literally:

```sh
rg "state\.setState|adapter\.setState" src/ --glob '!src/commands/**'
# must report zero matches
```

Run this audit at bootstrap-acceptance time. A match outside `commands/` is a mutation that bypassed the registry — it won't appear in macros, won't be testable through the command layer, won't be undoable. Route it through a command.

## The ordering discipline

**state → registry → commands → consumer.** Each step depends only on the ones before it:

- Don't author commands before the state model is settled (`acture-greenfield-state-model`) — commands written against a half-formed state shape get rewritten.
- Don't add consumer surfaces as part of "setting up acture." The core primitive (the three files) stands alone and ships alone. A palette, hotkeys, an MCP endpoint come **later, separately, per-consumer** — Step 4 of the foundation.

## The decision points recur — don't collapse them

The bootstrap surfaces the hand-write-vs-install choice (Dimension 2) **three separate times**, and each is its own deliberate, recorded decision:

1. **The registry** — hand-write from `docs/hand-written-registry.md`, or install `acture` core. (Greenfield Step 2.)
2. **The state adapter** — hand-write the 3-method adapter, or install `acture-state-zustand` / `acture-state-redux`. (`acture-greenfield-state-model` → `acture-state-adapter`.)
3. **Each consumer surface** — hand-write, or install the matching `acture-*` package. (`acture-consumer-integration`, per consumer.)

A project can hand-write the registry, install a state adapter, and hand-write its first consumer — all valid, all in the same project. Surface each choice; follow a stated preference; record what was chosen and why.

## What NOT to do

- **Don't scaffold all eight consumer surfaces upfront.** Build the three core files, get a working dispatch loop, *then* add the one consumer the project needs now.
- **Don't install the whole `acture-*` suite reflexively.** The core primitive needs at most `acture` + `zod` — and even those are optional (hand-written path). Every other package is a later, per-consumer opt-in.
- **Don't mutate state outside `commands/`.** The acceptance criterion. If a UI handler needs to change state, it dispatches a command.
- **Don't construct the registry inside a React component or behind a Provider.** It is module-scope plain TS (hard-don't #6). Excalidraw's React-bound `ActionManager` is the documented failure mode.

## Checklist before you finish

- [ ] Three files exist: `state.ts`, `registry.ts`, `commands/index.ts` — built in that order?
- [ ] Is the registry plain module-scope TS — no React, no Provider?
- [ ] Does `buildCommands` take the state adapter as a parameter (testable against a fresh adapter)?
- [ ] Does the `rg` audit report **zero** `setState` calls outside `commands/`?
- [ ] Were the three hand-write-vs-install decisions surfaced and recorded — not silently defaulted to install?
- [ ] Did you stop at the core primitive, rather than scaffolding consumer surfaces as part of "setup"?
- [ ] For the first consumer surface, did you load `acture-consumer-integration`?

## See also

- `acture-greenfield` — the foundation; this skill is the concrete walk-through of its four-step sequence.
- `acture-greenfield-state-model` — Step 1 in detail; produces `state.ts`.
- `examples/greenfield/graph-editor/` — the complete worked app: `src/state.ts`, `src/registry.ts`, `src/commands/index.ts`, plus the consumer surfaces and the `integration.test.ts` that exercises the dispatch loop.
- `docs/hand-written-registry.md` — the zero-dependency registry reference, for the Step 2 hand-write path.
- `acture-command-record-shape` — the closed `CommandRecord` surface for Step 3.
- `acture-consumer-integration` — the per-consumer foundation for Step 4 (palette / hotkeys / MCP / AI / e2e).
