import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

// "relation does not exist" — the sessions migration hasn't been run yet.
function isMissingTable(error: { code?: string } | null): boolean {
  return error?.code === '42P01';
}

export async function GET(req: NextRequest) {
  const deviceId = req.nextUrl.searchParams.get('deviceId');
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ sessions: [] });
  if (!deviceId) return NextResponse.json({ sessions: [] });

  const { data, error } = await supabase
    .from('sessions')
    .select('*, reports(report)')
    .eq('user_id', deviceId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    if (isMissingTable(error)) {
      return NextResponse.json({ sessions: [], needsMigration: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ sessions: data });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const deviceId = typeof body.deviceId === 'string' && body.deviceId ? body.deviceId : null;
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ saved: false, localOnly: true });

  const rating = Number(body.rating);
  const row = {
    user_id: deviceId,
    report_id: typeof body.reportId === 'string' && body.reportId ? body.reportId : null,
    strain_name: typeof body.strainName === 'string' ? body.strainName.slice(0, 120) : '',
    rating: Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : null,
    feelings: Array.isArray(body.feelings) ? body.feelings.filter((f: unknown) => typeof f === 'string').slice(0, 12) : null,
    notes: typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim().slice(0, 2000) : null,
    would_buy_again: typeof body.wouldBuyAgain === 'boolean' ? body.wouldBuyAgain : null
  };

  const { data, error } = await supabase.from('sessions').insert(row).select().single();

  if (error) {
    if (isMissingTable(error)) {
      return NextResponse.json({ saved: false, needsMigration: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ saved: true, session: data });
}
