import { describe, it } from 'vitest';
import { RuleTester } from 'eslint';
import { requireParamDescribe } from './require-param-describe.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

ruleTester.run('require-param-describe', requireParamDescribe, {
  valid: [
    // `.describe` directly on the field's value.
    `import { defineCommand } from 'acture';
     import { z } from 'zod';
     defineCommand({
       id: 'app.foo',
       title: 'Foo',
       params: z.object({ x: z.string().describe('the x') }),
       execute: () => ({ ok: true, value: undefined }),
     });`,

    // `.describe` later in the chain (after refinements).
    `import { defineCommand } from 'acture';
     import { z } from 'zod';
     defineCommand({
       id: 'app.foo',
       params: z.object({ x: z.string().min(1).describe('the x') }),
       execute: () => ({ ok: true, value: undefined }),
     });`,

    // `.describe` early in the chain, refinement after.
    `import { defineCommand } from 'acture';
     import { z } from 'zod';
     defineCommand({
       id: 'app.foo',
       params: z.object({ x: z.string().describe('the x').min(1) }),
       execute: () => ({ ok: true, value: undefined }),
     });`,

    // Multiple fields, all described.
    `import { defineCommand } from 'acture';
     import { z } from 'zod';
     defineCommand({
       id: 'app.foo',
       params: z.object({
         x: z.number().describe('x coord'),
         y: z.number().describe('y coord'),
       }),
       execute: () => ({ ok: true, value: undefined }),
     });`,

    // No `params` at all — parameter-free command.
    `import { defineCommand } from 'acture';
     defineCommand({
       id: 'app.foo',
       title: 'Foo',
       execute: () => ({ ok: true, value: undefined }),
     });`,

    // `params` comes from a variable — too complex to inspect, stay quiet.
    `import { defineCommand } from 'acture';
     import { z } from 'zod';
     const schema = z.object({ x: z.string() });
     defineCommand({
       id: 'app.foo',
       params: schema,
       execute: () => ({ ok: true, value: undefined }),
     });`,

    // `defineCommand` not imported from acture — not ours.
    `import { defineCommand } from './local-define';
     import { z } from 'zod';
     defineCommand({
       id: 'app.foo',
       params: z.object({ x: z.string() }),
       execute: () => ({ ok: true, value: undefined }),
     });`,

    // `z` not imported from zod — could be any other library.
    `import { defineCommand } from 'acture';
     import { z } from './my-types';
     defineCommand({
       id: 'app.foo',
       params: z.object({ x: z.string() }),
       execute: () => ({ ok: true, value: undefined }),
     });`,

    // `defineCommand` is imported, but the spec isn't an object literal — skip.
    `import { defineCommand } from 'acture';
     const spec = makeSpec();
     defineCommand(spec);`,

    // `params` value isn't a `z.object(...)` call — skip (could be discriminatedUnion etc.).
    `import { defineCommand } from 'acture';
     import { z } from 'zod';
     defineCommand({
       id: 'app.foo',
       params: z.discriminatedUnion('kind', []),
       execute: () => ({ ok: true, value: undefined }),
     });`,

    // Namespace import of Zod is also recognized.
    `import { defineCommand } from 'acture';
     import * as z from 'zod';
     defineCommand({
       id: 'app.foo',
       params: z.object({ x: z.string().describe('hi') }),
       execute: () => ({ ok: true, value: undefined }),
     });`,

    // Custom modules configured — uses the configured names, doesn't fire elsewhere.
    {
      code: `import { defineCommand } from 'acture';
             import { z } from 'zod';
             defineCommand({
               id: 'app.foo',
               params: z.object({ x: z.string() }),
               execute: () => ({ ok: true, value: undefined }),
             });`,
      options: [{ actureModule: '@myorg/acture-shim' }],
    },
  ],

  invalid: [
    // Single bare field — reports once.
    {
      code: `import { defineCommand } from 'acture';
             import { z } from 'zod';
             defineCommand({
               id: 'app.foo',
               params: z.object({ x: z.string() }),
               execute: () => ({ ok: true, value: undefined }),
             });`,
      errors: [{ messageId: 'missingDescribe', data: { field: 'x' } }],
    },

    // Refined but undescribed — `.min(1)` doesn't carry to JSON Schema's `description`.
    {
      code: `import { defineCommand } from 'acture';
             import { z } from 'zod';
             defineCommand({
               id: 'app.foo',
               params: z.object({ y: z.string().min(1).max(40) }),
               execute: () => ({ ok: true, value: undefined }),
             });`,
      errors: [{ messageId: 'missingDescribe', data: { field: 'y' } }],
    },

    // Two missing, one described — only two reports.
    {
      code: `import { defineCommand } from 'acture';
             import { z } from 'zod';
             defineCommand({
               id: 'app.foo',
               params: z.object({
                 x: z.number(),
                 y: z.number().describe('y coord'),
                 label: z.string(),
               }),
               execute: () => ({ ok: true, value: undefined }),
             });`,
      errors: [
        { messageId: 'missingDescribe', data: { field: 'x' } },
        { messageId: 'missingDescribe', data: { field: 'label' } },
      ],
    },

    // Aliased imports both work.
    {
      code: `import { defineCommand as dc } from 'acture';
             import { z as Z } from 'zod';
             dc({
               id: 'app.foo',
               params: Z.object({ x: Z.string() }),
               execute: () => ({ ok: true, value: undefined }),
             });`,
      errors: [{ messageId: 'missingDescribe', data: { field: 'x' } }],
    },

    // Quoted-string keys work too (string-literal property names).
    {
      code: `import { defineCommand } from 'acture';
             import { z } from 'zod';
             defineCommand({
               id: 'app.foo',
               params: z.object({ 'my-key': z.string() }),
               execute: () => ({ ok: true, value: undefined }),
             });`,
      errors: [{ messageId: 'missingDescribe', data: { field: 'my-key' } }],
    },

    // Custom acture module — fires when configured to match a re-export.
    {
      code: `import { defineCommand } from '@myorg/acture-shim';
             import { z } from 'zod';
             defineCommand({
               id: 'app.foo',
               params: z.object({ x: z.string() }),
               execute: () => ({ ok: true, value: undefined }),
             });`,
      options: [{ actureModule: '@myorg/acture-shim' }],
      errors: [{ messageId: 'missingDescribe', data: { field: 'x' } }],
    },

    // Nested z.object — the rule fires on the OUTER object's top-level
    // fields. The inner `{ a: z.string() }` is not inspected (conservative
    // — nested checks are a future enhancement). Here `nested` itself has
    // no `.describe`, so it reports on `nested`.
    {
      code: `import { defineCommand } from 'acture';
             import { z } from 'zod';
             defineCommand({
               id: 'app.foo',
               params: z.object({
                 nested: z.object({ a: z.string() }),
               }),
               execute: () => ({ ok: true, value: undefined }),
             });`,
      errors: [{ messageId: 'missingDescribe', data: { field: 'nested' } }],
    },
  ],
});
