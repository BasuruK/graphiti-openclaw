# Graphiti OpenRouter Support - Implementation Guide

This document explains how to modify the Graphiti MCP server to support OpenRouter (or any OpenAI-compatible API) for both LLM and embeddings.

## The Problem

The Graphiti MCP server's default configuration sends API requests directly to OpenAI (`https://api.openai.com/v1`), even when you want to use OpenRouter or other OpenAI-compatible APIs.

## The Solution

You need to modify the `factories.py` file to pass the `base_url` parameter to the OpenAI client.

## File to Modify

`graphiti/mcp_server/src/services/factories.py`

### For LLM (OpenAI Provider)

Find the section that creates the OpenAI LLM client (around line 80-100):

```python
# BEFORE (broken):
llm_config = CoreLLMConfig(
    api_key=api_key,
    model=config.model,
    small_model=small_model,
    temperature=config.temperature,
    max_tokens=config.max_tokens,
)
```

Replace with:

```python
# AFTER (fixed):
llm_config = CoreLLMConfig(
    api_key=api_key,
    base_url=config.providers.openai.api_url,  # Add this line!
    model=config.model,
    small_model=small_model,
    temperature=config.temperature,
    max_tokens=config.max_tokens,
)
```

### For Embeddings (OpenAI Provider)

The embeddings factory already supports `base_url` (around line 200):

```python
embedder_config = OpenAIEmbedderConfig(
    api_key=api_key,
    embedding_model=config.model,
    base_url=config.providers.openai.api_url,  # This already works!
    embedding_dim=config.dimensions,
)
```

## Config File Format

Create or edit your config file (e.g., `config-custom.yaml`):

```yaml
server:
  transport: "http"
  port: 8000

# LLM: OpenRouter
llm:
  provider: "openai"
  model: "openai/gpt-4o-mini"  # Provider prefix required!
  
  providers:
    openai:
      api_key: ${OPENAI_API_KEY}
      api_url: ${OPENAI_API_URL}

# Embeddings: OpenRouter
embedder:
  provider: "openai"
  model: "openai/text-embedding-3-large"  # Provider prefix required!
  dimensions: 3072
  
  providers:
    openai:
      api_key: ${OPENAI_API_KEY}
      api_url: ${OPENAI_API_URL}

# Database: Neo4j or FalkorDB
database:
  provider: "neo4j"
  
  providers:
    neo4j:
      uri: ${NEO4J_URI:bolt://neo4j:7687}
      username: ${NEO4J_USER:neo4j}
      password: ${NEO4J_PASSWORD:password}
```

## Important Notes

### Model Names

When using OpenRouter or other compatible APIs, prepend the provider to the model name:
- `"openai/gpt-4o-mini"` not `"gpt-4o-mini"`
- `"openai/text-embedding-3-large"` not `"text-embedding-3-large"`

### Building Custom Image

After making the fix:

```bash
cd graphiti/mcp_server
docker build -t graphiti-mcp:custom -f docker/Dockerfile.standalone .
```

### Environment Variables

Set these in your `.env`:

```bash
# OpenRouter
OPENAI_API_KEY=sk-or-v1-xxxxx
OPENAI_API_URL=https://openrouter.ai/api/v1

# Or for other providers:
# OPENAI_API_URL=https://api.deepseek.com/v1
# OPENAI_API_URL=https://api.moonshot.cn/v1
```

## Supported Providers

This fix enables:
- **OpenRouter** - https://openrouter.ai
- **DeepSeek** - https://api.deepseek.com
- **Moonshot** (Kimi) - https://api.moonshot.cn
- **Any OpenAI-compatible API**

## Verification

Check logs for:
```
Using LLM provider: openai / openai/gpt-4o-mini
Using Embedder provider: openai
```

## Credits

Fix discovered and implemented for the Graphiti-OpenClaw plugin.
