import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { resolveUserId } from '@/lib/serverAuth';
import { getPreferenceProfile } from '@/lib/preferenceStore';
import { emptyPreferenceProfile } from '@/lib/preferenceVector';

// Read-only view of the learned preference vector (see lib/preferenceVector.ts).
// It's written only as a side effect of rating a session (app/api/sessions),
// never directly by the client.
export async function GET(req: NextRequest) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ profile: emptyPreferenceProfile });
  const userId = await resolveUserId(req, req.nextUrl.searchParams.get('deviceId'));
  if (!userId) return NextResponse.json({ profile: emptyPreferenceProfile });

  const profile = await getPreferenceProfile(supabase, userId);
  return NextResponse.json({ profile });
}
