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
    storeConsolidation: vi.fn().mockResolvedValue(undefined),
    connect: vi.fn().mockResolvedValue(undefined),
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

  it('falls back to graph-only mode with a warning when axonSessionLogDir cannot be read', async () => {
    const adapter = createAdapter({
      list: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
    });
    const api = createApi();

    registerTools(api, adapter, {
      axonEnabled: true,
      axonSessionLogDir: '/definitely/missing/path',
      axonLookbackHours: 24,
      axonBatchLimit: 5,
      axonEphemeralForgetDays: 5,
      axonMinRepeatCount: 2,
    });

    const result = await api.tools.get('memory_axon_daily_sources').execute('tool-4', {});

    expect(result.isError).toBeUndefined();
    expect(result.details.warnings[0]).toContain('falling back to graph-only mode');
  });

  it('honors axonDryRun when applying Axon plans', async () => {
    const adapter = createAdapter();
    const api = createApi();

    registerTools(api, adapter, {
      axonEnabled: true,
      axonDryRun: true,
    });

    const result = await api.tools.get('memory_axon_apply_plan').execute('tool-5', {
      operations: [
        { action: 'store', summary: 'Summary: keep this for tomorrow', tier: 'ephemeral' },
        { action: 'connect', fromId: 'mem-1', toId: 'mem-2', relationship: 'RELATES_TO' },
      ],
    });

    expect(result.isError).toBeUndefined();
    expect(result.details.dryRun).toBe(true);
    expect(adapter.store).not.toHaveBeenCalled();
    expect(adapter.connect).not.toHaveBeenCalled();
  });
});
