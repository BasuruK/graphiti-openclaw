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