import { SupabaseClient } from '@supabase/supabase-js';
import { PreferenceProfile } from './types';
import { applyRatingToVector, emptyPreferenceProfile, RatingSignal } from './preferenceVector';

// "relation does not exist" / missing column — migration hasn't run yet.
function isSchemaMismatch(error: { code?: string } | null): boolean {
  return error?.code === '42P01' || error?.code === '42703';
}

export async function getPreferenceProfile(supabase: SupabaseClient, userId: string): Promise<PreferenceProfile> {
  const { data, error } = await supabase
    .from('user_preferences')
    .select('vector, sample_count, updated_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !data) return emptyPreferenceProfile;
  return {
    vector: (data.vector as PreferenceProfile['vector']) || {},
    sampleCount: data.sample_count ?? 0,
    updatedAt: data.updated_at || emptyPreferenceProfile.updatedAt
  };
}

// Fold one rated session into the user's learned preference vector. Best
// effort: a failure here should never block saving the session itself, so
// callers should treat a null return as "skipped" rather than an error.
export async function recordRatingSignal(
  supabase: SupabaseClient,
  userId: string,
  signal: RatingSignal
): Promise<PreferenceProfile | null> {
  try {
    const current = await getPreferenceProfile(supabase, userId);
    const next = applyRatingToVector(current, signal);
    if (next === current) return null; // no usable signal in this session

    const { error } = await supabase
      .from('user_preferences')
      .upsert(
        { user_id: userId, vector: next.vector, sample_count: next.sampleCount, updated_at: next.updatedAt },
        { onConflict: 'user_id' }
      );
    if (error) {
      if (!isSchemaMismatch(error)) console.error('Failed to persist preference vector', error.message);
      return null;
    }
    return next;
  } catch (err) {
    console.error('Failed to record rating signal', err);
    return null;
  }
}
