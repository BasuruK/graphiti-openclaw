# LobeHub Memory Research - Enhancement Proposals for Nuron

**Research Date:** 2026-03-18  
**Researcher:** FRIDAY  
**Context:** Basuru impressed by LobeHub EDITH agent's accurate memory recall; requested analysis for Nuron project

---

## Executive Summary

LobeHub's memory system demonstrates impressive accuracy in extracting and recalling user facts from conversations. Key innovations include:

1. **Structured memory taxonomy** (categories, layers, types)
2. **Hybrid search** (BM25 + vector embeddings)
3. **Confidence scoring** with source evidence
4. **LLM-based extraction** from conversations
5. **Persona compilation** - generating agent-ready context documents

These concepts can extend Nuron's existing Graphiti-based memory architecture.

---

## LobeHub Architecture Analysis

### Database Schema

LobeHub uses **PostgreSQL + ParadeDB** (BM25 full-text search) + **pgvector** (1024-dimension embeddings).

**Core Table: `user_memories`**

| Field | Type | Description |
|-------|------|-------------|
| `id` | varchar | Unique memory ID |
| `user_id` | text | Owner |
| `memory_category` | varchar | personal \| professional \| projects \| skills \| relationships |
| `memory_layer` | varchar | identity \| context \| preferences \| skills \| patterns \| historical |
| `memory_type` | varchar | people \| preference \| fact \| habit \| skill |
| `title` | varchar | Concise summary (e.g., "Based in Colombo, Sri Lanka") |
| `summary` | text | 1-2 sentence description |
| `details` | text | Full extracted text with context |
| `summary_vector_1024` | vector(1024) | Embedding of summary |
| `details_vector_1024` | vector(1024) | Embedding of details |
| `status` | varchar | active \| pending \| archived |
| `confidence` | numeric | 0-1 score based on source explicitness + repetition |
| `metadata` | jsonb | Source evidence, tags, etc. |
| `tags` | text[] | ["Colombo", "Sri Lanka", "residence"] |
| `accessed_count` | bigint | Number of times recalled |
| `captured_at` | timestamp | When the fact was stated |

**Related Tables:**
- `user_memories_preferences` - behavioral directives + suggestions
- `user_memories_activities` - recurring patterns (timezone, schedule, workflows)
- `user_memories_contexts` - current projects, ongoing situations
- `user_memories_identities` - who the user is, relationships
- `user_memories_experiences` - past events with situation/reasoning/outcome/learning
- `user_memory_persona_documents` - **compiled persona** from all memories

### How Extraction Works

```
Conversation Message
        │
        ▼
┌───────────────────────────────────────┐
│     LLM Analysis (Memory Agent)        │
│                                       │
│  1. Is this memory-worthy?            │
│  2. Extract:                           │
│     - Core fact                       │
│     - Category (personal/professional)│
│     - Layer (identity/context)        │
│     - Type (preference/fact/habit)   │
│     - Confidence (0-1)               │
│     - Source evidence (exact quote)  │
│     - Tags                            │
│  3. Check for conflicts               │
└───────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────┐
│        Storage (ParadeDB)             │
│                                       │
│  - BM25 index for keyword search      │
│  - pgvector for semantic search       │
│  - Structured fields for filtering    │
└───────────────────────────────────────┘
```

### Key Innovation: Persona Document Compilation

The `user_memory_persona_documents` table compiles memories into **agent-usable persona documents**:

```json
{
  "id": "persona_xxx",
  "user_id": "user_xxx",
  "profile": "default",
  "tagline": "Lead Software Engineer who prefers terse responses",
  "persona": "## About Basuru\n\n- **Location**: Colombo, Sri Lanka (said 'I live in Colombo' on 2026-03-18)\n- **Communication**: Prefers terse, no-fluff responses\n- **Work**: Lead Software Engineer at IFS R&D\n- **Interests**: AI agents, music (piano/guitar), sci-fi",
  "memory_ids": ["mem_xxx", "mem_yyy"]
}
```

This compiled persona is injected into agent context at session start.

### Example Memory from Basuru's LobeHub

