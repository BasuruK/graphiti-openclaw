/**
 * Graphiti Memory Plugin for OpenClaw
 * 
 * A temporal knowledge graph memory system that provides:
 * - Native memory tools (recall, store, forget, status)
 * - Auto-recall before each agent turn
 * - Auto-capture after each conversation
 * 
 * Uses Graphiti MCP server + Neo4j for persistent storage
 */

import { GraphitiClient } from './client.js';
import { registerTools } from './tools.js';
import { registerHooks } from './hooks.js';

export default {
  id: 'graphiti-memory',
  name: 'Graphiti Memory',
  description: 'Temporal knowledge graph memory for OpenClaw using Graphiti + Neo4j',
  
  configSchema: {
    type: 'object',
    properties: {
      endpoint: {
        type: 'string',
        default: 'http://localhost:8000'
      },
      groupId: {
        type: 'string',
        default: 'basuru'
      },
      autoCapture: {
        type: 'boolean',
        default: true
      },
      autoRecall: {
        type: 'boolean',
        default: true
      },
      recallMaxFacts: {
        type: 'number',
        default: 5
      },
      minPromptLength: {
        type: 'number',
        default: 10
      }
    }
  },

  async register(api: any) {
    const config = api.pluginConfig;
    
    console.log('[graphiti-memory] Registering plugin with config:', config);

    // Create Graphiti client
    const client = new GraphitiClient({
      endpoint: config.endpoint || 'http://localhost:8000',
      groupId: config.groupId || 'basuru'
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

    // Register hooks
    registerHooks(api, client, config);

    console.log('[graphiti-memory] Plugin registered successfully');
  }
};
