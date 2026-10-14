export type EntitySyncType = 'marker' | 'day' | 'event';

export interface SyncRecordPayload<T = unknown> {
  entityType: EntitySyncType;
  entityId: string;
  data: T;
  updatedAt: string;
  isDeleted: boolean;
}

export interface PushSyncRequest {
  clientId: string;
  batchId: string;
  records: SyncRecordPayload[];
}

export interface PushSyncResponse {
  acceptedCount: number;
  rejected: Array<{ entityId: string; reason: string }>;
  serverTimestamp: string;
}

export interface PullSyncRequest {
  cursor?: string;
  limit?: number;
}

export interface PullSyncResponse {
  records: SyncRecordPayload[];
  nextCursor: string;
  hasMore: boolean;
  serverTimestamp: string;
}
