/**
 * Nuron Memory Plugin for OpenClaw
 *
 * A temporal knowledge graph memory system that provides:
 * - Native memory tools (recall, store, forget, status, list, consolidate, analyze)
 * - Auto-recall before each agent turn
 * - Auto-capture after each conversation
 * - Adaptive importance scoring (Memory Cortex)
 *
 * Uses a Graphiti MCP backend for the current MVP while preserving an adapter boundary.
 *
 * ## Upgrade Notes
 * - v2.0.0: Plugin renamed from 'graphiti-memory' to 'nuron'.
 *   Legacy IDs ('graphiti', 'graphiti-memory') are auto-migrated on startup.
 * - v1.1.0: Plugin ID renamed from 'graphiti' to 'graphiti-memory'.
 *   On startup, any persisted config keyed under the old ID is automatically
 *   migrated to the new ID. No manual intervention is needed.
 */

import { registerTools } from './tools.js';
import { registerHooks } from './hooks.js';
import { adapterFactory } from './adapters/factory.js';
import { createAdapterFromConfig } from './adapters/factory.js';
import type { MemoryAdapter } from './adapters/memory-adapter.js';
import { configureLogger, getLogger, type LogLevel } from './logger.js';

const logger = getLogger();

type ResolvedPluginConfig = Record<string, unknown> & {
  backend: 'graphiti-mcp' | 'auto';
  endpoint: string;
  transport: 'stdio' | 'sse' | 'http';
  groupId: string;
  logLevel: LogLevel;
  autoCapture: boolean;
  autoRecall: boolean;
  recallMaxFacts: number;
  minPromptLength: number;
  scoringEnabled: boolean;
  scoringLegacyEnabled: boolean;
  scoringLegacyMode: boolean;
  scoringExplicitThreshold: number;
  scoringEphemeralThreshold: number;
  scoringEphemeralHours: number;
  scoringSilentDays: number;
  scoringCleanupHours: number;
  scoringNotifyExplicit: boolean;
  scoringAskBeforeDowngrade: boolean;
  scoringMinConversationLength: number;
  scoringMinMessageCount: number;
  scoringDefaultTier: 'explicit' | 'silent' | 'ephemeral';
  scoringModel: {
    provider: 'llamacpp' | 'openai' | 'none';
    model?: string;
    endpoint: string;
    apiKey?: string;
    timeoutMs: number;
  };
  axonDispatchEnabled: boolean;
  axonEnabled: boolean;
  axonSessionLogDir: string;
  axonLookbackHours: number;
  axonEphemeralForgetDays: number;
  axonSilentDecayDays: number;
  axonBatchLimit: number;
  axonMinRepeatCount: number;
  axonDryRun: boolean;
};

/** Previous plugin IDs for migration compatibility */
const LEGACY_PLUGIN_IDS = ['graphiti', 'graphiti-memory'];

let processCleanupRegistered = false;
let processCleanupHandler: (() => Promise<void>) | null = null;

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const BOOLEAN_TRUE_VALUES = new Set(['true', '1', 'yes', 'y', 'on']);
const BOOLEAN_FALSE_VALUES = new Set(['false', '0', 'no', 'n', 'off']);
const BACKEND_VALUES = ['graphiti-mcp', 'auto'] as const;
const TRANSPORT_VALUES = ['stdio', 'sse', 'http'] as const;
const LOG_LEVEL_VALUES = ['silent', 'error', 'warn', 'info', 'debug'] as const;
const DEFAULT_PLUGIN_CONFIG: ResolvedPluginConfig = {
  backend: 'graphiti-mcp',
  endpoint: 'http://localhost:8000/mcp/',
  transport: 'http',
  groupId: 'default',
  logLevel: 'warn',
  autoCapture: true,
  autoRecall: true,
  recallMaxFacts: 5,
  minPromptLength: 20,
  scoringEnabled: true,
  scoringLegacyEnabled: false,
  scoringLegacyMode: false,
  scoringExplicitThreshold: 8,
  scoringEphemeralThreshold: 4,
  scoringEphemeralHours: 72,
  scoringSilentDays: 30,
  scoringCleanupHours: 12,
  scoringNotifyExplicit: true,
  scoringAskBeforeDowngrade: true,
  scoringMinConversationLength: 50,
  scoringMinMessageCount: 1,
  scoringDefaultTier: 'silent',
  scoringModel: {
    provider: 'none',
    endpoint: 'http://localhost:8080',
    timeoutMs: 10000,
  },
  axonDispatchEnabled: false,
  axonEnabled: true,
  axonSessionLogDir: '',
  axonLookbackHours: 24,
  axonEphemeralForgetDays: 5,
  axonSilentDecayDays: 30,
  axonBatchLimit: 20,
  axonMinRepeatCount: 2,
  axonDryRun: false,
};

