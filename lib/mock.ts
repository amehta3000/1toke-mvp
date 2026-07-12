import { Preferences, StrainReport } from './types';

export function mockAnalyze(question: string, prefs: Preferences): StrainReport {
  const q = question?.trim() || '';
  // Specific enough to demo the full report card: a THC/CBD % or a multi-word name.
  const hasSpecifics = /\d+\s*%/.test(q) || q.split(/\s+/).length >= 2;
  const name = q || 'Unknown Sativa Hybrid';
  const wantsBright = prefs.creative || prefs.social || prefs.euphoric;
  const score = wantsBright ? 82 : 68;

  if (!hasSpecifics) {
    return {
      strainName: 'Unknown',
      brand: '',
      productType: '',
      cannabinoids: '',
      terpenes: [],
      matchScore: 50,
      buyDecision: 'Maybe',
      quickTake: q || 'just vibes, no specifics',
      expectedEffects: [],
      watchOuts: [],
      bestFor: [],
      dosingGuidance: 'Cannot provide dosing guidance without product information.',
      confidence: 'low',
      missingInfo: ['clear THC/CBD values', 'terpene panel', 'strain or product name']
    };
  }

  return {
    strainName: name.slice(0, 42),
    brand: 'Mock mode (no API key)',
    brandNotes: 'Demo brand intel: with a real API key this line covers reputation, how established they are, and anything notable.',
    strainType: 'Hybrid — sativa-leaning',
    productType: 'Flower / pre-roll',
    cannabinoids: 'Unknown until label is scanned clearly',
    terpenes: prefs.citrus ? ['limonene', 'pinene', 'caryophyllene'] : ['caryophyllene', 'linalool'],
    matchScore: score,
    buyDecision: score >= 80 ? 'Buy' : 'Maybe',
    quickTake: score >= 80
      ? 'Looks aligned with an uplifting, creative, social session. Good candidate if you want daytime energy without getting too heavy.'
      : 'Could work, but I would want clearer terpene and THC info before buying.',
    whyThisScore: wantsBright
      ? 'Citrus-forward terpenes line up with your creative/social lean — docked a few points for the missing THC data.'
      : 'Neutral profile match; without your bright-effect toggles on, this reads as a coin flip.',
    expectedEffects: ['uplifted mood', 'creative headspace', 'light social energy'],
    watchOuts: ['Start low if THC is over 28%', 'Avoid if dominant terpene is myrcene and you want to stay active'],
    bestFor: ['daytime walk', 'music making', 'social hang'],
    dosingGuidance: 'Try 1–2 small tokes, wait 10–15 minutes, then decide. Do not judge it from THC % alone.',
    confidence: 'medium',
    missingInfo: ['clear THC/CBD values', 'terpene panel', 'package date']
  };
}
