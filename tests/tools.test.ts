import { describe, expect, it, vi } from 'vitest';

import { registerTools } from '../src/tools.js';
import type { MemoryAdapter } from '../src/adapters/memory-adapter.js';

function createAdapter(overrides: Partial<MemoryAdapter> = {}): MemoryAdapter {
  return {
    initialize: vi.fn(),
    shutdown: vi.fn(),
    store: vi.fn().mockResolvedValue('memory-1'),
    recall: vi.fn().mockResolvedValue([]),
    forget: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue([]),
    getById: vi.fn().mockResolvedValue(null),
    searchByEntity: vi.fn().mockResolvedValue([]),
    searchByTimeRange: vi.fn().mockResolvedValue([]),
    getRelated: vi.fn().mockResolvedValue([]),
    healthCheck: vi.fn().mockResolvedValue({ healthy: true, backend: 'test' }),
    getStats: vi.fn().mockResolvedValue({
      totalCount: 0,
      byTier: { explicit: 0, silent: 0, ephemeral: 0 },
    }),
    cleanup: vi.fn().mockResolvedValue({ deleted: 0, upgraded: 0 }),
    getUnconsolidatedMemories: vi.fn().mockResolvedValue([]),
    storeConsolidation: vi.fn().mockResolvedValue({ requested: 0, created: 0, failures: [] }),
    getBackendType: vi.fn().mockReturnValue('test'),
    ...overrides,
  } as unknown as MemoryAdapter;
}

function createApi() {
  const tools = new Map<string, any>();
  return {
    tools,
    registerTool: vi.fn((definition: { name: string }, _meta?: unknown) => {
      tools.set(definition.name, definition);
    }),
  };
}

describe('registerTools', () => {
  it('forwards an explicit memory name to adapter.store', async () => {
    const adapter = createAdapter();
    const api = createApi();

    registerTools(api, adapter, {});

    const result = await api.tools.get('memory_store').execute('tool-name', {
      content: 'Remember my preferred shell',
      name: 'shell-preference',
      tier: 'explicit',
    });

    expect(adapter.store).toHaveBeenCalledWith(
      'Remember my preferred shell',
      expect.objectContaining({
        tier: 'explicit',
        source: 'user_explicit',
        name: 'shell-preference',
      })
    );
    expect(result.details.name).toBe('shell-preference');
  });

  it('clamps the unconsolidated memory limit to a safe maximum', async () => {
    const adapter = createAdapter();
    const api = createApi();

    registerTools(api, adapter, {});

    const result = await api.tools.get('read_unconsolidated_memories').execute('tool-1', { limit: 999 });

    expect(adapter.getUnconsolidatedMemories).toHaveBeenCalledWith(100);
    expect(result.details.count).toBe(0);
  });

  it('rejects consolidation batches without source ids', async () => {
    const adapter = createAdapter();
    const api = createApi();

    registerTools(api, adapter, {});

    const result = await api.tools.get('memory_consolidate_batch').execute('tool-2', {
      sourceIds: [],
      summary: 'summary',
      insight: 'insight',
      connections: [],
    });

    expect(result.isError).toBe(true);
    expect(adapter.storeConsolidation).not.toHaveBeenCalled();
  });

  it('returns a warning when consolidation has no connections', async () => {
    const adapter = createAdapter();
    const api = createApi();

    registerTools(api, adapter, {});

    const result = await api.tools.get('memory_consolidate_batch').execute('tool-3', {
      sourceIds: ['mem-1'],
      summary: 'Merged summary',
      insight: 'Shared pattern',
      connections: [],
    });

    expect(result.isError).toBeUndefined();
    expect(result.details.warning).toContain('no semantic connections');
    expect(adapter.storeConsolidation).toHaveBeenCalledWith(['mem-1'], 'Merged summary', 'Shared pattern', []);
  });

  it('rejects blank consolidation summary and malformed connections', async () => {
    const adapter = createAdapter();
    const api = createApi();

    registerTools(api, adapter, {});

    const blankSummary = await api.tools.get('memory_consolidate_batch').execute('tool-4', {
      sourceIds: ['mem-1'],
      summary: '   ',
      insight: 'Shared pattern',
      connections: [],
    });

    expect(blankSummary.isError).toBe(true);
    expect(adapter.storeConsolidation).not.toHaveBeenCalled();

    const badRelationship = await api.tools.get('memory_consolidate_batch').execute('tool-5', {
      sourceIds: ['mem-1'],
      summary: 'Merged summary',
      insight: 'Shared pattern',
      connections: [{ fromId: 'a', toId: 'b', relationship: 'relates-to' }],
    });

    expect(badRelationship.isError).toBe(true);
    expect(adapter.storeConsolidation).not.toHaveBeenCalled();
  });

  it('reports partial consolidation failures without hiding created edges', async () => {
    const adapter = createAdapter({
      storeConsolidation: vi.fn().mockResolvedValue({
        requested: 2,
        created: 1,
        failures: [
          {
            fromId: 'mem-1',
            toId: 'mem-2',
            relationship: 'RELATES_TO',
            error: 'edge failed',
          },
        ],
      }),
    });
    const api = createApi();

    registerTools(api, adapter, {});

    const result = await api.tools.get('memory_consolidate_batch').execute('tool-6', {
      sourceIds: ['mem-1'],
      summary: 'Merged summary',
      insight: 'Shared pattern',
      connections: [
        { fromId: 'mem-1', toId: 'mem-2', relationship: 'RELATES_TO' },
        { fromId: 'mem-1', toId: 'mem-3', relationship: 'SUPPORTS' },
      ],
    });

    expect(result.isError).toBeUndefined();
    expect(result.details.connections).toBe(1);
    expect(result.details.requestedConnections).toBe(2);
    expect(result.details.failures).toHaveLength(1);
    expect(result.details.failureWarning).toContain('failed to persist');
  });
});
