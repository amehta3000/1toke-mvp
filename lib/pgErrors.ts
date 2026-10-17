// A migration in supabase-schema.sql hasn't been run against this database
// yet — either the table is missing entirely (42P01), or an older table is
// missing a newer column (42703 from Postgres directly, PGRST204 when
// PostgREST's schema cache doesn't recognize it). Insert/update are what hit
// this; `select('*')` never fails just because a column doesn't exist.
export function isMissingMigration(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === '42P01' || error.code === '42703' || error.code === 'PGRST204') return true;
  return /column .* (does not exist|schema cache)/i.test(error.message || '');
}
