# Nuron

Nuron is a Graphiti-first memory plugin for OpenClaw. It adds an adaptive layer on top of a temporal memory graph so agents can recall prior context, auto-capture conversation history, and classify memories into explicit, silent, and ephemeral tiers.

This is a research-driven project. The current package is intended to be a workable MVP, not a finished claim of human-like cognition. The strongest honest description is: research-inspired memory heuristics layered over Graphiti-backed storage.

## What Works

- Graphiti MCP as the active storage path for the MVP.
- Memory tools for recall, store, list, forget, status, analysis, and consolidation plumbing.
- Auto-recall hook that injects relevant memories and the Nuron memory policy before agent turns.
- Auto-capture hook that scores conversations and stores them through the plugin.
- Clean capture summaries with skip/ephemeral/silent/explicit dispositions.
- Tiered memory classification: `explicit`, `silent`, `ephemeral`.
- Axon daily-memory tools for same-day source gathering and Graphiti-first maintenance plans.

## What Is Still Limited

- Axon background consolidation depends on host support for an opt-in dispatch hook. The consolidation tools and persistence path are implemented, but fully autonomous background dispatch should be treated as host-dependent.
- The project is research-inspired. Do not present it as a validated simulation of human memory.
- Graphiti remains the first-class target. The adapter boundary stays in place so other backends can be revisited later without changing hook and tool logic.

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
        transport: "http"
        endpoint: "http://localhost:8000/mcp/"
        groupId: "default"
        autoRecall: true
        autoCapture: true
        scoringEnabled: true
        axonDispatchEnabled: false
        axonEnabled: true
        axonLookbackHours: 24
        axonEphemeralForgetDays: 5
        axonBatchLimit: 20
```

## Axon via OpenClaw Cron

Axon scheduling belongs in OpenClaw cron, not Nuron plugin config.
Use an isolated background job that:

1. calls `memory_axon_daily_sources`
2. plans daily store/promote/reinforce/connect/merge/prune operations
3. commits them with `memory_axon_apply_plan`

Set `axonSessionLogDir` if you want Axon to inspect OpenClaw's daily Markdown logs.
If that path is empty or unavailable, Axon falls back to graph-only mode with a warning.

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
