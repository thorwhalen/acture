import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createRegistry, defineCommand, err, ok } from 'acture';
import type { PatchCapableAdapter, Registry } from 'acture';
import { createZustandAdapter } from 'acture-state-zustand';
import { createReduxAdapter } from 'acture-state-redux';
import { propertyTest, PropertyTestFailure } from './property.js';

/** Build a counter registry that's exercised by every property test:
 *  inc / dec / reset / set. Wires straight through the adapter. */
function buildCounter(adapter: PatchCapableAdapter<{ count: number }>) {
  const registry = createRegistry();
  registry.registerAll([
    defineCommand({
      id: 'app.count.inc',
      title: 'Increment',
      execute: () => {
        adapter.setState((s) => ({ count: s.count + 1 }));
        return ok(adapter.getState().count);
      },
    }),
    defineCommand({
      id: 'app.count.dec',
      title: 'Decrement',
      execute: () => {
        adapter.setState((s) => ({ count: s.count - 1 }));
        return ok(adapter.getState().count);
      },
    }),
    defineCommand({
      id: 'app.count.reset',
      title: 'Reset',
      execute: () => {
        adapter.setState(() => ({ count: 0 }));
        return ok(0);
      },
    }),
    defineCommand({
      id: 'app.count.set',
      title: 'Set',
      params: z.object({ value: z.number() }),
      execute: ({ value }) => {
        adapter.setState(() => ({ count: value }));
        return ok(value);
      },
    }),
  ]);
  return registry;
}

describe('propertyTest — happy path', () => {
  it('runs `runs` random sequences and passes if no invariant fails', async () => {
    const adapter = createZustandAdapter<{ count: number }>({
      initialState: { count: 0 },
    });
    const registry = buildCounter(adapter);
    await expect(
      propertyTest({
        registry,
        adapter,
        invariants: [
          {
            name: 'count is always a finite number',
            check: (s) => Number.isFinite(s.count),
          },
        ],
        runs: 10,
        sequenceLength: { min: 1, max: 5 },
      }),
    ).resolves.toBeUndefined();
  });
});

describe('propertyTest — counter-example', () => {
  it('throws PropertyTestFailure with sequence attached when an invariant fails', async () => {
    // Invariant designed to fail: with inc/dec available, count can go
    // negative — but the invariant insists it doesn't.
    const adapter = createZustandAdapter<{ count: number }>({
      initialState: { count: 0 },
    });
    const registry = buildCounter(adapter);
    let caught: PropertyTestFailure | null = null;
    try {
      await propertyTest({
        registry,
        adapter,
        invariants: [
          {
            name: 'count never negative',
            check: (s) => s.count >= 0,
          },
        ],
        runs: 100,
        sequenceLength: { min: 1, max: 5 },
      });
    } catch (e) {
      if (e instanceof PropertyTestFailure) caught = e;
    }
    expect(caught).not.toBeNull();
    expect(caught!.invariantName).toBe('count never negative');
    expect(Array.isArray(caught!.sequence)).toBe(true);
    expect(caught!.sequence.length).toBeGreaterThan(0);
  });

  it('shrinks the failing sequence — typically to a single decrement', async () => {
    const adapter = createZustandAdapter<{ count: number }>({
      initialState: { count: 0 },
    });
    const registry = buildCounter(adapter);
    let caught: PropertyTestFailure | null = null;
    try {
      await propertyTest({
        registry,
        adapter,
        invariants: [
          { name: 'count never negative', check: (s) => s.count >= 0 },
        ],
        runs: 100,
        sequenceLength: { min: 1, max: 10 },
        // Use a fixed seed so the shrink result is stable across runs.
        seed: 42,
      });
    } catch (e) {
      if (e instanceof PropertyTestFailure) caught = e;
    }
    expect(caught).not.toBeNull();
    // After shrinking, the shortest failing sequence is one dec from zero.
    expect(caught!.sequence.length).toBeLessThanOrEqual(3);
    expect(
      caught!.sequence.some((s) => s.commandId === 'app.count.dec'),
    ).toBe(true);
  });
});