function registerProcessCleanup(handler: () => Promise<void>, bindProcessSignals = true): void {
  processCleanupHandler = handler;

  if (processCleanupRegistered) {
    return;
  }

  processCleanupRegistered = true;

  let cleaningUp = false;

  const runCleanup = async (reason: string, exitAfterCleanup = false) => {
    if (cleaningUp) {
      return;
    }

    cleaningUp = true;
    logger.debug(`Process cleanup triggered by ${reason}.`);

    try {
      await processCleanupHandler?.();
    } catch (err) {
      logger.error(`Process cleanup failed: ${formatError(err)}`);
    } finally {
      cleaningUp = false;
      if (exitAfterCleanup) {
        process.exit(0);
      }
    }
  };

  const bindSignal = (signal: NodeJS.Signals) => {
    process.once(signal, () => {
      void runCleanup(signal, true);
    });
  };

  if (bindProcessSignals) {
    process.once('disconnect', () => {
      void runCleanup('disconnect', true);
    });

    bindSignal('SIGINT');
    bindSignal('SIGTERM');
    if (process.platform !== 'win32') {
      bindSignal('SIGHUP');
    }
  }
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
    return fallback;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (BOOLEAN_TRUE_VALUES.has(normalized)) {
      return true;
    }
    if (BOOLEAN_FALSE_VALUES.has(normalized)) {
      return false;
    }
  }

  return fallback;
}

function normalizeString(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function normalizeEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  if (typeof value !== 'string') {
    return fallback;
  }

  return (allowed as readonly string[]).includes(value) ? value as T : fallback;
}

