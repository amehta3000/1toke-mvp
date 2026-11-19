import { NextRequest, NextResponse, after } from 'next/server';
import { recomputeTaste } from '@/lib/taste';
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
  const failed: { table: string; code?: string; message?: string }[] = [];
  for (const table of ['reports', 'sessions']) {
    const { data, error } = await supabase
      .from(table)
      .update({ user_id: newId })
      .in('user_id', sources)
      .select('id');
    if (error) {
      if (error.code === '42P01') continue; // sessions table not migrated yet
      // Keep going rather than bailing. These updates are separate statements,
      // so returning here left the earlier table already moved to the new id
      // and the later one stranded under the old one — scans that follow you
      // into the account and a journal that silently doesn't.
      // Hand the real Postgres error back. The caller owns every row being
      // moved, and without it a half-moved account is only diagnosable by
      // opening the SQL editor — which is not something to ask of someone
      // staring at a journal that looks erased.
      failed.push({ table, code: error.code, message: error.message });
      continue;
    }
    moved += data?.length || 0;
  }

  // Tuning follows the person too. The account keeps its own if it already
  // has one (that's the profile they set while signed in); otherwise it takes
  // the most recent one from the identities being merged into it.
  try {
    const { data: existing } = await supabase.from('user_preferences').select('id').eq('user_id', newId).limit(1);
    if (!existing?.length) {
      const { data: latest } = await supabase.from('user_preferences')
        .select('preferences, updated_at').in('user_id', sources)
        .order('updated_at', { ascending: false }).limit(1).maybeSingle();
      if (latest) {
        await supabase.from('user_preferences').upsert(
          { user_id: newId, preferences: (latest as any).preferences, updated_at: (latest as any).updated_at },
          { onConflict: 'user_id' }
        );
      }
    }
  } catch { /* preferences are recoverable from the device; never block a claim */ }

  // A partial move is not a claim. Reporting it as one lets the client set its
  // "already claimed" flag and never try again, which is how the split becomes
  // permanent. Saying so leaves the flag unset, so the next visit retries.
  if (failed.length) return NextResponse.json({ claimed: false, moved, incomplete: failed });

  // Scans and journal entries just moved onto this account; its taste must
  // be rebuilt from them, or it would keep the empty profile it started with.
  if (moved) after(() => recomputeTaste(newId));
  return NextResponse.json({ claimed: true, moved });
}
