/**
 * Memory Scorer - Adaptive Importance Scoring for Autonomous Memory
 *
 * This module analyzes conversation content and assigns importance scores,
 * determining whether memories should be stored as Explicit, Silent, or Ephemeral.
 */

import type { MemoryAdapter } from './adapters/memory-adapter.js';

export interface ScoringConfig {
  enabled: boolean;
  explicitThreshold: number;      // Score >= this = Explicit (tell user)
  ephemeralThreshold: number;     // Score < this = Ephemeral (temp)
  defaultEphemeralHours: number;
  defaultSilentDays: number;
  cleanupIntervalHours: number;
  notifyOnExplicit: boolean;
  askBeforeDowngrade: boolean;
}

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  enabled: true,
  explicitThreshold: 8,
  ephemeralThreshold: 4,
  defaultEphemeralHours: 72,
  defaultSilentDays: 30,
  cleanupIntervalHours: 12,
  notifyOnExplicit: true,
  askBeforeDowngrade: true
};

export interface ScoringResult {
  score: number;                    // 0-10
  tier: 'explicit' | 'silent' | 'ephemeral';
  reasoning: string;
  expiresInHours?: number;
  recommendedAction: 'store_explicit' | 'store_silent' | 'store_ephemeral' | 'skip';
}

export interface ConversationSegment {
  content: string;
  role: 'user' | 'assistant';
  timestamp?: Date;
  hasExplicitMarker?: boolean;     // "remember", "important", "don't forget"
}

interface ScoringFactors {
  explicit_emphasis: number;
  emotional_weight: number;
  future_utility: number;
  repetition: number;
  time_sensitivity: number;
  context_anchoring: number;
  novelty: number;
}

/**
 * Memory Scorer Class
 *
 * Analyzes conversation segments and assigns importance scores.
 * Now uses MemoryAdapter interface for backend-agnostic operation.
 */
export class MemoryScorer {
  private adapter: MemoryAdapter;
  private config: ScoringConfig;

  constructor(adapter: MemoryAdapter, config: Partial<ScoringConfig> = {}) {
    this.adapter = adapter;

    // Merge with defaults and validate thresholds
    const merged = { ...DEFAULT_SCORING_CONFIG, ...config };

    // Validate: ephemeralThreshold must be < explicitThreshold
    if (merged.ephemeralThreshold >= merged.explicitThreshold) {
      throw new Error(
        `Invalid scoring thresholds: ephemeralThreshold (${merged.ephemeralThreshold}) ` +
        `must be less than explicitThreshold (${merged.explicitThreshold})`
      );
    }

    this.config = merged;
  }

  /**
   * Update configuration
   * Validates threshold invariants; if thresholds are invalid,
   * keeps existing thresholds while still applying other safe fields.
   */
  updateConfig(partial: Partial<ScoringConfig>) {
    // Merge and validate
    const merged = { ...this.config, ...partial };

    // Validate threshold invariant
    if (merged.ephemeralThreshold >= merged.explicitThreshold) {
      console.warn(
        `[MemoryScorer] Invalid thresholds in updateConfig: ephemeralThreshold (${merged.ephemeralThreshold}) >= ` +
        `explicitThreshold (${merged.explicitThreshold}). Keeping previous thresholds, applying other fields.`
      );
      // Restore thresholds from previous config but apply everything else
      merged.ephemeralThreshold = this.config.ephemeralThreshold;
      merged.explicitThreshold = this.config.explicitThreshold;
    }

    this.config = merged;
  }

