import { DatabaseSync, MIGRATIONS } from '@life-logger/persistence';
import { buildApp, readSchemaVersion } from './app.js';
import { loadConfig } from './config.js';
import { createShutdownHandler } from './shutdown.js';
import * as path from 'node:path';
import * as fs from 'node:fs';

async function main(): Promise<void> {
  const config = loadConfig();

  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

  console.log(
    `[Server] Life Logger ${config.version} starting (db=${config.dbPath}, web=${config.webDir})`
  );
  const db = new DatabaseSync(config.dbPath);

  const app = buildApp({
    db,
    apiKey: config.apiKey,
    version: config.version,
    webDir: config.webDir,
    logger: config.logLevel === 'silent' ? false : { level: config.logLevel },
  });

  const schemaVersion = readSchemaVersion(db);
  const codeSchemaVersion = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;
  console.log(`[Server] Schema version ${schemaVersion} (code supports ${codeSchemaVersion})`);
  if (schemaVersion > codeSchemaVersion) {
    console.warn(
      `[Server] Database schema ${schemaVersion} is newer than this code (${codeSchemaVersion}); continuing without downgrading`
    );
  }

  try {
    const address = await app.listen({ port: config.port, host: config.host });
    console.log(`[Server] Life Logger backend running at ${address}`);
    console.log(`[Server] Health check: ${address}/health`);
  } catch (err) {
    console.error('[Server] Fatal startup error:', err);
    db.close();
    process.exit(1);
  }

  const shutdown = createShutdownHandler({
    app,
    db,
    logger: (message) => console.log(message),
  });

  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
}

main().catch((err) => {
  console.error('[Server] Fatal startup error:', err);
  process.exit(1);
});
