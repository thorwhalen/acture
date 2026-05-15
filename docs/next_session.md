# Next Session — pick the next increment

**Your role:** choose and ship the next small increment. v1.9 closed the
codemods/tier backlog file and added the greenfield agent-track sub-skills, so
the named backlog is now thin. Your first job is to pick, with the user, what
the increment is — and this time the honest options include *pulling a post-v1
item forward*.

## Step 0 — Orient

Read, in this order:

1. `docs/positioning.md` — **canonical.** Dev-tool-first; the two flexibility
   dimensions. Everything you ship must keep both open.
2. `docs/roadmap.md` — "Status snapshot", the v1.9 "Done" entry (where you're
   starting from), "Next", "Deferred / backlog", and "Post-v1".
3. `docs/v1_9-reflection.md` — what just shipped and why (note especially the
   `.d.ts`-mirror *decline* — a rule-of-three call worth understanding).
4. `.claude/skills/acture-architecture-primer/SKILL.md` and
   `.claude/skills/acture-hard-donts/SKILL.md` — load before any non-trivial
   change.
5. If the increment touches a consumer surface or a consumer-specific package:
   `.claude/skills/acture-consumer-integration/SKILL.md` (standing rule).

## Step 1 — Pick the increment (settle with the user)

The named "Deferred / backlog" is now nearly drained — that is the headline of
this handoff. The candidates, with the trade-offs:

- **Pull a post-v1 item forward** *(the most substantive option)* — the roadmap's
  "Post-v1" section has items that are spec'd and no longer research-blocked.
  The **Python companion** is the standout: research-6 is done, the shape is
  tight (a ~300-LoC thin MCP-client facade, `acture` or `acture-client` on
  PyPI), and the server side already ships as `acture-mcp-server`. `acture-undo`
  and `acture-telemetry` are also spec'd. **The gate is the rule of three** —
  none ship without explicit user direction *and* three concrete callers.
  Surface this to the user; do not pull one forward unilaterally.
- **Telemetry / undo / extensions consumer skills** — the last per-surface
  consumer-skill gap. But these surfaces have *no shipping packages*, so the
  skills would be agent-written-path-only — thinner and less consistent than the
  palette/macros/e2e/hotkeys/mcp/ai set. Reasonable, but lower value until the
  packages exist (which loops back to the post-v1 option).
- **Deeper greenfield or migration agent-track skills** — only if practice has
  surfaced a concrete gap. The greenfield track is now foundation + two
  sub-skills; the migration track is five skills. Don't add speculatively.
- **Smaller backlog items** — the research-6 follow-ups: a `.describe()`
  schema-quality lint rule, pinning the MCP spec version in CI. Both concrete,
  both small.

Use `AskUserQuestion` to settle which one. Given the named backlog is thin,
this is a real fork — the last four sessions' explicit scope decisions all paid
off, and this one matters more than usual.

## Step 2 — Build, per the positioning

Whatever Step 1 picks, the standing constraints hold:

- **Core enables; packages are separate and optional.** If the increment is a
  new package: it must be a single accelerator (no god-package), translate
  rather than decide, and document the agent-written path. If it is skills:
  follow the v1.8/v1.9 template — agent-written path, tool-library choice as the
  user's, `acture-*` package as the opt-in accelerator.
- **Hard-don'ts bind.** Re-read the checklist before merging. The positioning
  check (merge-ritual #6) is not optional.
- **Rule of three.** Don't add a package, a field, or a feature without three
  concrete callers. v1.9 declined the `.d.ts` tier mirror on exactly this
  ground — that is the standard to hold.

## Step 3 — Wrap up

- `pnpm -r build && pnpm -r test && pnpm -r typecheck` green across the
  workspace; example apps still build + pass.
- Changesets: `minor` for any new or changed package. (Skills + docs alone need
  no changeset.)
- Update `docs/roadmap.md`: mark the increment done, record what was built and
  any decisions, refresh the "Next" section and the tracking table.
- Write a short reflection (`docs/v1_10-reflection.md` or similar — keep it short).
- Replace this file with the handoff for whatever the roadmap says is next.

## Note — publishing state

16 packages in the workspace. 15 are published on npm; **`acture-e2e-playwright`**
(v1.7) ships with the next release. **One pending changeset:**
`.changeset/codemods-cli-polish.md` — `acture-codemods` `minor` (the v1.9 CLI
polish). `changeset status` confirms it bumps `acture-codemods` only, no
cascade; `changeset version` is safe to run.

(The v1.6/v1.7 changesets that earlier handoffs listed as "pending" were already
consumed and published by PR #14 — `chore(release): bump versions`. `acture` is
at `1.2.0` on npm, `acture-codemods` at `1.1.0`. The release math is correct;
`fixed`/`linked` groups are empty — every package versions independently. Full
write-up: `docs/escalations.md`; the mechanics: `.changeset/README.md`.)

## When unsure

Re-read `docs/positioning.md` and `docs/roadmap.md`. If a change is irreversible
or you cannot tell whether it honours the positioning, append to
`docs/escalations.md` and ask the user.

**Good luck.** The named backlog is nearly drained — Step 1 is a real decision
this session. Pull a post-v1 item forward only with user direction and three
callers; otherwise pick a bounded skill/doc increment and ship it clean.
