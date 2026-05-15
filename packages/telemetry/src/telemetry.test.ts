import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { createRegistry, defineCommand, ok, err } from 'acture';
import {
  instrumentTelemetry,
  consoleSink,
  type TelemetryRecord,
  type TelemetrySink,
} from './telemetry.js';

function setup() {
  const registry = createRegistry();
  registry.registerAll([
    defineCommand({
      id: 'app.do',
      title: 'Do',
      execute: () => ok({ value: 1 }),
    }),
    defineCommand({
      id: 'app.fail',
      title: 'Fail',
      execute: () => err('boom', 'failed on purpose'),
    }),
    defineCommand({
      id: 'app.echo',
      title: 'Echo',
      params: z.object({ text: z.string(), secret: z.string() }),
      execute: (params) => ok(params),
    }),
  ]);
  return registry;
}

function captureSink(): {
  sink: TelemetrySink;
  records: TelemetryRecord[];
} {
  const records: TelemetryRecord[] = [];
  return {
    sink: (r) => {
      records.push(r);
    },
    records,
  };
}

describe('instrumentTelemetry', () => {
  it('emits a record for every dispatch', async () => {
    const registry = setup();
    const { sink, records } = captureSink();
    instrumentTelemetry(registry, { sink });
    await registry.dispatch('app.do');
    await registry.dispatch('app.do');
    expect(records).toHaveLength(2);
    expect(records[0]!.commandId).toBe('app.do');
    expect(records[0]!.seq).toBe(1);
    expect(records[1]!.seq).toBe(2);
  });

  it('record.result preserves errors-as-data — ok and not-ok dispatches both emit', async () => {
    const registry = setup();
    const { sink, records } = captureSink();
    instrumentTelemetry(registry, { sink });
    await registry.dispatch('app.do');
    await registry.dispatch('app.fail');
    expect(records).toHaveLength(2);
    expect(records[0]!.result.ok).toBe(true);
    expect(records[1]!.result.ok).toBe(false);
    expect(
      records[1]!.result.ok === false ? records[1]!.result.error.code : '',
    ).toBe('boom');
  });

  it('records an unknown_command attempt — the registry returns {ok:false} and we log it', async () => {
    const registry = setup();
    const { sink, records } = captureSink();
    instrumentTelemetry(registry, { sink });
    await registry.dispatch('no.such.command');
    expect(records).toHaveLength(1);
    expect(records[0]!.commandId).toBe('no.such.command');
    expect(records[0]!.result.ok).toBe(false);
  });

  it('passes params through to the record (mutated by redact if provided)', async () => {
    const registry = setup();
    const { sink, records } = captureSink();
    instrumentTelemetry(registry, { sink });
    await registry.dispatch('app.echo', { text: 'hi', secret: 'pw' });
    expect(records[0]!.params).toEqual({ text: 'hi', secret: 'pw' });
  });

  it('redact rewrites the record before the sink sees it', async () => {
    const registry = setup();
    const { sink, records } = captureSink();
    instrumentTelemetry(registry, {
      sink,
      redact: (r) => ({
        ...r,
        params: { ...(r.params as Record<string, unknown>), secret: '[REDACTED]' },
      }),
    });
    await registry.dispatch('app.echo', { text: 'hi', secret: 'pw' });
    expect((records[0]!.params as Record<string, unknown>)['secret']).toBe(
      '[REDACTED]',
    );
    expect((records[0]!.params as Record<string, unknown>)['text']).toBe('hi');
  });

  it('sampler === false drops the record entirely', async () => {
    const registry = setup();
    const { sink, records } = captureSink();
    instrumentTelemetry(registry, {
      sink,
      sampler: (r) => r.commandId !== 'app.do',
    });
    await registry.dispatch('app.do');
    await registry.dispatch('app.fail');
    expect(records).toHaveLength(1);
    expect(records[0]!.commandId).toBe('app.fail');
  });

  it('sampler runs before redact — a dropped record never reaches redact', async () => {
    const registry = setup();
    const { sink, records } = captureSink();
    const redact = vi.fn((r: TelemetryRecord) => r);
    instrumentTelemetry(registry, {
      sink,
      sampler: () => false,
      redact,
    });
    await registry.dispatch('app.do');
    expect(records).toHaveLength(0);
    expect(redact).not.toHaveBeenCalled();
  });

  it('a throwing sink does NOT break dispatch — the result still returns', async () => {
    const registry = setup();
    const throwingSink: TelemetrySink = () => {
      throw new Error('sink boom');
    };
    instrumentTelemetry(registry, { sink: throwingSink });
    const result = await registry.dispatch('app.do');
    expect(result.ok).toBe(true);
  });

  it('a throwing redact does NOT break dispatch — sink still gets the original record', async () => {
    const registry = setup();
    const { sink, records } = captureSink();
    instrumentTelemetry(registry, {
      sink,
      redact: () => {
        throw new Error('redact boom');
      },
    });
    const result = await registry.dispatch('app.echo', { text: 'a', secret: 'b' });
    expect(result.ok).toBe(true);
    expect(records).toHaveLength(1);
    expect(records[0]!.params).toEqual({ text: 'a', secret: 'b' });
  });

  it('a throwing sampler defaults to "keep" — over-log rather than swallow silently', async () => {
    const registry = setup();
    const { sink, records } = captureSink();
    instrumentTelemetry(registry, {
      sink,
      sampler: () => {
        throw new Error('sampler boom');
      },
    });
    await registry.dispatch('app.do');
    expect(records).toHaveLength(1);
  });

  it('is idempotent — calling twice returns the same disposer', () => {
    const registry = setup();
    const { sink } = captureSink();
    const d1 = instrumentTelemetry(registry, { sink });
    const d2 = instrumentTelemetry(registry, { sink });
    expect(d1).toBe(d2);
  });

  it('the disposer restores the original dispatch — no records emitted after dispose', async () => {
    const registry = setup();
    const { sink, records } = captureSink();
    const dispose = instrumentTelemetry(registry, { sink });
    await registry.dispatch('app.do');
    expect(records).toHaveLength(1);
    dispose();
    await registry.dispatch('app.do');
    expect(records).toHaveLength(1);
  });

  it('records durationMs as a non-negative number', async () => {
    const registry = setup();
    const { sink, records } = captureSink();
    instrumentTelemetry(registry, { sink });
    await registry.dispatch('app.do');
    expect(records[0]!.durationMs).toBeGreaterThanOrEqual(0);
    expect(records[0]!.durationMs).toBeLessThan(1000);
  });

  it('record.ctx defaults to {} when the caller omits ctx', async () => {
    const registry = setup();
    const { sink, records } = captureSink();
    instrumentTelemetry(registry, { sink });
    await registry.dispatch('app.do');
    expect(records[0]!.ctx).toEqual({});
  });

  it('record.ctx echoes the dispatch ctx when supplied', async () => {
    const registry = setup();
    const { sink, records } = captureSink();
    instrumentTelemetry(registry, { sink });
    await registry.dispatch('app.do', undefined, { user: 'alice' });
    expect(records[0]!.ctx).toEqual({ user: 'alice' });
  });
});

