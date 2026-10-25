import { MobileStorage } from './local-store.js';
import { outboxItemsToPushRequest, PushSyncResponse } from '@life-logger/sync';

export interface SyncConfig {
  serverUrl: string;
  clientId: string;
  apiKey?: string;
}

export class MobileSyncClient {
  constructor(
    private readonly storage: MobileStorage,
    private readonly config: SyncConfig
  ) {}

  async syncNow(): Promise<{ syncedCount: number; error?: string }> {
    const pendingItems = await this.storage.getPendingOutboxItems();
    if (pendingItems.length === 0) {
      return { syncedCount: 0 };
    }

    const batchId = `batch-${Date.now()}`;
    const pushRequest = outboxItemsToPushRequest(
      this.config.clientId,
      batchId,
      pendingItems
    );

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (this.config.apiKey) {
        headers['x-api-key'] = this.config.apiKey;
      }

      const res = await fetch(`${this.config.serverUrl}/api/v1/sync/push`, {
        method: 'POST',
        headers,
        body: JSON.stringify(pushRequest),
      });

      if (!res.ok) {
        throw new Error(`Sync failed with HTTP ${res.status}: ${await res.text()}`);
      }

      const responseData = (await res.json()) as PushSyncResponse;

      if (responseData.rejected.length > 0) {
        return {
          syncedCount: 0,
          error: `Sync rejected ${responseData.rejected.length} record(s): ${responseData.rejected
            .map((item) => `${item.entityId} (${item.reason})`)
            .join(', ')}`,
        };
      }

      const syncedIds = pendingItems.map((item) => item.id);
      await this.storage.markOutboxItemsSynced(syncedIds);

      return { syncedCount: responseData.acceptedCount };
    } catch (err) {
      return {
        syncedCount: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
