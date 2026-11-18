import { createHash } from 'crypto';
import { getSupabaseAdmin } from './supabase';
import { parseCannabinoids, parseTerpenes, productTypeBucket, terpeneWeights } from './catalog';
import { leanOf } from './scorer';

// A person's learned taste, rebuilt from everything they've told us: journal
// ratings, feelings, would-buy-again, and Want it / Pass on scans.
//
// It learns over terpenes, not products, because every product shares the
// same small set of terpenes. That's what makes it work with a handful of
// sessions: rating one limonene-heavy jar teaches something about the next
// limonene-heavy jar, even one nobody has scanned before.
//
// Rebuilt from scratch each time a signal changes (a few hundred rows at
// most), so edits and deletes are always reflected exactly — no drift from
// incremental updates.

export type Taste = {
  version: 1;
  terpenes: Record<string, number>;     // affinity, -1 (bad experiences) .. 1 (loved)
  productTypes: Record<string, number>; // same scale
  likedLean: number | null;             // 0 head .. 100 body, from things they liked
  likedThc: number | null;              // typical THC % of things they liked
  dislikedThc: number | null;           // ...and of things they didn't
  topFeelings: string[];                // feelings they report most when it went well
  badFeelings: string[];                // feelings they report when it went badly
  signals: number;
  updatedAt: string;
};

// Pulls toward zero until there's real evidence: one 5★ session shouldn't
// make limonene a +1 for life.
const PRIOR = 1.5;
const NEGATIVE_FEELINGS = new Set(['Anxious', 'Foggy']);

type Signal = { value: number; weight: number; terpenes: unknown; cannabinoids: unknown; productType: unknown; feelings: string[] };

export function computeTaste(signals: Signal[]): Taste {
  const terp = new Map<string, { sum: number; n: number }>();
  const types = new Map<string, { sum: number; n: number }>();
  const liked: { lean: number[]; thc: number[] } = { lean: [], thc: [] };
  const disliked: number[] = [];
  const good = new Map<string, number>();
  const bad = new Map<string, number>();
  let count = 0;

  for (const s of signals) {
    if (!s.value && !s.feelings.length) continue;
    count++;
    const terps = terpeneWeights(parseTerpenes(s.terpenes));
    for (const t of terps) {
      const cur = terp.get(t.name) || { sum: 0, n: 0 };
      cur.sum += s.value * t.weight * s.weight;
      cur.n += t.weight * s.weight;
      terp.set(t.name, cur);
    }
    const type = productTypeBucket(String(s.productType || ''));
    if (type !== 'unknown') {
      const cur = types.get(type) || { sum: 0, n: 0 };
      cur.sum += s.value * s.weight;
      cur.n += s.weight;
      types.set(type, cur);
    }
    // Potency memory is flower-scale only; mixing in 85% carts would make the
    // "THC that went badly" number meaningless.
    const parsedThc = parseCannabinoids(s.cannabinoids).thc;
    const thc = parsedThc !== null && parsedThc <= 40 && type !== 'vape' && type !== 'concentrate' ? parsedThc : null;
    if (s.value > 0.2) {
      const lean = leanOf(terps);
      if (lean !== null) liked.lean.push(lean);
      if (thc !== null) liked.thc.push(thc);
      for (const f of s.feelings) good.set(f, (good.get(f) || 0) + 1);
    } else if (s.value < -0.2) {
      if (thc !== null) disliked.push(thc);
      for (const f of s.feelings) bad.set(f, (bad.get(f) || 0) + 1);
    }
  }

  const affinity = (m: Map<string, { sum: number; n: number }>) =>
    Object.fromEntries([...m.entries()].map(([k, v]) => [k, round2(v.sum / (v.n + PRIOR))]));
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k]) => k);

  return {
    version: 1,
    terpenes: affinity(terp),
    productTypes: affinity(types),
    likedLean: avg(liked.lean),
    likedThc: avg(liked.thc),
    dislikedThc: avg(disliked),
    topFeelings: top(good),
    badFeelings: top(bad),
    signals: count,
    updatedAt: new Date().toISOString()
  };
}

// Journal entries are the strong signal (they actually tried it). A Want it /
// Pass on a scan is weaker — it's a reaction to the verdict, before trying.
function sessionSignal(s: any) {
  let value = 0;
  if (Number.isInteger(s.rating)) value += (s.rating - 3) / 2;
  if (s.would_buy_again === true) value += 0.3;
  if (s.would_buy_again === false) value -= 0.3;
  const feelings: string[] = Array.isArray(s.feelings) ? s.feelings.filter((f: unknown) => typeof f === 'string') : [];
  // Feeling foggy or anxious is a bad outcome even on a generous star rating.
  value -= 0.25 * feelings.filter(f => NEGATIVE_FEELINGS.has(f)).length;
  return { value: Math.max(-1, Math.min(1, value)), feelings };
}

