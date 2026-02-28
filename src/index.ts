/**
 * Graphiti Memory Plugin for OpenClaw
 *
 * A temporal knowledge graph memory system that provides:
 * - Native memory tools (recall, store, forget, status, list, consolidate, analyze)
 * - Auto-recall before each agent turn
 * - Auto-capture after each conversation
 * - Adaptive importance scoring (Memory Cortex)
 *
 * Uses pluggable backends: Graphiti MCP server, Neo4j direct, etc.
 *
 * ## Upgrade Notes
 * - v1.1.0: Plugin ID renamed from 'graphiti' to 'graphiti-memory'.
 *   On startup, any persisted config keyed under the old ID is automatically
 *   migrated to the new ID. No manual intervention is needed.
 */

import { registerTools } from './tools.js';
import { registerHooks } from './hooks.js';
import { adapterFactory, createAdapterFromConfig } from './adapters/factory.js';
import type { MemoryAdapter } from './adapters/memory-adapter.js';
import type { BackendConfig } from './adapters/memory-adapter.js';

/** Previous plugin IDs for migration compatibility */
const LEGACY_PLUGIN_IDS = ['graphiti'];

/**
 * Migrate settings persisted under a legacy plugin ID to the current one.
 * If the host API exposes a settings store, copies old-keyed settings to the
 * new key and optionally removes the old entries.
 */
function migratePluginSettings(api: any, currentId: string): void {
  for (const oldId of LEGACY_PLUGIN_IDS) {
    try {
      // Check common host API patterns for persisted settings
      const store = api?.settingsStore ?? api?.configStore;
      if (!store) break;

      const oldSettings = typeof store.get === 'function' ? store.get(oldId) : undefined;
      if (oldSettings) {
        console.log(`[graphiti-memory] Migrating persisted settings from legacy ID '${oldId}' to '${currentId}'`);
        if (typeof store.set === 'function') {
          store.set(currentId, oldSettings);
        }
        if (typeof store.delete === 'function') {
          store.delete(oldId);
        }
      }
    } catch (err) {
      console.warn(`[graphiti-memory] Settings migration from '${oldId}' failed:`, err instanceof Error ? err.message : String(err));
    }
  }
}

/**
 * Validate and coerce scoring config values from user input.
 * Enforces: ephemeralThreshold >= 0, explicitThreshold > ephemeralThreshold,
 * ephemeralHours >= 1, silentDays >= 1, cleanupHours >= 1.
 */
function validateScoringConfig(config: Record<string, unknown>): void {
  const ephemeralThreshold = config.scoringEphemeralThreshold as number | undefined;
  const explicitThreshold = config.scoringExplicitThreshold as number | undefined;

  if (ephemeralThreshold != null && ephemeralThreshold < 0) {
    console.warn('[graphiti-memory] scoringEphemeralThreshold must be >= 0, clamping to 0');
    config.scoringEphemeralThreshold = 0;
  }
  if (explicitThreshold != null && ephemeralThreshold != null && explicitThreshold <= ephemeralThreshold) {
    console.warn('[graphiti-memory] scoringExplicitThreshold must be > scoringEphemeralThreshold, adjusting');
    config.scoringExplicitThreshold = (ephemeralThreshold as number) + 1;
  }
  if (config.scoringEphemeralHours != null && (config.scoringEphemeralHours as number) < 1) {
    console.warn('[graphiti-memory] scoringEphemeralHours must be >= 1, clamping to 1');
    config.scoringEphemeralHours = 1;
  }
  if (config.scoringSilentDays != null && (config.scoringSilentDays as number) < 1) {
    console.warn('[graphiti-memory] scoringSilentDays must be >= 1, clamping to 1');
    config.scoringSilentDays = 1;
  }
  if (config.scoringCleanupHours != null && (config.scoringCleanupHours as number) < 1) {
    console.warn('[graphiti-memory] scoringCleanupHours must be >= 1, clamping to 1');
    config.scoringCleanupHours = 1;
  }
}

