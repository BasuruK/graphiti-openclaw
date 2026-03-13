import { describe, expect, it, vi } from 'vitest';

import { registerHooks } from '../src/hooks.js';
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
    searchByEntity: vi.fn().mockResolvedValue([]),
    searchByTimeRange: vi.fn().mockResolvedValue([]),
    getRelated: vi.fn().mockResolvedValue([]),
    healthCheck: vi.fn().mockResolvedValue({ healthy: true, backend: 'test' }),
    getStats: vi.fn(),
    cleanup: vi.fn().mockResolvedValue({ deleted: 0, upgraded: 0 }),
    getUnconsolidatedMemories: vi.fn().mockResolvedValue([]),
    storeConsolidation: vi.fn().mockResolvedValue(undefined),
    getBackendType: vi.fn().mockReturnValue('test'),
    ...overrides,
  } as unknown as MemoryAdapter;
}

function createApi() {
  const handlers = new Map<string, Function>();
  return {
    handlers,
    on: vi.fn((event: string, handler: Function) => {
      handlers.set(event, handler);
    }),
  };
}

describe('registerHooks', () => {
  it('injects MEMORY instructions even when recall returns no matches', async () => {
    const adapter = createAdapter({
      recall: vi.fn().mockResolvedValue([]),
    });
    const api = createApi();

    registerHooks(api, adapter, {
      autoRecall: true,
      autoCapture: false,
      minPromptLength: 1,
      recallMaxFacts: 3,
      scoringEnabled: true,
    });

    const result = await api.handlers.get('before_agent_start')({ prompt: 'What do you remember about my editor setup?' });

    expect(result.prependContext).toContain('<system_memory_instructions>');
    expect(result.prependContext).toContain('No relevant memories found.');
  });

  it('stores scored conversations during agent_end auto-capture', async () => {
    const adapter = createAdapter({
      recall: vi.fn().mockResolvedValue([]),
      store: vi.fn().mockResolvedValue('memory-42'),
    });
    const api = createApi();

    registerHooks(api, adapter, {
      autoRecall: false,
      autoCapture: true,
      minPromptLength: 1,
      recallMaxFacts: 3,
      scoringEnabled: true,
      scoringNotifyExplicit: false,
    });

    await api.handlers.get('agent_end')({
      sessionId: 'session-1',
      messages: [
        { role: 'user', content: 'Please remember that I prefer Vim keybindings in VS Code for daily development work.' },
        { role: 'assistant', content: 'I will keep that editor preference in mind for future coding help.' },
      ],
    });

    expect(adapter.store).toHaveBeenCalledTimes(1);
    expect(adapter.store).toHaveBeenCalledWith(
      expect.stringContaining('user: Please remember that I prefer Vim keybindings'),
      expect.objectContaining({
        source: 'auto_capture',
        sessionId: 'session-1',
      })
    );
  });

  it('skips trivial conversations during agent_end auto-capture', async () => {
    const adapter = createAdapter({
      recall: vi.fn().mockResolvedValue([]),
      store: vi.fn().mockResolvedValue('memory-42'),
    });
    const api = createApi();

    registerHooks(api, adapter, {
      autoRecall: false,
      autoCapture: true,
      minPromptLength: 1,
      recallMaxFacts: 3,
      scoringEnabled: true,
    });

    await api.handlers.get('agent_end')({
      sessionId: 'session-2',
      messages: [
        { role: 'user', content: 'hello there nice to meet you today' },
      ],
    });

    expect(adapter.store).not.toHaveBeenCalled();
  });
});