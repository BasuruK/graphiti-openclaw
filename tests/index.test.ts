import { describe, expect, it } from 'vitest';

import { resolvePluginConfig } from '../src/index.js';

describe('resolvePluginConfig', () => {
  it('applies runtime defaults when OpenClaw omits plugin settings', () => {
    const config = resolvePluginConfig({});

    expect(config.transport).toBe('http');
    expect(config.endpoint).toBe('http://localhost:8000/mcp/');
    expect(config.logLevel).toBe('warn');
    expect(config.autoCapture).toBe(true);
    expect(config.autoRecall).toBe(true);
    expect(config.scoringEnabled).toBe(true);
  });

  it('preserves explicit user overrides', () => {
    const config = resolvePluginConfig({
      autoCapture: false,
      autoRecall: false,
      scoringEnabled: false,
      endpoint: 'http://localhost:8000/sse',
      transport: 'sse',
      logLevel: 'debug',
    });

    expect(config.autoCapture).toBe(false);
    expect(config.autoRecall).toBe(false);
    expect(config.scoringEnabled).toBe(false);
    expect(config.endpoint).toBe('http://localhost:8000/sse');
    expect(config.transport).toBe('sse');
    expect(config.logLevel).toBe('debug');
  });

  it('normalizes enum, boolean, and numeric overrides before runtime use', () => {
    const config = resolvePluginConfig({
      backend: 'unsupported',
      transport: 'bogus',
      logLevel: 'verbose',
      autoCapture: 'false',
      autoRecall: 0,
      scoringEnabled: '1',
      recallMaxFacts: '0',
      minPromptLength: '12',
      scoringMinMessageCount: '2',
      scoringExplicitThreshold: '9',
      scoringEphemeralThreshold: '-2',
      axonDispatchEnabled: 'yes',
    });

    expect(config.backend).toBe('graphiti-mcp');
    expect(config.transport).toBe('http');
    expect(config.logLevel).toBe('warn');
    expect(config.autoCapture).toBe(false);
    expect(config.autoRecall).toBe(false);
    expect(config.scoringEnabled).toBe(true);
    expect(config.recallMaxFacts).toBe(1);
    expect(config.minPromptLength).toBe(12);
    expect(config.scoringMinMessageCount).toBe(2);
    expect(config.scoringExplicitThreshold).toBe(9);
    expect(config.scoringEphemeralThreshold).toBe(0);
    expect(config.axonDispatchEnabled).toBe(true);
  });
});
