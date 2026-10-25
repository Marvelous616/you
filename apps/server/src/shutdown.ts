export interface ClosableApp {
  close(): Promise<void>;
}

export interface ClosableDatabase {
  exec(sql: string): void;
  close(): void;
}

export interface ShutdownOptions {
  app: ClosableApp;
  db: ClosableDatabase;
  logger?: (message: string) => void;
  exit?: (code: number) => void;
  timeoutMs?: number;
}

/**
 * Stops accepting requests, drains in-flight work, checkpoints the WAL, closes
 * SQLite and exits. Repeated signals are ignored so a second Ctrl+C cannot
 * interrupt the drain.
 */
export function createShutdownHandler(options: ShutdownOptions): (signal?: string) => Promise<void> {
  const log = options.logger ?? ((message: string) => console.log(message));
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const timeoutMs = options.timeoutMs ?? 10000;
  let shuttingDown = false;

  return async (signal = 'SIGTERM'): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    log(`[Server] ${signal} received, shutting down`);
    let failed = false;

    const timeout = setTimeout(() => {
      log('[Server] Shutdown timed out, forcing exit');
      exit(1);
    }, timeoutMs);
    timeout.unref?.();

    try {
      await options.app.close();
    } catch (err) {
      failed = true;
      log(`[Server] Failed to close HTTP server: ${String(err)}`);
    }

    try {
      options.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch (err) {
      failed = true;
      log(`[Server] Failed to checkpoint WAL: ${String(err)}`);
    }

    try {
      options.db.close();
    } catch (err) {
      failed = true;
      log(`[Server] Failed to close database: ${String(err)}`);
    }

    clearTimeout(timeout);
    log(failed ? '[Server] Shutdown completed with errors' : '[Server] Shutdown complete');
    exit(failed ? 1 : 0);
  };
}
