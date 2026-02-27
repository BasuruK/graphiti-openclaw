/**
 * Memory Adapter Interface
 *
 * Backend-agnostic interface for memory operations.
 * Supports multiple backends: Graphiti MCP, Neo4j Direct, FalkorDB, SQLite, etc.
 */

import type { Readable } from 'stream';

/**
 * Memory metadata stored with each memory
 */
export interface MemoryMetadata {
  /** Memory importance tier */
  tier: 'explicit' | 'silent' | 'ephemeral';
  /** Importance score 0-10 */
  score: number;
  /** Expiration timestamp (for ephemeral memories) */
  expiresAt?: Date;
  /** Session ID where memory was created */
  sessionId?: string;
  /** Source of memory creation */
  source: 'auto_capture' | 'user_explicit' | 'agent_auto';
  /** Optional tags for categorization */
  tags?: string[];
  /** Creation timestamp */
  createdAt: Date;
  /** Last time memory was accessed/reinforced */
  lastReinforced?: Date;
  /** Number of times memory was referenced */
  reinforcementCount: number;
  /** Previous score if downgraded */
  downgradedFrom?: number;
}

/**
 * Result from a memory recall/search operation
 */
export interface MemoryResult {
  /** Unique identifier */
  id: string;
  /** Memory content */
  content: string;
  /** Summary (if available) */
  summary?: string;
  /** Associated entities */
  entities?: string[];
  /** Search relevance score */
  relevanceScore: number;
  /** Memory metadata */
  metadata: MemoryMetadata;
  /** Validity time (for temporal queries) */
  validAt?: Date;
  /** Invalidated time (for temporal queries) */
  invalidAt?: Date;
}

/**
 * Options for recall operations
 */
export interface RecallOptions {
  /** Maximum results to return */
  limit: number;
  /** Minimum relevance score */
  minScore?: number;
  /** Filter by memory tier */
  tier?: 'explicit' | 'silent' | 'ephemeral' | 'all';
  /** Time range filter */
  timeRange?: { start: Date; end: Date };
  /** Include related memories */
  includeRelated?: boolean;
}

/**
 * Memory statistics
 */
export interface MemoryStats {
  /** Total memory count */
  totalCount: number;
  /** Count by tier */
  byTier: {
    explicit: number;
    silent: number;
    ephemeral: number;
  };
  /** Oldest memory timestamp */
  oldestMemory?: Date;
  /** Newest memory timestamp */
  newestMemory?: Date;
}

/**
 * Health check result
 */
export interface HealthResult {
  /** Whether the backend is healthy */
  healthy: boolean;
  /** Backend type */
  backend: string;
  /** Additional details */
  details?: Record<string, unknown>;
}

/**
 * Backend configuration types
 */
export interface GraphitiMCPConfig {
  type: 'graphiti-mcp';
  /** MCP transport type */
  transport: 'stdio' | 'sse';
  /** For stdio: command to run (e.g., 'uv', 'python') */
  command?: string;
  /** For stdio: command arguments */
  args?: string[];
  /** For SSE: endpoint URL */
  endpoint?: string;
  /** Memory group ID */
  groupId: string;
}

export interface Neo4jConfig {
  type: 'neo4j';
  /** Bolt connection URI */
  uri: string;
  /** Database name */
  database?: string;
  /** Username */
  user: string;
  /** Password */
  password: string;
  /** Use embedding service for semantic search */
  embedding?: {
    provider: 'openai' | 'anthropic' | 'local';
    model?: string;
    endpoint?: string;
    apiKey?: string;
  };
}

export interface FalkorDBConfig {
  type: 'falkordb';
  /** Connection URL */
  url: string;
  /** Database name */
  database?: number;
  /** Username */
  username?: string;
  /** Password */
  password?: string;
}

export interface SQLiteConfig {
  type: 'sqlite';
  /** Path to SQLite database */
  path: string;
  /** Embedding provider for semantic search */
  embedding: {
    provider: 'openai' | 'anthropic' | 'local';
    model?: string;
    endpoint?: string;
    apiKey?: string;
  };
}

export type BackendConfig = GraphitiMCPConfig | Neo4jConfig | FalkorDBConfig | SQLiteConfig;

/**
 * Core memory adapter interface
 * All memory backends must implement this interface
 */
export interface MemoryAdapter {
  /**
   * Initialize the adapter and establish connections
   */
  initialize(): Promise<void>;

  /**
   * Shutdown the adapter and cleanup resources
   */
  shutdown(): Promise<void>;

  /**
   * Store a new memory
   * @param content - Memory content
   * @param metadata - Memory metadata
   * @returns Memory ID
   */
  store(content: string, metadata: Partial<MemoryMetadata>): Promise<string>;

  /**
   * Recall memories based on query
   * @param query - Search query
   * @param options - Recall options
   * @returns Array of matching memories
   */
  recall(query: string, options: RecallOptions): Promise<MemoryResult[]>;

  /**
   * Forget/delete a memory
   * @param id - Memory ID to delete
   */
  forget(id: string): Promise<void>;

  /**
   * Update an existing memory
   * @param id - Memory ID
   * @param content - New content
   * @param metadata - Optional metadata updates
   */
  update(id: string, content: string, metadata?: Partial<MemoryMetadata>): Promise<void>;

  /**
   * Get all memories with optional filters
   * @param limit - Maximum results
   * @param tier - Optional tier filter
   */
  list(limit?: number, tier?: 'explicit' | 'silent' | 'ephemeral' | 'all'): Promise<MemoryResult[]>;

  /**
   * Search by specific entity name
   */
  searchByEntity(entityName: string, limit?: number): Promise<MemoryResult[]>;

  /**
   * Search by time range
   */
  searchByTimeRange(start: Date, end: Date, limit?: number): Promise<MemoryResult[]>;

  /**
   * Get related memories (graph traversal)
   */
  getRelated(id: string, depth?: number): Promise<MemoryResult[]>;

  /**
   * Health check
   */
  healthCheck(): Promise<HealthResult>;

  /**
   * Get memory statistics
   */
  getStats(): Promise<MemoryStats>;

  /**
   * Cleanup expired memories
   * @returns Number of memories cleaned up
   */
  cleanup(): Promise<{ deleted: number; upgraded: number }>;

  /**
   * Get backend type identifier
   */
  getBackendType(): string;
}

/**
 * Adapter factory for creating the appropriate adapter
 */
export interface AdapterFactory {
  /**
   * Create a memory adapter from configuration
   */
  create(config: BackendConfig): MemoryAdapter;

  /**
   * Auto-detect available backends and create adapter
   * @param config - Optional explicit config, otherwise auto-detect
   */
  autoDetect(config?: Partial<BackendConfig>): Promise<MemoryAdapter>;

  /**
   * Get list of supported backend types
   */
  getSupportedBackends(): string[];
}

/**
 * Event types for memory operations
 */
export interface MemoryEvent {
  type: 'stored' | 'recalled' | 'forgotten' | 'updated' | 'upgraded' | 'downgraded';
  memoryId: string;
  timestamp: Date;
  details?: Record<string, unknown>;
}

/**
 * Memory events stream (for hooks)
 */
export interface MemoryEventStream {
  on(event: MemoryEvent['type'], handler: (event: MemoryEvent) => void): void;
  off(event: MemoryEvent['type'], handler: (event: MemoryEvent) => void): void;
  stream(): Readable;
}
