import { afterEach, describe, expect, it, vi } from 'vitest';

describe('plugin register', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unmock('../src/adapters/factory.js');
    vi.unmock('../src/tools.js');
    vi.unmock('../src/hooks.js');
  });

  it('prefers host shutdown hooks over process-level signal handlers', async () => {
    const adapter = {
      initialize: vi.fn().mockResolvedValue(undefined),
      healthCheck: vi.fn().mockResolvedValue({ healthy: true, backend: 'test' }),
      shutdown: vi.fn().mockResolvedValue(undefined),
    };
    const create = vi.fn(() => adapter);
    const createAdapterFromConfig = vi.fn().mockResolvedValue(adapter);

    vi.doMock('../src/adapters/factory.js', () => ({
      adapterFactory: {
        create,
        autoDetect: vi.fn(),
      },
      createAdapterFromConfig,
    }));
    vi.doMock('../src/tools.js', () => ({
      registerTools: vi.fn(),
    }));
    vi.doMock('../src/hooks.js', () => ({
      registerHooks: vi.fn(),
    }));

    const processOnceSpy = vi.spyOn(process, 'once').mockImplementation(() => process as never);
    const pluginModule = await import('../src/index.js');
    const plugin = pluginModule.default;
    const onShutdown = vi.fn();
    const api = {
      pluginConfig: {},
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
      on: vi.fn(),
      onShutdown,
    };

    await plugin.register(api);

    expect(createAdapterFromConfig).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
    expect(onShutdown).toHaveBeenCalledTimes(1);
    expect(processOnceSpy).not.toHaveBeenCalled();
  });
});