function normalizeNumber(value: unknown, fallback: number, min?: number, max?: number): number {
  const numericValue = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  let normalized = Math.round(numericValue);
  if (min != null) {
    normalized = Math.max(min, normalized);
  }
  if (max != null) {
    normalized = Math.min(max, normalized);
  }
  return normalized;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function migratePluginSettings(api: any, currentId: string): void {
  for (const oldId of LEGACY_PLUGIN_IDS) {
    try {
      const store = api?.settingsStore ?? api?.configStore;
      if (!store) break;

      const oldSettings = typeof store.get === 'function' ? store.get(oldId) : undefined;
      if (oldSettings) {
        logger.info(`Migrating persisted settings from legacy ID '${oldId}' to '${currentId}'`);
        if (typeof store.set === 'function') {
          store.set(currentId, oldSettings);
        }
        if (typeof store.delete === 'function') {
          store.delete(oldId);
        }
      }
    } catch (err) {
      logger.warn(`Settings migration from '${oldId}' failed: ${formatError(err)}`);
    }
  }
}

function validateScoringConfig(config: Record<string, unknown>): void {
  const ephemeralThreshold = config.scoringEphemeralThreshold as number | undefined;
  const explicitThreshold = config.scoringExplicitThreshold as number | undefined;

  if (ephemeralThreshold != null && ephemeralThreshold < 0) {
    logger.warn('scoringEphemeralThreshold must be >= 0, clamping to 0');
    config.scoringEphemeralThreshold = 0;
  }
  const clampedEphemeralThreshold = config.scoringEphemeralThreshold as number | undefined;
  if (explicitThreshold != null && clampedEphemeralThreshold != null && explicitThreshold <= clampedEphemeralThreshold) {
    logger.warn('scoringExplicitThreshold must be > scoringEphemeralThreshold, adjusting');
    config.scoringExplicitThreshold = clampedEphemeralThreshold + 1;
  }
  if (config.scoringEphemeralHours != null && (config.scoringEphemeralHours as number) < 1) {
    logger.warn('scoringEphemeralHours must be >= 1, clamping to 1');
    config.scoringEphemeralHours = 1;
  }
  if (config.scoringSilentDays != null && (config.scoringSilentDays as number) < 1) {
    logger.warn('scoringSilentDays must be >= 1, clamping to 1');
    config.scoringSilentDays = 1;
  }
  if (config.scoringCleanupHours != null && (config.scoringCleanupHours as number) < 1) {
    logger.warn('scoringCleanupHours must be >= 1, clamping to 1');
    config.scoringCleanupHours = 1;
  }
  if (config.axonLookbackHours != null && (config.axonLookbackHours as number) < 1) {
    logger.warn('axonLookbackHours must be >= 1, clamping to 1');
    config.axonLookbackHours = 1;
  }
  if (config.axonEphemeralForgetDays != null && (config.axonEphemeralForgetDays as number) < 1) {
    logger.warn('axonEphemeralForgetDays must be >= 1, clamping to 1');
    config.axonEphemeralForgetDays = 1;
  }
  if (config.axonSilentDecayDays != null && (config.axonSilentDecayDays as number) < 1) {
    logger.warn('axonSilentDecayDays must be >= 1, clamping to 1');
    config.axonSilentDecayDays = 1;
  }
  if (config.axonBatchLimit != null && (config.axonBatchLimit as number) < 1) {
    logger.warn('axonBatchLimit must be >= 1, clamping to 1');
    config.axonBatchLimit = 1;
  }
  if (config.axonMinRepeatCount != null && (config.axonMinRepeatCount as number) < 1) {
    logger.warn('axonMinRepeatCount must be >= 1, clamping to 1');
    config.axonMinRepeatCount = 1;
  }

  const scoringModel = config.scoringModel as Record<string, unknown> | undefined;
  if (scoringModel && scoringModel.provider !== 'none') {
    const endpoint = (scoringModel.endpoint as string) || 'http://localhost:8080';
    try {
      const parsed = new URL(endpoint);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`unsupported protocol "${parsed.protocol}"`);
      }
      if (!parsed.hostname) {
        throw new Error('missing hostname');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `[nuron] Invalid scoringModel.endpoint "${endpoint}": ${msg}. ` +
        `Expected a valid HTTP/HTTPS URL (e.g. "http://localhost:8080"). ` +
        `Check your scoringModel config: provider=${scoringModel.provider}, model=${scoringModel.model ?? '(default)'}, endpoint=${endpoint}`
      );
    }
  }
}

