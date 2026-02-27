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
 */

import { registerTools } from './tools.js';
import { registerHooks } from './hooks.js';
import { adapterFactory, createAdapterFromConfig } from './adapters/factory.js';
import type { MemoryAdapter } from './adapters/memory-adapter.js';

export default {
  id: 'graphiti-memory',
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
        default: 'http://localhost:8000',
        description: 'Graphiti MCP server endpoint (for graphiti-mcp backend)'
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
        description: 'Maximum facts to recall per query'
      },
      minPromptLength: {
        type: 'number',
        default: 20,
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
        description: 'Score >= this triggers explicit storage (user notification)'
      },
      scoringEphemeralThreshold: {
        type: 'number',
        default: 4,
        description: 'Score < this triggers ephemeral (temp) storage'
      },
      scoringEphemeralHours: {
        type: 'number',
        default: 72,
        description: 'Hours before ephemeral memories auto-expire'
      },
      scoringSilentDays: {
        type: 'number',
        default: 30,
        description: 'Days before silent memories need reinforcement'
      },
      scoringCleanupHours: {
        type: 'number',
        default: 12,
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

    // Safe logging - don't expose secrets
    const safeConfig = {
      backend: config.backend || 'auto',
      endpoint: config.endpoint ? '[configured]' : 'http://localhost:8000',
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
        adapter = await adapterFactory.autoDetect(config);
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

    console.log('[graphiti-memory] Plugin registered successfully with Memory Cortex');
  }
};
