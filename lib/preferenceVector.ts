import { PreferenceKey, PreferenceProfile, PreferenceVector } from './types';

export const emptyPreferenceProfile: PreferenceProfile = {
  vector: {},
  sampleCount: 0,
  updatedAt: new Date(0).toISOString()
};

// Journal feeling chips -> the taxonomy keys they provide evidence about.
// Reuses PreferenceKey (the same vocabulary as the onboarding chips) rather
// than inventing a second one, so learned signal and manual toggles stay
// directly comparable.
const FEELING_KEY_MAP: Record<string, PreferenceKey[]> = {
  Creative: ['creative'],
  Happy: ['happy'],
  Social: ['social'],
  Focused: ['focused'],
  Relaxed: ['calm', 'bodyRelaxed'],
  Sleepy: ['sleepy'],
  Cozy: ['cozy'],
  'Pain relief': ['painRelief'],
  Giggly: ['euphoric'],
  Foggy: ['avoidFoggy'],
  Anxious: ['avoidAnxious'],
  Munchies: ['avoidMunchies']
};

const AVOID_KEYS = new Set<PreferenceKey>([
  'avoidAnxious', 'avoidFoggy', 'avoidCouchLock', 'avoidHeavyComedown', 'avoidMunchies'
]);

export type RatingSignal = {
  rating: number | null;
  feelings: string[] | null;
  wouldBuyAgain: boolean | null;
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

// +1 = good session, -1 = bad session, 0 = no usable signal (e.g. a neutral
// 3-star with no buy-again answer). Rating wins when present; would-buy-again
// fills in when the rating alone is ambiguous.
function outcomeSign(rating: number | null, wouldBuyAgain: boolean | null): -1 | 0 | 1 {
  if (typeof rating === 'number') {
    if (rating >= 4) return 1;
    if (rating <= 2) return -1;
  }
  if (wouldBuyAgain === true) return 1;
  if (wouldBuyAgain === false) return -1;
  return 0;
}

// Learning rate decays as more rated sessions come in (fast to react while
// we know nothing about someone, slower once a pattern is established) but
// never bottoms out completely, since taste genuinely drifts over time.
function learningRate(sampleCount: number): number {
  return clamp(1 / (sampleCount + 2), 0.08, 0.35);
}

// Nudge the vector from one rated session. Pure function: no I/O, easy to
// unit test and to reuse for the eventual client-side preview ("here's what
// we're about to learn from this rating").
export function applyRatingToVector(profile: PreferenceProfile, signal: RatingSignal): PreferenceProfile {
  const outcome = outcomeSign(signal.rating, signal.wouldBuyAgain);
  if (outcome === 0) return profile;

  const keys = new Set<PreferenceKey>();
  for (const feeling of signal.feelings || []) {
    for (const key of FEELING_KEY_MAP[feeling] || []) keys.add(key);
  }
  if (keys.size === 0) return profile;

  const lr = learningRate(profile.sampleCount);
  const vector: PreferenceVector = { ...profile.vector };
  for (const key of keys) {
    // Avoid-keys track "how much this bothers them" — feeling the thing and
    // still rating well means it matters less than assumed, not more.
    const target = AVOID_KEYS.has(key) ? -outcome : outcome;
    const current = vector[key] ?? 0;
    vector[key] = clamp(current + lr * (target - current), -1, 1);
  }

  return { vector, sampleCount: profile.sampleCount + 1, updatedAt: new Date().toISOString() };
}

// The keys worth surfacing — to a prompt, or eventually to the user directly
// ("you keep rating citrus/creative stuff highly").
export function topSignals(vector: PreferenceVector, minAbs = 0.25, limit = 8): Array<[PreferenceKey, number]> {
  return (Object.entries(vector) as Array<[PreferenceKey, number | undefined]>)
    .filter((entry): entry is [PreferenceKey, number] => typeof entry[1] === 'number' && Math.abs(entry[1]) >= minAbs)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, limit);
}
