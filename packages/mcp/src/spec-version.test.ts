/**
 * Hygiene test: pin the MCP protocol-spec version this package is built
 * against. The MCP spec is date-versioned (`LATEST_PROTOCOL_VERSION` in
 * `@modelcontextprotocol/sdk`), and the spec/transport story has churned
 * historically (SSE → streamable HTTP). Per the project's standing
 * decision, a protocol-version upgrade is treated as **semver-major** for
 * `acture-mcp-server` — so when the SDK ships a new `LATEST_PROTOCOL_VERSION`,
 * a refresh of `acture-mcp-server` is a deliberate, reviewed step rather
 * than an accidental pickup.
 *
 * If this test fails after an SDK bump:
 *
 *   1. Read the SDK's release notes for the new protocol date.
 *   2. Verify `acture-mcp-server` still passes its full test suite against
 *      the new SDK; specifically that `tools/list_changed` notifications
 *      and `tools/call` envelopes still work end-to-end.
 *   3. If yes, update `EXPECTED_PROTOCOL_VERSION` below AND bump
 *      `acture-mcp-server` as a **major** release in a changeset.
 *   4. If anything broke, hold the SDK at the prior minor and file an
 *      upgrade ticket.
 *
 * The expected value lives here (not in source) so a bump of the package
 * version is a deliberate, reviewable diff in this file rather than a
 * silent transitive-dep change.
 */

import { describe, it, expect } from 'vitest';
import {
  LATEST_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
} from '@modelcontextprotocol/sdk/types.js';

/** Protocol-spec date `acture-mcp-server` is currently built against.
 *  Update with intent; a change here is a major-bump signal. */
const EXPECTED_PROTOCOL_VERSION = '2025-11-25';

/** Older spec dates `acture-mcp-server` should continue to interoperate with.
 *  The SDK's `SUPPORTED_PROTOCOL_VERSIONS` must be a superset of this. */
const REQUIRED_BACKCOMPAT_VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18'];

describe('MCP protocol version pin', () => {
  it('SDK\'s LATEST_PROTOCOL_VERSION matches the pinned expected version', () => {
    expect(LATEST_PROTOCOL_VERSION).toBe(EXPECTED_PROTOCOL_VERSION);
  });

  it('SDK still supports the spec dates this package was tested against', () => {
    for (const version of REQUIRED_BACKCOMPAT_VERSIONS) {
      expect(SUPPORTED_PROTOCOL_VERSIONS).toContain(version);
    }
  });
});
