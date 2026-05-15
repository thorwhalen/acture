# acture-codemods

> **acture is a development tool first.** This is dev/build-time tooling — it never becomes a runtime dependency of the apps it serves, and using it is entirely optional. See [`docs/positioning.md`](../../docs/positioning.md).

Codemod CLI for adopting acture in an existing TypeScript/React codebase. Single `npx`-invokable runner with a manifest of shipped transforms.

Research-4 §B.5 plans five codemods; all five ship.

## Quick start

`acture-codemods` is published on npm, so `npx` fetches it on first use — every command below runs as-is:

```bash
# List shipped codemods
npx acture-codemods --list

# Dry-run on a directory, emit JSON for an agent to read
npx acture-codemods wrap-handler-with-mutation \
    --target src/ --dry-run --json

# Apply for real
npx acture-codemods wrap-handler-with-mutation --target src/
```

**Running from a clone (contributors / monorepo dev):** there is no published-package step — build once and invoke the CLI entry directly:

```bash
pnpm --filter acture-codemods build
node packages/codemods/dist/cli.js --list
```

## Shipped codemods

| Codemod | Since | What it does |
| --- | --- | --- |
| `wrap-handler-with-mutation` | 1.0.0 | Wraps `onClick` / `onChange` / `onSubmit` handler expressions with `wrapMutation(...)`. Adds the import if missing. Idempotent. |
| `extract-onclick-to-command` | 1.0.0 | Lifts inline arrow handlers into module-level `defineCommand` calls. Replaces the JSX with a `registry.dispatch` reference. Conservative — skips handlers with parameters. |
| `redux-action-to-command` | 1.1.0 | Convert `dispatch({type, payload})` call sites to `registry.dispatch(id, payload)`. Skips non-literal types and action objects with extra keys. Optional slash→dot id rewrite. |
| `usestate-mutation-to-command` | 1.1.0 | Wraps inline handlers whose body is composed of `setX(...)` setter calls with `wrapMutation`, deriving a command id from the setter name. Configurable setter pattern. |
| `rtk-thunk-to-command` | 1.1.0 | Convert `createAsyncThunk(id, payloadCreator)` into `defineCommand({id, title, execute})`. Rewrites `return X` to `return ok(X)`. Skips thunks with an options arg. |

## CLI

```text
acture-codemods <name> --target <path> [--target <path> ...]
                       [--files-from <file>] [--dry-run] [--json]
                       [--option key=value ...]
acture-codemods --list
acture-codemods --manifest
acture-codemods --help
```

