/**
 * Memory Adapters Index
 *
 * Exports all adapters and factory functions for the Memory Cortex plugin.
 */

// Re-export types
export type {
  MemoryAdapter,
  MemoryMetadata,
  MemoryResult,
  RecallOptions,
  MemoryStats,
  HealthResult,
  GraphitiMCPConfig,
  Neo4jConfig,
  FalkorDBConfig,
  SQLiteConfig,
  BackendConfig,
  MemoryEvent,
  MemoryEventStream,
} from './memory-adapter.js';

// Re-export adapters
export { GraphitiMCPAdapter, createGraphitiMCPAdapter } from './graphiti-adapter.js';
export { Neo4jAdapter, createNeo4jAdapter } from './neo4j-adapter.js';

// Re-export factory
export { AdapterFactory, adapterFactory, createAdapterFromConfig } from './factory.js';
