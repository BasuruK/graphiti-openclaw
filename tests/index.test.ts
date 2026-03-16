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
});