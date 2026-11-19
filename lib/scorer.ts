import type { Preferences } from './types';
import type { ProductProfile } from './catalog';
import type { Taste } from './taste';

// A deterministic match score computed from the product's profile, the
// person's toggles and their learned taste. Runs in SHADOW mode: it is stored
// next to the model's score on every scan but never shown. Once enough scans
// have ratings attached, the score_calibration view says which of the two
// predicts how people actually rated things — and only then should this
// replace the model's number (with the model still writing the words).
//
// It mirrors the rubric in the analyze prompt so the two are comparable.

export const SHADOW_SCORER_VERSION = 'v1-2026-11-17';

// What each terpene tends to do, coarsely. lean: 0 = head, 100 = body.
const TRAITS: Record<string, { effects: string[]; flavors: string[]; lean: number; risks?: string[] }> = {
  myrcene:       { effects: ['bodyRelaxed', 'sleepy', 'calm', 'unwind', 'nighttime', 'cozy'], flavors: ['earthy', 'tropical'], lean: 85, risks: ['avoidCouchLock', 'avoidFoggy'] },
  limonene:      { effects: ['uplifting', 'happy', 'creative', 'social', 'euphoric', 'daytime'], flavors: ['citrus'], lean: 25 },
  caryophyllene: { effects: ['painRelief', 'calm', 'bodyRelaxed', 'unwind'], flavors: ['gas', 'earthy'], lean: 65 },
  pinene:        { effects: ['focused', 'daytime', 'creative', 'energetic'], flavors: ['pine'], lean: 20 },
  linalool:      { effects: ['calm', 'sleepy', 'unwind', 'nighttime'], flavors: ['dessert', 'berry'], lean: 75 },
  humulene:      { effects: ['focused', 'calm'], flavors: ['earthy'], lean: 50 },
  terpinolene:   { effects: ['uplifting', 'energetic', 'creative', 'euphoric', 'daytime'], flavors: ['pine', 'citrus'], lean: 15, risks: ['avoidRacingHeart', 'avoidAnxious'] },
  ocimene:       { effects: ['uplifting', 'energetic', 'social'], flavors: ['tropical', 'berry'], lean: 25 },
  bisabolol:     { effects: ['calm', 'unwind'], flavors: ['dessert'], lean: 65 },
  nerolidol:     { effects: ['sleepy', 'calm'], flavors: ['earthy'], lean: 80 },
  valencene:     { effects: ['uplifting', 'happy'], flavors: ['citrus'], lean: 30 },
  farnesene:     { effects: ['calm'], flavors: ['berry'], lean: 60 },
  eucalyptol:    { effects: ['focused'], flavors: ['pine'], lean: 35 },
  guaiol:        { effects: ['calm'], flavors: ['pine'], lean: 55 },
  camphene:      { effects: [], flavors: ['earthy'], lean: 50 },
  terpineol:     { effects: ['calm', 'sleepy'], flavors: ['dessert'], lean: 70 }
};

// Terpenes that tend to soften the edgy side of high THC.
const BUFFERS = new Set(['linalool', 'myrcene', 'caryophyllene', 'bisabolol']);

export function leanOf(terpenes: { name: string; weight: number }[]): number | null {
  const known = terpenes.filter(t => TRAITS[t.name]);
  const total = known.reduce((s, t) => s + t.weight, 0);
  if (!known.length || total <= 0) return null;
  return Math.round(known.reduce((s, t) => s + TRAITS[t.name].lean * t.weight, 0) / total);
}

// Delivers an effect when the terpenes carrying it make up a real share of
// the profile, not when a trace terpene happens to be associated with it.
function effectStrength(terpenes: { name: string; weight: number }[], key: string): number {
  return terpenes.reduce((s, t) => s + (TRAITS[t.name]?.effects.includes(key) ? t.weight : 0), 0);
}
function flavorPresent(terpenes: { name: string; weight: number }[], key: string): boolean {
  return terpenes.some(t => t.weight >= 0.15 && TRAITS[t.name]?.flavors.includes(key));
}

