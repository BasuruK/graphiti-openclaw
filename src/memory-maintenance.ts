import type { MemoryAdapter, MemoryResult } from './adapters/memory-adapter.js';
import { getLogger } from './logger.js';

const logger = getLogger('maintenance');

function uniqueMemoryIds(memories: Array<string | Pick<MemoryResult, 'id'>>): string[] {
  return [...new Set(memories.map((memory) => typeof memory === 'string' ? memory : memory.id).filter(Boolean))];
}

async function updateExistingMemory(
  adapter: MemoryAdapter,
  id: string,
  updater: (memory: MemoryResult) => Partial<MemoryResult['metadata']>
): Promise<boolean> {
  const memory = await adapter.getById(id);
  if (!memory) {
    return false;
  }

  const patch = updater(memory);
  await adapter.update(id, memory.content, {
    ...memory.metadata,
    ...patch,
    createdAt: memory.metadata.createdAt,
    summary: patch.summary ?? memory.metadata.summary ?? memory.summary ?? memory.content.substring(0, 200),
  });

  return true;
}

export async function findMemoriesByIds(
  adapter: MemoryAdapter,
  ids: string[]
): Promise<Map<string, MemoryResult>> {
  const results = new Map<string, MemoryResult>();

  for (const id of uniqueMemoryIds(ids)) {
    const memory = await adapter.getById(id);
    if (memory) {
      results.set(id, memory);
    }
  }

  return results;
}

export async function reinforceMemory(
  adapter: MemoryAdapter,
  id: string,
  countDelta = 1,
  at = new Date()
): Promise<boolean> {
  try {
    return await updateExistingMemory(adapter, id, (memory) => ({
      reinforcementCount: (memory.metadata.reinforcementCount ?? 0) + countDelta,
      lastReinforced: at,
    }));
  } catch (err) {
    logger.warn(`Failed to reinforce memory ${id}: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

export async function reinforceMemories(
  adapter: MemoryAdapter,
  memories: Array<string | Pick<MemoryResult, 'id'>>,
  countDelta = 1,
  at = new Date()
): Promise<number> {
  let reinforced = 0;

  for (const id of uniqueMemoryIds(memories)) {
    if (await reinforceMemory(adapter, id, countDelta, at)) {
      reinforced += 1;
    }
  }

  return reinforced;
}

export async function markMemoriesConsolidated(
  adapter: MemoryAdapter,
  ids: string[],
  consolidated = true
): Promise<number> {
  let updated = 0;

  for (const id of uniqueMemoryIds(ids)) {
    try {
      if (await updateExistingMemory(adapter, id, () => ({ consolidated }))) {
        updated += 1;
      }
    } catch (err) {
      logger.warn(`Failed to update consolidation state for ${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return updated;
}

export async function promoteMemory(
  adapter: MemoryAdapter,
  id: string,
  tier: 'silent' | 'explicit',
  at = new Date()
): Promise<boolean> {
  try {
    return await updateExistingMemory(adapter, id, (memory) => ({
      tier,
      disposition: tier,
      lastReinforced: at,
      reinforcementCount: (memory.metadata.reinforcementCount ?? 0) + 1,
    }));
  } catch (err) {
    logger.warn(`Failed to promote memory ${id}: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

export async function pruneMemories(adapter: MemoryAdapter, ids: string[]): Promise<number> {
  let pruned = 0;

  for (const id of uniqueMemoryIds(ids)) {
    try {
      await adapter.forget(id);
      pruned += 1;
    } catch (err) {
      logger.warn(`Failed to prune memory ${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return pruned;
}