export async function recomputeTaste(userId: string | null): Promise<Taste | null> {
  const supabase = getSupabaseAdmin();
  if (!supabase || !userId) return null;
  try {
    const [sessions, reactions] = await Promise.all([
      supabase.from('sessions')
        .select('rating, feelings, would_buy_again, report_id, reports(report)')
        .eq('user_id', userId).order('created_at', { ascending: false }).limit(200),
      supabase.from('reports')
        .select('id, reaction, report')
        .eq('user_id', userId).not('reaction', 'is', null)
        .order('created_at', { ascending: false }).limit(200)
    ]);

    const signals: Signal[] = [];
    // A scan that was also logged in the journal counts once, as the journal entry.
    const logged = new Set<string>();
    for (const s of (sessions.data || []) as any[]) {
      if (s.report_id) logged.add(s.report_id);
      const rep = s.reports?.report || {};
      const { value, feelings } = sessionSignal(s);
      signals.push({ value, weight: 1, feelings, terpenes: rep.terpenes, cannabinoids: rep.cannabinoids, productType: rep.productType });
    }
    for (const r of (reactions.data || []) as any[]) {
      if (logged.has(r.id)) continue;
      const value = r.reaction === 'good' ? 0.4 : r.reaction === 'pass' ? -0.4 : 0;
      const rep = r.report || {};
      signals.push({ value, weight: 0.5, feelings: [], terpenes: rep.terpenes, cannabinoids: rep.cannabinoids, productType: rep.productType });
    }

    const taste = computeTaste(signals);
    await supabase.from('user_taste').upsert({ user_id: userId, taste, updated_at: taste.updatedAt }, { onConflict: 'user_id' });
    return taste;
  } catch {
    return null; // Taste is a bonus, never a blocker.
  }
}

export async function loadTaste(userId: string | null): Promise<Taste | null> {
  const supabase = getSupabaseAdmin();
  if (!supabase || !userId) return null;
  try {
    const { data, error } = await supabase.from('user_taste').select('taste').eq('user_id', userId).maybeSingle();
    if (error) return null; // table not migrated yet
    if ((data as any)?.taste?.version === 1) return (data as any).taste as Taste;
    return await recomputeTaste(userId); // first time: build it
  } catch {
    return null;
  }
}

// Changes only when the taste meaningfully moves, so logging one more
// session doesn't throw away every cached verdict the way hashing the raw
// journal text did.
export function tasteHash(taste: Taste | null): string {
  if (!taste || !taste.signals) return 'none';
  const q = (v: number) => Math.round(v * 4) / 4;
  const terps = Object.entries(taste.terpenes).filter(([, v]) => Math.abs(q(v)) >= 0.25)
    .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}${q(v)}`).join(',');
  const lean = taste.likedLean === null ? '' : Math.round(taste.likedLean / 20);
  const thc = taste.dislikedThc === null ? '' : Math.round(taste.dislikedThc / 5);
  return createHash('sha1').update(`${terps}|${lean}|${thc}`).digest('hex').slice(0, 12);
}

// The compact, structured version of "what this person likes" for the prompt.
export function tasteSummary(taste: Taste | null): string | null {
  if (!taste || !taste.signals) return null;
  const entries = Object.entries(taste.terpenes).sort((a, b) => b[1] - a[1]);
  const fmt = ([k, v]: [string, number]) => `${k} (${v > 0 ? '+' : ''}${v})`;
  const loves = entries.filter(([, v]) => v >= 0.2).slice(0, 4).map(fmt);
  const dislikes = entries.filter(([, v]) => v <= -0.2).reverse().slice(0, 4).map(fmt);
  const lines = [
    `Learned from ${taste.signals} rated experience(s). Affinity runs -1 (bad experiences) to +1 (loved); small numbers mean little evidence.`,
    loves.length ? `Terpenes that have gone well: ${loves.join(', ')}.` : '',
    dislikes.length ? `Terpenes that have gone badly: ${dislikes.join(', ')}.` : '',
    taste.likedLean !== null ? `What they've liked leans ${taste.likedLean}/100 (0 head, 100 body).` : '',
    taste.likedThc !== null ? `THC of things they liked: ~${taste.likedThc}%.` : '',
    taste.dislikedThc !== null ? `THC of things that went badly: ~${taste.dislikedThc}%.` : '',
    taste.topFeelings.length ? `When it goes well they feel: ${taste.topFeelings.join(', ')}.` : '',
    taste.badFeelings.length ? `When it goes badly they feel: ${taste.badFeelings.join(', ')}.` : ''
  ];
  return lines.filter(Boolean).join('\n');
}

function round2(n: number) { return Math.round(n * 100) / 100; }
