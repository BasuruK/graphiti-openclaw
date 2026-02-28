/**
 * Neo4j Direct Adapter
 *
 * Implements MemoryAdapter using direct Neo4j Bolt protocol.
 * This adapter is designed for users who want direct Neo4j access
 * without going through Graphiti MCP server.
 */

import { driver, type Driver, type Session, type QueryResult, type Record } from 'neo4j-driver';

import {
  type MemoryAdapter,
  type MemoryMetadata,
  type MemoryResult,
  type RecallOptions,
  type MemoryStats,
  type HealthResult,
  type Neo4jConfig,
} from './memory-adapter.js';

/**
 * Neo4j Direct Adapter
 *
 * Provides direct Neo4j access for memory operations.
 * Supports semantic search via embeddings if configured.
 */
export class Neo4jAdapter implements MemoryAdapter {
  private driver: Driver | null = null;
  private config: Neo4jConfig;
  private session: Session | null = null;

  constructor(config: Neo4jConfig) {
    this.config = config;
  }

  /**
   * Initialize connection to Neo4j
   */
  async initialize(): Promise<void> {
    if (this.driver) return;

    // @ts-ignore - Neo4j driver v5 API
    this.driver = driver(this.config.uri, {
      // @ts-ignore - Neo4j driver v5 API
      auth: {
        username: this.config.user,
        password: this.config.password,
      },
    });

    // Verify connection
    // @ts-ignore - Neo4j driver v5 API
    await this.driver.verifyConnectivity();
    console.log('[Neo4jAdapter] Connected to Neo4j');

    // Create indexes if they don't exist
    await this.createIndexes();
  }

  /**
   * Create necessary Neo4j indexes
   */
  private async createIndexes(): Promise<void> {
    if (!this.driver) return;

    const session = this.driver.session({ database: this.config.database });

    try {
      // Create memory node index
      await session.run(`
        CREATE INDEX memory_id IF NOT EXISTS FOR (m:Memory) ON (m.id)
      `);

      // Create tier index
      await session.run(`
        CREATE INDEX memory_tier IF NOT EXISTS FOR (m:Memory) ON (m.tier)
      `);

      // Create timestamp index
      await session.run(`
        CREATE INDEX memory_created IF NOT EXISTS FOR (m:Memory) ON (m.createdAt)
      `);

      // Create embedding index if using vector search
      if (this.config.embedding) {
        await session.run(`
          CREATE INDEX memory_embedding IF NOT EXISTS FOR (m:Memory) ON (m.embedding)
        `).catch(() => {
          // Vector index may not be supported in all Neo4j versions
          console.warn('[Neo4jAdapter] Vector index not supported, using full-text search');
        });
      }

      console.log('[Neo4jAdapter] Indexes created/verified');
    } finally {
      await session.close();
    }
  }

  /**
   * Shutdown Neo4j connection
   */
  async shutdown(): Promise<void> {
    if (this.driver) {
      await this.driver.close();
      this.driver = null;
      console.log('[Neo4jAdapter] Disconnected from Neo4j');
    }
  }

  /**
   * Get a Neo4j session
   */
  private getSession(): Session {
    if (!this.driver) {
      throw new Error('Neo4j driver not initialized. Call initialize() first.');
    }
    return this.driver.session({ database: this.config.database });
  }

  /**
   * Store a new memory
   */
  async store(content: string, metadata: Partial<MemoryMetadata>): Promise<string> {
    const session = this.getSession();
    const id = metadata.sessionId
      ? `memory-${metadata.sessionId}-${Date.now()}`
      : `memory-${Date.now()}`;

    const now = new Date();
    const tier = metadata.tier || 'silent';
    const score = metadata.score ?? 5;

    try {
      await session.run(
        `
        CREATE (m:Memory {
          id: $id,
          content: $content,
          tier: $tier,
          score: $score,
          source: $source,
          tags: $tags,
          createdAt: $createdAt,
          expiresAt: $expiresAt,
          lastReinforced: $lastReinforced,
          reinforcementCount: $reinforcementCount
        })
        RETURN m.id AS id
      `,
        {
          id,
          content,
          tier,
          score,
          source: metadata.source || 'auto_capture',
          tags: metadata.tags || [],
          createdAt: now.toISOString(),
          expiresAt: metadata.expiresAt?.toISOString() || null,
          lastReinforced: metadata.lastReinforced?.toISOString() || null,
          reinforcementCount: metadata.reinforcementCount || 0,
        }
      );

      return id;
    } finally {
      await session.close();
    }
  }

