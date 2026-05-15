/**
 * `acture-codemods` CLI entry point.
 *
 * Synopsis:
 *
 *   acture-codemods <name> --target <glob> [--dry-run] [--json]
 *                          [--option key=value ...]
 *   acture-codemods --list
 *   acture-codemods --manifest
 *   acture-codemods --help
 *
 * Per research-4 §B.6 the CLI MUST support `--dry-run` and `--json` so
 * agents can read diffs before applying. The runner is conservative: a
 * file that would not change is reported as `skipped: true` rather than
 * silently passing.
 *
 * Glob expansion is intentionally minimal — we accept either an explicit
 * file list or a single directory and walk it with the standard
 * `fs.readdir` recursive option. Hosts that need fancier patterns can
 * pre-expand and pass via `--files-from`.
 */

import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import { runCodemod } from './runner.js';
import { MANIFEST, listShipped } from './manifest.js';
import { formatFileChangeText } from './diff.js';
import type { CodemodResult } from './types.js';

export interface CliIO {
  readonly stdout: (line: string) => void;
  readonly stderr: (line: string) => void;
}

const DEFAULT_IO: CliIO = {
  stdout: (s) => console.log(s),
  stderr: (s) => console.error(s),
};

export async function runCli(argv: readonly string[], io: CliIO = DEFAULT_IO): Promise<number> {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    io.stdout(HELP);
    return 0;
  }
  if (argv[0] === '--list') {
    for (const e of listShipped()) {
      io.stdout(`${e.name.padEnd(34)}  ${e.description}`);
    }
    return 0;
  }
  if (argv[0] === '--manifest') {
    io.stdout(JSON.stringify({ codemods: MANIFEST.map(({ codemod: _c, ...rest }) => rest) }, null, 2));
    return 0;
  }

  const parsed = parseArgs(argv);
  if (parsed.kind === 'error') {
    io.stderr(parsed.message);
    return 2;
  }

  let result: CodemodResult;
  try {
    result = await runCodemod(parsed.name, {
      files: parsed.files,
      dryRun: parsed.dryRun,
      options: parsed.options,
    });
  } catch (e) {
    io.stderr((e as Error).message);
    return 2;
  }

  if (parsed.json) {
    io.stdout(JSON.stringify(result, null, 2));
  } else {
    io.stdout(formatTextResult(result));
  }
  return 0;
}

interface ParsedArgs {
  readonly kind: 'ok';
  readonly name: string;
  readonly files: readonly string[];
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly options: Record<string, string>;
}
interface ParsedError {
  readonly kind: 'error';
  readonly message: string;
}

function parseArgs(argv: readonly string[]): ParsedArgs | ParsedError {
  const [name, ...rest] = argv;
  if (!name || name.startsWith('--')) {
    return { kind: 'error', message: 'Missing codemod name.\n\n' + HELP };
  }
  let dryRun = false;
  let json = false;
  const targets: string[] = [];
  const filesFrom: string[] = [];
  const options: Record<string, string> = {};

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--json') json = true;
    else if (arg === '--target') {
      const value = rest[++i];
      if (!value) return { kind: 'error', message: '--target needs a path' };
      targets.push(value);
    } else if (arg === '--files-from') {
      const value = rest[++i];
      if (!value) return { kind: 'error', message: '--files-from needs a file' };
      filesFrom.push(value);
    } else if (arg === '--option') {
      const kv = rest[++i];
      if (!kv) return { kind: 'error', message: '--option needs key=value' };
      const eq = kv.indexOf('=');
      if (eq < 0) return { kind: 'error', message: `--option must be key=value: ${kv}` };
      options[kv.slice(0, eq)] = kv.slice(eq + 1);
    } else {
      return { kind: 'error', message: `Unknown argument: ${arg}` };
    }
  }

  const collected = collectFiles(targets, filesFrom);
  if (collected.kind === 'error') {
    return { kind: 'error', message: collected.message };
  }
  return { kind: 'ok', name, files: collected.files, dryRun, json, options };
}

type CollectResult =
  | { readonly kind: 'ok'; readonly files: string[] }
  | { readonly kind: 'error'; readonly message: string };