```json
{
  "id": "mem_MLnbdPUYkcOs",
  "title": "Based in Colombo, Sri Lanka",
  "summary": "Basuru Balasuriya lives in Colombo, Sri Lanka.",
  "details": "Basuru Balasuriya stated that Basuru Balasuriya lives in Colombo, Sri Lanka.",
  "memory_category": "personal",
  "memory_layer": "identity",
  "memory_type": "people",
  "status": "active",
  "tags": ["Colombo", "Sri Lanka", "residence", "location"],
  "metadata": {
    "sourceEvidence": "User said: 'I live in Colombo, Sri Lanka.'",
    "scoreConfidence": 0.91
  },
  "created_at": "2026-03-18 17:46:42"
}
```

**Note:** `memory_type` as "people" for a location fact is interesting - suggests LobeHub categorizes facts about the user (even location) under "people" type.

---

## Comparison: LobeHub vs Nuron/Graphiti

| Aspect | LobeHub | Nuron (Current) |
|--------|---------|-----------------|
| **Graph Store** | Neo4j (planned) | Neo4j (active) |
| **Vector Store** | ParadeDB + pgvector | Qdrant (planned) |
| **Full-text Search** | ParadeDB BM25 | Not implemented |
| **Memory Taxonomy** | Categories + Layers + Types | Simple fact types |
| **Confidence Scoring** | 0-1 with evidence | Not implemented |
| **Source Tracking** | Exact quote stored | Unknown |
| **Persona Compilation** | Yes (table) | Not implemented |
| **Extraction Method** | LLM-based | Unknown |
| **Memory Tiers** | Implicit (active/pending/archived) | Explicit tiers (MEMORY-CORTEX) |

---

## Enhancement Proposals for Nuron

### 1. Structured Memory Taxonomy

**Current:** Graphiti has basic `Fact` structure with `created_at`, `updated_at`.

**Proposal:** Add structured taxonomy to Neo4j nodes:

```typescript
interface EnhancedFact {
  // Existing Graphiti fields
  id: string;
  fact: string;
  created_at: Date;
  updated_at: Date;
  
  // NEW: Structured taxonomy
  memory_category?: 'personal' | 'professional' | 'project' | 'skills' | 'relationships';
  memory_layer?: 'identity' | 'context' | 'preference' | 'pattern' | 'historical';
  memory_type?: 'fact' | 'preference' | 'habit' | 'skill' | 'relationship';
  
  // NEW: Confidence & evidence
  confidence: number;           // 0-1
  source_evidence?: string;      // Exact quote
  source_conversation_id?: string;
  
  // NEW: Reinforcement tracking
  reinforcement_count: number;  // Times referenced
  last_reinforced_at?: Date;
}
```

**Implementation:** Add these as optional properties on Graphiti `Fact` nodes in Neo4j.

### 2. Hybrid Search (BM25 + Vector)

**Current:** Graphiti uses Neo4j vector search only.

**Proposal:** Add BM25 full-text index in Neo4j:

```cypher
// Add full-text index on fact content
CREATE FULLTEXT INDEX FOR (f:Fact) ON EACH [f.fact];
```

**Benefit:** Better keyword matching for things like "remember when X happened" queries.

### 3. Confidence Scoring with Evidence

**Current:** Not implemented.

**Proposal:** Implement scoring in `memory-scorer.ts` (already exists in MEMORY-CORTEX):

```typescript
interface ScoringResult {
  score: number;           // 0-10
  tier: 'explicit' | 'silent' | 'ephemeral';
  reasoning: string;
  confidence: number;      // 0-1 (for LobeHub-style tracking)
  sourceEvidence?: string;  // Extracted quote
}

// Factors to consider:
const factors = {
  explicit_emphasis: detectEmphasis(message),    // "remember", "important"
  emotional_weight: detectEmotion(message),   // Frustration, excitement
  future_utility: predictUtility(message),      // Will matter in 1 week?
  repetition: countOccurrences(fact),          // Mentioned N times
  time_sensitivity: detectDeadlines(message),   // "next Monday"
  novelty: checkNovelty(fact),                // New vs known
};
```

**Implementation:** Extend existing `memory-scorer.ts` to output `confidence` and `sourceEvidence`.

### 4. Persona Compilation

**Current:** Not implemented.

**Proposal:** Create a persona compilation step before agent sessions:

```typescript
async function compilePersonaDocument(userId: string): Promise<string> {
  // 1. Fetch recent/high-confidence memories
  const memories = await graphiti.getMemoriesByCategory(userId, {
    categories: ['personal', 'professional', 'preferences'],
    minConfidence: 0.7,
    limit: 20
  });
  
  // 2. Format into persona document
  const sections = memories.map(m => formatMemory(m));
  
  // 3. Return compiled document
  return `## About User

