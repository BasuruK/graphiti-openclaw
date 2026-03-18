import { describe, expect, it, vi } from 'vitest';

import { MemoryScorer } from '../src/memory-scorer.js';
import type { MemoryAdapter, MemoryResult } from '../src/adapters/memory-adapter.js';

function createAdapter(overrides: Partial<MemoryAdapter> = {}): MemoryAdapter {
  return {
    initialize: vi.fn(),
    shutdown: vi.fn(),
    store: vi.fn(),
    recall: vi.fn().mockResolvedValue([]),
    forget: vi.fn(),
    update: vi.fn(),
    list: vi.fn().mockResolvedValue([]),
    getById: vi.fn().mockResolvedValue(null),
    searchByEntity: vi.fn().mockResolvedValue([]),
    searchByTimeRange: vi.fn().mockResolvedValue([]),
    getRelated: vi.fn().mockResolvedValue([]),
    healthCheck: vi.fn().mockResolvedValue({ healthy: true, backend: 'test' }),
    getStats: vi.fn(),
    cleanup: vi.fn().mockResolvedValue({ deleted: 0, upgraded: 0 }),
    getUnconsolidatedMemories: vi.fn().mockResolvedValue([]),
    storeConsolidation: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    getBackendType: vi.fn().mockReturnValue('test'),
    ...overrides,
  } as unknown as MemoryAdapter;
}