  /**
   * Main scoring method - analyzes conversation and returns importance score
   */
  async scoreConversation(segments: ConversationSegment[]): Promise<ScoringResult> {
    if (!this.config.enabled) {
      return {
        score: 5,
        tier: 'silent',
        reasoning: 'Scoring disabled',
        recommendedAction: 'store_silent'
      };
    }

    const fullContent = segments.map(s => s.content).join('\n');

    // Check for explicit markers
    const hasExplicit = this.detectExplicitMarkers(fullContent);
    const emotionalWeight = this.detectEmotionalContent(fullContent);
    const repetitionScore = await this.checkRepetition(segments);
    const contextAnchoring = await this.checkContextAnchoring(fullContent);
    const timeSensitivity = this.detectTimeSensitivity(fullContent);
    const novelty = await this.checkNovelty(fullContent);
    const futureUtility = await this.predictFutureUtility(fullContent, segments);

    // Calculate weighted score
    let score = this.calculateWeightedScore({
      explicit_emphasis: hasExplicit ? 10 : 0,
      emotional_weight: emotionalWeight,
      future_utility: futureUtility,
      repetition: repetitionScore,
      time_sensitivity: timeSensitivity,
      context_anchoring: contextAnchoring,
      novelty: novelty
    });

    // Determine tier based on thresholds
    const tier = this.determineTier(score);
    const expiresInHours = tier === 'ephemeral' ? this.config.defaultEphemeralHours :
                           tier === 'silent' ? this.config.defaultSilentDays * 24 : undefined;

    const recommendedAction = this.determineAction(tier, hasExplicit);

    return {
      score,
      tier,
      reasoning: this.generateReasoning(score, tier, {
        hasExplicit,
        emotionalWeight,
        repetitionScore,
        contextAnchoring,
        timeSensitivity,
        novelty,
        futureUtility
      }),
      expiresInHours,
      recommendedAction
    };
  }

  /**
   * Detect explicit importance markers in text
   */
  private detectExplicitMarkers(content: string): boolean {
    const markers = [
      'remember',
      'dont forget',
      "don't forget",
      'important',
      'note that',
      'keep in mind',
      'make sure to',
      'never forget',
      'always remember',
      'will need this',
      'save this',
      'store this',
      'always',
      'never',
      'must remember',
      'critical',
      'vital',
      'essential'
    ];

    const lowerContent = content.toLowerCase();
    return markers.some(marker => lowerContent.includes(marker));
  }

  /**
   * Detect emotional content that might indicate importance
   */
  private detectEmotionalContent(content: string): number {
    const emotionalMarkers = {
      positive: ['love', 'excited', 'happy', 'great', 'awesome', 'amazing', 'fantastic', 'wonderful'],
      negative: ['hate', 'frustrated', 'annoyed', 'angry', 'upset', 'disappointed', 'sad', 'terrible'],
      preference: ['prefer', 'like', 'dislike', 'want', 'need', 'wish', 'hope', 'love', 'hate'],
      concern: ['worried', 'concerned', 'afraid', 'scared', 'nervous']
    };

    const lowerContent = content.toLowerCase();
    let score = 0;

    // Strong emotions (preferences, frustrations) are important
    for (const word of emotionalMarkers.preference) {
      if (lowerContent.includes(word)) score += 2;
    }
    for (const word of emotionalMarkers.negative) {
      if (lowerContent.includes(word)) score += 2;
    }
    for (const word of emotionalMarkers.concern) {
      if (lowerContent.includes(word)) score += 3;
    }
    for (const word of emotionalMarkers.positive) {
      if (lowerContent.includes(word)) score += 1;
    }

    return Math.min(score, 10);
  }

  /**
   * Check if similar content has been mentioned before
   * FIXED: Actually queries the adapter for existing memories
   */
  private async checkRepetition(segments: ConversationSegment[]): Promise<number> {
    const content = segments.map(s => s.content).join(' ');
    if (!content || content.length < 20) return 0;

    try {
      const results = await this.adapter.recall(content, { limit: 10 });
      if (results.length === 0) return 0;

      // Calculate semantic similarity
      // More similar memories = more repetition = lower importance for new storage
      // Return score 0-10 (high repetition = high score)
      const similaritySum = results.reduce((sum, r) => sum + r.relevanceScore, 0);
      const avgSimilarity = similaritySum / results.length;

      return Math.round(avgSimilarity * 10);
    } catch (err) {
      console.warn('[MemoryScorer] Repetition check failed:', err);
      return 3; // Default middle score on error
    }
  }

  /**
   * Check if content connects to existing high-value memories
   * FIXED: Actually queries the adapter
   */
  private async checkContextAnchoring(content: string): Promise<number> {
    if (!content || content.length < 20) return 0;

    try {
      const results = await this.adapter.recall(content, { limit: 10 });
      if (results.length === 0) return 0;

      // Check for explicit tier memories (high-value)
      const explicitCount = results.filter(r => r.metadata.tier === 'explicit').length;
      const silentCount = results.filter(r => r.metadata.tier === 'silent').length;

      // More related memories = stronger anchoring = higher importance
      return Math.min(explicitCount * 3 + silentCount * 2, 10);
    } catch (err) {
      console.warn('[MemoryScorer] Context anchoring check failed:', err);
      return 3;
    }
  }

