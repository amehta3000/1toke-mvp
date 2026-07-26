import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

// Reassign journal data to the calling (verified) user. Two sources:
// - legacyDeviceId: pre-auth rows keyed to the old client-generated device id.
//   Possession of the id is the proof, same trust level the app always had.
// - previousToken: this device's anonymous session from before signing in to
//   an existing account. Verified as a real JWT, so it can't be spoofed.
export async function POST(req: NextRequest) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ claimed: false, localOnly: true });

  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 401 });

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  const newId = userData?.user?.id;
  if (userError || !newId) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const sources: string[] = [];

  const legacy = typeof body.legacyDeviceId === 'string' ? body.legacyDeviceId : '';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(legacy) && legacy !== newId) {
    sources.push(legacy);
  }

  const prevToken = typeof body.previousToken === 'string' ? body.previousToken : '';
  if (prevToken) {
    const { data: prev } = await supabase.auth.getUser(prevToken);
    const prevId = prev?.user?.id;
    if (prevId && prevId !== newId && !sources.includes(prevId)) sources.push(prevId);
  }

  if (!sources.length) return NextResponse.json({ claimed: true, moved: 0 });

  let moved = 0;
  for (const table of ['reports', 'sessions']) {
    const { data, error } = await supabase
      .from(table)
      .update({ user_id: newId })
      .in('user_id', sources)
      .select('id');
    if (error) {
      if (error.code === '42P01') continue; // sessions table not migrated yet
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    moved += data?.length || 0;
  }

  return NextResponse.json({ claimed: true, moved });
}
