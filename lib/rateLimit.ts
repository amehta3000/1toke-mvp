import { createHash } from 'crypto';
import { NextRequest } from 'next/server';
import { getSupabaseAdmin } from './supabase';

// Every fresh scan costs real money (two model calls plus a web search), and
// anyone can mint an anonymous identity, so a script in a loop could drain the
// OpenAI balance. Limit fresh scans per identity AND per IP — the IP limit is
// what catches someone rotating anonymous accounts. Cached re-scans are free
// and are never counted.
//
// Backed by the scan_events table (see supabase-schema.sql). If that table
// isn't there yet, or the database is unreachable, this fails OPEN: a limiter
// that blocks real people because of its own outage is worse than none.

const LIMITS = [
  { scope: 'user', windowMs: 10 * 60_000, max: 20, label: 'a few minutes' },
  { scope: 'user', windowMs: 24 * 3600_000, max: 120, label: 'today' },
  { scope: 'ip', windowMs: 24 * 3600_000, max: 300, label: 'today' }
] as const;

export type LimitResult = { ok: true } | { ok: false; retryLabel: string };

// Only a hash of the IP is ever stored — enough to count requests from the
// same network, useless for working out who or where someone is.
export function clientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for') || '';
  const raw = fwd.split(',')[0].trim() || req.headers.get('x-real-ip') || '';
  if (!raw) return 'unknown';
  return createHash('sha256').update(`1toke:${raw}`).digest('hex').slice(0, 32);
}

export async function checkScanLimit(userKey: string | null, ip: string): Promise<LimitResult> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { ok: true };
  try {
    // All windows in parallel — this sits in front of every scan, so it must
    // cost one round trip, not three.
    const results = await Promise.all(LIMITS.map(async limit => {
      const key = limit.scope === 'user' ? userKey : ip;
      if (!key || key === 'unknown') return null;
      const since = new Date(Date.now() - limit.windowMs).toISOString();
      const { count, error } = await supabase
        .from('scan_events')
        .select('id', { count: 'exact', head: true })
        .eq(limit.scope === 'user' ? 'user_key' : 'ip', key)
        .gte('created_at', since);
      if (error) return null;
      return (count || 0) >= limit.max ? limit.label : null;
    }));
    const hit = results.find(Boolean);
    return hit ? { ok: false, retryLabel: hit } : { ok: true };
  } catch {
    return { ok: true };
  }
}

export async function recordScan(userKey: string | null, ip: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return;
  try {
    await supabase.from('scan_events').insert({ user_key: userKey || null, ip });
    // Nothing older than the longest window is ever read; prune occasionally
    // so the table stays small without needing a cron job.
    if (Math.random() < 0.02) {
      const cutoff = new Date(Date.now() - 2 * 24 * 3600_000).toISOString();
      await supabase.from('scan_events').delete().lt('created_at', cutoff);
    }
  } catch {
    // Never fail a scan over bookkeeping.
  }
}