const EFFECT_KEYS = ['creative', 'social', 'focused', 'euphoric', 'calm', 'sleepy', 'bodyRelaxed', 'uplifting',
  'energetic', 'happy', 'daytime', 'painRelief', 'cozy', 'nighttime', 'unwind'] as const;
const FLAVOR_KEYS = ['citrus', 'pine', 'berry', 'tropical', 'gas', 'earthy', 'dessert'] as const;

export type ShadowScore = { score: number; parts: Record<string, number> };

export function shadowScore(profile: ProductProfile | null, prefs: Partial<Preferences>, taste: Taste | null): ShadowScore | null {
  if (!profile) return null;
  const terps = profile.terpenes;
  const haveTerps = terps.length > 0;
  const thc = profile.thcPct;
  if (!haveTerps && thc === null) return null; // nothing to score on — the model's 45-55 band applies

  // From-memory terpene profiles count half, same as the prompt's TYPICAL tier.
  const evidence = profile.bestSource === 'typical' ? 0.5 : 1;
  const parts: Record<string, number> = {};
  const p = prefs as Record<string, any>;

  if (haveTerps) {
    let effects = 0;
    for (const k of EFFECT_KEYS) if (p[k] && effectStrength(terps, k) >= 0.3) effects += 8;
    parts.effects = Math.min(24, effects) * evidence;

    let flavors = 0;
    for (const k of FLAVOR_KEYS) if (p[k] && flavorPresent(terps, k)) flavors += 5;
    parts.flavors = Math.min(10, flavors) * evidence;

    let avoids = 0;
    const dominant = terps[0]?.name;
    if (p.avoidCouchLock && dominant === 'myrcene' && terps[0].weight >= 0.3) avoids -= 12;
    if (p.avoidFoggy && dominant === 'myrcene' && terps[0].weight >= 0.3) avoids -= 12;
    if (p.avoidRacingHeart && terps.some(t => t.name === 'terpinolene' && t.weight >= 0.25)) avoids -= 12;
    const buffered = terps.some(t => BUFFERS.has(t.name) && t.weight >= 0.2);
    if (p.avoidAnxious && thc !== null && thc >= 25 && !buffered) avoids -= 12;
    parts.avoids = avoids * evidence;

    const lean = leanOf(terps);
    if (lean !== null && typeof p.headBodyLean === 'number') {
      const gap = Math.abs(lean - p.headBodyLean);
      parts.lean = (gap <= 15 ? 8 : gap >= 50 ? -8 : 0) * evidence;
    }
  }

  // Potency bands depend on the form: vapes and concentrates are routinely
  // 70–90% THC, so flower thresholds would mark every cart as an overshoot.
  // Edibles are dosed in mg, not %, so they're left out.
  const concentrated = profile.productType === 'vape' || profile.productType === 'concentrate';
  if (thc !== null && profile.productType !== 'edible' && profile.productType !== 'other') {
    const ceiling = concentrated
      ? (p.tolerance === 'low' ? 70 : p.tolerance === 'high' ? 100 : 85)
      : (p.tolerance === 'low' ? 18 : p.tolerance === 'high' ? 40 : 26);
    const floor = concentrated ? 0 : (p.tolerance === 'high' ? 20 : p.tolerance === 'low' ? 0 : 12);
    parts.potency = thc > ceiling + 4 ? -8 : thc < floor ? -5 : 6;
  }

  // What this person has actually liked and disliked — the learning part.
  if (taste && haveTerps && taste.signals > 0) {
    const pull = terps.reduce((s, t) => s + (taste.terpenes[t.name] || 0) * t.weight, 0); // -1..1
    parts.taste = Math.max(-15, Math.min(15, pull * 15));
    // Only compare like with like: a 31% flower they disliked says nothing
    // about an 85% cart.
    if (!concentrated && thc !== null && taste.dislikedThc !== null && thc >= taste.dislikedThc - 1 && (taste.likedThc === null || taste.dislikedThc > taste.likedThc)) {
      parts.tasteThc = -4;
    }
  }

  const raw = 50 + Object.values(parts).reduce((s, v) => s + v, 0);
  const clamped = Math.max(0, Math.min(100, raw));
  return { score: Math.round(clamped / 5) * 5, parts };
}
