/**
 * `acture-test-property` — arbitraries over the command registry.
 *
 * Three public functions:
 *
 *   - `zodToArbitrary(schema)` — map a Zod schema (subset) to a
 *     `fast-check.Arbitrary`. Covers the JSON-Schema-representable
 *     subset that acture's `toJsonSchema` projection already handles:
 *     `z.string`, `z.number`, `z.boolean`, `z.enum`, `z.literal`,
 *     `z.array`, `z.object`, `z.union`, `z.optional`, `z.nullable`.
 *     Throws a clear error on unsupported types — silent skipping
 *     would mean a "valid" sequence the user can't reproduce.
 *
 *   - `commandArbitrary(registry, opts)` — generates a single
 *     `{ commandId, params }` pair where `commandId` is drawn from the
 *     registry (filtered by `tiers`) and `params` is generated from
 *     that command's Zod schema.
 *
 *   - `sequenceArbitrary(registry, opts)` — generates a random
 *     `CommandSequence` of length in `[min, max]`.
 *
 * The mapper is deliberately small — research-6's "the Zod subset
 * acture commits to" is the same subset every consumer surface
 * (palette, MCP, AI) sees. This package speaks the same subset.
 */

import * as fc from 'fast-check';
import type {
  AnyCommandRecord,
  ParamSchema,
  Registry,
  Tier,
} from 'acture';
import type { CommandSequence, SequenceStep } from 'acture-e2e-playwright';

/** Options for `commandArbitrary` / `sequenceArbitrary`. */
export interface CommandArbitraryOptions {
  /** Restrict to these tiers. Default: `['stable']`. */
  readonly tiers?: readonly Tier[];
  /** Override the schema-to-arbitrary mapper (e.g. to extend the
   *  supported Zod subset). Default: `zodToArbitrary`. */
  readonly schemaToArbitrary?: (schema: unknown) => fc.Arbitrary<unknown>;
}

export interface SequenceArbitraryOptions extends CommandArbitraryOptions {
  /** Sequence length bounds. Default: `{ min: 1, max: 10 }`. */
  readonly length?: { readonly min: number; readonly max: number };
}

/** Thrown by `zodToArbitrary` when a schema uses a Zod construct the
 *  in-package mapper doesn't cover. Callers handle this by passing
 *  their own `schemaToArbitrary` or by adjusting the command schema. */
export class UnsupportedZodTypeError extends Error {
  constructor(public readonly zodType: string) {
    super(
      `acture-test-property: Zod type "${zodType}" is not arbitrary-able by the in-package mapper. Pass a custom \`schemaToArbitrary\` to commandArbitrary/sequenceArbitrary, or constrain the command's params to the supported subset (string, number, boolean, enum, literal, array, object, union, optional, nullable).`,
    );
    this.name = 'UnsupportedZodTypeError';
  }
}

/* ── Zod → fast-check arbitrary ──────────────────────────────────────── */

/**
 * Walk a Zod schema and return a `fast-check.Arbitrary` that produces
 * values matching it. Covers the JSON-Schema-representable subset; any
 * other Zod construct throws `UnsupportedZodTypeError`.
 *
 * The mapper reads Zod's internal `_def` tag — Zod 3/4 both expose this.
 * `def.type` is the discriminator in Zod 4 (`'string'`, `'number'`,
 * `'object'`, …); Zod 3 uses `def.typeName` (`'ZodString'`,
 * `'ZodObject'`, …). We probe both, so a project on either version
 * gets a working mapping.
 */
export function zodToArbitrary(schema: unknown): fc.Arbitrary<unknown> {
  const tag = readZodTag(schema);
  if (tag === null) {
    throw new UnsupportedZodTypeError('(unknown — not a Zod schema)');
  }
  switch (tag) {
    case 'string':
      return fc.string();
    case 'number':
      return fc.double({ noNaN: true, noDefaultInfinity: true });
    case 'boolean':
      return fc.boolean();
    case 'literal': {
      const value = readLiteralValue(schema);
      return fc.constant(value);
    }
    case 'enum': {
      const values = readEnumValues(schema);
      if (values.length === 0) {
        throw new UnsupportedZodTypeError('enum (no values)');
      }
      return fc.constantFrom(...values);
    }
    case 'array': {
      const element = readArrayElement(schema);
      return fc.array(zodToArbitrary(element), { minLength: 0, maxLength: 5 });
    }
    case 'object': {
      const shape = readObjectShape(schema);
      const record: Record<string, fc.Arbitrary<unknown>> = {};
      for (const [key, child] of Object.entries(shape)) {
        record[key] = zodToArbitrary(child);
      }
      return fc.record(record);
    }
    case 'union': {
      const options = readUnionOptions(schema);
      if (options.length === 0) {
        throw new UnsupportedZodTypeError('union (no options)');
      }
      return fc.oneof(...options.map((o) => zodToArbitrary(o)));
    }
    case 'optional': {
      const inner = readWrappedInner(schema);
      return fc.option(zodToArbitrary(inner), { nil: undefined });
    }
    case 'nullable': {
      const inner = readWrappedInner(schema);
      return fc.option(zodToArbitrary(inner), { nil: null });
    }
    default:
      throw new UnsupportedZodTypeError(tag);
  }
}

