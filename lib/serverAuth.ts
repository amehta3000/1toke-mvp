import { NextRequest } from 'next/server';
import { getSupabaseAdmin } from './supabase';

// Resolve who is calling. A verified Supabase JWT wins; otherwise fall back to
// the legacy anonymous device id (pre-auth clients and no-auth deployments).
// An invalid token is rejected outright rather than falling through to a
// spoofable id.
export async function resolveUserId(req: NextRequest, legacyDeviceId?: string | null): Promise<string | null> {
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token) {
    const supabase = getSupabaseAdmin();
    if (!supabase) return null;
    const { data, error } = await supabase.auth.getUser(token);
    return !error && data?.user?.id ? data.user.id : null;
  }
  return legacyDeviceId || null;
}
