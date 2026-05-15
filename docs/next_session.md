# Next Session — pick the next increment

**Your role:** choose and ship the next small increment. v1.11 shipped the
first two post-v1 promotions (`acture-telemetry` + `acture-undo`). The
suite now stands at 18 packages, 24 skills, 5 reproducibility docs. The
post-v1 list is shorter; the named backlog is otherwise drained.

## Step 0 — Orient

Read, in this order:

1. `docs/positioning.md` — **canonical.** Dev-tool-first; the two flexibility
   dimensions. Each new `acture-*` artifact must keep both open.
2. `docs/redesign_takeaways.md` §6 — the canonical statement on how acture
   maintainers should think about scope. The rule of three is a *user-
   facing* soft heuristic for application developers; for maintainer
   decisions, the principles are YAGNI / wait for a concrete named need,
   hard-don't #2 (no god-package), architecture-astronaut avoidance, and
   the dev-tool-first principle.
3. `docs/roadmap.md` — "Status snapshot", the v1.11 "Done" entry (where
   you're starting from), "Next", "Deferred / backlog", "Post-v1".
4. `docs/v1_11-reflection.md` — what just shipped and why.
5. `.claude/skills/acture-architecture-primer/SKILL.md` and
   `.claude/skills/acture-hard-donts/SKILL.md` — load before any non-trivial
   change.
6. If the increment touches a consumer surface or a consumer-specific
   package: `.claude/skills/acture-consumer-integration/SKILL.md` (standing
   rule).

## Step 1 — Pick the increment (settle with the user)

The named backlog has only the `.d.ts` tier mirror (explicitly deferred —
no type-level tier consumer) and the per-surface skill for extensions
(no `acture-extensions` package yet). The substantive remaining work
lives in Post-v1; pull-forward needs explicit user direction.

The strongest candidates:

- **Python companion** *(most consequential)* — research-6 spec'd the
  shape: a thin MCP-client facade for `acture-mcp-server` (~300 LoC,
  `dol`/`py2mcp` idiom, on PyPI as `acture` or `acture-client`). Server
  side already ships. Different language, different package ecosystem —
  this is the cross-language story. Bigger lift than v1.11's TS-only
  shipments; opens the door to Python consumers using acture servers.
- **`acture-test-property`** — fast-check arbitraries over command param
  schemas; random `CommandSequence`s replayed via `replaySequence` (from
  `acture-e2e-playwright`'s sequence engine), with invariant assertions.
  Builds *on* the v1.7 sequence layer rather than re-deriving it. Useful
  for property-based command-state testing; smaller than the Python
  companion.
- **`acture-state-jotai` / `acture-state-valtio`** — additional reference
  `StateAdapter<S>` implementations. Smallest increment of the three;
  expands the state-library substrate options the suite ships.
- **`acture-sandbox`** — membrane-pattern third-party extension
  sandboxing. The least specified of the post-v1 items; would need
  research / design before shipping.
- **Stop here** — the suite is at a natural high-water mark. Let real
  usage drive what comes next; come back when there's a concrete pull.

Use `AskUserQuestion` to settle which one. Don't pull a post-v1 item
forward unilaterally; surface the options and the trade-offs honestly.

## Step 2 — Build, per the positioning

Whatever Step 1 picks, the standing constraints hold:

- **Core enables; packages are separate and optional.** A new package
  must be a single accelerator (hard-don't #2), translate rather than
  decide (hard-don't #3), and document the agent-written path
  (`docs/hand-written-*.md`).
- **Hard-don'ts bind.** Re-read the checklist before merging. The
  positioning check (merge-ritual #6) is not optional.
- **YAGNI / concrete consumer.** Don't add infrastructure for
  hypothetical needs. The standard is set: v1.11 declined OTel /
  pino bindings, branched undo, time-travel UI — each will ship when
  a real demand surfaces.

## Step 3 — Wrap up

- `pnpm -r build && pnpm -r test && pnpm -r typecheck` green across the
  workspace; example apps still build + pass.
- Changesets: `minor` for any new or changed package.
- Update `docs/roadmap.md`: mark the increment done, refresh the "Next"
  section and the tracking table.
- Write a short reflection (`docs/v1_12-reflection.md` or similar).
- Replace this file with the next handoff.

## Note — publishing state

18 packages in the workspace. **15 published on npm.** Pending releases:
`acture-e2e-playwright@1.1.0` (queued since v1.7), `acture-telemetry@1.0.0`
(v1.11 debut), `acture-undo@1.0.0` (v1.11 debut). Two pending changesets
this session — `acture-telemetry` and `acture-undo`, both `minor` at debut.
`changeset status` confirms exactly those two, no cascade.

## When unsure

Re-read `docs/positioning.md`, `docs/redesign_takeaways.md` §6, and
`docs/roadmap.md`. If a change is irreversible or you cannot tell whether
it honours the positioning, append to `docs/escalations.md` and ask the
user.

**Good luck.** v1.11 was the suite's first post-v1 promotion. The bar is
set: single accelerators, the agent-written path in `docs/hand-written-*.md`,
the hard-don'ts intact. Whatever the next session ships should hold that
bar.
