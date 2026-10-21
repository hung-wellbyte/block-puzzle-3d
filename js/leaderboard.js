// Shared leaderboard backed by Supabase's REST API (no client library needed).
import { SUPABASE_URL, SUPABASE_KEY } from './config.js?v=4';

export const leaderboardEnabled = Boolean(SUPABASE_URL && SUPABASE_KEY);

async function request(path, init = {}) {
  const headers = { apikey: SUPABASE_KEY, 'Content-Type': 'application/json', ...init.headers };
  // Legacy anon keys are JWTs and also go in Authorization; new publishable keys must not.
  if (SUPABASE_KEY.startsWith('eyJ')) headers.Authorization = `Bearer ${SUPABASE_KEY}`;
  const res = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, { ...init, headers });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export function submitScore({ userId, level, timeMs, hints, moves }) {
  return request('scores', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ user_id: userId, level, time_ms: Math.round(timeMs), hints, moves }),
  });
}

// Best record per player for one level: fewer hints first, then faster time.
export function fetchLeaderboard(level, limit = 50) {
  return request(
    `leaderboard?select=user_id,time_ms,hints,moves&level=eq.${level}&order=hints.asc,time_ms.asc&limit=${limit}`,
  );
}