describe('propertyTest — replay determinism', () => {
  it('the attached sequence reproduces the failure when replayed', async () => {
    const adapter = createZustandAdapter<{ count: number }>({
      initialState: { count: 0 },
    });
    const registry = buildCounter(adapter);
    let caught: PropertyTestFailure | null = null;
    try {
      await propertyTest({
        registry,
        adapter,
        invariants: [
          { name: 'count never negative', check: (s) => s.count >= 0 },
        ],
        runs: 100,
        sequenceLength: { min: 1, max: 10 },
        seed: 42,
      });
    } catch (e) {
      if (e instanceof PropertyTestFailure) caught = e;
    }
    expect(caught).not.toBeNull();

    // Reset and replay the shrunk sequence — the invariant must fail again.
    adapter.setState(() => ({ count: 0 }));
    for (const step of caught!.sequence) {
      await registry.dispatch(step.commandId, step.params);
    }
    expect(adapter.getState().count).toBeLessThan(0);
  });
});

describe('propertyTest — dispatch failure as property failure', () => {
  it('treats a failing dispatch as a property failure with the sequence attached', async () => {
    const adapter = createZustandAdapter<{ count: number }>({
      initialState: { count: 0 },
    });
    const registry = buildCounter(adapter);
    registry.register(
      defineCommand({
        id: 'app.always.fail',
        title: 'Always fails',
        execute: () => err('boom', 'always fails'),
      }),
    );
    let caught: PropertyTestFailure | null = null;
    try {
      await propertyTest({
        registry,
        adapter,
        invariants: [{ name: 'truthy', check: () => true }],
        runs: 30,
        sequenceLength: { min: 1, max: 3 },
      });
    } catch (e) {
      if (e instanceof PropertyTestFailure) caught = e;
    }
    expect(caught).not.toBeNull();
    expect(caught!.message).toMatch(/dispatch failed/);
    expect(caught!.sequence.some((s) => s.commandId === 'app.always.fail')).toBe(
      true,
    );
  });
});

describe('propertyTest — adapter coverage', () => {
  /** A small generator: build the same counter setup against each
   *  adapter. Both adapters implement `PatchCapableAdapter<S>` so the
   *  test body is identical. */
  function adapterCases(): Array<{
    name: string;
    make: () => { adapter: PatchCapableAdapter<{ count: number }>; registry: Registry };
  }> {
    return [
      {
        name: 'zustand',
        make: () => {
          const adapter = createZustandAdapter<{ count: number }>({
            initialState: { count: 0 },
          });
          return { adapter, registry: buildCounter(adapter) };
        },
      },
      {
        name: 'redux',
        make: () => {
          const adapter = createReduxAdapter<{ count: number }>({
            initialState: { count: 0 },
          });
          return { adapter, registry: buildCounter(adapter) };
        },
      },
    ];
  }

  for (const { name, make } of adapterCases()) {
    it(`runs against ${name} adapter`, async () => {
      const { adapter, registry } = make();
      await expect(
        propertyTest({
          registry,
          adapter,
          invariants: [
            {
              name: 'count is finite',
              check: (s) => Number.isFinite(s.count),
            },
          ],
          runs: 10,
          sequenceLength: { min: 1, max: 5 },
        }),
      ).resolves.toBeUndefined();
    });
  }
});

describe('propertyTest — state reset', () => {
  it('uses adapter.setState by default to reset state between sequences', async () => {
    const adapter = createZustandAdapter<{ count: number }>({
      initialState: { count: 0 },
    });
    const registry = buildCounter(adapter);
    // Inc-only registry would always drive count up; if we did not
    // reset between runs, the invariant `count <= sequenceLength` would
    // hold for the first run and then fail forever after. The default
    // reset must put us back at 0 each time.
    await expect(
      propertyTest({
        registry: incOnly(adapter),
        adapter,
        invariants: [
          { name: 'count <= 5', check: (s) => s.count <= 5 },
        ],
        runs: 20,
        sequenceLength: { min: 0, max: 5 },
      }),
    ).resolves.toBeUndefined();
  });

  it('honours a custom resetState hook', async () => {
    const adapter = createZustandAdapter<{ count: number }>({
      initialState: { count: 100 },
    });
    const registry = buildCounter(adapter);
    let resets = 0;
    await propertyTest({
      registry,
      adapter,
      invariants: [
        { name: 'count is finite', check: (s) => Number.isFinite(s.count) },
      ],
      runs: 5,
      sequenceLength: { min: 0, max: 2 },
      resetState: () => {
        resets++;
        adapter.setState(() => ({ count: 100 }));
      },
    });
    expect(resets).toBe(5);
  });
});

function incOnly(adapter: PatchCapableAdapter<{ count: number }>): Registry {
  const registry = createRegistry();
  registry.register(
    defineCommand({
      id: 'app.count.inc',
      title: 'Increment',
      execute: () => {
        adapter.setState((s) => ({ count: s.count + 1 }));
        return ok(adapter.getState().count);
      },
    }),
  );
  return registry;
}
