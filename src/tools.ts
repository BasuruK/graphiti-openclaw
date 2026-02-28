/**
 * Nuron Memory Tools for OpenClaw
 *
 * Registers memory management tools that users can call directly:
 * - memory_recall: Search memories
 * - memory_store: Store important info
 * - memory_list: Browse memories with filters
 * - memory_forget: Delete a memory
 * - memory_status: Check system health
 * - memory_consolidate: Synthesize recent memories
 * - memory_analyze: Score/assess a memory's importance
 */

import { Type } from '@sinclair/typebox';
import type { MemoryAdapter } from './adapters/memory-adapter.js';

/** Valid memory tier values */
const VALID_TIERS = ['explicit', 'silent', 'ephemeral', 'all'] as const;
type MemoryTier = typeof VALID_TIERS[number];

/**
 * Validate and normalize a tier string to a valid MemoryTier.
 * Returns 'all' for invalid or missing values.
 */
function normalizeTier(tier: string | undefined, defaultTier: MemoryTier = 'all'): MemoryTier {
  if (!tier) return defaultTier;
  const lower = tier.toLowerCase();
  return (VALID_TIERS as readonly string[]).includes(lower) ? lower as MemoryTier : defaultTier;
}

/**
 * Register memory tools with the OpenClaw API
 * @param api - OpenClaw plugin API
 * @param adapter - Memory adapter instance
 * @param config - Plugin configuration
 */
