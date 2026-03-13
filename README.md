# Nuron

Nuron is a Graphiti-first memory plugin for OpenClaw. It adds an adaptive layer on top of a temporal memory graph so agents can recall prior context, auto-capture conversation history, and classify memories into explicit, silent, and ephemeral tiers.

This is a research-driven project. The current package is intended to be a workable MVP, not a finished claim of human-like cognition. The strongest honest description is: research-inspired memory heuristics layered over Graphiti-backed storage.

## What Works

- Graphiti MCP and Neo4j adapter support, with Graphiti as the intended primary path.
- Memory tools for recall, store, list, forget, status, analysis, and consolidation plumbing.
- Auto-recall hook that injects relevant memories and the Nuron memory policy before agent turns.
- Auto-capture hook that scores conversations and stores them through the plugin.
- Tiered memory classification: `explicit`, `silent`, `ephemeral`.

## What Is Still Limited

- Axon background consolidation depends on host support for an opt-in dispatch hook. The consolidation tools and persistence path are implemented, but fully autonomous background dispatch should be treated as host-dependent.
- The project is research-inspired. Do not present it as a validated simulation of human memory.
- Graphiti remains the first-class target. Other backends exist to preserve architectural flexibility, not because they are the primary shipped path.

## Installation

```bash
npm install @basuru/nuron
```

Or install through OpenClaw:

```bash
openclaw plugins install @basuru/nuron
```

## Minimal OpenClaw Config

```yaml
plugins:
  slots:
    memory: "nuron"
  entries:
    nuron:
      enabled: true
      config:
        backend: "graphiti-mcp"
        transport: "sse"
        endpoint: "http://localhost:8000/sse"
        groupId: "default"
        autoRecall: true
        autoCapture: true
        scoringEnabled: true
        axonDispatchEnabled: false
```

## Development

```bash
npm install
npm run build
npm test
```

Run the optional sleep-cycle script:

```bash
npm run sleep-cycle
```

## Publishing Notes

- `README.md`, `LICENSE`, `openclaw.plugin.json`, and the compiled `dist/` output should all be present before publishing.
- Treat Graphiti as the first-class release path.
- Keep Axon claims narrow unless host-triggered dispatch has been verified in the target OpenClaw runtime.