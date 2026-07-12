export type PreferenceKey =
  | 'creative' | 'social' | 'focused' | 'euphoric' | 'calm' | 'sleepy' | 'bodyRelaxed'
  | 'uplifting' | 'energetic' | 'happy' | 'music' | 'daytime'
  | 'avoidAnxious' | 'avoidFoggy' | 'avoidCouchLock' | 'avoidHeavyComedown' | 'avoidMunchies'
  | 'citrus' | 'pine' | 'berry' | 'tropical' | 'gas' | 'earthy' | 'dessert';

export type Preferences = Record<PreferenceKey, boolean> & {
  intensity: number;
  tolerance: 'low' | 'medium' | 'high';
  mode: 'safe' | 'explore' | 'surprise';
};

export type StrainReport = {
  strainName: string;
  brand?: string;
  productType?: string;
  cannabinoids?: string;
  terpenes?: string[];
  matchScore: number;
  buyDecision: 'Buy' | 'Maybe' | 'Skip';
  quickTake: string;
  expectedEffects: string[];
  watchOuts: string[];
  bestFor: string[];
  dosingGuidance: string;
  confidence: 'low' | 'medium' | 'high';
  missingInfo?: string[];
};
