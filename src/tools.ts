/**
 * Nuron Memory Tools for OpenClaw
 *
 * Registers memory management tools that users can call directly:
 * - memory_recall: Search memories
 * - memory_store: Store important info
 * - memory_list: Browse memories with filters
 * - memory_forget: Delete a memory
 * - memory_status: Check system health
 * - read_unconsolidated_memories: Fetch raw memories for Axon synthesis
 * - memory_consolidate_batch: Store Axon synthesis findings
 * - memory_analyze: Score/assess a memory's importance
 */

import { Type } from '@sinclair/typebox';
import type { MemoryAdapter } from './adapters/memory-adapter.js';
import { getLogger } from './logger.js';

const logger = getLogger('tools');

/** Valid memory tier values */
const VALID_TIERS = ['explicit', 'silent', 'ephemeral', 'all'] as const;
type MemoryTier = typeof VALID_TIERS[number];

const TOOL_SOURCE = 'Source: Nuron OpenClaw plugin.';
const BACKEND_PATH = 'Backend path for storage and recall operations: Nuron tool -> Graphiti MCP server -> Neo4j temporal knowledge graph.';

function describeTool(purpose: string, inputs: string, returns: string): string {
  return `${purpose} ${TOOL_SOURCE} Inputs: ${inputs} Returns: ${returns}`;
}

