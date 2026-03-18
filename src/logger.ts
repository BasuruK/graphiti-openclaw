export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';

type HostLogger = {
  debug?: (message: string) => void;
  info?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
};

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

let currentLevel: LogLevel = 'warn';
let currentHostLogger: HostLogger | null = null;

function normalizeLogLevel(value: unknown): LogLevel {
  if (typeof value !== 'string') {
    return 'warn';
  }

  const normalized = value.toLowerCase();
  if (normalized === 'silent' || normalized === 'error' || normalized === 'warn' || normalized === 'info' || normalized === 'debug') {
    return normalized;
  }

  return 'warn';
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_ORDER[level] <= LOG_LEVEL_ORDER[currentLevel];
}

function formatMessage(scope: string, message: string): string {
  return scope === 'nuron' ? `[nuron] ${message}` : `[nuron:${scope}] ${message}`;
}

function writeToConsole(level: Exclude<LogLevel, 'silent'>, message: string): void {
  if (level === 'error') {
    console.error(message);
    return;
  }

  if (level === 'warn') {
    console.warn(message);
    return;
  }

  console.log(message);
}

function emit(level: Exclude<LogLevel, 'silent'>, scope: string, message: string): void {
  if (!shouldLog(level)) {
    return;
  }

  const formatted = formatMessage(scope, message);
  const logger = currentHostLogger;

  try {
    if (level === 'debug') {
      if (typeof logger?.debug === 'function') {
        logger.debug(formatted);
        return;
      }
      if (typeof logger?.info === 'function') {
        logger.info(formatted);
        return;
      }
    }

    if (level === 'info' && typeof logger?.info === 'function') {
      logger.info(formatted);
      return;
    }

    if (level === 'warn' && typeof logger?.warn === 'function') {
      logger.warn(formatted);
      return;
    }

    if (level === 'error' && typeof logger?.error === 'function') {
      logger.error(formatted);
      return;
    }
  } catch {
    // Fall through to console logging when host callbacks throw.
  }

  writeToConsole(level, formatted);
}

export function configureLogger(hostLogger: HostLogger | undefined, logLevel: unknown): void {
  currentHostLogger = hostLogger ?? null;
  currentLevel = normalizeLogLevel(logLevel);
}

export function getLogger(scope = 'nuron') {
  return {
    error(message: string) {
      emit('error', scope, message);
    },
    warn(message: string) {
      emit('warn', scope, message);
    },
    info(message: string) {
      emit('info', scope, message);
    },
    debug(message: string) {
      emit('debug', scope, message);
    },
  };
}