export function resolvePluginConfig(rawConfig: Record<string, unknown>): ResolvedPluginConfig {
  const config: ResolvedPluginConfig = {
    ...DEFAULT_PLUGIN_CONFIG,
    ...rawConfig,
    backend: normalizeEnum(rawConfig.backend, BACKEND_VALUES, DEFAULT_PLUGIN_CONFIG.backend),
    endpoint: normalizeString(rawConfig.endpoint, DEFAULT_PLUGIN_CONFIG.endpoint),
    transport: normalizeEnum(rawConfig.transport, TRANSPORT_VALUES, DEFAULT_PLUGIN_CONFIG.transport),
    groupId: normalizeString(rawConfig.groupId, DEFAULT_PLUGIN_CONFIG.groupId),
    logLevel: normalizeEnum(rawConfig.logLevel, LOG_LEVEL_VALUES, DEFAULT_PLUGIN_CONFIG.logLevel),
    autoCapture: normalizeBoolean(rawConfig.autoCapture, DEFAULT_PLUGIN_CONFIG.autoCapture),
    autoRecall: normalizeBoolean(rawConfig.autoRecall, DEFAULT_PLUGIN_CONFIG.autoRecall),
    recallMaxFacts: normalizeNumber(rawConfig.recallMaxFacts, DEFAULT_PLUGIN_CONFIG.recallMaxFacts, 1, 20),
    minPromptLength: normalizeNumber(rawConfig.minPromptLength, DEFAULT_PLUGIN_CONFIG.minPromptLength, 0),
    scoringEnabled: normalizeBoolean(rawConfig.scoringEnabled, DEFAULT_PLUGIN_CONFIG.scoringEnabled),
    scoringLegacyEnabled: normalizeBoolean(rawConfig.scoringLegacyEnabled, DEFAULT_PLUGIN_CONFIG.scoringLegacyEnabled),
    scoringLegacyMode: normalizeBoolean(rawConfig.scoringLegacyMode, DEFAULT_PLUGIN_CONFIG.scoringLegacyMode),
    scoringExplicitThreshold: normalizeNumber(rawConfig.scoringExplicitThreshold, DEFAULT_PLUGIN_CONFIG.scoringExplicitThreshold, 1),
    scoringEphemeralThreshold: normalizeNumber(rawConfig.scoringEphemeralThreshold, DEFAULT_PLUGIN_CONFIG.scoringEphemeralThreshold, 0),
    scoringEphemeralHours: normalizeNumber(rawConfig.scoringEphemeralHours, DEFAULT_PLUGIN_CONFIG.scoringEphemeralHours, 1),
    scoringSilentDays: normalizeNumber(rawConfig.scoringSilentDays, DEFAULT_PLUGIN_CONFIG.scoringSilentDays, 1),
    scoringCleanupHours: normalizeNumber(rawConfig.scoringCleanupHours, DEFAULT_PLUGIN_CONFIG.scoringCleanupHours, 1),
    scoringNotifyExplicit: normalizeBoolean(rawConfig.scoringNotifyExplicit, DEFAULT_PLUGIN_CONFIG.scoringNotifyExplicit),
    scoringAskBeforeDowngrade: normalizeBoolean(rawConfig.scoringAskBeforeDowngrade, DEFAULT_PLUGIN_CONFIG.scoringAskBeforeDowngrade),
    scoringMinConversationLength: normalizeNumber(rawConfig.scoringMinConversationLength, DEFAULT_PLUGIN_CONFIG.scoringMinConversationLength, 0),
    scoringMinMessageCount: normalizeNumber(rawConfig.scoringMinMessageCount, DEFAULT_PLUGIN_CONFIG.scoringMinMessageCount, 1),
    scoringDefaultTier: normalizeEnum(rawConfig.scoringDefaultTier, ['explicit', 'silent', 'ephemeral'] as const, DEFAULT_PLUGIN_CONFIG.scoringDefaultTier),
    scoringModel: {
      provider: DEFAULT_PLUGIN_CONFIG.scoringModel.provider,
      endpoint: DEFAULT_PLUGIN_CONFIG.scoringModel.endpoint,
      timeoutMs: DEFAULT_PLUGIN_CONFIG.scoringModel.timeoutMs,
    },
    axonDispatchEnabled: normalizeBoolean(rawConfig.axonDispatchEnabled, DEFAULT_PLUGIN_CONFIG.axonDispatchEnabled),
    axonEnabled: normalizeBoolean(rawConfig.axonEnabled, DEFAULT_PLUGIN_CONFIG.axonEnabled),
    axonSessionLogDir: normalizeString(rawConfig.axonSessionLogDir, DEFAULT_PLUGIN_CONFIG.axonSessionLogDir),
    axonLookbackHours: normalizeNumber(rawConfig.axonLookbackHours, DEFAULT_PLUGIN_CONFIG.axonLookbackHours, 1),
    axonEphemeralForgetDays: normalizeNumber(rawConfig.axonEphemeralForgetDays, DEFAULT_PLUGIN_CONFIG.axonEphemeralForgetDays, 1),
    axonSilentDecayDays: normalizeNumber(rawConfig.axonSilentDecayDays, DEFAULT_PLUGIN_CONFIG.axonSilentDecayDays, 1),
    axonBatchLimit: normalizeNumber(rawConfig.axonBatchLimit, DEFAULT_PLUGIN_CONFIG.axonBatchLimit, 1),
    axonMinRepeatCount: normalizeNumber(rawConfig.axonMinRepeatCount, DEFAULT_PLUGIN_CONFIG.axonMinRepeatCount, 1),
    axonDryRun: normalizeBoolean(rawConfig.axonDryRun, DEFAULT_PLUGIN_CONFIG.axonDryRun),
  };

  const rawScoringModel = rawConfig.scoringModel;
  if (rawScoringModel != null && !isPlainObject(rawScoringModel)) {
    logger.warn('scoringModel must be an object; falling back to defaults');
  } else if (isPlainObject(rawScoringModel)) {
    config.scoringModel = {
      provider: normalizeEnum(rawScoringModel.provider, ['llamacpp', 'openai', 'none'] as const, DEFAULT_PLUGIN_CONFIG.scoringModel.provider),
      model: typeof rawScoringModel.model === 'string' && rawScoringModel.model.trim() ? rawScoringModel.model.trim() : undefined,
      endpoint: normalizeString(rawScoringModel.endpoint, DEFAULT_PLUGIN_CONFIG.scoringModel.endpoint),
      apiKey: typeof rawScoringModel.apiKey === 'string' && rawScoringModel.apiKey.trim() ? rawScoringModel.apiKey : undefined,
      timeoutMs: normalizeNumber(rawScoringModel.timeoutMs, DEFAULT_PLUGIN_CONFIG.scoringModel.timeoutMs, 1000),
    };
  }

  validateScoringConfig(config);
  return config;
}

