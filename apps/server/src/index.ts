import { DatabaseSync } from '@life-logger/persistence';
import { buildApp } from './app.js';
import * as path from 'node:path';
import * as fs from 'node:fs';

const PORT = parseInt(process.env.PORT || '4000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const API_KEY = process.env.API_KEY || undefined;

const dataDir = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'life-logger.sqlite');
console.log(`[Server] Connecting to SQLite database at: ${dbPath}`);
const db = new DatabaseSync(dbPath);

const app = buildApp({ db, apiKey: API_KEY });

app.listen({ port: PORT, host: HOST }, (err, address) => {
  if (err) {
    console.error('[Server] Fatal startup error:', err);
    process.exit(1);
  }
  console.log(`[Server] Life Logger backend running at ${address}`);
  console.log(`[Server] Health check: ${address}/health`);
});
