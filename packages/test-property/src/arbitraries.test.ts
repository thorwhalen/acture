import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { z } from 'zod';
import { createRegistry, defineCommand, ok } from 'acture';
import {
  zodToArbitrary,
  commandArbitrary,
  sequenceArbitrary,
  UnsupportedZodTypeError,
} from './arbitraries.js';

const SAMPLE = 20;
function samples<T>(arb: fc.Arbitrary<T>, n = SAMPLE): T[] {
  return fc.sample(arb, n);
}

describe('zodToArbitrary — primitives', () => {
  it('z.string → strings', () => {
    const arb = zodToArbitrary(z.string());
    expect(samples(arb).every((v) => typeof v === 'string')).toBe(true);
  });

  it('z.number → finite numbers (no NaN, no Infinity)', () => {
    const arb = zodToArbitrary(z.number());
    expect(
      samples(arb).every(
        (v) => typeof v === 'number' && !Number.isNaN(v) && Number.isFinite(v),
      ),
    ).toBe(true);
  });

  it('z.boolean → booleans', () => {
    const arb = zodToArbitrary(z.boolean());
    expect(samples(arb).every((v) => typeof v === 'boolean')).toBe(true);
  });
});

describe('zodToArbitrary — literal / enum', () => {
  it('z.literal("foo") → only that value', () => {
    const arb = zodToArbitrary(z.literal('foo'));
    expect(samples(arb).every((v) => v === 'foo')).toBe(true);
  });

  it('z.enum([a, b, c]) → one of the values', () => {
    const arb = zodToArbitrary(z.enum(['a', 'b', 'c']));
    const out = samples(arb);
    expect(out.every((v) => ['a', 'b', 'c'].includes(v as string))).toBe(true);
  });
});

describe('zodToArbitrary — composite', () => {
  it('z.array(z.number()) → array of numbers, max length respected', () => {
    const arb = zodToArbitrary(z.array(z.number()));
    const out = samples(arb);
    for (const v of out) {
      expect(Array.isArray(v)).toBe(true);
      expect((v as unknown[]).every((x) => typeof x === 'number')).toBe(true);
      expect((v as unknown[]).length).toBeLessThanOrEqual(5);
    }
  });

  it('z.object({...}) → object with all keys present', () => {
    const arb = zodToArbitrary(
      z.object({ name: z.string(), age: z.number() }),
    );
    const out = samples(arb);
    for (const v of out) {
      const r = v as Record<string, unknown>;
      expect(typeof r.name).toBe('string');
      expect(typeof r.age).toBe('number');
    }
  });

  it('z.union([z.string(), z.number()]) → string or number', () => {
    const arb = zodToArbitrary(z.union([z.string(), z.number()]));
    const out = samples(arb);
    expect(
      out.every((v) => typeof v === 'string' || typeof v === 'number'),
    ).toBe(true);
  });

  it('z.optional(z.string()) → string or undefined', () => {
    const arb = zodToArbitrary(z.optional(z.string()));
    const out = samples(arb, 50);
    expect(
      out.every((v) => v === undefined || typeof v === 'string'),
    ).toBe(true);
  });

  it('z.nullable(z.string()) → string or null', () => {
    const arb = zodToArbitrary(z.nullable(z.string()));
    const out = samples(arb, 50);
    expect(out.every((v) => v === null || typeof v === 'string')).toBe(true);
  });
});

describe('zodToArbitrary — unsupported', () => {
  it('throws UnsupportedZodTypeError with a clear message on z.date()', () => {
    expect(() => zodToArbitrary(z.date())).toThrow(UnsupportedZodTypeError);
  });

  it('throws on a non-Zod value', () => {
    expect(() => zodToArbitrary({} as unknown)).toThrow(
      UnsupportedZodTypeError,
    );
  });
});

describe('zodToArbitrary — generated values pass the original schema', () => {
  // The whole point of the mapper: any value the arbitrary generates
  // must be accepted by the source Zod schema. Validates the mapping
  // end-to-end for the supported subset.
  it('object with array of unions of (string | number | enum)', () => {
    const schema = z.object({
      tags: z.array(z.union([z.string(), z.number(), z.enum(['hot', 'cold'])])),
      flag: z.boolean(),
      kind: z.literal('event'),
    });
    const arb = zodToArbitrary(schema);
    for (const v of samples(arb, 50)) {
      const r = schema.safeParse(v);
      expect(r.success).toBe(true);
    }
  });
});

/* ── Registry-level arbitraries ──────────────────────────────────────── */

function makeRegistry() {
  const registry = createRegistry();
  registry.registerAll([
    defineCommand({
      id: 'app.noop',
      title: 'No-op',
      execute: () => ok(null),
    }),
    defineCommand({
      id: 'app.set',
      title: 'Set count',
      params: z.object({ value: z.number() }),
      execute: ({ value }) => ok(value),
    }),
    defineCommand({
      id: 'app.lab',
      title: 'Experimental',
      tier: 'experimental',
      execute: () => ok(null),
    }),
  ]);
  return registry;
}

describe('commandArbitrary', () => {
  it('only returns ids the registry knows (stable tier default)', () => {
    const registry = makeRegistry();
    const arb = commandArbitrary(registry);
    const known = new Set(registry.list({ tiers: ['stable'] }).map((c) => c.id));
    for (const step of samples(arb, 50)) {
      expect(known.has(step.commandId)).toBe(true);
    }
  });

  it('respects the tiers filter (experimental only)', () => {
    const registry = makeRegistry();
    const arb = commandArbitrary(registry, { tiers: ['experimental'] });
    for (const step of samples(arb, 30)) {
      expect(step.commandId).toBe('app.lab');
    }
  });

  it('emits params that validate against the command schema', () => {
    const registry = makeRegistry();
    const arb = commandArbitrary(registry);
    for (const step of samples(arb, 50)) {
      const cmd = registry.get(step.commandId);
      expect(cmd).toBeDefined();
      if (cmd?.params) {
        const ok = (cmd.params as { safeParse: (v: unknown) => { success: boolean } }).safeParse(step.params);
        expect(ok.success).toBe(true);
      } else {
        expect(step.params).toBeUndefined();
      }
    }
  });

  it('throws clearly when no commands match the filter', () => {
    const registry = createRegistry();
    expect(() => commandArbitrary(registry)).toThrow(/no commands/);
  });
});

describe('sequenceArbitrary', () => {
  it('respects length.min and length.max', () => {
    const registry = makeRegistry();
    const arb = sequenceArbitrary(registry, { length: { min: 2, max: 4 } });
    for (const seq of samples(arb, 30)) {
      expect(seq.length).toBeGreaterThanOrEqual(2);
      expect(seq.length).toBeLessThanOrEqual(4);
    }
  });

  it('default length bounds produce sequences of [1, 10]', () => {
    const registry = makeRegistry();
    const arb = sequenceArbitrary(registry);
    for (const seq of samples(arb, 30)) {
      expect(seq.length).toBeGreaterThanOrEqual(1);
      expect(seq.length).toBeLessThanOrEqual(10);
    }
  });

  it('throws on invalid bounds (max < min)', () => {
    const registry = makeRegistry();
    expect(() =>
      sequenceArbitrary(registry, { length: { min: 5, max: 3 } }),
    ).toThrow(/invalid sequence length/);
  });
});
