import * as fs from 'fs/promises';
import * as path from 'path';

import type { MemoryAdapter, MemoryKind, MemoryResult } from './adapters/memory-adapter.js';
import { getLogger } from './logger.js';
import { markMemoriesConsolidated, promoteMemory, pruneMemories, reinforceMemories } from './memory-maintenance.js';

const logger = getLogger('axon');

export interface AxonRuntimeConfig {
  axonEnabled: boolean;
  axonSessionLogDir: string;
  axonLookbackHours: number;
  axonEphemeralForgetDays: number;
  axonSilentDecayDays: number;
  axonBatchLimit: number;
  axonMinRepeatCount: number;
  axonDryRun: boolean;
}

export interface AxonSessionLogExcerpt {
  path: string;
  modifiedAt: string;
  excerpt: string;
}

export interface AxonDailySources {
  generatedAt: string;
  lookbackHours: number;
  sessionLogExcerpts: AxonSessionLogExcerpt[];
  graphMemories: MemoryResult[];
  staleEphemeralCandidates: MemoryResult[];
  warnings: string[];
}

export type AxonPlanAction = 'store' | 'promote' | 'reinforce' | 'connect' | 'merge' | 'prune';

export interface AxonConnection {
  fromId: string;
  toId: string;
  relationship: string;
}

export interface AxonPlanOperation {
  action: AxonPlanAction;
  id?: string;
  ids?: string[];
  sourceIds?: string[];
  tier?: 'explicit' | 'silent' | 'ephemeral';
  content?: string;
  summary?: string;
  insight?: string;
  memoryKind?: MemoryKind;
  score?: number;
  fromId?: string;
  toId?: string;
  relationship?: string;
  connections?: AxonConnection[];
  consolidated?: boolean;
  sourceLogPath?: string;
  sourceLogDate?: string;
  sourceLogExcerpt?: string;
}

export interface AxonApplyOutcome {
  action: AxonPlanAction;
  dryRun: boolean;
  status: 'executed' | 'skipped' | 'error';
  detail: string;
}

export interface AxonApplyResult {
  dryRun: boolean;
  outcomes: AxonApplyOutcome[];
}

function chunkExcerpt(text: string, maxChars = 700): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return '';
  }

  const excerpt = lines.slice(-8).join('\n');
  return excerpt.length > maxChars ? `${excerpt.slice(0, maxChars - 3)}...` : excerpt;
}

async function listMarkdownFiles(rootDir: string): Promise<string[]> {
  const markdownFiles: string[] = [];
  const pending = [rootDir];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) {
      continue;
    }

    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        markdownFiles.push(entryPath);
      }
    }
  }

  return markdownFiles;
}

async function readRecentSessionLogExcerpts(
  sessionLogDir: string,
  cutoff: Date,
  limit: number
): Promise<AxonSessionLogExcerpt[]> {
  const markdownFiles = await listMarkdownFiles(sessionLogDir);
  const withStats = await Promise.all(markdownFiles.map(async (filePath) => ({
    path: filePath,
    stat: await fs.stat(filePath),
  })));

  const recentFiles = withStats
    .filter((entry) => entry.stat.mtime >= cutoff)
    .sort((a, b) => b.stat.mtime.getTime() - a.stat.mtime.getTime())
    .slice(0, limit);

  return Promise.all(recentFiles.map(async (entry) => {
    const content = await fs.readFile(entry.path, 'utf-8');
    return {
      path: entry.path,
      modifiedAt: entry.stat.mtime.toISOString(),
      excerpt: chunkExcerpt(content),
    };
  }));
}

function ageInDays(reference: Date, target: Date): number {
  return (reference.getTime() - target.getTime()) / (24 * 60 * 60 * 1000);
}

