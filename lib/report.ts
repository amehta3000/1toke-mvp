import { StrainReport } from './types';

// Shared coercion helpers: the model (or old saved rows) can hand us strings,
// numbers, arrays, or nested objects for any field. Flatten all of it to
// display-safe strings so the UI never renders "[object Object]".

export function toDisplayText(value: unknown, fallback = 'Unknown'): string {
  if (value == null) return fallback;
  if (typeof value === 'string') return value.trim() || fallback;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const parts = value.map(v => toDisplayText(v, '')).map(s => s.trim()).filter(Boolean);
    return parts.length ? parts.join(', ') : fallback;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => {
        const normalized = toDisplayText(v, '').trim();
        return normalized ? `${k.toUpperCase()}: ${normalized}` : '';
      })
      .filter(Boolean);
    return entries.length ? entries.join(', ') : fallback;
  }
  return fallback;
}

export function toStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(v => toDisplayText(v, '')).map(s => s.trim()).filter(Boolean);
  if (value == null) return [];
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => {
        const normalized = toDisplayText(v, '').trim();
        return normalized ? `${k}: ${normalized}` : k;
      })
      .filter(Boolean);
  }
  const one = toDisplayText(value, '').trim();
  return one ? [one] : [];
}

export function toScore(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 50;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

export function normalizeReport(input: any): StrainReport {
  const decision = input?.buyDecision === 'Buy' || input?.buyDecision === 'Maybe' || input?.buyDecision === 'Skip'
    ? input.buyDecision
    : 'Maybe';
  const confidence = input?.confidence === 'low' || input?.confidence === 'medium' || input?.confidence === 'high'
    ? input.confidence
    : 'medium';

  return {
    strainName: toDisplayText(input?.strainName, 'Unknown strain'),
    brand: toDisplayText(input?.brand, 'Unknown'),
    brandNotes: toDisplayText(input?.brandNotes, ''),
    strainType: toDisplayText(input?.strainType, ''),
    productType: toDisplayText(input?.productType, 'Unknown'),
    cannabinoids: toDisplayText(input?.cannabinoids, 'Unknown'),
    terpenes: toStringList(input?.terpenes),
    matchScore: toScore(input?.matchScore),
    buyDecision: decision,
    quickTake: toDisplayText(input?.quickTake, 'No quick take available.'),
    whyThisScore: toDisplayText(input?.whyThisScore, ''),
    expectedEffects: toStringList(input?.expectedEffects),
    watchOuts: toStringList(input?.watchOuts),
    bestFor: toStringList(input?.bestFor),
    dosingGuidance: toDisplayText(input?.dosingGuidance, 'Start low and go slow.'),
    confidence,
    missingInfo: toStringList(input?.missingInfo)
  };
}
