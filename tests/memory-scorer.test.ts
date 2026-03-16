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
    searchByEntity: vi.fn().mockResolvedValue([]),
    searchByTimeRange: vi.fn().mockResolvedValue([]),
    getRelated: vi.fn().mockResolvedValue([]),
    healthCheck: vi.fn().mockResolvedValue({ healthy: true, backend: 'test' }),
    getStats: vi.fn(),
    cleanup: vi.fn().mockResolvedValue({ deleted: 0, upgraded: 0 }),
    getUnconsolidatedMemories: vi.fn().mockResolvedValue([]),
    storeConsolidation: vi.fn(),
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
    expect(result.recommendedAction).toBe('skip');
    expect(result.reasoning).toContain('skipping storage');
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
    expect(result.tier === 'silent' || result.tier === 'explicit').toBe(true);
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