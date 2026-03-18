import { afterEach, describe, expect, it, vi } from 'vitest';

import { adapterFactory, createAdapterFromConfig } from '../src/adapters/factory.js';
import type { MemoryAdapter } from '../src/adapters/memory-adapter.js';

function createAdapter(): MemoryAdapter {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
    store: vi.fn().mockResolvedValue('memory-1'),
    patchMetadata: vi.fn().mockResolvedValue(undefined),
    recall: vi.fn().mockResolvedValue([]),
    forget: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue([]),
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
  } as unknown as MemoryAdapter;
}

describe('createAdapterFromConfig', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('infers SSE transport for endpoint-only Graphiti config', async () => {
    const adapter = createAdapter();
    const createSpy = vi.spyOn(adapterFactory, 'create').mockReturnValue(adapter);

    await createAdapterFromConfig({ endpoint: 'http://localhost:8000/sse' });

    expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({
      type: 'graphiti-mcp',
      endpoint: 'http://localhost:8000/sse',
      transport: 'sse',
    }));
    expect(adapter.initialize).toHaveBeenCalled();
  });
});