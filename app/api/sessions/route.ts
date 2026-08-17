import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { resolveUserId } from '@/lib/serverAuth';

// The sessions migration hasn't been (fully) run yet — either the table is
// missing entirely (42P01), or an older table is missing a newer column
// (42703 from Postgres directly, PGRST204 when PostgREST's schema cache
// doesn't recognize it). Insert/update are what actually hit this, since
// `select('*')` never fails just because a column doesn't exist.
function isMissingMigration(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === '42P01' || error.code === '42703' || error.code === 'PGRST204') return true;
  return /column .* (does not exist|schema cache)/i.test(error.message || '');
}

export async function GET(req: NextRequest) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ sessions: [] });
  const userId = await resolveUserId(req, req.nextUrl.searchParams.get('deviceId'));
  if (!userId) return NextResponse.json({ sessions: [] });

  const { data, error } = await supabase
    .from('sessions')
    .select('*, reports(report)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    if (isMissingMigration(error)) {
      return NextResponse.json({ sessions: [], needsMigration: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ sessions: data });
}

function sessionFields(body: any) {
  const rating = Number(body.rating);
  const lat = Number(body.locationLat);
  const lng = Number(body.locationLng);
  return {
    strain_name: typeof body.strainName === 'string' ? body.strainName.slice(0, 120) : '',
    rating: Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : null,
    feelings: Array.isArray(body.feelings) ? body.feelings.filter((f: unknown) => typeof f === 'string').slice(0, 12) : null,
    notes: typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim().slice(0, 2000) : null,
    would_buy_again: typeof body.wouldBuyAgain === 'boolean' ? body.wouldBuyAgain : null,
    // Opt-in only: the client only sends these when the person tapped "tag this location".
    location_lat: Number.isFinite(lat) ? lat : null,
    location_lng: Number.isFinite(lng) ? lng : null
  };
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ saved: false, localOnly: true });
  const userId = await resolveUserId(req, typeof body.deviceId === 'string' ? body.deviceId : null);

  const row = {
    ...sessionFields(body),
    user_id: userId,
    report_id: typeof body.reportId === 'string' && body.reportId ? body.reportId : null
  };

  const { data, error } = await supabase.from('sessions').insert(row).select().single();

  if (error) {
    if (isMissingMigration(error)) {
      return NextResponse.json({ saved: false, needsMigration: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ saved: true, session: data });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const id = typeof body.id === 'string' ? body.id : '';
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ saved: false, localOnly: true });
  const userId = await resolveUserId(req, typeof body.deviceId === 'string' ? body.deviceId : null);
  if (!id || !userId) return NextResponse.json({ error: 'Missing id or identity' }, { status: 400 });

  // Scoping the update to user_id keeps one person from touching another's entries.
  const { data, error } = await supabase
    .from('sessions')
    .update(sessionFields(body))
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) {
    if (isMissingMigration(error)) {
      return NextResponse.json({ saved: false, needsMigration: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ saved: true, session: data });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id') || '';
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ deleted: false, localOnly: true });
  const userId = await resolveUserId(req, req.nextUrl.searchParams.get('deviceId'));
  if (!id || !userId) return NextResponse.json({ error: 'Missing id or identity' }, { status: 400 });

  const { error } = await supabase
    .from('sessions')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deleted: true });
}
