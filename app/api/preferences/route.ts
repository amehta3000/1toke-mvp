import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { resolveUserId } from '@/lib/serverAuth';
import { defaultPreferences } from '@/lib/defaults';
import { isMissingMigration } from '@/lib/pgErrors';

// Tuning used to live only in the browser's localStorage, which is scoped to
// one browser on one domain. So the journal followed a signed-in person to a
// new phone, the home-screen app (iOS keeps its storage apart from Safari's)
// or a preview link — but their vibe didn't, and every scan there ran with
// nothing selected. The user_preferences table existed; nothing used it.

// Only known keys with the right types are stored, so a stale or tampered
// client can't write arbitrary JSON into someone's profile.
function sanitize(input: any): Record<string, unknown> | null {
  if (!input || typeof input !== 'object') return null;
  const out: Record<string, unknown> = {};
  for (const [key, def] of Object.entries(defaultPreferences)) {
    const v = input[key];
    if (typeof def === 'boolean' && typeof v === 'boolean') out[key] = v;
    else if (typeof def === 'number' && typeof v === 'number' && Number.isFinite(v)) out[key] = Math.max(0, Math.min(100, v));
    else if (key === 'tolerance' && ['low', 'medium', 'high'].includes(v)) out[key] = v;
    else if (key === 'mode' && ['safe', 'explore', 'surprise'].includes(v)) out[key] = v;
  }
  return Object.keys(out).length ? out : null;
}

export async function GET(req: NextRequest) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ preferences: null });
  const userId = await resolveUserId(req, req.nextUrl.searchParams.get('deviceId'));
  if (!userId) return NextResponse.json({ preferences: null });

  const { data, error } = await supabase
    .from('user_preferences')
    .select('preferences, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (isMissingMigration(error)) return NextResponse.json({ preferences: null, needsMigration: true });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ preferences: (data as any)?.preferences || null, updatedAt: (data as any)?.updated_at || null });
}

export async function PUT(req: NextRequest) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ saved: false, localOnly: true });
  const body = await req.json().catch(() => ({}));
  const userId = await resolveUserId(req, typeof body.deviceId === 'string' ? body.deviceId : null);
  if (!userId) return NextResponse.json({ saved: false }, { status: 401 });

  const preferences = sanitize(body.preferences);
  if (!preferences) return NextResponse.json({ error: 'Invalid preferences' }, { status: 400 });

  const updatedAt = new Date().toISOString();
  const { error } = await supabase
    .from('user_preferences')
    .upsert({ user_id: userId, preferences, updated_at: updatedAt }, { onConflict: 'user_id' });
  if (error) {
    if (isMissingMigration(error)) return NextResponse.json({ saved: false, needsMigration: true });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ saved: true, updatedAt });
}
