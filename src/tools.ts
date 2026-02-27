/**
 * Graphiti Memory Tools for OpenClaw
 * 
 * Registers memory management tools that users can call directly:
 * - memory_recall: Search memories
 * - memory_store: Store important info
 * - memory_forget: Delete a memory
 * - memory_status: Check system health
 */

import { Type } from '@sinclair/typebox';
import { GraphitiClient } from './client.js';

/**
 * Register memory tools with the OpenClaw API
 * @param api - OpenClaw plugin API
 * @param client - Graphiti client instance  
 * @param config - Plugin configuration
 */
export function registerTools(api: any, client: GraphitiClient, config: any) {
  
  // Memory Recall - Search memories
  api.registerTool({
    name: 'memory_recall',
    label: 'Memory Recall',
    description: 'Search through long-term memories. Use when user asks about past conversations, preferences, facts, or context from previous sessions.',
    parameters: Type.Object({
      query: Type.String({ description: 'Search query' }),
      limit: Type.Optional(Type.Number({ default: 5, description: 'Maximum results' }))
    }),
    async execute(toolCallId: string, params: { query: string; limit?: number }) {
      try {
        const results = await client.searchNodes(params.query, params.limit || 5);
        
        if (!results || results.length === 0) {
          return {
            content: [{ type: 'text', text: 'No memories found.' }],
            details: { count: 0 }
          };
        }

        const formatted = results.map((r, i) => 
          `${i + 1}. ${r.summary || r.name || r.fact}`
        ).join('\n');

        return {
          content: [{ type: 'text', text: `Found ${results.length} memories:\n\n${formatted}` }],
          details: { count: results.length, results }
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `Error recalling memory: ${errorMsg}` }],
          isError: true
        };
      }
    }
  }, { name: 'memory_recall' });

  // Memory Store - Store important info
  api.registerTool({
    name: 'memory_store',
    label: 'Memory Store',
    description: 'Store important information to remember long-term. Use when user says "remember that", "dont forget", or shares preferences, important facts, or context.',
    parameters: Type.Object({
      content: Type.String({ description: 'Content to remember' }),
      name: Type.Optional(Type.String({ description: 'Optional name for this memory' }))
    }),
    async execute(toolCallId: string, params: { content: string; name?: string }) {
      try {
        const result = await client.addEpisode(params.content, params.name);
        
        return {
          content: [{ type: 'text', text: `Memory stored successfully (ID: ${result.uuid})` }],
          details: { uuid: result.uuid }
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `Error storing memory: ${errorMsg}` }],
          isError: true
        };
      }
    }
  }, { name: 'memory_store' });

  // Memory Forget - Delete a memory
  api.registerTool({
    name: 'memory_forget',
    label: 'Memory Forget',
    description: 'Delete a specific memory by ID. Use when user wants to remove incorrect or outdated information.',
    parameters: Type.Object({
      uuid: Type.String({ description: 'UUID of the memory to delete' })
    }),
    async execute(toolCallId: string, params: { uuid: string }) {
      try {
        await client.deleteEpisode(params.uuid);
        
        return {
          content: [{ type: 'text', text: `Memory ${params.uuid} deleted successfully.` }],
          details: { deleted: true }
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `Error deleting memory: ${errorMsg}` }],
          isError: true
        };
      }
    }
  }, { name: 'memory_forget' });

  // Memory Status - Check health
  api.registerTool({
    name: 'memory_status',
    label: 'Memory Status',
    description: 'Check the health and status of the memory system.',
    parameters: Type.Object({}),
    async execute(toolCallId: string, params: {}) {
      try {
        const healthy = await client.healthCheck();
        const episodes = await client.getEpisodes(3);
        
        return {
          content: [{ 
            type: 'text', 
            text: `Graphiti Memory Status:\n\n` +
              `- Service: ${healthy ? '✅ Healthy' : '❌ Unhealthy'}\n` +
              `- Group: ${config.groupId}\n` +
              `- Recent Episodes: ${episodes.length}`
          }],
          details: { healthy, groupId: config.groupId, recentEpisodes: episodes.length }
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `Error checking status: ${errorMsg}` }],
          isError: true
        };
      }
    }
  }, { name: 'memory_status' });

  console.log('[graphiti-memory] Tools registered: memory_recall, memory_store, memory_forget, memory_status');
}
