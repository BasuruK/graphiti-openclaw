import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  registerToolsMock: vi.fn(),
  registerHooksMock: vi.fn(),
  createAdapterFromConfigMock: vi.fn(),
}));

vi.mock('../src/tools.js', () => ({
  registerTools: mocks.registerToolsMock,
}));

vi.mock('../src/hooks.js', () => ({
  registerHooks: mocks.registerHooksMock,
}));

vi.mock('../src/adapters/factory.js', () => ({
  createAdapterFromConfig: mocks.createAdapterFromConfigMock,
}));

import plugin from '../src/index.js';

describe('plugin register', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createAdapterFromConfigMock.mockResolvedValue({
      healthCheck: vi.fn().mockResolvedValue({ healthy: true, backend: 'test' }),
      shutdown: vi.fn().mockResolvedValue(undefined),
    });
  });

  it('normalizes plugin config before creating the adapter and wiring hooks', async () => {
    const api = {
      pluginConfig: {
        backend: 'invalid-backend',
        autoCapture: 'false',
        autoRecall: '1',
        recallMaxFacts: '999',
        scoringEphemeralThreshold: -1,
        scoringExplicitThreshold: 0,
        scoringModel: {
          provider: 'none',
          timeoutMs: '250',
        },
      },
      onShutdown: vi.fn(),
    };

    await plugin.register(api);

    expect(mocks.createAdapterFromConfigMock).toHaveBeenCalledWith(expect.objectContaining({
      backend: 'graphiti-mcp',
      autoCapture: false,
      autoRecall: true,
      recallMaxFacts: 20,
      scoringEphemeralThreshold: 0,
      scoringExplicitThreshold: 1,
      scoringModel: expect.objectContaining({
        provider: 'none',
        timeoutMs: 1000,
      }),
    }));
    expect(mocks.registerToolsMock).toHaveBeenCalledWith(
      api,
      expect.any(Object),
      expect.objectContaining({
        autoCapture: false,
        autoRecall: true,
        scoringEphemeralThreshold: 0,
        scoringExplicitThreshold: 1,
      })
    );
    expect(mocks.registerHooksMock).toHaveBeenCalled();
  });

  it('falls back to default scoringModel when the config value is malformed', async () => {
    const api = {
      pluginConfig: {
        scoringModel: ['invalid'],
      },
      onShutdown: vi.fn(),
    };

    await plugin.register(api);

    expect(mocks.createAdapterFromConfigMock).toHaveBeenCalledWith(expect.objectContaining({
      scoringModel: expect.objectContaining({
        provider: 'none',
        endpoint: 'http://localhost:8080',
        timeoutMs: 10000,
      }),
    }));
  });
});
