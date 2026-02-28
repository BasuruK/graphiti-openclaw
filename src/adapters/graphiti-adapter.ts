/**
 * Graphiti MCP Adapter
 *
 * Implements MemoryAdapter using Graphiti MCP server via @modelcontextprotocol/sdk
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import {
  type MemoryAdapter,
  type MemoryMetadata,
  type MemoryResult,
  type RecallOptions,
  type MemoryStats,
  type HealthResult,
  type GraphitiMCPConfig,
} from './memory-adapter.js';

/**
 * Graphiti MCP Adapter
 *
 * Uses the official MCP SDK to communicate with Graphiti MCP server
 */
export class GraphitiMCPAdapter implements MemoryAdapter {
  private client: Client;
  private config: GraphitiMCPConfig;
  private connected = false;

  constructor(config: GraphitiMCPConfig) {
    this.config = config;
    // @ts-ignore - MCP SDK type changes
    this.client = new Client(
      { name: 'graphiti-memory-cortex', version: '1.0.0' },
      { capabilities: {} }
    );
  }

  /**
   * Connect to Graphiti MCP server
   */
  async initialize(): Promise<void> {
    if (this.connected) return;

    let transport: Transport;

    if (this.config.transport === 'stdio') {
      transport = new StdioClientTransport({
        command: this.config.command || 'uv',
        args: this.config.args || ['run', 'graphiti-mcp', '--transport', 'stdio'],
      });
    } else {
      // SSE transport
      const endpoint = this.config.endpoint || 'http://localhost:8000/sse';
      transport = new SSEClientTransport(new URL(endpoint));
    }

    await this.client.connect(transport);
    this.connected = true;
    console.log('[GraphitiMCPAdapter] Connected to Graphiti MCP server');
  }

  /**
   * Disconnect from Graphiti MCP server
   */
  async shutdown(): Promise<void> {
    if (this.connected) {
      await this.client.close();
      this.connected = false;
      console.log('[GraphitiMCPAdapter] Disconnected from Graphiti MCP server');
    }
  }

