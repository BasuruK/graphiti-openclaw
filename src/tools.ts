/**
 * Nuron Memory Tools for OpenClaw
 *
 * Registers memory management tools that users can call directly:
 * - memory_recall: Search memories
 * - memory_store: Store important info
 * - memory_list: Browse memories with filters
 * - memory_forget: Delete a memory
 * - memory_status: Check system health
 * - memory_axon_daily_sources: Gather same-day graph + session-log inputs for Axon
 * - memory_axon_apply_plan: Apply Axon maintenance operations through the adapter
 * - read_unconsolidated_memories: Fetch raw memories for Axon synthesis
 * - memory_consolidate_batch: Store Axon synthesis findings
 * - memory_analyze: Score/assess a memory's importance
 */

import { Type } from '@sinclair/typebox';
import type { MemoryAdapter } from './adapters/memory-adapter.js';
import { applyAxonPlan, collectAxonDailySources, type AxonPlanOperation, type AxonRuntimeConfig } from './axon.js';
import { getLogger } from './logger.js';
import { reinforceMemories } from './memory-maintenance.js';

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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function resolveAxonRuntimeConfig(
  config: any,
  overrides: { lookbackHours?: number; limit?: number } = {}
): AxonRuntimeConfig {
  return {
    axonEnabled: config.axonEnabled !== false,
    axonSessionLogDir: typeof config.axonSessionLogDir === 'string' ? config.axonSessionLogDir : '',
    axonLookbackHours: clamp(
      overrides.lookbackHours ?? config.axonLookbackHours ?? 24,
      1,
      168
    ),
    axonEphemeralForgetDays: clamp(config.axonEphemeralForgetDays ?? 5, 1, 365),
    axonSilentDecayDays: clamp(config.axonSilentDecayDays ?? 30, 1, 365),
    axonBatchLimit: clamp(overrides.limit ?? config.axonBatchLimit ?? 20, 1, 100),
    axonMinRepeatCount: clamp(config.axonMinRepeatCount ?? 2, 1, 20),
    axonDryRun: config.axonDryRun === true,
  };
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

        try {
          await reinforceMemories(adapter, results);
        } catch (err) {
          logger.debug(`memory_recall reinforcement skipped: ${err instanceof Error ? err.message : String(err)}`);
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
          disposition: storageTier,
          summary: params.content,
          memoryKind: 'fact',
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
    async execute(_toolCallId: string, _params: {}) {
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

  // Axon Daily Sources - Gather same-day graph/session inputs
  api.registerTool({
    name: 'memory_axon_daily_sources',
    label: 'Nuron Axon Daily Sources',
    description: describeBackendTool(
      'Gather today-focused Axon inputs: recent graph memories, stale ephemeral candidates, and optional OpenClaw Markdown session-log excerpts.',
      'optional lookback hours override and optional result limit override.',
      'Structured daily Axon source data plus warnings when session logs are unavailable.'
    ),
    parameters: Type.Object({
      lookbackHours: Type.Optional(Type.Number({ default: 24, description: 'How many hours of recent activity Axon should inspect.' })),
      limit: Type.Optional(Type.Number({ default: 20, description: 'Maximum items per source group.' }))
    }),
    async execute(toolCallId: string, params: { lookbackHours?: number; limit?: number }) {
      try {
        const runtimeConfig = resolveAxonRuntimeConfig(config, {
          lookbackHours: params.lookbackHours,
          limit: params.limit,
        });

        const sources = await collectAxonDailySources(adapter, runtimeConfig);
        const warningBlock = sources.warnings.length > 0
          ? `Warnings:\n${sources.warnings.map((warning) => `- ${warning}`).join('\n')}\n\n`
          : '';
        const sessionLogBlock = sources.sessionLogExcerpts.length > 0
          ? sources.sessionLogExcerpts.map((excerpt, index) =>
              `${index + 1}. ${excerpt.path}\n${excerpt.excerpt}`
            ).join('\n\n')
          : 'No recent session-log excerpts.';
        const graphBlock = sources.graphMemories.length > 0
          ? sources.graphMemories.map((memory, index) =>
              `${index + 1}. [${memory.metadata.tier.toUpperCase()}] ${memory.content.substring(0, 140)}`
            ).join('\n')
          : 'No recent graph memories.';
        const staleBlock = sources.staleEphemeralCandidates.length > 0
          ? sources.staleEphemeralCandidates.map((memory, index) =>
              `${index + 1}. ${memory.id} - ${memory.content.substring(0, 120)}`
            ).join('\n')
          : 'No stale ephemeral candidates.';

        return {
          content: [{
            type: 'text',
            text:
              `${warningBlock}` +
              `Axon Daily Sources (lookback ${sources.lookbackHours}h)\n\n` +
              `Session Log Excerpts:\n${sessionLogBlock}\n\n` +
              `Recent Graph Memories:\n${graphBlock}\n\n` +
              `Stale Ephemeral Candidates:\n${staleBlock}`
          }],
          details: sources
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `Error collecting Axon daily sources: ${errorMsg}` }],
          isError: true
        };
      }
    }
  }, { name: 'memory_axon_daily_sources' });

  // Axon Apply Plan - Apply Graphiti-first maintenance actions
  api.registerTool({
    name: 'memory_axon_apply_plan',
    label: 'Nuron Axon Apply Plan',
    description: describeBackendTool(
      'Apply Axon maintenance operations such as store, promote, reinforce, connect, merge, and prune using the Nuron adapter.',
      'one or more Axon plan operations.',
      'Per-operation execution outcomes. Honors axonDryRun from plugin config.'
    ),
    parameters: Type.Object({
      operations: Type.Array(Type.Object({
        action: Type.String({ description: 'store, promote, reinforce, connect, merge, or prune.' }),
        id: Type.Optional(Type.String()),
        ids: Type.Optional(Type.Array(Type.String())),
        sourceIds: Type.Optional(Type.Array(Type.String())),
        tier: Type.Optional(Type.String()),
        content: Type.Optional(Type.String()),
        summary: Type.Optional(Type.String()),
        insight: Type.Optional(Type.String()),
        memoryKind: Type.Optional(Type.String()),
        score: Type.Optional(Type.Number()),
        fromId: Type.Optional(Type.String()),
        toId: Type.Optional(Type.String()),
        relationship: Type.Optional(Type.String()),
        connections: Type.Optional(Type.Array(Type.Object({
          fromId: Type.String(),
          toId: Type.String(),
          relationship: Type.String()
        }))),
        consolidated: Type.Optional(Type.Boolean()),
        sourceLogPath: Type.Optional(Type.String()),
        sourceLogDate: Type.Optional(Type.String()),
        sourceLogExcerpt: Type.Optional(Type.String()),
      }), {
        minItems: 1,
        description: 'Axon plan operations to execute sequentially.'
      })
    }),
    async execute(toolCallId: string, params: { operations: AxonPlanOperation[] }) {
      try {
        if (!Array.isArray(params.operations) || params.operations.length === 0) {
          return {
            content: [{ type: 'text', text: 'Error: operations must contain at least one Axon action.' }],
            isError: true
          };
        }

        const runtimeConfig = resolveAxonRuntimeConfig(config);
        const result = await applyAxonPlan(adapter, params.operations, runtimeConfig);
        const formatted = result.outcomes.map((outcome, index) =>
          `${index + 1}. [${outcome.status.toUpperCase()}] ${outcome.action}: ${outcome.detail}`
        ).join('\n');

        return {
          content: [{
            type: 'text',
            text: `Axon Plan ${result.dryRun ? '(dry run)' : 'Execution'}:\n\n${formatted}`
          }],
          details: result
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `Error applying Axon plan: ${errorMsg}` }],
          isError: true
        };
      }
    }
  }, { name: 'memory_axon_apply_plan' });

  // Read Unconsolidated Memories - Legacy Axon synthesis path
  api.registerTool({
    name: 'read_unconsolidated_memories',
    label: 'Nuron Read Unconsolidated Memories',
    description: describeBackendTool(
      'Fetch raw Nuron memories that have not yet been consolidated. Legacy Axon synthesis path; prefer memory_axon_daily_sources for daily hygiene.',
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

        const formatted = memories.map((m) =>
          `ID: ${m.id} | Date: ${m.metadata.createdAt.toISOString().split('T')[0]}\nContent: ${m.content}`
        ).join('\n\n');

        return {
          content: [{ type: 'text', text: `Deprecated: prefer memory_axon_daily_sources for daily Axon runs.\n\nUnconsolidated Memories to Synthesize:\n\n${formatted}` }],
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
      'Commit the result of a legacy Axon synthesis cycle by creating an insight, writing graph connections, and marking source memories as consolidated. Prefer memory_axon_apply_plan for VNext.',
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
            text: `Deprecated: prefer memory_axon_apply_plan for daily Axon maintenance.\nConsolidation successful.\nProcessed ${params.sourceIds.length} memories.\nCreated ${params.connections.length} semantic connections.${warning ? `\n${warning}` : ''}`
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
              `- Disposition: ${result.disposition}\n` +
              `- Memory Kind: ${result.memoryKind}\n` +
              `- Summary: ${result.summary}\n` +
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
