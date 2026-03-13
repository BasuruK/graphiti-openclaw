# Nuron LLM-Powered Memory Consolidation
## Implementation Plan for Google-Style Active Memory Consolidation

---

## 1. Overview

We're adding **LLM-powered memory consolidation** to Nuron - the "sleep cycle" that actively finds connections between memories, generates insights, and builds a knowledge graph. This is the "killer feature" from Google's always-on-memory-agent.

### The Core Idea
Instead of just storing memories passively, we periodically run an LLM that:
1. Reads unconsolidated memories
2. Finds **semantic connections** between them
3. Generates **cross-cutting insights**
4. Creates **relationship links** between related memories
5. Marks them as "consolidated" so they're not re-processed

---

## 2. Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    CONSOLIDATION CYCLE                           │
│                  (runs every N minutes)                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  1. READ UNCONSOLIDATED MEMORIES                                │
│     → Fetch memories where consolidated = false                 │
│     → Returns: id, summary, entities, topics, importance      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. LLM PROCESSING (ConsolidateAgent)                          │
│                                                                     │
│     Input: List of memories with:                                │
│       - id: number                                                │
│       - summary: string                                          │
│       - entities: string[]  (people, companies, concepts)        │
│       - topics: string[]   (topic tags)                          │
│       - importance: number (0.0-1.0)                            │
│       - created_at: ISO timestamp                                │
│                                                                     │
│     LLM Task:                                                     │
│       1. Find connections between memories                       │
│       2. Generate synthesized summary                            │
│       3. Generate ONE key insight (the "aha!" moment)           │
│                                                                     │
│     Output:                                                       │
│       - source_ids: number[]                                     │
│       - summary: string                                         │
│       - insight: string                                          │
│       - connections: { from_id, to_id, relationship }[]         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. STORE CONSOLIDATION RESULT                                  │
│     → Save consolidation record (summary, insight)              │
│     → UPDATE each memory with connection links                  │
│     → Mark source memories as consolidated = true               │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Database Schema Changes

### Option A: Extend existing Graphiti (Recommended)
Add a `consolidated` flag and `connections` field to memories in Graphiti:

```typescript
// In Graphiti adapter or as metadata
interface MemoryMetadata {
  tier: 'explicit' | 'silent' | 'ephemeral';
  source: string;
  consolidated: boolean;           // NEW: has this been consolidated?
  connections: Connection[];      // NEW: links to other memories
  // ... existing fields
}

interface Connection {
  linkedMemoryId: string;
  relationship: string;           // e.g., "relates to", "contradicts", "builds upon"
  createdAt: Date;
}

interface ConsolidationRecord {
  id: string;
  sourceMemoryIds: string[];
  summary: string;                // Synthesized summary
  insight: string;                // The key insight
  createdAt: Date;
}
```

### Option B: New SQLite table (simpler)
If Graphiti doesn't support metadata well:

```sql
CREATE TABLE consolidations (
  id TEXT PRIMARY KEY,
  source_ids TEXT NOT NULL,        -- JSON array of memory UUIDs
  summary TEXT NOT NULL,
  insight TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Add to existing memories table or track in adapter
ALTER TABLE memories ADD COLUMN consolidated INTEGER DEFAULT 0;
ALTER TABLE memories ADD COLUMN connections TEXT DEFAULT '[]';
```

---

## 4. New Functions Needed

### A. Read Unconsolidated Memories

```typescript
async function readUnconsolidatedMemories(limit: number = 10): Promise<Memory[]> {
  // Returns memories where consolidated = false
  // Sort by created_at DESC, limit to N
  // Should include: id, content/summary, entities, topics, importance
}
```

### B. Store Consolidation Result

```typescript
async function storeConsolidation(
  sourceIds: string[],
  summary: string,
  insight: string,
  connections: Array<{ fromId: string; toId: string; relationship: string }>
): Promise<void> {
  // 1. Create consolidation record
  // 2. For each connection, add to both memories' connections array
  // 3. Mark all source memories as consolidated = true
}
```

### C. Read Consolidation History

```typescript
async function readConsolidationHistory(limit: number = 10): Promise<ConsolidationRecord[]> {
  // Returns past consolidation insights for query enhancement
}
```

---

## 5. The LLM Prompt (The Core Magic)

This is the key - the consolidation is ALL in the prompt engineering:

```typescript
const CONSOLIDATION_PROMPT = `You are a Memory Consolidation Agent. Your job is to find connections between memories and generate insights.

## Your Task
1. Call read_unconsolidated_memories to get memories that need processing
2. If fewer than 2 memories exist, say "Nothing to consolidate yet"
3. Analyze each memory for:
   - What topics/entities does it contain?
   - How does it relate to other memories?
   - What pattern or insight emerges when viewed together?
4. Generate:
   - A synthesized summary (1-2 sentences combining all memories)
   - ONE key insight (the "aha!" - what new understanding emerges?)
   - Connections between related memories

## Output Format
Call store_consolidation with:
{
  source_ids: [list of memory IDs you processed],
  summary: "Your synthesized summary here",
  insight: "Your single key insight here",
  connections: [
    { from_id: 1, to_id: 2, relationship: "relates to" },
    { from_id: 3, to_id: 1, relationship: "builds upon" }
  ]
}

