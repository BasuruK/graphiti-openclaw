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
  MemoryDisposition,
  MemoryKind,
  SourceLogReference,
  RecallOptions,
  MemoryStats,
  HealthResult,
  GraphitiMCPConfig,
  FalkorDBConfig,
  SQLiteConfig,
  BackendConfig,
  MemoryEvent,
  MemoryEventStream,
} from './memory-adapter.js';

// Re-export adapters
export { GraphitiMCPAdapter, createGraphitiMCPAdapter } from './graphiti-adapter.js';

// Re-export factory
export { AdapterFactory, adapterFactory, createAdapterFromConfig } from './factory.js';
