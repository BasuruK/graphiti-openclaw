/**
 * Graphiti Memory Hooks for OpenClaw
 *
 * Provides auto-recall, auto-capture, and adaptive importance scoring functionality.
 * Now uses MemoryAdapter interface for backend-agnostic operation.
 */

import type { MemoryAdapter } from './adapters/memory-adapter.js';
import { MemoryScorer, createMemoryScorer, DEFAULT_SCORING_CONFIG, ScoringConfig, ScoringResult } from './memory-scorer.js';

/** Minimum message length to consider for capture */
const MIN_MESSAGE_LENGTH = 20;
/** Maximum messages to capture per turn */
const MAX_CAPTURE_MESSAGES = 15;

/**
 * Register memory hooks with the OpenClaw API
 *
 * Registers three hooks:
 * - before_agent_start: Auto-recall relevant memories
 * - agent_end: Auto-capture with importance scoring
 * - heartbeat: Periodic memory consolidation/cleanup
 *
 * @param api - OpenClaw plugin API
 * @param adapter - Memory adapter instance
 * @param config - Plugin configuration
 */
export function registerHooks(api: any, adapter: MemoryAdapter, config: any) {

  // Initialize Memory Scorer with config
  const scoringConfig: Partial<ScoringConfig> = {
    enabled: config.scoringEnabled !== false,
    explicitThreshold: config.scoringExplicitThreshold ?? DEFAULT_SCORING_CONFIG.explicitThreshold,
    ephemeralThreshold: config.scoringEphemeralThreshold ?? DEFAULT_SCORING_CONFIG.ephemeralThreshold,
    defaultEphemeralHours: config.scoringEphemeralHours ?? DEFAULT_SCORING_CONFIG.defaultEphemeralHours,
    defaultSilentDays: config.scoringSilentDays ?? DEFAULT_SCORING_CONFIG.defaultSilentDays,
    cleanupIntervalHours: config.scoringCleanupHours ?? DEFAULT_SCORING_CONFIG.cleanupIntervalHours,
    notifyOnExplicit: config.scoringNotifyExplicit !== false,
    askBeforeDowngrade: config.scoringAskBeforeDowngrade !== false
  };

  const scorer = createMemoryScorer(adapter, scoringConfig);

  // Auto-Recall: Before each agent turn, inject relevant context
  api.on('before_agent_start', async (event: any) => {
    if (!config.autoRecall) return;

    const prompt = event.prompt || '';
    if (!prompt || prompt.length < config.minPromptLength) return;

    try {
      console.log('[graphiti-memory] Auto-recall: Searching for relevant context...');

      const results = await adapter.recall(prompt, {
        limit: config.recallMaxFacts || 5,
        tier: 'all'
      });

      if (!results || results.length === 0) {
        console.log('[graphiti-memory] Auto-recall: No relevant memories found');
        return;
      }

      const contextBlock = results
        .slice(0, config.recallMaxFacts || 5)
        .map((r, i) => `• ${r.summary || r.content.substring(0, 100)}`)
        .join('\n');

      console.log(`[graphiti-memory] Auto-recall: Found ${results.length} relevant memories`);

      // Inject context via prependContext
      return {
        prependContext: `<memory>\nRelevant memories:\n${contextBlock}\n</memory>`
      };
    } catch (err) {
      console.error('[graphiti-memory] Auto-recall error:', err instanceof Error ? err.message : String(err));
      // Don't fail - continue without memory
    }
  });

  // Auto-Capture: After each conversation turn (with importance scoring)
  api.on('agent_end', async (event: any) => {
    if (!config.autoCapture) return;

    const messages = event.messages;
    if (!messages || !Array.isArray(messages) || messages.length === 0) return;

    try {
      // Extract conversation from messages
      const conversationSegments: { content: string; role: 'user' | 'assistant' }[] = [];
      let messageCount = 0;

      // Get recent messages in reverse order
      const recentMessages = [...messages].reverse();

      for (const msg of recentMessages) {
        if (messageCount >= MAX_CAPTURE_MESSAGES) break;
        if (!msg || typeof msg !== 'object') continue;

        const msgObj = msg as Record<string, any>;
        const role = msgObj.role;

        if (role !== 'user' && role !== 'assistant') continue;

        // Extract text content
        let text = '';
        const content = msgObj.content;
        if (typeof content === 'string') {
          text = content;
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if (block && typeof block === 'object' && 'type' in block && block.type === 'text') {
              text += ' ' + (block.text || '');
            }
          }
        }

        // Skip short messages and injected context
        if (!text || text.length < MIN_MESSAGE_LENGTH) continue;
        if (text.includes('<memory>') || text.includes('<relevant-memories>')) continue;

        conversationSegments.push({
          content: text.slice(0, 500),
          role: role as 'user' | 'assistant'
        });
        messageCount++;
      }

      // Restore chronological order (oldest first)
      conversationSegments.reverse();

      if (conversationSegments.length === 0) {
        console.log('[graphiti-memory] Auto-capture: No meaningful messages to capture');
        return;
      }

      const sessionId = event.sessionId || 'unknown';

      // ============================================================
      // ADAPTIVE SCORING: Analyze conversation and determine importance
      // ============================================================

      if (scoringConfig.enabled) {
        console.log('[graphiti-memory] Scoring conversation for importance...');

        const scoreResult = await scorer.scoreConversation(conversationSegments);

        console.log(`[graphiti-memory] Score: ${scoreResult.score}/10 (${scoreResult.tier})`);
        console.log(`[graphiti-memory] Reasoning: ${scoreResult.reasoning}`);
        console.log(`[graphiti-memory] Action: ${scoreResult.recommendedAction}`);

        // Handle based on recommended action
        switch (scoreResult.recommendedAction) {
          case 'skip':
            console.log('[graphiti-memory] Skipping capture - low importance');
            return;

          case 'store_ephemeral':
            console.log('[graphiti-memory] Storing as ephemeral (short-term)');
            await storeWithMetadata(adapter, conversationSegments, sessionId, scoreResult);
            return;

          case 'store_silent':
            console.log('[graphiti-memory] Storing as silent (medium importance)');
            await storeWithMetadata(adapter, conversationSegments, sessionId, scoreResult);
            return;

          case 'store_explicit':
            console.log('[graphiti-memory] Storing as explicit (high importance)');
            await storeWithMetadata(adapter, conversationSegments, sessionId, scoreResult);

            // Optional: Notify user if configured
            if (scoringConfig.notifyOnExplicit) {
              console.log('[graphiti-memory] Would notify user: "Got it, noting that"');
            }
            return;
        }
      }

      // Fallback: Store as before (no scoring)
      const conversation = conversationSegments
        .map(s => `${s.role}: ${s.content}`)
        .join('\n\n');

      console.log(`[graphiti-memory] Auto-capturing ${conversationSegments.length} messages`);

      await adapter.store(
        `[Session ${sessionId}]\n${conversation}`,
        {
          tier: 'silent',
          score: 5,
          source: 'auto_capture',
          sessionId,
        }
      );

      console.log('[graphiti-memory] Auto-capture: Conversation stored successfully');
    } catch (err) {
      console.error('[graphiti-memory] Auto-capture error:', err instanceof Error ? err.message : String(err));
      // Don't fail - continue normally
    }
  });

  // Register heartbeat/cleanup hook
  api.on('heartbeat', async () => {
    if (!scoringConfig.enabled) return;

    console.log('[graphiti-memory] Running scheduled memory maintenance...');

    // Cleanup expired ephemeral memories
    const cleanup = await scorer.cleanupExpiredMemories();
    if (cleanup.deleted > 0) {
      console.log(`[graphiti-memory] Cleaned up ${cleanup.deleted} expired memories`);
    }

    // Process reinforcements (upgrade/downgrade)
    const reinforcements = await scorer.processReinforcements();
    if (reinforcements.upgraded > 0 || reinforcements.downgraded > 0) {
      console.log(`[graphiti-memory] Memory adjustments: +${reinforcements.upgraded} upgraded, -${reinforcements.downgraded} downgraded`);
    }
  });

  console.log('[graphiti-memory] Hooks registered with adaptive scoring');
}

/**
 * Store conversation with importance scoring metadata
 *
 * Stores the conversation to the adapter with metadata.
 *
 * @param adapter - Memory adapter
 * @param segments - Conversation segments
 * @param sessionId - Current session ID
 * @param scoreResult - Importance scoring result
 */
async function storeWithMetadata(
  adapter: MemoryAdapter,
  segments: { content: string; role: 'user' | 'assistant' }[],
  sessionId: string,
  scoreResult: ScoringResult
): Promise<void> {
  const conversation = segments
    .map(s => `${s.role}: ${s.content}`)
    .join('\n\n');

  // Build metadata
  const metadata = {
    tier: scoreResult.tier,
    score: scoreResult.score,
    source: 'auto_capture' as const,
    sessionId,
    expiresAt: scoreResult.expiresInHours
      ? new Date(Date.now() + scoreResult.expiresInHours * 3600000)
      : undefined,
  };

  // Store to adapter
  await adapter.store(conversation, metadata);

  // Log the stored metadata
  console.log(`[graphiti-memory] Stored with metadata:`, {
    tier: scoreResult.tier,
    score: scoreResult.score,
    expiresInHours: scoreResult.expiresInHours,
    reasoning: scoreResult.reasoning
  });
}
