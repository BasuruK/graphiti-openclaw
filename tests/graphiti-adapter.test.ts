import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  connectMock: vi.fn().mockResolvedValue(undefined),
  closeMock: vi.fn().mockResolvedValue(undefined),
  clientCallToolMock: vi.fn(),
  sseTransportMock: vi.fn((url: URL) => ({ url })),
  stdioTransportMock: vi.fn(),
}));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: mocks.connectMock,
    close: mocks.closeMock,
    callTool: mocks.clientCallToolMock,
  })),
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: mocks.stdioTransportMock,
}));

vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: mocks.sseTransportMock,
}));

import { GraphitiMCPAdapter } from '../src/adapters/graphiti-adapter.js';

describe('GraphitiMCPAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normalizes SSE endpoints onto the /sse path', async () => {
    const adapter = new GraphitiMCPAdapter({
      type: 'graphiti-mcp',
      transport: 'sse',
      endpoint: 'http://localhost:8000/mcp/',
      groupId: 'default',
    });

    await adapter.initialize();

    expect(mocks.sseTransportMock).toHaveBeenCalledTimes(1);
    const normalizedUrl = mocks.sseTransportMock.mock.calls[0][0] as URL;
    expect(normalizedUrl.toString()).toBe('http://localhost:8000/sse');
  });

  it('surfaces primitive search failures and filters recall results by tier', async () => {
    const adapter = new GraphitiMCPAdapter({ type: 'graphiti-mcp', groupId: 'default' });

    (adapter as any).callTool = vi.fn().mockResolvedValueOnce('backend offline');
    await expect(adapter.recall('hello', { limit: 5 })).rejects.toThrow('backend offline');

    (adapter as any).callTool = vi.fn().mockResolvedValueOnce([
      {
        uuid: 'mem-explicit',
        summary: JSON.stringify({
          content: 'Important preference',
          memory: { tier: 'explicit', source: 'user_explicit', score: 9 },
        }),
      },
      {
        uuid: 'mem-silent',
        summary: JSON.stringify({
          content: 'Background fact',
          memory: { tier: 'silent', source: 'auto_capture', score: 6 },
        }),
      },
    ]);

    const results = await adapter.recall('hello', { limit: 5, tier: 'explicit' });

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('mem-explicit');
    expect(results[0].metadata.tier).toBe('explicit');
  });

  it('returns partial edge write details and preserves source ids during consolidation', async () => {
    const adapter = new GraphitiMCPAdapter({ type: 'graphiti-mcp', groupId: 'default' });

    (adapter as any).store = vi.fn().mockResolvedValue('insight-1');
    (adapter as any).callTool = vi.fn().mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (
        name === 'add_memory' &&
        typeof args.episode_body === 'string' &&
        args.episode_body.includes('mem-2 SUPPORTS mem-4')
      ) {
        throw new Error('edge failed');
      }

      return {};
    });

    const result = await adapter.storeConsolidation(
      ['mem-1', 'mem-2'],
      'Merged summary',
      'Shared pattern',
      [
        { fromId: 'mem-1', toId: 'mem-3', relationship: 'RELATES_TO' },
        { fromId: 'mem-2', toId: 'mem-4', relationship: 'SUPPORTS' },
      ]
    );

    expect(result.requested).toBe(2);
    expect(result.created).toBe(1);
    expect(result.failures).toEqual([
      expect.objectContaining({
        fromId: 'mem-2',
        toId: 'mem-4',
        relationship: 'SUPPORTS',
        error: 'edge failed',
      }),
    ]);
    expect((adapter as any).callTool).toHaveBeenCalledWith(
      'add_memory',
      expect.objectContaining({
        group_id: 'default',
        episode_body: expect.stringContaining('mem-1 RELATES_TO mem-3'),
      })
    );
    expect((adapter as any).metadataPatches.get('mem-1')).toEqual(expect.objectContaining({ consolidated: true }));
    expect((adapter as any).metadataPatches.get('mem-2')).toEqual(expect.objectContaining({ consolidated: true }));
  });
});