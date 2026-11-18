import { getSupabaseAdmin } from './supabase';

// The shared product catalog: one row per real product (brand + strain + form),
// plus dated, sourced observations of what's in it. Nothing here is tied to a
// person — observations never carry a user id or report id, so the catalog can
// be shared across everyone without becoming a record of who bought what.
//
// Identity is the hard part. "Blue Dream" covers dozens of brands with
// different chemistry, and the same brand's pod and eighth are different
// products. So the key is brand + strain + form, never the strain alone.
// Batch-to-batch variation is handled by keeping every observation and
// building the profile from them, rather than overwriting one record.

export type TerpeneReading = { name: string; pct: number | null };

// Where a reading came from, strongest first. The profile trusts the best
// tier available and never lets a model's from-memory guess outvote a label.
export type ObservationSource = 'label' | 'web' | 'typical';
const SOURCE_WEIGHT: Record<ObservationSource, number> = { label: 3, web: 2, typical: 1 };

export type Observation = {
  source: ObservationSource;
  thc_pct: number | null;
  cbd_pct: number | null;
  terpenes: TerpeneReading[];
  strain_type: string | null;
  observed_at: string;
};

export type ProductProfile = {
  productId: string;
  displayName: string;
  productType: string;
  terpenes: { name: string; weight: number }[]; // dominance-ordered, weights sum to 1
  thcPct: number | null;
  cbdPct: number | null;
  strainType: string | null;
  bestSource: ObservationSource | null;
  observations: number;
};

// ---------- normalisation ----------

const KNOWN_TERPENES = [
  'myrcene', 'limonene', 'caryophyllene', 'pinene', 'linalool', 'humulene', 'terpinolene',
  'ocimene', 'bisabolol', 'nerolidol', 'guaiol', 'valencene', 'camphene', 'eucalyptol', 'farnesene', 'terpineol'
];

export function slug(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, '-').slice(0, 80);
}

// Packaging noise that would otherwise split one product into many records.
const STRAIN_NOISE = /\b(\d+(\.\d+)?\s?(g|gram|grams|mg|oz|ml)|eighth|quarter|half|pod|cart|cartridge|disposable|pre ?roll|preroll|joint|infused|live resin|live rosin|rosin|badder|budder|sauce|diamonds|flower|smalls|popcorn|indica|sativa|hybrid|thc|cbd)\b/g;

export function strainSlug(strain: string, brand: string): string {
  let s = strain.toLowerCase();
  const b = brand.toLowerCase().trim();
  if (b && b !== 'unknown') s = s.split(b).join(' '); // "STIIIZY Blue Dream" → "Blue Dream"
  return slug(s.replace(STRAIN_NOISE, ' '));
}

export function productTypeBucket(raw: string): string {
  const t = (raw || '').toLowerCase();
  if (/pre.?roll|joint|blunt/.test(t)) return 'preroll';
  if (/vape|cart|pod|disposable|pen/.test(t)) return 'vape';
  if (/edible|gumm|chocolate|drink|beverage|mint|tablet|capsule/.test(t)) return 'edible';
  if (/concentrate|wax|shatter|rosin|resin|badder|budder|sauce|diamond|dab|hash|kief/.test(t)) return 'concentrate';
  if (/tincture|topical|balm|lotion/.test(t)) return 'other';
  if (/flower|bud|eighth|smalls|popcorn|\bg\b/.test(t)) return 'flower';
  return 'unknown';
}

// Accepts either the structured readings the model now returns or the older
// free-text list ("Limonene (0.8%)", "myrcene"), so past reports still count.
export function parseTerpenes(input: unknown): TerpeneReading[] {
  const out: TerpeneReading[] = [];
  const seen = new Set<string>();
  const items = Array.isArray(input) ? input : [];
  for (const item of items) {
    let name = '';
    let pct: number | null = null;
    if (item && typeof item === 'object') {
      name = String((item as any).name || '');
      const p = Number((item as any).pct);
      pct = Number.isFinite(p) && p > 0 && p < 10 ? p : null;
    } else {
      const text = String(item || '');
      name = text;
      const m = text.match(/(\d+(?:\.\d+)?)\s*%/);
      if (m) { const p = Number(m[1]); pct = p > 0 && p < 10 ? p : null; }
    }
    const lower = name.toLowerCase();
    let canonical = KNOWN_TERPENES.find(t => lower.includes(t)) || '';
    if (!canonical && lower.includes('cineole')) canonical = 'eucalyptol';
    if (!canonical || seen.has(canonical)) continue;
    seen.add(canonical);
    out.push({ name: canonical, pct });
  }
  return out.slice(0, 8);
}

