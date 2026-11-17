import React, { useCallback, useEffect, useState } from 'react';
import { CrashReport, PerfSample } from '@life-logger/domain';
import {
  fetchCrashReports,
  fetchPerfSamples,
  postCrashReport,
  postPerfSample,
  pruneDiagnostics,
} from '../api.js';

interface DiagnosticsProps {
  isOpen: boolean;
  onClose: () => void;
}

const RETENTION_DAYS = 30;

export const Diagnostics: React.FC<DiagnosticsProps> = ({
  isOpen,
  onClose,
}) => {
  const [crashReports, setCrashReports] = useState<CrashReport[]>([]);
  const [perfSamples, setPerfSamples] = useState<PerfSample[]>([]);
  const [loading, setLoading] = useState(false);
  const [pruning, setPruning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastPruned, setLastPruned] = useState<number | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [crashes, samples] = await Promise.all([
        fetchCrashReports(),
        fetchPerfSamples(),
      ]);
      setCrashReports(crashes);
      setPerfSamples(samples);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load diagnostics');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen, loadData]);

  const handleReportCrash = async () => {
    const now = new Date().toISOString();
    try {
      await postCrashReport({
        id: `crash-${Date.now()}`,
        error: 'Diagnostics demo crash (sample)',
        appVersion: '0.3.6-web',
        deviceType: 'web',
        screen: '/day/today',
        createdAt: now,
        updatedAt: now,
        isDeleted: false,
      });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to report crash');
    }
  };

  const handleSamplePerf = async () => {
    const now = new Date().toISOString();
    try {
      await postPerfSample({
        id: `perf-${Date.now()}`,
        operation: 'open-today',
        durationMs: 45,
        deviceType: 'web',
        createdAt: now,
        updatedAt: now,
        isDeleted: false,
      });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record sample');
    }
  };

  const handlePrune = async () => {
    setPruning(true);
    setError(null);
    try {
      const result = await pruneDiagnostics(RETENTION_DAYS);
      setLastPruned(result.pruned);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to prune diagnostics');
    } finally {
      setPruning(false);
    }
  };

  if (!isOpen) return null;

  const avgDuration =
    perfSamples.length > 0
      ? perfSamples.reduce((a, b) => a + b.durationMs, 0) / perfSamples.length
      : 0;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(2, 6, 23, 0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        zIndex: 100,
        backdropFilter: 'blur(4px)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '700px',
          maxHeight: '90vh',
          overflowY: 'auto',
          backgroundColor: '#0f172a',
          border: '1px solid #334155',
          borderRadius: '16px',
          padding: '28px',
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.5)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ margin: 0, fontSize: '1.4rem', color: '#f8fafc' }}>Diagnostics</h2>
          <button
            type="button"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              fontSize: '1.6rem',
              lineHeight: 1,
              cursor: 'pointer',
              padding: 0,
            }}
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {error && (
          <div
            style={{
              backgroundColor: '#450a0a',
              border: '1px solid #7f1d1d',
              color: '#f87171',
              padding: '10px 14px',
              borderRadius: '8px',
              marginBottom: '16px',
              fontSize: '0.85rem',
            }}
          >
            {error}
          </div>
        )}

        {lastPruned !== null && (
          <div
            style={{
              backgroundColor: '#064e3b',
              border: '1px solid #34d399',
              color: '#86efac',
              padding: '10px 14px',
              borderRadius: '8px',
              marginBottom: '16px',
              fontSize: '0.85rem',
            }}
          >
            Pruned {lastPruned} record{lastPruned !== 1 ? 's' : ''} older than
            {RETENTION_DAYS} days.
          </div>
        )}

        <div style={{ display: 'grid', gap: '10px', marginBottom: '20px' }}>
          <button
            type="button"
            onClick={handleReportCrash}
            disabled={loading}
            style={{
              backgroundColor: '#7f1d1d',
              color: '#fecaca',
              border: '1px solid #991b1b',
              borderRadius: '8px',
              padding: '10px 14px',
              fontWeight: 700,
              fontSize: '0.82rem',
              cursor: 'pointer',
            }}
          >
            {loading ? 'Recording…' : 'Report sample crash'}
          </button>
          <button
            type="button"
            onClick={handleSamplePerf}
            disabled={loading}
            style={{
              backgroundColor: '#1e3a8a',
              color: '#bfdbfe',
              border: '1px solid #1e40af',
              borderRadius: '8px',
              padding: '10px 14px',
              fontWeight: 700,
              fontSize: '0.82rem',
              cursor: 'pointer',
            }}
          >
            {loading ? 'Recording…' : 'Record perf sample'}
          </button>
          <button
            type="button"
            onClick={handlePrune}
            disabled={pruning || loading}
            style={{
              backgroundColor: '#451a03',
              color: '#fcd34d',
              border: '1px solid #b45309',
              borderRadius: '8px',
              padding: '10px 14px',
              fontWeight: 700,
              fontSize: '0.82rem',
              cursor: 'pointer',
            }}
          >
            {pruning ? 'Pruning…' : `Prune older than ${RETENTION_DAYS} days`}
          </button>
        </div>

        <div style={{ display: 'grid', gap: '16px', marginTop: '16px' }}>
          <section>
            <h3
              style={{
                margin: '0 0 8px',
                fontSize: '0.9rem',
                color: '#94a3b8',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              Crash reports ({crashReports.length})
            </h3>
            {crashReports.length === 0 ? (
              <p className="empty-state" style={{ margin: 0, textAlign: 'left' }}>
                No crash reports.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {crashReports.map((r) => (
                  <div
                    key={r.id}
                    style={{
                      backgroundColor: '#1e293b',
                      border: '1px solid #334155',
                      borderRadius: '8px',
                      padding: '8px 12px',
                    }}
                  >
                    <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#fecaca', marginBottom: '2px' }}>
                      {r.error}
                    </div>
                    <div style={{ display: 'flex', gap: '10px', fontSize: '0.72rem', color: '#94a3b8' }}>
                      <span>{r.appVersion}</span>
                      <span>{r.deviceType}</span>
                      <span>{r.screen ?? '—'}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <h3
              style={{
                margin: '0 0 8px',
                fontSize: '0.9rem',
                color: '#94a3b8',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              Perf samples ({perfSamples.length}) · avg {avgDuration.toFixed(0)} ms
            </h3>
            {perfSamples.length === 0 ? (
              <p className="empty-state" style={{ margin: 0, textAlign: 'left' }}>
                No perf samples.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {perfSamples.map((s) => (
                  <div
                    key={s.id}
                    style={{
                      backgroundColor: '#1e293b',
                      border: '1px solid #334155',
                      borderRadius: '8px',
                      padding: '8px 12px',
                    }}
                  >
                    <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#bfdbfe', marginBottom: '2px' }}>
                      {s.operation} · {s.durationMs} ms
                    </div>
                    <div style={{ display: 'flex', gap: '10px', fontSize: '0.72rem', color: '#94a3b8' }}>
                      <span>{s.deviceType}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <div
          style={{
            marginTop: '24px',
            paddingTop: '16px',
            borderTop: '1px solid #334155',
            fontSize: '0.72rem',
            color: '#64748b',
          }}
        >
          Diagnostics data stays on this device and server; it is never synced
          and never contains life-log content. Old records roll off after the
          retention window.
        </div>
      </div>
    </div>
  );
};
