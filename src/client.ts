/**
 * Graphiti MCP HTTP Client
 */

export interface GraphitiConfig {
  endpoint: string;
  groupId: string;
}

export interface SearchResult {
  uuid: string;
  name: string;
  summary?: string;
  fact?: string;
  valid_at?: string;
}

export interface Episode {
  uuid: string;
  name: string;
  content: string;
  created_at: string;
}

export interface HealthStatus {
  status: string;
  service: string;
}

export class GraphitiClient {
  constructor(private config: GraphitiConfig) {}

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

  async searchNodes(query: string, limit = 5): Promise<SearchResult[]> {
    const result = await this.callTool('search_nodes', {
      group_id: this.config.groupId,
      query,
      limit
    });
    return result as SearchResult[];
  }

  async searchFacts(query: string, limit = 5): Promise<SearchResult[]> {
    const result = await this.callTool('search_facts', {
      group_id: this.config.groupId,
      query,
      limit
    });
    return result as SearchResult[];
  }

  async addEpisode(content: string, name?: string): Promise<{ uuid: string }> {
    const result = await this.callTool('add_memory', {
      group_id: this.config.groupId,
      episode_body: content,
      name: name || `episode-${Date.now()}`
    });
    return result as { uuid: string };
  }

  async getEpisodes(limit = 10): Promise<Episode[]> {
    const result = await this.callTool('get_episodes', {
      group_id: this.config.groupId,
      limit
    });
    return result as Episode[];
  }

  async deleteEpisode(uuid: string): Promise<void> {
    await this.callTool('delete_episode', {
      group_id: this.config.groupId,
      uuid
    });
  }

  async clearGraph(): Promise<void> {
    await this.callTool('clear_graph', {
      group_id: this.config.groupId
    });
  }

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
