/**
 * Memory Scorer - Adaptive Importance Scoring for Autonomous Memory
 * 
 * This module analyzes conversation content and assigns importance scores,
 * determining whether memories should be stored as Explicit, Silent, or Ephemeral.
 */

import { GraphitiClient } from './client.js';

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

/**
 * Memory Scorer Class
 * 
 * Analyzes conversation segments and assigns importance scores.
 */
export class MemoryScorer {
  private client: GraphitiClient;
  private config: ScoringConfig;

  constructor(client: GraphitiClient, config: Partial<ScoringConfig> = {}) {
    this.client = client;
    
    // Merge with defaults and validate thresholds
    const merged = { ...DEFAULT_SCORING_CONFIG, ...config };
    
    // Validate: ephemeralThreshold must be < explicitThreshold
    if (merged.ephemeralThreshold >= merged.explicitThreshold) {
      console.warn('[MemoryScorer] Invalid thresholds: ephemeral >= explicit. Adjusting...');
      merged.ephemeralThreshold = Math.min(merged.ephemeralThreshold, merged.explicitThreshold - 1);
    }
    
    this.config = merged;
  }

  /**
   * Update configuration
   */
  updateConfig(partial: Partial<ScoringConfig>) {
    this.config = { ...this.config, ...partial };
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

    // Calculate weighted score
    let score = this.calculateWeightedScore({
      explicit_emphasis: hasExplicit ? 10 : 0,
      emotional_weight: emotionalWeight,
      future_utility: 5, // Default, will be refined by LLM
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
        novelty
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
      'store this'
    ];

    const lowerContent = content.toLowerCase();
    return markers.some(marker => lowerContent.includes(marker));
  }

  /**
   * Detect emotional content that might indicate importance
   */
  private detectEmotionalContent(content: string): number {
    const emotionalMarkers = {
      positive: ['love', 'excited', 'happy', 'great', 'awesome', 'amazing', 'fantastic'],
      negative: ['hate', 'frustrated', 'annoyed', 'angry', 'upset', 'disappointed'],
      preference: ['prefer', 'like', 'dislike', 'want', 'need', 'wish', 'hope']
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
    for (const word of emotionalMarkers.positive) {
      if (lowerContent.includes(word)) score += 1;
    }

    return Math.min(score, 10);
  }

  /**
   * Check if similar content has been mentioned before
   */
  private async checkRepetition(segments: ConversationSegment[]): Promise<number> {
    // This would query Graphiti for similar content
    // For now, return a default score
    // TODO: Implement actual repetition detection via Graphiti search
    return 3;
  }

  /**
   * Check if content connects to existing high-value memories
   */
  private async checkContextAnchoring(content: string): Promise<number> {
    // This would query Graphiti for related existing memories
    // TODO: Implement actual context anchoring via Graphiti search
    return 3;
  }

  /**
   * Detect time-sensitive information
   */
  private detectTimeSensitivity(content: string): number {
    const timeMarkers = [
      'tomorrow', 'today', 'next week', 'upcoming', 'deadline',
      'soon', 'asap', 'urgent', 'by monday', 'by friday',
      'this month', 'next month', 'schedule', 'remind me'
    ];

    const lowerContent = content.toLowerCase();
    let score = 0;

    for (const marker of timeMarkers) {
      if (lowerContent.includes(marker)) score += 2;
    }

    return Math.min(score, 10);
  }

  /**
   * Check if content is novel or already known
   */
  private async checkNovelty(content: string): Promise<number> {
    // This would compare against existing memories
    // Default to medium-high novelty
    return 6;
  }

  /**
   * Calculate weighted importance score
   */
  private calculateWeightedScore(factors: {
    explicit_emphasis: number;
    emotional_weight: number;
    future_utility: number;
    repetition: number;
    time_sensitivity: number;
    context_anchoring: number;
    novelty: number;
  }): number {
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
    }
  ): string {
    const reasons: string[] = [];

    if (factors.hasExplicit) reasons.push('user explicitly asked to remember');
    if (factors.emotionalWeight > 3) reasons.push('emotional/preference content detected');
    if (factors.repetitionScore > 5) reasons.push('repeated information');
    if (factors.contextAnchoring > 5) reasons.push('connects to existing memories');
    if (factors.timeSensitivity > 3) reasons.push('time-sensitive information');
    if (factors.novelty > 7) reasons.push('new, novel information');

    if (reasons.length === 0) reasons.push('routine conversation');

    return `Score ${score}/10 (${tier}): ${reasons.join(', ')}`;
  }

  /**
   * Cleanup ephemeral memories that have expired
   */
  async cleanupExpiredMemories(): Promise<{ deleted: number; upgraded: number }> {
    // This would query Graphiti for ephemeral nodes older than their expiry
    // TODO: Implement actual cleanup via Graphiti API
    console.log('[MemoryScorer] Running cleanup of expired ephemeral memories...');
    return { deleted: 0, upgraded: 0 };
  }

  /**
   * Check and upgrade/downgrade memories based on reinforcement
   */
  async processReinforcements(): Promise<{ upgraded: number; downgraded: number }> {
    // Check which ephemeral memories have been referenced
    // Upgrade if reinforced, downgrade if not
    console.log('[MemoryScorer] Processing memory reinforcements...');
    return { upgraded: 0, downgraded: 0 };
  }
}

/**
 * Factory function to create a MemoryScorer
 */
export function createMemoryScorer(client: GraphitiClient, config?: Partial<ScoringConfig>): MemoryScorer {
  return new MemoryScorer(client, config);
}
