export type PreferenceKey =
  | 'creative' | 'social' | 'focused' | 'euphoric' | 'calm' | 'sleepy' | 'bodyRelaxed'
  | 'uplifting' | 'energetic' | 'happy' | 'music' | 'daytime'
  | 'painRelief' | 'cozy' | 'nighttime' | 'unwind' | 'appetite'
  | 'nauseaRelief' | 'confidence' | 'lowOdor'
  | 'avoidAnxious' | 'avoidFoggy' | 'avoidCouchLock' | 'avoidHeavyComedown' | 'avoidMunchies'
  | 'avoidRacingHeart' | 'avoidDryMouth'
  | 'citrus' | 'pine' | 'berry' | 'tropical' | 'gas' | 'earthy' | 'dessert';

export type Preferences = Record<PreferenceKey, boolean> & {
  intensity: number;
  tolerance: 'low' | 'medium' | 'high';
  mode: 'safe' | 'explore' | 'surprise';
  // 0 = purely head/cerebral, 100 = purely body/physical. Scored against the
  // product's actual terpene-derived lean, independent of the printed
  // Indica/Sativa/Hybrid label — that label is often marketing, not chemistry.
  headBodyLean: number;
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
  // Set only when the printed strain type conflicts with the terpene-derived
  // lean, e.g. "Labeled Indica, but limonene/pinene-forward — reads closer to
  // head/uplifting than the label suggests." Omitted when there's no mismatch.
  labelCheck?: string;
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
  // Opt-in only — null unless the person tapped "tag this location" when logging.
  location_lat: number | null;
  location_lng: number | null;
};

export type SavedReport = {
  id: string;
  created_at: string;
  report: Partial<StrainReport> | null;
  journal: unknown;
};