export default {
  id: 'nuron',
  legacyIds: LEGACY_PLUGIN_IDS,
  name: 'Nuron',
  description: 'Temporal knowledge graph memory for OpenClaw with adaptive importance scoring',

  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      backend: {
        type: 'string',
        enum: ['graphiti-mcp', 'auto'],
        default: 'graphiti-mcp',
        description: 'Memory backend to use: graphiti-mcp, or auto-detect Graphiti only'
      },
      endpoint: {
        type: 'string',
        default: 'http://localhost:8000/mcp/',
        description: 'Graphiti MCP server endpoint. Use /mcp/ for transport=http, or /sse for legacy SSE servers.'
      },
      transport: {
        type: 'string',
        enum: ['stdio', 'sse', 'http'],
        default: 'http',
        description: 'Graphiti MCP transport type'
      },
      groupId: {
        type: 'string',
        default: 'default',
        description: 'Memory group ID for all conversations'
      },
      logLevel: {
        type: 'string',
        enum: ['silent', 'error', 'warn', 'info', 'debug'],
        default: 'warn',
        description: 'Controls Nuron plugin logging verbosity. Use warn for quiet operation, debug for transport troubleshooting.'
      },
      neo4j: {
        type: 'object',
        properties: {
          uri: { type: 'string' },
          user: { type: 'string' },
          password: { type: 'string' },
          database: { type: 'string' }
        },
        description: 'Deprecated and ignored. Nuron MVP connects through Graphiti rather than directly to Neo4j.'
      },
      autoCapture: {
        type: 'boolean',
        default: true,
        description: 'Automatically capture conversations to memory'
      },
      autoRecall: {
        type: 'boolean',
        default: true,
        description: 'Automatically recall relevant memories before each response'
      },
      recallMaxFacts: {
        type: 'number',
        default: 5,
        minimum: 1,
        maximum: 20,
        description: 'Maximum facts to recall per query'
      },
      minPromptLength: {
        type: 'number',
        default: 20,
        minimum: 1,
        description: 'Minimum prompt length to trigger recall'
      },
      scoringEnabled: {
        type: 'boolean',
        default: true,
        description: 'Enable adaptive importance scoring'
      },
      scoringLegacyEnabled: {
        type: 'boolean',
        default: false,
        description: 'Opt in to the legacy scorer cleanup and reinforcement loops during heartbeat maintenance.'
      },
      scoringLegacyMode: {
        type: 'boolean',
        default: false,
        description: 'Legacy alias for enabling the scorer maintenance loops during heartbeat maintenance.'
      },
      scoringExplicitThreshold: {
        type: 'number',
        default: 8,
        minimum: 1,
        maximum: 10,
        description: 'Score >= this triggers explicit storage. Must be > scoringEphemeralThreshold.'
      },
      scoringEphemeralThreshold: {
        type: 'number',
        default: 4,
        minimum: 0,
        maximum: 9,
        description: 'Score < this triggers ephemeral storage. Must be < scoringExplicitThreshold.'
      },
      scoringEphemeralHours: {
        type: 'number',
        default: 72,
        minimum: 1,
        maximum: 168,
        description: 'Hours before ephemeral memories auto-expire'
      },
      scoringSilentDays: {
        type: 'number',
        default: 30,
        minimum: 1,
        maximum: 365,
        description: 'Days before silent memories need reinforcement'
      },
      scoringCleanupHours: {
        type: 'number',
        default: 12,
        minimum: 1,
        maximum: 24,
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
      },
      scoringMinConversationLength: {
        type: 'number',
        default: 50,
        minimum: 0,
        description: 'Minimum total character length across all messages to trigger scoring. Shorter conversations default to ephemeral.'
      },
      scoringMinMessageCount: {
        type: 'number',
        default: 1,
        minimum: 1,
        description: 'Minimum number of messages required to trigger scoring'
      },
      scoringDefaultTier: {
        type: 'string',
        enum: ['explicit', 'silent', 'ephemeral'],
        default: 'silent',
        description: 'Default memory tier when scoringEnabled is false ("dumb mode")'
      },
      scoringModel: {
        type: 'object',
        additionalProperties: false,
        properties: {
          provider: {
            type: 'string',
            enum: ['llamacpp', 'openai', 'none'],
            default: 'none',
            description: 'Scoring model provider. "llamacpp" for a llama.cpp server, "openai" for any OpenAI-compatible API, "none" to use built-in heuristic scoring'
          },
          model: {
            type: 'string',
            description: 'Model name sent in the API request (e.g. "qwen2.5:0.5b")'
          },
          endpoint: {
            type: 'string',
            default: 'http://localhost:8080',
            description: 'Scoring model server URL (llama.cpp server or OpenAI-compatible endpoint)'
          },
          apiKey: {
            type: 'string',
            description: 'API key (required for openai provider, optional for llamacpp)'
          },
          timeoutMs: {
            type: 'number',
            default: 10000,
            minimum: 1000,
            description: 'Request timeout in milliseconds'
          }
        },
        description: 'Optional local model for importance scoring instead of heuristics. Uses llama.cpp server API (OpenAI-compatible /v1/chat/completions).'
      },
      axonDispatchEnabled: {
        type: 'boolean',
        default: false,
        description: 'Opt in to heartbeat-based Axon dispatch when the host exposes a supported dispatchAxonTrigger hook.'
      },
      axonEnabled: {
        type: 'boolean',
        default: true,
        description: 'Enable Axon daily-memory hygiene tools and policy defaults. Scheduling still belongs in OpenClaw cron.'
      },
      axonSessionLogDir: {
        type: 'string',
        default: '',
        description: 'Optional directory containing OpenClaw daily Markdown session logs for Axon review. Empty means graph-only mode.'
      },
      axonLookbackHours: {
        type: 'number',
        default: 24,
        minimum: 1,
        maximum: 168,
        description: 'Default Axon lookback window in hours when gathering daily sources.'
      },
      axonEphemeralForgetDays: {
        type: 'number',
        default: 5,
        minimum: 1,
        maximum: 365,
        description: 'Days after which stale ephemeral memories become prune candidates for Axon.'
      },
      axonSilentDecayDays: {
        type: 'number',
        default: 30,
        minimum: 1,
        maximum: 365,
        description: 'Days after which silent memories should be reviewed for decay or reconsolidation.'
      },
      axonBatchLimit: {
        type: 'number',
        default: 20,
        minimum: 1,
        maximum: 100,
        description: 'Maximum items Axon should gather per source group in one run.'
      },
      axonMinRepeatCount: {
        type: 'number',
        default: 2,
        minimum: 1,
        maximum: 20,
        description: 'Minimum reinforcement count that keeps an ephemeral memory from being considered stale.'
      },
      axonDryRun: {
        type: 'boolean',
        default: false,
        description: 'When true, memory_axon_apply_plan reports intended actions without mutating the graph.'
      }
    }
  },

  async register(api: any) {
    const config = resolvePluginConfig(api?.pluginConfig ?? {});
    configureLogger(api?.logger, config.logLevel);

    migratePluginSettings(api, 'nuron');

    const safeConfig = {
      backend: config.backend || 'graphiti-mcp',
      transport: config.transport || 'http',
      endpoint: config.endpoint ? '[configured]' : 'http://localhost:8000/mcp/',
      groupId: config.groupId ?? 'default',
      logLevel: config.logLevel,
      autoCapture: config.autoCapture,
      autoRecall: config.autoRecall,
      scoringEnabled: config.scoringEnabled,
      axonEnabled: config.axonEnabled,
      axonSessionLogDir: config.axonSessionLogDir ? '[configured]' : '[none]'
    };
    logger.debug(`Registering plugin with config: ${JSON.stringify(safeConfig)}`);

    let adapter: MemoryAdapter;

    try {
      if (config.backend === 'auto') {
        logger.info('Auto-detecting Graphiti memory backend.');
      } else {
        logger.info('Using Graphiti MCP backend.');
      }

      adapter = await createAdapterFromConfig(config as unknown as Record<string, unknown>);

      if (!adapter) {
        adapter = config.backend === 'auto'
          ? await adapterFactory.autoDetect({
              type: 'graphiti-mcp',
              endpoint: config.endpoint,
              transport: config.transport,
              groupId: config.groupId,
            })
          : adapterFactory.create({
              type: 'graphiti-mcp',
              endpoint: config.endpoint,
              transport: config.transport,
              groupId: config.groupId,
            });

        await adapter.initialize();
      }

      const health = await adapter.healthCheck();
      if (!health.healthy) {
        logger.warn(`Memory backend not healthy: ${String(health.details ?? 'no details provided')}`);
      } else {
        logger.info(`Connected to ${health.backend} backend.`);
      }
    } catch (err) {
      logger.error(`Failed to initialize memory backend: ${formatError(err)}`);
      throw err;
    }

    registerTools(api, adapter, config);
    registerHooks(api, adapter, config);

    const shutdownHandler = async () => {
      try {
        logger.debug('Shutting down memory backend.');
        await adapter.shutdown();
        logger.debug('Shutdown complete.');
      } catch (err) {
        logger.error(`Shutdown error: ${formatError(err)}`);
      }
    };

    const hasHostShutdownHook = typeof api?.onShutdown === 'function';
    const hasHostEventBus = typeof api?.on === 'function';

    registerProcessCleanup(shutdownHandler, !hasHostShutdownHook && !hasHostEventBus);

    if (hasHostShutdownHook) {
      api.onShutdown(shutdownHandler);
    } else if (hasHostEventBus) {
      api.on('shutdown', shutdownHandler);
    }

    logger.info('Plugin registered successfully with Memory Cortex.');
  }
};
