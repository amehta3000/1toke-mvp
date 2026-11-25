#!/usr/bin/env python3
"""Validate the 1toke index source data and build a single app-ready bundle.

Usage:
    python build_index.py                 # validate + write dist/index.json
    python build_index.py --recommend relaxed sleepy --avoid anxious
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).parent
DATA = ROOT / "data"
DIST = ROOT / "dist"

STRAIN_TYPES = {"indica", "sativa", "hybrid"}
LEANS = {"indica", "sativa", "balanced"}
TIMES = {"day", "evening", "night", "any"}


def load(name: str):
    return json.loads((DATA / f"{name}.json").read_text())


def validate(strains, terpenes, effects, brands) -> list[str]:
    errors: list[str] = []
    terp_ids = {t["id"] for t in terpenes}
    feel_ids = {e["id"] for e in effects["feelings"]}
    neg_ids = {e["id"] for e in effects["negatives"]}
    help_ids = {e["id"] for e in effects["helps_with"]}
    strain_ids: set[str] = set()

    for coll, label in ((terpenes, "terpene"), (strains, "strain"), (brands, "brand")):
        seen = set()
        for item in coll:
            if item["id"] in seen:
                errors.append(f"duplicate {label} id: {item['id']}")
            seen.add(item["id"])

    for t in terpenes:
        for e in t["commonly_associated_effects"]:
            if e not in feel_ids:
                errors.append(f"terpene {t['id']}: unknown effect '{e}'")

    for s in strains:
        sid = s["id"]
        strain_ids.add(sid)
        if s["type"] not in STRAIN_TYPES:
            errors.append(f"{sid}: bad type {s['type']}")
        if s["lean"] not in LEANS:
            errors.append(f"{sid}: bad lean {s['lean']}")
        if s["time_of_day"] not in TIMES:
            errors.append(f"{sid}: bad time_of_day {s['time_of_day']}")
        for key in ("thc_range", "cbd_range"):
            lo, hi = s[key]
            if not (0 <= lo <= hi <= 40):
                errors.append(f"{sid}: bad {key} {s[key]}")
        for t in s["dominant_terpenes"]:
            if t not in terp_ids:
                errors.append(f"{sid}: unknown terpene '{t}'")
        for field, valid in (("effects", feel_ids), ("negatives", neg_ids), ("helps_with", help_ids)):
            for v in s[field]:
                if v not in valid:
                    errors.append(f"{sid}: unknown {field} '{v}'")

    for b in brands:
        for sid in b["notable_strains"]:
            if sid not in strain_ids:
                errors.append(f"brand {b['id']}: unknown strain '{sid}'")
    return errors


def enrich(strains, terpenes, brands):
    terp = {t["id"]: t for t in terpenes}
    by_terpene, by_effect, by_helps = defaultdict(list), defaultdict(list), defaultdict(list)
    brands_for_strain = defaultdict(list)
    for b in brands:
        for sid in b["notable_strains"]:
            brands_for_strain[sid].append(b["id"])

    for s in strains:
        s["category"] = "cbd" if s["cbd_range"][1] >= 8 else "thc"
        s["potency"] = (
            "low" if s["thc_range"][1] < 15 else "high" if s["thc_range"][1] >= 25 else "medium"
        )
        s["aroma_from_terpenes"] = sorted(
            {a for t in s["dominant_terpenes"] for a in terp[t]["aroma"][:2]}
        )
        s["brands"] = brands_for_strain.get(s["id"], [])
        s["search_text"] = " ".join(
            [s["name"], *s["aliases"], *s["lineage"], *s["flavors"], s["type"], *s["dominant_terpenes"]]
        ).lower()
        for t in s["dominant_terpenes"]:
            by_terpene[t].append(s["id"])
        for e in s["effects"]:
            by_effect[e].append(s["id"])
        for h in s["helps_with"]:
            by_helps[h].append(s["id"])

    return {
        "by_terpene": dict(by_terpene),
        "by_effect": dict(by_effect),
        "by_helps_with": dict(by_helps),
    }


def recommend(strains, want: list[str], avoid: list[str], top: int = 5):
    """Score strains: +2 per wanted effect/helps_with match, -3 per negative to avoid."""
    scored = []
    for s in strains:
        tags = set(s["effects"]) | set(s["helps_with"])
        score = 2 * len(tags & set(want)) - 3 * len(set(s["negatives"]) & set(avoid))
        if score > 0:
            scored.append((score, s["name"], s["dominant_terpenes"]))
    return sorted(scored, key=lambda x: (-x[0], x[1]))[:top]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--recommend", nargs="*", help="desired effects / helps_with ids")
    ap.add_argument("--avoid", nargs="*", default=[], help="negative effect ids to avoid")
    args = ap.parse_args()

    strains, terpenes, effects, brands = load("strains"), load("terpenes"), load("effects"), load("brands")
    errors = validate(strains, terpenes, effects, brands)
    if errors:
        print("Validation failed:\n  " + "\n  ".join(errors), file=sys.stderr)
        return 1

    indexes = enrich(strains, terpenes, brands)

    if args.recommend is not None:
        for score, name, terps in recommend(strains, args.recommend, args.avoid):
            print(f"{score:>3}  {name:<22} {', '.join(terps)}")
        return 0

    bundle = {
        "version": date.today().isoformat(),
        "disclaimer": (
            "Effects are user-reported and vary by person, dose, and batch. "
            "Terpene profiles are typical, not guaranteed; check the product's lab COA. "
            "Not medical advice. 21+ where legal."
        ),
        "counts": {"strains": len(strains), "terpenes": len(terpenes), "brands": len(brands)},
        "effects": effects,
        "terpenes": terpenes,
        "strains": strains,
        "brands": brands,
        "indexes": indexes,
    }
    DIST.mkdir(exist_ok=True)
    (DIST / "index.json").write_text(json.dumps(bundle, indent=2, ensure_ascii=False))
    (DIST / "index.min.json").write_text(json.dumps(bundle, separators=(",", ":"), ensure_ascii=False))
    print(f"OK: {bundle['counts']} -> {DIST / 'index.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
