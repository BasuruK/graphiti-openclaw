/**
 * Graphiti Memory Plugin for OpenClaw
 * 
 * A temporal knowledge graph memory system that provides:
 * - Native memory tools (recall, store, forget, status)
 * - Auto-recall before each agent turn
 * - Auto-capture after each conversation
 * - Adaptive importance scoring (Memory Cortex)
 * 
 * Uses Graphiti MCP server + Neo4j for persistent storage
 */

import { GraphitiClient } from './client.js';
import { registerTools } from './tools.js';
import { registerHooks } from './hooks.js';

export default {
  id: 'graphiti-memory',
  name: 'Graphiti Memory',
  description: 'Temporal knowledge graph memory for OpenClaw with adaptive importance scoring',
  
  configSchema: {
    type: 'object',
    properties: {
      // Connection
      endpoint: {
        type: 'string',
        default: 'http://localhost:8000',
        description: 'Graphiti MCP server endpoint'
      },
      groupId: {
        type: 'string',
        default: 'default',
        description: 'Memory group ID for all conversations'
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
        default: 10,
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
    const config = api.pluginConfig ?? {};
    
    console.log('[graphiti-memory] Registering plugin with config:', config);

    // Create Graphiti client
    const client = new GraphitiClient({
      endpoint: config.endpoint || 'http://localhost:8000',
      groupId: config.groupId || 'default'
    });

    // Verify connection
    const healthy = await client.healthCheck();
    if (!healthy) {
      console.warn('[graphiti-memory] Warning: Graphiti MCP server not healthy');
    } else {
      console.log('[graphiti-memory] Connected to Graphiti MCP server');
    }

    // Register tools
    registerTools(api, client, config);

    // Register hooks (includes adaptive scoring)
    registerHooks(api, client, config);

    console.log('[graphiti-memory] Plugin registered successfully with Memory Cortex');
  }
};
