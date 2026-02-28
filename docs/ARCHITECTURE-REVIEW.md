# Graphiti-OpenClaw — Comprehensive Architecture Review & Evaluation

**Document Version:** 2.0  
**Date:** February 27, 2026  
**Author:** Senior AI Architect — Agentic Memory Systems  
**Scope:** Full code review, architecture evaluation, compliance check, and forward roadmap  
**Rev 1.1:** Added Section 4 — MCP-Native vs HTTP Proxy architecture decision (validated: MCP-native adopted)  
**Rev 2.0:** Updated all sections to reflect v1.1.0 codebase — MCP-native migration complete, adapter pattern implemented, scoring factors implemented, many critical issues resolved

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Project Purpose, Intent & Context](#2-project-purpose-intent--context)
3. [Architecture Overview](#3-architecture-overview)
4. [Architecture Decision: MCP-Native vs HTTP Proxy](#4-architecture-decision-mcp-native-vs-http-proxy) ⚡ NEW
5. [OpenClaw Plugin Compliance Audit](#5-openclaw-plugin-compliance-audit)
6. [Graphiti Integration Assessment](#6-graphiti-integration-assessment)
7. [Full Code Review](#7-full-code-review)
   - 7.1 [What Works](#71-what-works)
   - 7.2 [What Breaks](#72-what-breaks)
   - 7.3 [Code Quality Issues](#73-code-quality-issues)
8. [Human-Like Memory System Evaluation](#8-human-like-memory-system-evaluation)
9. [Logic & Feature Improvements](#9-logic--feature-improvements)
10. [Generalization Strategy (Backend-Agnostic)](#10-generalization-strategy-backend-agnostic)
11. [Publishability Assessment](#11-publishability-assessment)
12. [Future Roadmap: Self-Managed Memory Engine](#12-future-roadmap-self-managed-memory-engine)
13. [Brainstorm: Advanced Memory Concepts](#13-brainstorm-advanced-memory-concepts)
14. [Implementation Priority Matrix](#14-implementation-priority-matrix)
15. [Appendix: Reference Architecture Diagrams](#15-appendix-reference-architecture-diagrams)

---

## 1. Executive Summary

**graphiti-openclaw** is an OpenClaw plugin that extends AI agents with a **temporal knowledge graph memory system** powered by Graphiti + Neo4j. It introduces an innovative "Memory Cortex" scoring layer that classifies conversation importance into **Explicit**, **Silent**, and **Ephemeral** tiers — a concept not found in standard Graphiti, Mem0, or Cognee implementations.

### Verdict

| Dimension | Rating | Notes |
|-----------|--------|-------|
| **Architecture Vision** | ★★★★☆ | Strong conceptual foundation; extension-layer approach is differentiated |
| **Transport Strategy** | ★★★★☆ | ~~HTTP fetch proxy~~ → **MCP-native via adapter pattern adopted** (v1.1.0). Uses `@modelcontextprotocol/sdk` with SSE/stdio transports. HTTP proxy client deleted. |
| **OpenClaw Compliance** | ★★★☆☆ | Still uses `api.registerTool` / `api.on` (not standard `PluginContext`), but now has shutdown handler, config validation, safe logging, and plugin ID migration |
| **Code Quality** | ★★★★☆ | Clean TypeScript, good error handling, adapter pattern implemented, no duplicate files. Still uses `any` for API types; eslint added. All 7 scoring factors implemented. |
| **Graphiti Integration** | ★★★☆☆ | Now backend-agnostic via `MemoryAdapter` interface; Graphiti MCP and Neo4j direct adapters implemented. Still doesn't leverage bi-temporal queries or graph traversal. |
| **Human-Like Memory** | ★★★☆☆ | All 7 scoring factors now implemented (were stubs). Cleanup and reinforcement processing functional. Forgetting curve and associative recall still missing. |
| **Publishability** | ★★★☆☆ | `.env.example`, `.gitignore`, eslint, `repository`/`license`/`keywords` in package.json all present. Still missing tests, CI, LICENSE file, and CHANGELOG. |
| **Scalability** | ★★☆☆☆ | Single-group flat storage; no multi-user isolation, graph partitioning, or connection pooling |

**Bottom line:** The project has progressed from ~40% to ~65% implementation. The HTTP proxy client has been fully replaced with an adapter-based architecture supporting MCP-native (Graphiti) and direct Neo4j backends. All 7 Memory Cortex scoring factors are now functional (were stubs). Cleanup and reinforcement loops work. Key remaining gaps: tests, CI, LICENSE file, OpenClaw `PluginContext` migration, and advanced cognitive features (forgetting curve, associative recall, consolidation engine).

---

## 2. Project Purpose, Intent & Context

### 2.1 What This Project Is

An **extension layer** for OpenClaw that provides **agentic memory management** — the ability for AI agents to autonomously remember, recall, prioritize, and forget information in a way that mimics human cognitive memory patterns.

Key differentiators from existing solutions:

| System | Approach | Limitation |
|--------|----------|------------|
| **Graphiti** (Zep) | Temporal knowledge graph with bi-temporal tracking | Raw infrastructure — no autonomous scoring or agent-friendly abstraction |
| **Mem0** | Simple key-value memory with embedding search | Flat storage, no relationships, no temporal awareness |
| **Cognee** | Document-centric knowledge extraction | Batch-oriented, not real-time agent-friendly |
| **This Project** | Extension layer on top of Graphiti with Memory Cortex scoring, auto-recall/capture hooks, and tiered importance | Provides the "cognitive" layer that none of the above offer out-of-the-box |

### 2.2 The Vision

The project aims to be a **pluggable memory middle-layer** that:

1. **Today**: Extends Graphiti with human-like memory scoring and agent-friendly tools
2. **Tomorrow**: Becomes backend-agnostic (Neo4j, FalkorDB, Kuzu, SQLite, etc.)
3. **Future**: Runs its own memory management algorithms without depending on external graph services

### 2.3 Target Users

- OpenClaw users who want persistent, cross-session memory for their personal AI assistant
- AI agent developers building systems that need long-term memory with importance classification
- Researchers exploring agentic memory architectures

---

## 3. Architecture Overview

### 3.1 Previous Architecture (HTTP Proxy — REMOVED in v1.1.0)

> **⚠️ HISTORICAL:** The HTTP proxy client (`src/client.ts`) and root-level duplicate files have been fully deleted. The architecture below is preserved for historical reference only. See Section 3.2 for the current architecture.

```text
┌─────────────────────────────────────────────────────────────┐
│                   OpenClaw Gateway                          │
│                                                             │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐ │
│  │ Agent Turn   │──│ Hooks Layer  │──│ Memory Cortex     │ │
│  │              │  │ (before/     │  │ (Importance       │ │
│  │              │  │  after)      │  │  Scoring 0-10)    │ │
│  └─────────────┘  └──────────────┘  └───────────────────┘ │
│         │                                     │             │
│  ┌─────────────┐                    ┌───────────────────┐  │
│  │ Memory Tools│                    │ Tier Assignment   │  │
│  │ (recall,    │                    │ Explicit/Silent/  │  │
│  │  store,     │                    │ Ephemeral         │  │
│  │  forget,    │                    └───────────────────┘  │
│  │  status)    │                              │            │
│  └──────┬──────┘                              │            │
│         │                                     │            │
│  ┌──────┴─────────────────────────────────────┴──────────┐ │
│  │       ❌ GraphitiClient (HTTP/JSON-RPC) — REMOVE      │ │
│  └───────────────────────┬───────────────────────────────┘ │
└──────────────────────────┼──────────────────────────────────┘
                           │
              ┌────────────┴────────────┐
              │  Graphiti MCP Server    │
              │  (Docker, port 8000)    │
              └─────────────────────────┘
```

### 3.2 Current Architecture (Adapter Pattern — v1.1.0)

> **IMPLEMENTED:** The plugin now uses a backend-agnostic `MemoryAdapter` interface with concrete implementations for Graphiti MCP (SSE/stdio) and Neo4j direct (Bolt). The adapter is selected via config or auto-detected from environment.

```text
┌──────────────────────────────────────────────────────────────┐
│                   OpenClaw Gateway                           │
│                                                              │
│  ┌──────────┐                                               │
│  │ Agent    │◄──── MCP Tool Discovery ────┐                 │
│  │          │                             │                 │
│  │ Sees native Graphiti tools:            │                 │
│  │  • search_nodes                        │                 │
│  │  • search_facts                        │                 │
│  │  • add_memory         ┌────────────────┴───────────┐    │
│  │  • get_episodes       │  Graphiti MCP Server       │    │
│  │  • delete_episode     │  (stdio or SSE transport)  │    │
│  │  • clear_graph        │                            │    │
│  │  • get_status         │  ┌──────────┐ ┌─────────┐ │    │
│  └──────────┘            │  │ LLM/Emb  │ │ Neo4j   │ │    │
│       │                  │  └──────────┘ └─────────┘ │    │
│       │                  └────────────────────────────┘    │
│       ▼                                                    │
│  ┌────────────────────────────────────────────────────┐    │
│  │        Memory Cortex Plugin (THIS PROJECT)         │    │
│  │        The Cognitive Layer — NOT a tool proxy      │    │
│  │                                                    │    │
│  │  ┌──────────────┐  ┌───────────────────────────┐  │    │
│  │  │ Hooks Layer  │  │ Memory Cortex Scoring     │  │    │
│  │  │ auto-recall  │  │ Importance (0-10)         │  │    │
│  │  │ auto-capture │  │ Tier assignment           │  │    │
│  │  │ heartbeat    │  │ Decay / Reinforcement     │  │    │
│  │  └──────┬───────┘  └────────────┬──────────────┘  │    │
│  │         │                       │                  │    │
│  │  ┌──────┴───────┐  ┌───────────┴──────────────┐  │    │
│  │  │ Memory Tools │  │  AdapterFactory          │  │    │
│  │  │ recall       │  │  auto-detect / explicit  │  │    │
│  │  │ store        │  │                          │  │    │
│  │  │ list         │  ├──────────┬───────────────┤  │    │
│  │  │ forget       │  │ Graphiti │ Neo4j Direct  │  │    │
│  │  │ consolidate  │  │ MCP      │ (Bolt)        │  │    │
│  │  │ analyze      │  │ Adapter  │ Adapter       │  │    │
│  │  │ status       │  │ (SSE/    │               │  │    │
│  │  └──────────────┘  │  stdio)  │               │  │    │
│  │                     └──────────┴───────────────┘  │    │
│  └───────────────────────────────────────────────────┘    │
│                           │ MCP (stdio/SSE) or Bolt       │
└───────────────────────────┼────────────────────────────────┘
                            │
          ┌─────────────────┼────────────────────┐
          │                 │                    │
┌─────────┴────┐  ┌────────┴──────┐  ┌──────────┴──┐
│ Graphiti MCP │  │ Neo4j Direct  │  │ FalkorDB    │
│ Server       │  │ (bolt://)     │  │ (TODO)      │
│ (port 8000)  │  │               │  │             │
└──────────────┘  └───────────────┘  └─────────────┘
```

**Key insight:** The agent talks to Graphiti **directly** via MCP for basic operations. The plugin is the **cognitive layer** that adds scoring, hooks, and consolidation — it calls the backend via the `MemoryAdapter` interface for its internal logic. The plugin also registers its own value-add tools (`memory_recall`, `memory_store`, `memory_list`, `memory_forget`, `memory_status`, `memory_consolidate`, `memory_analyze`).

### 3.3 Data Flow

```text
User Message ──► before_agent_start Hook
                      │
                      ├──► adapter.recall(prompt) ──► Backend
                      │                                │
                      ◄── <memory> context block ◄─────┘
                      │
                 Agent processes turn (with memory context)
                      │
                      ▼
               agent_end Hook
                      │
                      ├──► Extract conversation segments
                      │    (forward iteration, MAX_CAPTURE_MESSAGES)
                      ├──► MemoryScorer.scoreConversation()
                      │        │
                      │        ├── detectExplicitMarkers()
                      │        ├── detectEmotionalContent()
                      │        ├── checkRepetition() ✅ queries adapter
                      │        ├── checkContextAnchoring() ✅ queries adapter
                      │        ├── detectTimeSensitivity()
                      │        ├── checkNovelty() ✅ queries adapter
                      │        └── predictFutureUtility() ✅ implemented
                      │        │
                      │        ▼
                      │    Score 0-10 → Tier Assignment
                      │
                      ├──► skip (score too low)
                      ├──► store_ephemeral (72h TTL)
                      ├──► store_silent (30d TTL)
                      └──► store_explicit (permanent, notify user)
                               │
                               ▼
                          adapter.store(content, metadata)
```

               heartbeat Hook (throttled by cleanupIntervalHours)
                      │
                      ├──► scorer.cleanupExpiredMemories() ✅
                      │        └── adapter.cleanup()
                      │
                      └──► scorer.processReinforcements() ✅
                               └── Per-memory: check related → upgrade tier
```

---

## 4. Architecture Decision: MCP-Native vs HTTP Proxy

> **Decision: ADOPTED. MCP-native is fully implemented in v1.1.0.**

### 4.1 The Problem (RESOLVED)

The project previously had two client implementations:

| File | Transport | Approach | Status |
|------|-----------|----------|--------|
| `src/client.ts` | **HTTP fetch** → `{endpoint}/mcp/` | Manually constructs JSON-RPC 2.0 payloads, manually parses `content[0].text` responses | **DELETED** |
| `client.ts` (root) | **MCP via mcporter** subprocess | Spawns `mcporter call graphiti-memory.<tool>` CLI commands | **DELETED** |

Both were proxies. The HTTP client (212 lines) re-implemented what the MCP protocol already provides natively. Both files have been fully removed and replaced by the `MemoryAdapter` pattern with `GraphitiMCPAdapter` using `@modelcontextprotocol/sdk`.

### 4.2 Why HTTP Proxy is Futile

#### Agents don't call HTTP mid-conversation — they call tools

When an agent needs to recall a memory, it doesn't think "I should make an HTTP POST to port 8000 with a JSON-RPC payload." It thinks "I have a tool called `search_nodes` — let me call it." MCP is **designed for exactly this**: exposing tools to agents with auto-discovered schemas and descriptions.

The HTTP proxy approach means:
1. **Double indirection**: Agent → `memory_recall` (plugin tool) → HTTP fetch → Graphiti MCP → Neo4j → response → HTTP parse → format → Agent
2. **With MCP-native**: Agent → `search_nodes` (Graphiti MCP tool) → Neo4j → response → Agent

The plugin's wrapped tools (`memory_recall`, `memory_store`, `memory_forget`, `memory_status`) are just **thin facades** over Graphiti's native MCP tools — they add no intelligence, no scoring, no cognitive logic. They are pure proxies.

#### What the HTTP client gets wrong

| Issue | Detail |
|-------|--------|
| **Non-persistent sessions** | `sessionId: "oc-${Date.now()}"` creates a new session per call — no continuity, no caching |
| **Fragile parsing** | `data.result?.content?.[0]?.text` assumes a specific MCP response format that can change |
| **No retry/resilience** | Single-shot fetch with no retry, backoff, or circuit breaker |
| **Hardcoded endpoint** | `/mcp/` path is hardcoded — not configurable |
| **Subset functionality** | Only 7 of Graphiti's tools are wrapped — bi-temporal queries, graph traversal, community detection are all inaccessible |
| **Manual schemas** | Tool parameter schemas must be maintained in sync with Graphiti's actual schema |
| **212 lines to delete** | The entire `src/client.ts` file is unnecessary with MCP-native |

#### MCP is battle-tested

| MCP Advantage | Detail |
|---------------|--------|
| **Industry standard** | Used by Claude, ChatGPT, OpenClaw, VS Code Copilot, Cursor, and every major AI framework |
| **Auto-discovery** | Agent discovers all available tools with schemas via `tools/list` — no manual registration |
| **Session management** | MCP protocol handles session lifecycle, transport negotiation, error codes |
| **Multiple transports** | stdio (local), SSE (remote), WebSocket — choose per deployment |
| **Graphiti built for it** | Graphiti's MCP server is a first-class citizen, not an afterthought |
| **Already proven** | Root `client.ts` using mcporter (MCP protocol) already works |

### 4.3 MCP-Native Architecture (IMPLEMENTED)

The plugin's role has **shifted from tool proxy to cognitive orchestrator**:

#### What was REMOVED (DONE ✅)
- `src/client.ts` — the entire HTTP proxy client (212 lines) — **deleted**
- Root `client.ts` — the older mcporter subprocess client — **deleted**
- Root-level duplicate `tools.ts`, `hooks.ts`, `index.ts` — **deleted**

#### What STAYED (DONE ✅)
- `src/memory-scorer.ts` — Memory Cortex importance scoring (all 7 factors now implemented)
- `src/hooks.ts` — auto-recall, auto-capture, heartbeat hooks (now uses `MemoryAdapter`)
- `src/index.ts` — plugin lifecycle (rewritten with config validation, migration, shutdown)

#### What was ADDED (DONE ✅)
- `src/adapters/memory-adapter.ts` — Backend-agnostic `MemoryAdapter` interface
- `src/adapters/graphiti-adapter.ts` — Graphiti MCP adapter via `@modelcontextprotocol/sdk`
- `src/adapters/neo4j-adapter.ts` — Direct Neo4j Bolt adapter
- `src/adapters/factory.ts` — `AdapterFactory` with auto-detect cascade and config-driven creation
- `src/tools.ts` — **retained and enhanced** with 7 tools (recall, store, list, forget, status, consolidate, analyze) that operate through the adapter — these are cognitive tools, not proxies

### 4.4 How the Plugin Calls Graphiti via MCP

The plugin's hooks still need to call Graphiti programmatically (for auto-recall before agent starts, auto-capture after agent ends). Instead of HTTP, use the official MCP TypeScript SDK:

```typescript
// src/mcp-client.ts — Replace src/client.ts entirely
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
// OR for remote:
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

export class GraphitiMCPClient {
  private client: Client;
  private connected = false;

  constructor(private config: { transport: 'stdio' | 'sse'; endpoint?: string }) {
    this.client = new Client(
      { name: 'graphiti-memory-plugin', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    let transport;
    if (this.config.transport === 'stdio') {
      transport = new StdioClientTransport({
        command: 'uv',
        args: ['run', 'graphiti-mcp', '--transport', 'stdio']
      });
    } else {
      transport = new SSEClientTransport(
        new URL(this.config.endpoint || 'http://localhost:8000/sse')
      );
    }

    await this.client.connect(transport);
    this.connected = true;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.connected) await this.connect();
    const result = await this.client.callTool({ name, arguments: args });
    return result;
  }

  async searchNodes(query: string, groupId: string, limit = 5) {
    return this.callTool('search_nodes', { query, group_id: groupId, limit });
  }

  async addMemory(content: string, groupId: string, name?: string) {
    return this.callTool('add_memory', {
      episode_body: content,
      group_id: groupId,
      name: name || `episode-${Date.now()}`
    });
  }

  async disconnect(): Promise<void> {
    if (this.connected) {
      await this.client.close();
      this.connected = false;
    }
  }
}
```

### 4.5 What the Agent Sees (Before vs After)

#### BEFORE (HTTP proxy — agent sees plugin-registered wrapper tools)
```text
Agent's tool inventory:
  ├── memory_recall       ← plugin wrapper around Graphiti's search_nodes
  ├── memory_store        ← plugin wrapper around Graphiti's add_memory  
  ├── memory_forget       ← plugin wrapper around Graphiti's delete_episode
  └── memory_status       ← plugin wrapper around Graphiti's get_status

  Problem: Only 4 tools. No access to search_facts, get_episodes,
           clear_graph, or any future Graphiti tools.
```

#### CURRENT (v1.1.0 — adapter-based tools + Graphiti MCP auto-discovery)
```text
Agent's tool inventory:
  │
  ├── [From Graphiti MCP Server — auto-discovered]
  │   ├── search_nodes        ← with full schema + description
  │   ├── search_facts        ← relationship-based search
  │   ├── add_memory          ← store episodes
  │   ├── get_episodes        ← browse memory
  │   ├── delete_episode      ← forget
  │   ├── clear_graph         ← reset
  │   └── get_status          ← health check
  │
  └── [From Memory Cortex Plugin — cognitive tools via MemoryAdapter]
      ├── memory_recall       ← adapter-based recall with tier filtering
      ├── memory_store        ← store with tier + scoring metadata
      ├── memory_list         ← browse with tier/limit filters
      ├── memory_forget       ← delete by UUID
      ├── memory_status       ← health + stats from adapter
      ├── memory_consolidate  ← synthesize recent memories
      └── memory_analyze      ← score/assess importance

  Benefit: Full Graphiti surface area via MCP + cognitive tools via adapter.
```

### 4.6 Impact on Codebase (COMPLETED)

| File | Action | Status |
|------|--------|--------|
| `src/client.ts` | **DELETED** | ✅ Replaced by `MemoryAdapter` |
| `client.ts` (root) | **DELETED** | ✅ Legacy mcporter proxy removed |
| `src/tools.ts` | **REWRITTEN** | ✅ Now 7 cognitive tools using `MemoryAdapter` with `normalizeTier()` validation |
| `src/hooks.ts` | **REFACTORED** | ✅ Uses `MemoryAdapter` interface; forward iteration; throttled heartbeat |
| `src/index.ts` | **REFACTORED** | ✅ Config validation, plugin ID migration, shutdown handler, adapter initialization |
| `src/memory-scorer.ts` | **ENHANCED** | ✅ All 7 scoring factors implemented; threshold validation; per-memory error handling |
| `src/adapters/memory-adapter.ts` | **CREATED** | ✅ Core `MemoryAdapter` interface + all type definitions |
| `src/adapters/graphiti-adapter.ts` | **CREATED** | ✅ Graphiti MCP adapter via `@modelcontextprotocol/sdk` |
| `src/adapters/neo4j-adapter.ts` | **CREATED** | ✅ Direct Neo4j Bolt adapter |
| `src/adapters/factory.ts` | **CREATED** | ✅ `AdapterFactory` with auto-detect cascade |
| `package.json` | **UPDATED** | ✅ v1.1.0, `@modelcontextprotocol/sdk` + `neo4j-driver` deps, eslint |

### 4.7 Configuration (Current — v1.1.0)

```yaml
# Current configuration (adapter-based)
graphiti-memory:
  backend: "auto"                        # or "graphiti-mcp" or "neo4j"
  transport: "sse"                       # or "stdio"
  endpoint: "http://localhost:8000/sse"  # for SSE transport
  groupId: "default"
  # OR for Neo4j direct:
  # backend: "neo4j"
  # neo4j:
  #   uri: "bolt://localhost:7687"
  #   user: "neo4j"
  #   password: "secret"
```

---

## 5. OpenClaw Plugin Compliance Audit

### 5.1 Plugin Standard (Expected by OpenClaw)

Based on the [OpenClaw Plugin SDK documentation](https://deepwiki.com/openclaw/openclaw/10.3-creating-custom-plugins), plugins must:

| Requirement | Expected | This Project | Status |
|-------------|----------|--------------|--------|
| **Entry point** | `export async function initialize(context: PluginContext)` | `export default { id, register(api) }` | ❌ MISMATCH |
| **Shutdown hook** | `export async function shutdown()` or `context.onShutdown()` | ✅ Registers via `api.onShutdown()` or `api.on('shutdown')` | ✅ IMPLEMENTED |
| **Plugin manifest** | `openclaw.extensions` in `package.json` | Present (`./dist/index.js`) | ✅ |
| **Plugin context** | `context: PluginContext` with `config`, `gateway`, `onShutdown` | Uses `api: any` with `api.pluginConfig` | ⚠️ WORKS BUT UNTYPED |
| **Tool registration** | Via `context.gateway.registerMethod()` | Via `api.registerTool()` | ⚠️ UNVERIFIED |
| **Hook registration** | Not a standard plugin feature; hooks are gateway-level | `api.on('before_agent_start')` | ⚠️ UNVERIFIED |
| **Config schema** | Zod-validated, merged into `OpenClawSchema` | JSON Schema in `openclaw.plugin.json` with min/max bounds | ⚠️ FORMAT MISMATCH |
| **Type safety** | Import from `openclaw/plugin-sdk` | API types are `any`; internal types well-defined | ⚠️ PARTIAL |
| **Module system** | ESM (`"type": "module"`) | Correct | ✅ |
| **Config validation** | Host-side or plugin-side | ✅ `validateScoringConfig()` with threshold invariant enforcement | ✅ IMPLEMENTED |
| **Safe logging** | Don't expose secrets in logs | ✅ Config logged with secrets masked (`[configured]`) | ✅ IMPLEMENTED |
| **Plugin ID migration** | Handle renames gracefully | ✅ `migratePluginSettings()` from legacy 'graphiti' ID | ✅ IMPLEMENTED |

### 5.2 Remaining Compliance Issues

#### Issue #1: Plugin Entry Point Pattern (STILL OPEN)

**Current (non-standard):**
```typescript
// index.ts
export default {
  id: 'graphiti-memory',
  legacyIds: ['graphiti'],
  async register(api: any) { ... }
};
```

**Expected (OpenClaw standard):**
```typescript
// index.ts
import type { PluginContext } from "openclaw/plugin-sdk";

export async function initialize(context: PluginContext) {
  const config = context.config;
  // register tools, hooks, etc.
  
  context.onShutdown(async () => {
    // cleanup connections
  });
}

export async function shutdown() {
  // final cleanup
}
```

#### Issue #2: `api.registerTool()` and `api.on()` are Not Verified APIs (STILL OPEN)

The code uses `api.registerTool()` and `api.on('before_agent_start')` which are not documented in the OpenClaw Plugin SDK. OpenClaw's plugin system provides `context.gateway.registerMethod()` for RPC methods.

**Resolution needed:** Verify if OpenClaw has an undocumented skill/tool registration API, or if the project is targeting a different extension point (possibly "skills" rather than "plugins"). A "skill" in OpenClaw is a SKILL.md file + tools, and memory plugins like `memory-lancedb` exist as extension packages. The actual mechanism for registering custom tools from a plugin needs to be validated against the OpenClaw source.

#### ~~Issue #3: Duplicate Files~~ (RESOLVED ✅)

Root-level duplicate files (`client.ts`, `tools.ts`, `hooks.ts`, `index.ts`) have been **deleted**. The `src/` directory is now the sole canonical source. The `src/client.ts` HTTP proxy has also been deleted, replaced by the `MemoryAdapter` pattern.

---

## 6. Graphiti Integration Assessment

### 6.1 What Graphiti Offers vs. What's Used

> **Note:** As of v1.1.0, the plugin operates through a `MemoryAdapter` interface. The Graphiti MCP adapter (`graphiti-adapter.ts`) maps adapter operations to Graphiti's MCP tools. The table below reflects what the adapter layer exposes vs. what Graphiti provides natively.

| Graphiti Capability | Available | Used by Plugin | Gap |
|---------------------|-----------|----------------|-----|
| **Episode ingestion** with entity+relationship extraction | ✅ | ✅ via `adapter.store()` → `add_memory` | — |
| **Semantic node search** (embedding-based) | ✅ | ✅ via `adapter.recall()` → `search_nodes` | — |
| **Fact/edge search** (relationship queries) | ✅ | ⚠️ Adapter interface has `searchByEntity()` | Could be better leveraged for richer recall |
| **Bi-temporal queries** (valid_at, invalid_at) | ✅ | ⚠️ `MemoryResult` has `validAt`/`invalidAt` fields defined but not widely used | Critical for "what was true then?" |
| **Custom entity types** (Pydantic models) | ✅ | ❌ Config exists but not leveraged | Would improve extraction quality |
| **Graph traversal** (related entities, paths) | ✅ | ⚠️ `adapter.getRelated()` exists, used in reinforcement processing | Could be expanded for associative recall |
| **Community detection** (clusters of related knowledge) | ✅ | ❌ Not used | Would enable "memory neighborhoods" |
| **Edge invalidation** (contradiction handling) | ✅ | ❌ Not used | Critical for memory updating |
| **Group management** (multi-tenant) | ✅ | ⚠️ `groupId` is configurable per plugin instance | No multi-user isolation within a single instance |
| **Hybrid search** (semantic + keyword + graph) | ✅ | ❌ Only semantic via recall | Missing keyword and graph search |
| **Graph distance reranking** | ✅ | ❌ Not used | Would improve relevance |

### 6.2 MCP Client Issues (RESOLVED ✅)

> The HTTP proxy client (`src/client.ts`) with its fragile JSON-RPC session handling, response parsing, and hardcoded endpoint path has been **fully replaced** by the `GraphitiMCPAdapter` which uses `@modelcontextprotocol/sdk` natively. All three original issues (ephemeral sessions, fragile parsing, single endpoint path) are eliminated by the SDK.

---

## 7. Full Code Review

### 7.1 What Works

1. **Clean module separation**: `tools.ts`, `hooks.ts`, `memory-scorer.ts`, and `adapters/` have clear responsibilities. No duplicate files.
2. **Error resilience**: All tool executions and hooks are wrapped in try/catch with graceful fallbacks. Heartbeat maintenance uses independent try/catch blocks for cleanup and reinforcement.
3. **Backend-agnostic adapter pattern**: `MemoryAdapter` interface in `adapters/memory-adapter.ts` with concrete Graphiti MCP and Neo4j implementations. Factory with auto-detect cascade.
4. **Config validation**: `validateScoringConfig()` enforces threshold invariants at startup. `MemoryScorer` constructor throws on invalid thresholds. `openclaw.plugin.json` has min/max bounds on numeric fields.
5. **Content filtering**: Auto-capture filters out injected `<memory>` blocks to prevent recursive storage
6. **Message truncation**: Captured messages are capped at 500 chars to prevent oversized episodes
7. **Limit clamping**: Recall tool clamps results to 1-20 range; list tool clamps to 1-50 range
8. **All 7 scoring factors implemented**: `checkRepetition()`, `checkNovelty()`, `checkContextAnchoring()`, `predictFutureUtility()` all query the adapter — no longer stubs
9. **Tier validation**: `normalizeTier()` helper validates tier strings against `VALID_TIERS` array; no unsafe casts
10. **Cleanup and reinforcement**: `cleanupExpiredMemories()` delegates to `adapter.cleanup()`. `processReinforcements()` processes per-memory with individual error handling.
11. **Plugin lifecycle**: Shutdown handler registered. Plugin ID migration from legacy IDs. Safe config logging (secrets masked).
12. **Docker Compose**: Infrastructure setup with Neo4j health checks is production-quality
13. **Chronological message ordering**: Forward iteration with `startIdx` avoids reverse-iterate-reverse antipattern
14. **Heartbeat throttling**: Gated by `scoringConfig.enabled` and throttled by `cleanupIntervalHours` via module-level timestamp

### 7.2 What Breaks

#### CRITICAL Issues

| # | Issue | Location | Impact | Status |
|---|-------|----------|--------|--------|
| 1 | **Plugin API mismatch** — `api.registerTool()` / `api.on()` don't match OpenClaw's `PluginContext` | `index.ts`, `tools.ts`, `hooks.ts` | Plugin may not load in OpenClaw | ❌ OPEN |
| 2 | ~~HTTP proxy client is redundant~~ | ~~`src/client.ts`~~ | ~~Replaced by MemoryAdapter~~ | ✅ RESOLVED |
| 3 | ~~3 of 7 scoring factors are stubs~~ | ~~`memory-scorer.ts`~~ | ~~All 7 factors now query adapter~~ | ✅ RESOLVED |
| 4 | ~~`cleanupExpiredMemories()` is a no-op~~ | ~~`memory-scorer.ts`~~ | ~~Now delegates to `adapter.cleanup()`~~ | ✅ RESOLVED |
| 5 | ~~`processReinforcements()` is a no-op~~ | ~~`memory-scorer.ts`~~ | ~~Now processes per-memory with error handling~~ | ✅ RESOLVED |
| 6 | ~~Tier metadata not stored~~ | ~~`hooks.ts`~~ | ~~Now stored via `adapter.store()` with structured metadata~~ | ✅ RESOLVED |
| 7 | ~~Duplicate file sets~~ | ~~Project structure~~ | ~~Root-level duplicates deleted~~ | ✅ RESOLVED |
| 8 | ~~No `memory-scorer.ts` at root~~ | ~~Missing~~ | ~~Root files deleted~~ | ✅ RESOLVED |

#### HIGH Issues

| # | Issue | Location | Impact | Status |
|---|-------|----------|--------|--------|
| 9 | ~~`searchFacts()` never called~~ | — | Agent can access Graphiti tools directly via MCP | ✅ RESOLVED |
| 10 | ~~No connection pooling or retry for HTTP client~~ | — | SDK handles transport | ✅ RESOLVED |
| 11 | **`heartbeat` hook assumes OpenClaw provides it** — undocumented | `hooks.ts` | Cleanup may never run if host doesn't emit heartbeat events | ⚠️ OPEN |
| 12 | ~~`minPromptLength` defaults to 10~~ | `index.ts` | ~~Now defaults to 20~~ | ✅ RESOLVED |
| 13 | ~~`future_utility` always defaults to 5~~ | `memory-scorer.ts` | ~~Now analyzes content for utility indicators~~ | ✅ RESOLVED |
| 14 | **No deduplication** for auto-stored episodes | `hooks.ts` | Same conversation stored multiple times across turns | ❌ OPEN |

#### MEDIUM Issues

| # | Issue | Location | Impact | Status |
|---|-------|----------|--------|--------|
| 15 | **API types are `any`** (`api: any`, `config: any`, `event: any`) | `index.ts`, `hooks.ts`, `tools.ts` | No type safety for host API; internal types well-defined | ⚠️ OPEN |
| 16 | ~~No `.env.example` file~~ | — | ~~Present with Neo4j + OpenRouter vars~~ | ✅ RESOLVED |
| 17 | **No LICENSE file** | Missing | Not legally distributable | ❌ OPEN |
| 18 | **No test files** | Missing | Zero test coverage | ❌ OPEN |
| 19 | **`config-docker-neo4j.yaml` is duplicated** (root + `config/`) | Two locations | Confusion about which to use | ⚠️ OPEN |
| 20 | ~~`memory_forget` requires UUID but no list tool~~ | — | ~~`memory_list` tool now exists~~ | ✅ RESOLVED |
| 21 | ~~Conversation segments reversed then re-reversed~~ | `hooks.ts` | ~~Forward iteration with `startIdx`~~ | ✅ RESOLVED |

### 7.3 Code Quality Issues

```text
Metric                     v1.0 (was)     v1.1.0 (now)     Target
──────────────────────────────────────────────────────────────────────
Type safety                any everywhere  any for API,     Full PluginContext types
                                          internal typed
Test coverage              0%             0%               >80%
Stub implementations       3/7 factors    0/7 factors ✅   0/7 factors
Dead code (root dups)      4 files        0 files ✅       0 files
Error codes                None           None             Enumerated error types
Logging                    console.log    console.log      Structured logging (levels)
Config validation          Partial        Robust ✅         Zod schema validation
Documentation coverage     README only    README + docs/   Full JSDoc + API docs
Linting                    None           eslint added ✅   Strict preset
Tier validation            unsafe casts   normalizeTier ✅  Full type guards
Shutdown handling          None           Implemented ✅    Context-based
```

---

## 8. Human-Like Memory System Evaluation

### 8.1 Cognitive Memory Model Comparison

Human memory operates through several systems. Here's how this project maps:

| Human Memory System | Description | Plugin Implementation | Gap |
|---------------------|-------------|----------------------|-----|
| **Sensory Memory** | Brief buffer (ms-seconds) | ❌ Not implemented | Could capture raw conversation before scoring |
| **Working Memory** | Active context (seconds-minutes) | ⚠️ Partial — auto-recall injects context | No working memory size limit or management |
| **Short-Term Memory** | Hours-days retention | ✅ Ephemeral tier with TTL (72h default), cleanup via adapter | TTL enforcement depends on adapter implementation |
| **Long-Term (Declarative)** | Facts, events (explicit retrieval) | ✅ Explicit tier + 7 memory tools | Scoring now reliable with all 7 factors |
| **Long-Term (Procedural)** | How-to knowledge (implicit) | ❌ Not implemented | Could extract and store procedures separately |
| **Episodic Memory** | Personal experiences with time/place context | ⚠️ Episodes stored with session/timestamp metadata | Graphiti supports bi-temporal but not fully leveraged |
| **Semantic Memory** | General knowledge, facts | ⚠️ Semantic search via adapter.recall() | No separation from episodic memory |
| **Prospective Memory** | Remember to do things in future | ❌ Not implemented | Time-sensitive detection exists but no action |
| **Memory Consolidation** | Sleep-like integration of new memories with old | ⚠️ Basic `memory_consolidate` tool exists | Simplified clustering; no LLM-based synthesis yet |
| **Forgetting Curve** | Natural decay over time | ❌ Concept exists, no implementation | Ebbinghaus curve could be applied |
| **Associative Recall** | One memory triggers related memories | ⚠️ `adapter.getRelated()` used in reinforcement | Not yet used during recall for enrichment |
| **Emotional Tagging** | Emotional events remembered more strongly | ⚠️ Keyword detection + weighted scoring | No sentiment analysis; keyword-based emotional weight |

### 8.2 What's Missing for "Human-Like" Memory

1. **Memory Consolidation**: After a session, the system should not just store conversations — it should synthesize them, extract key facts, update existing knowledge, and create new relationships. This is what Graphiti does naturally during episode ingestion, but the plugin bypasses this by storing raw conversation text.

2. **Associative Recall**: When recalling "VS Code preferences", the system should also surface related memories about "editor settings", "development tools", "coding workflow". This requires **graph traversal**, not just embedding similarity.

3. **Forgetting Curve**: Memories not accessed should decay in relevance over time. The current system has TTLs (72h, 30d) but no actual decay function applied to search scores.

4. **Memory Interference**: When new contradictory information arrives ("I switched from VS Code to Neovim"), the old memory should be marked as superseded. Graphiti supports edge invalidation, but it's not exposed.

5. **Context-Dependent Recall**: Recall accuracy should depend on the current context — at work vs. personal, coding vs. writing, etc. The current system searches all memories equally.

6. **Metacognition**: The agent should know what it knows and what it doesn't. A "confidence" score on recall results would enable this.

---

## 9. Logic & Feature Improvements

### 9.1 Immediate Fixes (COMPLETED ✅)

> **All three fixes from the original review have been implemented in v1.1.0.**

#### ~~Fix 1: Implement Stub Scoring Factors~~ ✅ DONE

All 7 scoring factors now query the adapter:
- `checkRepetition()` — queries `adapter.recall()` for similar content, calculates average similarity
- `checkNovelty()` — queries `adapter.recall()`, returns inverse of similarity (novel = high score)
- `checkContextAnchoring()` — queries `adapter.recall()`, weights by tier (explicit × 3, silent × 2)
- `predictFutureUtility()` — analyzes content for high/medium/low utility keyword indicators

#### ~~Fix 2: Store Tier Metadata as Structured Data~~ ✅ DONE

`storeWithMetadata()` in `hooks.ts` now passes structured metadata to `adapter.store()`:
```typescript
const metadata = {
  tier: scoreResult.tier,
  score: scoreResult.score,
  source: 'auto_capture',
  sessionId,
  expiresAt: scoreResult.expiresInHours
    ? new Date(Date.now() + scoreResult.expiresInHours * 3600000)
    : undefined,
};
await adapter.store(conversation, metadata);
```

#### ~~Fix 3: Implement Ephemeral Cleanup~~ ✅ DONE

`cleanupExpiredMemories()` delegates to `adapter.cleanup()`. `processReinforcements()` lists ephemeral memories, checks for related memories via `adapter.getRelated()`, and upgrades reinforced memories to silent tier. Each memory is processed in its own try/catch block.

### 9.2 Feature Improvements

#### ~~Feature 1: `memory_list` Tool~~ ✅ IMPLEMENTED

The `memory_list` tool exists with limit clamping (1-50) and tier filtering via `normalizeTier()`.

#### Feature 2: `memory_update` Tool (STILL TODO)

The `MemoryAdapter` interface supports `update(id, content, metadata)` but no user-facing tool exposes it yet. Would allow modifying existing memories without delete+recreate.

#### Feature 3: Semantic Deduplication Before Storage (STILL TODO)

```typescript
async function shouldStore(adapter: MemoryAdapter, content: string): Promise<boolean> {
  const existing = await adapter.recall(content, { limit: 3 });
  if (!existing || existing.length === 0) return true;
  
  // If highly similar content already exists, skip
  const isDuplicate = existing.some(r => r.relevanceScore > 0.8);
  
  return !isDuplicate;
}
```

#### Feature 4: Multi-Query Recall (Associative)

Instead of single-query recall, decompose the prompt into multiple semantic queries:

```typescript
async function associativeRecall(
  adapter: MemoryAdapter, 
  prompt: string, 
  limit: number
): Promise<MemoryResult[]> {
  // Primary: direct semantic match
  const primary = await adapter.recall(prompt, { limit });
  
  // Secondary: find related memories for top results
  const secondaryResults: MemoryResult[] = [];
  
  for (const result of primary.slice(0, 3)) {
    const related = await adapter.getRelated(result.id, 1);
    secondaryResults.push(...related);
  }
  
  // Merge and deduplicate
  const allResults = [...primary, ...secondaryResults];
  const seen = new Set<string>();
  return allResults.filter(r => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  }).slice(0, limit);
}
```

#### Feature 5: Forgetting Curve Scoring

Apply Ebbinghaus forgetting curve to search result relevance:

```typescript
function applyForgettingCurve(
  results: SearchResult[], 
  halfLifeDays: number = 14
): SearchResult[] {
  const now = Date.now();
  const lambda = Math.log(2) / (halfLifeDays * 86400000); // decay constant
  
  return results.map(r => {
    if (!r.valid_at) return r;
    const age = now - new Date(r.valid_at).getTime();
    const decayFactor = Math.exp(-lambda * age);
    
    return {
      ...r,
      // Adjust relevance score by temporal decay
      _relevanceBoost: decayFactor
    };
  }).sort((a, b) => (b._relevanceBoost || 1) - (a._relevanceBoost || 1));
}
```

---

## 10. Generalization Strategy (Backend-Agnostic) — IMPLEMENTED ✅

### 10.1 Adapter Pattern for Backend Independence (DONE)

The `MemoryAdapter` interface has been implemented in `src/adapters/memory-adapter.ts`. It provides a comprehensive contract that all backends must implement:

```typescript
// src/adapters/memory-adapter.ts (actual implementation)
export interface MemoryAdapter {
  // Lifecycle
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  
  // Core CRUD
  store(content: string, metadata: Partial<MemoryMetadata>): Promise<string>;
  recall(query: string, options: RecallOptions): Promise<MemoryResult[]>;
  forget(id: string): Promise<void>;
  update(id: string, content: string, metadata?: Partial<MemoryMetadata>): Promise<void>;
  
  // Search variants
  list(limit?: number, tier?: string): Promise<MemoryResult[]>;
  searchByEntity(entityName: string, limit?: number): Promise<MemoryResult[]>;
  searchByTimeRange(start: Date, end: Date, limit?: number): Promise<MemoryResult[]>;
  
  // Graph operations
  getRelated(id: string, depth?: number): Promise<MemoryResult[]>;
  
  // Operations
  healthCheck(): Promise<HealthResult>;
  getStats(): Promise<MemoryStats>;
  cleanup(): Promise<{ deleted: number; upgraded: number }>;
  getBackendType(): string;
}
```

### 10.2 Backend Implementations

```text
src/adapters/
├── memory-adapter.ts        # Interface + all type definitions (MemoryMetadata, MemoryResult, RecallOptions, etc.)
├── graphiti-adapter.ts      # ✅ Graphiti MCP server adapter (SSE/stdio via @modelcontextprotocol/sdk)
├── neo4j-adapter.ts         # ✅ Direct Neo4j Bolt driver adapter
├── factory.ts               # ✅ AdapterFactory with auto-detect cascade + createAdapterFromConfig()
├── index.ts                 # Re-exports
├── falkordb-adapter.ts      # TODO
└── sqlite-adapter.ts        # TODO
```

### 10.3 Configuration for Backend Selection (IMPLEMENTED)

Configuration is handled via `openclaw.plugin.json` and the `configSchema` in `index.ts`:

```json
{
  "backend": "auto",
  "transport": "sse",
  "endpoint": "http://localhost:8000/sse",
  "groupId": "default"
}
```

Backend selection supports:
- **`"auto"`** — Auto-detect cascade: env vars (Neo4j → Graphiti) → defaults (localhost Neo4j → localhost Graphiti) → error
- **`"graphiti-mcp"`** — Explicit Graphiti MCP with configurable transport/endpoint
- **`"neo4j"`** — Direct Neo4j Bolt connection with nested config object

The `AdapterFactory` also handles failed health checks by calling `adapter.shutdown()` before trying the next backend.

---

## 11. Publishability Assessment

### 11.1 Checklist for Publication

| Item | Status | Priority |
|------|--------|----------|
| ❌ **LICENSE file** (MIT/Apache-2.0) | Missing | CRITICAL |
| ❌ **Tests** (unit + integration) | None | CRITICAL |
| ✅ **`.env.example`** with required vars | Present (Neo4j + OpenRouter vars) | — |
| ✅ **`.gitignore`** | Present | — |
| ❌ **CI pipeline** (GitHub Actions) | Missing | HIGH |
| ⚠️ **Type safety** (remove all `any` types) | API types still `any`; internal types well-defined | HIGH |
| ✅ **Delete root-level duplicate files** | Done | — |
| ✅ **README.md** with setup instructions | Present | — |
| ✅ **Docker Compose** for infrastructure | Present | — |
| ✅ **package.json** well-formed | v1.1.0 with `repository`, `license`, `keywords`, `exports` | — |
| ⚠️ **OpenClaw plugin manifest** | `openclaw.plugin.json` present with full configSchema; needs entry point validation | MEDIUM |
| ❌ **CHANGELOG.md** | Missing | MEDIUM |
| ⚠️ **API documentation** (generated from JSDoc) | Architecture docs in `docs/`; no generated API docs | LOW |
| ⚠️ **Example configurations** for different setups | Multiple config YAML files in `config/`; root config duplicated | LOW |
| ✅ **eslint** | Added to devDependencies | — |
| ⚠️ **`config-docker-neo4j.yaml` duplicated** | Root + `config/` still have separate versions | LOW |

### 11.2 Current `package.json` (v1.1.0)

The package.json has been updated with proper fields:

```json
{
  "name": "@basuru/graphiti-memory",
  "version": "1.1.0",
  "description": "Graphiti temporal knowledge graph memory for OpenClaw with Memory Cortex adaptive importance scoring",
  "license": "MIT",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" },
    "./adapters": { "import": "./dist/adapters/index.js", "types": "./dist/adapters/index.d.ts" }
  },
  "repository": { "type": "git", "url": "https://github.com/basuru/graphiti-openclaw" },
  "keywords": ["openclaw", "memory", "graphiti", "knowledge-graph", "neo4j", "ai-agent", "temporal-memory", "agentic", "memory-cortex"],
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "@sinclair/typebox": "^0.32.0",
    "neo4j-driver": "^5.22.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "eslint": "^9.0.0",
    "typescript": "^5.3.0",
    "vitest": "^2.0.0"
  }
}
```

---

## 12. Future Roadmap: Self-Managed Memory Engine

### Phase 1: Stabilize & Migrate to MCP-Native — COMPLETED ✅

- [x] **Migrate to MCP-native** — `src/client.ts` HTTP proxy deleted; `GraphitiMCPAdapter` uses `@modelcontextprotocol/sdk`
- [x] **Rewrite tools** — 7 cognitive tools using `MemoryAdapter` with `normalizeTier()` validation
- [x] **Delete duplicate files** — root-level `client.ts`, `tools.ts`, `hooks.ts`, `index.ts` removed
- [x] Implement shutdown handler (`api.onShutdown()` or `api.on('shutdown')`)
- [x] Implement all 7 scoring factors (were stubs)
- [x] Implement ephemeral cleanup via `adapter.cleanup()`
- [x] Implement reinforcement processing with per-memory error handling
- [x] Add `.env.example`, `.gitignore`
- [x] Add cognitive tools (`memory_consolidate`, `memory_analyze`, `memory_list`)
- [x] Add config validation (`validateScoringConfig()`, threshold invariants)
- [x] Add plugin ID migration from legacy IDs
- [ ] Fix OpenClaw plugin compliance (`initialize(context)` pattern) — **STILL OPEN**
- [ ] Add unit tests (>70% coverage) — **STILL OPEN**

### Phase 2: Backend Abstraction — COMPLETED ✅

- [x] Design `MemoryAdapter` interface (comprehensive — 15+ methods)
- [x] Implement Graphiti MCP adapter (`graphiti-adapter.ts`)
- [x] Implement Neo4j direct adapter (`neo4j-adapter.ts`)
- [x] Implement `AdapterFactory` with auto-detect cascade
- [x] Configuration-driven backend selection (`auto`, `graphiti-mcp`, `neo4j`)
- [ ] Add SQLite adapter for lightweight deployments
- [ ] Add FalkorDB adapter
- [ ] Integration tests per backend
- [ ] Add LICENSE file — **CRITICAL, still missing**
- [ ] Add CHANGELOG.md

### Phase 3: Cognitive Memory Features (Next Priority)

- [ ] Implement forgetting curve decay
- [ ] Implement memory consolidation (periodic synthesis)
- [ ] Implement associative recall (graph traversal)
- [ ] Implement memory interference detection (contradiction handling)
- [ ] Add sentiment analysis for emotional tagging
- [ ] Add confidence scoring to recall results

### Phase 4: Self-Managed Engine (Weeks 11-16)

- [ ] Build standalone memory graph without Graphiti dependency
- [ ] Implement entity extraction pipeline (LLM-based)
- [ ] Implement relationship inference
- [ ] Build temporal index
- [ ] Implement community detection
- [ ] Create migration tools from Graphiti → standalone

### Phase 5: Publication & Community (Weeks 17-20)

- [ ] Comprehensive documentation site
- [ ] Example projects and tutorials
- [ ] ClawHub submission
- [ ] npm publication
- [ ] Community contribution guidelines
- [ ] Performance benchmarks

---

## 13. Brainstorm: Advanced Memory Concepts

### 13.1 Memory Consolidation Engine

Inspired by how human brains consolidate memories during sleep:

```text
┌──────────────────────────────────────────────────────┐
│              MEMORY CONSOLIDATION                    │
│              (runs periodically, e.g. every 6 hours) │
├──────────────────────────────────────────────────────┤
│                                                      │
│  1. COLLECTION                                       │
│     └── Gather all memories from last N hours        │
│                                                      │
│  2. CLUSTERING                                       │
│     └── Group related memories by semantic similarity│
│                                                      │
│  3. SYNTHESIS                                        │
│     └── LLM synthesizes each cluster into            │
│         - Key facts (entities + relationships)       │
│         - Updated beliefs/preferences                │
│         - Resolved contradictions                    │
│                                                      │
│  4. INTEGRATION                                      │
│     └── Merge synthesized facts with existing graph  │
│         - Update edges (new relationships)           │
│         - Invalidate stale edges                     │
│         - Strengthen reinforced nodes                │
│                                                      │
│  5. PRUNING                                          │
│     └── Remove raw conversation episodes             │
│         (they've been consolidated into facts)       │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### 13.2 Context-Aware Recall

Different contexts should trigger different memory retrieval strategies:

```typescript
interface RecallStrategy {
  name: string;
  match: (prompt: string, sessionContext: SessionContext) => boolean;
  recall: (client: MemoryAdapter, prompt: string) => Promise<MemoryResult[]>;
}

const strategies: RecallStrategy[] = [
  {
    name: 'preference_recall',
    match: (prompt) => /prefer|like|want|setup|config/i.test(prompt),
    recall: async (client, prompt) => {
      // Prioritize Preference entity types
      return client.searchByEntity('Preference', 10);
    }
  },
  {
    name: 'procedural_recall',
    match: (prompt) => /how to|step|procedure|process|workflow/i.test(prompt),
    recall: async (client, prompt) => {
      return client.searchByEntity('Procedure', 10);
    }
  },
  {
    name: 'temporal_recall',
    match: (prompt) => /yesterday|last week|previously|before|earlier/i.test(prompt),
    recall: async (client, prompt) => {
      // Use bi-temporal queries
      const timeRef = extractTimeReference(prompt);
      return client.searchByTimeRange(timeRef.start, timeRef.end);
    }
  },
  {
    name: 'default_semantic',
    match: () => true,
    recall: async (client, prompt) => client.searchSemantic(prompt, 5)
  }
];
```

### 13.3 Memory Self-Assessment ("Metacognition")

The agent should know what it does and doesn't remember:

```typescript
interface MemoryConfidence {
  query: string;
  confidence: 'high' | 'medium' | 'low' | 'none';
  reasoning: string;
  suggestion?: string; // "I should ask the user about this"
}

async function assessMemoryConfidence(
  client: MemoryAdapter,
  query: string
): Promise<MemoryConfidence> {
  const results = await client.recall(query, { limit: 5 });
  
  if (results.length === 0) {
    return {
      query,
      confidence: 'none',
      reasoning: 'No memories found matching this topic',
      suggestion: 'Ask the user for this information'
    };
  }
  
  const avgScore = results.reduce((s, r) => s + r.score, 0) / results.length;
  const maxAge = Math.max(...results.map(r => 
    Date.now() - r.createdAt.getTime()
  ));
  const maxAgeDays = maxAge / 86400000;
  
  if (avgScore > 0.8 && maxAgeDays < 7) {
    return { query, confidence: 'high', reasoning: 'Recent, high-relevance memories found' };
  }
  if (avgScore > 0.5 || maxAgeDays < 30) {
    return { query, confidence: 'medium', reasoning: 'Some relevant memories found, but may be outdated' };
  }
  return {
    query,
    confidence: 'low',
    reasoning: 'Old or weakly-matched memories only',
    suggestion: 'Verify this information with the user'
  };
}
```

### 13.4 Multi-Agent Memory Sharing

For OpenClaw's multi-agent architecture, memories could be shared or isolated:

```text
Agent A (coder) ────┐
                    ├──► Shared Memory Graph ──► Common preferences, facts
Agent B (writer) ───┘                          
                                               
Agent A ─────────────► A-Private Graph ──► Code snippets, technical context
Agent B ─────────────► B-Private Graph ──► Writing style, drafts
```

### 13.5 Proactive Memory Alerts

Instead of only recalling when asked, the system could proactively surface memories:

```typescript
// During agent turn, if the user mentions a deadline
// and we have a stored deadline memory approaching...
async function proactiveAlerts(
  client: MemoryAdapter,
  currentDate: Date
): Promise<string[]> {
  const alerts: string[] = [];
  
  // Find time-sensitive memories expiring soon
  const upcoming = await client.searchByTimeRange(
    currentDate,
    new Date(currentDate.getTime() + 7 * 86400000) // next 7 days
  );
  
  for (const memory of upcoming) {
    if (memory.metadata.tags?.includes('deadline') || 
        memory.metadata.tags?.includes('reminder')) {
      alerts.push(`Upcoming: ${memory.summary}`);
    }
  }
  
  return alerts;
}
```

---

## 14. Implementation Priority Matrix

> **Updated for v1.1.0** — completed items struck through, remaining items re-prioritized.

| Priority | Task | Effort | Impact | Status |
|----------|------|--------|--------|--------|
| ~~**P0**~~ | ~~Migrate to MCP-native~~ | ~~M~~ | ~~Critical~~ | ✅ DONE |
| ~~**P0**~~ | ~~Rewrite tools with adapter pattern~~ | ~~M~~ | ~~High~~ | ✅ DONE |
| ~~**P0**~~ | ~~Delete duplicate files~~ | ~~S~~ | ~~High~~ | ✅ DONE |
| **P0** | Fix OpenClaw plugin compliance (initialize/PluginContext) | M | Critical | ❌ OPEN |
| **P0** | Add LICENSE file | S | Critical | ❌ OPEN |
| ~~**P1**~~ | ~~Implement scoring factors (repetition, novelty, anchoring, utility)~~ | ~~M~~ | ~~High~~ | ✅ DONE |
| ~~**P1**~~ | ~~Implement ephemeral cleanup~~ | ~~M~~ | ~~High~~ | ✅ DONE |
| ~~**P1**~~ | ~~Add `.env.example`, `.gitignore`~~ | ~~S~~ | ~~Medium~~ | ✅ DONE |
| ~~**P1**~~ | ~~Add cognitive tools (`memory_consolidate`, `memory_analyze`, `memory_list`)~~ | ~~M~~ | ~~High~~ | ✅ DONE |
| **P1** | Add unit tests | L | High | ❌ OPEN |
| **P1** | Remove `any` types for API, add proper TypeScript interfaces | M | Medium | ❌ OPEN |
| **P2** | Implement forgetting curve decay on recall | M | Medium | ❌ OPEN |
| **P2** | Add deduplication before storage | M | Medium | ❌ OPEN |
| ~~**P3**~~ | ~~Design `MemoryAdapter` interface~~ | ~~M~~ | ~~High~~ | ✅ DONE |
| **P2** | Add FalkorDB adapter | L | Medium | ❌ OPEN |
| **P2** | Add SQLite adapter for lightweight mode | L | High | ❌ OPEN |
| **P3** | Implement associative recall (graph traversal in recall path) | L | High | ❌ OPEN |
| **P3** | Context-aware recall strategies | L | Medium | ❌ OPEN |
| **P4** | Memory consolidation engine (LLM-based synthesis) | XL | High | ❌ OPEN |
| **P5** | Self-managed memory engine (no Graphiti) | XXL | High | ❌ OPEN |

**Effort Key:** S = <1 day, M = 1-3 days, L = 1-2 weeks, XL = 2-4 weeks, XXL = 1-2 months

---

## 15. Appendix: Reference Architecture Diagrams

### 15.1 Current Architecture (v1.1.0 — Implemented)

```text
┌──────────────────────────────────────────────────────────────┐
│                     OpenClaw Gateway                         │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │            Agentic Memory Plugin (v1.1.0)            │   │
│  │                                                      │   │
│  │  ┌──────────┐  ┌──────────────┐  ┌───────────────┐ │   │
│  │  │ Tools    │  │ Hooks Layer  │  │ Memory Cortex │ │   │
│  │  │ recall   │  │ auto-recall  │  │ 7-factor      │ │   │
│  │  │ store    │  │ auto-capture │  │ scoring       │ │   │
│  │  │ forget   │  │ heartbeat    │  │ Cleanup       │ │   │
│  │  │ list     │  │ (throttled)  │  │ Reinforcement │ │   │
│  │  │ status   │  │              │  │               │ │   │
│  │  │ consol.  │  │              │  │               │ │   │
│  │  │ analyze  │  │              │  │               │ │   │
│  │  └──────────┘  └──────────────┘  └───────────────┘ │   │
│  │                       │                              │   │
│  │  ┌────────────────────┴──────────────────────────┐  │   │
│  │  │           MemoryAdapter Interface             │  │   │
│  │  │  store() | recall() | forget() | update()    │  │   │
│  │  │  searchSemantic() | searchByEntity()         │  │   │
│  │  │  getRelated() | cleanup() | getStats()       │  │   │
│  │  └────────┬──────────┬──────────┬───────────────┘  │   │
│  └───────────┼──────────┼──────────┼───────────────────┘   │
│              │          │          │                         │
└──────────────┼──────────┼──────────┼─────────────────────────┘
               │          │          │
     ┌─────────┴──┐  ┌───┴────┐  ┌─┴──────────┐
     │ Graphiti   │  │ Neo4j  │  │ SQLite +   │
     │ MCP Server │  │ Direct │  │ Embeddings │
     │ (Docker)   │  │ (Bolt) │  │ (Local)    │
     └────────────┘  └────────┘  └────────────┘
```

### 15.2 Memory Lifecycle

```text
  User Interaction
        │
        ▼
  ┌─────────────┐     ┌─────────────┐     ┌──────────────┐
  │  INGESTION  │────▶│  SCORING    │────▶│  STORAGE     │
  │  (capture)  │     │  (0-10)     │     │  (tiered)    │
  └─────────────┘     └─────────────┘     └──────────────┘
                                                 │
                ┌────────────────────────────────┤
                ▼                                ▼
  ┌─────────────────┐              ┌──────────────────┐
  │  CONSOLIDATION  │              │  RETRIEVAL       │
  │  (periodic      │              │  (multi-strategy │
  │   synthesis)    │              │   recall)        │
  └─────────────────┘              └──────────────────┘
                │                           │
                ▼                           ▼
  ┌─────────────────┐              ┌──────────────────┐
  │  REINFORCEMENT  │◀─────────────│  USAGE TRACKING  │
  │  (strengthen or │              │  (access count,  │
  │   decay)        │              │   recency)       │
  └─────────────────┘              └──────────────────┘
                │
                ▼
  ┌─────────────────┐
  │  PRUNING        │
  │  (forget expired│
  │   + unused)     │
  └─────────────────┘
```

---

## Summary of Findings

### Strengths
1. **Innovative Memory Cortex concept** — tiered importance scoring is a genuine differentiator
2. **Clean separation of concerns** — tools, hooks, scorer, adapters are well-isolated with clear responsibilities
3. **Backend-agnostic adapter pattern** — `MemoryAdapter` interface with Graphiti MCP and Neo4j implementations; auto-detect cascade
4. **All 7 scoring factors implemented** — repetition, novelty, context anchoring, future utility, explicit markers, emotional weight, time sensitivity
5. **Robust error handling** — graceful degradation throughout; per-memory try/catch in reinforcement; independent cleanup/reinforcement blocks
6. **Good infrastructure setup** — Docker Compose with Neo4j health checks
7. **Comprehensive config schema** — min/max bounds, threshold invariant validation, safe logging, plugin ID migration
8. **Complete tool suite** — 7 cognitive tools (recall, store, list, forget, status, consolidate, analyze)
9. **Functional lifecycle** — Cleanup, reinforcement, heartbeat throttling, and shutdown all implemented

### Remaining Gaps
1. **OpenClaw plugin API mismatch** — still uses `export default { register(api) }` instead of `initialize(context: PluginContext)`. May not load in standard OpenClaw.
2. **No tests, no CI, no LICENSE** — not publishable
3. **API types still `any`** — host API interactions have no type safety
4. **No deduplication** for auto-stored episodes
5. **No forgetting curve** — memories don't decay in relevance over time
6. **No associative recall** — `getRelated()` exists but isn't used during recall
7. **Config YAML duplication** — `config-docker-neo4j.yaml` at root + `config/`

### Recommendation

**Continue investing in this project.** The v1.1.0 release represents significant progress — from ~40% to ~65% implementation. The HTTP proxy has been eliminated, the adapter pattern is battle-ready, all scoring factors are functional, and the plugin has proper lifecycle management. **Next priorities: add a LICENSE file, write unit tests, and fix the OpenClaw plugin entry point pattern.** Then pursue cognitive features (forgetting curve, associative recall, LLM-based consolidation) that will truly differentiate this from Graphiti/Mem0/Cognee.

---

*Document prepared for Lead Software Engineer review. All recommendations are based on analysis of the v1.1.0 project codebase, OpenClaw plugin SDK documentation (DeepWiki), Graphiti GitHub repository (getzep/graphiti), and agentic memory architecture best practices. Rev 2.0 updated to reflect implemented changes.*