// "THC 27.4% · CBD <1%" → { thc: 27.4, cbd: null }. Only accepts plausible
// flower/vape ranges; anything else is treated as unknown, not a number.
export function parseCannabinoids(input: unknown): { thc: number | null; cbd: number | null } {
  const text = String(input || '');
  const grab = (re: RegExp) => {
    const m = text.match(re);
    if (!m) return null;
    const v = Number(m[1]);
    return Number.isFinite(v) && v >= 0 && v <= 100 ? v : null;
  };
  return {
    thc: grab(/THC[^0-9]{0,12}(\d+(?:\.\d+)?)\s*%/i) ?? grab(/(\d+(?:\.\d+)?)\s*%\s*THC/i),
    cbd: grab(/CBD[^0-9]{0,12}(\d+(?:\.\d+)?)\s*%/i) ?? grab(/(\d+(?:\.\d+)?)\s*%\s*CBD/i)
  };
}

// ---------- profile ----------

// Dominance weights by rank when percentages are missing, so "listed first"
// still means "matters most".
const RANK_WEIGHTS = [1, 0.7, 0.5, 0.35, 0.25, 0.18, 0.12, 0.08];

export function terpeneWeights(readings: TerpeneReading[]): { name: string; weight: number }[] {
  if (!readings.length) return [];
  const hasPct = readings.every(r => r.pct !== null);
  const raw = readings.map((r, i) => ({ name: r.name, w: hasPct ? (r.pct as number) : RANK_WEIGHTS[i] || 0.05 }));
  const total = raw.reduce((s, r) => s + r.w, 0) || 1;
  return raw.map(r => ({ name: r.name, weight: r.w / total })).sort((a, b) => b.weight - a.weight);
}

