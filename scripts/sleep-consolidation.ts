import { AdapterFactory } from '../src/adapters/factory.js';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Nuron Biological Sleep Consolidation
 * 
 * Simulates a brain's sleep cycle:
 * 1. Promotes frequently recalled short-term (ephemeral) memories to long-term (silent).
 * 2. Prunes unused short-term (ephemeral) and medium-term (silent) memories that haven't been accessed in 4-5 days.
 * 3. Preserves explicit (high importance) memories forever.
 */

const DAYS_UNTIL_PRUNE = 5;
const REINFORCEMENTS_FOR_PROMOTION = 3; // Number of times accessed to promote to silent

async function runSleepConsolidation() {
  console.log('--- 🧠 Initiating Nuron Sleep Phase Memory Consolidation ---');
  
  // Try to load any local config to instantiate the correct adapter
  let config = { backend: 'auto' };
  try {
    const configPath = path.resolve(process.env.HOME || '', '.openclaw/config.yaml');
    // For this standalone script, we will auto-detect based on env variables 
    // or rely on adapter defaults if no openclaw config is parsed easily.
    // In production, OpenClaw passes the parsed config directly.
  } catch (e) {
    // Ignore
  }

  const factory = new AdapterFactory();
  console.log('[Sleep] Auto-detecting memory backend...');
  
  let adapter;
  try {
    adapter = await factory.autoDetect();
    await adapter.initialize();
    console.log(`[Sleep] Connected to backend: ${adapter.getBackendType()}`);
  } catch (err) {
    console.error('[Sleep] Failed to connect to memory backend:', err);
    process.exit(1);
  }

  try {
    const now = Date.now();
    const msInDay = 24 * 60 * 60 * 1000;
    
    console.log('[Sleep] Fetching memories for consolidation...');
    
    // Fetch ephemeral memories for potential promotion or pruning
    const ephemerals = await adapter.list(1000, 'ephemeral');
    // Fetch silent memories for potential pruning
    const silents = await adapter.list(1000, 'silent');

    let pruned = 0;
    let promoted = 0;

    const memoriesToEvaluate = [...ephemerals, ...silents];
    console.log(`[Sleep] Evaluating ${memoriesToEvaluate.length} memories...`);

    for (const mem of memoriesToEvaluate) {
      // Determine the timestamp to evaluate (last accessed, or creation time)
      const lastActiveTime = mem.metadata.lastReinforced 
        ? new Date(mem.metadata.lastReinforced).getTime() 
        : new Date(mem.metadata.createdAt).getTime();
        
      const daysSinceActive = (now - lastActiveTime) / msInDay;

      // 1. Pruning Unused Memories (forgetting curve)
      if (daysSinceActive >= DAYS_UNTIL_PRUNE) {
        // Prune if untouched for 4-5 days
        await adapter.forget(mem.id);
        pruned++;
        console.log(`[Sleep] 🗑️  Pruned forgotten memory (${mem.metadata.tier}): ${mem.id}`);
        continue;
      }

      // 2. Promotion (Synaptic Consolidation)
      if (mem.metadata.tier === 'ephemeral' && mem.metadata.reinforcementCount >= REINFORCEMENTS_FOR_PROMOTION) {
        // Promote ephemeral -> silent
        await adapter.update(mem.id, mem.content, { tier: 'silent' });
        promoted++;
        console.log(`[Sleep] 🧬 Promoted ephemeral to long-term silent: ${mem.id}`);
      }
    }

    console.log('--- 🧠 Sleep Consolidation Complete ---');
    console.log(`[Sleep] Results: ${promoted} memories consolidated to long-term. ${pruned} stale memories permanently pruned.`);

  } catch (err) {
    console.error('[Sleep] Error during consolidation cycle:', err);
  } finally {
    await adapter.shutdown();
    console.log('[Sleep] Disconnected from backend.');
  }
}

runSleepConsolidation().catch(console.error);
