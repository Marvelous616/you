import React, { useCallback, useEffect, useState } from 'react';
import { fetchHealth } from '../api.js';

interface ServerStatusProps {
  onRetry: () => void;
}

export const ServerStatus: React.FC<ServerStatusProps> = ({ onRetry }) => {
  const [online, setOnline] = useState(false);
  const [checking, setChecking] = useState(true);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const h = await fetchHealth();
      setOnline(!!h);
    } catch {
      setOnline(false);
    } finally {
      setChecking(false);
  }
  }, []);

  useEffect(() => {
    check();
    const interval = setInterval(check, 15000);
    return () => clearInterval(interval);
  }, [check]);

  const label = checking ? 'checking…' : online ? 'online' : 'offline';

  return (
    <div className={`server-status ${online ? 'online' : 'offline'}`}>
      <span className="status-dot" />
      {label}
      {!online && (
        <button type="button" className="btn-icon" title="Retry" onClick={() => { check(); onRetry(); }} aria-label="Retry server check">
          ↻
        </button>
      )}
    </div>
  );
};
