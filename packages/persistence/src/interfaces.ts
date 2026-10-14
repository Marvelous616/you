import { Marker, Day, UUID } from '@life-logger/domain';

export interface CursorResult<T> {
  records: T[];
  nextCursor: string;
  hasMore: boolean;
}

export interface IMarkerRepository {
  save(marker: Marker): Promise<void>;
  saveBatch(markers: Marker[]): Promise<void>;
  findById(id: UUID): Promise<Marker | null>;
  listByDay(dayId: UUID, includeDeleted?: boolean): Promise<Marker[]>;
  listAll(includeDeleted?: boolean): Promise<Marker[]>;
  listModifiedSince(cursor: string, limit?: number): Promise<CursorResult<Marker>>;
}

export interface IDayRepository {
  save(day: Day): Promise<void>;
  findById(id: UUID): Promise<Day | null>;
  findByLocalDate(date: string): Promise<Day | null>;
  listAll(includeDeleted?: boolean): Promise<Day[]>;
  listModifiedSince(cursor: string, limit?: number): Promise<CursorResult<Day>>;
}
