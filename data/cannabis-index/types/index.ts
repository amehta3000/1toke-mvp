// Types for dist/index.json — drop into the 1toke.co React app.

export type StrainType = "indica" | "sativa" | "hybrid";
export type Lean = "indica" | "sativa" | "balanced";
export type TimeOfDay = "day" | "evening" | "night" | "any";

export interface EffectTag { id: string; label: string; sentiment?: "positive" | "neutral" }

export interface Terpene {
  id: string;
  name: string;
  aliases: string[];
  aroma: string[];
  also_found_in: string[];
  commonly_associated_effects: string[];
  pros: string[];
  cons: string[];
  research_level: string;
}

export interface LabProfile {
  samples: number;
  avg_thc: number | null;
  avg_cbd: number | null;
  top_terpenes: string[];
  terpenes_pct: Record<string, number>;
  source: string;
}

export interface Strain {
  id: string;
  name: string;
  aliases: string[];
  type: StrainType;
  lean: Lean;
  lineage: string[];
  thc_range: [number, number];
  cbd_range: [number, number];
  dominant_terpenes: string[]; // Terpene ids, most abundant first
  flavors: string[];
  effects: string[];     // EffectTag ids from effects.feelings
  negatives: string[];   // EffectTag ids from effects.negatives
  helps_with: string[];  // EffectTag ids from effects.helps_with
  time_of_day: TimeOfDay;
  pros: string[];
  cons: string[];
  // derived by build_index.py
  category: "thc" | "cbd";
  potency: "low" | "medium" | "high";
  aroma_from_terpenes: string[];
  brands: string[];
  search_text: string;
  lab_profile?: LabProfile;
  needs_review?: boolean;
}

export interface Brand {
  id: string;
  name: string;
  hq_state: string | null;
  website: string | null;
  categories: string[];
  notable_strains: string[];
  notes: string;
}

export interface TokeIndex {
  version: string;
  disclaimer: string;
  counts: { strains: number; terpenes: number; brands: number };
  effects: { feelings: EffectTag[]; negatives: EffectTag[]; helps_with: EffectTag[] };
  terpenes: Terpene[];
  strains: Strain[];
  brands: Brand[];
  indexes: {
    by_terpene: Record<string, string[]>;
    by_effect: Record<string, string[]>;
    by_helps_with: Record<string, string[]>;
  };
}

/** Same scoring as build_index.py --recommend. */
export function recommend(index: TokeIndex, want: string[], avoid: string[] = [], top = 5): Strain[] {
  return index.strains
    .map((s) => {
      const tags = new Set([...s.effects, ...s.helps_with]);
      const score =
        2 * want.filter((w) => tags.has(w)).length -
        3 * s.negatives.filter((n) => avoid.includes(n)).length;
      return { s, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.s.name.localeCompare(b.s.name))
    .slice(0, top)
    .map((x) => x.s);
}
