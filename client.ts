/**
 * Graphiti MCP Client using mcporter subprocess
 */

import { spawn } from 'child_process';

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

  private async mcporterCall(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const argsList = Object.entries(args).map(([k, v]) => `${k}=${v}`);
      const proc = spawn('mcporter', ['call', `graphiti-memory.${toolName}`, ...argsList], {
        stdio: ['ignore', 'pipe', 'pipe']
      });
      
      let stdout = '';
      let stderr = '';
      
      proc.stdout.on('data', (d) => stdout += d);
      proc.stderr.on('data', (d) => stderr += d);
      
      proc.on('close', (code) => {
        if (code !== 0) {
          console.error(`[graphiti-memory] mcporter error: ${stderr}`);
          reject(new Error(`mcporter failed: ${stderr}`));
        } else {
          try {
            resolve(JSON.parse(stdout));
          } catch (e) {
            console.error(`[graphiti-memory] JSON parse error: ${stdout}`);
            reject(e);
          }
        }
      });
    });
  }

  async searchNodes(query: string, limit = 5): Promise<SearchResult[]> {
    const result = await this.mcporterCall('search_nodes', {
      group_id: this.config.groupId,
      query,
      limit
    }) as { nodes: SearchResult[] };
    return result.nodes;
  }

  async searchFacts(query: string, limit = 5): Promise<SearchResult[]> {
    const result = await this.mcporterCall('search_facts', {
      group_id: this.config.groupId,
      query,
      limit
    }) as { facts: SearchResult[] };
    return result.facts;
  }

  async addEpisode(content: string, name?: string): Promise<{ uuid: string }> {
    const result = await this.mcporterCall('add_memory', {
      group_id: this.config.groupId,
      episode_body: content,
      name: name || `episode-${Date.now()}`
    }) as { uuid: string };
    return result;
  }

  async getEpisodes(limit = 10): Promise<Episode[]> {
    const result = await this.mcporterCall('get_episodes', {
      group_id: this.config.groupId,
      limit
    }) as { episodes: Episode[] };
    return result.episodes;
  }

  async deleteEpisode(uuid: string): Promise<void> {
    await this.mcporterCall('delete_episode', {
      group_id: this.config.groupId,
      uuid
    });
  }

  async clearGraph(): Promise<void> {
    await this.mcporterCall('clear_graph', {
      group_id: this.config.groupId
    });
  }

  async healthCheck(): Promise<boolean> {
    try {
      const result = await this.mcporterCall('get_status', {}) as { status: string };
      return result.status === 'ok';
    } catch {
      return false;
    }
  }
}
