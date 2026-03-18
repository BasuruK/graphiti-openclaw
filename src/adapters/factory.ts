/**
 * Adapter Factory
 *
 * Factory for creating memory adapters with auto-detection support.
 */

import {
  type MemoryAdapter,
  type BackendConfig,
  type GraphitiMCPConfig,
} from './memory-adapter.js';

import { createGraphitiMCPAdapter } from './graphiti-adapter.js';
import { getLogger } from '../logger.js';

const logger = getLogger('adapter-factory');

function inferGraphitiTransport(endpoint?: string): 'sse' | undefined {
  if (!endpoint) {
    return undefined;
  }

  return 'sse';
}

function resolveGraphitiTransport(
  transport?: 'stdio' | 'sse',
  endpoint?: string
): 'stdio' | 'sse' | undefined {
  return transport ?? inferGraphitiTransport(endpoint);
}

/**
 * Adapter Factory
 *
 * Creates appropriate adapters based on configuration and auto-detects available backends.
 */
export class AdapterFactory {
  private static supportedBackends = ['graphiti-mcp', 'falkordb', 'sqlite'];

  /**
   * Create adapter from explicit configuration
   */
  create(config: BackendConfig): MemoryAdapter {
    switch (config.type) {
      case 'graphiti-mcp':
        return createGraphitiMCPAdapter(config as GraphitiMCPConfig);

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
   * Attempts to connect to Graphiti in order of preference:
   * 1. Explicit Graphiti endpoint from config
   * 2. Graphiti endpoint from environment
   * 3. Default localhost Graphiti MCP server
   */
  async autoDetect(config?: Partial<BackendConfig>): Promise<MemoryAdapter> {
    // If explicit config provided, use it
    if (config?.type) {
      const adapter = this.create(config as BackendConfig);
      await adapter.initialize();
      return adapter;
    }

    const configuredEndpoint = (config as Partial<GraphitiMCPConfig> | undefined)?.endpoint;
    const configuredTransport = (config as Partial<GraphitiMCPConfig> | undefined)?.transport;
    const configuredGroupId = (config as Partial<GraphitiMCPConfig> | undefined)?.groupId;

    if (configuredEndpoint) {
      logger.info('Attempting configured Graphiti MCP connection.');
      const adapter = createGraphitiMCPAdapter({
        type: 'graphiti-mcp',
        transport: resolveGraphitiTransport(configuredTransport, configuredEndpoint),
        endpoint: configuredEndpoint,
        groupId: configuredGroupId || 'default',
      });

      try {
        await adapter.initialize();
        const health = await adapter.healthCheck();
        if (health.healthy) {
          return adapter;
        }
        await adapter.shutdown().catch(() => {});
      } catch (err) {
        await adapter.shutdown().catch(() => {});
        logger.warn(`Configured Graphiti MCP connection failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Check for Graphiti MCP configuration
    const graphitiEndpoint = process.env.GRAPHITI_ENDPOINT || process.env.GRAPHITI_MCP_ENDPOINT;

    if (graphitiEndpoint && graphitiEndpoint !== configuredEndpoint) {
      logger.info('Auto-detected Graphiti MCP configuration from environment.');
      const transport = process.env.GRAPHITI_TRANSPORT as 'stdio' | 'sse' | 'http' | undefined;

      const adapter = createGraphitiMCPAdapter({
        type: 'graphiti-mcp',
        transport: resolveGraphitiTransport(transport, graphitiEndpoint),
        endpoint: graphitiEndpoint,
        groupId: process.env.GRAPHITI_GROUP_ID || 'default',
      });

      try {
        await adapter.initialize();
        const health = await adapter.healthCheck();
        if (health.healthy) {
          return adapter;
        }
        await adapter.shutdown().catch(() => {});
      } catch (err) {
        await adapter.shutdown().catch(() => {});
        logger.warn(`Graphiti MCP auto-detect failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Try default Graphiti MCP
    try {
      logger.info('Attempting default Graphiti MCP connection.');
      const adapter = createGraphitiMCPAdapter({
        type: 'graphiti-mcp',
        transport: 'http',
        endpoint: 'http://localhost:8000/mcp/',
        groupId: 'default',
      });

      await adapter.initialize();
      const health = await adapter.healthCheck();
      if (health.healthy) {
        logger.info('Connected to default Graphiti MCP server.');
        return adapter;
      }
      await adapter.shutdown().catch(() => {});
    } catch (err) {
      logger.warn(`Default Graphiti MCP connection failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // No backend available - throw error with helpful message
    throw new Error(
      'No Graphiti backend detected. Please configure one of:\n' +
        '- endpoint/transport/groupId in openclaw.plugin.json\n' +
        '- GRAPHITI_ENDPOINT environment variable\n' +
        '- A local Graphiti MCP server at http://localhost:8000/mcp/\n\n' +
        'Nuron MVP no longer supports direct Neo4j connections. Run Graphiti against Neo4j and connect Nuron to Graphiti instead.'
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
    const backend = config.backend;

    // Handle string discriminator (e.g., 'neo4j', 'graphiti-mcp')
    if (typeof backend === 'string') {
      switch (backend) {
        case 'graphiti-mcp': {
          const adapter = adapterFactory.create({
            type: 'graphiti-mcp',
            transport: resolveGraphitiTransport(
              config.transport as 'stdio' | 'sse' | undefined,
              config.endpoint as string | undefined
            ),
            endpoint: (config.endpoint as string) || 'http://localhost:8000/sse',
            groupId: (config.groupId as string) || 'default',
          });
          await adapter.initialize();
          return adapter;
        }
        case 'auto':
          return adapterFactory.autoDetect({
            endpoint: config.endpoint as string | undefined,
            transport: resolveGraphitiTransport(
              config.transport as 'stdio' | 'sse' | undefined,
              config.endpoint as string | undefined
            ),
            groupId: (config.groupId as string) || 'default',
          });
        case 'neo4j':
          throw new Error(
            'The direct Neo4j backend has been removed from Nuron MVP. ' +
            'Run Graphiti against Neo4j and configure backend="graphiti-mcp" instead.'
          );
        default:
          logger.warn(`Unknown backend string '${backend}', falling back to auto-detect.`);
          return adapterFactory.autoDetect({
            endpoint: config.endpoint as string | undefined,
            transport: resolveGraphitiTransport(
              config.transport as 'stdio' | 'sse' | undefined,
              config.endpoint as string | undefined
            ),
            groupId: (config.groupId as string) || 'default',
          });
      }
    }

    // Handle full BackendConfig object
    const adapter = adapterFactory.create(backend as BackendConfig);
    await adapter.initialize();
    return adapter;
  }

  // Check for legacy Graphiti MCP config (endpoint-based)
  if (config.endpoint) {
    logger.warn('Using legacy Graphiti MCP configuration.');
    const adapter = adapterFactory.create({
      type: 'graphiti-mcp',
      transport: resolveGraphitiTransport(undefined, config.endpoint as string),
      endpoint: config.endpoint as string,
      groupId: (config.groupId as string) || 'default',
    });
    await adapter.initialize();
    return adapter;
  }

  // Legacy Neo4j config is no longer supported directly.
  if (config.neo4j) {
    throw new Error(
      'Legacy neo4j configuration is no longer supported directly. ' +
      'Run Graphiti against Neo4j and configure Nuron with Graphiti MCP settings instead.'
    );
  }

  // Try auto-detection
  return adapterFactory.autoDetect({
    endpoint: config.endpoint as string | undefined,
    transport: resolveGraphitiTransport(
      config.transport as 'stdio' | 'sse' | undefined,
      config.endpoint as string | undefined
    ),
    groupId: (config.groupId as string) || 'default',
  });
}
