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
    getById: vi.fn().mockResolvedValue(null),
    searchByEntity: vi.fn().mockResolvedValue([]),
    searchByTimeRange: vi.fn().mockResolvedValue([]),
    getRelated: vi.fn().mockResolvedValue([]),
    healthCheck: vi.fn().mockResolvedValue({ healthy: true, backend: 'test' }),
    getStats: vi.fn(),
    cleanup: vi.fn().mockResolvedValue({ deleted: 0, upgraded: 0 }),
    getUnconsolidatedMemories: vi.fn().mockResolvedValue([]),
    storeConsolidation: vi.fn().mockResolvedValue({ requested: 0, created: 0, failures: [] }),
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

    const beforeAgentStart = api.handlers.get('before_agent_start')!;
    const result = await beforeAgentStart({ prompt: 'What do you remember about my editor setup?' });

    expect(result.prependContext).toContain('No relevant memories found.');
    expect(result.prependContext).not.toContain('<system_memory_instructions>');
    expect(result.prependSystemContext).toContain('<system_memory_instructions>');
  });

  it('keeps short explicit user memories for scoring', async () => {
    const adapter = createAdapter({
      store: vi.fn().mockResolvedValue('memory-43'),
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
      sessionId: 'session-short-explicit',
      messages: [
        { role: 'user', content: 'remember pnpm' },
      ],
    });

    expect(adapter.store).toHaveBeenCalledTimes(1);
    expect(adapter.store).toHaveBeenCalledWith(
      expect.stringContaining('user: remember pnpm'),
      expect.objectContaining({ sessionId: 'session-short-explicit' })
    );
  });

  it('dispatches Axon triggers on heartbeat even when scoring is disabled', async () => {
    const adapter = createAdapter();
    const api = createApi() as ReturnType<typeof createApi> & { dispatchAxonTrigger: ReturnType<typeof vi.fn> };
    api.dispatchAxonTrigger = vi.fn().mockResolvedValue(undefined);

    registerHooks(api, adapter, {
      autoRecall: false,
      autoCapture: false,
      scoringEnabled: false,
      scoringCleanupHours: 0,
      axonDispatchEnabled: true,
    });

    await api.handlers.get('heartbeat')();

    expect(api.dispatchAxonTrigger).toHaveBeenCalledTimes(1);
    expect(adapter.cleanup).not.toHaveBeenCalled();
  });

  it('invokes the Axon dispatch hook with its original owner binding', async () => {
    const adapter = createAdapter();
    const api = createApi() as ReturnType<typeof createApi> & { nuron: { invocations: number; dispatchAxonTrigger: (payload: unknown) => Promise<void> } };
    api.nuron = {
      invocations: 0,
      dispatchAxonTrigger: vi.fn(async function (this: { invocations: number }, _payload: unknown) {
        this.invocations += 1;
      }),
    };

    registerHooks(api, adapter, {
      autoRecall: false,
      autoCapture: false,
      scoringEnabled: false,
      scoringCleanupHours: 0,
      axonDispatchEnabled: true,
    });

    await api.handlers.get('heartbeat')();

    expect(api.nuron.dispatchAxonTrigger).toHaveBeenCalledTimes(1);
    expect(api.nuron.invocations).toBe(1);
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

    const agentEnd = api.handlers.get('agent_end')!;
    await agentEnd({
      sessionId: 'session-1',
      messages: [
        { role: 'user', content: 'Please remember that I prefer Vim keybindings in VS Code for daily development work.' },
        { role: 'assistant', content: 'I will keep that editor preference in mind for future coding help.' },
      ],
    });

    expect(adapter.store).toHaveBeenCalledTimes(1);
    expect(adapter.store).toHaveBeenCalledWith(
      expect.stringContaining('Preference: I prefer Vim keybindings in VS Code for daily development work.'),
      expect.objectContaining({
        tier: 'explicit',
        disposition: 'explicit',
        memoryKind: 'preference',
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

    const agentEnd = api.handlers.get('agent_end')!;
    await agentEnd({
      sessionId: 'session-2',
      messages: [
        { role: 'user', content: 'hello there nice to meet you today' },
      ],
    });

    expect(adapter.store).not.toHaveBeenCalled();
  });

  it('skips one-off OpenClaw help questions during auto-capture', async () => {
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

    const agentEnd = api.handlers.get('agent_end')!;
    await agentEnd({
      sessionId: 'session-help',
      messages: [
        { role: 'user', content: 'How can I set thinking mode to high in OpenClaw?' },
        { role: 'assistant', content: 'Open the config and switch the thinking mode option to high.' },
      ],
    });

    expect(adapter.store).not.toHaveBeenCalled();
  });

  it('filters think blocks and assistant filler during auto-capture', async () => {
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

    const agentEnd = api.handlers.get('agent_end')!;
    await agentEnd({
      sessionId: 'session-3',
      messages: [
        { role: 'user', content: 'Please remember that we decided to use pnpm for this repo and ship on Friday.' },
        { role: 'assistant', content: '<think>This is probably important.</think> Great! Sure, I can help with that.' },
      ],
    });

    expect(adapter.store).toHaveBeenCalledTimes(1);
    expect(adapter.store).toHaveBeenCalledWith(
      expect.not.stringContaining('<think>'),
      expect.anything()
    );
    expect(adapter.store).toHaveBeenCalledWith(
      expect.not.stringContaining('Great! Sure, I can help with that.'),
      expect.anything()
    );
  });

  it('removes unterminated think blocks before auto-capture storage', async () => {
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

    const agentEnd = api.handlers.get('agent_end')!;
    await agentEnd({
      sessionId: 'session-4',
      messages: [
        { role: 'user', content: 'Please remember that the repo uses pnpm and the release is planned for Friday afternoon.' },
        { role: 'assistant', content: '<think confidence="0.1">private reasoning that should never be persisted' },
      ],
    });

    expect(adapter.store).toHaveBeenCalledTimes(1);
    expect(adapter.store).toHaveBeenCalledWith(
      expect.not.stringContaining('private reasoning that should never be persisted'),
      expect.anything()
    );
  });

  it('stores distilled user-led summaries instead of raw assistant turn text', async () => {
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

    const agentEnd = api.handlers.get('agent_end')!;
    await agentEnd({
      sessionId: 'session-5',
      messages: [
        { role: 'user', content: 'Please remember that we decided to use pnpm for this repo and ship on Friday.' },
        { role: 'assistant', content: "Here's the plan: use pnpm for installs and target Friday for the release cut." },
      ],
    });

    expect(adapter.store).toHaveBeenCalledTimes(1);
    expect(adapter.store).toHaveBeenCalledWith(
      expect.stringContaining('Decision: we decided to use pnpm for this repo and ship on Friday.'),
      expect.objectContaining({
        memoryKind: 'decision',
        tier: 'explicit',
      })
    );
    expect(adapter.store).toHaveBeenCalledWith(
      expect.not.stringContaining("Here's the plan: use pnpm for installs and target Friday for the release cut."),
      expect.anything()
    );
  });
});
