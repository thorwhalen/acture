# Changesets

Hello and welcome! This folder is managed by `@changesets/cli`. Full docs: https://github.com/changesets/changesets.

## Workflow for this repo

Every publishable `acture-*` package versions **independently** — there is no `fixed` or `linked` group (`config.json` has `fixed: []`, `linked: []`). A change to one package bumps only that package; `updateInternalDependencies: "patch"` handles the genuine core↔adapter coupling, and `onlyUpdatePeerDependentsWhenOutOfRange: true` keeps a peer-dep bump from force-majoring every dependent. (This replaced an earlier `fixed`-group setup that caused a spurious suite-wide major cascade — full write-up in `docs/escalations.md`.)

Add a changeset to any non-trivial PR:

```bash
pnpm changeset
```

Pick the packages affected, choose `patch` / `minor` / `major`, and write a one-line description. The resulting `.changeset/*.md` file goes into the PR.

On merge to `main`, the release workflow opens (or updates) a "Version Packages" PR that consumes pending changesets and bumps versions. Merging that PR triggers the npm + PyPI publish.

## Choosing the bump level

The suite is past `v1.0.0`, so standard semver applies — no pre-1.0 quirks:

- `patch` — bug fixes, internal changes, doc-only changes that ship in a package's published files.
- `minor` — new or changed package surface, backward-compatible. The default for a new feature or a new package.
- `major` — a breaking change to a package's public API. Per research-5, note that promoting an `@experimental` surface to `@stable`, or refining a tool *description*, can also be breaking for schema-tracking consumers.

Skills and repo docs that do not ship inside a package need no changeset.