export async function collectAxonDailySources(
  adapter: MemoryAdapter,
  config: AxonRuntimeConfig,
  now = new Date()
): Promise<AxonDailySources> {
  const warnings: string[] = [];
  const lookbackHours = Math.max(1, config.axonLookbackHours);
  const cutoff = new Date(now.getTime() - lookbackHours * 60 * 60 * 1000);
  const fetchLimit = Math.max(100, config.axonBatchLimit * 5);

  let sessionLogExcerpts: AxonSessionLogExcerpt[] = [];

  if (!config.axonSessionLogDir) {
    warnings.push('No axonSessionLogDir configured; falling back to graph-only mode.');
  } else {
    try {
      sessionLogExcerpts = await readRecentSessionLogExcerpts(config.axonSessionLogDir, cutoff, config.axonBatchLimit);
      if (sessionLogExcerpts.length === 0) {
        warnings.push('No recent session log Markdown files were found in axonSessionLogDir.');
      }
    } catch (err) {
      warnings.push(`Could not read axonSessionLogDir; falling back to graph-only mode. ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const graphMemories = (await adapter.list(fetchLimit, 'all'))
    .filter((memory) => memory.metadata.createdAt >= cutoff)
    .slice(0, config.axonBatchLimit);

  const staleEphemeralCandidates = (await adapter.list(fetchLimit, 'ephemeral'))
    .filter((memory) => {
      if (memory.metadata.expiresAt && memory.metadata.expiresAt <= now) {
        return true;
      }

      const referenceDate = memory.metadata.lastReinforced || memory.metadata.createdAt;
      const daysOld = ageInDays(now, referenceDate);
      return daysOld >= config.axonEphemeralForgetDays &&
        (memory.metadata.reinforcementCount ?? 0) < config.axonMinRepeatCount;
    })
    .slice(0, config.axonBatchLimit);

  return {
    generatedAt: now.toISOString(),
    lookbackHours,
    sessionLogExcerpts,
    graphMemories,
    staleEphemeralCandidates,
    warnings: config.axonEnabled ? warnings : [`Axon is disabled in plugin config. ${warnings.join(' ')}`.trim()],
  };
}

function defaultScoreForTier(tier: 'explicit' | 'silent' | 'ephemeral'): number {
  switch (tier) {
    case 'explicit':
      return 9;
    case 'silent':
      return 6;
    default:
      return 3;
  }
}

function normalizeStoredTier(tier: AxonPlanOperation['tier']): 'explicit' | 'silent' | 'ephemeral' {
  if (tier === 'explicit' || tier === 'ephemeral') {
    return tier;
  }
  return 'silent';
}

export async function applyAxonPlan(
  adapter: MemoryAdapter,
  operations: AxonPlanOperation[],
  config: AxonRuntimeConfig,
  now = new Date()
): Promise<AxonApplyResult> {
  const outcomes: AxonApplyOutcome[] = [];
  const dryRun = config.axonDryRun;

  for (const operation of operations) {
    try {
      switch (operation.action) {
        case 'store': {
          const tier = normalizeStoredTier(operation.tier);
          const content = (operation.summary || operation.content || '').trim();
          if (!content) {
            outcomes.push({ action: operation.action, dryRun, status: 'error', detail: 'store requires summary or content.' });
            break;
          }

          if (dryRun) {
            outcomes.push({ action: operation.action, dryRun, status: 'executed', detail: `Would store ${tier} memory: ${content}` });
            break;
          }

          const id = await adapter.store(content, {
            tier,
            score: operation.score ?? defaultScoreForTier(tier),
            source: 'agent_auto',
            disposition: tier,
            createdAt: now,
            summary: operation.summary || content,
            memoryKind: operation.memoryKind || 'summary',
            sourceLog: operation.sourceLogPath ? {
              path: operation.sourceLogPath,
              date: operation.sourceLogDate,
              excerpt: operation.sourceLogExcerpt,
            } : undefined,
            tags: ['axon', operation.memoryKind || 'summary'],
          });

          outcomes.push({ action: operation.action, dryRun, status: 'executed', detail: `Stored memory ${id}.` });
          break;
        }

        case 'promote': {
          if (!operation.id) {
            outcomes.push({ action: operation.action, dryRun, status: 'error', detail: 'promote requires id.' });
            break;
          }

          const targetTier = operation.tier === 'explicit' ? 'explicit' : 'silent';
          if (dryRun) {
            outcomes.push({ action: operation.action, dryRun, status: 'executed', detail: `Would promote ${operation.id} to ${targetTier}.` });
            break;
          }

          const promoted = await promoteMemory(adapter, operation.id, targetTier, now);
          outcomes.push({
            action: operation.action,
            dryRun,
            status: promoted ? 'executed' : 'skipped',
            detail: promoted ? `Promoted ${operation.id} to ${targetTier}.` : `Memory ${operation.id} was not found.`,
          });
          break;
        }

        case 'reinforce': {
          const ids = operation.ids && operation.ids.length > 0
            ? operation.ids
            : operation.id
              ? [operation.id]
              : [];

          if (ids.length === 0) {
            outcomes.push({ action: operation.action, dryRun, status: 'error', detail: 'reinforce requires id or ids.' });
            break;
          }

          if (dryRun) {
            outcomes.push({ action: operation.action, dryRun, status: 'executed', detail: `Would reinforce ${ids.length} memories.` });
            break;
          }

          const reinforced = await reinforceMemories(adapter, ids, 1, now);
          outcomes.push({
            action: operation.action,
            dryRun,
            status: reinforced > 0 ? 'executed' : 'skipped',
            detail: reinforced > 0 ? `Reinforced ${reinforced} memories.` : 'No matching memories were reinforced.',
          });
          break;
        }

        case 'connect': {
          if (!operation.fromId || !operation.toId || !operation.relationship) {
            outcomes.push({ action: operation.action, dryRun, status: 'error', detail: 'connect requires fromId, toId, and relationship.' });
            break;
          }

          if (dryRun) {
            outcomes.push({
              action: operation.action,
              dryRun,
              status: 'executed',
              detail: `Would connect ${operation.fromId} ${operation.relationship} ${operation.toId}.`,
            });
            break;
          }

          await adapter.connect(operation.fromId, operation.toId, operation.relationship);
          outcomes.push({
            action: operation.action,
            dryRun,
            status: 'executed',
            detail: `Connected ${operation.fromId} ${operation.relationship} ${operation.toId}.`,
          });
          break;
        }

        case 'merge': {
          const sourceIds = operation.sourceIds || operation.ids || [];
          if (sourceIds.length === 0 || !(operation.summary || '').trim()) {
            outcomes.push({ action: operation.action, dryRun, status: 'error', detail: 'merge requires sourceIds/ids and summary.' });
            break;
          }

          if (dryRun) {
            outcomes.push({
              action: operation.action,
              dryRun,
              status: 'executed',
              detail: `Would merge ${sourceIds.length} memories into one synthesis.`,
            });
            break;
          }

          await adapter.storeConsolidation(
            sourceIds,
            operation.summary!.trim(),
            (operation.insight || operation.summary || '').trim(),
            operation.connections || []
          );

          if (operation.consolidated === false) {
            await markMemoriesConsolidated(adapter, sourceIds, false);
          }

          outcomes.push({
            action: operation.action,
            dryRun,
            status: 'executed',
            detail: `Merged ${sourceIds.length} memories into a synthesis record.`,
          });
          break;
        }

        case 'prune': {
          const ids = operation.ids && operation.ids.length > 0
            ? operation.ids
            : operation.id
              ? [operation.id]
              : [];

          if (ids.length === 0) {
            outcomes.push({ action: operation.action, dryRun, status: 'error', detail: 'prune requires id or ids.' });
            break;
          }

          if (dryRun) {
            outcomes.push({ action: operation.action, dryRun, status: 'executed', detail: `Would prune ${ids.length} memories.` });
            break;
          }

          const pruned = await pruneMemories(adapter, ids);
          outcomes.push({
            action: operation.action,
            dryRun,
            status: pruned > 0 ? 'executed' : 'skipped',
            detail: pruned > 0 ? `Pruned ${pruned} memories.` : 'No matching memories were pruned.',
          });
          break;
        }

        default:
          outcomes.push({ action: operation.action, dryRun, status: 'error', detail: `Unsupported action "${operation.action}".` });
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error(`Axon plan action ${operation.action} failed: ${errorMsg}`);
      outcomes.push({ action: operation.action, dryRun, status: 'error', detail: errorMsg });
    }
  }

  return { dryRun, outcomes };
}
