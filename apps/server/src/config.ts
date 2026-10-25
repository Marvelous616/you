import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LOG_LEVELS = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export interface ServerConfig {
  port: number;
  host: string;
  dbPath: string;
  webDir: string;
  logLevel: LogLevel;
  apiKey?: string;
  version: string;
}

const DEFAULT_PORT = 4000;
const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_LOG_LEVEL: LogLevel = 'info';

/**
 * Resolves the version shown by `/health` and the web footer. A deploy passes
 * APP_VERSION from the git tag; local runs fall back to the root package.json.
 */
export function resolveAppVersion(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.APP_VERSION?.trim();
  if (override) return override;

  try {
    const packageUrl = new URL('../../../package.json', import.meta.url);
    const packagePath = fileURLToPath(packageUrl);
    const parsed = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as { version?: string };
    if (parsed.version && parsed.version.trim().length > 0) return parsed.version.trim();
  } catch {
    // A missing or unreadable package.json must not stop the server.
  }

  return '0.0.0-dev';
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_PORT;

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`Invalid PORT: ${raw}`);
  }
  return value;
}

function parseLogLevel(raw: string | undefined): LogLevel {
  if (raw === undefined || raw.trim() === '') return DEFAULT_LOG_LEVEL;

  const value = raw.trim().toLowerCase();
  if (!(LOG_LEVELS as readonly string[]).includes(value)) {
    throw new Error(`Invalid LOG_LEVEL: ${raw}. Expected one of ${LOG_LEVELS.join(', ')}`);
  }
  return value as LogLevel;
}

/**
 * Reads every runtime setting from the environment. Defaults match the
 * development setup; the deployed server overrides them in /etc/lifelogger.env.
 */
export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd()
): ServerConfig {
  const dataDir = env.DATA_DIR?.trim();
  const dbPath = env.DB_PATH?.trim()
    ? path.resolve(cwd, env.DB_PATH.trim())
    : path.resolve(cwd, dataDir && dataDir.length > 0 ? dataDir : 'data', 'life-logger.sqlite');

  const webDir = path.resolve(cwd, env.WEB_DIR?.trim() || path.join('apps', 'web', 'dist'));
  const apiKey = env.API_KEY?.trim();

  return {
    port: parsePort(env.PORT),
    host: env.HOST?.trim() || DEFAULT_HOST,
    dbPath,
    webDir,
    logLevel: parseLogLevel(env.LOG_LEVEL),
    apiKey: apiKey && apiKey.length > 0 ? apiKey : undefined,
    version: resolveAppVersion(env),
  };
}
