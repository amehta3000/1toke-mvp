# 1Toke MVP

A phone-first buying assistant and personal preference journal for cannabis products.

## What it does

- Upload or take a photo of a package/menu/label.
- Ask a quick question about a strain.
- Returns a personal buying decision: Buy / Maybe / Skip.
- Shows match score, a "why this score" line, expected effects, best-for ideas, watch-outs, dose guidance, and missing info.
- First-run onboarding builds the taste profile in ~30 seconds; preference toggles stay editable in Profile.
- Journal: save products you bought, then log sessions against them later (feelings, star rating, buy-again, notes) — multiple sessions per product.
- The analyze endpoint feeds your last 10 logged sessions back into the model, so reports get more personal as the journal grows.
- Discover computes real patterns from your logs: repeat-worthy strains, terpene wins, and duds to dodge.
- Works in mock mode without API keys.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000` on desktop, or use your local network URL from your phone.

## Enable AI analysis

Create `.env.local`:

```bash
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4.1-mini
```

The app uses the OpenAI Responses API with image input.

## Enable database saves

Create a Supabase project, run `supabase-schema.sql` (re-run it after pulling this version — it adds a `sessions` table for journal logs), then add:

```bash
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

For production, add Supabase Auth and row-level security. This MVP uses server-side service role only for speed.

## Product notes

The first useful behavior is not perfect cannabis science. It is fast decision support in-store:

1. Is this likely a fit for my desired experience?
2. What might go wrong?
3. What information is missing?
4. How should I start low?
5. Should I buy, maybe, or skip?

## Expansion path

The same schema can support coffee, tea, wine, fragrance, or any subjective taste/effect domain by replacing the cannabis-specific report fields with domain-specific fields.