/**
 * Expand `--target` / `--files-from` into a sorted file list. The three
 * "nothing to do" outcomes are kept distinct so the user knows which one
 * they hit (the v1.4 fresh-agent test flagged the old single message as
 * ambiguous):
 *   1. no `--target` / `--files-from` given at all,
 *   2. a `--target` / `--files-from` path that does not exist (likely a typo),
 *   3. paths that exist but contain no `.ts` / `.tsx` / `.jsx` files.
 */
function collectFiles(targets: readonly string[], filesFrom: readonly string[]): CollectResult {
  if (targets.length === 0 && filesFrom.length === 0) {
    return {
      kind: 'error',
      message: 'No --target or --files-from given. Use --target <path> or --files-from <list>.',
    };
  }
  const out = new Set<string>();
  const missing: string[] = [];
  for (const t of targets) {
    const abs = isAbsolute(t) ? t : resolve(process.cwd(), t);
    if (!existsSync(abs)) {
      missing.push(t);
      continue;
    }
    walk(abs, out);
  }
  for (const list of filesFrom) {
    const abs = isAbsolute(list) ? list : resolve(process.cwd(), list);
    if (!existsSync(abs)) {
      missing.push(list);
      continue;
    }
    const lines = readFileSync(abs, 'utf-8').split('\n').map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      const p = isAbsolute(line) ? line : resolve(process.cwd(), line);
      out.add(p);
    }
  }
  if (missing.length > 0) {
    const noun = missing.length > 1 ? 'paths do' : 'path does';
    return { kind: 'error', message: `Target ${noun} not exist: ${missing.join(', ')}` };
  }
  if (out.size === 0) {
    const where = [...targets, ...filesFrom].join(', ');
    return {
      kind: 'error',
      message: `No .ts / .tsx / .jsx files found under: ${where}`,
    };
  }
  return { kind: 'ok', files: [...out].sort() };
}

function walk(path: string, out: Set<string>): void {
  let stat;
  try {
    stat = statSync(path);
  } catch {
    return;
  }
  if (stat.isFile()) {
    if (isCandidateFile(path)) out.add(path);
    return;
  }
  if (!stat.isDirectory()) return;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    walk(join(path, entry.name), out);
  }
}

function isCandidateFile(path: string): boolean {
  return path.endsWith('.ts') || path.endsWith('.tsx') || path.endsWith('.jsx');
}

function formatTextResult(result: CodemodResult): string {
  const lines: string[] = [];
  lines.push(`Codemod: ${result.codemod} (v${result.version})`);
  lines.push(
    `Files: ${result.summary.total}  Changed: ${result.summary.changed}  Skipped: ${result.summary.skipped}`,
  );
  lines.push('');
  for (const f of result.files) {
    lines.push(formatFileChangeText(f));
    if (f.notes && f.notes.length > 0) {
      for (const n of f.notes) lines.push(`! ${n}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

const HELP = `acture-codemods — codemods for strangler-fig adoption of acture

Usage:
  acture-codemods <name> --target <path> [--dry-run] [--json] [--option key=value]
  acture-codemods --list
  acture-codemods --manifest
  acture-codemods --help

Arguments:
  <name>                Codemod name (from --list).
  --target <path>       A file or a directory to walk. May be repeated.
  --files-from <file>   Read a newline-delimited list of files. May be repeated.
  --dry-run             Compute changes without writing files.
  --json                Output a machine-readable JSON result.
  --option key=value    Pass a per-codemod option. May be repeated.
                        Per-codemod keys are listed in the README.

Modes (use instead of <name>):
  --list                Print the shipped codemod catalog (human-readable).
  --manifest            Print the catalog as JSON, for tooling.
  --help, -h            Print this help.

Exit codes:
  0  success (including --list / --manifest / --help)
  2  usage error, unknown codemod, or no files matched

Examples:
  acture-codemods wrap-handler-with-mutation --target src/ --dry-run --json
  acture-codemods extract-onclick-to-command --target src/Button.tsx \\
                  --option id-prefix=app.button
`;

// Direct execution path (bin entry).
if (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (import.meta as any).url === `file://${process.argv[1]}` ||
  (typeof process !== 'undefined' && process.argv[1]?.endsWith('cli.js'))
) {
  const argv = process.argv.slice(2);
  runCli(argv).then((code) => process.exit(code));
}
