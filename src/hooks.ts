/**
 * Graphiti Memory Hooks for OpenClaw
 * Auto-recall and auto-capture functionality
 */

import { GraphitiClient } from './client.js';

const MIN_MESSAGE_LENGTH = 20;
const MAX_CAPTURE_MESSAGES = 15;

export function registerHooks(api: any, client: GraphitiClient, config: any) {
  
  // Auto-Recall: Before each agent turn, inject relevant context
  api.on('before_agent_start', async (event: any) => {
    if (!config.autoRecall) return;
    
    const prompt = event.prompt || '';
    if (!prompt || prompt.length < config.minPromptLength) return;

    try {
      console.log('[graphiti-memory] Auto-recall: Searching for relevant context...');
      
      const results = await client.searchNodes(prompt, config.recallMaxFacts || 5);
      
      if (!results || results.length === 0) {
        console.log('[graphiti-memory] Auto-recall: No relevant memories found');
        return;
      }

      const contextBlock = results
        .slice(0, config.recallMaxFacts || 5)
        .map((r, i) => `• ${r.summary || r.name || r.fact}`)
        .join('\n');

      console.log(`[graphiti-memory] Auto-recall: Found ${results.length} relevant memories`);

      // Inject context via prependContext
      return {
        prependContext: `<memory>\nRelevant memories:\n${contextBlock}\n</memory>`
      };
    } catch (err) {
      console.error('[graphiti-memory] Auto-recall error:', err instanceof Error ? err.message : String(err));
      // Don't fail - continue without memory
    }
  });

  // Auto-Capture: After each conversation turn
  api.on('agent_end', async (event: any) => {
    if (!config.autoCapture) return;
    
    const messages = event.messages;
    if (!messages || !Array.isArray(messages) || messages.length === 0) return;

    try {
      // Extract conversation from messages
      const conversationLines: string[] = [];
      let messageCount = 0;
      
      // Get recent messages in reverse order
      const recentMessages = [...messages].reverse();
      
      for (const msg of recentMessages) {
        if (messageCount >= MAX_CAPTURE_MESSAGES) break;
        if (!msg || typeof msg !== 'object') continue;

        const msgObj = msg as Record<string, any>;
        const role = msgObj.role;
        
        if (role !== 'user' && role !== 'assistant') continue;

        // Extract text content
        let text = '';
        const content = msgObj.content;
        if (typeof content === 'string') {
          text = content;
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if (block && typeof block === 'object' && 'type' in block && block.type === 'text') {
              text += ' ' + (block.text || '');
            }
          }
        }

        // Skip short messages and injected context
        if (!text || text.length < MIN_MESSAGE_LENGTH) continue;
        if (text.includes('<memory>') || text.includes('<relevant-memories>')) continue;

        conversationLines.push(`${role}: ${text.slice(0, 500)}`);
        messageCount++;
      }

      if (conversationLines.length === 0) {
        console.log('[graphiti-memory] Auto-capture: No meaningful messages to capture');
        return;
      }

      const conversation = conversationLines.reverse().join('\n\n');
      const sessionId = event.sessionId || 'unknown';

      console.log(`[graphiti-memory] Auto-capturing ${conversationLines.length} messages`);

      // Store to Graphiti
      await client.addEpisode(
        `[Session ${sessionId}]\n${conversation}`,
        `session-${sessionId}-${Date.now()}`
      );
      
      console.log('[graphiti-memory] Auto-capture: Conversation stored successfully');
    } catch (err) {
      console.error('[graphiti-memory] Auto-capture error:', err instanceof Error ? err.message : String(err));
      // Don't fail - continue normally
    }
  });

  console.log('[graphiti-memory] Hooks registered: before_agent_start (auto-recall), agent_end (auto-capture)');
}
