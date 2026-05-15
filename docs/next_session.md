# Next Session — pick the next increment

**Your role:** choose and ship the next small increment. v1.10 closed the
last two named-backlog items surfaced by research-6 (the `.describe()` lint
rule and the MCP spec-version pin). The named backlog is now down to **two
deferred items with explicit deferral rationales** and the post-v1 list. Your
first job is to settle Step 1 with the user — and the substantive option this
time is whether to pull a post-v1 item forward.

## Step 0 — Orient

Read, in this order:

1. `docs/positioning.md` — **canonical.** Dev-tool-first; the two flexibility
   dimensions. Everything you ship must keep both open.
2. `docs/roadmap.md` — "Status snapshot", the v1.10 "Done" entry, "Next",
   "Deferred / backlog", and "Post-v1".
3. `docs/v1_10-reflection.md` — what just shipped and why (note especially the
   plugin-location decision: a second rule in an existing plugin beats a
   god-package-of-one new plugin under the rule of three).
4. `.claude/skills/acture-architecture-primer/SKILL.md` and
   `.claude/skills/acture-hard-donts/SKILL.md` — load before any non-trivial
   change.
5. If the increment touches a consumer surface or a consumer-specific package:
   `.claude/skills/acture-consumer-integration/SKILL.md` (standing rule).

## Step 1 — Pick the increment (settle with the user)

The named backlog has two remaining items, both with explicit *deferral*
rationales (waiting for callers, not unscheduled work):

- **Per-surface consumer skills — telemetry / undo / extensions** — no
  shipping packages; the skills would be agent-written-path-only. Lower
  consistency with the existing six per-surface consumer skills. Revisit
  when/if those packages exist.
- **`.d.ts` tier mirror** — explicitly declined in v1.9 (zero type-level tier
  consumers, rule-of-three gated). Rationale documented in the
  `acture-build-tier` README.

The substantive option is **pulling a post-v1 item forward**. Per the
"Post-v1" section of the roadmap, none of these ship without explicit user
direction *and* three concrete callers. Surface them to the user; do not
pull one forward unilaterally:

- **Python companion** — research-6 spec'd a thin MCP-client facade (~300 LoC,
  `dol`/`py2mcp` idiom). Server side already ships as `acture-mcp-server`.
  Unblocked but rule-of-three gated. The user has ~200 local Python projects;
  the "three callers" gate is the user's call.
- **`acture-undo`** — patch-based undo. `Result<R>` already reserves
  `patches?` and `effects?`; `PatchCapableAdapter` is implemented by both
  state adapters. The shape is well understood; the gate is callers.
- **`acture-telemetry`** — middleware logging every dispatch. Smallest of
  the post-v1 items.

Use `AskUserQuestion`. The session before this one explicitly compared
the post-v1 options and the user picked the disciplined "smaller items"
path — repeat that pattern; don't assume.

## Step 2 — Build, per the positioning

Whatever Step 1 picks, the standing constraints hold:

- **Core enables; packages are separate and optional.** A new post-v1
  package must be a single accelerator (no god-package — see the v1.10
  plugin-location decision), translate rather than decide, and document the
  agent-written path. If the increment is more skills, follow the
  v1.8/v1.9 template.
- **Hard-don'ts bind.** Re-read the checklist before merging. The positioning
  check (merge-ritual #6) is not optional.
- **Rule of three.** Don't add a package, a field, or a feature without three
  concrete callers. The last four increments have all explicitly invoked this
  to *decline* speculative work — `.d.ts` tier mirror, `acture-sequence`,
  greenfield/telemetry-without-package skills, and a one-rule new plugin. The
  standard is set.

## Step 3 — Wrap up

- `pnpm -r build && pnpm -r test && pnpm -r typecheck` green across the
  workspace; example apps still build + pass.
- Changesets: `minor` for a new package or a new feature on an existing
  package; `patch` for internal hygiene / bug fixes. Skills + docs alone need
  no changeset.
- Update `docs/roadmap.md`: mark the increment done, record what was built and
  any decisions, refresh the "Next" section and the tracking table.
- Write a short reflection (`docs/v1_11-reflection.md` or similar — keep it short).
- Replace this file with the handoff for whatever the roadmap says is next.

## Note — publishing state

16 packages in the workspace. **15 published on npm:**
`acture-codemods@1.2.0` is now live (v1.9 publish, 2026-05-15);
`acture-e2e-playwright` still ships with the next release.

**Two pending changesets** to be consumed on the next `changeset version`:
- `.changeset/eslint-require-param-describe.md` — `eslint-plugin-acture-migration` `minor` (new `acture/require-param-describe` rule).
- `.changeset/mcp-pin-spec-version.md` — `acture-mcp-server` `patch` (internal hygiene test).

`changeset status` confirms exactly that — no cascade, no surprise majors.
`changeset version` is safe to run.

## When unsure

Re-read `docs/positioning.md` and `docs/roadmap.md`. If a change is irreversible
or you cannot tell whether it honours the positioning, append to
`docs/escalations.md` and ask the user.

**Good luck.** The named backlog is genuinely thin; this session's real choice
is whether to pull a post-v1 item forward. Don't make that call unilaterally —
surface it, name the rule-of-three gate, and let the user decide. Otherwise pick
a bounded skill/doc/hygiene increment and ship it clean.
