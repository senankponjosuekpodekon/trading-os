// Structured logger for the web frontend.
/* eslint-disable no-console */
type LogArgs = unknown[];

const isDev = process.env.NODE_ENV !== 'production';

function _log(level: string, ...args: LogArgs) {
  const [first, ...rest] = args;
  const line = JSON.stringify({
    level,
    time: new Date().toISOString(),
    message: first,
    extra: rest.length ? rest : undefined,
  });
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug: (...args: LogArgs) => { if (isDev) _log('debug', ...args); },
  info: (...args: LogArgs) => _log('info', ...args),
  warn: (...args: LogArgs) => _log('warn', ...args),
  error: (...args: LogArgs) => _log('error', ...args),
};
