import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { resolveUserId } from '@/lib/serverAuth';

export async function GET(req: NextRequest) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ reports: [] });
  const userId = await resolveUserId(req, req.nextUrl.searchParams.get('deviceId'));
  // Without an identity we can't scope to "this person", so return nothing
  // rather than leaking every anonymous journal in the table.
  if (!userId) return NextResponse.json({ reports: [] });
  const { data, error } = await supabase
    .from('reports')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ reports: data });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ saved: false, localOnly: true });
  const userId = await resolveUserId(req, typeof body.deviceId === 'string' ? body.deviceId : null);
  const { data, error } = await supabase
    .from('reports')
    .insert({ report: body.report, journal: body.journal || null, user_id: userId })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ saved: true, report: data });
}
