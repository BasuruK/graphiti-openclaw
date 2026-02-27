/**
 * Adapter Factory
 *
 * Factory for creating memory adapters with auto-detection support.
 */

import {
  type MemoryAdapter,
  type BackendConfig,
  type GraphitiMCPConfig,
  type Neo4jConfig,
  type FalkorDBConfig,
  type SQLiteConfig,
} from './memory-adapter.js';

import { GraphitiMCPAdapter, createGraphitiMCPAdapter } from './graphiti-adapter.js';
import { Neo4jAdapter, createNeo4jAdapter } from './neo4j-adapter.js';

/**
 * Adapter Factory
 *
 * Creates appropriate adapters based on configuration and auto-detects available backends.
 */
export class AdapterFactory {
  private static supportedBackends = ['graphiti-mcp', 'neo4j', 'falkordb', 'sqlite'];

  /**
   * Create adapter from explicit configuration
   */
  create(config: BackendConfig): MemoryAdapter {
    switch (config.type) {
      case 'graphiti-mcp':
        return createGraphitiMCPAdapter(config as GraphitiMCPConfig);

      case 'neo4j':
        return createNeo4jAdapter(config as Neo4jConfig);

      case 'falkordb':
        // TODO: Implement FalkorDB adapter
        throw new Error('FalkorDB adapter not yet implemented');

      case 'sqlite':
        // TODO: Implement SQLite adapter
        throw new Error('SQLite adapter not yet implemented');

      default:
        throw new Error(`Unknown backend type: ${(config as BackendConfig).type}`);
    }
  }

  /**
   * Auto-detect available backends and create adapter
   *
   * Attempts to connect to backends in order of preference:
   * 1. Neo4j ( connectionif details provided)
   * 2. Graphiti MCP (if server accessible)
   */
  async autoDetect(config?: Partial<BackendConfig>): Promise<MemoryAdapter> {
    // If explicit config provided, use it
    if (config?.type) {
      const adapter = this.create(config as BackendConfig);
      await adapter.initialize();
      return adapter;
    }

    // Try to auto-detect from environment

    // Check for Neo4j environment variables
    const neo4jUri = process.env.NEO4J_URI || process.env.NEO4J_BOLT_URI;
    const neo4jUser = process.env.NEO4J_USER || process.env.NEO4J_USERNAME;
    const neo4jPassword = process.env.NEO4J_PASSWORD;

    if (neo4jUri && neo4jUser && neo4jPassword) {
      console.log('[AdapterFactory] Auto-detected Neo4j configuration from environment');
      const adapter = createNeo4jAdapter({
        type: 'neo4j',
        uri: neo4jUri,
        user: neo4jUser,
        password: neo4jPassword,
        database: process.env.NEO4J_DATABASE,
      });

      try {
        await adapter.initialize();
        const health = await adapter.healthCheck();
        if (health.healthy) {
          return adapter;
        }
      } catch (err) {
        console.warn('[AdapterFactory] Neo4j auto-detect failed:', err);
      }
    }

    // Check for Graphiti MCP configuration
    const graphitiEndpoint = process.env.GRAPHITI_ENDPOINT || process.env.GRAPHITI_MCP_ENDPOINT;

    if (graphitiEndpoint) {
      console.log('[AdapterFactory] Auto-detected Graphiti MCP configuration from environment');
      const transport = process.env.GRAPHITI_TRANSPORT as 'stdio' | 'sse' | undefined;

      const adapter = createGraphitiMCPAdapter({
        type: 'graphiti-mcp',
        transport: transport || 'sse',
        endpoint: graphitiEndpoint,
        groupId: process.env.GRAPHITI_GROUP_ID || 'default',
      });

      try {
        await adapter.initialize();
        const health = await adapter.healthCheck();
        if (health.healthy) {
          return adapter;
        }
      } catch (err) {
        console.warn('[AdapterFactory] Graphiti MCP auto-detect failed:', err);
      }
    }

    // Try default Neo4j connection (common localhost setup)
    try {
      console.log('[AdapterFactory] Attempting default Neo4j connection...');
      const adapter = createNeo4jAdapter({
        type: 'neo4j',
        uri: 'bolt://localhost:7687',
        user: 'neo4j',
        password: process.env.NEO4J_PASSWORD || 'neo4j',
      });

      await adapter.initialize();
      const health = await adapter.healthCheck();
      if (health.healthy) {
        console.log('[AdapterFactory] Connected to default Neo4j instance');
        return adapter;
      }
    } catch (err) {
      console.warn('[AdapterFactory] Default Neo4j connection failed:', err);
    }

    // Try default Graphiti MCP
    try {
      console.log('[AdapterFactory] Attempting default Graphiti MCP connection...');
      const adapter = createGraphitiMCPAdapter({
        type: 'graphiti-mcp',
        transport: 'sse',
        endpoint: 'http://localhost:8000/sse',
        groupId: 'default',
      });

      await adapter.initialize();
      const health = await adapter.healthCheck();
      if (health.healthy) {
        console.log('[AdapterFactory] Connected to default Graphiti MCP server');
        return adapter;
      }
    } catch (err) {
      console.warn('[AdapterFactory] Default Graphiti MCP connection failed:', err);
    }

    // No backend available - throw error with helpful message
    throw new Error(
      'No memory backend detected. Please configure one of:\n' +
        '- NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD environment variables\n' +
        '- GRAPHITI_ENDPOINT environment variable\n' +
        '- Explicit backend configuration in openclaw.plugin.json'
    );
  }