  /**
   * Recall memories based on query
   */
  async recall(query: string, options: RecallOptions): Promise<MemoryResult[]> {
    const session = this.getSession();

    // Build query based on whether embeddings are configured
    let cypher: string;
    let params: any;

    if (this.config.embedding) {
      // Vector search (requires embedding generation)
      // For now, fall back to full-text search
      cypher = `
        MATCH (m:Memory)
        WHERE m.tier IN $tiers
        AND (m.content CONTAINS $query OR m.id CONTAINS $query)
        RETURN m.id AS id, m.content AS content, m.tier AS tier,
               m.score AS score, m.source AS source, m.createdAt AS createdAt,
               m.expiresAt AS expiresAt, m.reinforcementCount AS reinforcementCount,
               m.lastReinforced AS lastReinforced, m.tags AS tags
        ORDER BY m.score DESC, m.createdAt DESC
        LIMIT $limit
      `;
    } else {
      // Full-text search
      cypher = `
        MATCH (m:Memory)
        WHERE m.tier IN $tiers
        AND (m.content CONTAINS $query OR m.id CONTAINS $query)
        RETURN m.id AS id, m.content AS content, m.tier AS tier,
               m.score AS score, m.source AS source, m.createdAt AS createdAt,
               m.expiresAt AS expiresAt, m.reinforcementCount AS reinforcementCount,
               m.lastReinforced AS lastReinforced, m.tags AS tags
        ORDER BY m.score DESC, m.createdAt DESC
        LIMIT $limit
      `;
    }

    const tiers = options.tier && options.tier !== 'all'
      ? [options.tier]
      : ['explicit', 'silent', 'ephemeral'];

    params = {
      query,
      limit: options.limit,
      tiers,
    } as any;

    try {
      const result = await session.run(cypher, params as any);
      return this.mapResults(result);
    } finally {
      await session.close();
    }
  }

  /**
   * Map Neo4j results to MemoryResult[]
   */
  private mapResults(result: QueryResult): MemoryResult[] {
    const records = result.records;
    if (!records || records.length === 0) {
      return [];
    }

    return records.map((record: any) => ({
      id: record.get('id'),
      content: record.get('content'),
      relevanceScore: (record.get('score') || 0) / 10,
      metadata: {
        tier: (record.get('tier') || 'silent') as 'explicit' | 'silent' | 'ephemeral',
        score: record.get('score') ?? 5,
        source: record.get('source') || 'auto_capture',
        createdAt: new Date(record.get('createdAt')),
        expiresAt: record.get('expiresAt') ? new Date(record.get('expiresAt')) : undefined,
        lastReinforced: record.get('lastReinforced')
          ? new Date(record.get('lastReinforced'))
          : undefined,
        reinforcementCount: record.get('reinforcementCount') || 0,
        tags: record.get('tags') || [],
      },
    }));
  }

  /**
   * Delete a memory
   */
  async forget(id: string): Promise<void> {
    const session = this.getSession();

    try {
      await session.run(
        `
        MATCH (m:Memory {id: $id})
        DETACH DELETE m
      `,
        { id }
      );
    } finally {
      await session.close();
    }
  }

  /**
   * Update an existing memory
   */
  async update(id: string, content: string, metadata?: Partial<MemoryMetadata>): Promise<void> {
    const session = this.getSession();

    const updates: string[] = ['content: $content'];
    const params: any = { id, content };

    if (metadata?.tier) {
      updates.push('tier: $tier');
      params.tier = metadata.tier;
    }
    if (metadata?.score !== undefined) {
      updates.push('score: $score');
      params.score = metadata.score;
    }
    if (metadata?.expiresAt) {
      updates.push('expiresAt: $expiresAt');
      params.expiresAt = metadata.expiresAt.toISOString();
    }

    try {
      await session.run(
        `
        MATCH (m:Memory {id: $id})
        SET m += {
          ${updates.join(', ')}
        }
      `,
        params
      );
    } finally {
      await session.close();
    }
  }

  /**
   * List memories
   */
  async list(limit = 10, tier?: 'explicit' | 'silent' | 'ephemeral' | 'all'): Promise<MemoryResult[]> {
    const session = this.getSession();

    let cypher: string;
    const params: any = { limit };

    if (tier && tier !== 'all') {
      cypher = `
        MATCH (m:Memory {tier: $tier})
        RETURN m.id AS id, m.content AS content, m.tier AS tier,
               m.score AS score, m.source AS source, m.createdAt AS createdAt,
               m.expiresAt AS expiresAt, m.reinforcementCount AS reinforcementCount,
               m.lastReinforced AS lastReinforced, m.tags AS tags
        ORDER BY m.createdAt DESC
        LIMIT $limit
      `;
      params.tier = tier;
    } else {
      cypher = `
        MATCH (m:Memory)
        RETURN m.id AS id, m.content AS content, m.tier AS tier,
               m.score AS score, m.source AS source, m.createdAt AS createdAt,
               m.expiresAt AS expiresAt, m.reinforcementCount AS reinforcementCount,
               m.lastReinforced AS lastReinforced, m.tags AS tags
        ORDER BY m.createdAt DESC
        LIMIT $limit
      `;
    }

    try {
      const result = await session.run(cypher, params as any);
      return this.mapResults(result);
    } finally {
      await session.close();
    }
  }

  /**
   * Search by entity name
   */
  async searchByEntity(entityName: string, limit = 10): Promise<MemoryResult[]> {
    // Search for memories containing the entity
    return this.recall(entityName, { limit, tier: 'all' });
  }

