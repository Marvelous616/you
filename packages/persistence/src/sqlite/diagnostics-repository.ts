import { DatabaseSync } from './db.js';
import { CrashReport, PerfSample } from '@life-logger/domain';
import { IDiagnosticsRepository } from '../interfaces.js';

interface CrashReportRow {
  id: string;
  error: string;
  app_version: string;
  device_type: string;
  screen: string | null;
  created_at: string;
  updated_at: string;
  is_deleted: number;
}

function rowToCrashReport(row: CrashReportRow): CrashReport {
  return {
    id: row.id,
    error: row.error,
    appVersion: row.app_version,
    deviceType: row.device_type,
    screen: row.screen ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isDeleted: row.is_deleted === 1,
  };
}

interface PerfSampleRow {
  id: string;
  operation: string;
  duration_ms: number;
  device_type: string;
  created_at: string;
  updated_at: string;
  is_deleted: number;
}

function rowToPerfSample(row: PerfSampleRow): PerfSample {
  return {
    id: row.id,
    operation: row.operation,
    durationMs: row.duration_ms,
    deviceType: row.device_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isDeleted: row.is_deleted === 1,
  };
}

export class SqliteDiagnosticsRepository implements IDiagnosticsRepository {
  constructor(private readonly db: DatabaseSync) {}

  async saveCrashReport(report: CrashReport): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO crash_reports (
          id, error, app_version, device_type, screen, created_at, updated_at, is_deleted
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        report.id,
        report.error,
        report.appVersion,
        report.deviceType,
        report.screen ?? null,
        report.createdAt,
        report.updatedAt,
        report.isDeleted ? 1 : 0
      );
  }

  async listCrashReports(includeDeleted = false): Promise<CrashReport[]> {
    const query = includeDeleted
      ? 'SELECT * FROM crash_reports ORDER BY created_at DESC, id ASC'
      : 'SELECT * FROM crash_reports WHERE is_deleted = 0 ORDER BY created_at DESC, id ASC';
    const rows = this.db.prepare(query).all() as unknown as CrashReportRow[];
    return rows.map(rowToCrashReport);
  }

  async savePerfSample(sample: PerfSample): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO perf_samples (
          id, operation, duration_ms, device_type, created_at, updated_at, is_deleted
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        sample.id,
        sample.operation,
        sample.durationMs,
        sample.deviceType,
        sample.createdAt,
        sample.updatedAt,
        sample.isDeleted ? 1 : 0
      );
  }

  async listPerfSamples(includeDeleted = false): Promise<PerfSample[]> {
    const query = includeDeleted
      ? 'SELECT * FROM perf_samples ORDER BY created_at DESC, id ASC'
      : 'SELECT * FROM perf_samples WHERE is_deleted = 0 ORDER BY created_at DESC, id ASC';
    const rows = this.db.prepare(query).all() as unknown as PerfSampleRow[];
    return rows.map(rowToPerfSample);
  }

  async pruneOlderThan(retentionDays: number): Promise<number> {
    const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();

    const prunedCrashes = this.db
      .prepare(
        'DELETE FROM crash_reports WHERE is_deleted = 0 AND created_at < ?'
      )
      .run(cutoff).changes ?? 0;

    const prunedSamples = this.db
      .prepare('DELETE FROM perf_samples WHERE is_deleted = 0 AND created_at < ?')
      .run(cutoff).changes ?? 0;

    return prunedCrashes + prunedSamples;
  }
}