  /**
   * Make a tool call to Graphiti MCP server
   */
  private async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.connected) {
      await this.initialize();
    }

    const result = await this.client.callTool({
      name,
      arguments: args,
    });

    // Handle MCP response format
    const content = result.content;
    if (Array.isArray(content) && content.length > 0) {
      const text = content[0].text;
      if (typeof text === 'string') {
        try {
          return JSON.parse(text);
        } catch {
          return text;
        }
      }
    }

    return result;
  }

  /**
   * Store a new memory episode
   */
  async store(content: string, metadata: Partial<MemoryMetadata>): Promise<string> {
    // Extract tier from metadata for storage
    const tierPrefix = metadata.tier ? `[${metadata.tier.toUpperCase()}] ` : '';

    // Build episode name from metadata
    const name = metadata.sessionId
      ? `session-${metadata.sessionId}-${Date.now()}`
      : `episode-${Date.now()}`;

    // Include metadata in content for extraction
    const enrichedContent = this.buildEnrichedContent(content, metadata);

    const result = await this.callTool('add_memory', {
      group_id: this.config.groupId,
      episode_body: enrichedContent,
      name,
    }) as { uuid?: string };

    return result?.uuid || name;
  }

  /**
   * Build enriched content with metadata
   */
  private buildEnrichedContent(content: string, metadata: Partial<MemoryMetadata>): string {
    const memoryData: Record<string, unknown> = {
      tier: metadata.tier || 'silent',
      score: metadata.score || 5,
      source: metadata.source || 'auto_capture',
      createdAt: new Date().toISOString(),
    };

    if (metadata.sessionId) memoryData.sessionId = metadata.sessionId;
    if (metadata.expiresAt) memoryData.expiresAt = metadata.expiresAt.toISOString();
    if (metadata.tags) memoryData.tags = metadata.tags;

    const meta: Record<string, unknown> = {
      content,
      memory: memoryData,
    };

    return JSON.stringify(meta);
  }

  /**
   * Parse metadata from stored content
   */
  private parseMetadata(content: string): Partial<MemoryMetadata> {
    try {
      const parsed = JSON.parse(content) as Record<string, unknown>;
      if (parsed.memory && typeof parsed.memory === 'object') {
        const mem = parsed.memory as Record<string, unknown>;
        return {
          tier: mem.tier as 'explicit' | 'silent' | 'ephemeral' | undefined,
          score: mem.score as number | undefined,
          source: mem.source as 'auto_capture' | 'user_explicit' | 'agent_auto' | undefined,
          sessionId: mem.sessionId as string | undefined,
          expiresAt: mem.expiresAt ? new Date(mem.expiresAt as string) : undefined,
          tags: mem.tags as string[] | undefined,
        };
      }
      // Fallback: check for tier prefix in raw content
      const tierMatch = content.match(/^\[(EPHEMERAL|SILENT|EXPLICIT)\]/i);
      if (tierMatch) {
        return {
          tier: tierMatch[1].toLowerCase() as 'explicit' | 'silent' | 'ephemeral',
        };
      }
    } catch {
      // Not JSON, check for tier prefix
      const tierMatch = content.match(/^\[(EPHEMERAL|SILENT|EXPLICIT)\]/i);
      if (tierMatch) {
        return {
          tier: tierMatch[1].toLowerCase() as 'explicit' | 'silent' | 'ephemeral',
        };
      }
    }
    return { tier: 'silent', score: 5 };
  }

  /**
   * Extract actual content from enriched storage
   */
  private extractContent(content: string): string {
    try {
      const parsed = JSON.parse(content);
      return parsed.content || content;
    } catch {
      return content;
    }
  }

  /**
   * Recall memories based on semantic query
   */
  async recall(query: string, options: RecallOptions): Promise<MemoryResult[]> {
    const results = await this.callTool('search_nodes', {
      group_id: this.config.groupId,
      query,
      limit: options.limit,
    }) as Array<{
      uuid?: string;
      name?: string;
      summary?: string;
      fact?: string;
      valid_at?: string;
    }>;

    if (!results || results.length === 0) {
      return [];
    }

    return results.map((r) => this.convertToMemoryResult(r));
  }

  /**
   * Convert Graphiti result to MemoryResult
   */
  private convertToMemoryResult(result: {
    uuid?: string;
    name?: string;
    summary?: string;
    fact?: string;
    valid_at?: string;
  }): MemoryResult {
    const content = result.summary || result.fact || result.name || '';
    const metadata = this.parseMetadata(content);

    return {
      id: result.uuid || result.name || `unknown-${Date.now()}`,
      content: this.extractContent(content),
      summary: result.summary,
      relevanceScore: 0.8, // Graphiti doesn't expose relevance directly
      metadata: {
        tier: metadata.tier || 'silent',
        score: metadata.score || 5,
        source: metadata.source || 'auto_capture',
        createdAt: new Date(),
        reinforcementCount: 0,
      },
      validAt: result.valid_at ? new Date(result.valid_at) : undefined,
    };
  }

  /**
   * Delete a memory
   */
  async forget(id: string): Promise<void> {
    await this.callTool('delete_episode', {
      group_id: this.config.groupId,
      uuid: id,
    });
  }

  /**
   * Update an existing memory
   */
  async update(id: string, content: string, metadata?: Partial<MemoryMetadata>): Promise<void> {
    // Delete old and create new (Graphiti doesn't have direct update)
    await this.forget(id);
    await this.store(content, metadata || {});
  }

  /**
   * List memories
   */
  async list(limit = 10, tier?: 'explicit' | 'silent' | 'ephemeral' | 'all'): Promise<MemoryResult[]> {
    const results = await this.callTool('get_episodes', {
      group_id: this.config.groupId,
      limit,
    }) as Array<{
      uuid: string;
      name: string;
      content: string;
      created_at: string;
    }>;

    if (!results || results.length === 0) {
      return [];
    }

    let memories = results.map((r) => ({
      id: r.uuid,
      content: this.extractContent(r.content),
      summary: r.content.substring(0, 200),
      relevanceScore: 0.8,
      metadata: {
        ...this.parseMetadata(r.content),
        createdAt: new Date(r.created_at),
        reinforcementCount: 0,
      } as MemoryMetadata,
      validAt: new Date(r.created_at),
    }));

    // Filter by tier if specified
    if (tier && tier !== 'all') {
      memories = memories.filter((m) => m.metadata.tier === tier);
    }

    return memories;
  }

  /**
   * Search by entity name
   */
  async searchByEntity(entityName: string, limit = 10): Promise<MemoryResult[]> {
    return this.recall(entityName, { limit, tier: 'all' });
  }

  /**
   * Search by time range
   */
  async searchByTimeRange(start: Date, end: Date, limit = 10): Promise<MemoryResult[]> {
    // Graphiti supports bi-temporal queries
    const results = await this.callTool('search_nodes', {
      group_id: this.config.groupId,
      query: '',
      limit,
    }) as Array<{
      uuid?: string;
      name?: string;
      summary?: string;
      fact?: string;
      valid_at?: string;
    }>;

    if (!results) return [];

    return results
      .filter((r) => {
        if (!r.valid_at) return false;
        const validAt = new Date(r.valid_at);
        return validAt >= start && validAt <= end;
      })
      .map((r) => this.convertToMemoryResult(r));
  }

  /**
   * Get related memories via graph traversal
   */
  async getRelated(id: string, depth = 2): Promise<MemoryResult[]> {
    // Use search_facts to find related entities
    const results = await this.callTool('search_facts', {
      group_id: this.config.groupId,
      query: id,
      limit: depth * 5,
    }) as Array<{
      uuid?: string;
      name?: string;
      summary?: string;
      fact?: string;
    }>;

    if (!results || results.length === 0) {
      return [];
    }

    return results.map((r) => this.convertToMemoryResult(r));
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<HealthResult> {
    try {
      await this.callTool('get_status', {});
      return {
        healthy: true,
        backend: 'graphiti-mcp',
      };
    } catch (err) {
      return {
        healthy: false,
        backend: 'graphiti-mcp',
        details: { error: err instanceof Error ? err.message : String(err) },
      };
    }
  }

  /**
   * Get memory statistics
   */
  async getStats(): Promise<MemoryStats> {
    const episodes = await this.list(100);

    const byTier = {
      explicit: 0,
      silent: 0,
      ephemeral: 0,
    };

    let oldest: Date | undefined;
    let newest: Date | undefined;

    for (const episode of episodes) {
      byTier[episode.metadata.tier]++;

      if (!oldest || episode.metadata.createdAt < oldest) {
        oldest = episode.metadata.createdAt;
      }
      if (!newest || episode.metadata.createdAt > newest) {
        newest = episode.metadata.createdAt;
      }
    }

    return {
      totalCount: episodes.length,
      byTier,
      oldestMemory: oldest,
      newestMemory: newest,
    };
  }

  /**
   * Cleanup expired memories
   */
  async cleanup(): Promise<{ deleted: number; upgraded: number }> {
    const episodes = await this.list(100);
    let deleted = 0;
    let upgraded = 0;
    const now = Date.now();

    for (const episode of episodes) {
      if (episode.metadata.tier !== 'ephemeral') continue;

      // Check if expired
      if (episode.metadata.expiresAt && episode.metadata.expiresAt.getTime() < now) {
        await this.forget(episode.id);
        deleted++;
      } else if (episode.metadata.reinforcementCount > 2) {
        // Upgrade to silent if reinforced
        await this.update(episode.id, episode.content, {
          ...episode.metadata,
          tier: 'silent',
        });
        upgraded++;
      }
    }

    return { deleted, upgraded };
  }

  /**
   * Get backend type
   */
  getBackendType(): string {
    return 'graphiti-mcp';
  }
}

/**
 * Factory function to create Graphiti MCP adapter
 */
export function createGraphitiMCPAdapter(config: GraphitiMCPConfig): MemoryAdapter {
  return new GraphitiMCPAdapter(config);
}