/* ── Registry-level arbitraries ──────────────────────────────────────── */

/**
 * Generate one `{ commandId, params }` pair. Equivalent to picking a
 * random command from `registry.list({ tiers })` and generating params
 * from its schema. Commands without params produce `{ commandId }` only.
 */
export function commandArbitrary(
  registry: Registry,
  options: CommandArbitraryOptions = {},
): fc.Arbitrary<SequenceStep> {
  const commands = pickCommands(registry, options);
  if (commands.length === 0) {
    throw new Error(
      'acture-test-property: registry has no commands matching the tier filter — cannot build an arbitrary. Register at least one command or widen `tiers`.',
    );
  }
  const map = options.schemaToArbitrary ?? zodToArbitrary;
  return fc
    .constantFrom(...commands)
    .chain((cmd: AnyCommandRecord): fc.Arbitrary<SequenceStep> => {
      if (cmd.params === undefined) {
        return fc.constant({ commandId: cmd.id } as SequenceStep);
      }
      return map(cmd.params as ParamSchema<unknown>).map(
        (params: unknown): SequenceStep => ({ commandId: cmd.id, params }),
      );
    });
}

/**
 * Generate a random `CommandSequence` of length in `[min, max]`.
 * The default bounds (`{ min: 1, max: 10 }`) match the docstring shape
 * promised in `docs/next_session.md`.
 */
export function sequenceArbitrary(
  registry: Registry,
  options: SequenceArbitraryOptions = {},
): fc.Arbitrary<CommandSequence> {
  const { min, max } = options.length ?? { min: 1, max: 10 };
  if (min < 0 || max < min) {
    throw new Error(
      `acture-test-property: invalid sequence length bounds { min: ${min}, max: ${max} } — require 0 <= min <= max.`,
    );
  }
  return fc.array(commandArbitrary(registry, options), {
    minLength: min,
    maxLength: max,
  });
}

/* ── Helpers ─────────────────────────────────────────────────────────── */

function pickCommands(
  registry: Registry,
  options: CommandArbitraryOptions,
): readonly AnyCommandRecord[] {
  const tiers = options.tiers ?? ['stable'];
  return registry.list({ tiers });
}

interface MaybeZodDef {
  readonly _def?: {
    readonly type?: string;
    readonly typeName?: string;
    readonly value?: unknown;
    readonly values?: readonly unknown[];
    readonly entries?: Record<string, unknown>;
    readonly element?: unknown;
    readonly type_?: unknown;
    readonly shape?: Record<string, unknown> | (() => Record<string, unknown>);
    readonly options?: readonly unknown[];
    readonly innerType?: unknown;
  };
  readonly _zod?: {
    readonly def?: MaybeZodDef['_def'];
  };
  /** Zod 4 sometimes hangs `shape` directly off the object too. */
  readonly shape?: Record<string, unknown>;
}

function readDef(schema: unknown): NonNullable<MaybeZodDef['_def']> | null {
  const s = schema as MaybeZodDef;
  if (s?._def) return s._def;
  if (s?._zod?.def) return s._zod.def;
  return null;
}

/** Returns the lowercase Zod tag — `string`, `number`, `object`, …, or
 *  `null` if the value is not a Zod schema we recognise. Probes both
 *  Zod 3 (`typeName: 'ZodString'`) and Zod 4 (`type: 'string'`). */
function readZodTag(schema: unknown): string | null {
  const def = readDef(schema);
  if (!def) return null;
  if (typeof def.type === 'string') return def.type;
  if (typeof def.typeName === 'string') {
    // 'ZodString' → 'string', 'ZodObject' → 'object'
    return def.typeName.replace(/^Zod/, '').toLowerCase();
  }
  return null;
}

function readLiteralValue(schema: unknown): unknown {
  const def = readDef(schema)!;
  if ('value' in def) return def.value;
  // Zod 4: literals are stored as a values array (supports multi-literals).
  if (Array.isArray(def.values) && def.values.length > 0) {
    return def.values[0];
  }
  throw new UnsupportedZodTypeError('literal (no value field)');
}

function readEnumValues(schema: unknown): readonly unknown[] {
  const def = readDef(schema)!;
  if (Array.isArray(def.values)) return def.values;
  if (def.entries && typeof def.entries === 'object') {
    return Object.values(def.entries);
  }
  return [];
}

function readArrayElement(schema: unknown): unknown {
  const def = readDef(schema)!;
  // Zod 3: `type` on the def; Zod 4: `element`.
  return def.element ?? def.type_ ?? (def as Record<string, unknown>)['type'];
}

function readObjectShape(schema: unknown): Record<string, unknown> {
  const s = schema as MaybeZodDef;
  if (s.shape && typeof s.shape === 'object') return s.shape;
  const def = readDef(schema)!;
  const shape = def.shape;
  if (typeof shape === 'function') return shape();
  if (shape && typeof shape === 'object') return shape;
  throw new UnsupportedZodTypeError('object (no shape)');
}

function readUnionOptions(schema: unknown): readonly unknown[] {
  const def = readDef(schema)!;
  return def.options ?? [];
}

function readWrappedInner(schema: unknown): unknown {
  const def = readDef(schema)!;
  return def.innerType;
}