## Guidelines
- Think deeply about cross-cutting patterns
- A memory can connect to multiple others
- Relationships can be: "relates to", "contradicts", "builds upon", "depends on", "similar to"
- If no connections found, still create summary and insight
- The insight should be something NEW that emerges from combination`;
```

---

## 6. Integration with Nuron

### A. New Tool: `memory_consolidate`

```typescript
api.registerTool({
  name: 'memory_consolidate',
  description: 'Run LLM-powered consolidation to find connections between memories and generate insights. Or specify hours to look back.',
  parameters: Type.Object({
    hours: Type.Optional(Type.Number({ 
      default: 24, 
      description: 'Look back hours for consolidation' 
    }))
  }),
  async execute(toolCallId: string, params: { hours?: number }) {
    const memories = await adapter.getUnconsolidatedMemories(params.hours);
    
    if (memories.length < 2) {
      return { content: 'Not enough unconsolidated memories to consolidate.' };
    }
    
    // Call LLM with consolidation prompt + memories
    const result = await callLLMWithConsolidationPrompt(memories);
    
    // Store result
    await adapter.storeConsolidation(
      result.sourceIds,
      result.summary,
      result.insight,
      result.connections
    );
    
    return {
      content: `Consolidated ${memories.length} memories.\n\nInsight: ${result.insight}\nConnections found: ${result.connections.length}`
    };
  }
});
```

### B. Automatic Consolidation Timer

Add to the hooks - run consolidation periodically:

```typescript
// In hooks.ts - add heartbeat-based consolidation
setInterval(async () => {
  const stats = await adapter.getStats();
  if (stats.unconsolidated >= 2) {
    await runConsolidation();
  }
}, CONSOLIDATION_INTERVAL_MS); // e.g., 30 minutes
```

### C. Enhanced Recall

When recalling memories, also fetch consolidation insights:

```typescript
async function enhancedRecall(query: string) {
  const memories = await adapter.recall(query);
  const consolidations = await adapter.getConsolidationHistory();
  
  // Return both memories AND cross-cutting insights
  return { memories, insights: consolidations };
}
```

---

## 7. LLM Provider Options

The consolidation can use ANY LLM - not just Gemini:

### Option A: LiteLLM (like Google ADK)
```typescript
import litellm from 'litellm';

const result = await litellm.acompletion({
  model: 'openai/gpt-4o',        // or anthropic/claude-3-sonnet
  messages: [{ role: 'user', content: prompt }],
});
```

### Option B: Direct OpenAI/Anthropic
```typescript
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const result = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: prompt }],
});
```

### Option C: Ollama (local!)
```typescript
// Use local Ollama for free consolidation
const result = await fetch('http://localhost:11434/api/chat', {
  method: 'POST',
  body: JSON.stringify({
    model: 'llama3.1',  // or any local model
    messages: [{ role: 'user', content: prompt }],
  })
});
```

---

## 8. Implementation Steps

### Phase 1: Foundation
1. [ ] Add `consolidated` flag and `connections` to memory metadata
2. [ ] Create `consolidations` table/collection
3. [ ] Implement `readUnconsolidatedMemories()` adapter method
4. [ ] Implement `storeConsolidation()` adapter method
5. [ ] Implement `getConsolidationHistory()` adapter method

### Phase 2: LLM Integration
6. [ ] Create consolidation prompt template
7. [ ] Add `callLLMForConsolidation()` function (supports any LLM)
8. [ ] Wire up the LLM to process memories
9. [ ] Handle the response and store results

### Phase 3: Tools & Automation
10. [ ] Register `memory_consolidate` tool
11. [ ] Add automatic timer (heartbeat-based or setInterval)
12. [ ] Update `memory_recall` to include consolidation insights

### Phase 4: Polish
13. [ ] Add configurable consolidation interval
14. [ ] Add minimum memories threshold (don't consolidate if < 2)
15. [ ] Add error handling and logging
16. [ ] Test with real conversations

---

## 9. Key Differences from Google

| Aspect | Google | Nuron Implementation |
|--------|--------|---------------------|
| Storage | SQLite | Graphiti (knowledge graph!) |
| Connections | Flat JSON | First-class relationships in graph |
| Recall | Simple list | Semantic + consolidation insights |
| LLM | Gemini only | Any (OpenAI, Claude, Ollama) |
| Trigger | Timer only | Timer + manual + on-threshold |

---

## 10. Files to Modify

Based on current Nuron structure:

1. **`src/adapters/memory-adapter.ts`** - Add consolidation methods
2. **`src/adapters/graphiti-adapter.ts`** - Implement Graphiti-specific consolidation
3. **`src/tools.ts`** - Enhance `memory_consolidate` tool
4. **`src/hooks.ts`** - Add automatic consolidation timer
5. **New: `src/consolidation.ts`** - LLM prompt + calling logic

---

## Summary

This implementation brings the "sleep cycle" to Nuron - the LLM actively:
- Reads unconsolidated memories
- Finds semantic connections between them
- Generates insights that wouldn't be apparent from individual memories
- Links related memories in the knowledge graph

The key insight from Google's approach: **don't hardcode pattern matching - let the LLM do the reasoning**. The prompt engineering is the magic.

---

*Plan prepared for Antigravity implementation*
*Based on: https://github.com/GoogleCloudPlatform/generative-ai/tree/main/gemini/agents/always-on-memory-agent*
