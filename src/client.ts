/**
 * Graphiti MCP HTTP Client
 * 
 * Provides a typed interface to the Graphiti MCP server for memory operations.
 */

export interface GraphitiConfig {
  /** MCP server endpoint URL */
  endpoint: string;
  /** Memory group identifier */
  groupId: string;
}

export interface SearchResult {
  /** Unique identifier for the memory node */
  uuid: string;
  /** Display name of the memory */
  name: string;
  /** Summary text of the memory */
  summary?: string;
  /** Fact statement */
  fact?: string;
  /** Validity timestamp */
  valid_at?: string;
}

export interface Episode {
  /** Unique identifier */
  uuid: string;
  /** Episode name */
  name: string;
  /** Episode content */
  content: string;
  /** Creation timestamp */
  created_at: string;
}

export interface HealthStatus {
  /** Health status string */
  status: string;
  /** Service name */
  service: string;
}

/**
 * Graphiti MCP Client
 * 
 * Handles JSON-RPC communication with the Graphiti MCP server.
 */
export class GraphitiClient {
  /**
   * Create a new Graphiti client
   * @param config - Client configuration
   */
  constructor(private config: GraphitiConfig) {}

  /**
   * Make a JSON-RPC call to the MCP server
   * @param toolName - Name of the MCP tool to call
   * @param params - Tool parameters
   * @returns Parsed response from the server
   */
  private async callTool(toolName: string, params: Record<string, unknown>): Promise<unknown> {
    const response = await fetch(`${this.config.endpoint}/mcp/`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: {
          name: toolName,
          arguments: params,
          sessionId: `oc-${Date.now()}`
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Graphiti MCP error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    if (data.error) {
      throw new Error(`Graphiti MCP error: ${data.error.message}`);
    }

    return data.result?.content?.[0]?.text 
      ? JSON.parse(data.result.content[0].text) 
      : data.result;
  }

  /**
   * Search for memory nodes by semantic query
   * @param query - Search query string
   * @param limit - Maximum results to return
   * @returns Array of matching search results
   */
  async searchNodes(query: string, limit = 5): Promise<SearchResult[]> {
    const result = await this.callTool('search_nodes', {
      group_id: this.config.groupId,
      query,
      limit
    });
    return result as SearchResult[];
  }

  /**
   * Search for specific facts within memories
   * @param query - Fact search query
   * @param limit - Maximum results
   * @returns Array of matching facts
   */
  async searchFacts(query: string, limit = 5): Promise<SearchResult[]> {
    const result = await this.callTool('search_facts', {
      group_id: this.config.groupId,
      query,
      limit
    });
    return result as SearchResult[];
  }

  /**
   * Add a new memory episode
   * @param content - Memory content to store
   * @param name - Optional name for the episode
   * @returns Object with UUID of created episode
   */
  async addEpisode(content: string, name?: string): Promise<{ uuid: string }> {
    const result = await this.callTool('add_memory', {
      group_id: this.config.groupId,
      episode_body: content,
      name: name || `episode-${Date.now()}`
    });
    return result as { uuid: string };
  }

  /**
   * Get recent episodes from memory
   * @param limit - Number of episodes to retrieve
   * @returns Array of episode objects
   */
  async getEpisodes(limit = 10): Promise<Episode[]> {
    const result = await this.callTool('get_episodes', {
      group_id: this.config.groupId,
      limit
    });
    return result as Episode[];
  }

  /**
   * Delete a specific episode by UUID
   * @param uuid - UUID of the episode to delete
   */
  async deleteEpisode(uuid: string): Promise<void> {
    await this.callTool('delete_episode', {
      group_id: this.config.groupId,
      uuid
    });
  }

  /**
   * Clear all memories for the current group
   */
  async clearGraph(): Promise<void> {
    await this.callTool('clear_graph', {
      group_id: this.config.groupId
    });
  }

  /**
   * Check if the MCP server is healthy
   * @returns True if server responds with healthy status
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.endpoint}/health`);
      const data = await response.json() as HealthStatus;
      return data.status === 'healthy';
    } catch {
      return false;
    }
  }
}
