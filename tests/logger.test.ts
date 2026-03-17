import { afterEach, describe, expect, it, vi } from 'vitest';

import { configureLogger, getLogger } from '../src/logger.js';

describe('logger', () => {
  afterEach(() => {
    configureLogger(undefined, 'warn');
    vi.restoreAllMocks();
  });

  it('falls back to console logging when a host logger callback throws', () => {
    const hostLogger = {
      warn: vi.fn(() => {
        throw new Error('host logger failed');
      }),
    };
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    configureLogger(hostLogger, 'warn');
    getLogger('tests').warn('host logger fallback');

    expect(hostLogger.warn).toHaveBeenCalledWith('[nuron:tests] host logger fallback');
    expect(consoleWarnSpy).toHaveBeenCalledWith('[nuron:tests] host logger fallback');
  });
});
