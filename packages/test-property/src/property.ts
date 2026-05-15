/**
 * `acture-test-property` — the property runner.
 *
 * `propertyTest` glues together three pieces that already exist:
 *
 *   1. `sequenceArbitrary(registry, opts)` — a `CommandSequence`
 *      generator (this package).
 *   2. `replaySequence(registry, seq)` — the v1.7 sequence engine
 *      from `acture-e2e-playwright`.
 *   3. fast-check's `fc.assert(fc.asyncProperty(...))` — the property
 *      runner.
 *
 * Invariants run **end-of-sequence** (after the last step). End-of-
 * sequence is simpler than per-step and matches `replayTest`'s shape:
 * a failing command step throws (with the offending sequence attached
 * to `error.sequence`), every invariant inspects the same final state.
 *
 * On a counter-example, the thrown error carries the shrunk failing
 * sequence on its `.sequence` property — the user can replay it
 * deterministically via `replaySequence` to reproduce the failure.
 */

import * as fc from 'fast-check';
import type { Context, Registry, StateAdapter } from 'acture';
import { replaySequence, type CommandSequence } from 'acture-e2e-playwright';
import {
  sequenceArbitrary,
  type SequenceArbitraryOptions,
} from './arbitraries.js';

/** A single named invariant — the predicate runs after the whole
 *  sequence has replayed. */
export interface Invariant<S> {
  readonly name: string;
  readonly check: (state: S) => boolean;
}

export interface PropertyTestOptions<S> {
  readonly registry: Registry;
  /** The state adapter the registry mutates. `state = adapter.getState()`
   *  before each invariant. */
  readonly adapter: StateAdapter<S>;
  /** Invariants checked at the end of each generated sequence. */
  readonly invariants: readonly Invariant<S>[];
  /** Number of random sequences to run. Default: `100`. */
  readonly runs?: number;
  /** Sequence length bounds. Default: `{ min: 1, max: 10 }`. */
  readonly sequenceLength?: SequenceArbitraryOptions['length'];
  /** Restrict to these tiers. Default: `['stable']`. */
  readonly tiers?: SequenceArbitraryOptions['tiers'];
  /** Override the Zod-to-arbitrary mapper. */
  readonly schemaToArbitrary?: SequenceArbitraryOptions['schemaToArbitrary'];
  /** Context passed to every dispatch in replay. */
  readonly ctx?: Context;
  /** Reset the state before each sequence runs. The default is
   *  `() => adapter.setState(() => initial)` for a captured `initial`
   *  snapshot taken at the start of `propertyTest`. */
  readonly resetState?: () => void;
  /** Seed for the fast-check runner — pass through for reproducibility. */
  readonly seed?: number;
}

/** The error thrown by `propertyTest` on an invariant failure or a
 *  failing dispatch. Carries the (shrunk) sequence that triggered it
 *  so callers can `replaySequence(registry, err.sequence)`. */
export class PropertyTestFailure extends Error {
  public override readonly name = 'PropertyTestFailure';
  public readonly sequence: CommandSequence;
  public readonly invariantName?: string;

  constructor(
    message: string,
    sequence: CommandSequence,
    invariantName?: string,
  ) {
    super(message);
    this.sequence = sequence;
    this.invariantName = invariantName;
  }
}

/**
 * Run `runs` random sequences through `registry`. Every generated
 * sequence is replayed; after the last step, every invariant runs
 * against `adapter.getState()`. A failing invariant fails the
 * property; fast-check shrinks the sequence, and the final shrunk
 * sequence is attached to the thrown `PropertyTestFailure`.
 *
 * **What this does NOT do:**
 *   - Per-step invariant checking (deliberate — pick one and document).
 *   - State capture/restore by copy (deliberate — we use the host's
 *     reset hook, which is identity-preserving for adapters).
 *   - HTML reports, Jest matchers, CI integration (out of scope —
 *     they would be a god-package, hard-don't #2).
 */
export async function propertyTest<S>(
  options: PropertyTestOptions<S>,
): Promise<void> {
  const {
    registry,
    adapter,
    invariants,
    runs = 100,
    sequenceLength = { min: 1, max: 10 },
    tiers,
    schemaToArbitrary,
    ctx,
    seed,
  } = options;

  const initialState = snapshot(adapter.getState());
  const reset =
    options.resetState ??
    (() => adapter.setState(() => snapshot(initialState) as S));

  const seqArb = sequenceArbitrary(registry, {
    length: sequenceLength,
    tiers,
    schemaToArbitrary,
  });

  let failure: PropertyTestFailure | null = null;

  try {
    await fc.assert(
      fc.asyncProperty(seqArb, async (sequence: CommandSequence) => {
        reset();
        const replay = await replaySequence(registry, sequence, {
          ctx,
          stopOnError: false,
        });
        // A failing dispatch is treated as a property failure too —
        // the user's invariants assume the sequence ran to completion.
        // Errors-as-data are still preserved on `replay.results`.
        if (!replay.ok) {
          const firstFail = replay.results.find((r) => !r.result.ok);
          const msg =
            firstFail && !firstFail.result.ok
              ? `dispatch failed: ${firstFail.step.commandId} → ${firstFail.result.error.code}: ${firstFail.result.error.message}`
              : 'dispatch failed';
          failure = new PropertyTestFailure(msg, sequence);
          return false;
        }
        const state = adapter.getState();
        for (const inv of invariants) {
          if (!inv.check(state)) {
            failure = new PropertyTestFailure(
              `invariant "${inv.name}" violated`,
              sequence,
              inv.name,
            );
            return false;
          }
        }
        return true;
      }),
      { numRuns: runs, seed },
    );
  } catch (e) {
    // fast-check throws on counter-example. Re-throw our richer error
    // if we have one (it carries the shrunk sequence + invariant name);
    // otherwise re-throw the original.
    if (failure !== null) throw failure;
    throw e;
  }
}

/** Cheap structured clone for the initial-state snapshot. State
 *  shapes here are JSON-serializable per acture's state-model
 *  constraint, so `JSON.parse(JSON.stringify(...))` is correct and
 *  doesn't drag in `structuredClone` (Node ≥17, browsers vary). */
function snapshot<T>(state: T): T {
  if (state === undefined || state === null) return state;
  if (typeof state !== 'object') return state;
  return JSON.parse(JSON.stringify(state)) as T;
}
