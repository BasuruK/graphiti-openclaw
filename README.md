# Graphiti OpenClaw Plugin

A temporal knowledge graph memory system for OpenClaw using Graphiti + Neo4j + OpenRouter.

## Features

- **Native Memory Tools**: `memory_recall`, `memory_store`, `memory_forget`, `memory_status`
- **Auto-Recall**: Automatically retrieves relevant memories before each response
- **Auto-Capture**: Automatically stores conversation context after each session
- **Entity Extraction**: Automatically extracts entities, facts, and relationships from conversations
- **Temporal Knowledge Graph**: Tracks when facts were true, not just what facts exist

## Architecture

```
OpenClaw Agent
    │
    ├─ Graphiti Plugin (tools + hooks)
    │
mcporter CLI → Graphiti MCP Server (Docker)
                      │
                      ├─ OpenRouter API (LLM: gpt-4o-mini)
                      ├─ OpenRouter API (Embeddings: text-embedding-3-large)
                      └─ Neo4j Database
```

## Quick Start

### 1. Start Infrastructure

```bash
cd plugin
docker compose up -d
```

This starts:
- Neo4j (ports 7474, 7687)
- Graphiti MCP Server (port 8000)

### 2. Configure mcporter

```bash
mcporter config add graphiti-memory --transport http --url "http://localhost:8000/mcp"
```

### 3. Test

```bash
# Add a memory
mcporter call graphiti-memory.add_memory name:"test" episode_body:"Basuru prefers dark mode in VS Code" group_id:"basuru"

# Search
mcporter call graphiti-memory.search_nodes query:"VS Code preferences" group_ids:"[\"basuru\"]"
```

## OpenClaw Plugin

The plugin provides:

### Tools (visible to the agent)
- `memory_recall` - Search long-term memories
- `memory_store` - Store important information
- `memory_forget` - Delete a memory
- `memory_status` - Check health

### Hooks
- `before_agent_start` - Auto-recall relevant context
- `agent_end` - Auto-capture conversation

### Installation

Copy the `plugin/` folder to your OpenClaw plugins directory:

```bash
cp -r plugin/* ~/.openclaw/plugins/graphiti-memory/
```

Or reference it in your config:

```json
{
  "plugins": {
    "entries": {
      "graphiti-memory": {
        "enabled": true,
        "config": {
          "endpoint": "http://localhost:8000",
          "groupId": "basuru",
          "autoCapture": true,
          "autoRecall": true,
          "recallMaxFacts": 5
        }
      }
    }
  }
}
```

## Configuration

### Environment Variables

Create a `.env` file:

```bash
# OpenRouter API
OPENAI_API_KEY=your-openrouter-key
OPENAI_API_URL=https://openrouter.ai/api/v1

# Neo4j
NEO4J_URI=bolt://neo4j:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=password

# Graphiti
GRAPHITI_GROUP_ID=basuru
SEMAPHORE_LIMIT=3
```

### Config File

Edit `graphiti/mcp_server/config/config-docker-neo4j.yaml`:

```yaml
llm:
  provider: "openai"
  model: "openai/gpt-4o-mini"
  providers:
    openai:
      api_key: ${OPENAI_API_KEY}
      api_url: ${OPENAI_API_URL}

embedder:
  provider: "openai"
  model: "openai/text-embedding-3-large"
  dimensions: 3072
  providers:
    openai:
      api_key: ${OPENAI_API_KEY}
      api_url: ${OPENAI_API_URL}

database:
  provider: "neo4j"
```

## License

MIT
