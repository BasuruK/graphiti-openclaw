import { describe, expect, it, vi } from 'vitest';

import { GraphitiMCPAdapter, normalizeGraphitiMCPConfig } from '../src/adapters/graphiti-adapter.js';

describe('normalizeGraphitiMCPConfig', () => {
  it('defaults HTTP transport to the /mcp/ endpoint', () => {
    const config = normalizeGraphitiMCPConfig({
      type: 'graphiti-mcp',
      transport: 'http',
      groupId: 'default',
    });

    expect(config.endpoint).toBe('http://localhost:8000/mcp/');
  });

  it('migrates legacy /sse endpoints when using HTTP transport', () => {
    const config = normalizeGraphitiMCPConfig({
      type: 'graphiti-mcp',
      transport: 'http',
      endpoint: 'http://localhost:8000/sse',
      groupId: 'default',
    });

    expect(config.endpoint).toBe('http://localhost:8000/mcp/');
  });

  it('preserves SSE endpoints for legacy servers', () => {
    const config = normalizeGraphitiMCPConfig({
      type: 'graphiti-mcp',
      transport: 'sse',
      endpoint: 'http://localhost:8000/sse',
      groupId: 'default',
    });

    expect(config.endpoint).toBe('http://localhost:8000/sse');
  });

  it('unwraps node search responses returned as an envelope object', async () => {
    const adapter = new GraphitiMCPAdapter({
      type: 'graphiti-mcp',
      transport: 'http',
      groupId: 'default',
    });

    vi.spyOn(adapter as any, 'callTool').mockResolvedValue({
      message: 'Nodes retrieved successfully',
      nodes: [
        {
          uuid: 'node-1',
          name: 'Preference',
          summary: 'User prefers concise responses.',
          valid_at: '2026-03-16T00:00:00Z',
        },
      ],
    });

    const results = await adapter.recall('concise', { limit: 5, tier: 'all' });

    expect(results).toHaveLength(1);
    expect(results[0].content).toContain('User prefers concise responses.');
  });

  it('unwraps episode search responses returned as an envelope object', async () => {
    const adapter = new GraphitiMCPAdapter({
      type: 'graphiti-mcp',
      transport: 'http',
      groupId: 'default',
    });

    vi.spyOn(adapter as any, 'callTool').mockResolvedValue({
      message: 'Episodes retrieved successfully',
      episodes: [
        {
          uuid: 'episode-1',
          name: 'Episode 1',
          content: '{"content":"Remember Vim mode","memory":{"tier":"explicit","score":9}}',
          created_at: '2026-03-16T00:00:00Z',
        },
      ],
    });

    const results = await adapter.list(10, 'all');

    expect(results).toHaveLength(1);
    expect(results[0].content).toBe('Remember Vim mode');
    expect(results[0].metadata.tier).toBe('explicit');
  });

  it('rehydrates persisted metadata fields from stored episode JSON', async () => {
    const adapter = new GraphitiMCPAdapter({
      type: 'graphiti-mcp',
      transport: 'http',
      groupId: 'default',
    });

    vi.spyOn(adapter as any, 'callTool').mockResolvedValue({
      message: 'Episodes retrieved successfully',
      episodes: [
        {
          uuid: 'episode-2',
          name: 'Episode 2',
          content: JSON.stringify({
            content: 'Working context: build is failing in CI today.',
            memory: {
              tier: 'ephemeral',
              score: 3,
              createdAt: '2026-03-16T00:00:00Z',
              lastReinforced: '2026-03-16T01:00:00Z',
              reinforcementCount: 2,
              memoryKind: 'working_context',
              disposition: 'ephemeral',
              sourceLog: {
                path: '/tmp/openclaw/2026-03-16.md',
                date: '2026-03-16',
                excerpt: 'CI is still red today.',
              },
            },
          }),
          created_at: '2026-03-16T00:00:00Z',
        },
      ],
    });

    const results = await adapter.list(10, 'all');

    expect(results).toHaveLength(1);
    expect(results[0].metadata.reinforcementCount).toBe(2);
    expect(results[0].metadata.memoryKind).toBe('working_context');
    expect(results[0].metadata.disposition).toBe('ephemeral');
    expect(results[0].metadata.sourceLog?.path).toContain('/tmp/openclaw/2026-03-16.md');
    expect(results[0].metadata.lastReinforced?.toISOString()).toBe('2026-03-16T01:00:00.000Z');
  });

  it('creates graph edges through the add_edge tool', async () => {
    const adapter = new GraphitiMCPAdapter({
      type: 'graphiti-mcp',
      transport: 'http',
      groupId: 'default',
    });

    const callTool = vi.spyOn(adapter as any, 'callTool').mockResolvedValue({});
    await adapter.connect('mem-1', 'mem-2', 'relates to');

    expect(callTool).toHaveBeenCalledWith('add_edge', {
      group_id: 'default',
      from_node_uuid: 'mem-1',
      to_node_uuid: 'mem-2',
      label: 'RELATES_TO',
    });
  });

  it('throws Graphiti error responses instead of treating them like arrays', async () => {
    const adapter = new GraphitiMCPAdapter({
      type: 'graphiti-mcp',
      transport: 'http',
      groupId: 'default',
    });

    vi.spyOn(adapter as any, 'callTool').mockResolvedValue({
      error: 'Graphiti service not initialized',
    });

    await expect(adapter.recall('test', { limit: 5, tier: 'all' })).rejects.toThrow(
      'Graphiti service not initialized'
    );
  });
});
