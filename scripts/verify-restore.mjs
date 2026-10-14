import { DatabaseSync } from 'node:sqlite';
import * as path from 'node:path';

const dbPath = process.argv[2] || './sandbox_restore/restored.sqlite';
console.log(`[Verify] Inspecting restored database: ${dbPath}`);

const db = new DatabaseSync(dbPath);

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('[Verify] Tables found in restored database:', tables.map(t => t.name).join(', '));

const markerCount = db.prepare("SELECT COUNT(*) as count FROM markers").get();
console.log('[Verify] Total markers restored:', markerCount.count);

const dayCount = db.prepare("SELECT COUNT(*) as count FROM days").get();
console.log('[Verify] Total days restored:', dayCount.count);

db.close();

if (markerCount.count > 0 && dayCount.count > 0) {
  console.log('✅ RESTORE VERIFICATION TEST PASSED');
  process.exit(0);
} else {
  console.error('❌ Restore verification failed: Missing expected tables or records');
  process.exit(1);
}
