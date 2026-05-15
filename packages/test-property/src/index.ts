/**
 * `acture-test-property` — fast-check arbitraries over the command
 * registry; random `CommandSequence`s replayed via
 * `acture-e2e-playwright`'s `replaySequence`, with invariants asserted
 * end-of-sequence.
 *
 * Surface:
 *
 *     import {
 *       propertyTest,
 *       commandArbitrary,
 *       sequenceArbitrary,
 *       zodToArbitrary,
 *     } from 'acture-test-property';
 *
 *     await propertyTest({
 *       registry,
 *       adapter,
 *       invariants: [
 *         { name: 'count never negative', check: (s) => s.count >= 0 },
 *       ],
 *       runs: 100,
 *       sequenceLength: { min: 1, max: 20 },
 *     });
 *
 * On a counter-example the thrown `PropertyTestFailure` carries the
 * shrunk failing sequence on `.sequence` so the caller can replay it
 * deterministically with `replaySequence(registry, err.sequence)`.
 *
 * Positioning: this package is an *optional accelerator*. An agent can
 * hand-write the equivalent into the target project — see the
 * `acture-test-property` skill and `docs/hand-written-test-property.md`.
 * Installing this package is a deliberate, opt-in choice. See
 * `docs/positioning.md`.
 */

export {
  zodToArbitrary,
  commandArbitrary,
  sequenceArbitrary,
  UnsupportedZodTypeError,
} from './arbitraries.js';
export type {
  CommandArbitraryOptions,
  SequenceArbitraryOptions,
} from './arbitraries.js';

export { propertyTest, PropertyTestFailure } from './property.js';
export type { Invariant, PropertyTestOptions } from './property.js';
