# 1toke Cannabis Index

Strains, terpenes, effects, pros/cons and brands as structured JSON for the 1toke.co app.

**Status: experimental and not used by the app.** Nothing under `app/` or `lib/` imports it. Terpene IDs match `lib/terpenes.ts`.

Run the commands below from `data/cannabis-index/`. `dist/` is gitignored, so rebuild it locally with `build_index.py`.

```
data/            hand-edited source of truth
  strains.json   30 strains: type, lineage, THC/CBD range, dominant terpenes, effects, pros/cons
  terpenes.json  14 terpenes: aroma, where else they occur, associated effects, pros/cons
  effects.json   controlled vocabulary: feelings, negatives, helps_with
  brands.json    15 brands: categories, HQ state, notable strains
build_index.py   validates cross-references, adds derived fields, writes dist/
dist/index.json  single bundle for the app (also index.min.json)
types/index.ts   TypeScript types + recommend() helper for React
importers/       bulk-enrich from open lab data (Cannlytics, CC BY 4.0)
```

## Use

```bash
python build_index.py                                  # validate + build dist/
python build_index.py --recommend insomnia relaxed --avoid couchlock
```

In React: `import index from "./index.json"` and use `recommend(index, ["relaxed"], ["anxious"])`.

## Grow it with lab data

```bash
pip install datasets pandas
python importers/cannlytics_import.py --dry-run
python importers/cannlytics_import.py --add-new
python build_index.py
```

Add attribution where the data is shown: "Strain lab data: Cannlytics, CC BY 4.0".

## Data caveats

- Effects are user-reported, not medical claims. Show the `disclaimer` field in the app.
- Terpene profiles are typical for each strain. Real batches vary, so the lab certificate (COA) is what counts.
- Lineages marked "(disputed)" aren't settled. Brand info changes often; `website: null` means not verified.
- Don't scrape Leafly/Weedmaps: their terms forbid it, and nearly all the "strain datasets" on Kaggle are scrapes of them.
