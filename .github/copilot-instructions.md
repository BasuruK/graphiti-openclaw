# Project Guidelines

## Code Style

- This is a TypeScript ESM project. Keep `.js` file extensions in local imports, matching the existing source files in [src/index.ts](src/index.ts) and [src/tools.ts](src/tools.ts).
- Keep changes small and backend-aware. Prefer extending the existing adapter, hook, and tool layers rather than introducing new top-level abstractions.
- Follow the current project posture from [README.md](README.md): describe Nuron as a research-inspired adaptive memory layer, not as a proven human-brain simulation.
- Preserve Graphiti as the first-class path unless a task explicitly targets another backend.

## Architecture

- [src/index.ts](src/index.ts) is the plugin entrypoint. It validates config, creates the adapter, and registers hooks and tools.
- [src/hooks.ts](src/hooks.ts) owns the runtime memory loop: auto-recall before agent start, auto-capture after agent end, and heartbeat maintenance.
- [src/tools.ts](src/tools.ts) defines the user- and agent-facing tool surface. Validate tool inputs here before touching adapters.
- [src/memory-scorer.ts](src/memory-scorer.ts) contains the importance-scoring heuristics and fallback model integration.
- [src/adapters/memory-adapter.ts](src/adapters/memory-adapter.ts) is the contract for every backend. Keep new storage behavior behind this interface.
- [src/adapters/graphiti-adapter.ts](src/adapters/graphiti-adapter.ts) is the primary backend target. Keep the adapter boundary clean so future backends can return later without leaking storage-specific logic into hooks or tools.
- Use [docs/ARCHITECTURE-REVIEW.md](docs/ARCHITECTURE-REVIEW.md) and [docs/PUBLISHING-AND-ARCHITECTURE.md](docs/PUBLISHING-AND-ARCHITECTURE.md) for deeper background instead of duplicating that material in code comments.

## Build And Test

- Install dependencies with `npm install`.
- Build with `npm run build`.
- Run tests with `npm test`.
- Use `npm run sleep-cycle` only for the optional consolidation script path.
- When changing runtime logic in hooks, tools, scoring, or adapters, run both `npm run build` and `npm test` before considering the task done.

## Conventions

- Keep memory tier semantics consistent: `explicit`, `silent`, and `ephemeral`. `all` is valid for queries, not for storage.
- Prefer validation at the tool boundary. For example, clamp limits and reject invalid or empty consolidation payloads in [src/tools.ts](src/tools.ts).
- Keep low-value chatter out of persistent storage unless a task explicitly changes that behavior. The scorer currently skips trivial non-explicit conversations.
- Treat Axon background dispatch as host-dependent. Consolidation tools and persistence exist, but autonomous dispatch should not be assumed unless the host contract is verified.
- Do not add new backend-specific behavior directly into hooks or tools when it belongs behind the adapter interface.
- Be careful with config and plugin claims. The manifest in [openclaw.plugin.json](openclaw.plugin.json) and the runtime schema in [src/index.ts](src/index.ts) should stay aligned.

## Pitfalls

- The OpenClaw plugin API used here is project-specific and partly inferred from runtime behavior. Avoid broad refactors to the plugin entry contract unless you can verify them in the target host.
- Graphiti metadata is not as strong as a dedicated typed store. If you change tier, consolidation, or relationship behavior, validate the Graphiti adapter path carefully.
- Auto-detection in [src/adapters/factory.ts](src/adapters/factory.ts) is Graphiti-only for the MVP. If backend selection changes again, keep the runtime logs and user-facing error messages aligned with the actual supported path.