import { EntitySyncType, SyncRecordPayload } from './protocol.js';

export type OutboxStatus = 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED';
export type OutboxOperation = 'UPSERT' | 'DELETE';

export interface OutboxItem {
  id: string;
  entityType: EntitySyncType;
  entityId: string;
  operation: OutboxOperation;
  payloadJson: string;
  createdAt: string;
  status: OutboxStatus;
  retryCount: number;
  lastError?: string;
}

/**
 * Creates a serialized outbox item ready to be saved to client SQLite.
 */
export function createOutboxItem<T>(
  id: string,
  entityType: EntitySyncType,
  entityId: string,
  operation: OutboxOperation,
  data: T,
  updatedAt: string,
  isDeleted: boolean = false
): OutboxItem {
  const payload: SyncRecordPayload<T> = {
    entityType,
    entityId,
    data,
    updatedAt,
    isDeleted,
  };

  return {
    id,
    entityType,
    entityId,
    operation,
    payloadJson: JSON.stringify(payload),
    createdAt: new Date().toISOString(),
    status: 'PENDING',
    retryCount: 0,
  };
}

/**
 * Parses outbox items into a PushSyncRequest payload.
 */
export function outboxItemsToPushRequest(
  clientId: string,
  batchId: string,
  items: OutboxItem[]
): { clientId: string; batchId: string; records: SyncRecordPayload[] } {
  return {
    clientId,
    batchId,
    records: items.map((item) => JSON.parse(item.payloadJson) as SyncRecordPayload),
  };
}
