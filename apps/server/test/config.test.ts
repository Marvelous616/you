import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { loadConfig, resolveAppVersion } from '../src/config.js';

describe('server runtime configuration', () => {
  it('provides development defaults', () => {
    const cwd = path.resolve('C:/tmp/life-logger-config');
    const config = loadConfig({}, cwd);

    expect(config.port).toBe(4000);
    expect(config.host).toBe('0.0.0.0');
    expect(config.dbPath).toBe(path.join(cwd, 'data', 'life-logger.sqlite'));
    expect(config.webDir).toBe(path.join(cwd, 'apps', 'web', 'dist'));
    expect(config.logLevel).toBe('info');
    expect(config.apiKey).toBeUndefined();
    expect(config.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('reads every deployment setting from the environment', () => {
    const config = loadConfig(
      {
        PORT: '8080',
        HOST: '127.0.0.1',
        DB_PATH: 'var/life.db',
        WEB_DIR: 'public',
        LOG_LEVEL: 'debug',
        API_KEY: 'secret',
        APP_VERSION: 'v0.3.5-increment-3.5',
      },
      'C:/srv/life-logger'
    );

    expect(config.port).toBe(8080);
    expect(config.host).toBe('127.0.0.1');
    expect(config.dbPath).toBe(path.resolve('C:/srv/life-logger', 'var/life.db'));
    expect(config.webDir).toBe(path.resolve('C:/srv/life-logger', 'public'));
    expect(config.logLevel).toBe('debug');
    expect(config.apiKey).toBe('secret');
    expect(config.version).toBe('v0.3.5-increment-3.5');
  });

  it('keeps DATA_DIR working for local development', () => {
    const config = loadConfig({ DATA_DIR: 'local-data' }, '/srv/app');
    expect(config.dbPath).toBe(path.resolve('/srv/app', 'local-data', 'life-logger.sqlite'));
  });

  it('rejects invalid ports and log levels', () => {
    expect(() => loadConfig({ PORT: '0' }, '/srv/app')).toThrow(/Invalid PORT/);
    expect(() => loadConfig({ PORT: 'abc' }, '/srv/app')).toThrow(/Invalid PORT/);
    expect(() => loadConfig({ PORT: '70000' }, '/srv/app')).toThrow(/Invalid PORT/);
    expect(() => loadConfig({ LOG_LEVEL: 'verbose' }, '/srv/app')).toThrow(/Invalid LOG_LEVEL/);
  });

  it('prefers an explicit version and falls back safely', () => {
    expect(resolveAppVersion({ APP_VERSION: 'v9.9.9' })).toBe('v9.9.9');
    expect(resolveAppVersion({})).toMatch(/^\d+\.\d+\.\d+/);
  });
});