${sections.join('\n\n')}`;
}
```

**Usage:** Inject compiled persona into system prompt at session start.

### 5. LLM-Based Memory Extraction

**Current:** Unknown/implicit.

**Proposal:** Implement extraction agent that runs after conversations:

```typescript
async function extractMemories(conversation: Message[]): Promise<Fact[]> {
  const prompt = `
    Analyze this conversation and extract memory-worthy facts about the user.
    For each fact, provide:
    - The fact itself
    - Category (personal/professional/project)
    - Type (preference/fact/habit/skill)
    - Confidence (0-1)
    - Source evidence (exact quote)
    
    Conversation:
    ${conversation.map(m => `${m.role}: ${m.content}`).join('\n')}
  `;
  
  const response = await llm.complete({ prompt });
  return parseMemoryResponse(response);
}
```

---

## Integration with Existing MEMORY-CORTEX

The LobeHub enhancements complement the existing MEMORY-CORTEX architecture:

```
┌─────────────────────────────────────────────────────────────┐
│                    MEMORY-CORTEX                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              MEMORY SCORER                           │   │
│  │  Score 0-10 → Assign Tier                          │   │
│  │  + NEW: confidence, sourceEvidence                  │   │
│  └─────────────────────────────────────────────────────┘   │
│                            │                               │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐            │
│  │  EXPLICIT  │ │   SILENT   │ │  EPHEMERAL │            │
│  │  (score 8+)| │ (score 4-7)│ │ (score 0-3)│            │
│  │            │ │            │ │            │            │
│  │ + LobeHub  │ │ + LobeHub  │ │ + LobeHub  │            │
│  │   taxonomy │ │   taxonomy │ │   taxonomy │            │
│  │   + conf.  │ │   + conf.  │ │   + conf.  │            │
│  └────────────┘ └────────────┘ └────────────┘            │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                  NEO4J (with BM25)                         │
│  - Full-text search on fact content                        │
│  - Vector search on embeddings                              │
│  - Structured taxonomy on all nodes                        │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│            PERSONA COMPILATION (NEW)                        │
│  - Compile memories into agent-usable format               │
│  - Inject at session start                                  │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Roadmap

### Phase 1: Taxonomy Extension (Quick Win)
- [ ] Add `memory_category`, `memory_layer`, `memory_type` to Fact nodes
- [ ] Update Graphiti schema
- **Effort:** Low | **Impact:** Medium

### Phase 2: Confidence & Evidence (Quick Win)
- [ ] Extend `memory-scorer.ts` with confidence output
- [ ] Store `source_evidence` on facts
- **Effort:** Low | **Impact:** High

### Phase 3: BM25 Full-Text Index (Medium)
- [ ] Add Neo4j full-text index on fact content
- [ ] Update retrieval queries
- **Effort:** Medium | **Impact:** Medium

### Phase 4: Persona Compilation (Medium)
- [ ] Create `compilePersona()` function
- [ ] Integrate into OpenClaw session startup
- **Effort:** Medium | **Impact:** High

### Phase 5: LLM Extraction (Larger)
- [ ] Implement extraction prompt
- [ ] Add extraction to conversation completion
- [ ] Handle conflict detection
- **Effort:** High | **Impact:** High

---

## Key Files in Nuron

- `src/memory-scorer.ts` - Adaptive importance scoring (extend with confidence)
- `src/` - Core memory logic
- `docs/MEMORY-CORTEX.md` - Architecture overview
- `docs/ARCHITECTURE-REVIEW.md` - Detailed architecture
- `docs/nuron-consolidation-plan.md` - Consolidation planning

---

## References

- LobeHub Memory Documentation: https://lobehub.com/docs/usage/getting-started/memory
- LobeHub Knowledge Base: https://lobehub.com/blog/knowledge-base
- Graphiti: https://github.com/Stemma Anf河道/graphiti (original)
- Nuron Plugin: `~/.openclaw/extensions/nuron`

---

## Appendix: Basuru's Observed Memory Categories

From LobeHub database inspection:

| Category | Example |
|----------|---------|
| personal | "Based in Colombo, Sri Lanka" |
| professional | (not observed yet) |
| identity | (layer, same as personal) |
| context | (layer, for ongoing situations) |

**Memory Types Observed:**
- `people` - Facts about the user (location, identity)
- (more types to be discovered)
