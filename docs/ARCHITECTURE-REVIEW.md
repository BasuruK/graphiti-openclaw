# Graphiti-OpenClaw — Comprehensive Architecture Review & Evaluation

**Document Version:** 1.1  
**Date:** February 27, 2026  
**Author:** Senior AI Architect — Agentic Memory Systems  
**Scope:** Full code review, architecture evaluation, compliance check, and forward roadmap  
**Rev 1.1:** Added Section 4 — MCP-Native vs HTTP Proxy architecture decision (validated: MCP-native adopted)

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
| **Transport Strategy** | ★★☆☆☆ | HTTP fetch proxy layer is redundant — **migrate to MCP-native** (see Section 4) |
| **OpenClaw Compliance** | ★★☆☆☆ | Uses non-standard plugin API (`api.registerTool`, `api.on`); needs migration to `PluginContext` + `initialize()` |
| **Code Quality** | ★★★☆☆ | Clean TypeScript, good error handling, but heavy use of `any`, duplicated files, stub implementations |
| **Graphiti Integration** | ★★★☆☆ | Functional but thin — doesn't leverage Graphiti's temporal queries, entity types, or relationship traversal |
| **Human-Like Memory** | ★★☆☆☆ | Scoring framework exists but 3 of 7 scoring factors are hardcoded stubs; no actual decay/reinforcement |
| **Publishability** | ★★☆☆☆ | Missing tests, CI, LICENSE file, `.env.example`, proper npm packaging, and OpenClaw SDK types |
| **Scalability** | ★★☆☆☆ | Single-group flat storage; no multi-user isolation, graph partitioning, or connection pooling |

**Bottom line:** The project has a compelling vision and a solid starting architecture, but it's currently at ~40% implementation. The HTTP proxy client should be replaced with MCP-native communication (the protocol Graphiti was designed for). The Memory Cortex scoring concept is genuinely innovative and worth pursuing, but the code needs significant work before it's publishable or production-ready.

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

### 3.1 Current Architecture (HTTP Proxy — DEPRECATED)

