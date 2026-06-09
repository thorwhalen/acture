# Extension & Plugin Systems for a Command-Dispatch Architecture — Design Notes & GO/NO-GO for `acture-sandbox`

**Author:** Thor Whalen
**Date:** June 2026
**Status:** research finding for the brief at `docs/research/acture_research_prompts.md` §7 — the gating prerequisite for any `acture-sandbox` code, per `docs/next_session.md` Option C. This is a **design-on-the-shelf**, not a build plan.

---

## 0. GO/NO-GO — read this first

**Recommendation: NO-GO for now. Ship the design, not the package.**

There is **no named concrete user** for an acture extension/sandbox surface today. The brief (§7, Part F #14) makes a GO/NO-GO recommendation its headline deliverable precisely because the honest answer drives everything else, and the maintainer principles are unambiguous about what to do in the absence of a user:

- `docs/redesign_takeaways.md` §6: the governing tests for shipping an acture package are **YAGNI / a real need we can name and shape**, hard-don't #2 (no god-package), architecture-astronaut avoidance, and the dev-tool-first principle — *not* a desire to keep shipping.
- `docs/next_session.md` line 48: *"Stable-and-waiting is a valid outcome of finishing v1; don't pull-forward speculative work just to keep shipping."*
- `docs/next_session.md` line 62: if the user picks the extension option, *"**do not write package code** — propose a research-7 prompt first."* This note **is** that research output. Its job is to make the design well-formed enough that, when a user surfaces, the build is a wiring exercise — not to authorize the build.

So the deliverable is a **written design that ships only when a user surfaces**. The TypeScript interfaces in §6 are the valuable, durable artifact. Nothing in this note should be read as "build now."

### The single trigger that flips NO-GO → GO

One concrete event justifies writing code: **the first real extension-host or extension-author user.** Concretely, *a host that needs to load command-contributing code it did not author* — a partner integration, a customer plugin, an internal "Labs" team shipping bundles on a separate cadence. Until that user exists with a named need, this stays on the shelf. The corollary trigger, sharper still: **the first untrusted author.** The moment an author you cannot audit is about to run code, isolation stops being optional (see §3) — and *that* is the trigger that justifies the deferred `acture-sandbox` isolation layer specifically, separate from a trusted host/loader.

### What "GO" would scope (when it comes)

The minimal-credible v1, per the brief's Part F #13: a typed contribution model over the existing registry + the in-process host (a ~10-line hand-write, §5) + a manifest schema + `docs/hand-written-sandbox.md`. The isolation transports (iframe/Worker/QuickJS/isolated-vm) are explicitly **not** in a first v1 — they arrive only with the untrusted-author trigger. See §6 for the split, and the explicit reconciliation with the brief's mandated `acture-sandbox` name.

---

## 1. The one finding that matters most: where the hand-writable promise bends

The brief's Part E/F is the conceptual crux (#11, #12): acture's dev-tool-first positioning promises that a developer **can hand-write the equivalent of any acture package** (`docs/positioning.md` §2). Sandboxing is flagged as *"the first consumer surface where that principle is potentially non-trivial."* The required finding is a clear answer to: **is the extension surface the first place where the hand-writable equivalent breaks?**

**Answer: it depends on which of two layers you mean, and the distinction is the whole finding.**

Decompose "extension system" into two layers that the note's earlier drafts (and most discussions) conflate:

1. **The host / loader layer** — "load a bundle of command contributions under an owner; unload them atomically." This is a **~10-line hand-write** (shown in §5), built entirely from acture core's existing `register` / `Disposable` / `onCommandsChanged`. It stays **pattern-first like every other acture surface**. The dev-tool-first promise holds completely here. A `CommandRecord` already *is* the manifest (brief Part D #10) — so a host that trusts its authors needs no new machinery at all.

2. **The isolation layer** — running code you cannot audit *safely*: SES Compartment, cross-origin iframe + `postMessage`, Web Worker, QuickJS-in-WASM, or Node `isolated-vm`. **This is the first thing in acture that is genuinely NOT a 60-line hand-write.** `docs/hand-written-registry.md` is ~60 lines; a correct membrane is not. Standing up SES lockdown, or a capability-gated `postMessage` protocol with structured-clone discipline and a kill switch, or a QuickJS interrupt-deadline loop — each is real, error-prone, security-sensitive engineering where a subtle mistake is a vulnerability, not a bug.

**So the dev-tool-first promise does NOT break in general — it bends at exactly one rung, and only when untrusted authors appear.** The host/loader is pattern territory forever. The isolation layer is the *first* acture consumer surface that is genuinely **package territory rather than pattern territory** — and even then only once the threat model demands it. This is the answer to brief Part E/F, and it directly shapes the package split (§6): a trusted host/loader is barely a package at all, while a `acture-sandbox` isolation layer is the one place a tested package earns its keep.

---

## 2. What an extension system is, and the design space

An extension system is the machinery by which **code you did not write when you shipped your app contributes behaviour at runtime.** The author may be you next month, a vetted partner, or an anonymous stranger — and that difference is the single most consequential variable in the whole design.

The clarifying frame: **an extension system is three decisions in a trenchcoat, answered in that order** [1]:

1. **Trust model** — who writes extensions, and is their code adversarial?
2. **Capability model** — what are extensions allowed to change?
3. **Contract** — what surface do you expose and promise to keep stable?

Each answer constrains the next. **Trust is the master axis** because choosing "untrusted" implicitly forces the API to be message-passing, asynchronous, serializable, and capability-gated — which constrains capability (no shared object refs) and contract (everything crosses a serialization boundary) [1]. Most painful extension-system rewrites happen because someone answered capability or contract before trust, then discovered that retrofitting isolation onto an in-process design is *a rewrite, not a refactor* [1].

### The orthogonal axes — a walkable decision framework

Two folk intuitions ("immutable vs. mutable operations" and "invoke commands vs. transform the HTML/JS") name two *distinct, orthogonal* axes [1].

**Axis A — Trust model (the master axis).** Pick the strongest isolation that still lets extensions do their job.

| Trust tier | Who | Isolation goal | Mechanism (browser / Node) |
|---|---|---|---|
| Fully trusted | You, your team, vetted partners | None | in-process `import()` + module registry |
| Semi-trusted | Known authors, reviewed code, but bugs happen | Fault isolation (crash containment, NOT security) | Web Worker / child process + `try/catch` |
| Untrusted | Anonymous marketplace, adversarial | Security isolation | sandboxed iframe / QuickJS-in-WASM / isolated-vm / capability-gated channel |

**Axis B — Capability / effect tier (the immutable→mutable axis).** Default to the lowest; promote individual capabilities deliberately, as *declared, mediated* powers, never ambient access [1].

| Tier | Name | What it can do | Mediation posture |
|---|---|---|---|
| 1 | Read-only / observer (**DEFAULT**) | Read state, compute derived values, change nothing | Trivial: reads don't conflict; parallel-safe; pure-fn testable |
| 2 | Command-invoking (**SWEET SPOT**) | Run host commands by id with validated args | Command pattern as a security/stability boundary |
| 3 | State-mutating | Modify shared model | Mediate via patches/transactions (immer/zustand), never raw object access |
| 4 | Environment-transforming | Change the substrate (DOM, behaviour) | Trusted only, OR sacrificial iframe, OR a declared transform contract (AST→AST) |

This axis governs **conflict, ordering, rollback, and concurrency — the same four concerns that make distributed systems hard** [1].

**Axis C — Interaction mechanism (the shape of the seam; several coexist).** Declarative contribution points (manifest data) for the static surface; RPC/command for invocation; filter hooks for transforms; an optional typed SDK facade over RPC for ergonomics; raw substrate only for fully-trusted first-party code [1].

**Axis D — Contract (cross-cutting, the thing you'll most regret getting wrong).** Schema, not just types; explicit `apiVersion`; tolerant-reader discipline; the narrowest waist you can manage. The extension API is *a published protocol with adversarial clients* [1].

The keystone safety principle threading all four: **expose effects as data, not as power** [1]. The higher the capability tier, the more you *mediate* rather than *expose*. That is the bridge to §3.

---

## 3. Trust, isolation & threat models — the package-territory rung

### 3.1 What shipped systems actually do (survey)

The brief (Part A #1) asks for the threat models of shipped extension systems. The pattern across them confirms the trust-first frame:

| System | Assumed attacker | Isolation primitive | API boundary | What was given up |
|---|---|---|---|---|
| **VS Code** | Both (malicious author + supply-chain of a trusted one) | Separate **Extension Host process** | Async, capability-ish (`vscode.*` namespace; no raw renderer) | No DOM access for extensions; async-only API; review burden |
| **Figma** | Malicious plugin author | **Sandboxed iframe** (QuickJS-in-realm historically), `postMessage` to host | Async, structured-clone only | Sync ergonomics; plugins run in a constrained JS realm |
| **Chrome (MV3)** | Both | Separate process per extension + **declarative** permission manifest | Async message passing; capability via `permissions[]` | MV3 removed remote-code & blocking webRequest; capability friction |
| **Obsidian** | Malicious author (Restricted Mode default-off for community plugins) | **None at runtime** — plugins run in-process with full Node/Electron access | Sync runtime API (`this.addCommand`) | Security is delegated to *review + user consent*, not isolation |
| **Slack apps** | Malicious app | **Server-side**; OAuth scopes; no client code in host | HTTP/events; capability via OAuth scopes | All compute is the app's own backend; no in-host extension code |
| **Raycast** | Malicious author | Node process, store review | Async API; capability via manifest | Review-gated; trust leans on the store |

Three takeaways: (a) **isolation primitive is downstream of the trust answer**, exactly as the master-axis claim predicts; (b) the systems that ship *no* runtime isolation (Obsidian) substitute **review + explicit user consent** — which is a real, named posture, not an absence of one; (c) **isolation alone is never the whole answer** — every isolating system *also* gates capability (OAuth scopes, `permissions[]`, the `vscode.*` namespace).

### 3.2 Documented incidents — which threat-model layer failed (brief Part A #2)

The brief requires 2–4 documented incidents tied to the layer that failed. These are the persuasive, concrete element:

| Incident | What happened | Threat-model layer that **failed** | Response |
|---|---|---|---|
| **Malicious VS Code extension token exfil** (e.g. the 2023 "Theme"/credential-stealer family; 2025 supply-chain copies of popular extensions) | Extensions impersonating popular ones harvested credentials / env tokens and beaconed them out | **Marketplace review + runtime isolation** — the Extension Host isolates the *renderer* but extensions still get Node/network capability, so review was the only gate and it missed | Microsoft tightened marketplace verification, added signature checks; the structural gap (extensions get ambient Node capability) remains by design |
| **Chrome extension supply-chain takeover** (e.g. the 2024–25 wave where attackers phished maintainers / bought popular extensions, then pushed a malicious auto-update) | A *trusted* extension was compromised at the author/account layer and shipped malware to its existing install base via auto-update | **Author-account / supply-chain layer** — runtime isolation and the permission manifest worked as designed; the trusted author themselves turned hostile | Mandatory 2FA for developer accounts, stricter update review, faster takedown — i.e. hardening the *provenance* layer, not the runtime |
| **Figma plugin clipboard/data over-read** (the class of issue behind Figma's "update on plugin security") | Early plugins could reach data (clipboard, network, document scope) beyond what users expected | **Capability scoping** — isolation (iframe) contained the code, but the *capability surface handed across the membrane* was too wide | Figma narrowed the API surface, added a network-access allowlist & user prompts, tightened the membrane's exposed capabilities |
| **`axios` npm package compromise** (supply-chain, 2026) | A widely-depended-on package was compromised at the registry/publish layer, pulling malicious code into countless builds | **Provenance / supply-chain** — no runtime sandbox is even in play; the dependency *is* trusted code | Push toward signed provenance (npm provenance, Sigstore), lockfile + integrity discipline [24] |

The cross-cutting lesson, and the reason a sandbox is necessary-but-not-sufficient: **two of the four failures were at the provenance/author layer, where runtime isolation is irrelevant.** A membrane stops the code you load from doing X; it does nothing about a *trusted* author turning hostile or a registry compromise. Any acture isolation story must pair runtime isolation with (a) capability scoping across the membrane and (b) a provenance posture (signed bundles, pinned versions) — see §3.5.

### 3.3 The irreversible decision is the contract shape, not the sandbox

The most important reframing [4]: **the irreversible decision is the contract shape, not the sandbox.** If the author-facing contract is asynchronous, structured-clone-serializable, and capability-as-data, then in-process, Worker, iframe, QuickJS, isolated-vm, and WASM are all just adapters behind one `ExtensionRunner` port. *Design for the worst runtime; the local case is then trivial.*

```ts
interface ExtensionRunner {
  load(source: ExtensionSource): Promise<LoadedExtension>;
  dispose(id: string): Promise<void>;
}
```

**Isolation is necessary but not sufficient — you also need a capability gate (POLA).** A Worker/iframe/VM only *contains* code; it does not stop the code from exfiltrating whatever capabilities you hand it. No browser mechanism closes network exfiltration by itself. The right mental model is **strong isolation + capability-gated message channel** [4][11].

### 3.4 The decision table of membrane mechanisms (brief Part B)

| Mechanism | Boundary kind | What it stops | What it does NOT stop | When |
|---|---|---|---|---|
| **In-process** `import()` | None | Nothing | Everything | Fully-trusted, first-party (the only sane v1 default) |
| **Web Worker** + Comlink | Fault isolation, **NOT security** | Main-thread DoS/jank; gives a kill switch (`terminate()`) | Token theft, network exfil, shared-IndexedDB cross-extension reads (shares page origin) | Semi-trusted; forces the good async/clone contract at compile time |
| **Cross-origin sandboxed iframe** (`allow-scripts` only, separate origin) | Security (origin) | Parent-DOM access, cookie/localStorage reads; renders untrusted UI | CPU/memory quotas (none); needs locked `targetOrigin` | Untrusted **UI** |
| **QuickJS-in-WASM** | Security (separate object heap) | Ambient browser APIs; gives memory + interrupt limits (browser AND Node) | JIT speed (it's an interpreter); easy debugging | Untrusted **compute** (the Figma model) |
| **SES Compartment** (Endo) | Security (frozen intrinsics, no ambient authority) | Prototype poisoning, ambient globals; same-thread | Availability — an infinite loop still freezes the thread (no preemption) | Untrusted **same-thread compute** w/ object-capability discipline |
| **isolated-vm** (Node) | Security (separate V8 isolate) | Real `memoryLimit`/`timeout`/`cpuTime` quotas | Maintenance-mode dep risk; process-crash exposure; native-build friction | Untrusted **server compute** w/ metering |
| **ShadowRealm** | Integrity ONLY — **the trap** | Namespace hygiene | Availability (infinite loop freezes UI); full confidentiality. Stage 2.7 | Do NOT design security around it |
| **WASM Component Model / Extism** | Security (zero ambient authority) | Cross-tier, language-agnostic | Heavier toolchain; for JS plugins it's QuickJS underneath | Cross-tier sandbox endgame |
| **vm2** | — | — | **Dead.** Do not use | Never |

### 3.5 The membrane recommendation for acture v1, with rationale (brief: "a concrete recommendation, not a foregone conclusion")

The brief asks for a *reasoned* membrane recommendation and a verdict on whether the in-process trusted model is genuinely sufficient — not an assumption.

**Recommendation: in-process, no membrane, for v1 — and this is genuinely sufficient *given the current trust reality*, not merely a default.** The reasoning, not just the conclusion:

1. **There are no untrusted authors.** A membrane defends against adversarial or unauditable code. acture has neither today; the only plausible early extension authors are the maintainer and first-party "Labs" features. Spending the (real, §1) isolation-engineering cost with no adversary to defend against is the architecture-astronaut trap `docs/redesign_takeaways.md` §2.6 names explicitly.
2. **The contract shape — not the membrane — is what must be right now.** Because the effect contract (§4) is async, structured-clone-safe, and capability-as-data *from day one*, adding a membrane later is an adapter swap behind `ExtensionRunner`, not a rewrite [4]. So choosing in-process v1 forecloses nothing.
3. **The verdict on sufficiency:** in-process is sufficient *exactly as long as authors are trusted*, and the moment that stops being true (the §0 trigger), the membrane choice is forced — and the table above already names it: **cross-origin iframe for untrusted UI, QuickJS-in-WASM for untrusted in-browser compute, isolated-vm/QuickJS in Node for untrusted compute that must be metered.** That is the deferred `acture-sandbox` isolation layer, gated on a real untrusted-author user.

Hard don'ts at this rung [4]: never `allow-scripts` + `allow-same-origin` together for same-origin content; never host untrusted iframes from your own origin; never leave `targetOrigin` as `'*'`; never leak a raw `Reference`/`ExternalCopy` out of isolated-vm; never lean a security design on ShadowRealm.

### 3.6 Resource quotas — the realistic in-browser posture (brief Part C #6/#7)

Resource governance is **asymmetric**, and the concrete toolchain matters:

- **The browser cannot meter CPU/memory.** The only enforcement primitives are: (a) a **Web Worker `terminate()` kill switch**, and (b) an **`Atomics`-based watchdog** — a supervisor thread that, via `Atomics.wait`/a shared deadline, detects a worker that has blown its time budget and terminates it. There is no in-browser way to cap memory growth or preempt a tight loop on the main thread.
- **Node can meter.** `isolated-vm` exposes real `memoryLimit`, `timeout`, and `cpuTime`; an **isolate-per-extension with a V8 memory limit** is the realistic enforcement model. QuickJS exposes an interrupt-deadline and a memory cap.

**acture's practical v1 posture, stated explicitly:** *we isolate the API surface; an infinite loop DoSes the offending tab. Real CPU/memory metering requires Node `isolated-vm` or QuickJS — plan a backend tier only if billing/throttling untrusted compute becomes a named requirement.* For an in-browser system the honest answer to "is CPU/memory enforcement realistic without isolates?" is **no** — the posture is API-surface isolation plus a Worker kill switch, and anything stronger is a server-side concern.

---

## 4. The effect-mediation seam — effects/commands as data

### 4.1 The keystone inversion

Instead of an extension *performing* side effects, it **returns a plain data value describing the intent**, and the host parses, validates, decides whether and how to realize it, and owns all actual mutation [2]:

```ts
type Extension = (context: HostContext) => EffectEnvelope[] | Promise<EffectEnvelope[]>;
```

This inversion — independently reinvented as the command bus (CQRS), the `{type, payload}` action object, and the ProseMirror "step" — is what makes *every* downstream property possible. Once the effect is a datum the host owns, the host can log, validate, reorder, reject, replay, or run it in another process [2].

### 4.2 Connecting to the command registry

This is where the extension system meets the command-dispatch architecture. The journal paper's keystone thesis: **the command registry IS the extension point, and an extension is a bundle of contributions** [5]. The effect envelope's `command` variant *names a registered command id with validated args* — so the effect channel and the contribution surface are two faces of the same registry:

- **Contribution surface:** an extension registers new commands (id + metadata + schema + handler) under an owner, populating the same registry that powers the palette, hotkeys, AI tools, and MCP.
- **Effect channel:** an extension *requests* an effect by naming an allow-listed command id; the registry validates args against the same schema and dispatches.

Because every command already carries a typed parameter schema authored once, the schema bridge automatically makes each extension contribution typed, validated, and projectable to AI/MCP with no per-surface glue [5].

### 4.3 The effect envelope: one narrow waist

```ts
const EffectEnvelope = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('command'),   version: z.number().int(),
             command: z.string(), args: z.unknown() }),          // tier 2
  z.object({ kind: z.literal('patch'),     version: z.number().int(),
             ops: z.array(JsonPatchOp) }),                       // tier 3
  z.object({ kind: z.literal('transform'), version: z.number().int(),
             steps: z.array(DocStep) }),                         // tier 4 (safe)
]);
```

One Zod-validated, structured-clone-safe union; each variant carries an explicit integer `version`. **This is the open-closed seam: new capabilities are new schema entries, never new ad-hoc power grants** [2].

### 4.4 The payoff: undo, replay, audit, gating — from one log

Because every effect (and its result) is a logged datum, the **append-only effect log** doubles as several subsystems at once [2]: **Undo** (store the inverse — `produceWithPatches` returns `[next, patches, inversePatches]`; ProseMirror steps invert directly); **Audit** (the log *is* the event history); **Replay/time-travel** (serializable effects make state a fold over the log); **Permission-gating** (allow-list/deny/attenuate the vocabulary *per trust tier* before dispatch); **Optimistic update + rollback** (apply, keep inverse, roll back on failure). Representing effects as serializable, invertible data collapses four-or-five normally-separate subsystems into one log [2]. This is the highest-leverage payoff.

### 4.5 Results and errors must also be data

A worker/iframe boundary is asynchronous, and exceptions don't survive serialization — so every dispatch returns a Promise of a discriminated result union [2]:

```ts
type EffectResult<T> =
  | { ok: true;  value: T }
  | { ok: false; error: { code: string; message: string } };
```

Errors-as-data keep the failure path symmetric across in-process and cross-process adapters — and align exactly with `acture-mcp-server`'s errors-as-data posture (`redesign_takeaways.md` §1.8).

### 4.6 The in-process ⇄ serialized symmetry: one port, two adapters

Define the effect sink as a hexagonal **port** the core depends on, with an in-process adapter (today) and a cross-boundary adapter (later):

```ts
interface EffectSink {
  dispatch(effect: EffectEnvelope): Promise<EffectResult<unknown>>;
}

// in-process (today, trusted) — direct handler call
async dispatch(e) {
  const p = EffectEnvelope.safeParse(e);
  if (!p.success) return { ok: false, error: { code: 'E_SCHEMA', message: '…' } };
  return this.handlers.run(p.data);   // routes through registry.dispatch()
}

// cross-boundary (later, untrusted) — worker/postMessage/Comlink
async dispatch(e) {
  const p = EffectEnvelope.safeParse(e);
  if (!p.success) return { ok: false, error: { code: 'E_SCHEMA', message: '…' } };
  return this.remote.run(p.data);
}
```

**Both adapters run `safeParse` — validation even in-process, so the validation path is exercised from day one and the worker migration adds zero new failure modes** [2]. The extension-facing API is byte-identical in both worlds: it returns an envelope, never calls a host method. Moving in-process → cross-process is a composition-root wiring change, not a redesign [2]. *Design the serialization boundary in from day one even when you don't have one yet.* For v1, the in-process adapter is the *only* one shipped; the port exists so the cross-boundary adapter is reachable without redesign.

### 4.7 Composition when multiple extensions contribute at one seam

Classify each seam as a **filter** (input→output, composes via waterfall) or an **action** (side-effecting, fans out) [2]. The richest typed vocabulary is tapable's hook catalog (Sync/AsyncParallel for observers, SyncWaterfall for filters, SyncBail for veto/security gates, SyncLoop for fixpoint passes). Order with integer priority (lower runs earlier; ties by registration order); key array patches by id, not index [2]. *Actions do stuff; filters change stuff.*

---

## 5. The host/loader layer — pattern territory, hand-written in ~10 lines

This is the layer the dev-tool-first promise covers fully (§1). The contribution unit **is** core's `CommandRecord` — the manifest, in acture, reduces to "the `CommandRecord` *is* the manifest" (brief Part D #10). A trusted host needs nothing beyond core:

```ts
// hand-written extension host — NO acture-sandbox dependency, core only
function loadExtension(registry, manifest, mod) {
  const disposables = [];
  for (const cmd of manifest.contributes.commands ?? []) {
    disposables.push(registry.register({ ...cmd, execute: mod[cmd.id] }));
  }
  return { id: manifest.id,
           dispose: () => disposables.forEach(d => d.dispose()) };   // atomic unload
}
```

The **owner-scoped `Disposable`** (`redesign_takeaways.md` §1.5) is the natural unload primitive: an extension groups all its registrations under one owner; `owner.dispose()` unregisters everything atomically. Enable/disable/uninstall/conflict-resolution all reduce to this. Surfaces consume `registry.onCommandsChanged` and refresh — *react to registry events, don't poll* (§1.9). Because this is core-only, **a host that trusts its authors gets the entire extension surface for free, today, with no `acture-*` dependency at all.**

### Manifest shape (when you want declarative metadata)

Carry a common-denominator manifest from day one even on first-party extensions [3] — identity/compatibility metadata is painful to retrofit. The manifest is **pure declarative data** validated against the host's canonical schemas. It must stay inert: no conditionals, no loops — that is **hard-don't #1, "No conditional logic in command metadata"** (`redesign_takeaways.md` §3, line 163). VS Code when-clauses are the explicit upper bound.

```jsonc
{
  "id": "publisher.csv-profiler",        // namespaced identity (globally unique)
  "name": "CSV Profiler",
  "version": "1.2.3",
  "apiVersion": "^1.0.0",                // host<->extension compatibility contract
  "engines": { "host": "^1.0.0" },
  "trust": "first-party",                // first-party | semi-trusted | untrusted
  "experimental": true,                  // drives opt-in / Labs UX framing
  "activationEvents": ["onCommand:publisher.csv-profiler.run"],
  "contributes": {
    "commands": [
      { "id": "publisher.csv-profiler.run", "label": "Profile CSV",
        "category": "Data", "when": "app.datasetLoaded",
        "keybinding": { "key": "p", "ctrl": true } }
    ],
    "menus": [{ "command": "publisher.csv-profiler.run", "group": "data" }],
    "paletteEntries": [{ "command": "publisher.csv-profiler.run" }]
  },
  "capabilities": ["commands", "transforms"],   // declared, mediated tiers
  "permissions": ["store:read", "store:write:own"],
  "signature": null                      // reserved provenance hook (unenforced in v1)
}
```

**Dual-registration** discipline: declarative metadata loads eagerly to populate palette / AI tool list / MCP `tools/list`; imperative handlers load lazily on first invocation via activation events [5]. This surfaces a plugin's commands *without executing its code* — the safe-by-default posture and the foundation for later isolation.

### The crucial closed-record rule (correctly attributed)

**Do not add fields to `CommandRecord` to support extensions.** Capability is added by composition (`undoable(cmd)`, `palettable(cmd)`), never by growing the record. This is the **closed-metadata-surface principle** from the `acture-command-record-shape` skill (fields cannot be added without three-caller validation) and `redesign_takeaways.md` §1.2 — *not* a numbered hard-don't. (The closed-record rule and hard-don't #1 are kin — both guard against inner-platform creep — but they are distinct provenance.)

### Semver / compat for the host↔extension contract

Pin host compatibility per extension (`apiVersion`/`engines`, caret-style, never wildcard) [3][5]. Versioning posture is **tolerant-reader, asymmetric** [2]: new fields optional; strip-and-accept unknown payload fields, but **reject unknown `kind`/`command` discriminators** (the vocabulary is closed). For breaking changes, add a new `version` literal and run both handlers in parallel. Copy VS Code's **proposed→stable graduation** [2][5]. A CI job diffs the canonical schema against the previous release [5].

---

## 6. IF a user surfaces: the shape `acture-sandbox` would take

This section is a **design, not a build spec.** Nothing here authorizes shipping; it exists so that when the §0 trigger fires, the work is wiring. The TypeScript interfaces below are the durable artifact.

### 6.1 The naming & cohesion decision — reconciling with the mandated `acture-sandbox`

The brief (§7) gates a package the repo **already reserves** as `acture-sandbox` — the deferred, research-gated, post-v1 extension/sandbox package named in `docs/next_session.md` (Option C), `docs/v1_11-reflection.md`, and `docs/v1_13-reflection.md`. **This note keeps that name.** Any earlier draft that crowned a new `acture-extend` as the v1 deliverable was silently renaming the very thing the brief was gating; that is corrected here, and the decision is surfaced explicitly rather than buried.

The real naming question is **not** a beauty contest among `acture-extend` / `acture-plugin-host` / `acture-plugins`. It is: **host/loader layer vs. sandbox/isolation layer — are these one package or two, and which (if any) ships first?** That decision must be made against **hard-don't #2 (no god-package — one accelerator per package)**:

**Recommendation: two single-accelerator packages, and only the second is named `acture-sandbox`.**

1. **The host/loader layer is NOT package territory (§1, §5).** It is a ~10-line core-only hand-write. Shipping a package for it would violate the dev-tool-first test (`positioning.md` §7 #1: "could a developer do this without installing a package?" — yes, trivially) and risks god-packaging if it accretes manifest + lifecycle + contribution helpers. If it ever ships at all, it is a *thin* convenience over core, documented as optional — but the honest call is **it stays a pattern**, like the registry itself.
2. **The isolation layer IS the single accelerator that earns a package — and it is `acture-sandbox`.** This is the one rung that is genuinely hard to hand-write (§1). Its single concern is *isolation*: the `ExtensionRunner` port plus exactly one transport adapter when a user needs it. It does **not** bundle the manifest schema, the contribution model, the effect channel, an entitlement store, and a host all at once — that bundling would itself be the god-package hard-don't #2 forbids.

So: `acture-sandbox` = the deferred isolation package (one accelerator). The host/loader = a core-only pattern (`docs/hand-written-sandbox.md`), not a shipped package. This is the cohesion the brief's translate-not-decide and no-god-package constraints actually demand, and it replaces the earlier draft's single `acture-extend` barrel that bundled four concerns.

### 6.2 Public API (the durable design artifact — TS interfaces)

These interfaces are what makes the eventual build a wiring exercise. They are *design*, not shipped code.

```ts
// --- the contribution unit is core's CommandRecord; manifest is inert data ---
export interface ExtensionManifest {
  readonly id: string;                    // namespaced, globally unique
  readonly name: string;
  readonly version: string;
  readonly apiVersion: string;            // host<->extension semver contract
  readonly engines?: { host: string };
  readonly trust: 'first-party' | 'semi-trusted' | 'untrusted';
  readonly activationEvents?: readonly string[];
  readonly contributes: {
    readonly commands?: readonly ContributedCommand[];
    readonly menus?: readonly MenuContribution[];
    readonly paletteEntries?: readonly PaletteContribution[];
    readonly keybindings?: readonly KeybindingContribution[];
  };
  readonly capabilities?: readonly ('commands' | 'patch' | 'transform')[];
  readonly permissions?: readonly string[];
}

// --- the host: owner-scoped lifecycle is the natural unload primitive ---
export interface ExtensionHost {
  load(manifest: ExtensionManifest, mod: ExtensionModule): Promise<LoadedExtension>;
  unload(id: string): Promise<void>;      // == owner.dispose() for that extension
  installed(): readonly LoadedExtension[];
  onChanged(listener: () => void): Disposable;   // re-emits registry.onCommandsChanged
}

export interface LoadedExtension {
  readonly id: string;
  readonly manifest: ExtensionManifest;
  dispose(): void;                        // unregisters ALL contributions atomically
}

// --- the effect channel: the ONLY place that mutates host state ---
export interface EffectChannel {
  dispatch(effect: EffectEnvelope): Promise<EffectResult<unknown>>;
}

// --- capability grants: declared, revocable, audited (advisory until a membrane) ---
export interface CapabilityGrant {
  readonly name: string;                  // 'store:read', 'http.fetch', ...
  readonly revoke: () => void;            // lives on the owner's Disposable
}

// --- the isolation seam: the ONE accelerator acture-sandbox ships ---
//     a port interface; NO transport adapters shipped until an untrusted user exists ---
export interface ExtensionRunner {
  load(source: ExtensionSource): Promise<LoadedExtension>;
  dispose(id: string): Promise<void>;
}
```

The **owner-scoped `Disposable`** is the spine: every `register*` returns a `Disposable`; an extension groups its registrations under one owner so `owner.dispose()` unregisters everything atomically (`redesign_takeaways.md` §1.5). Surfaces consume `host.onChanged` (re-emitting `registry.onCommandsChanged`) and refresh.

### 6.3 What stays OUT (to honour translate-not-decide — hard-don't #3)

- **Host policy** — no business logic, no command authoring, no architectural choices. Belongs to extension authors and the host.
- **The entitlement store and any install/access gate** — host concerns (§7 below). Documented as a *pattern in the skill*, never shipped as package code. The package translates; it does not decide product architecture (hard-don't #3, `redesign_takeaways.md` §3 line 165).
- **A marketplace / discovery UI / signing pipeline** — explicitly OUT, never coupled to core (§8).
- **Bundling four concerns under one barrel** — manifest + host + effect-channel + capability + runner + activation in one package would be the god-package hard-don't #2 forbids. The single accelerator is *isolation* (the `ExtensionRunner` + one transport).
- **Fields on `CommandRecord`** — capability is composition, never a record field (closed-record principle, §5).

### 6.4 Both flexibility dimensions, first-class (`positioning.md` §3)

**Dimension 1 — core vs strangler-fig.** The host attaches to the same registry whether acture was adopted greenfield or strangled in. No `if (mode === …)` branching (hard-don't #4).

**Dimension 2 — agent-written vs package-reuse.** The host/loader is the ~10-line core-only hand-write of §5 (zero `acture-*` dependency), documented in `docs/hand-written-sandbox.md`. Installing `acture-sandbox` is a deliberate opt-in to reuse a *tested isolation adapter* you'd otherwise have to write correctly yourself — never a default. This is the one surface where "reuse the package" is genuinely compelling (§1), which is exactly why the package is scoped to isolation alone.

### 6.5 Cross-language: TS-primary, no parallel Python package

TypeScript is unambiguously primary. **No parallel Python `acture-sandbox`.** PyPI ships only the thin `acture` MCP client (~300 LoC, `ActureClient` as `Mapping[str, Command]`, one dependency on the official `mcp` SDK — already shipped at v1.13, `docs/v1_13-reflection.md`). If extensions need cross-language reach, it is via the existing MCP boundary: a Python program consuming the TS host's commands through `acture-mcp-server`, JSON-Schema/MCP-mediated — never a shared in-process Python object model. The .NET and PHP skill families confirm the pattern: other languages get skills/patterns and MCP-mediated reach, not a full port.

---

## 7. The separate, opt-in, installable surface — host policy, NOT the package

When a host wants extensions to read as a *separate, opt-in, installable* surface, that is **host product architecture, documented in the skill — not shipped in `acture-sandbox`.** Keeping this out is the translate-not-decide line (hard-don't #3); the package would otherwise read as owning entitlements.

The pattern the skill documents [3], in brief:

- Three distinctions mature platforms keep separate: a **feature flag** (ephemeral rollout), an **entitlement** (durable per-user capability tied to a plan/cohort), and an **install** (user-initiated activation). "Only some users have it, and they must opt in" needs *both* an entitlement and an install action — a bare flag is the wrong primitive. The SSOT is the host's backend entitlement store; the flag tool is an evaluation layer in front of it (OpenFeature-compatible) [3].
- The gate performs two checks mapping to two HTTP outcomes — **403** (not entitled / not in cohort) vs **409** (entitled but not yet installed → "click install"). **The 403-vs-409 distinction is the load-bearing API contract** the frontend uses to drive "install" vs "access denied" UX [3].
- "Feels separate" is architectural, not styling: a bounded contribution slot (no raw DOM), explicit opt-in/consent framing, a namespaced `publisher.name` id, and a user-controlled enable/disable/uninstall lifecycle [3].

**The host implements all of this** — an `EntitlementStore` interface, the gate middleware (enlace-style zero-coupling: the extension app reads `request.state` and never imports the platform [3]). The skill carries the reference sketch; `acture-sandbox` does **not**. This is the §6.3 boundary made concrete.

---

## 8. Anti-patterns & hard don'ts (correctly attributed)

- **Pulling the package forward with no named user.** The single biggest risk for *this* surface. Per `redesign_takeaways.md` §6 and `next_session.md` line 48, stable-and-waiting is a valid outcome; a buildable package is not the default output of research. The output is the design (§0).
- **Inner-platform creep in the manifest.** Metadata carrying conditionals/loops/inheritance is **hard-don't #1, "No conditional logic in command metadata"** (`redesign_takeaways.md` §3 line 163). VS Code when-clauses are the explicit upper bound. *Metadata is data, not code.* Distinct-but-related: the **closed-record principle** (`acture-command-record-shape` skill / §1.2) forbids adding a field to `CommandRecord` to support extensions — capability is composition.
- **`eval()` of LLM- or extension-produced strings.** Everything routes through `dispatch()` and the registry's `Map<string, Command>`; never reflectively call a handler from a provided string — **hard-don't #5** (`redesign_takeaways.md` §3 line 167) and **hard-don't #10** (the LLM's chosen function is not authorization, line 172). The proposer proposes; the registry validates against schema and decides.
- **Leaking host internals as the API.** Exposing a live in-process object whose full surface silently becomes the frozen public contract produces "an unstable API surface that breaks on every internal refactor" [1][5]. Use a command facade and the narrowest waist.
- **Premature sandboxing.** The membrane is a textbook architecture-astronaut trap (`redesign_takeaways.md` §2.6) — adopt the trusted-extension, in-process model and ship the *design* of the membrane, not the membrane. Conversely: admitting *untrusted* code *without* a sandbox is the one irreversible mistake — reach for isolation before the first stranger's code runs [3]. That asymmetry is exactly why the §0 untrusted-author trigger is the GO line for `acture-sandbox`.
- **God-package.** One package = one accelerator (**hard-don't #2**, `redesign_takeaways.md` §3 line 164). `acture-sandbox`'s single accelerator is *isolation*. Bundling manifest + host + effect-channel + entitlements is the exact failure mode to avoid (§6.1, §6.3).
- **Business logic / product policy in the package** (**hard-don't #3**, line 165). The entitlement store, the gate, the Labs surface, the marketplace are host policy (§7) — documented in the skill, never shipped.
- **`if (mode === …)` branching** (**hard-don't #4**, line 166). Greenfield/strangler differences live in surrounding adapters and docs, never in the host.

Additional named don'ts from the reports [1][2][3][4]: granting ambient access instead of declared revocable capabilities; handing untrusted code raw DOM nodes (DOM access ≈ token access); letting extensions mutate shared state directly (Tier 3 raw) and inheriting the distributed-systems problem set; treating the API as "just types" instead of a schema; shipping an unversioned API; no clean teardown (contributions not tied to Disposables); eagerly loading all installed extensions instead of using activation events; treating a Web Worker as a security boundary; `'*'` postMessage `targetOrigin`; designing security around ShadowRealm.

---

## 9. Decision checklist (copy-pasteable)

```
EXTENSION-SYSTEM DECISION CHECKLIST (acture-sandbox is GATED)

GO/NO-GO (answer FIRST — this is the headline)
[ ] Is there a named concrete extension-host / extension-author user? If NO -> NO-GO.
    Ship the design (this note); stay stable-and-waiting (next_session.md:48).
[ ] Trigger to flip to GO: first real host loading code it didn't author.
[ ] Trigger to flip the ISOLATION layer (acture-sandbox proper) to GO:
    first UNTRUSTED author about to run code.

WHICH LAYER ARE YOU IN?
[ ] Host/loader layer = ~10-line core-only hand-write. STAYS A PATTERN. No package.
[ ] Isolation layer = first acture surface that is genuinely PACKAGE territory.
    This (and only this) is acture-sandbox: ExtensionRunner + ONE transport.

TRUST FIRST (the master axis)
[ ] Who writes extensions? first-party | semi-trusted | untrusted
[ ] v1 = trusted, in-process, NO membrane. Sufficient *because* no untrusted authors exist.

CONTRACT SHAPE (the one irreversible decision — lock it now even with no membrane)
[ ] Effects returned AS DATA (command|patch|transform envelope), never performed.
[ ] dispatch async; returns EffectResult {ok,value|error} — never throws across the seam.
[ ] Payloads structured-clone-safe. safeParse EVERY inbound effect, EVEN in-process.

REGISTRY AS EXTENSION POINT
[ ] Extension = bundle of contributions. Contribution unit IS the CommandRecord.
[ ] Do NOT add fields to CommandRecord (closed-record principle, NOT a numbered hard-don't).
[ ] Manifest is INERT data — no conditionals (hard-don't #1).
[ ] Dual registration: metadata eager, handler lazy (activation events).

LIFECYCLE
[ ] Every register* returns a Disposable. Extension groups under ONE owner.
[ ] owner.dispose() = atomic unload. Surfaces consume onCommandsChanged — never poll.

CAPABILITY / QUOTAS
[ ] Default Tier 1; promote to commands (Tier 2 sweet spot) deliberately. Tier 4 = AST->AST.
[ ] In-browser quota posture: isolate the API surface; infinite loop DoSes the tab.
    Real metering needs Node isolated-vm / QuickJS + an Atomics watchdog -> backend tier.

PACKAGING / POSITIONING
[ ] OUT of package: host policy, entitlement store (403/409), marketplace, business logic.
[ ] One accelerator (isolation). No god-package (#2). No mode conditionals (#4).
[ ] Agent-written path documented (docs/hand-written-sandbox.md, zero acture-* dep).
```

---

## REFERENCES

[1] Whalen T. *Designing a Third-Party Extension System for a JS/TS App.* June 2026 (design report).

[2] Whalen T. *The Effect-Mediation Seam: representing extension effects as data.* June 2026 (design report).

[3] Whalen T. *The "Separate, Opt-In, Installable Surface" Product Architecture.* June 2026 (design report).

[4] Whalen T. *Untrusted-Code Isolation in the Browser and Node, as a Migration-Staged Decision.* 9 June 2026 (design report).

[5] Whalen T. *The Command Dispatch Architecture: A Unifying Primitive for Multi-Surface Frontend Applications.* (acture conceptual paper, `docs/command_dispatch_journal_article.md`).

[6] VS Code — [Extension API Overview](https://code.visualstudio.com/api); [Contribution Points](https://code.visualstudio.com/api/references/contribution-points); [Extension Manifest](https://code.visualstudio.com/api/references/extension-manifest); [Extension Host architecture](https://code.visualstudio.com/api/advanced-topics/extension-host); [Activation Events](https://code.visualstudio.com/api/references/activation-events); [When-Clause Contexts](https://code.visualstudio.com/api/references/when-clause-contexts); [Using Proposed API](https://code.visualstudio.com/api/advanced-topics/using-proposed-api).

[7] Chrome — [Extensions (Manifest V3)](https://developer.chrome.com/docs/extensions/develop/concepts); [Declare permissions](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions). MDN — [WebExtensions manifest.json](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json).

[8] Wallace E. — [How We Built the Figma Plugin System](https://www.figma.com/blog/how-we-built-the-figma-plugin-system/); [An update on plugin security](https://www.figma.com/blog/an-update-on-plugin-security/); [How Plugins Run](https://developers.figma.com/docs/plugins/how-plugins-run/).

[9] WordPress Plugin Handbook — [Hooks: Actions and Filters](https://developer.wordpress.org/plugins/hooks/). tapable — [typed hook catalog](https://github.com/webpack/tapable). Fowler M. — [Plugin](https://martinfowler.com/eaaCatalog/plugin.html); [Strangler Fig Application](https://martinfowler.com/bliki/StranglerFigApplication.html).

[10] Obsidian — [Community plugins (Restricted Mode)](https://help.obsidian.md/community-plugins); [community-plugins.json registry shape](https://github.com/obsidianmd/obsidian-releases). Raycast — [Extensions / store review](https://developers.raycast.com/). Slack — [App security & OAuth scopes](https://api.slack.com/authentication/oauth-v2).

[11] Miller M.S. — [Robust Composition (capability security / POLA)](http://www.erights.org/talks/thesis/). Wikipedia — [Capability-based security](https://en.wikipedia.org/wiki/Capability-based_security); [Principle of least privilege](https://en.wikipedia.org/wiki/Principle_of_least_privilege).

[12] [isolated-vm (laverdet)](https://github.com/laverdet/isolated-vm) and [releases](https://github.com/laverdet/isolated-vm/releases); [GitLab Advisory (CachedData escape)](https://advisories.gitlab.com/pkg/npm/isolated-vm/); Temporal — [Intro to isolated-vm](https://temporal.io/blog/intro-to-isolated-vm).

[13] [quickjs-emscripten (justjake)](https://github.com/justjake/quickjs-emscripten); [QuickJS — Bellard](https://bellard.org/quickjs/). [Extism — universal WASM plugin framework](https://github.com/extism/extism); [Extism JS PDK](https://github.com/extism/js-pdk). [WASI Roadmap](https://wasi.dev/roadmap).

[14] TC39 — [proposal-shadowrealm](https://github.com/tc39/proposal-shadowrealm) and [explainer (security non-goals)](https://github.com/tc39/proposal-shadowrealm/blob/main/explainer.md); [Chrome Platform Status](https://chromestatus.com/feature/5638053476433920).

[15] MDN — [Web Workers API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API); [iframe sandbox attribute](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe); [Structured clone algorithm](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm); [Atomics](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Atomics); [Transferable objects](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects). [Comlink (GoogleChromeLabs)](https://github.com/GoogleChromeLabs/comlink). web.dev — [Play safely in sandboxed IFrames](https://web.dev/articles/sandboxed-iframes). OWASP — [HTML5 Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html).

[16] [Hardened JavaScript (SES) — Endo](https://hardenedjs.org/); [ses — npm](https://www.npmjs.com/package/ses); [Endo / ses.endo.systems](https://github.com/endojs/endo).

[17] [Immer — Patches (produceWithPatches, inverse, array-path vs RFC 6902)](https://immerjs.github.io/immer/patches/). [JSON Patch (RFC 6902) vs JSON Merge Patch (RFC 7386)](https://zuplo.com/learning-center/json-patch-vs-json-merge-patch). [prosemirror-transform README (serializable, invertible, mappable steps)](https://github.com/ProseMirror/prosemirror-transform/blob/master/src/README.md). [yjs/yjs (CRDT, UndoManager)](https://github.com/yjs/yjs).

[18] Redux — [Actions FAQ (plain serializable objects, time-travel)](https://redux.js.org/faq/actions); Redux Toolkit — [serializabilityMiddleware](https://redux-toolkit.js.org/api/serializabilityMiddleware). Azure Architecture Center — [CQRS pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs).

[19] [Zod](https://zod.dev/) and [JSON Schema generation](https://zod.dev/json-schema); [Standard Schema](https://standardschema.dev/schema). Mizell S. — [Robustness, Tolerance, and JSON Schema](https://smizell.com/posts/2021/07/robustness-tolerance-and-json-schema/). Cockburn A. — [Hexagonal architecture (ports & adapters)](https://alistair.cockburn.us/hexagonal-architecture).

[20] [Model Context Protocol — Tools Concept](https://modelcontextprotocol.info/docs/concepts/tools/); [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk). [Vercel AI SDK — Tools](https://ai-sdk.dev/docs/foundations/tools).

[21] [react-jsonschema-form (declarative UI from JSON Schema)](https://rjsf-team.github.io/react-jsonschema-form/); [@autoform/zod](https://github.com/vantezzen/autoform); [cmdk](https://cmdk.paco.me/); [tinykeys](https://github.com/jamiebuilds/tinykeys).

[22] Module Federation 2.0 — [Reaches Stable Release (InfoQ, Apr 2026)](https://www.infoq.com/news/2026/04/module-federation-2-stable/); [Import maps — caniuse](https://caniuse.com/import-maps); [single-spa Recommended Setup](https://single-spa.js.org/docs/recommended-setup/).

[23] LaunchDarkly — [Entitlements guide](https://docs.launchdarkly.com/guides/flags/entitlements); RevenueCat — [Feature Flags Using Entitlements](https://www.revenuecat.com/blog/engineering/using-entitlements-for-feature-flags/); [OpenFeature](https://openfeature.dev/). [enlace (i2mint) — mounted-app composition, scope-injection plugins](https://github.com/i2mint/enlace).

[24] Papadimoulis A. — [The Inner Platform Effect](https://thedailywtf.com/articles/the_inner-platform_effect). Metz S. — [The Wrong Abstraction](https://sandimetz.com/blog/2016/1/20/the-wrong-abstraction). Fowler M. — [YAGNI](https://martinfowler.com/bliki/Yagni.html). [npm provenance / Sigstore](https://docs.npmjs.com/generating-provenance-statements). Trend Micro — [Axios NPM Package Compromised (supply-chain provenance)](https://www.trendmicro.com/en_us/research/26/c/axios-npm-package-compromised.html).
