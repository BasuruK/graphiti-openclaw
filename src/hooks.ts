/**
 * Graphiti Memory Hooks for OpenClaw
 * 
 * Provides auto-recall, auto-capture, and adaptive importance scoring functionality.
 */

import { GraphitiClient } from './client.js';
import { MemoryScorer, createMemoryScorer, DEFAULT_SCORING_CONFIG, ScoringConfig } from './memory-scorer.js';

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
 * @param client - Graphiti client instance
 * @param config - Plugin configuration
 */
export function registerHooks(api: any, client: GraphitiClient, config: any) {
  
  // Initialize Memory Scorer with config
  const scoringConfig: Partial<ScoringConfig> = {
    enabled: config.scoringEnabled !== false,
    explicitThreshold: config.scoringExplicitThreshold || DEFAULT_SCORING_CONFIG.explicitThreshold,
    ephemeralThreshold: config.scoringEphemeralThreshold || DEFAULT_SCORING_CONFIG.ephemeralThreshold,
    defaultEphemeralHours: config.scoringEphemeralHours || DEFAULT_SCORING_CONFIG.defaultEphemeralHours,
    defaultSilentDays: config.scoringSilentDays || DEFAULT_SCORING_CONFIG.defaultSilentDays,
    cleanupIntervalHours: config.scoringCleanupHours || DEFAULT_SCORING_CONFIG.cleanupIntervalHours,
    notifyOnExplicit: config.scoringNotifyExplicit !== false,
    askBeforeDowngrade: config.scoringAskBeforeDowngrade !== false
  };

  const scorer = createMemoryScorer(client, scoringConfig);

  // Auto-Recall: Before each agent turn, inject relevant context
  api.on('before_agent_start', async (event: any) => {
    if (!config.autoRecall) return;
    
    const prompt = event.prompt || '';
    if (!prompt || prompt.length < config.minPromptLength) return;

    try {
      console.log('[graphiti-memory] Auto-recall: Searching for relevant context...');
      
      const results = await client.searchNodes(prompt, config.recallMaxFacts || 5);
      
      if (!results || results.length === 0) {
        console.log('[graphiti-memory] Auto-recall: No relevant memories found');
        return;
      }

      const contextBlock = results
        .slice(0, config.recallMaxFacts || 5)
        .map((r, i) => `• ${r.summary || r.name || r.fact}`)
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
            // TODO: Store with ephemeral tier + expiry metadata
            // For now, store normally but log the intent
            await storeWithMetadata(client, conversationSegments, sessionId, scoreResult);
            return;
            
          case 'store_silent':
            console.log('[graphiti-memory] Storing as silent (medium importance)');
            await storeWithMetadata(client, conversationSegments, sessionId, scoreResult);
            return;
            
          case 'store_explicit':
            console.log('[graphiti-memory] Storing as explicit (high importance)');
            // Store with metadata - will notify user
            await storeWithMetadata(client, conversationSegments, sessionId, scoreResult);
            
            // Optional: Notify user if configured
            if (scoringConfig.notifyOnExplicit) {
              // Return a message to be shown to user (handled by hook return)
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

      await client.addEpisode(
        `[Session ${sessionId}]\n${conversation}`,
        `session-${sessionId}-${Date.now()}`
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
 * Stores the conversation to Graphiti and logs the scoring metadata.
 * In production, this would also store the importance/tier properties
 * to the Graphiti node itself.
 * 
 * @param client - Graphiti client
 * @param segments - Conversation segments
 * @param sessionId - Current session ID
 * @param scoreResult - Importance scoring result
 */
async function storeWithMetadata(
  client: GraphitiClient,
  segments: { content: string; role: 'user' | 'assistant' }[],
  sessionId: string,
  scoreResult: any
): Promise<void> {
  const conversation = segments
    .map(s => `${s.role}: ${s.content}`)
    .join('\n\n');

  const summary = `[${scoreResult.tier.toUpperCase()}] Session ${sessionId}\n${conversation}`;
  const name = `session-${sessionId}-${Date.now()}`;

  // Store to Graphiti - in production, we'd add metadata to the episode
  await client.addEpisode(summary, name);
  
  // Log the stored metadata (in production, would store in Graphiti properties)
  console.log(`[graphiti-memory] Stored with metadata:`, {
    tier: scoreResult.tier,
    score: scoreResult.score,
    expiresInHours: scoreResult.expiresInHours,
    reasoning: scoreResult.reasoning
  });
}
