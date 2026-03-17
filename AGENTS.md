# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

Nuron is a Graphiti-first memory plugin for OpenClaw. It adds an adaptive memory layer with auto-recall, auto-capture, and tiered memory classification (explicit, silent, ephemeral). The project uses an adapter pattern so backends can be swapped without changing hook/tool logic.

This is a research-driven project — describe it as research-inspired adaptive memory heuristics, not as validated human-brain simulation.

## Commands

```bash
npm install          # Install dependencies
npm run build       # Build TypeScript to dist/
npm run dev         # Watch mode for development
npm test            # Run vitest tests
npm run lint        # Run ESLint
npm run sleep-cycle # Run optional memory consolidation script
```

## Architecture

### Entry Point
- `src/index.ts` — Plugin initialization, config validation, adapter creation, hook/tool registration

### Core Layers
- `src/hooks.ts` — Runtime memory loop: auto-recall (injects memories before agent turn), auto-capture (scores and stores after agent end), heartbeat maintenance
- `src/tools.ts` — User/agent-facing tool surface (memory_store, memory_recall, memory_list, memory_forget, memory_status, memory_analyze, memory_consolidate). Validate tool inputs here before touching adapters.
- `src/memory-scorer.ts` — Importance scoring heuristics with fallback model integration

### Adapter Pattern
- `src/adapters/memory-adapter.ts` — Interface/contract for all storage backends
- `src/adapters/graphiti-adapter.ts` — Primary backend (MCP-native). Keep this first-class.
- `src/adapters/factory.ts` — Backend factory (currently Graphiti-only for MVP)

## Key Conventions

- **TypeScript ESM**: use `.js` extensions in local imports (e.g., `import { X } from './hooks.js'`)
- **Memory tiers**: `explicit` (persist indefinitely), `silent` (needs recall reinforcement), `ephemeral` (short-term, pruned in sleep cycle). Use `all` only for queries, not storage.
- **Validation at tool boundary**: clamp limits, reject invalid payloads in `src/tools.ts`
- **Keep storage-specific logic behind adapters**, not in hooks/tools
- **Axon background consolidation is host-dependent** — tools exist but autonomous dispatch requires verified host support
- **Align manifest** (`openclaw.plugin.json`) with runtime schema (`src/index.ts`)
- **Keep low-value chatter out of persistent storage** unless explicitly changed. The scorer skips trivial non-explicit conversations.

## Pitfalls

- The OpenClaw plugin API is project-specific and partly inferred from runtime behavior — avoid broad refactors to the plugin entry contract unless verified in the target host.
- Graphiti metadata is not as strong as a dedicated typed store — validate tier, consolidation, or relationship changes carefully.
- Auto-detection in `src/adapters/factory.ts` is Graphiti-only for MVP — keep runtime logs and error messages aligned with the actual supported path.