> **⚠️ ARCHITECTURAL DECISION:** The HTTP proxy approach below has been evaluated and rejected in favor of MCP-native communication. See [Section 4](#4-architecture-decision-mcp-native-vs-http-proxy) for the full analysis.

```
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

### 3.2 Target Architecture (MCP-Native)

```
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
│  │  │ consolidate  │  │ Decay / Reinforcement     │  │    │
│  │  └──────┬───────┘  └────────────┬──────────────┘  │    │
│  │         │                       │                  │    │
│  │  ┌──────┴───────────────────────┴──────────────┐  │    │
│  │  │  MCP Client (@modelcontextprotocol/sdk)     │  │    │
│  │  │  Calls Graphiti tools programmatically      │  │    │
│  │  │  for hooks/scoring (NOT exposed as tools)   │  │    │
│  │  └─────────────────────┬───────────────────────┘  │    │
│  └────────────────────────┼───────────────────────────┘    │
│                           │ MCP (stdio/SSE)                │
└───────────────────────────┼────────────────────────────────┘
                            │
               ┌────────────┴────────────┐
               │  Graphiti MCP Server    │
               │  (same server as above) │
               └─────────────────────────┘
```

**Key insight:** The agent talks to Graphiti **directly** via MCP for basic operations. The plugin is the **cognitive layer** that adds scoring, hooks, and consolidation — it calls Graphiti via MCP client for its internal logic, but does NOT re-expose Graphiti's tools as wrapped HTTP proxies.

### 3.3 Data Flow

```
User Message ──► before_agent_start Hook
                      │
                      ├──► searchNodes(prompt) ──► Graphiti MCP
                      │                              │
                      ◄── <memory> context block ◄───┘
                      │
                 Agent processes turn (with memory context)
                      │
                      ▼
               agent_end Hook
                      │
                      ├──► Extract conversation segments
                      ├──► MemoryScorer.scoreConversation()
                      │        │
                      │        ├── detectExplicitMarkers()
                      │        ├── detectEmotionalContent()
                      │        ├── checkRepetition() [STUB]
                      │        ├── checkContextAnchoring() [STUB]
                      │        ├── detectTimeSensitivity()
                      │        └── checkNovelty() [STUB]
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
                          client.addEpisode()
```

---

## 4. Architecture Decision: MCP-Native vs HTTP Proxy

> **Decision: ADOPT MCP-NATIVE. Deprecate the HTTP proxy client.**

### 4.1 The Problem

The project currently has two client implementations:

| File | Transport | Approach |
|------|-----------|----------|
| `src/client.ts` | **HTTP fetch** → `{endpoint}/mcp/` | Manually constructs JSON-RPC 2.0 payloads, manually parses `content[0].text` responses |
| `client.ts` (root) | **MCP via mcporter** subprocess | Spawns `mcporter call graphiti-memory.<tool>` CLI commands |

Both are proxies. The HTTP client (212 lines) re-implements what the MCP protocol already provides natively. It creates a **redundant middleware layer** between the agent and Graphiti.

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

### 4.3 MCP-Native Architecture

With MCP-native, the plugin's role **shifts from tool proxy to cognitive orchestrator**:

#### What gets REMOVED
- `src/client.ts` — the entire HTTP proxy client (212 lines)
- `src/tools.ts` — the 4 wrapper tools that just proxy to Graphiti (the agent calls Graphiti directly)
- Root `client.ts` — the older mcporter subprocess client

#### What STAYS (the actual value-add)
- `src/memory-scorer.ts` — Memory Cortex importance scoring
- `src/hooks.ts` — auto-recall, auto-capture, consolidation hooks
- `src/index.ts` — plugin lifecycle (rewritten for OpenClaw SDK compliance)

#### What gets ADDED
- **MCP Client** via `@modelcontextprotocol/sdk` — used by hooks to call Graphiti programmatically
- **Enhanced tools** — only tools that add value beyond raw Graphiti (e.g., `memory_recall_scored`, `memory_consolidate`)

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
```
Agent's tool inventory:
  ├── memory_recall       ← plugin wrapper around Graphiti's search_nodes
  ├── memory_store        ← plugin wrapper around Graphiti's add_memory  
  ├── memory_forget       ← plugin wrapper around Graphiti's delete_episode
  └── memory_status       ← plugin wrapper around Graphiti's get_status

  Problem: Only 4 tools. No access to search_facts, get_episodes,
           clear_graph, or any future Graphiti tools.
```

#### AFTER (MCP-native — agent sees Graphiti tools directly + plugin's cognitive tools)
```
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
  └── [From Memory Cortex Plugin — value-add tools]
      ├── memory_consolidate  ← synthesize recent memories
      └── memory_analyze      ← score/assess a memory's importance

  Benefit: Full Graphiti surface area. Plugin only adds cognitive tools.
```

### 4.6 Impact on Codebase

| File | Action | Reason |
|------|--------|--------|
| `src/client.ts` | **DELETE** | Replaced by MCP client |
| `client.ts` (root) | **DELETE** | Legacy mcporter proxy — also replaced |
| `src/tools.ts` | **REWRITE** | Remove proxy tools; keep only cognitive/enhanced tools |
| `src/hooks.ts` | **REFACTOR** | Replace `client.searchNodes()` calls with MCP client |
| `src/index.ts` | **REFACTOR** | Initialize MCP client instead of HTTP client |
| `src/memory-scorer.ts` | **KEEP** | No transport dependency — pure scoring logic |
| `src/mcp-client.ts` | **CREATE** | New MCP client using `@modelcontextprotocol/sdk` |
| `package.json` | **UPDATE** | Add `@modelcontextprotocol/sdk` dependency |

### 4.7 Configuration Change

```yaml
# BEFORE (HTTP)
graphiti-memory:
  endpoint: "http://localhost:8000"     # HTTP URL
  groupId: "default"

# AFTER (MCP)
graphiti-memory:
  transport: "stdio"                     # or "sse"
  mcpCommand: "uv"                       # for stdio
  mcpArgs: ["run", "graphiti-mcp", "--transport", "stdio"]
  # OR for remote:
  # transport: "sse"
  # endpoint: "http://localhost:8000/sse"
  groupId: "default"
```

---

## 5. OpenClaw Plugin Compliance Audit

### 4.1 Plugin Standard (Expected by OpenClaw)

Based on the [OpenClaw Plugin SDK documentation](https://deepwiki.com/openclaw/openclaw/10.3-creating-custom-plugins), plugins must:

| Requirement | Expected | This Project | Status |
|-------------|----------|--------------|--------|
| **Entry point** | `export async function initialize(context: PluginContext)` | `export default { register(api) }` | ❌ MISMATCH |
| **Shutdown hook** | `export async function shutdown()` or `context.onShutdown()` | Not implemented | ❌ MISSING |
| **Plugin manifest** | `openclaw.extensions` in `package.json` | Present (`./index.ts`) | ✅ |
| **Plugin context** | `context: PluginContext` with `config`, `gateway`, `onShutdown` | Uses `api: any` | ❌ WRONG API |
| **Tool registration** | Via `context.gateway.registerMethod()` | Via `api.registerTool()` | ⚠️ UNVERIFIED |
| **Hook registration** | Not a standard plugin feature; hooks are gateway-level | `api.on('before_agent_start')` | ⚠️ UNVERIFIED |
| **Config schema** | Zod-validated, merged into `OpenClawSchema` | JSON Schema in `openclaw.plugin.json` | ⚠️ FORMAT MISMATCH |
| **Type safety** | Import from `openclaw/plugin-sdk` | All types are `any` | ❌ NO TYPES |
| **Module system** | ESM (`"type": "module"`) | Correct | ✅ |

### 4.2 Critical Compliance Issues

#### Issue #1: Plugin Entry Point Pattern

**Current (non-standard):**
```typescript
// index.ts
export default {
  id: 'graphiti-memory',
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

#### Issue #2: `api.registerTool()` and `api.on()` are Not Verified APIs

The code uses `api.registerTool()` and `api.on('before_agent_start')` which are not documented in the OpenClaw Plugin SDK. OpenClaw's plugin system provides `context.gateway.registerMethod()` for RPC methods.

**Resolution needed:** Verify if OpenClaw has an undocumented skill/tool registration API, or if the project is targeting a different extension point (possibly "skills" rather than "plugins"). A "skill" in OpenClaw is a SKILL.md file + tools, and memory plugins like `memory-lancedb` exist as extension packages. The actual mechanism for registering custom tools from a plugin needs to be validated against the OpenClaw source.

#### Issue #3: Duplicate Files

The project has **two sets of identical files** — one at root (`client.ts`, `tools.ts`, `hooks.ts`, `index.ts`) and one under `src/`. The root files are stale copies (e.g., `client.ts` at root uses `spawn('mcporter')` subprocess calls while `src/client.ts` uses `fetch` HTTP). This creates confusion about which is canonical.

**Root files (legacy — mcporter subprocess):**
- `client.ts` — spawns `mcporter call` subprocesses
- `tools.ts` — identical to `src/tools.ts` but no limit clamping
- `hooks.ts` — nearly identical to `src/hooks.ts`
- `index.ts` — nearly identical to `src/index.ts`

**`src/` files (current — HTTP/fetch):**
- `client.ts` — uses `fetch()` with JSON-RPC protocol
- `tools.ts` — has limit clamping (`Math.min(Math.max(...))`)
- `hooks.ts` — identical logic
- `memory-scorer.ts` — Memory Cortex implementation

**Action:** Delete root-level duplicates. The `src/` files are canonical.

---

## 6. Graphiti Integration Assessment

### 6.1 What Graphiti Offers vs. What's Used

| Graphiti Capability | Available | Used by Plugin | Gap |
|---------------------|-----------|----------------|-----|
| **Episode ingestion** with entity+relationship extraction | ✅ | ✅ (addEpisode) | — |
| **Semantic node search** (embedding-based) | ✅ | ✅ (searchNodes) | — |
| **Fact/edge search** (relationship queries) | ✅ | ⚠️ (client has method, never called) | Facts are richer than nodes for recall |
| **Bi-temporal queries** (valid_at, invalid_at) | ✅ | ❌ Not used | Critical for "what was true then?" |
| **Custom entity types** (Pydantic models) | ✅ | ❌ Config exists but not leveraged | Would improve extraction quality |
| **Graph traversal** (related entities, paths) | ✅ | ❌ Not used | Essential for contextual memory |
| **Community detection** (clusters of related knowledge) | ✅ | ❌ Not used | Would enable "memory neighborhoods" |
| **Edge invalidation** (contradiction handling) | ✅ | ❌ Not used | Critical for memory updating |
| **Group management** (multi-tenant) | ✅ | ⚠️ (single group hardcoded) | No multi-user support |
| **Hybrid search** (semantic + keyword + graph) | ✅ | ❌ Only semantic | Missing keyword and graph search |
| **Graph distance reranking** | ✅ | ❌ Not used | Would improve relevance |

### 6.2 MCP Client Issues (HTTP Proxy — To Be Removed)

> **These issues are moot once the MCP-native migration (Section 4) is complete.** Documented here for historical reference.

**Issue: JSON-RPC Session handling**

The `src/client.ts` sends `sessionId: "oc-${Date.now()}"` which creates a **new session for every call**. MCP servers typically expect persistent sessions. This means:
- Each call may trigger server-side session initialization overhead
- No session continuity or caching benefits
- The Graphiti MCP server may not optimize queries across the session

**Issue: Response parsing**

```typescript
const text = data.result?.content?.[0]?.text;
```

This assumes the MCP response always wraps results in `content[0].text` as a JSON string. If Graphiti updates its MCP response format, this breaks silently.

**Issue: Single endpoint path**

```typescript
const response = await fetch(`${this.config.endpoint}/mcp/`, { ... });
```

The trailing `/mcp/` is hardcoded. If Graphiti changes its MCP endpoint path, there's no way to configure it.

**Resolution:** All three issues are eliminated by migrating to `@modelcontextprotocol/sdk` which handles session management, response parsing, and transport configuration natively.

---

## 7. Full Code Review

### 7.1 What Works

1. **Clean module separation**: `client.ts`, `tools.ts`, `hooks.ts`, `memory-scorer.ts` have clear responsibilities
2. **Error resilience**: All tool executions and hooks are wrapped in try/catch with graceful fallbacks
3. **Timeout protection**: The HTTP client has a 30-second AbortController timeout
4. **Config validation**: Memory scorer validates that `ephemeralThreshold < explicitThreshold`
5. **Content filtering**: Auto-capture filters out injected `<memory>` blocks to prevent recursive storage
6. **Message truncation**: Captured messages are capped at 500 chars to prevent oversized episodes
7. **Limit clamping**: Recall tool clamps results to 1-20 range
8. **Scoring architecture**: The weighted multi-factor scoring model is well-structured and extensible
9. **Docker Compose**: Infrastructure setup with Neo4j health checks is production-quality

### 7.2 What Breaks

#### CRITICAL Issues

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| 1 | **Plugin API mismatch** — `api.registerTool()` / `api.on()` don't match OpenClaw's `PluginContext` | `index.ts`, `tools.ts`, `hooks.ts` | Plugin won't load in OpenClaw |
| 2 | **HTTP proxy client is redundant** — duplicates MCP protocol manually over fetch | `src/client.ts` | 212 lines of unnecessary code; fragile parsing, no retry, ephemeral sessions — **migrate to MCP-native (Section 4)** |
| 3 | **3 of 7 scoring factors are stubs** returning hardcoded values | `memory-scorer.ts` L168-185 | Scoring is unreliable; novelty=6 and repetition=3 always |
| 4 | **`cleanupExpiredMemories()` is a no-op** | `memory-scorer.ts` L327 | Ephemeral memories never expire |
| 5 | **`processReinforcements()` is a no-op** | `memory-scorer.ts` L335 | Memories never upgrade/downgrade |
| 6 | **Tier metadata not stored** in Graphiti | `hooks.ts` L196 | Only prepended as text `[EPHEMERAL]`; not queryable |
| 7 | **Duplicate file sets** (root vs `src/`) with diverging implementations | Project structure | Ambiguity about canonical source |
| 8 | **No `memory-scorer.ts` at root** | Missing | Root-level files import from scorer that doesn't exist at root |

#### HIGH Issues

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| 9 | **`searchFacts()` never called** — agent can't access it because proxy doesn't expose it | `client.ts` | **Resolved by MCP-native**: agent sees `search_facts` directly |
| 10 | **No connection pooling or retry** for HTTP client | `client.ts` | **Resolved by MCP-native**: SDK handles transport |
| 11 | **`heartbeat` hook registration assumes OpenClaw provides it** — undocumented | `hooks.ts` L175 | Cleanup never runs |
| 12 | **`minPromptLength` defaults to 10** | `index.ts` | Too short; even "hi" passes. Should be ~20-30 |
| 13 | **`future_utility` always defaults to 5** | `memory-scorer.ts` L106 | The most important scoring factor is static |
| 14 | **No deduplication** for auto-stored episodes | `hooks.ts` | Same conversation stored multiple times across turns |

#### MEDIUM Issues

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| 15 | **All types are `any`** (`api: any`, `config: any`, `event: any`) | Everywhere | No type safety; runtime errors likely |
| 16 | **No `.env.example` file** | Missing | Users don't know required environment variables |
| 17 | **No LICENSE file** | Missing | Not legally distributable |
| 18 | **No test files** | Missing | Zero test coverage |
| 19 | **`config-docker-neo4j.yaml` is duplicated** (root + `config/`) | Two locations | Confusion about which to use |
| 20 | **`memory_forget` requires UUID** but user has no way to discover UUIDs | `tools.ts` | Tool is unusable without a "list memories" feature — **resolved by MCP-native** (agent can call `get_episodes` directly) |
| 21 | **Conversation segments are reversed then re-reversed** | `hooks.ts` L83-109 | Complex logic that could introduce ordering bugs |

### 7.3 Code Quality Issues

```
Metric                     Current        Target
─────────────────────────────────────────────────
Type safety                any everywhere  Full PluginContext types
Test coverage              0%             >80%
Stub implementations       3/7 factors    0/7 factors
Dead code (root dups)      4 files        0 files
Error codes                None           Enumerated error types
Logging                    console.log    Structured logging (levels)
Config validation          Partial        Zod schema validation
Documentation coverage     README only    Full JSDoc + API docs
```

---

## 8. Human-Like Memory System Evaluation

### 8.1 Cognitive Memory Model Comparison

Human memory operates through several systems. Here's how this project maps:

| Human Memory System | Description | Plugin Implementation | Gap |
|---------------------|-------------|----------------------|-----|
| **Sensory Memory** | Brief buffer (ms-seconds) | ❌ Not implemented | Could capture raw conversation before scoring |
| **Working Memory** | Active context (seconds-minutes) | ⚠️ Partial — auto-recall injects context | No working memory size limit or management |
| **Short-Term Memory** | Hours-days retention | ⚠️ Ephemeral tier (concept exists, stub impl) | No actual TTL enforcement |
| **Long-Term (Declarative)** | Facts, events (explicit retrieval) | ✅ Explicit tier + memory tools | Works but scoring is unreliable |
| **Long-Term (Procedural)** | How-to knowledge (implicit) | ❌ Not implemented | Could extract and store procedures separately |
| **Episodic Memory** | Personal experiences with time/place context | ⚠️ Episodes stored but temporal context weak | Graphiti supports bi-temporal but not leveraged |
| **Semantic Memory** | General knowledge, facts | ⚠️ Node search exists | No separation from episodic memory |
| **Prospective Memory** | Remember to do things in future | ❌ Not implemented | Time-sensitive detection exists but no action |
| **Memory Consolidation** | Sleep-like integration of new memories with old | ❌ N/A | Missing — key differentiator opportunity |
| **Forgetting Curve** | Natural decay over time | ❌ Concept exists, no implementation | Ebbinghaus curve could be applied |
| **Associative Recall** | One memory triggers related memories | ❌ Not implemented | Graphiti's graph traversal could enable this |
| **Emotional Tagging** | Emotional events remembered more strongly | ⚠️ Keyword detection only | No sentiment analysis or emotional weighting |

### 8.2 What's Missing for "Human-Like" Memory

1. **Memory Consolidation**: After a session, the system should not just store conversations — it should synthesize them, extract key facts, update existing knowledge, and create new relationships. This is what Graphiti does naturally during episode ingestion, but the plugin bypasses this by storing raw conversation text.

2. **Associative Recall**: When recalling "VS Code preferences", the system should also surface related memories about "editor settings", "development tools", "coding workflow". This requires **graph traversal**, not just embedding similarity.

3. **Forgetting Curve**: Memories not accessed should decay in relevance over time. The current system has TTLs (72h, 30d) but no actual decay function applied to search scores.

4. **Memory Interference**: When new contradictory information arrives ("I switched from VS Code to Neovim"), the old memory should be marked as superseded. Graphiti supports edge invalidation, but it's not exposed.

5. **Context-Dependent Recall**: Recall accuracy should depend on the current context — at work vs. personal, coding vs. writing, etc. The current system searches all memories equally.

6. **Metacognition**: The agent should know what it knows and what it doesn't. A "confidence" score on recall results would enable this.

---

## 9. Logic & Feature Improvements

### 9.1 Immediate Fixes (Required for Functionality)

#### Fix 1: Implement Stub Scoring Factors

```typescript
// checkRepetition — Query Graphiti for similar existing content
private async checkRepetition(segments: ConversationSegment[]): Promise<number> {
  const combined = segments.map(s => s.content).join(' ');
  try {
    const existing = await this.client.searchNodes(combined, 3);
    if (!existing || existing.length === 0) return 0; // Novel content
    
    // Calculate semantic overlap
    const maxSimilarity = Math.max(
      ...existing.map(r => this.textSimilarity(combined, r.summary || r.name || ''))
    );
    return Math.round(maxSimilarity * 10); // 0-10
  } catch {
    return 3; // Default on error
  }
}

// checkNovelty — Inverse of repetition
private async checkNovelty(content: string): Promise<number> {
  const repetition = await this.checkRepetition([{ content, role: 'user' }]);
  return 10 - repetition; // High novelty = low repetition
}

// checkContextAnchoring — Find connections to existing high-value memories
private async checkContextAnchoring(content: string): Promise<number> {
  try {
    const related = await this.client.searchFacts(content, 5);
    if (!related || related.length === 0) return 0;
    return Math.min(related.length * 2, 10);
  } catch {
    return 3;
  }
}
```

#### Fix 2: Store Tier Metadata as Structured Data

Instead of prepending `[EPHEMERAL]` to the text, use Graphiti's entity properties:

```typescript
async function storeWithMetadata(
  client: GraphitiClient,
  segments: ConversationSegment[],
  sessionId: string,
  scoreResult: ScoringResult
): Promise<void> {
  const conversation = segments.map(s => `${s.role}: ${s.content}`).join('\n\n');
  
  // Include metadata in a structured format that Graphiti can extract as entities
  const enrichedContent = JSON.stringify({
    conversation,
    metadata: {
      importance_score: scoreResult.score,
      memory_tier: scoreResult.tier,
      expires_at: scoreResult.expiresInHours 
        ? new Date(Date.now() + scoreResult.expiresInHours * 3600000).toISOString()
        : null,
      scoring_reasoning: scoreResult.reasoning,
      session_id: sessionId,
      created_at: new Date().toISOString()
    }
  });

  await client.addEpisode(enrichedContent, `session-${sessionId}-${Date.now()}`);
}
```

#### Fix 3: Implement Ephemeral Cleanup

```typescript
async cleanupExpiredMemories(): Promise<{ deleted: number; upgraded: number }> {
  let deleted = 0;
  let upgraded = 0;
  
  try {
    // Search for ephemeral memories
    const episodes = await this.client.getEpisodes(50);
    const now = Date.now();
    
    for (const episode of episodes) {
      // Check if episode content contains metadata with expiry
      try {
        const data = JSON.parse(episode.content);
        if (data.metadata?.expires_at) {
          const expiresAt = new Date(data.metadata.expires_at).getTime();
          if (now > expiresAt) {
            // Check if it was reinforced (referenced recently)
            const reinforced = await this.checkIfReinforced(episode);
            if (reinforced) {
              // Upgrade to silent tier instead of deleting
              upgraded++;
            } else {
              await this.client.deleteEpisode(episode.uuid);
              deleted++;
            }
          }
        }
      } catch {
        // Not structured metadata — skip
      }
    }
  } catch (err) {
    console.error('[MemoryScorer] Cleanup error:', err);
  }
  
  return { deleted, upgraded };
}
```

### 9.2 Feature Improvements

#### Feature 1: `memory_list` Tool

Users currently cannot discover what memories exist. Add a browsing tool:

```typescript
api.registerTool({
  name: 'memory_list',
  label: 'Memory List',
  description: 'List recent memories with their importance scores.',
  parameters: Type.Object({
    limit: Type.Optional(Type.Number({ default: 10 })),
    tier: Type.Optional(Type.String({ 
      description: 'Filter by tier: explicit, silent, ephemeral, or all',
      default: 'all'
    }))
  }),
  async execute(toolCallId: string, params: { limit?: number; tier?: string }) {
    const episodes = await client.getEpisodes(params.limit || 10);
    // Format and filter by tier...
  }
});
```

#### Feature 2: `memory_update` Tool

Allow modifying existing memories without delete+recreate:

```typescript
api.registerTool({
  name: 'memory_update',
  label: 'Memory Update',
  description: 'Update or correct an existing memory.',
  parameters: Type.Object({
    uuid: Type.String({ description: 'UUID of memory to update' }),
    content: Type.String({ description: 'Updated content' })
  }),
  async execute(toolCallId: string, params: { uuid: string; content: string }) {
    // Delete old, store corrected version
    await client.deleteEpisode(params.uuid);
    const result = await client.addEpisode(params.content);
    return { content: [{ type: 'text', text: `Memory updated (new ID: ${result.uuid})` }] };
  }
});
```

#### Feature 3: Semantic Deduplication Before Storage

```typescript
async function shouldStore(client: GraphitiClient, content: string): Promise<boolean> {
  const existing = await client.searchNodes(content, 3);
  if (!existing || existing.length === 0) return true;
  
  // If highly similar content already exists, skip
  const isDuplicate = existing.some(r => {
    const similarity = computeJaccardSimilarity(content, r.summary || '');
    return similarity > 0.8;
  });
  
  return !isDuplicate;
}
```

#### Feature 4: Multi-Query Recall (Associative)

Instead of single-query recall, decompose the prompt into multiple semantic queries:

```typescript
async function associativeRecall(
  client: GraphitiClient, 
  prompt: string, 
  limit: number
): Promise<SearchResult[]> {
  // Primary: direct semantic match
  const primary = await client.searchNodes(prompt, limit);
  
  // Secondary: search for facts related to entities in primary results
  const entityNames = primary.map(r => r.name).filter(Boolean);
  const secondaryResults: SearchResult[] = [];
  
  for (const entity of entityNames.slice(0, 3)) {
    const related = await client.searchFacts(entity, 2);
    secondaryResults.push(...related);
  }
  
  // Merge and deduplicate
  const allResults = [...primary, ...secondaryResults];
  const seen = new Set<string>();
  return allResults.filter(r => {
    if (seen.has(r.uuid)) return false;
    seen.add(r.uuid);
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

## 10. Generalization Strategy (Backend-Agnostic)

### 10.1 Adapter Pattern for Backend Independence

To support multiple backends (Graphiti, Neo4j direct, FalkorDB, SQLite, Qdrant, etc.), introduce an **abstraction layer**:

```typescript
// src/adapters/memory-adapter.ts
export interface MemoryAdapter {
  // Core CRUD
  store(content: string, metadata: MemoryMetadata): Promise<string>; // returns UUID
  recall(query: string, options: RecallOptions): Promise<MemoryResult[]>;
  forget(id: string): Promise<void>;
  update(id: string, content: string, metadata?: Partial<MemoryMetadata>): Promise<void>;
  
  // Search variants
  searchSemantic(query: string, limit: number): Promise<MemoryResult[]>;
  searchByEntity(entityName: string, limit: number): Promise<MemoryResult[]>;
  searchByTimeRange(start: Date, end: Date): Promise<MemoryResult[]>;
  
  // Graph operations (optional — not all backends support)
  getRelated?(id: string, depth: number): Promise<MemoryResult[]>;
  getEntityNetwork?(entityName: string): Promise<EntityGraph>;
  
  // Lifecycle
  healthCheck(): Promise<boolean>;
  cleanup(olderThan: Date): Promise<number>;
  
  // Metadata
  getStats(): Promise<MemoryStats>;
}

export interface MemoryMetadata {
  tier: 'explicit' | 'silent' | 'ephemeral';
  score: number;
  expiresAt?: Date;
  sessionId?: string;
  source: 'auto_capture' | 'user_explicit' | 'agent_auto';
  tags?: string[];
}

export interface MemoryResult {
  id: string;
  content: string;
  summary?: string;
  score: number;
  metadata: MemoryMetadata;
  createdAt: Date;
  lastAccessedAt?: Date;
  accessCount: number;
}

export interface RecallOptions {
  limit: number;
  minScore?: number;
  tier?: 'explicit' | 'silent' | 'ephemeral' | 'all';
  timeRange?: { start: Date; end: Date };
  includeRelated?: boolean;
}
```

### 10.2 Backend Implementations

```
src/adapters/
├── memory-adapter.ts        # Interface definition
├── graphiti-adapter.ts      # Graphiti MCP server adapter (current)
├── neo4j-direct-adapter.ts  # Direct Neo4j Bolt driver
├── falkordb-adapter.ts      # FalkorDB adapter
├── sqlite-adapter.ts        # Lightweight SQLite + embeddings
├── qdrant-adapter.ts        # Vector-only (Qdrant)
└── in-memory-adapter.ts     # Development/testing
```

### 10.3 Configuration for Backend Selection

```json
{
  "plugins": {
    "graphiti-memory": {
      "backend": "graphiti",
      "backends": {
        "graphiti": {
          "endpoint": "http://localhost:8000",
          "groupId": "default"
        },
        "neo4j": {
          "uri": "bolt://localhost:7687",
          "user": "neo4j",
          "password": "secret"
        },
        "sqlite": {
          "path": "~/.openclaw/memory.db",
          "embeddingProvider": "openai"
        }
      }
    }
  }
}
```

---

## 11. Publishability Assessment

### 11.1 Checklist for Publication

| Item | Status | Priority |
|------|--------|----------|
| ❌ **LICENSE file** (MIT/Apache-2.0) | Missing | CRITICAL |
| ❌ **Tests** (unit + integration) | None | CRITICAL |
| ❌ **`.env.example`** with required vars | Missing | HIGH |
| ❌ **`.gitignore`** | Missing | HIGH |
| ❌ **CI pipeline** (GitHub Actions) | Missing | HIGH |
| ❌ **Type safety** (remove all `any` types) | Not done | HIGH |
| ❌ **Delete root-level duplicate files** | Not done | HIGH |
| ✅ **README.md** with setup instructions | Present | — |
| ✅ **Docker Compose** for infrastructure | Present | — |
| ⚠️ **package.json** well-formed | Needs `repository`, `license`, `keywords` | MEDIUM |
| ⚠️ **OpenClaw plugin manifest** | Needs validation against SDK | MEDIUM |
| ❌ **CHANGELOG.md** | Missing | MEDIUM |
| ❌ **API documentation** (generated from JSDoc) | Missing | LOW |
| ❌ **Example configurations** for different setups | Partial | LOW |

### 11.2 Recommended `package.json` Updates

```json
{
  "name": "@basuru/graphiti-memory",
  "version": "0.1.0",
  "description": "Human-like agentic memory system for OpenClaw with adaptive importance scoring",
  "license": "MIT",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist/", "README.md", "LICENSE", "openclaw.plugin.json"],
  "repository": {
    "type": "git",
    "url": "https://github.com/basuru/graphiti-openclaw"
  },
  "keywords": [
    "openclaw", "memory", "graphiti", "knowledge-graph",
    "ai-agent", "temporal-memory", "neo4j", "agentic"
  ],
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src/",
    "prepublishOnly": "npm run build"
  },
  "openclaw": {
    "extensions": ["./dist/index.js"]
  }
}
```

---

## 12. Future Roadmap: Self-Managed Memory Engine

### Phase 1: Stabilize & Migrate to MCP-Native (Weeks 1-3)

- [ ] **Migrate to MCP-native** — replace `src/client.ts` HTTP proxy with `@modelcontextprotocol/sdk` client
- [ ] **Remove proxy tools** — delete `memory_recall`, `memory_store`, `memory_forget`, `memory_status` wrappers from `src/tools.ts`
- [ ] **Delete duplicate files** — remove root-level `client.ts`, `tools.ts`, `hooks.ts`, `index.ts`
- [ ] Fix OpenClaw plugin compliance (`initialize(context)` pattern)
- [ ] Implement stub scoring factors
- [ ] Add unit tests (>70% coverage)
- [ ] Add `.env.example`, LICENSE, `.gitignore`
- [ ] Implement ephemeral cleanup
- [ ] Add cognitive-only tools (`memory_consolidate`, `memory_analyze`)

### Phase 2: Backend Abstraction (Weeks 4-6)

- [ ] Design `MemoryAdapter` interface
- [ ] Refactor Graphiti client to implement adapter
- [ ] Add SQLite adapter for lightweight deployments
- [ ] Configuration-driven backend selection
- [ ] Integration tests per backend

### Phase 3: Cognitive Memory Features (Weeks 7-10)

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

```
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

```
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

| Priority | Task | Effort | Impact | Dependencies |
|----------|------|--------|--------|--------------|
| **P0** | **Migrate to MCP-native** — replace HTTP client with `@modelcontextprotocol/sdk` | M | Critical | None |
| **P0** | **Remove proxy tools** — delete wrapper tools from `src/tools.ts` | S | High | P0 MCP |
| **P0** | **Delete duplicate files** (root-level `client.ts`, `tools.ts`, `hooks.ts`, `index.ts`) | S | High | None |
| **P0** | Fix OpenClaw plugin compliance (initialize/PluginContext) | M | Critical | None |
| **P0** | Add LICENSE file | S | Critical | None |
| **P1** | Implement stub scoring factors (repetition, novelty, anchoring) | M | High | P0 MCP |
| **P1** | Implement ephemeral cleanup | M | High | P0 |
| **P1** | Add `.env.example`, `.gitignore` | S | Medium | None |
| **P1** | Add cognitive-only tools (`memory_consolidate`, `memory_analyze`) | M | High | P0 MCP |
| **P2** | Add unit tests | L | High | P0 |
| **P2** | Remove `any` types, add proper TypeScript interfaces | M | Medium | P0 |
| **P2** | Implement forgetting curve decay on recall | M | Medium | None |
| **P3** | Design `MemoryAdapter` interface | M | High | P1, P2 |
| **P3** | Add deduplication before storage | M | Medium | None |
| **P3** | Implement associative recall | L | High | P3 adapter |
| **P4** | Memory consolidation engine | XL | High | P3 |
| **P4** | Context-aware recall strategies | L | Medium | P3 |
| **P4** | SQLite adapter for lightweight mode | L | High | P3 adapter |
| **P5** | Self-managed memory engine (no Graphiti) | XXL | High | P4 |

**Effort Key:** S = <1 day, M = 1-3 days, L = 1-2 weeks, XL = 2-4 weeks, XXL = 1-2 months

---

## 15. Appendix: Reference Architecture Diagrams

### 15.1 Target Architecture (Post-Generalization)

```
┌──────────────────────────────────────────────────────────────┐
│                     OpenClaw Gateway                         │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │            Agentic Memory Plugin                     │   │
│  │                                                      │   │
│  │  ┌──────────┐  ┌──────────────┐  ┌───────────────┐ │   │
│  │  │ Tools    │  │ Hooks Layer  │  │ Memory Cortex │ │   │
│  │  │ recall   │  │ auto-recall  │  │ Scoring       │ │   │
│  │  │ store    │  │ auto-capture │  │ Consolidation │ │   │
│  │  │ forget   │  │ heartbeat    │  │ Forgetting    │ │   │
│  │  │ list     │  │              │  │ Metacognition │ │   │
│  │  │ update   │  │              │  │               │ │   │
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

```
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
2. **Clean separation of concerns** — client, tools, hooks, scorer are well-isolated
3. **Robust error handling** — graceful degradation throughout
4. **Good infrastructure setup** — Docker Compose with health checks
5. **Forward-thinking config schema** — comprehensive scoring parameters

### Critical Gaps
1. **HTTP proxy client is architectural debt** — must migrate to MCP-native (Section 4)
2. **OpenClaw plugin API mismatch** — won't load in its current form
3. **3 of 7 scoring factors are stubs** — core feature is incomplete
4. **No cleanup implementation** — ephemeral memories persist forever
5. **No tests, no CI, no LICENSE** — not publishable
6. **Duplicate file structure** — root vs src confusion

### Recommendation

**Invest in this project.** The vision is sound, the Memory Cortex concept fills a real gap in the agentic memory ecosystem, and the architecture is amenable to the backend-agnostic evolution you're planning. **First priority: migrate from HTTP proxy to MCP-native** — this eliminates 212+ lines of fragile client code, gives the agent full access to Graphiti's capabilities, and aligns with how every major AI framework handles tool communication. Then focus on the remaining P0/P1 items to get a functional, publishable v0.1, and iterate towards the cognitive memory features that will truly differentiate this from Graphiti/Mem0/Cognee.

---

*Document prepared for Lead Software Engineer review. All recommendations are based on analysis of the project codebase, OpenClaw plugin SDK documentation (DeepWiki), Graphiti GitHub repository (getzep/graphiti), and agentic memory architecture best practices.*