| Flag | Meaning |
| --- | --- |
| `<name>` | Codemod name — one of the values from `--list`. |
| `--target <path>` | A file or a directory to walk (recursively; skips `.`-prefixed dirs, `node_modules`, `dist`). May be repeated. Candidate files are `.ts` / `.tsx` / `.jsx`. |
| `--files-from <file>` | Read a newline-delimited list of files to operate on. May be repeated. Combine with or use instead of `--target`. |
| `--dry-run` | Compute the changes without writing files — returns the diff the codemod *would* produce (research-4 §B.6 requirement). |
| `--json` | Emit a machine-readable `CodemodResult` (per-file `before` / `after` / `changed` / `notes` + a summary). Without it, output is a readable plain-text diff. |
| `--option key=value` | Pass a per-codemod option. May be repeated. Keys are listed under [Codemod options](#codemod-options). |
| `--list` | Print the shipped codemod catalog, human-readable. |
| `--manifest` | Print the catalog as JSON (`{ codemods: [...] }`) — the machine-readable counterpart of `--list`, for tooling that needs name / status / `since` programmatically. |
| `--help` | Print usage. |

**Exit codes:** `0` on success (including `--list` / `--manifest` / `--help`); `2` on a usage error, an unknown codemod name, a `--target` that does not exist, or a target that matched no source files.

Two paths for agents driving codemods:

```bash
# Iterate dry-run → review → apply
acture-codemods <name> --target <dir> --dry-run --json | jq ...
acture-codemods <name> --target <dir> --json
```

## Codemod options

Every codemod runs with sensible defaults; `--option key=value` overrides them. Keys are per-codemod — the same key (`--option events=...`) is read only by the codemods that document it below. Unknown keys are ignored.

### `wrap-handler-with-mutation`

| Option | Default | Meaning |
| --- | --- | --- |
| `events` | `onClick,onChange,onSubmit` | Comma-separated JSX attribute names to wrap. |
| `import-from` | `acture-migration` | Module to import the wrap function from. |
| `import-name` | `wrapMutation` | Name of the imported wrap function. |

### `extract-onclick-to-command`

| Option | Default | Meaning |
| --- | --- | --- |
| `id-prefix` | `app.wrapped` | Prefix for generated command ids (`<id-prefix>.<verb>`). |
| `registry-import` | `./acture/registry` | Module to import the `registry` symbol from. |
| `acture-import` | `acture` | Module to import `defineCommand` and `ok` from. |

### `redux-action-to-command`

| Option | Default | Meaning |
| --- | --- | --- |
| `callees` | `dispatch` | Comma-separated list of dispatch-like callee names to rewrite (e.g. `dispatch,storeDispatch`). |
| `registry-import` | `./acture/registry` | Module to import `{ registry }` from. |
| `id-rewrite` | `keep` | `keep` leaves the action `type` string as-is; `dot` rewrites slash ids to dotted (`cart/addItem` → `app.cart.addItem`). |

### `usestate-mutation-to-command`

| Option | Default | Meaning |
| --- | --- | --- |
| `id-prefix` | `app.state` | Prefix for generated command ids (`<id-prefix>.<setterName>`). |
| `setter-pattern` | `^set[A-Z]` | Regex identifying setter identifiers — override for non-`setX` conventions. |
| `events` | `onClick,onChange,onSubmit` | Comma-separated JSX attribute names to consider. |
| `import-from` | `acture-migration` | Module to import `wrapMutation` from. |

### `rtk-thunk-to-command`

| Option | Default | Meaning |
| --- | --- | --- |
| `acture-import` | `acture` | Module to import `defineCommand` and `ok` from. |
| `title-from` | `id-last-segment` | `id-last-segment` derives the title from the last id segment; `id` uses the whole id verbatim. |

## Programmatic API

```ts
import { runCodemod } from 'acture-codemods';

const result = await runCodemod('wrap-handler-with-mutation', {
  files: ['src/Button.tsx', 'src/Form.tsx'],
  dryRun: true,
  options: { events: 'onClick,onSubmit' },
});

for (const f of result.files) {
  if (f.changed) console.log(f.path, '\n', f.after);
}
```

`runCodemod` takes an explicit `files` list (the CLI is what expands `--target` / `--files-from` into one). `options` is the same per-codemod key/value bag the CLI's `--option` populates.

## Design principles

1. **Conservative.** When in doubt, skip the file. The 100% successful rewrite that touches 60% of files is worth more than the 80% successful rewrite that touches all of them. (Research-4 §B.6.)
2. **Single tool — ts-morph.** Research-4 §B.2 compares jscodeshift, ts-morph, ast-grep, and semgrep. We picked ts-morph because: TypeScript-aware API surface, pure-JS dependency, and AST manipulation that maps cleanly to the kinds of transforms acture needs.
3. **`--dry-run` and `--json` are mandatory** on every codemod. Agents preview, then apply.
4. **No global config.** Codemod options come from `--option key=value` on the CLI or the `options` field of `runCodemod`. The package itself has zero runtime config files.

## When a codemod doesn't fit your handler shape

The five shipped codemods cover the common structural patterns. For a handler shape that matches none of them, you don't need to wait for a sixth codemod to ship — see [`docs/ai-codemod-recipe.md`](../../docs/ai-codemod-recipe.md) for how to have an agent author a one-off `Codemod` against the same interface, runnable through `runCodemod` or droppable into this package.

## Hard-don'ts

- **No business logic.** Codemods translate code to code. They do not decide which commands are right, when to migrate, or how to author the spec — those are user decisions.
- **No "smart" rewrites that need type info we can't get.** When the transform would need to read a generic parameter or infer a return type, we skip and emit a note. (Research-4 §B.2: ts-morph has type info, but every codemod we ship documents which path it uses — purely structural vs. type-aware.)
- **No surprise installs.** The codemods write code that imports `acture` / `acture-migration`. They do NOT run `npm install` or modify `package.json`. The user installs deps themselves.

## See also

- `docs/research/acture_research_4 -- Transitional APIs and Codemod Tooling…` §B.5, §B.6
- [`docs/ai-codemod-recipe.md`](../../docs/ai-codemod-recipe.md) — authoring a one-off codemod for a shape the shipped five don't cover
- `acture-migration` for the runtime-only adoption surface (`wrapMutation`, `actureMiddleware`, `createDomInterceptor`, …)
- `.claude/skills/migration-wrap/SKILL.md` for the agent workflow that drives these codemods
