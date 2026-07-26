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

## Enable accounts (email + 6-digit code)

Accounts are optional and frictionless: every visitor gets a silent anonymous
Supabase user, and adding an email later upgrades that same user — no data
migration, no passwords. One-time setup:

1. **Env var**: add `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Supabase → Settings → API
   → `anon` `public` key) locally and in Vercel. Without it the app runs in
   the legacy device-id mode.
2. **Anonymous sign-ins**: Supabase dashboard → Authentication → Sign In /
   Providers → enable **Anonymous sign-ins**.
3. **Email templates**: Authentication → Email Templates. In both **Magic
   Link** and **Change Email Address**, make sure the 6-digit code is in the
   body, e.g. `<p>Your 1Toke code: <b>{{ .Token }}</b></p>`. (Codes instead of
   links because the iOS home-screen app and Safari don't share sessions — a
   link would sign in the wrong one.)
4. **Re-run `supabase-schema.sql`** to enable row-level security (blocks
   direct table access with the now-public anon key; the server's service
   role is unaffected).
5. **Before real testers**: Supabase's built-in email sender allows only a
   few messages per hour. Wire custom SMTP (Authentication → Emails → SMTP
   settings; Resend's free tier works) on your domain.

How identity flows: API routes verify the caller's Supabase JWT and scope all
reads/writes to that user id, falling back to the legacy device id only for
pre-auth clients. On first load after this update, a device's old journal rows
are claimed into its new anonymous user automatically; signing into an
existing account from a new device merges that device's anonymous data in.

## Product notes

The first useful behavior is not perfect cannabis science. It is fast decision support in-store:

1. Is this likely a fit for my desired experience?
2. What might go wrong?
3. What information is missing?
4. How should I start low?
5. Should I buy, maybe, or skip?

## Expansion path

The same schema can support coffee, tea, wine, fragrance, or any subjective taste/effect domain by replacing the cannabis-specific report fields with domain-specific fields.
