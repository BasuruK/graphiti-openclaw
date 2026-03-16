/**
 * Nuron Memory Hooks for OpenClaw
 *
 * Provides auto-recall, auto-capture, and adaptive importance scoring functionality.
 * Now uses MemoryAdapter interface for backend-agnostic operation.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { MemoryAdapter } from './adapters/memory-adapter.js';
import { createMemoryScorer, DEFAULT_SCORING_CONFIG, type ConversationSegment, type ScoringConfig, type ScoringResult, type ScoringModelConfig } from './memory-scorer.js';
import { getLogger } from './logger.js';

const logger = getLogger('hooks');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Minimum message length to consider for capture */
const MIN_MESSAGE_LENGTH = 20;
/** Maximum messages to capture per turn */
const MAX_CAPTURE_MESSAGES = 15;

const THINK_BLOCK_RE = /<think>[\s\S]*?<\/think>/gi;
const XML_TAG_RE = /<[^>]+>/g;
const ASSISTANT_FILLER_PATTERNS = [
  /^(great|awesome|sure|absolutely|definitely|certainly|okay|ok|got it|understood|sounds good|no problem|of course|happy to help|glad to help|let me help|i can help)([!.\s,].*)?$/i,
  /^(thanks|thank you|you're welcome|you are welcome)([!.\s,].*)?$/i,
  /^(here'?s|here are|i'll|i will|let's|lets)\b/i,
];

function sanitizeMessageText(text: string): string {
  return text
    .replace(THINK_BLOCK_RE, ' ')
    .replace(XML_TAG_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isAssistantFillerResponse(text: string): boolean {
  if (!text) return true;
  if (text.length > 180) return false;
  return ASSISTANT_FILLER_PATTERNS.some((pattern) => pattern.test(text));
}

function extractConversationSegments(messages: any[]): ConversationSegment[] {
  const conversationSegments: ConversationSegment[] = [];
  const startIdx = Math.max(0, messages.length - MAX_CAPTURE_MESSAGES);

  for (let i = startIdx; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg || typeof msg !== 'object') continue;

    const msgObj = msg as Record<string, any>;
    const role = msgObj.role;
    if (role !== 'user' && role !== 'assistant') continue;

    let text = '';
    const content = msgObj.content;
    if (typeof content === 'string') {
      text = content;
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (block && typeof block === 'object' && 'type' in block && block.type === 'text') {
          text += ` ${block.text || ''}`;
        }
      }
    }

    const sanitized = sanitizeMessageText(text);

    if (!sanitized || sanitized.length < MIN_MESSAGE_LENGTH) continue;
    if (sanitized.includes('Relevant memories:') || sanitized.includes('system_memory_instructions')) continue;
    if (role === 'assistant' && isAssistantFillerResponse(sanitized)) continue;

    conversationSegments.push({
      content: sanitized.slice(0, 500),
      role,
    });
  }

  return conversationSegments;
}

/** Module-level timestamp for throttling heartbeat maintenance */
let lastMaintenanceAt = 0;
const MEMORY_MD_PATH = path.resolve(__dirname, '../MEMORY.md');

let memoryInstructionsCache: { mtimeMs: number; value: string } | null = null;

function getCachedMemoryInstructions(): string {
  try {
    if (!fs.existsSync(MEMORY_MD_PATH)) {
      memoryInstructionsCache = null;
      return '';
    }

    const { mtimeMs } = fs.statSync(MEMORY_MD_PATH);
    if (memoryInstructionsCache && memoryInstructionsCache.mtimeMs === mtimeMs) {
      return memoryInstructionsCache.value;
    }

    const value = fs.readFileSync(MEMORY_MD_PATH, 'utf-8');
    memoryInstructionsCache = { mtimeMs, value };
    return value;
  } catch (err) {
    logger.error(`Could not load MEMORY.md instructions: ${err instanceof Error ? err.message : String(err)}`);
    return memoryInstructionsCache?.value ?? '';
  }
}

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
  // Build scoring model config from plugin config (if provided)
  let scoringModelConfig: ScoringModelConfig | undefined;
  if (config.scoringModel && config.scoringModel.provider && config.scoringModel.provider !== 'none') {
    scoringModelConfig = {
      provider: config.scoringModel.provider,
      model: config.scoringModel.model,
      endpoint: config.scoringModel.endpoint,
      apiKey: config.scoringModel.apiKey,
      timeoutMs: config.scoringModel.timeoutMs,
    };
  }

  const scoringConfig: Partial<ScoringConfig> = {
    enabled: config.scoringEnabled !== false,
    explicitThreshold: config.scoringExplicitThreshold ?? DEFAULT_SCORING_CONFIG.explicitThreshold,
    ephemeralThreshold: config.scoringEphemeralThreshold ?? DEFAULT_SCORING_CONFIG.ephemeralThreshold,
    defaultEphemeralHours: config.scoringEphemeralHours ?? DEFAULT_SCORING_CONFIG.defaultEphemeralHours,
    defaultSilentDays: config.scoringSilentDays ?? DEFAULT_SCORING_CONFIG.defaultSilentDays,
    cleanupIntervalHours: config.scoringCleanupHours ?? DEFAULT_SCORING_CONFIG.cleanupIntervalHours,
    notifyOnExplicit: config.scoringNotifyExplicit !== false,
    askBeforeDowngrade: config.scoringAskBeforeDowngrade !== false,
    minConversationLength: config.scoringMinConversationLength ?? DEFAULT_SCORING_CONFIG.minConversationLength,
    minMessageCount: config.scoringMinMessageCount ?? DEFAULT_SCORING_CONFIG.minMessageCount,
    defaultTier: config.scoringDefaultTier ?? DEFAULT_SCORING_CONFIG.defaultTier,
    scoringModel: scoringModelConfig,
  };

  const scorer = createMemoryScorer(adapter, scoringConfig);

  // Auto-Recall: Before each agent turn, inject relevant context
  api.on('before_agent_start', async (event: any) => {
    if (!config.autoRecall) return;

    const prompt = event.prompt || '';
    if (!prompt || prompt.length < config.minPromptLength) return;

    try {
      logger.debug('Auto-recall searching for relevant context.');

      const results = await adapter.recall(prompt, {
        limit: config.recallMaxFacts || 5,
        tier: 'all'
      });

      // If no results, still return MEMORY.md instructions for the system prompt
      const contextBlock = results && results.length > 0
        ? results
            .slice(0, config.recallMaxFacts || 5)
            .map((r, i) => `• ${r.summary || r.content.substring(0, 100)}`)
            .join('\n')
        : 'No relevant memories found.';

      logger.debug(`Auto-recall found ${results ? results.length : 0} relevant memories.`);

      const memoryInstructions = getCachedMemoryInstructions();

      // Keep recall context in user-visible prepended context, but keep classification
      // instructions in system-only context so they do not appear in chat history.
      return {
        prependContext: `<memory>\nRelevant memories:\n${contextBlock}\n</memory>`,
        prependSystemContext: `<system_memory_instructions>\n${memoryInstructions}\n</system_memory_instructions>`
      };
    } catch (err) {
      logger.error(`Auto-recall error: ${err instanceof Error ? err.message : String(err)}`);
      // Don't fail - continue without memory
    }
  });

  // Auto-Capture: After each conversation turn (with importance scoring)
  api.on('agent_end', async (event: any) => {
    if (!config.autoCapture) return;

    const messages = event.messages;
    if (!messages || !Array.isArray(messages) || messages.length === 0) return;

    try {
      const conversationSegments = extractConversationSegments(messages);

      if (conversationSegments.length === 0) {
        logger.debug('Auto-capture found no meaningful messages to capture.');
        return;
      }

      const sessionId = event.sessionId || 'unknown';
      const scoreResult = await scorer.scoreConversation(conversationSegments);

      logger.debug(`Auto-capture scored conversation ${scoreResult.score}/10 (${scoreResult.tier}).`);

      if (scoreResult.recommendedAction === 'skip') {
        logger.debug('Auto-capture skipped low-importance conversation.');
        return;
      }

      await storeWithMetadata(adapter, conversationSegments, sessionId, scoreResult);

      if (scoreResult.tier === 'explicit' && scoringConfig.notifyOnExplicit) {
        logger.info('Auto-capture stored an explicit memory.');
      }

    } catch (err) {
      logger.error(`Auto-capture error: ${err instanceof Error ? err.message : String(err)}`);
      // Don't fail - continue normally
    }
  });

  // Register heartbeat/cleanup hook
  api.on('heartbeat', async () => {
    if (!scoringConfig.enabled) return;

    // Throttle: only run maintenance every cleanupIntervalHours
    const intervalMs = (scoringConfig.cleanupIntervalHours ?? DEFAULT_SCORING_CONFIG.cleanupIntervalHours) * 3600000;
    const now = Date.now();
    if (now - lastMaintenanceAt < intervalMs) return;

    logger.info('Running scheduled memory maintenance.');

    // Legacy Scorers: Only run if explicitly enabled (opt-in)
    if (config.scoringLegacyEnabled === true || config.scoringLegacyMode === true) {
      // Cleanup expired ephemeral memories (isolated)
      try {
        const cleanup = await scorer.cleanupExpiredMemories();
        if (cleanup.deleted > 0) {
          logger.info(`Cleaned up ${cleanup.deleted} expired memories.`);
        }
      } catch (err) {
        logger.error(`Cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      // Process reinforcements (isolated — runs even if cleanup failed)
      try {
        const reinforcements = await scorer.processReinforcements();
        if (reinforcements.upgraded > 0 || reinforcements.downgraded > 0) {
          logger.info(`Memory adjustments: +${reinforcements.upgraded} upgraded, -${reinforcements.downgraded} downgraded.`);
        }
      } catch (err) {
        logger.error(`Reinforcement processing failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Trigger Axon Memory Consolidation Agent
    try {
      const dispatched = await dispatchAxonTrigger(api, config);
      if (dispatched) {
        logger.info('Dispatched synthesis trigger to Axon agent.');
      }
    } catch (err) {
      logger.error(`Axon Agent trigger failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    lastMaintenanceAt = now;
  });

  logger.info('Hooks registered with adaptive scoring.');
}

async function storeWithMetadata(
  adapter: MemoryAdapter,
  segments: { content: string; role: 'user' | 'assistant' }[],
  sessionId: string,
  scoreResult: ScoringResult
): Promise<void> {
  const conversation = segments
    .map((segment) => `${segment.role}: ${segment.content}`)
    .join('\n\n');

  const expiresAt = scoreResult.expiresInHours
    ? new Date(Date.now() + scoreResult.expiresInHours * 3600000)
    : undefined;

  await adapter.store(conversation, {
    tier: scoreResult.tier,
    score: scoreResult.score,
    source: 'auto_capture',
    sessionId,
    expiresAt,
  });
}

/**
 * Helper to dispatch the Axon consolidation trigger via an explicitly provided host hook.
 */
async function dispatchAxonTrigger(api: any, config: any): Promise<boolean> {
  if (config.axonDispatchEnabled !== true) {
    return false;
  }

  const payload = {
    trigger: 'cron_consolidation' as const,
    timestamp: Date.now()
  };

  const dispatchHook =
    typeof api?.dispatchAxonTrigger === 'function'
      ? api.dispatchAxonTrigger
      : typeof api?.nuron?.dispatchAxonTrigger === 'function'
        ? api.nuron.dispatchAxonTrigger
        : undefined;

  if (!dispatchHook) {
    logger.warn('Axon dispatch is enabled but no supported dispatch hook is available; skipping trigger.');
    return false;
  }

  await Promise.resolve(dispatchHook(payload));
  return true;
}
