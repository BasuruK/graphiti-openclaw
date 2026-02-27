# Memory Cortex - Adaptive Importance Scoring

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     CONVERSATION TURN                           │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                   MEMORY SCORER (NEW)                          │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Analyze conversation → Score 0-10 → Assign Tier       │   │
│  │                                                         │   │
│  │ Factors:                                                │   │
│  │ - Explicit emphasis ("remember", "important")          │   │
│  │ - Emotional markers (frustration, excitement)           │   │
│  │ - Future utility prediction                             │   │
│  │ - Repetition/pattern detection                          │   │
│  │ - Connection to existing memories                       │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      NEO4J (GRAPH)                              │
│                                                                 │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐       │
│  │  EXPLICIT   │    │   SILENT    │    │  EPHEMERAL  │       │
│  │  (score 8+) │    │ (score 4-7) │    │ (score 0-3) │       │
│  │             │    │             │    │             │       │
│  │ - Permanent │    │ - 30 days  │    │ - 48-72h    │       │
│  │ - Tell user │    │ - Silent    │    │ - Auto-del  │       │
│  └─────────────┘    └─────────────┘    └─────────────┘       │
│         │                  │                   │               │
│         └──────────────────┴───────────────────┘              │
│                            │                                    │
│                    All connected via                            │
│                    graph relationships                           │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼ (optional layer)
┌─────────────────────────────────────────────────────────────────┐
│                    VECTOR STORE (Qdrant)                       │
│  For semantic search across ALL tiers                          │
│  - Short-term: "Did user mention this before?"                │
│  - Cross-tier search when recalling                            │
└─────────────────────────────────────────────────────────────────┘
```

## Node Properties

```typescript
interface MemoryNode {
  // Existing Graphiti fields
  name: string;
  type: string;
  first_seen: Date;
  last_seen: Date;
  facts: Fact[];

  // NEW: Importance scoring
  importance_score: number;      // 0-10
  memory_tier: 'explicit' | 'silent' | 'ephemeral';
  created_by: 'user_explicit' | 'agent_auto' | 'system';
  
  // Temporal
  expires_at?: Date;             // For ephemeral
  last_reinforced?: Date;        // Last time recalled/referenced
  
  // Metadata
  source_conversation?: string;
  reinforcement_count: number;  // Times referenced
  downgraded_at?: Date;
  downgraded_to?: number;        // Previous score
}
```

## Scoring Algorithm

```typescript
interface ScoringFactors {
  explicit_emphasis: number;    // "remember", "important", "don't forget"
  emotional_weight: number;     // Frustration, excitement, preference
  future_utility: number;        // Will matter in 1 week? 1 month?
  repetition: number;            // Mentioned N times
  time_sensitivity: number;      // Deadlines, events
  context_anchoring: number;     // Connects to high-value memories
  novelty: number;               // New information vs known
}

function calculateScore(factors: ScoringFactors): {
  score: number;       // 0-10
  tier: string;
  reasoning: string;
  expiresInHours: number;
}
```

## Tiers & Behavior

| Tier | Score | Storage | Cleanup | User Feedback |
|------|-------|---------|---------|---------------|
| **Explicit** | 8-10 | Permanent | Never (unless user deletes) | "Got it, noting that" |
| **Silent** | 4-7 | 30 days default | Configurable, check via heartbeat | None |
| **Ephemeral** | 0-3 | 48-72h | Auto-delete if not reinforced | None |

## Configuration

```json
{
  "scoring": {
    "enabled": true,
    "explicitThreshold": 8,
    "ephemeralThreshold": 4,
    "defaultEphemeralHours": 72,
    "defaultSilentDays": 30,
    "cleanupIntervalHours": 12
  },
  "feedback": {
    "notifyOnExplicit": true,
    "askBeforeDowngrade": true
  }
}
```

## Implementation Plan

1. **Phase 1**: Add scoring logic (`memory-scorer.ts`)
2. **Phase 2**: Add tier properties to nodes
3. **Phase 3**: Implement cleanup via heartbeat
4. **Phase 4**: Optional Qdrant integration for semantic search
5. **Phase 5**: User feedback prompts & manual overrides

## Backup Location

`graphiti-openclaw-backup-20260227/`
