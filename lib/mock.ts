import { Preferences, StrainReport } from './types';

export function mockAnalyze(question: string, prefs: Preferences): StrainReport {
  const name = question?.trim() || 'Unknown Sativa Hybrid';
  const wantsBright = prefs.creative || prefs.social || prefs.euphoric;
  const score = wantsBright ? 82 : 68;
  return {
    strainName: name.slice(0, 42),
    brand: 'Photo/question mode',
    productType: 'Flower / pre-roll',
    cannabinoids: 'Unknown until label is scanned clearly',
    terpenes: prefs.citrus ? ['limonene', 'pinene', 'caryophyllene'] : ['caryophyllene', 'linalool'],
    matchScore: score,
    buyDecision: score >= 80 ? 'Buy' : 'Maybe',
    quickTake: score >= 80
      ? 'Looks aligned with an uplifting, creative, social session. Good candidate if you want daytime energy without getting too heavy.'
      : 'Could work, but I would want clearer terpene and THC info before buying.',
    expectedEffects: ['uplifted mood', 'creative headspace', 'light social energy'],
    watchOuts: ['Start low if THC is over 28%', 'Avoid if dominant terpene is myrcene and you want to stay active'],
    bestFor: ['daytime walk', 'music making', 'social hang'],
    dosingGuidance: 'Try 1–2 small tokes, wait 10–15 minutes, then decide. Do not judge it from THC % alone.',
    confidence: 'low',
    missingInfo: ['clear THC/CBD values', 'terpene panel', 'package date']
  };
}