  /**
   * Detect time-sensitive information
   */
  private detectTimeSensitivity(content: string): number {
    const timeMarkers = {
      urgent: ['urgent', 'asap', 'immediately', 'right now', 'emergency', 'critical'],
      deadline: ['deadline', 'due', 'by monday', 'by friday', 'by tomorrow', 'end of day', 'eod'],
      future: ['tomorrow', 'today', 'next week', 'upcoming', 'soon', 'this month', 'next month', 'schedule', 'remind me'],
      recurring: ['every week', 'daily', 'weekly', 'monthly', 'recurring', 'always']
    };

    const lowerContent = content.toLowerCase();
    let score = 0;

    for (const word of timeMarkers.urgent) {
      if (lowerContent.includes(word)) score += 3;
    }
    for (const word of timeMarkers.deadline) {
      if (lowerContent.includes(word)) score += 3;
    }
    for (const word of timeMarkers.future) {
      if (lowerContent.includes(word)) score += 2;
    }
    for (const word of timeMarkers.recurring) {
      if (lowerContent.includes(word)) score += 2;
    }

    return Math.min(score, 10);
  }

  /**
   * FIXED: Check if content is novel or already known
   * Now actually compares against existing memories
   */
  private async checkNovelty(content: string): Promise<number> {
    if (!content || content.length < 20) return 5;

    try {
      const results = await this.adapter.recall(content, { limit: 5 });
      if (results.length === 0) return 10; // Completely novel

      // Calculate average similarity
      const similaritySum = results.reduce((sum, r) => sum + r.relevanceScore, 0);
      const avgSimilarity = similaritySum / results.length;

      // Novelty is inverse of similarity
      return Math.round((1 - avgSimilarity) * 10);
    } catch (err) {
      console.warn('[MemoryScorer] Novelty check failed:', err);
      return 5; // Default to medium novelty
    }
  }

  /**
   * FIXED: Predict future utility of content
   * Analyzes content for indicators that it will be useful in the future
   */
  private async predictFutureUtility(
    content: string,
    segments: ConversationSegment[]
  ): Promise<number> {
    if (!content || content.length < 20) return 5;

    const utilityIndicators = {
      high: [
        'preference', 'prefer', 'like', 'dislike', 'love', 'hate',
        'password', 'credentials', 'login', 'account',
        'project', 'goal', 'objective',
        'meeting', 'schedule', 'appointment',
        'configuration', 'config', 'setup', 'install'
      ],
      medium: [
        'information', 'fact', 'detail', 'remember', 'note',
        'work', 'task', 'todo',
        'learn', 'study', 'research'
      ],
      low: [
        'hello', 'hi', 'thanks', 'thank you', 'okay', 'sure',
        'question', 'what', 'how', 'why'
      ]
    };

    const lowerContent = content.toLowerCase();
    let score = 5;

    // Check for high-utility indicators
    for (const word of utilityIndicators.high) {
      if (lowerContent.includes(word)) {
        score += 2;
        break;
      }
    }

    // Check for medium-utility indicators
    for (const word of utilityIndicators.medium) {
      if (lowerContent.includes(word)) {
        score += 1;
        break;
      }
    }

    // Check for low-utility indicators
    for (const word of utilityIndicators.low) {
      if (lowerContent === word || lowerContent.startsWith(word + ' ')) {
        score -= 2;
        break;
      }
    }

    // Consider conversation length - longer conversations often contain useful info
    if (segments.length > 3) {
      score += 1;
    }

    return Math.max(0, Math.min(score, 10));
  }

  /**
   * Calculate weighted importance score
   */
  private calculateWeightedScore(factors: ScoringFactors): number {
    const weights = {
      explicit_emphasis: 2.0,
      emotional_weight: 1.5,
      future_utility: 1.8,
      repetition: 1.3,
      time_sensitivity: 1.5,
      context_anchoring: 1.2,
      novelty: 1.0
    };

    const weightedSum =
      factors.explicit_emphasis * weights.explicit_emphasis +
      factors.emotional_weight * weights.emotional_weight +
      factors.future_utility * weights.future_utility +
      factors.repetition * weights.repetition +
      factors.time_sensitivity * weights.time_sensitivity +
      factors.context_anchoring * weights.context_anchoring +
      factors.novelty * weights.novelty;

    const maxPossible =
      10 * weights.explicit_emphasis +
      10 * weights.emotional_weight +
      10 * weights.future_utility +
      10 * weights.repetition +
      10 * weights.time_sensitivity +
      10 * weights.context_anchoring +
      10 * weights.novelty;

    // Normalize to 0-10
    return Math.min(Math.round((weightedSum / maxPossible) * 10), 10);
  }

