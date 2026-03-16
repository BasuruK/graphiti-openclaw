/**
 * Graphiti MCP Adapter
 *
 * Implements MemoryAdapter using Graphiti MCP server via @modelcontextprotocol/sdk
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
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
import { getLogger } from '../logger.js';

const logger = getLogger('graphiti');

const DEFAULT_HTTP_ENDPOINT = 'http://localhost:8000/mcp/';
const DEFAULT_SSE_ENDPOINT = 'http://localhost:8000/sse';

function normalizeEndpointForTransport(
  endpoint: string | undefined,
  transport: GraphitiMCPConfig['transport']
): string | undefined {
  if (transport === 'stdio') {
    return endpoint;
  }

  const fallback = transport === 'http' ? DEFAULT_HTTP_ENDPOINT : DEFAULT_SSE_ENDPOINT;
  const rawEndpoint = endpoint || fallback;

  try {
    const url = new URL(rawEndpoint);

    if (transport === 'http') {
      if (url.pathname === '/' || url.pathname === '' || url.pathname === '/sse' || url.pathname === '/sse/') {
        url.pathname = '/mcp/';
      } else if (url.pathname === '/mcp') {
        url.pathname = '/mcp/';
      }
      return url.toString();
    }

    if (url.pathname === '/' || url.pathname === '') {
      url.pathname = '/sse';
    }

    return url.toString();
  } catch {
    return rawEndpoint;
  }
}

function formatConnectionError(config: GraphitiMCPConfig, err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);

  if (config.transport === 'sse' && message.includes('404')) {
    return new Error(
      `${message}. Graphiti HTTP transport uses /mcp/ rather than /sse. ` +
      `If your server is configured with server.transport=http, set Nuron transport to "http" ` +
      `and endpoint to "${DEFAULT_HTTP_ENDPOINT}".`
    );
  }

  if (config.transport === 'http' && (message.includes('404') || message.includes('406'))) {
    return new Error(
      `${message}. Verify Nuron is pointed at Graphiti's streamable HTTP endpoint, typically "${DEFAULT_HTTP_ENDPOINT}".`
    );
  }

  return err instanceof Error ? err : new Error(message);
}

export function normalizeGraphitiMCPConfig(config: GraphitiMCPConfig): GraphitiMCPConfig {
  return {
    ...config,
    endpoint: normalizeEndpointForTransport(config.endpoint, config.transport),
  };
}

type GraphitiNodeResult = {
  uuid?: string;
  name?: string;
  summary?: string;
  fact?: string;
  valid_at?: string;
  created_at?: string;
  content?: string;
};

type GraphitiEnvelope = {
  error?: string;
  message?: string;
  nodes?: GraphitiNodeResult[];
  facts?: GraphitiNodeResult[];
  episodes?: GraphitiNodeResult[];
};

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
    this.config = normalizeGraphitiMCPConfig(config);
    // @ts-ignore - MCP SDK type changes
    this.client = new Client(
      { name: 'nuron', version: '1.0.0' },
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
    } else if (this.config.transport === 'http') {
      const endpoint = this.config.endpoint || DEFAULT_HTTP_ENDPOINT;
      transport = new StreamableHTTPClientTransport(new URL(endpoint));
    } else {
      // SSE transport
      const endpoint = this.config.endpoint || DEFAULT_SSE_ENDPOINT;
      transport = new SSEClientTransport(new URL(endpoint));
    }

    try {
      await this.client.connect(transport);
      this.connected = true;
      logger.info(`Connected to Graphiti MCP server via ${this.config.transport}.`);
    } catch (err) {
      throw formatConnectionError(this.config, err);
    }
  }

  /**
   * Disconnect from Graphiti MCP server
   */
  async shutdown(): Promise<void> {
    if (this.connected) {
      await this.client.close();
      this.connected = false;
      logger.debug('Disconnected from Graphiti MCP server.');
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
      consolidated: metadata.consolidated || false,
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
          consolidated: mem.consolidated as boolean | undefined,
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

  private unwrapCollection(result: unknown, key: 'nodes' | 'facts' | 'episodes'): GraphitiNodeResult[] {
    if (Array.isArray(result)) {
      return result as GraphitiNodeResult[];
    }

    if (!result || typeof result !== 'object') {
      return [];
    }

    const envelope = result as GraphitiEnvelope;
    if (typeof envelope.error === 'string' && envelope.error.length > 0) {
      throw new Error(envelope.error);
    }

    const collection = envelope[key];
    return Array.isArray(collection) ? collection : [];
  }

  /**
   * Recall memories based on semantic query
   */
  async recall(query: string, options: RecallOptions): Promise<MemoryResult[]> {
    const results = await this.callTool('search_nodes', {
      group_ids: [this.config.groupId],
      query,
      max_nodes: options.limit,
    });

    const nodes = this.unwrapCollection(results, 'nodes');

    if (nodes.length === 0) {
      return [];
    }

    return nodes.map((r) => this.convertToMemoryResult(r));
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
      group_ids: [this.config.groupId],
      max_episodes: limit,
    });

    const episodes = this.unwrapCollection(results, 'episodes') as Array<{
      uuid: string;
      name: string;
      content: string;
      created_at: string;
    }>;

    if (episodes.length === 0) {
      return [];
    }

    let memories = episodes.map((r) => ({
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
      group_ids: [this.config.groupId],
      query: '',
      max_nodes: limit,
    });

    const nodes = this.unwrapCollection(results, 'nodes');

    if (nodes.length === 0) return [];

    return nodes
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
    const results = await this.callTool('search_memory_facts', {
      group_ids: [this.config.groupId],
      query: id,
      max_facts: depth * 5,
    });

    const facts = this.unwrapCollection(results, 'facts');

    if (facts.length === 0) {
      return [];
    }

    return facts.map((r) => this.convertToMemoryResult(r));
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<HealthResult> {
    try {
      const status = await this.callTool('get_status', {});
      if (status && typeof status === 'object' && 'error' in (status as Record<string, unknown>)) {
        throw new Error(String((status as Record<string, unknown>).error));
      }
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
   * Get unconsolidated memories for the Axon synthesis agent
   */
  async getUnconsolidatedMemories(limit = 10): Promise<MemoryResult[]> {
    // Fetch a large batch to filter client-side since Graphiti list doesn't currently filter by consolidated
    const allMemories = await this.list(Math.max(100, limit * 5));
    return allMemories.filter(m => !m.metadata.consolidated).slice(0, limit);
  }

  /**
   * Store the result of an Axon memory consolidation cycle.
   */
  async storeConsolidation(
    sourceIds: string[],
    summary: string,
    insight: string,
    connections: { fromId: string; toId: string; relationship: string }[]
  ): Promise<void> {
    // 1. Store the insight block as an explicit episode so Graphiti's LLM builds the temporal nodes
    const insightContent = `SYNTHESIZED INSIGHT: ${insight}\nSUMMARY: ${summary}\nCONNECTIONS IDENTIFIED:\n${connections.map(c => `- ${c.fromId} ${c.relationship} ${c.toId}`).join('\n')}`;
    
    await this.store(insightContent, {
      tier: 'explicit',
      source: 'agent_auto',
      tags: ['insight', 'synthesis'],
      consolidated: true, // Insights are pre-consolidated
      score: 10,
    });

    logger.info(`Stored insight for ${sourceIds.length} source memories.`);

    // 2. Create explicit relationship edges for each connection
    // We iterate the connections and call the Graphiti edge-creation tool
    for (const conn of connections) {
      try {
        await this.callTool('add_edge', {
          group_id: this.config.groupId,
          from_node_uuid: conn.fromId,
          to_node_uuid: conn.toId,
          label: conn.relationship,
        });
      } catch (err) {
        logger.error(`Failed to create edge ${conn.fromId} -> ${conn.toId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 3. Mark source memories as consolidated
    // NOTE: This loop is O(n*m) and costly because Graphiti lacks batch updates.
    // We are intentionally using a full fetch (list) + per-id update due to API limits.
    // Revisit for batch/filtered fetch or partial update when Graphiti exposes those capabilities.
    if (sourceIds.length > 0) {
      // Need to fetch them to update them since Graphiti doesn't have partial update.
      // Because list() only returns the most recent N items, grow the fetch window until
      // every source id is found or Graphiti returns fewer rows than requested.
      let limit = Math.max(200, sourceIds.length);
      let allMemories: MemoryResult[] = [];
      const missingIds = new Set(sourceIds);

      while (missingIds.size > 0) {
        allMemories = await this.list(limit);
        for (const mem of allMemories) {
          missingIds.delete(mem.id);
        }

        if (allMemories.length < limit) {
          break;
        }

        limit *= 2;
      }

      let updatedCount = 0;
      for (const id of sourceIds) {
        const mem = allMemories.find(m => m.id === id);
        if (mem) {
          await this.update(id, mem.content, {
            ...mem.metadata,
            consolidated: true
          });
          updatedCount += 1;
        } else {
          logger.warn(`Could not find source memory ${id} while marking memories as consolidated.`);
        }
      }
      logger.info(`Marked ${updatedCount} source memories as consolidated.`);
    }
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
  return new GraphitiMCPAdapter(normalizeGraphitiMCPConfig(config));
}
