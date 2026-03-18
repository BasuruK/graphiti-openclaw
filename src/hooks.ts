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
import { reinforceMemories } from './memory-maintenance.js';

const logger = getLogger('hooks');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Minimum message length to consider for capture */
const MIN_MESSAGE_LENGTH = 20;
/** Maximum messages to capture per turn */
const MAX_CAPTURE_MESSAGES = 15;

const THINK_BLOCK_RE = /<think\b[^>]*>[\s\S]*?(?:<\/think>|$)/gi;
const XML_TAG_RE = /<[^>]+>/g;
const ASSISTANT_FILLER_PATTERNS = [
  /^(great|awesome|sure|absolutely|definitely|certainly|okay|ok|got it|understood|sounds good|no problem|of course|happy to help|glad to help|let me help|i can help)(?:[!.\s,]+)?$/i,
  /^(thanks|thank you|you're welcome|you are welcome)(?:[!.\s,]+)?$/i,
];
const ASSISTANT_FILLER_PREFIX_RE = /^(?:(?:great|awesome|sure|absolutely|definitely|certainly|okay|ok|got it|understood|sounds good|no problem|of course|thanks|thank you|you're welcome|you are welcome)[!.\s,]+)+/i;
const ASSISTANT_GENERIC_REPLY_RE = /^(?:i can help with that|i can help|happy to help|let me help|i'll help|i will help|here to help|what can i do for you)(?:[!.\s,]+)?$/i;

/** Module-level timestamp for throttling heartbeat maintenance */
let lastMaintenanceAt = 0;
const MEMORY_MD_PATH = path.resolve(__dirname, '../MEMORY.md');

let memoryInstructionsCache: { mtimeMs: number; value: string } | null = null;

function sanitizeMessageText(text: string): string {
  return text
    .replace(THINK_BLOCK_RE, ' ')
    .replace(XML_TAG_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasExplicitMemoryMarker(content: string): boolean {
  const lowerContent = content.toLowerCase();
  return [
    'remember',
    'dont forget',
    "don't forget",
    'important',
    'note that',
    'keep in mind',
    'save this',
    'store this',
  ].some((marker) => lowerContent.includes(marker));
}

function isAssistantFillerResponse(text: string): boolean {
  if (!text) return true;
  if (text.length > 180) return false;

  if (ASSISTANT_FILLER_PATTERNS.some((pattern) => pattern.test(text))) {
    return true;
  }

  const trimmed = text.trim();
  const withoutLeadingFiller = trimmed.replace(ASSISTANT_FILLER_PREFIX_RE, '').trim();
  if (withoutLeadingFiller === trimmed) {
    return false;
  }

  return (
    withoutLeadingFiller.length === 0 ||
    ASSISTANT_FILLER_PATTERNS.some((pattern) => pattern.test(withoutLeadingFiller)) ||
    ASSISTANT_GENERIC_REPLY_RE.test(withoutLeadingFiller)
  );
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

    if (!sanitized) continue;
    if (
      sanitized.includes('Relevant memories:') ||
      sanitized.includes('system_memory_instructions') ||
      sanitized.includes('<memory>') ||
      sanitized.includes('<relevant-memories>')
    ) {
      continue;
    }
    if (role === 'assistant' && isAssistantFillerResponse(sanitized)) continue;
    if (sanitized.length < MIN_MESSAGE_LENGTH && !hasExplicitMemoryMarker(sanitized)) continue;

    conversationSegments.push({
      content: sanitized.slice(0, 500),
      role,
    });
  }

  return conversationSegments;
}

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

export function registerHooks(api: any, adapter: MemoryAdapter, config: any) {
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

      void reinforceMemories(adapter, results).catch((err) => {
        logger.debug(`Recall reinforcement skipped: ${err instanceof Error ? err.message : String(err)}`);
      });

      const contextBlock = results && results.length > 0
        ? results
            .slice(0, config.recallMaxFacts || 5)
            .map((r) => `• ${r.summary || r.content.substring(0, 100)}`)
            .join('\n')
        : 'No relevant memories found.';

      logger.debug(`Auto-recall found ${results ? results.length : 0} relevant memories.`);

      const memoryInstructions = getCachedMemoryInstructions();

      return {
        prependContext: `<memory>\nRelevant memories:\n${contextBlock}\n</memory>`,
        prependSystemContext: `<system_memory_instructions>\n${memoryInstructions}\n</system_memory_instructions>`,
      };
    } catch (err) {
      logger.error(`Auto-recall error: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

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

      logger.debug(
        `Auto-capture scored conversation ${scoreResult.score}/10 (${scoreResult.tier}, disposition=${scoreResult.disposition}, kind=${scoreResult.memoryKind}).`
      );

      if (scoreResult.disposition === 'skip' || scoreResult.recommendedAction === 'skip') {
        logger.debug('Auto-capture skipped low-importance conversation.');
        return;
      }

      await storeWithMetadata(adapter, sessionId, scoreResult, conversationSegments);

      if (scoreResult.disposition === 'explicit' && scoringConfig.notifyOnExplicit) {
        logger.info('Auto-capture stored an explicit memory.');
      }
    } catch (err) {
      logger.error(`Auto-capture error: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  api.on('heartbeat', async () => {
    const intervalMs = (scoringConfig.cleanupIntervalHours ?? DEFAULT_SCORING_CONFIG.cleanupIntervalHours) * 3600000;
    const now = Date.now();
    if (now - lastMaintenanceAt < intervalMs) return;

    logger.info('Running scheduled memory maintenance.');

    if (config.scoringLegacyEnabled === true || config.scoringLegacyMode === true) {
      try {
        const cleanup = await scorer.cleanupExpiredMemories();
        if (cleanup.deleted > 0) {
          logger.info(`Cleaned up ${cleanup.deleted} expired memories.`);
        }
      } catch (err) {
        logger.error(`Cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      try {
        const reinforcements = await scorer.processReinforcements();
        if (reinforcements.upgraded > 0 || reinforcements.downgraded > 0) {
          logger.info(`Memory adjustments: +${reinforcements.upgraded} upgraded, -${reinforcements.downgraded} downgraded.`);
        }
      } catch (err) {
        logger.error(`Reinforcement processing failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

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
  sessionId: string,
  scoreResult: ScoringResult,
  conversationSegments: ConversationSegment[]
): Promise<void> {
  if (scoreResult.disposition === 'skip') {
    return;
  }

  const expiresAt = scoreResult.expiresInHours
    ? new Date(Date.now() + scoreResult.expiresInHours * 3600000)
    : undefined;

  const transcript = conversationSegments
    .map((segment) => `${segment.role}: ${segment.content}`)
    .join('\n');
  const hasShortExplicitReminder = conversationSegments.some((segment) => segment.content.length < MIN_MESSAGE_LENGTH);
  const storageContent = hasShortExplicitReminder ? transcript : scoreResult.summary;

  await adapter.store(storageContent, {
    tier: scoreResult.disposition,
    disposition: scoreResult.disposition,
    score: scoreResult.score,
    source: 'auto_capture',
    sessionId,
    expiresAt,
    summary: scoreResult.summary,
    memoryKind: scoreResult.memoryKind,
    tags: ['auto_capture', scoreResult.memoryKind],
  });
}

async function dispatchAxonTrigger(api: any, config: any): Promise<boolean> {
  if (config.axonEnabled === false || config.axonDispatchEnabled !== true) {
    return false;
  }

  const payload = {
    trigger: 'cron_consolidation' as const,
    timestamp: Date.now()
  };

  const directDispatch = typeof api?.dispatchAxonTrigger === 'function'
    ? api.dispatchAxonTrigger.bind(api)
    : undefined;
  const nestedDispatch = typeof api?.nuron?.dispatchAxonTrigger === 'function'
    ? api.nuron.dispatchAxonTrigger.bind(api.nuron)
    : undefined;
  const dispatchHook = directDispatch ?? nestedDispatch;

  if (!dispatchHook) {
    logger.warn('Axon dispatch is enabled but no supported dispatch hook is available; skipping trigger.');
    return false;
  }

  await Promise.resolve(dispatchHook(payload));
  return true;
}