function describeBackendTool(purpose: string, inputs: string, returns: string): string {
  return `${purpose} ${TOOL_SOURCE} ${BACKEND_PATH} Inputs: ${inputs} Returns: ${returns}`;
}

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
    label: 'Nuron Memory Recall',
    description: describeBackendTool(
      'Search long-term memory for past conversations, preferences, facts, and prior session context.',
      'query string, optional result limit, optional tier filter.',
      'A formatted memory list and structured recall results with memory metadata.'
    ),
    parameters: Type.Object({
      query: Type.String({ description: 'Natural-language search query sent to Nuron recall over Graphiti MCP.' }),
      limit: Type.Optional(Type.Number({ default: 5, description: 'Maximum number of memory results to return.' })),
      tier: Type.Optional(Type.String({ description: 'Optional tier filter: explicit, silent, ephemeral, or all.', default: 'all' }))
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
    label: 'Nuron Memory Store',
    description: describeBackendTool(
      'Store information into long-term memory when the user shares durable preferences, facts, or explicit reminders.',
      'memory content, optional display name, optional storage tier.',
      'A confirmation with the stored memory ID and chosen tier.'
    ),
    parameters: Type.Object({
      content: Type.String({ description: 'The fact, preference, or reminder to persist through Nuron.' }),
      name: Type.Optional(Type.String({ description: 'Optional human-friendly name for this memory.' })),
      tier: Type.Optional(Type.String({ description: 'Optional storage tier: explicit (permanent), silent (30d), or ephemeral (72h).', default: 'silent' }))
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
    label: 'Nuron Memory List',
    description: describeBackendTool(
      'Browse recently stored Nuron memories, optionally filtered by memory tier.',
      'optional result limit and optional tier filter.',
      'A formatted list of recent memories and structured memory objects.'
    ),
    parameters: Type.Object({
      limit: Type.Optional(Type.Number({ default: 10, description: 'Maximum number of memories to return.' })),
      tier: Type.Optional(Type.String({ description: 'Optional tier filter: explicit, silent, ephemeral, or all.', default: 'all' }))
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
    label: 'Nuron Memory Forget',
    description: describeBackendTool(
      'Delete a specific Nuron memory when stored information is incorrect, outdated, or should be removed.',
      'the target memory UUID.',
      'A deletion confirmation or an error if the memory cannot be removed.'
    ),
    parameters: Type.Object({
      uuid: Type.String({ description: 'UUID of the Nuron memory to delete.' })
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
    label: 'Nuron Memory Status',
    description: describeBackendTool(
      'Check Nuron memory system health, backend connectivity, and high-level memory counts.',
      'no parameters.',
      'Backend health, storage statistics, and tier counts.'
    ),
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

  // Read Unconsolidated Memories - For Axon Agent
  api.registerTool({
    name: 'read_unconsolidated_memories',
    label: 'Nuron Read Unconsolidated Memories',
    description: describeBackendTool(
      'Fetch raw Nuron memories that have not yet been consolidated. This is primarily for the Axon synthesis workflow.',
      'optional batch size limit.',
      'A batch of unconsolidated memory records ready for synthesis.'
    ),
    parameters: Type.Object({
      limit: Type.Optional(Type.Number({ default: 10, description: 'Maximum number of unconsolidated memories to fetch.' }))
    }),
    async execute(toolCallId: string, params: { limit?: number }) {
      try {
        const rawLimit = params.limit ?? 10;
        const limit = Math.min(Math.max(rawLimit, 1), 100); // Clamp limit to [1, 100]
        const memories = await adapter.getUnconsolidatedMemories(limit);

        if (!memories || memories.length === 0) {
          return {
            content: [{ type: 'text', text: 'No unconsolidated memories found.' }],
            details: { count: 0 }
          };
        }

        const formatted = memories.map((m, i) =>
          `ID: ${m.id} | Date: ${m.metadata.createdAt.toISOString().split('T')[0]}\nContent: ${m.content}`
        ).join('\n\n');

        return {
          content: [{ type: 'text', text: `Unconsolidated Memories to Synthesize:\n\n${formatted}` }],
          details: { count: memories.length, memories }
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `Error reading unconsolidated memories: ${errorMsg}` }],
          isError: true
        };
      }
    }
  }, { name: 'read_unconsolidated_memories' });

  // Memory Consolidate Batch - For Axon Agent to commit synthesis
  api.registerTool({
    name: 'memory_consolidate_batch',
    label: 'Nuron Memory Consolidate Batch',
    description: describeBackendTool(
      'Commit the result of an Axon synthesis cycle by creating an insight, writing graph connections, and marking source memories as consolidated.',
      'source memory IDs, a summary, one synthesized insight, and semantic connections.',
      'A consolidation confirmation with processed source count and connection count.'
    ),
    parameters: Type.Object({
      sourceIds: Type.Array(Type.String(), { description: 'IDs of the source memories that were synthesized into one insight.' }),
      summary: Type.String({ description: 'Synthesized summary combining the source memories.' }),
      insight: Type.String({ description: 'One overarching insight or hidden pattern extracted from the source memories.' }),
      connections: Type.Array(
        Type.Object({
          fromId: Type.String(),
          toId: Type.String(),
          relationship: Type.String({ description: 'Capitalized edge label such as RELATES_TO or CONTRADICTS.' })
        }),
        { description: 'Semantic graph connections to write between the memories.' }
      )
    }),
    async execute(toolCallId: string, params: {
      sourceIds: string[];
      summary: string;
      insight: string;
      connections: { fromId: string; toId: string; relationship: string }[];
    }) {
      try {
        // Validation: Ensure sourceIds is a non-empty array
        if (!params.sourceIds || !Array.isArray(params.sourceIds) || params.sourceIds.length === 0) {
          return {
            content: [{ type: 'text', text: 'Error: sourceIds must be a non-empty array of memory identifiers.' }],
            isError: true
          };
        }

        const hasEmptyConnections = Array.isArray(params.connections) && params.connections.length === 0;
        const warning = hasEmptyConnections
          ? 'Warning: no semantic connections were provided, so the consolidation created an insight without graph edges.'
          : undefined;

        await adapter.storeConsolidation(
          params.sourceIds,
          params.summary,
          params.insight,
          params.connections
        );

        return {
          content: [{
            type: 'text',
            text: `Consolidation successful.\nProcessed ${params.sourceIds.length} memories.\nCreated ${params.connections.length} semantic connections.${warning ? `\n${warning}` : ''}`
          }],
          details: {
            processed: params.sourceIds.length,
            connections: params.connections.length,
            ...(warning ? { warning } : {})
          }
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `Error executing consolidation batch: ${errorMsg}` }],
          isError: true
        };
      }
    }
  }, { name: 'memory_consolidate_batch' });

  // Memory Analyze - Score/assess a memory's importance
  api.registerTool({
    name: 'memory_analyze',
    label: 'Nuron Memory Analyze',
    description: describeTool(
      'Analyze candidate memory content and estimate its importance score and recommended storage tier before saving.',
      'one content string to analyze.',
      'A predicted importance score, recommended tier, and analysis rationale.'
    ),
    parameters: Type.Object({
      content: Type.String({ description: 'Candidate memory content to score and classify.' })
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

  logger.info('Registered memory tools.');
}
