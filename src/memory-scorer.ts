/**
 * Memory Scorer - Adaptive Importance Scoring for Autonomous Memory
 *
 * This module analyzes conversation content and assigns importance scores,
 * determining whether memories should be stored as Explicit, Silent, or Ephemeral.
 */

import type { MemoryAdapter, MemoryDisposition, MemoryKind, MemoryResult } from './adapters/memory-adapter.js';
import { getLogger } from './logger.js';

const logger = getLogger('scorer');

/**
 * Configuration for an optional local scoring model (llama.cpp or OpenAI-compatible).
 * When configured, the scorer delegates importance evaluation to the LLM
 * instead of running heuristic checks.
 */
export interface ScoringModelConfig {
  /** 'llamacpp' for a llama.cpp server, 'openai' for OpenAI-compatible API, 'none' to disable */
  provider: 'llamacpp' | 'openai' | 'none';
  /** Model name (sent in the request body for OpenAI-compatible endpoints) */
  model?: string;
  /** Server endpoint, e.g. 'http://localhost:8080' */
  endpoint?: string;
  /** API key (required for 'openai' provider) */
  apiKey?: string;
  /** Request timeout in milliseconds (default: 10000) */
  timeoutMs?: number;
}

export interface ScoringConfig {
  enabled: boolean;
  explicitThreshold: number;      // Score >= this = Explicit (tell user)
  ephemeralThreshold: number;     // Score < this = Ephemeral (temp)
  defaultEphemeralHours: number;
  defaultSilentDays: number;
  cleanupIntervalHours: number;
  notifyOnExplicit: boolean;
  askBeforeDowngrade: boolean;

  // Conversation gating — skip scoring for trivial conversations
  minConversationLength: number;  // Min total characters across all segments
  minMessageCount: number;        // Min number of segments required

  // Default tier when scoring is disabled
  defaultTier: 'explicit' | 'silent' | 'ephemeral';

  // Optional local scoring model
  scoringModel?: ScoringModelConfig;
}

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  enabled: true,
  explicitThreshold: 8,
  ephemeralThreshold: 4,
  defaultEphemeralHours: 72,
  defaultSilentDays: 30,
  cleanupIntervalHours: 12,
  notifyOnExplicit: true,
  askBeforeDowngrade: true,
  minConversationLength: 50,
  minMessageCount: 1,
  defaultTier: 'silent',
  scoringModel: undefined,
};

export interface ScoringResult {
  score: number;                    // 0-10
  tier: 'explicit' | 'silent' | 'ephemeral';
  reasoning: string;
  expiresInHours?: number;
  disposition: MemoryDisposition;
  memoryKind: MemoryKind;
  summary: string;
  recommendedAction: 'store_explicit' | 'store_silent' | 'store_ephemeral' | 'skip';
}

export interface ConversationSegment {
  content: string;
  role: 'user' | 'assistant';
  timestamp?: Date;
  hasExplicitMarker?: boolean;     // "remember", "important", "don't forget"
}

