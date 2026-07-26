import { createClient, SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null | undefined;

// Browser-side Supabase client (anon key). Null when accounts aren't
// configured — the app then runs in the legacy device-id mode.
export function getSupabaseBrowser(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  client = url && key ? createClient(url, key) : null;
  return client;
}

// fetch() that attaches the current Supabase access token when there is one.
// Reads the session per call so token refreshes are always picked up.
export async function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const supabase = getSupabaseBrowser();
  const headers = new Headers(init.headers);
  if (supabase) {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) headers.set('authorization', `Bearer ${token}`);
  }
  return fetch(input, { ...init, headers });
}
