export type PreferenceKey =
  | 'creative' | 'social' | 'focused' | 'euphoric' | 'calm' | 'sleepy' | 'bodyRelaxed'
  | 'uplifting' | 'energetic' | 'happy' | 'music' | 'daytime'
  | 'painRelief' | 'cozy' | 'nighttime' | 'unwind' | 'appetite'
  | 'avoidAnxious' | 'avoidFoggy' | 'avoidCouchLock' | 'avoidHeavyComedown' | 'avoidMunchies'
  | 'citrus' | 'pine' | 'berry' | 'tropical' | 'gas' | 'earthy' | 'dessert';

export type Preferences = Record<PreferenceKey, boolean> & {
  intensity: number;
  tolerance: 'low' | 'medium' | 'high';
  mode: 'safe' | 'explore' | 'surprise';
};

// Learned signal, separate from the manual onboarding toggles above. Each
// score is in [-1, 1]: how much this person actually seems to care about
// that key, inferred from rated sessions rather than set by hand.
export type PreferenceVector = Partial<Record<PreferenceKey, number>>;

export type PreferenceProfile = {
  vector: PreferenceVector;
  sampleCount: number;
  updatedAt: string;
};

export type StrainReport = {
  strainName: string;
  brand?: string;
  brandNotes?: string;
  strainType?: string;
  productType?: string;
  cannabinoids?: string;
  terpenes?: string[];
  matchScore: number;
  buyDecision: 'Buy' | 'Maybe' | 'Skip';
  quickTake: string;
  whyThisScore?: string;
  expectedEffects: string[];
  watchOuts: string[];
  bestFor: string[];
  dosingGuidance: string;
  confidence: 'low' | 'medium' | 'high';
  missingInfo?: string[];
};

export type SessionLog = {
  id: string;
  created_at: string;
  report_id: string | null;
  strain_name: string;
  rating: number | null;
  feelings: string[] | null;
  notes: string | null;
  would_buy_again: boolean | null;
};

export type SavedReport = {
  id: string;
  created_at: string;
  report: Partial<StrainReport> | null;
  journal: unknown;
};