type ConversationBreakdown = {
  orderedSegments: ConversationSegment[];
  segmentCount: number;
  userSegments: ConversationSegment[];
  assistantSegments: ConversationSegment[];
  userContent: string;
  assistantContent: string;
  fullContent: string;
  totalLength: number;
  userLength: number;
  assistantLength: number;
  userShare: number;
};

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
      logger.warn(
        `Invalid thresholds in updateConfig: ephemeralThreshold (${merged.ephemeralThreshold}) >= explicitThreshold (${merged.explicitThreshold}). Keeping previous thresholds, applying other fields.`
      );
      // Restore thresholds from previous config but apply everything else
      merged.ephemeralThreshold = this.config.ephemeralThreshold;
      merged.explicitThreshold = this.config.explicitThreshold;
    }

    this.config = merged;
  }

  /**
   * Main scoring method - analyzes conversation and returns importance score.
   *
   * Optimisation notes:
   *   1. Trivial conversations are short-circuited via minConversationLength / minMessageCount.
   *   2. When scoring is disabled, a configurable `defaultTier` is returned immediately.
   *   3. If a `scoringModel` is configured (llama.cpp / OpenAI-compatible), the LLM
   *      scores the conversation in a single request — no adapter recalls needed.
   *   4. Otherwise, a SINGLE adapter.recall() call is made and the results are shared
   *      across repetition / context-anchoring / novelty checks (previously 3 separate calls).
   */
  async scoreConversation(segments: ConversationSegment[]): Promise<ScoringResult> {
    const breakdown = this.buildConversationBreakdown(segments);
    const memoryKind = this.classifyMemoryKind(breakdown.userContent);
    const summary = this.buildMemorySummary(breakdown.userContent, memoryKind);

    // ── Disabled fast-path ──────────────────────────────────────────────
    if (!this.config.enabled) {
      const tier = this.config.defaultTier;
      const actionMap = { explicit: 'store_explicit', silent: 'store_silent', ephemeral: 'store_ephemeral' } as const;
      return {
        score: tier === 'explicit' ? 9 : tier === 'silent' ? 6 : 3,
        tier,
        reasoning: `Scoring disabled - defaulting to ${tier}`,
        disposition: tier,
        memoryKind,
        summary,
        recommendedAction: actionMap[tier]
      };
    }

    // ── Conversation gating ─────────────────────────────────────────────
    if (breakdown.userSegments.length === 0) {
      return {
        score: 1,
        tier: 'ephemeral',
        reasoning: 'No user-led content detected – skipping storage',
        disposition: 'skip',
        memoryKind,
        summary,
        recommendedAction: 'skip'
      };
    }

    if (
      breakdown.totalLength < this.config.minConversationLength ||
      breakdown.segmentCount < this.config.minMessageCount
    ) {
      // Check for explicit markers even in short messages
      if (!this.detectExplicitMarkers(breakdown.userContent)) {
        return {
          score: 2,
          tier: 'ephemeral',
          reasoning: 'Conversation too short/trivial – skipping storage',
          disposition: 'skip',
          memoryKind,
          summary,
          recommendedAction: 'skip'
        };
      }
    }

    if (breakdown.userShare < 0.25 && !this.detectExplicitMarkers(breakdown.userContent)) {
      return {
        score: 1,
        tier: 'ephemeral',
        reasoning: 'Conversation is mostly assistant response content – skipping storage',
        disposition: 'skip',
        memoryKind,
        summary,
        recommendedAction: 'skip'
      };
    }

    // ── Local model scoring (llama.cpp / OpenAI-compatible) ─────────────
    const modelCfg = this.config.scoringModel;
    if (modelCfg && modelCfg.provider !== 'none') {
      try {
        return await this.scoreWithLocalModel(breakdown, modelCfg);
      } catch (err) {
        logger.warn(`Local model scoring failed, falling back to heuristics: ${err instanceof Error ? err.message : String(err)}`);
        // Fall through to heuristic scoring
      }
    }

    // ── Heuristic scoring (single recall call) ──────────────────────────
    const hasExplicit = this.detectExplicitMarkers(breakdown.userContent);
    const hasWorkingContext = this.detectWorkingContextSignal(breakdown.userContent);
    const emotionalWeight = this.detectEmotionalContent(breakdown.userContent);
    const timeSensitivity = this.detectTimeSensitivity(breakdown.userContent);
    const futureUtility = await this.predictFutureUtility(breakdown.userContent, breakdown.userSegments);

    // ** SINGLE recall call — results shared across 3 checks **
    let recallResults: MemoryResult[] = [];
    try {
      if (breakdown.userContent.length >= 20) {
        recallResults = await this.adapter.recall(breakdown.userContent, { limit: 10 });
      }
    } catch (err) {
      logger.warn(`Batch recall failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    const repetitionScore = this.checkRepetitionFromResults(recallResults, breakdown.userSegments);
    const contextAnchoring = this.checkContextAnchoringFromResults(recallResults);
    const novelty = this.checkNoveltyFromResults(recallResults, breakdown.userContent);

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

    score = this.applyUserLedScoreAdjustments(score, breakdown, hasExplicit, memoryKind, hasWorkingContext);

    // Determine tier based on thresholds
    const tier = this.determineTier(score);
    const disposition = this.determineDisposition(score, tier, breakdown, hasExplicit, memoryKind);
    const storageTier = disposition === 'skip' ? tier : disposition;
    const recommendedAction = this.determineAction(disposition);

    return {
      score,
      tier,
      reasoning: this.generateReasoning(score, tier, {
        hasExplicit,
        hasWorkingContext,
        memoryKind,
        emotionalWeight,
        repetitionScore,
        contextAnchoring,
        timeSensitivity,
        novelty,
        futureUtility
      }),
      expiresInHours: disposition === 'skip' ? undefined : (
        storageTier === 'ephemeral' ? this.config.defaultEphemeralHours :
        storageTier === 'silent' ? this.config.defaultSilentDays * 24 : undefined
      ),
      disposition,
      memoryKind,
      summary,
      recommendedAction
    };
  }

  private buildConversationBreakdown(segments: ConversationSegment[]): ConversationBreakdown {
    const userSegments = segments.filter((segment) => segment.role === 'user');
    const assistantSegments = segments.filter((segment) => segment.role === 'assistant');
    const userContent = userSegments.map((segment) => segment.content).join('\n');
    const assistantContent = assistantSegments.map((segment) => segment.content).join('\n');
    const fullContent = segments.map((segment) => segment.content).join('\n');
    const userLength = userContent.length;
    const assistantLength = assistantContent.length;
    const totalLength = userLength + assistantLength;

    return {
      orderedSegments: segments,
      segmentCount: segments.length,
      userSegments,
      assistantSegments,
      userContent,
      assistantContent,
      fullContent,
      totalLength,
      userLength,
      assistantLength,
      userShare: totalLength > 0 ? userLength / totalLength : 0,
    };
  }

  private classifyMemoryKind(content: string): MemoryKind {
    const lowerContent = content.toLowerCase().trim();

    if (!lowerContent) {
      return 'other';
    }

    if (/\b(i prefer|i like|i dislike|i love|i hate|my preference|default to|prefer using)\b/.test(lowerContent)) {
      return 'preference';
    }

    if (/\b(we decided|decision|decided to|agreed to|final choice|settled on)\b/.test(lowerContent)) {
      return 'decision';
    }

    if (/\b(todo|task|deadline|due|next step|follow up|ship|release|remind me|must|need to)\b/.test(lowerContent)) {
      return 'task';
    }

    if (this.detectWorkingContextSignal(lowerContent)) {
      return 'working_context';
    }

    if (/\b(insight|pattern|synthesis|summary)\b/.test(lowerContent)) {
      return 'insight';
    }

    if (/\?$/.test(lowerContent) || /^(how|what|why|where|when|can|could|would|should)\b/.test(lowerContent)) {
      return 'question';
    }

    return 'fact';
  }

  private buildMemorySummary(content: string, memoryKind: MemoryKind): string {
    const cleaned = content
      .replace(/\bplease remember that\b/gi, '')
      .replace(/\bremember that\b/gi, '')
      .replace(/\bplease remember\b/gi, '')
      .replace(/\bkeep in mind that\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    const firstSentence = cleaned.split(/(?<=[.!?])\s+/)[0] || cleaned;
    const trimmed = firstSentence.length > 220 ? `${firstSentence.slice(0, 217)}...` : firstSentence;

    const prefixByKind: Record<MemoryKind, string> = {
      preference: 'Preference',
      decision: 'Decision',
      task: 'Task',
      fact: 'Fact',
      working_context: 'Working context',
      question: 'Question',
      summary: 'Summary',
      insight: 'Insight',
      other: 'Memory',
    };

    return `${prefixByKind[memoryKind]}: ${trimmed}`;
  }

  private hasDurableUserSignal(content: string): boolean {
    const lowerContent = content.toLowerCase();
    const patterns = [
      /\b(i prefer|i like|i dislike|i hate|i love|my preference|for me)\b/,
      /\b(remember|don't forget|dont forget|keep in mind|save this|store this)\b/,
      /\b(we decided|decision|plan|next step|todo|task|deadline|due|remind me|schedule|appointment)\b/,
      /\b(i need|we need|i will|we will|must|should|always|never)\b/,
    ];

    return patterns.some((pattern) => pattern.test(lowerContent));
  }

  private detectWorkingContextSignal(content: string): boolean {
    const lowerContent = content.toLowerCase();
    const patterns = [
      /\b(currently|right now|for now|this session|today|temporary|temporarily)\b/,
      /\b(working on|debugging|blocked on|current blocker|unblock|in progress)\b/,
      /\b(build is failing|tests are failing|deployment failed|release blocker|ci is failing)\b/,
      /\b(this repo|this branch|this task|this bug|this ticket|this pr)\b/,
    ];

    return patterns.some((pattern) => pattern.test(lowerContent));
  }

  private isLowValueQuery(content: string, hasWorkingContext: boolean): boolean {
    if (hasWorkingContext || this.hasDurableUserSignal(content) || this.detectExplicitMarkers(content)) {
      return false;
    }

    const lowerContent = content.toLowerCase().trim();
    const questionWord = /^(how|what|why|where|when|can|could|would|should|do|does|is|are)\b/.test(lowerContent);
    const supportTopic = /\b(openclaw|config|setting|mode|flag|option|install|setup|set up|enable|disable|command)\b/.test(lowerContent);
    const shortQuestion = lowerContent.endsWith('?') || lowerContent.split(/\s+/).length <= 18;

    return (questionWord || lowerContent.includes('help me')) && supportTopic && shortQuestion;
  }

  private applyUserLedScoreAdjustments(
    score: number,
    breakdown: ConversationBreakdown,
    hasExplicit: boolean,
    memoryKind: MemoryKind,
    hasWorkingContext: boolean
  ): number {
    let adjustedScore = score;
    const lowValueQuery = this.isLowValueQuery(breakdown.userContent, hasWorkingContext);

    if (!hasExplicit && !this.hasDurableUserSignal(breakdown.userContent) && !hasWorkingContext) {
      adjustedScore = Math.min(adjustedScore, 3);
    }

    if (!hasExplicit && lowValueQuery) {
      adjustedScore = Math.min(adjustedScore, 2);
    }

    if (!hasExplicit && memoryKind === 'question' && !hasWorkingContext) {
      adjustedScore = Math.min(adjustedScore, 2);
    }

    if (!hasExplicit && breakdown.userShare < 0.4) {
      adjustedScore = Math.min(adjustedScore, 2);
    }

    if (!hasExplicit && breakdown.assistantLength > breakdown.userLength * 1.5) {
      adjustedScore = Math.min(adjustedScore, 2);
    }

    if (hasWorkingContext) {
      adjustedScore = Math.max(adjustedScore, Math.max(1, this.config.ephemeralThreshold - 1));
    }

    return Math.max(0, Math.min(adjustedScore, 10));
  }

  private determineDisposition(
    score: number,
    tier: 'explicit' | 'silent' | 'ephemeral',
    breakdown: ConversationBreakdown,
    hasExplicit: boolean,
    memoryKind: MemoryKind,
    preferredDisposition?: MemoryDisposition
  ): MemoryDisposition {
    const hasWorkingContext = this.detectWorkingContextSignal(breakdown.userContent);

    if (preferredDisposition === 'skip') {
      return 'skip';
    }

    if (!hasExplicit && this.isLowValueQuery(breakdown.userContent, hasWorkingContext)) {
      return 'skip';
    }

    if (!hasExplicit && memoryKind === 'question' && !hasWorkingContext) {
      return 'skip';
    }

    if (preferredDisposition) {
      return preferredDisposition;
    }

    if (hasExplicit && this.hasDurableUserSignal(breakdown.userContent)) {
      return 'explicit';
    }

    if (tier === 'ephemeral') {
      return hasWorkingContext ? 'ephemeral' : 'skip';
    }

    return tier;
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
   * Check if similar content has been mentioned before.
   * Uses pre-fetched recall results (no separate adapter call).
   */
  private checkRepetitionFromResults(results: MemoryResult[], segments: ConversationSegment[]): number {
    const content = segments.map(s => s.content).join(' ');
    if (!content || content.length < 20) return 0;
    if (results.length === 0) return 0;

    const similaritySum = results.reduce((sum, r) => sum + r.relevanceScore, 0);
    const avgSimilarity = similaritySum / results.length;
    return Math.round(avgSimilarity * 10);
  }

  /**
   * Check if content connects to existing high-value memories.
   * Uses pre-fetched recall results (no separate adapter call).
   */
  private checkContextAnchoringFromResults(results: MemoryResult[]): number {
    if (results.length === 0) return 0;

    const explicitCount = results.filter(r => r.metadata.tier === 'explicit').length;
    const silentCount = results.filter(r => r.metadata.tier === 'silent').length;
    return Math.min(explicitCount * 3 + silentCount * 2, 10);
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
   * Check if content is novel or already known.
   * Uses pre-fetched recall results (no separate adapter call).
   */
  private checkNoveltyFromResults(results: MemoryResult[], content: string): number {
    if (!content || content.length < 20) return 5;
    if (results.length === 0) return 10; // Completely novel

    const similaritySum = results.reduce((sum, r) => sum + r.relevanceScore, 0);
    const avgSimilarity = similaritySum / results.length;
    return Math.round((1 - avgSimilarity) * 10);
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
  private determineAction(disposition: MemoryDisposition): ScoringResult['recommendedAction'] {
    if (disposition === 'skip') return 'skip';
    if (disposition === 'explicit') return 'store_explicit';
    if (disposition === 'silent') return 'store_silent';
    return 'store_ephemeral';
  }

  // ─── Local Model Scoring (llama.cpp / OpenAI-compatible) ──────────────

  /**
   * Score a conversation using a local LLM via llama.cpp or OpenAI-compatible API.
   *
   * Sends a structured prompt and expects a JSON response with score/tier/reasoning.
   * Falls back to heuristic scoring on any failure.
   */
  private async scoreWithLocalModel(
    breakdown: ConversationBreakdown,
    modelCfg: ScoringModelConfig
  ): Promise<ScoringResult> {
    const endpoint = modelCfg.endpoint || 'http://localhost:8080';
    const timeoutMs = modelCfg.timeoutMs ?? 10_000;

    // Build the scoring prompt
    const systemPrompt = [
      'You are a memory importance scorer. Analyze the conversation and decide how important it is to remember long-term.',
      'Return ONLY a JSON object (no markdown, no explanation outside the JSON) with these exact fields:',
      '  { "score": <number 0-10>, "tier": "explicit" | "silent" | "ephemeral", "disposition": "skip" | "explicit" | "silent" | "ephemeral", "memoryKind": "<string>", "summary": "<short string>", "reasoning": "<short string>" }',
      '',
      'Scoring rules:',
      '  - Weight USER messages heavily. Weight ASSISTANT messages lightly unless they contain a concrete decision, plan, or durable summary initiated by the user.',
      '  - Only score high when the USER initiated the topic and the content contains durable information such as preferences, explicit requests to remember, decisions, tasks, deadlines, plans, or important facts.',
      '  - ASSISTANT acknowledgements, filler, confirmations, enthusiasm, or generic helpful replies are low-value and should not raise the score.',
      '  - Internal reasoning, hidden chain-of-thought, and think blocks are never memory-worthy.',
      '  - Generic help, setup, or one-off how-to questions should usually score 0-2 and disposition "skip".',
      '  - Use disposition "ephemeral" only for short-lived but task-relevant working context.',
      `  - score >= ${this.config.explicitThreshold} → tier "explicit" only for explicit requests to remember, critical user preferences, or durable facts the assistant must retain long-term`,
      `  - score >= ${this.config.ephemeralThreshold} and < ${this.config.explicitThreshold} → tier "silent" only for meaningful user-led context that may help later but is not critical`,
      `  - score < ${this.config.ephemeralThreshold} → tier "ephemeral" for chatter, greetings, assistant-led content, or low-value exchanges`,
      '  - If the conversation is mostly assistant response text or generic assistance, keep the score between 0 and 2.',
    ].join('\n');

    const conversationText = breakdown.orderedSegments
      .map(s => `${s.role}: ${s.content}`)
      .join('\n');

    const userPrompt = [
      'Score this conversation using the rules above.',
      `User content share: ${Math.round(breakdown.userShare * 100)}%`,
      `User durable-signal heuristic: ${this.hasDurableUserSignal(breakdown.userContent) ? 'yes' : 'no'}`,
      '',
      conversationText,
    ].join('\n');

    // Both llama.cpp server and OpenAI expose /v1/chat/completions
    const url = `${endpoint.replace(/\/$/, '')}/v1/chat/completions`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (modelCfg.apiKey) {
      headers['Authorization'] = `Bearer ${modelCfg.apiKey}`;
    }

    const body = {
      model: modelCfg.model || 'default',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.1,
      max_tokens: 256,
      // llama.cpp-specific: request JSON grammar output
      response_format: { type: 'json_object' },
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`Local scoring model returned HTTP ${res.status}: ${await res.text()}`);
      }

      const json: any = await res.json();
      const content = json?.choices?.[0]?.message?.content;
      if (!content) throw new Error('Empty response from scoring model');

      // Parse the JSON response (tolerate markdown fences)
      const cleaned = content.replace(/```json\n?|```\n?/g, '').trim();
      const parsed = JSON.parse(cleaned);

      const rawScore = Math.max(0, Math.min(10, Math.round(Number(parsed.score) || 5)));

      const hasExplicit = this.detectExplicitMarkers(breakdown.userContent);
      const rawMemoryKind = typeof parsed.memoryKind === 'string'
        ? String(parsed.memoryKind).trim().toLowerCase()
        : '';
      const allowedKinds: MemoryKind[] = ['preference', 'decision', 'task', 'fact', 'working_context', 'question', 'summary', 'insight', 'other'];
      const memoryKind = allowedKinds.includes(rawMemoryKind as MemoryKind)
        ? rawMemoryKind as MemoryKind
        : this.classifyMemoryKind(breakdown.userContent);
      const summary = typeof parsed.summary === 'string' && parsed.summary.trim().length > 0
        ? parsed.summary.trim()
        : this.buildMemorySummary(breakdown.userContent, memoryKind);
      const adjustedScore = this.applyUserLedScoreAdjustments(
        rawScore,
        breakdown,
        hasExplicit,
        memoryKind,
        this.detectWorkingContextSignal(breakdown.userContent)
      );
      const adjustedTier = this.determineTier(adjustedScore);
      const disposition = this.determineDisposition(
        adjustedScore,
        adjustedTier,
        breakdown,
        hasExplicit,
        memoryKind,
        parsed.disposition as MemoryDisposition | undefined
      );

      return {
        score: adjustedScore,
        tier: adjustedTier,
        reasoning: `[LLM] ${parsed.reasoning || 'No reasoning provided'}`,
        expiresInHours: disposition === 'skip'
          ? undefined
          : adjustedTier === 'ephemeral'
            ? this.config.defaultEphemeralHours
            : adjustedTier === 'silent'
              ? this.config.defaultSilentDays * 24
              : undefined,
        disposition,
        memoryKind,
        summary,
        recommendedAction: this.determineAction(disposition),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Generate human-readable reasoning for the score
   */
  private generateReasoning(
    score: number,
    tier: string,
    factors: {
      hasExplicit: boolean;
      hasWorkingContext: boolean;
      memoryKind: MemoryKind;
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
    if (factors.hasWorkingContext) reasons.push('task-relevant working context detected');
    if (factors.memoryKind === 'question') reasons.push('generic question content is low durability');
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
    logger.info('Running cleanup of expired ephemeral memories.');

    try {
      // Use adapter's cleanup method
      const result = await this.adapter.cleanup();
      logger.info(`Cleanup complete: deleted ${result.deleted}, upgraded ${result.upgraded}.`);
      return result;
    } catch (err) {
      logger.error(`Cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
      return { deleted: 0, upgraded: 0 };
    }
  }

  /**
   * Check and upgrade memories based on reinforcement
   */
  async processReinforcements(): Promise<{ upgraded: number; downgraded: number }> {
    logger.info('Processing memory reinforcements.');

    let ephemeralMemories;
    try {
      // Get all ephemeral memories — if this fails, we can't proceed
      ephemeralMemories = await this.adapter.list(50, 'ephemeral');
    } catch (err) {
      logger.error(`Failed to list ephemeral memories: ${err instanceof Error ? err.message : String(err)}`);
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
          logger.info(`Upgraded ephemeral to silent: ${memory.id}.`);
        }
      } catch (err) {
        // Log per-memory failure and continue with remaining memories
        logger.error(`Failed to process reinforcement for memory ${memory.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    logger.info(`Reinforcement processing complete: +${upgraded} upgraded.`);
    return { upgraded, downgraded: 0 };
  }
}

/**
 * Factory function to create a MemoryScorer
 */
export function createMemoryScorer(adapter: MemoryAdapter, config?: Partial<ScoringConfig>): MemoryScorer {
  return new MemoryScorer(adapter, config);
}
