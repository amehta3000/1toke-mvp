#!/usr/bin/env python3
"""Pull lab-tested terpene/cannabinoid averages from Cannlytics' open datasets
(Hugging Face, CC BY 4.0) and merge them into data/strains.json.

Requires network access to huggingface.co:
    pip install datasets pandas
    python importers/cannlytics_import.py --dataset cannlytics/cannabis_strains --dry-run
    python importers/cannlytics_import.py --dataset cannlytics/cannabis_strains --add-new

What it does:
  * Existing strains (matched by name/alias) get a `lab_profile` block with
    average THC/CBD and their top terpenes measured in real lab results.
  * With --add-new, unmatched strains are appended as `needs_review: true`
    stubs so you can fill in effects/pros/cons by hand or from reviews.

Attribution required by CC BY 4.0: "Strain lab data: Cannlytics (cannlytics.com), CC BY 4.0".
Column names differ between Cannlytics datasets, so they're matched loosely below;
run with --dry-run first and check the printed column list.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"

# Cannlytics column name -> our terpene id
TERPENE_COLUMNS = {
    "beta_myrcene": "myrcene", "myrcene": "myrcene",
    "d_limonene": "limonene", "limonene": "limonene",
    "beta_caryophyllene": "caryophyllene", "caryophyllene": "caryophyllene",
    "alpha_pinene": "pinene", "beta_pinene": "pinene", "pinene": "pinene",
    "linalool": "linalool",
    "alpha_humulene": "humulene", "humulene": "humulene",
    "terpinolene": "terpinolene",
    "ocimene": "ocimene", "beta_ocimene": "ocimene",
    "alpha_bisabolol": "bisabolol", "bisabolol": "bisabolol",
    "nerolidol": "nerolidol", "trans_nerolidol": "nerolidol",
    "eucalyptol": "eucalyptol", "geraniol": "geraniol",
    "valencene": "valencene", "guaiol": "guaiol",
}
NAME_COLS = ("strain_name", "strain", "name", "product_name")
THC_COLS = ("total_thc", "thc", "delta_9_thc")
CBD_COLS = ("total_cbd", "cbd")


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def pick(cols, options):
    return next((c for c in options if c in cols), None)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", default="cannlytics/cannabis_strains")
    ap.add_argument("--split", default="train")
    ap.add_argument("--min-samples", type=int, default=3, help="min lab results per strain")
    ap.add_argument("--add-new", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    from datasets import load_dataset  # imported lazily so --help works without it

    df = load_dataset(args.dataset, split=args.split).to_pandas()
    cols = set(df.columns)
    print(f"{len(df)} rows; columns: {sorted(cols)[:60]}")

    name_col = pick(cols, NAME_COLS)
    if not name_col:
        raise SystemExit("No strain-name column found; update NAME_COLS.")
    thc_col, cbd_col = pick(cols, THC_COLS), pick(cols, CBD_COLS)
    terp_cols = {c: t for c, t in TERPENE_COLUMNS.items() if c in cols}

    df = df[df[name_col].notna()].copy()
    df["_slug"] = df[name_col].astype(str).map(slug)
    numeric = [c for c in [thc_col, cbd_col, *terp_cols] if c]
    for c in numeric:
        df[c] = df[c].apply(lambda v: v if isinstance(v, (int, float)) else None).astype(float)
    grouped = df.groupby("_slug")
    agg = grouped[numeric].mean()
    agg["n"] = grouped.size()
    agg["display_name"] = grouped[name_col].first()
    agg = agg[agg["n"] >= args.min_samples]

    strains = json.loads((DATA / "strains.json").read_text())
    lookup = {}
    for s in strains:
        for n in [s["name"], *s["aliases"]]:
            lookup[slug(n)] = s

    matched, added = 0, 0
    for key, row in agg.iterrows():
        terp_totals: dict[str, float] = {}
        for col, tid in terp_cols.items():
            v = row.get(col)
            if v == v and v:  # not NaN, not zero
                terp_totals[tid] = terp_totals.get(tid, 0) + float(v)
        top = [t for t, _ in sorted(terp_totals.items(), key=lambda kv: -kv[1])[:3]]
        lab = {
            "samples": int(row["n"]),
            "avg_thc": round(float(row[thc_col]), 2) if thc_col and row[thc_col] == row[thc_col] else None,
            "avg_cbd": round(float(row[cbd_col]), 2) if cbd_col and row[cbd_col] == row[cbd_col] else None,
            "top_terpenes": top,
            "terpenes_pct": {k: round(v, 3) for k, v in terp_totals.items()},
            "source": f"Cannlytics {args.dataset} (CC BY 4.0)",
        }
        if key in lookup:
            lookup[key]["lab_profile"] = lab
            matched += 1
        elif args.add_new and top:
            strains.append({
                "id": key, "name": row["display_name"], "aliases": [], "type": "hybrid", "lean": "balanced",
                "lineage": [], "thc_range": [0, 0], "cbd_range": [0, 0], "dominant_terpenes": top,
                "flavors": [], "effects": [], "negatives": [], "helps_with": [], "time_of_day": "any",
                "pros": [], "cons": [], "lab_profile": lab, "needs_review": True,
            })
            added += 1

    print(f"matched {matched} existing strains, added {added} new stubs")
    if not args.dry_run:
        (DATA / "strains.json").write_text(json.dumps(strains, indent=2, ensure_ascii=False))
        print("wrote data/strains.json — filter `needs_review` stubs in the app until effects/pros/cons are filled in")


if __name__ == "__main__":
    main()
