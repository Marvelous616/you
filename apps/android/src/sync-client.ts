import { MobileStorage } from './local-store.js';
import {
  outboxItemsToPushRequest,
  PullSyncResponse,
  PushSyncResponse,
} from '@life-logger/sync';

export interface SyncConfig {
  serverUrl: string;
  clientId: string;
  apiKey?: string;
}

export class MobileSyncClient {
  private pullCursor = '';

  constructor(
    private readonly storage: MobileStorage,
    private readonly config: SyncConfig
  ) {}

  getServerUrl(): string {
    return this.config.serverUrl;
  }

  setServerUrl(serverUrl: string): void {
    this.config.serverUrl = serverUrl;
  }

  getApiKey(): string {
    return this.config.apiKey ?? '';
  }

  setApiKey(apiKey: string | undefined): void {
    this.config.apiKey = apiKey && apiKey.length > 0 ? apiKey : undefined;
  }
  async syncNow(): Promise<{ syncedCount: number; appliedCount: number; error?: string }> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.config.apiKey) {
      headers['x-api-key'] = this.config.apiKey;
    }

    let syncedCount = 0;

    try {
      const pendingItems = await this.storage.getPendingOutboxItems();

      if (pendingItems.length > 0) {
        const batchId = `batch-${Date.now()}`;
        const pushRequest = outboxItemsToPushRequest(
          this.config.clientId,
          batchId,
          pendingItems
        );

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
            appliedCount: 0,
            error: `Sync rejected ${responseData.rejected.length} record(s): ${responseData.rejected
              .map((item) => `${item.entityId} (${item.reason})`)
              .join(', ')}`,
          };
        }

        const syncedIds = pendingItems.map((item) => item.id);
        await this.storage.markOutboxItemsSynced(syncedIds);
        syncedCount = responseData.acceptedCount;
      }

      const cursorQuery = this.pullCursor
        ? `?limit=200&cursor=${encodeURIComponent(this.pullCursor)}`
        : '?limit=200';
      const pullRes = await fetch(
        `${this.config.serverUrl}/api/v1/sync/pull${cursorQuery}`,
        { headers }
      );

      if (!pullRes.ok) {
        throw new Error(`Pull failed with HTTP ${pullRes.status}: ${await pullRes.text()}`);
      }

      const pull = (await pullRes.json()) as PullSyncResponse;
      const appliedCount = await this.storage.applyRemoteRecords(pull.records);
      if (pull.nextCursor) {
        this.pullCursor = pull.nextCursor;
      }

      return { syncedCount, appliedCount };
    } catch (err) {
      return {
        syncedCount,
        appliedCount: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