describe('MemoryScorer', () => {
  it('returns the configured default tier when scoring is disabled', async () => {
    const adapter = createAdapter();
    const scorer = new MemoryScorer(adapter, {
      enabled: false,
      defaultTier: 'ephemeral',
    });

    const result = await scorer.scoreConversation([
      { role: 'user', content: 'hello there' },
    ]);

    expect(result.tier).toBe('ephemeral');
    expect(result.disposition).toBe('ephemeral');
    expect(result.recommendedAction).toBe('store_ephemeral');
    expect(result.reasoning).toContain('Scoring disabled');
  });

  it('skips storage for trivial conversations without explicit markers', async () => {
    const adapter = createAdapter();
    const scorer = new MemoryScorer(adapter, {
      minConversationLength: 50,
    });

    const result = await scorer.scoreConversation([
      { role: 'user', content: 'hello there nice to meet you today' },
    ]);

    expect(result.tier).toBe('ephemeral');
    expect(result.disposition).toBe('skip');
    expect(result.recommendedAction).toBe('skip');
    expect(result.reasoning).toContain('skipping storage');
  });

  it('recommends storing durable user preferences instead of skipping them', async () => {
    const adapter = createAdapter();
    const scorer = new MemoryScorer(adapter);

    const result = await scorer.scoreConversation([
      {
        role: 'user',
        content: 'Please remember that I prefer Vim keybindings in VS Code for daily development work and project navigation.',
      },
    ]);

    expect(result.tier).toMatch(/^(silent|explicit)$/);
    expect(result.recommendedAction).not.toBe('skip');
    expect(['store_silent', 'store_explicit']).toContain(result.recommendedAction);
  });

  it('rejects invalid scoring thresholds', () => {
    const adapter = createAdapter();

    expect(() => new MemoryScorer(adapter, {
      explicitThreshold: 4,
      ephemeralThreshold: 4,
    })).toThrow(/must be less than explicitThreshold/);
  });

  it('keeps assistant-led low-value conversations at very low scores', async () => {
    const adapter = createAdapter();
    const scorer = new MemoryScorer(adapter, {
      minConversationLength: 1,
    });

    const result = await scorer.scoreConversation([
      { role: 'user', content: 'Can you help?' },
      { role: 'assistant', content: 'Great! Absolutely. I can help with that. Here is a generic summary of options and next steps for you.' },
    ]);

    expect(result.score).toBeLessThanOrEqual(2);
    expect(result.tier).toBe('ephemeral');
    expect(result.disposition).toBe('skip');
    expect(result.recommendedAction).toBe('skip');
  });

  it('scores durable user-led preferences above trivial chatter', async () => {
    const adapter = createAdapter();
    const scorer = new MemoryScorer(adapter, {
      minConversationLength: 1,
    });

    const result = await scorer.scoreConversation([
      { role: 'user', content: 'Please remember that I prefer Vim keybindings and we decided to use pnpm for this repo.' },
      { role: 'assistant', content: 'I will use that preference and repo decision in future help.' },
    ]);

    expect(result.score).toBeGreaterThanOrEqual(4);
    expect(result.disposition === 'silent' || result.disposition === 'explicit').toBe(true);
    expect(result.tier === 'silent' || result.tier === 'explicit').toBe(true);
  });

  it('skips one-off product help questions instead of storing them as ephemeral', async () => {
    const adapter = createAdapter();
    const scorer = new MemoryScorer(adapter, {
      minConversationLength: 1,
    });

    const result = await scorer.scoreConversation([
      { role: 'user', content: 'How can I set thinking mode to high in OpenClaw?' },
      { role: 'assistant', content: 'Open the config and switch the thinking mode setting to high.' },
    ]);

    expect(result.score).toBeLessThanOrEqual(2);
    expect(result.disposition).toBe('skip');
    expect(result.recommendedAction).toBe('skip');
    expect(result.memoryKind).toBe('question');
  });

  it('keeps active short-term work context as ephemeral instead of skipping it', async () => {
    const adapter = createAdapter();
    const scorer = new MemoryScorer(adapter, {
      minConversationLength: 1,
    });

    const result = await scorer.scoreConversation([
      { role: 'user', content: 'Right now we are debugging this repo because the build is failing in CI and that is the current blocker for today.' },
      { role: 'assistant', content: 'I will keep that blocker in working memory while we debug the issue.' },
    ]);

    expect(result.tier).toBe('ephemeral');
    expect(result.disposition).toBe('ephemeral');
    expect(result.recommendedAction).toBe('store_ephemeral');
    expect(result.memoryKind).toBe('working_context');
  });

  it('counts total conversation segments for minMessageCount gating', async () => {
    const adapter = createAdapter();
    const scorer = new MemoryScorer(adapter, {
      minConversationLength: 1,
      minMessageCount: 2,
    });

    const result = await scorer.scoreConversation([
      { role: 'user', content: 'Please remember that we decided to use pnpm for this repo.' },
      { role: 'assistant', content: 'I will keep that repo decision in mind for future coding help.' },
    ]);

    expect(result.recommendedAction).not.toBe('skip');
    expect(result.tier === 'silent' || result.tier === 'explicit').toBe(true);
  });

  it('preserves turn order in local-model scoring prompts', async () => {
    const adapter = createAdapter();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: '{"score":6,"tier":"silent","reasoning":"keeps order"}',
            },
          },
        ],
      }),
    });

    vi.stubGlobal('fetch', fetchMock);

    try {
      const scorer = new MemoryScorer(adapter, {
        minConversationLength: 1,
        scoringModel: {
          provider: 'openai',
          endpoint: 'http://localhost:8080',
          model: 'test-model',
        },
      });

      await scorer.scoreConversation([
        { role: 'user', content: 'First user turn' },
        { role: 'assistant', content: 'Assistant reply' },
        { role: 'user', content: 'Follow-up user turn' },
      ]);

      const [, requestInit] = fetchMock.mock.calls[0];
      const body = JSON.parse(String(requestInit?.body));
      const userPrompt = body.messages[1].content as string;

      expect(userPrompt.indexOf('user: First user turn')).toBeLessThan(userPrompt.indexOf('assistant: Assistant reply'));
      expect(userPrompt.indexOf('assistant: Assistant reply')).toBeLessThan(userPrompt.indexOf('user: Follow-up user turn'));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('upgrades reinforced ephemeral memories during reinforcement processing', async () => {
    const ephemeralMemory: MemoryResult = {
      id: 'mem-1',
      content: 'Remember that I prefer Vim keybindings in VS Code.',
      relevanceScore: 1,
      metadata: {
        tier: 'ephemeral',
        score: 3,
        source: 'auto_capture',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        reinforcementCount: 1,
      },
    };

    const adapter = createAdapter({
      list: vi.fn().mockResolvedValue([ephemeralMemory]),
      getRelated: vi.fn().mockResolvedValue([
        {
          ...ephemeralMemory,
          id: 'related-1',
          metadata: {
            ...ephemeralMemory.metadata,
            tier: 'silent',
          },
        },
      ]),
      update: vi.fn().mockResolvedValue(undefined),
    });

    const scorer = new MemoryScorer(adapter);
    const result = await scorer.processReinforcements();

    expect(result.upgraded).toBe(1);
    expect(adapter.update).toHaveBeenCalledWith(
      'mem-1',
      ephemeralMemory.content,
      expect.objectContaining({ tier: 'silent' })
    );
  });
});