export default {
  id: 'graphiti-memory',
  /** Legacy IDs for migration compatibility */
  legacyIds: LEGACY_PLUGIN_IDS,
  name: 'Graphiti Memory',
  description: 'Temporal knowledge graph memory for OpenClaw with adaptive importance scoring',

  configSchema: {
    type: 'object',
    properties: {
      // Backend configuration
      backend: {
        type: 'string',
        enum: ['graphiti-mcp', 'neo4j', 'auto'],
        default: 'auto',
        description: 'Memory backend to use: graphiti-mcp, neo4j, or auto-detect'
      },

      // Connection - Graphiti MCP
      endpoint: {
        type: 'string',
        default: 'http://localhost:8000/sse',
        description: 'Graphiti MCP server endpoint (for graphiti-mcp backend). When transport is sse, include the /sse path.'
      },
      transport: {
        type: 'string',
        enum: ['stdio', 'sse'],
        default: 'sse',
        description: 'Graphiti MCP transport type'
      },
      groupId: {
        type: 'string',
        default: 'default',
        description: 'Memory group ID for all conversations'
      },

      // Connection - Neo4j (for neo4j backend)
      neo4j: {
        type: 'object',
        properties: {
          uri: { type: 'string' },
          user: { type: 'string' },
          password: { type: 'string' },
          database: { type: 'string' }
        },
        description: 'Neo4j connection settings'
      },

      // Auto-capture
      autoCapture: {
        type: 'boolean',
        default: true,
        description: 'Automatically capture conversations to memory'
      },

      // Auto-recall
      autoRecall: {
        type: 'boolean',
        default: true,
        description: 'Automatically recall relevant memories before each response'
      },
      recallMaxFacts: {
        type: 'number',
        default: 5,
        minimum: 1,
        maximum: 20,
        description: 'Maximum facts to recall per query'
      },
      minPromptLength: {
        type: 'number',
        default: 20,
        minimum: 1,
        description: 'Minimum prompt length to trigger recall'
      },

      // Adaptive Scoring (Memory Cortex)
      scoringEnabled: {
        type: 'boolean',
        default: true,
        description: 'Enable adaptive importance scoring'
      },
      scoringExplicitThreshold: {
        type: 'number',
        default: 8,
        minimum: 1,
        maximum: 10,
        description: 'Score >= this triggers explicit storage. Must be > scoringEphemeralThreshold.'
      },
      scoringEphemeralThreshold: {
        type: 'number',
        default: 4,
        minimum: 0,
        maximum: 9,
        description: 'Score < this triggers ephemeral storage. Must be < scoringExplicitThreshold.'
      },
      scoringEphemeralHours: {
        type: 'number',
        default: 72,
        minimum: 1,
        maximum: 168,
        description: 'Hours before ephemeral memories auto-expire'
      },
      scoringSilentDays: {
        type: 'number',
        default: 30,
        minimum: 1,
        maximum: 365,
        description: 'Days before silent memories need reinforcement'
      },
      scoringCleanupHours: {
        type: 'number',
        default: 12,
        minimum: 1,
        maximum: 24,
        description: 'How often to run cleanup via heartbeat (hours)'
      },
      scoringNotifyExplicit: {
        type: 'boolean',
        default: true,
        description: 'Notify user when storing explicit importance memories'
      },
      scoringAskBeforeDowngrade: {
        type: 'boolean',
        default: true,
        description: 'Ask user before downgrading memory importance'
      }
    }
  },

  async register(api: any) {
    const config = api?.pluginConfig ?? {};

    // Migrate settings from legacy plugin IDs
    migratePluginSettings(api, 'graphiti-memory');

    // Validate and coerce scoring config
    validateScoringConfig(config);

    // Safe logging - don't expose secrets
    const safeConfig = {
      backend: config.backend || 'auto',
      endpoint: config.endpoint ? '[configured]' : 'http://localhost:8000/sse',
      groupId: config.groupId ?? 'default',
      autoCapture: config.autoCapture,
      autoRecall: config.autoRecall,
      scoringEnabled: config.scoringEnabled
    };
    console.log('[graphiti-memory] Registering plugin with config:', safeConfig);

    // Create adapter based on configuration
    let adapter: MemoryAdapter;

    try {
      // Determine backend type
      const backendType = config.backend || 'auto';

      if (backendType === 'auto') {
        console.log('[graphiti-memory] Auto-detecting memory backend...');
        // Map plugin config to BackendConfig shape for auto-detection
        const backendConfig: Partial<BackendConfig> = {};
        if (config.endpoint) (backendConfig as any).endpoint = config.endpoint;
        if (config.transport) (backendConfig as any).transport = config.transport;
        if (config.groupId) (backendConfig as any).groupId = config.groupId;
        adapter = await adapterFactory.autoDetect(backendConfig);
      } else if (backendType === 'graphiti-mcp') {
        console.log('[graphiti-memory] Using Graphiti MCP backend...');
        adapter = adapterFactory.create({
          type: 'graphiti-mcp',
          transport: config.transport || 'sse',
          endpoint: config.endpoint || 'http://localhost:8000/sse',
          groupId: config.groupId || 'default'
        });
      } else if (backendType === 'neo4j') {
        console.log('[graphiti-memory] Using Neo4j backend...');
        const neo4jConfig = config.neo4j || {};
        adapter = adapterFactory.create({
          type: 'neo4j',
          uri: neo4jConfig.uri || 'bolt://localhost:7687',
          user: neo4jConfig.user || 'neo4j',
          password: neo4jConfig.password || 'neo4j',
          database: neo4jConfig.database
        });
      } else {
        throw new Error(`Unknown backend type: ${backendType}`);
      }

      // Initialize adapter
      await adapter.initialize();

      // Verify connection
      const health = await adapter.healthCheck();
      if (!health.healthy) {
        console.warn('[graphiti-memory] Warning: Memory backend not healthy:', health.details);
      } else {
        console.log(`[graphiti-memory] Connected to ${health.backend} backend`);
      }

    } catch (err) {
      console.error('[graphiti-memory] Failed to initialize memory backend:', err instanceof Error ? err.message : String(err));
      throw err;
    }

    // Register tools
    registerTools(api, adapter, config);

    // Register hooks (includes adaptive scoring)
    registerHooks(api, adapter, config);

    // Register shutdown handler if the host API supports it
    const shutdownHandler = async () => {
      try {
        console.log('[graphiti-memory] Shutting down...');
        await adapter.shutdown();
        console.log('[graphiti-memory] Shutdown complete');
      } catch (err) {
        console.error('[graphiti-memory] Shutdown error:', err instanceof Error ? err.message : String(err));
      }
    };

    if (typeof api?.onShutdown === 'function') {
      api.onShutdown(shutdownHandler);
    } else if (typeof api?.on === 'function') {
      api.on('shutdown', shutdownHandler);
    }

    console.log('[graphiti-memory] Plugin registered successfully with Memory Cortex');
  }
};