export function registerTools(api: any, adapter: MemoryAdapter, config: any) {

  // Memory Recall - Search memories
  api.registerTool({
    name: 'memory_recall',
    label: 'Memory Recall',
    description: 'Search through long-term memories. Use when user asks about past conversations, preferences, facts, or context from previous sessions.',
    parameters: Type.Object({
      query: Type.String({ description: 'Search query' }),
      limit: Type.Optional(Type.Number({ default: 5, description: 'Maximum results' })),
      tier: Type.Optional(Type.String({ description: 'Filter by tier: explicit, silent, ephemeral, or all', default: 'all' }))
    }),
    async execute(toolCallId: string, params: { query: string; limit?: number; tier?: string }) {
      try {
        const rawLimit = params.limit ?? 5;
        const limit = Math.min(Math.max(rawLimit, 1), 20);

        const tier = normalizeTier(params.tier, 'all');

        const results = await adapter.recall(params.query, { limit, tier });

        if (!results || results.length === 0) {
          return {
            content: [{ type: 'text', text: 'No memories found.' }],
            details: { count: 0 }
          };
        }

        const formatted = results.map((r, i) =>
          `${i + 1}. [${r.metadata.tier.toUpperCase()}] ${r.content.substring(0, 150)}...`
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
      name: Type.Optional(Type.String({ description: 'Optional name for this memory' })),
      tier: Type.Optional(Type.String({ description: 'Memory tier: explicit (permanent), silent (30d), ephemeral (72h)', default: 'silent' }))
    }),
    async execute(toolCallId: string, params: { content: string; name?: string; tier?: string }) {
      try {
        const tier = normalizeTier(params.tier, 'silent');
        // Exclude 'all' — it's only valid for queries, not storage
        const storageTier = tier === 'all' ? 'silent' : tier;

        const id = await adapter.store(params.content, {
          tier: storageTier,
          score: storageTier === 'explicit' ? 9 : storageTier === 'silent' ? 6 : 3,
          source: 'user_explicit',
        });

        return {
          content: [{ type: 'text', text: `Memory stored successfully (ID: ${id})\nTier: ${storageTier}` }],
          details: { id, tier: storageTier }
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

  // Memory List - Browse memories with filters
  api.registerTool({
    name: 'memory_list',
    label: 'Memory List',
    description: 'List recent memories with optional filtering by tier. Useful for browsing what has been stored.',
    parameters: Type.Object({
      limit: Type.Optional(Type.Number({ default: 10, description: 'Maximum memories to list' })),
      tier: Type.Optional(Type.String({ description: 'Filter by tier: explicit, silent, ephemeral, or all', default: 'all' }))
    }),
    async execute(toolCallId: string, params: { limit?: number; tier?: string }) {
      try {
        const rawLimit = params.limit ?? 10;
        const limit = Math.min(Math.max(rawLimit, 1), 50);
        const tier = normalizeTier(params.tier, 'all');

        const memories = await adapter.list(limit, tier);

        if (!memories || memories.length === 0) {
          return {
            content: [{ type: 'text', text: 'No memories found.' }],
            details: { count: 0 }
          };
        }

        const formatted = memories.map((m, i) => {
          const date = m.metadata.createdAt.toISOString().split('T')[0];
          return `${i + 1}. [${m.metadata.tier.toUpperCase()}] ${date} - ${m.content.substring(0, 100)}...`;
        }).join('\n');

        return {
          content: [{ type: 'text', text: `Found ${memories.length} memories:\n\n${formatted}` }],
          details: { count: memories.length, memories }
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `Error listing memories: ${errorMsg}` }],
          isError: true
        };
      }
    }
  }, { name: 'memory_list' });

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
        await adapter.forget(params.uuid);

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
        const health = await adapter.healthCheck();
        const stats = await adapter.getStats();

        const statusEmoji = health.healthy ? '✅' : '❌';

        return {
          content: [{
            type: 'text',
            text: `Memory Status:\n\n` +
              `- Service: ${statusEmoji} ${health.backend}\n` +
              `- Healthy: ${health.healthy ? 'Yes' : 'No'}\n` +
              `- Total Memories: ${stats.totalCount}\n` +
              `  - Explicit: ${stats.byTier.explicit}\n` +
              `  - Silent: ${stats.byTier.silent}\n` +
              `  - Ephemeral: ${stats.byTier.ephemeral}\n` +
              (stats.oldestMemory ? `- Oldest: ${stats.oldestMemory.toISOString().split('T')[0]}\n` : '') +
              (stats.newestMemory ? `- Newest: ${stats.newestMemory.toISOString().split('T')[0]}` : '')
          }],
          details: { health, stats }
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

  // Memory Consolidate - Synthesize recent memories
  api.registerTool({
    name: 'memory_consolidate',
    label: 'Memory Consolidate',
    description: 'Synthesize and integrate recent memories. This helps maintain a coherent knowledge graph by connecting related memories.',
    parameters: Type.Object({
      hours: Type.Optional(Type.Number({ default: 24, description: 'Look back hours for consolidation' }))
    }),
    async execute(toolCallId: string, params: { hours?: number }) {
      try {
        const hours = params.hours || 24;
        const startTime = new Date(Date.now() - hours * 3600000);

        // Get recent memories and filter to only include those within the time range
        const allRecentMemories = await adapter.list(50, 'all');
        const recentMemories = allRecentMemories.filter(
          m => m.metadata.createdAt >= startTime
        );

        if (recentMemories.length === 0) {
          return {
            content: [{ type: 'text', text: 'No memories to consolidate.' }],
            details: { consolidated: 0 }
          };
        }

        // Group by semantic similarity (simplified - in production would use embeddings)
        const clusters = new Map<string, typeof recentMemories>();

        for (const memory of recentMemories) {
          // Simple clustering by first few words
          const key = memory.content.substring(0, 30).toLowerCase();
          if (!clusters.has(key)) {
            clusters.set(key, []);
          }
          clusters.get(key)!.push(memory);
        }

        let upgraded = 0;
        let deleted = 0;

        // Process clusters: upgrade if reinforced, delete duplicates
        for (const [key, cluster] of clusters) {
          if (cluster.length > 1) {
            // Keep the most recent/relevant, mark others as consolidated
            for (let i = 1; i < cluster.length; i++) {
              try {
                await adapter.forget(cluster[i].id);
                deleted++;
              } catch {
                // May already be deleted
              }
            }
          }
        }

        return {
          content: [{
            type: 'text',
            text: `Memory consolidation complete.\n\n- Memories analyzed: ${recentMemories.length}\n- Clusters found: ${clusters.size}\n- Duplicates removed: ${deleted}`
          }],
          details: { analyzed: recentMemories.length, clusters: clusters.size, deleted }
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `Error consolidating memories: ${errorMsg}` }],
          isError: true
        };
      }
    }
  }, { name: 'memory_consolidate' });

  // Memory Analyze - Score/assess a memory's importance
  api.registerTool({
    name: 'memory_analyze',
    label: 'Memory Analyze',
    description: 'Analyze content to predict its importance score (0-10) and recommended storage tier.',
    parameters: Type.Object({
      content: Type.String({ description: 'Content to analyze' })
    }),
    async execute(toolCallId: string, params: { content: string }) {
      try {
        // Import dynamically to avoid circular deps
        const { createMemoryScorer } = await import('./memory-scorer.js');
        const { DEFAULT_SCORING_CONFIG } = await import('./memory-scorer.js');

        const scorer = createMemoryScorer(adapter, {
          enabled: true,
        });

        const result = await scorer.scoreConversation([{
          content: params.content,
          role: 'user'
        }]);

        const tierEmoji = {
          explicit: '🔴',
          silent: '🟡',
          ephemeral: '⚪'
        };

        return {
          content: [{
            type: 'text',
            text: `Memory Analysis:\n\n` +
              `- Score: ${result.score}/10 ${tierEmoji[result.tier]}\n` +
              `- Tier: ${result.tier}\n` +
              `- Reasoning: ${result.reasoning}\n` +
              `- Recommended Action: ${result.recommendedAction}`
          }],
          details: result
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `Error analyzing memory: ${errorMsg}` }],
          isError: true
        };
      }
    }
  }, { name: 'memory_analyze' });

  console.log('[nuron] Tools registered: memory_recall, memory_store, memory_list, memory_forget, memory_status, memory_consolidate, memory_analyze');
}
