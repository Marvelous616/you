import { Marker, Day } from '@life-logger/domain';

const API_BASE = '';

export async function fetchActiveDay(): Promise<Day> {
  const res = await fetch(`${API_BASE}/api/v1/days/active`);
  if (!res.ok) throw new Error('Failed to fetch active day');
  return res.json();
}

export async function fetchMarkers(dayId?: string): Promise<Marker[]> {
  const url = dayId ? `${API_BASE}/api/v1/markers?dayId=${encodeURIComponent(dayId)}` : `${API_BASE}/api/v1/markers`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch markers');
  return res.json();
}

export async function checkServerHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/health`);
    return res.ok;
  } catch {
    return false;
  }
}