  /**
   * Determine memory tier based on score
   */
  private determineTier(score: number): 'explicit' | 'silent' | 'ephemeral' {
    if (score >= this.config.explicitThreshold) return 'explicit';
    if (score >= this.config.ephemeralThreshold) return 'silent';
    return 'ephemeral';
  }

  /**
   * Determine recommended action based on tier
   */
  private determineAction(tier: 'explicit' | 'silent' | 'ephemeral', hasExplicit: boolean): ScoringResult['recommendedAction'] {
    if (tier === 'explicit' || hasExplicit) return 'store_explicit';
    if (tier === 'silent') return 'store_silent';
    return 'store_ephemeral';
  }

  /**
   * Generate human-readable reasoning for the score
   */
  private generateReasoning(
    score: number,
    tier: string,
    factors: {
      hasExplicit: boolean;
      emotionalWeight: number;
      repetitionScore: number;
      contextAnchoring: number;
      timeSensitivity: number;
      novelty: number;
      futureUtility: number;
    }
  ): string {
    const reasons: string[] = [];

    if (factors.hasExplicit) reasons.push('user explicitly asked to remember');
    if (factors.emotionalWeight > 3) reasons.push('emotional/preference content detected');
    if (factors.repetitionScore > 5) reasons.push('repeated information');
    if (factors.repetitionScore < 3) reasons.push('new, unique information');
    if (factors.contextAnchoring > 5) reasons.push('connects to existing memories');
    if (factors.timeSensitivity > 3) reasons.push('time-sensitive information');
    if (factors.novelty > 7) reasons.push('novel information');
    if (factors.futureUtility > 7) reasons.push('high future utility predicted');
    if (factors.futureUtility < 3) reasons.push('low future utility');

    if (reasons.length === 0) reasons.push('routine conversation');

    return `Score ${score}/10 (${tier}): ${reasons.join(', ')}`;
  }

  /**
   * Cleanup ephemeral memories that have expired
   */
  async cleanupExpiredMemories(): Promise<{ deleted: number; upgraded: number }> {
    console.log('[MemoryScorer] Running cleanup of expired ephemeral memories...');

    try {
      // Use adapter's cleanup method
      const result = await this.adapter.cleanup();
      console.log(`[MemoryScorer] Cleanup complete: deleted ${result.deleted}, upgraded ${result.upgraded}`);
      return result;
    } catch (err) {
      console.error('[MemoryScorer] Cleanup failed:', err);
      return { deleted: 0, upgraded: 0 };
    }
  }

  /**
   * Check and upgrade memories based on reinforcement
   */
  async processReinforcements(): Promise<{ upgraded: number; downgraded: number }> {
    console.log('[MemoryScorer] Processing memory reinforcements...');

    let ephemeralMemories;
    try {
      // Get all ephemeral memories — if this fails, we can't proceed
      ephemeralMemories = await this.adapter.list(50, 'ephemeral');
    } catch (err) {
      console.error('[MemoryScorer] Failed to list ephemeral memories:', err);
      return { upgraded: 0, downgraded: 0 };
    }

    let upgraded = 0;

    for (const memory of ephemeralMemories) {
      try {
        // Check if memory has been reinforced (referenced in recent recalls)
        const related = await this.adapter.getRelated(memory.id, 1);

        if (related.length > 0) {
          // Upgrade to silent tier
          await this.adapter.update(memory.id, memory.content, {
            ...memory.metadata,
            tier: 'silent',
          });
          upgraded++;
          console.log(`[MemoryScorer] Upgraded ephemeral to silent: ${memory.id}`);
        }
      } catch (err) {
        // Log per-memory failure and continue with remaining memories
        console.error(`[MemoryScorer] Failed to process reinforcement for memory ${memory.id}:`, err);
      }
    }

    console.log(`[MemoryScorer] Reinforcement processing complete: +${upgraded} upgraded`);
    return { upgraded, downgraded: 0 };
  }
}

/**
 * Factory function to create a MemoryScorer
 */
export function createMemoryScorer(adapter: MemoryAdapter, config?: Partial<ScoringConfig>): MemoryScorer {
  return new MemoryScorer(adapter, config);
}