export function buildProfile(productId: string, displayName: string, productType: string, obs: Observation[]): ProductProfile {
  // Use only the strongest tier that has any data: one label reading beats
  // any number of from-memory guesses. Within a tier, average across batches.
  const best = (['label', 'web', 'typical'] as ObservationSource[])
    .find(src => obs.some(o => o.source === src && (o.terpenes.length || o.thc_pct !== null))) || null;
  const pool = best ? obs.filter(o => o.source === best) : [];

  const terpTotals = new Map<string, number>();
  for (const o of pool) {
    for (const t of terpeneWeights(o.terpenes)) terpTotals.set(t.name, (terpTotals.get(t.name) || 0) + t.weight);
  }
  const terpSum = [...terpTotals.values()].reduce((s, v) => s + v, 0) || 1;
  const terpenes = [...terpTotals.entries()]
    .map(([name, v]) => ({ name, weight: v / terpSum }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 6);

  const median = (vals: number[]) => {
    if (!vals.length) return null;
    const s = [...vals].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };
  // Cannabinoids only from label or web: from-memory THC numbers are noise.
  const potencyPool = obs.filter(o => o.source !== 'typical');
  const strainTypes = obs.map(o => o.strain_type).filter(Boolean) as string[];

  return {
    productId, displayName, productType,
    terpenes,
    thcPct: median(potencyPool.map(o => o.thc_pct).filter((v): v is number => v !== null)),
    cbdPct: median(potencyPool.map(o => o.cbd_pct).filter((v): v is number => v !== null)),
    strainType: strainTypes[0] || null,
    bestSource: best,
    observations: obs.length
  };
}

// Good enough to score from without searching the web again.
export function profileIsSolid(p: ProductProfile | null): boolean {
  return Boolean(p && (p.bestSource === 'label' || p.bestSource === 'web') && p.terpenes.length >= 2);
}

// The profile rendered as the evidence block the scoring prompt already knows
// how to read, labelled with its source so the model applies the right tier.
export function profileAsContext(p: ProductProfile): string {
  const tier = p.bestSource === 'typical' ? 'TYPICAL (strain-level, from memory)' : 'VERIFIED';
  const terps = p.terpenes.map(t => `${t.name} (${Math.round(t.weight * 100)}% of terpene profile)`).join(', ');
  const lines = [
    `1Toke catalog record for ${p.displayName} — ${tier}, built from ${p.observations} observation(s), best source: ${p.bestSource}.`,
    terps ? `Dominant terpenes: ${terps}.` : '',
    p.thcPct !== null ? `THC: ${p.thcPct}%.` : '',
    p.cbdPct !== null ? `CBD: ${p.cbdPct}%.` : '',
    p.strainType ? `Labelled type: ${p.strainType}.` : ''
  ];
  return lines.filter(Boolean).join(' ');
}

// ---------- persistence ----------
// Every function here fails soft: the catalog makes scans faster and steadier,
// but a scan must never fail because the catalog is missing or down.

async function upsertNamed(table: 'brands' | 'strains', name: string, key: string): Promise<string | null> {
  const supabase = getSupabaseAdmin();
  if (!supabase || !key) return null;
  const { data } = await supabase.from(table).upsert({ name, slug: key }, { onConflict: 'slug' }).select('id').single();
  return (data as any)?.id || null;
}

export async function lookupProductByAlias(aliasKey: string): Promise<string | null> {
  const supabase = getSupabaseAdmin();
  if (!supabase || !aliasKey) return null;
  try {
    const { data } = await supabase.from('product_aliases').select('product_id').eq('alias_key', aliasKey).maybeSingle();
    return (data as any)?.product_id || null;
  } catch {
    return null;
  }
}

export async function loadProfile(productId: string): Promise<ProductProfile | null> {
  const supabase = getSupabaseAdmin();
  if (!supabase || !productId) return null;
  try {
    const [{ data: product }, { data: obs }] = await Promise.all([
      supabase.from('products').select('id, display_name, product_type').eq('id', productId).maybeSingle(),
      supabase.from('product_observations')
        .select('source, thc_pct, cbd_pct, terpenes, strain_type, observed_at')
        .eq('product_id', productId)
        .order('observed_at', { ascending: false })
        .limit(30)
    ]);
    if (!product) return null;
    return buildProfile((product as any).id, (product as any).display_name, (product as any).product_type, (obs || []) as Observation[]);
  } catch {
    return null;
  }
}

// Find or create the product a scan refers to. Exact brand+strain+form match
// first; failing that, the same brand and strain under an unknown form (or
// vice versa) is treated as the same product rather than forking a duplicate.
export async function resolveProduct(input: { brand: string; strain: string; productType: string }): Promise<string | null> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return null;
  const brandKey = input.brand && !/^unknown$/i.test(input.brand) ? slug(input.brand) : '';
  const strainKey = strainSlug(input.strain || '', input.brand || '');
  if (!strainKey || /^unknown(-strain)?$/.test(strainKey)) return null;
  const type = productTypeBucket(input.productType);
  const canonical = `${brandKey || 'nobrand'}|${strainKey}|${type}`;

  try {
    const { data: exact } = await supabase.from('products').select('id, product_type').eq('canonical_key', canonical).maybeSingle();
    if (exact) return (exact as any).id;

    const { data: siblings } = await supabase.from('products')
      .select('id, product_type, canonical_key')
      .like('canonical_key', `${brandKey || 'nobrand'}|${strainKey}|%`)
      .limit(5);
    const sibling = (siblings || []).find((s: any) => s.product_type === 'unknown' || type === 'unknown');
    if (sibling) {
      // Upgrade an unknown-form record once we learn its form.
      if ((sibling as any).product_type === 'unknown' && type !== 'unknown') {
        await supabase.from('products').update({ product_type: type, canonical_key: canonical }).eq('id', (sibling as any).id);
      }
      return (sibling as any).id;
    }

    const [brandId, strainId] = await Promise.all([
      brandKey ? upsertNamed('brands', input.brand.trim(), brandKey) : Promise.resolve(null),
      upsertNamed('strains', titleCase(strainKey), strainKey)
    ]);
    const displayName = [titleCase(strainKey), brandKey ? `· ${input.brand.trim()}` : ''].filter(Boolean).join(' ');
    const { data: created } = await supabase.from('products')
      .upsert({ brand_id: brandId, strain_id: strainId, product_type: type, canonical_key: canonical, display_name: displayName }, { onConflict: 'canonical_key' })
      .select('id')
      .single();
    return (created as any)?.id || null;
  } catch {
    return null;
  }
}

export async function addAliases(productId: string, aliasKeys: string[]): Promise<void> {
  const supabase = getSupabaseAdmin();
  const keys = [...new Set(aliasKeys.filter(Boolean))];
  if (!supabase || !productId || !keys.length) return;
  try {
    await supabase.from('product_aliases').upsert(keys.map(k => ({ alias_key: k, product_id: productId })), { onConflict: 'alias_key' });
  } catch { /* soft */ }
}

export async function addObservation(productId: string, obs: Omit<Observation, 'observed_at'>): Promise<void> {
  const supabase = getSupabaseAdmin();
  if (!supabase || !productId) return;
  if (!obs.terpenes.length && obs.thc_pct === null && obs.cbd_pct === null) return; // nothing learned
  try {
    await supabase.from('product_observations').insert({ product_id: productId, ...obs });
  } catch { /* soft */ }
}

function titleCase(key: string): string {
  return key.split('-').filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}