describe('consoleSink', () => {
  it('prints a one-line summary on success', async () => {
    const registry = setup();
    const log = vi.fn();
    const originalLog = console.log;
    console.log = log;
    try {
      instrumentTelemetry(registry, { sink: consoleSink });
      await registry.dispatch('app.do');
    } finally {
      console.log = originalLog;
    }
    expect(log).toHaveBeenCalledTimes(1);
    const msg = log.mock.calls[0]![0] as string;
    expect(msg).toContain('[acture]');
    expect(msg).toContain('app.do');
    expect(msg).toContain('ok');
  });

  it('prints the error code on failure', async () => {
    const registry = setup();
    const log = vi.fn();
    const originalLog = console.log;
    console.log = log;
    try {
      instrumentTelemetry(registry, { sink: consoleSink });
      await registry.dispatch('app.fail');
    } finally {
      console.log = originalLog;
    }
    const msg = log.mock.calls[0]![0] as string;
    expect(msg).toContain('app.fail');
    expect(msg).toContain('ERR boom');
  });
});

describe('composition with other instrumenters', () => {
  it('telemetry chains on top of an existing dispatch wrapper', async () => {
    const registry = setup();
    // Pre-existing wrapper that tags every result with an extra log.
    const calls: string[] = [];
    const originalDispatch = registry.dispatch.bind(registry);
    (registry as { dispatch: typeof registry.dispatch }).dispatch =
      async function preWrap(id, params, ctx, opts) {
        calls.push(`pre:${id}`);
        return originalDispatch(id, params, ctx, opts);
      };

    const { sink, records } = captureSink();
    instrumentTelemetry(registry, { sink });
    await registry.dispatch('app.do');

    // Both the pre-wrapper and the telemetry instrumenter saw the call.
    expect(calls).toEqual(['pre:app.do']);
    expect(records).toHaveLength(1);
    expect(records[0]!.commandId).toBe('app.do');
    // The result is unchanged.
    expect(records[0]!.result.ok).toBe(true);
  });
});