  /**
   * Get list of supported backend types
   */
  getSupportedBackends(): string[] {
    return [...AdapterFactory.supportedBackends];
  }

  /**
   * Validate backend configuration
   */
  validateConfig(config: Partial<BackendConfig>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!config.type) {
      errors.push('Backend type is required');
      return { valid: false, errors };
    }

    switch (config.type) {
      case 'graphiti-mcp':
        if (!config.transport) errors.push('Graphiti MCP transport is required');
        if (!config.groupId) errors.push('Graphiti MCP groupId is required');
        break;

      case 'neo4j':
        if (!config.uri) errors.push('Neo4j URI is required');
        if (!config.user) errors.push('Neo4j user is required');
        if (!config.password) errors.push('Neo4j password is required');
        break;

      case 'falkordb':
        if (!config.url) errors.push('FalkorDB URL is required');
        break;

      case 'sqlite':
        if (!config.path) errors.push('SQLite path is required');
        if (!config.embedding) errors.push('SQLite embedding configuration is required');
        break;
    }

    return { valid: errors.length === 0, errors };
  }
}

/**
 * Default adapter factory instance
 */
export const adapterFactory = new AdapterFactory();

/**
 * Create adapter from plugin configuration
 *
 * Handles backward compatibility with old configuration format
 */
export async function createAdapterFromConfig(
  config: Record<string, unknown>
): Promise<MemoryAdapter> {
  // Check for new unified config format
  if (config.backend) {
    const adapter = adapterFactory.create(config.backend as BackendConfig);
    await adapter.initialize();
    return adapter;
  }

  // Check for legacy Graphiti MCP config (endpoint-based)
  if (config.endpoint) {
    console.warn('[createAdapterFromConfig] Using legacy Graphiti MCP configuration');
    const adapter = adapterFactory.create({
      type: 'graphiti-mcp',
      transport: 'sse',
      endpoint: config.endpoint as string,
      groupId: (config.groupId as string) || 'default',
    });
    await adapter.initialize();
    return adapter;
  }

  // Check for legacy Neo4j config
  if (config.neo4j) {
    console.warn('[createAdapterFromConfig] Using legacy Neo4j configuration');
    const neo4jConfig = config.neo4j as Record<string, unknown>;
    const adapter = adapterFactory.create({
      type: 'neo4j',
      uri: neo4jConfig.uri as string,
      user: neo4jConfig.user as string,
      password: neo4jConfig.password as string,
      database: neo4jConfig.database as string | undefined,
    });
    await adapter.initialize();
    return adapter;
  }

  // Try auto-detection
  return adapterFactory.autoDetect();
}
