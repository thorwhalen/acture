/**
 * `eslint-plugin-acture-migration`
 *
 * ESLint rules for acture — published under the `acture/` prefix. The
 * package keeps its historical `-migration` suffix (renaming an
 * already-published package is breaking for consumers), but its scope is
 * broader: it hosts both migration-specific rules and schema-quality
 * rules that apply to any acture codebase.
 *
 * Rules:
 *   - `acture/no-stale-wrap-mutation` — migration: catch a graduated
 *     strangler-fig wrapper that still carries its `wrapMutation`
 *     scaffolding.
 *   - `acture/require-param-describe` — schema quality: require a
 *     `.describe(...)` on each top-level field of `defineCommand`'s
 *     `params: z.object({...})` schema, so the projection to JSON Schema
 *     carries a `description` for MCP / AI / form consumers.
 *
 * Flat-config usage (ESLint 9+):
 *
 *   import acture from 'eslint-plugin-acture-migration';
 *
 *   export default [
 *     {
 *       plugins: { acture },
 *       rules: {
 *         'acture/no-stale-wrap-mutation': 'warn',
 *         'acture/require-param-describe': 'warn',
 *       },
 *     },
 *   ];
 *
 * Or pull in the bundled config:
 *
 *   import acture from 'eslint-plugin-acture-migration';
 *   export default [acture.configs.recommended];
 */

import type { ESLint, Linter } from 'eslint';
import { noStaleWrapMutation } from './rules/no-stale-wrap-mutation.js';
import { requireParamDescribe } from './rules/require-param-describe.js';

const rules = {
  'no-stale-wrap-mutation': noStaleWrapMutation,
  'require-param-describe': requireParamDescribe,
} satisfies ESLint.Plugin['rules'];

const plugin: ESLint.Plugin = {
  meta: {
    name: 'eslint-plugin-acture-migration',
    version: '1.1.0',
  },
  rules,
};

const recommended: Linter.Config = {
  plugins: { acture: plugin },
  rules: {
    'acture/no-stale-wrap-mutation': 'warn',
    'acture/require-param-describe': 'warn',
  },
};

plugin.configs = { recommended };

export default plugin;
export { rules, noStaleWrapMutation, requireParamDescribe };