  /**
   * Search by time range
   */
  async searchByTimeRange(start: Date, end: Date, limit = 10): Promise<MemoryResult[]> {
    const session = this.getSession();

    const cypher = `
      MATCH (m:Memory)
      WHERE m.createdAt >= $start AND m.createdAt <= $end
      RETURN m.id AS id, m.content AS content, m.tier AS tier,
             m.score AS score, m.source AS source, m.createdAt AS createdAt,
             m.expiresAt AS expiresAt, m.reinforcementCount AS reinforcementCount,
             m.lastReinforced AS lastReinforced, m.tags AS tags
      ORDER BY m.createdAt DESC
      LIMIT $limit
    `;

    try {
      const result = await session.run(cypher, {
        start: start.toISOString(),
        end: end.toISOString(),
        limit,
      });
      return this.mapResults(result);
    } finally {
      await session.close();
    }
  }

  /**
   * Get related memories via graph traversal
   */
  async getRelated(id: string, depth = 2): Promise<MemoryResult[]> {
    const session = this.getSession();

    // Find memories that share similar content or tags
    const cypher = `
      MATCH (m1:Memory {id: $id})
      MATCH (m2:Memory)
      WHERE m1.id <> m2.id
        AND (
          m2.content CONTAINS substring(m1.content, 0, 50)
          OR any(tag IN m2.tags WHERE tag IN m1.tags)
        )
      RETURN m2.id AS id, m2.content AS content, m2.tier AS tier,
             m2.score AS score, m2.source AS source, m2.createdAt AS createdAt,
             m2.expiresAt AS expiresAt, m2.reinforcementCount AS reinforcementCount,
             m2.lastReinforced AS lastReinforced, m2.tags AS tags
      ORDER BY m2.score DESC
      LIMIT $limit
    `;

    try {
      const result = await session.run(cypher, { id, limit: depth * 5 });
      return this.mapResults(result);
    } finally {
      await session.close();
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<HealthResult> {
    if (!this.driver) {
      return {
        healthy: false,
        backend: 'neo4j',
        details: { error: 'Driver not initialized' },
      };
    }

    try {
      const session = this.getSession();
      await session.run('RETURN 1 AS n');
      await session.close();

      return {
        healthy: true,
        backend: 'neo4j',
        details: {
          uri: this.config.uri,
          database: this.config.database || 'neo4j',
        },
      };
    } catch (err) {
      return {
        healthy: false,
        backend: 'neo4j',
        details: { error: err instanceof Error ? err.message : String(err) },
      };
    }
  }

  /**
   * Get memory statistics
   */
  async getStats(): Promise<MemoryStats> {
    const session = this.getSession();

    const cypher = `
      MATCH (m:Memory)
      RETURN
        count(m) AS total,
        sum(CASE WHEN m.tier = 'explicit' THEN 1 ELSE 0 END) AS explicit,
        sum(CASE WHEN m.tier = 'silent' THEN 1 ELSE 0 END) AS silent,
        sum(CASE WHEN m.tier = 'ephemeral' THEN 1 ELSE 0 END) AS ephemeral,
        min(m.createdAt) AS oldest,
        max(m.createdAt) AS newest
    `;

    try {
      const result = await session.run(cypher);
      const record = result.records[0];

      return {
        totalCount: record.get('total') || 0,
        byTier: {
          explicit: record.get('explicit') || 0,
          silent: record.get('silent') || 0,
          ephemeral: record.get('ephemeral') || 0,
        },
        oldestMemory: record.get('oldest') ? new Date(record.get('oldest')) : undefined,
        newestMemory: record.get('newest') ? new Date(record.get('newest')) : undefined,
      };
    } finally {
      await session.close();
    }
  }

  /**
   * Cleanup expired memories
   */
  async cleanup(): Promise<{ deleted: number; upgraded: number }> {
    const session = this.getSession();
    const now = new Date().toISOString();

    // Delete expired ephemeral memories
    const deleteCypher = `
      MATCH (m:Memory {tier: 'ephemeral'})
      WHERE m.expiresAt IS NOT NULL AND m.expiresAt < $now
      DETACH DELETE m
      RETURN count(m) AS deleted
    `;

    // Upgrade reinforced ephemeral memories
    const upgradeCypher = `
      MATCH (m:Memory {tier: 'ephemeral'})
      WHERE m.reinforcementCount >= 2
      SET m.tier = 'silent'
      RETURN count(m) AS upgraded
    `;

    try {
      const deleteResult = await session.run(deleteCypher, { now });
      const deleted = deleteResult.records[0]?.get('deleted') || 0;

      const upgradeResult = await session.run(upgradeCypher);
      const upgraded = upgradeResult.records[0]?.get('upgraded') || 0;

      return { deleted, upgraded };
    } finally {
      await session.close();
    }
  }

  /**
   * Get backend type
   */
  getBackendType(): string {
    return 'neo4j';
  }
}

/**
 * Factory function to create Neo4j adapter
 */
export function createNeo4jAdapter(config: Neo4jConfig): MemoryAdapter {
  return new Neo4jAdapter(config);
}
