import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import OpenAI from 'openai';
import { mockAnalyze } from '@/lib/mock';
import { normalizeReport, toDisplayText } from '@/lib/report';
import { getSupabaseAdmin } from '@/lib/supabase';
import { resolveUserId } from '@/lib/serverAuth';
import { REACTION_VALUES } from '@/lib/types';
import { checkScanLimit, clientIp, recordScan } from '@/lib/rateLimit';

export const runtime = 'nodejs';

function scrubHallucinations(report: any): any {
  // If confidence is low, this means the model was uncertain or didn't have enough info.
  // Remove all fields that require specific knowledge to prevent hallucinations.
  if (report.confidence === 'low') {
    return {
      strainName: 'Unknown',
      brand: '',
      brandNotes: '',
      strainType: '',
      productType: '',
      cannabinoids: '', // Don't make up THC/CBD %
      terpenes: [],    // Don't make up terpene profiles
      matchScore: 50, // Neutral score when unsure
      buyDecision: 'Maybe',
      quickTake: report.missingInfo?.join(', ') || 'Insufficient info. Please provide product name, label photo, or specific cannabinoid data.',
      whyThisScore: '',
      expectedEffects: [], // Don't invent effects
      watchOuts: [],
      bestFor: [],
      dosingGuidance: 'Cannot provide dosing guidance without product information. Please upload a label or specify the strain and THC/CBD %.',
      confidence: 'low',
      missingInfo: report.missingInfo || [
        'Product name or strain name',
        'Label photo showing cannabinoids',
        'Specific THC % or CBD %'
      ]
    };
  }
  return report;
}

// Pull the user's recent session logs and turn them into a compact digest the
// model can actually learn from. This is what makes the app get smarter as
// the journal grows.
async function buildHistoryDigest(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const supabase = getSupabaseAdmin();
  if (!supabase) return null;

  try {
    const { data, error } = await supabase
      .from('sessions')
      .select('created_at, strain_name, rating, feelings, notes, would_buy_again, reports(report)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(10);
    if (error || !data?.length) return null;

    const lines = data.map((s: any) => {
      const rep = s.reports?.report || {};
      const details = [
        toDisplayText(rep.terpenes, ''),
        toDisplayText(rep.cannabinoids, '')
      ].filter(Boolean).join('; ');
      const parts = [
        s.strain_name || toDisplayText(rep.strainName, 'Unknown strain'),
        details ? `(${details})` : '',
        s.rating ? `rated ${s.rating}/5` : '',
        Array.isArray(s.feelings) && s.feelings.length ? `felt: ${s.feelings.join(', ')}` : '',
        s.would_buy_again === true ? 'would buy again' : s.would_buy_again === false ? 'would NOT buy again' : '',
        s.notes ? `notes: "${String(s.notes).slice(0, 140)}"` : ''
      ].filter(Boolean);
      return `- ${parts.join(' — ')}`;
    });

    return lines.join('\n');
  } catch {
    return null; // History is a bonus, never a blocker.
  }
}

const FACTS_TTL_DAYS = 30;

function cacheKeyFor(subject: string): string {
  return subject.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, '-').slice(0, 120);
}

// Product research is user-independent and expensive to redo, and redoing it
// is exactly what made the same product score differently each scan.
async function getCachedFacts(key: string): Promise<string | null> {
  const supabase = getSupabaseAdmin();
  if (!supabase || !key) return null;
  try {
    const { data, error } = await supabase
      .from('product_facts')
      .select('context, created_at')
      .eq('cache_key', key)
      .maybeSingle();
    if (error || !data?.context) return null;
    const ageMs = Date.now() - new Date(data.created_at).getTime();
    if (ageMs > FACTS_TTL_DAYS * 86400000) return null;
    return data.context;
  } catch {
    return null; // Cache miss on any problem, including a missing table.
  }
}

async function putCachedFacts(key: string, subject: string, context: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  if (!supabase || !key || !context) return;
  try {
    await supabase
      .from('product_facts')
      .upsert({ cache_key: key, subject, context, created_at: new Date().toISOString() }, { onConflict: 'cache_key' });
  } catch {
    // Caching is an optimisation; never fail the request over it.
  }
}

const SCAN_TTL_DAYS = 30;

// Bump this whenever the scoring rubric in the system prompt changes. It is
// folded into the fingerprint along with the model name, so improving the
// rubric or upgrading OPENAI_MODEL invalidates every cached scan at once —
// without it, a better model's answer wouldn't reach anyone holding a cached
// verdict until the 30-day TTL expired or they manually re-scanned.
const SCORING_VERSION = '2026-10-17';

// What a score actually depends on: the person's toggles/dial, their recent
// logged sessions (the model weighs those heavily), and the scorer itself.
// Folding the history digest in means logging a new session correctly
// invalidates the cached verdict instead of freezing a stale one — the whole
// pitch is that it learns from the journal, so a cache that outlived that
// would be a bug.
function prefsFingerprint(prefs: any, historyDigest: string | null): string {
  const keys = Object.keys(prefs || {}).sort();
  const normalized = keys.map(k => `${k}=${String(prefs[k])}`).join('|');
  const history = historyDigest ? createHash('sha1').update(historyDigest).digest('hex') : 'none';
  const scorer = `${SCORING_VERSION}@${process.env.OPENAI_MODEL || 'gpt-4.1-mini'}`;
  return createHash('sha1').update(`${normalized}#${history}#${scorer}`).digest('hex').slice(0, 32);
}

// A previous scan of this exact product, scored against this exact profile, is
// a valid answer — serve it and skip the model entirely.
async function getCachedScan(userId: string | null, productKey: string, fingerprint: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase || !userId || !productKey) return null;
  try {
    const since = new Date(Date.now() - SCAN_TTL_DAYS * 86400000).toISOString();
    const { data, error } = await supabase
      .from('reports')
      .select('id, report, reaction, created_at')
      .eq('user_id', userId)
      .eq('product_key', productKey)
      .eq('prefs_fingerprint', fingerprint)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data?.report) return null;
    return data;
  } catch {
    return null; // A cache miss is always safe; fall through to a fresh scan.
  }
}

// Every scan is kept, not just the bought ones — that's both the person's scan
// history and the cache that feeds getCachedScan.
async function saveScan(userId: string | null, productKey: string, fingerprint: string, report: unknown, reaction: string | null = null) {
  const supabase = getSupabaseAdmin();
  if (!supabase || !userId) return null;
  try {
    const { data, error } = await supabase
      .from('reports')
      .insert({ user_id: userId, report, product_key: productKey || null, prefs_fingerprint: fingerprint, reaction })
      .select('id')
      .single();
    if (error) return null;
    return data?.id || null;
  } catch {
    return null;
  }
}

// One attempt at Tavily. Raw content because terpene percentages live in page
// tables that the short `content` snippet truncates — that, not "advanced"
// depth, is what recovers them. Basic depth returns in a fraction of the time.
async function searchOnce(query: string, apiKey: string, timeoutMs: number): Promise<string | null> {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query: query.slice(0, 380),
      max_results: 5,
      search_depth: 'basic',
      include_answer: true,
      include_raw_content: true
    }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!res.ok) return null;

  const data = (await res.json()) as any;
  const answer = data.answer ? `Summary: ${data.answer}` : '';
  const results = data.results?.slice(0, 5) || [];
  const resultTexts = results
    .map((r: any) => {
      // Prefer raw page text, but keep it bounded so the prompt stays sane.
      const body = String(r.raw_content || r.content || '').slice(0, 1200);
      return body.trim() ? `${r.title}: ${body}` : '';
    })
    .filter((s: string) => s.trim());

  const combined = [answer, ...resultTexts].filter(Boolean).join('\n\n');
  return combined || null;
}

// A single bounded attempt. The previous advanced-depth search with a 12s
// timeout and a retry could hold a scan for 24s on a cache miss — someone
// standing at a counter won't wait that long. A miss here is not silent: the
// model falls back to the labelled TYPICAL tier, and the 30-day facts cache
// means each product only pays this once.
async function searchWeb(query: string): Promise<string | null> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return null;
  try {
    return await searchOnce(query, apiKey, 8000);
  } catch (err) {
    console.warn('Tavily search attempt failed', { query: query.slice(0, 80), err: String(err) });
    return null;
  }
}

function buildSearchSubject(question: string, strainName: string): string {
  const normalizedStrain = toDisplayText(strainName, '').trim();
  if (normalizedStrain && !/^unknown(?:\s+strain)?$/i.test(normalizedStrain)) {
    return normalizedStrain;
  }

  const cleaned = question
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return 'Unknown strain';

  let candidate = cleaned
    .replace(/^(is|are|was|were|what\s+about|how\s+about|can|could|does|do)\s+/, '')
    .replace(/\b(cannabis|marijuana|weed|strain)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const splitPattern = /\b(any\s+good|good|for|effects?|help(?:ful)?|best|better|vs|versus|sleep(?:ing)?)\b/;
  const split = candidate.split(splitPattern);
  candidate = (split[0] || '').trim();

  if (!candidate) return 'Unknown strain';
  return candidate
    .split(' ')
    .slice(0, 5)
    .join(' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

async function analyzeWithModel(
  client: InstanceType<typeof OpenAI>,
  input: any[],
  model: string,
  searchContext?: string
): Promise<string> {
  const contextHint = searchContext
    ? `\n\nWeb search context (use to inform your analysis): ${searchContext}`
    : '';

  const systemMessage = input[0]?.content || '';
  const userMessage = input[1]?.content || [];

  const updatedInput = [
    { role: 'system' as const, content: systemMessage + contextHint },
    { role: 'user' as const, content: userMessage }
  ];

  const response = await client.responses.create({
    model,
    input: updatedInput as any,
    // Scoring must be reproducible: the same product and profile should not
    // swing 20 points between runs. Default temperature (1.0) made it do that.
    temperature: 0.2,
    text: { format: { type: 'json_object' } }
  });

  return response.output_text || '{}';
}

// Read just enough off a label photo to build a useful web search. Without
// this, photographed products could never be searched — the old flow only
// searched when the model happened to report low confidence.
async function identifyFromImage(
  client: InstanceType<typeof OpenAI>,
  model: string,
  imageDataUrl: string,
  question: string
): Promise<string> {
  try {
    const response = await client.responses.create({
      model,
      temperature: 0,
      input: [
        {
          role: 'system',
          content: 'Extract the cannabis product identity from the image. Return ONLY JSON: {"strainName": string, "brand": string}. Use "" for anything not clearly legible. Do not guess.'
        },
        {
          role: 'user',
          content: [
            { type: 'input_text', text: `Typed context (may be empty): ${question}` },
            { type: 'input_image', image_url: imageDataUrl }
          ]
        }
      ] as any,
      text: { format: { type: 'json_object' } }
    });
    const parsed = JSON.parse(response.output_text || '{}');
    const name = toDisplayText(parsed?.strainName, '').trim();
    const brand = toDisplayText(parsed?.brand, '').trim();
    return [name, brand].filter(v => v && !/^unknown$/i.test(v)).join(' ');
  } catch {
    return '';
  }
}

// Keep the headline number and the verdict from ever contradicting each other.
function decisionForScore(score: number): 'Buy' | 'Maybe' | 'Skip' {
  if (score >= 72) return 'Buy';
  if (score >= 45) return 'Maybe';
  return 'Skip';
}

function toErrorPayload(err: any) {
  const status = Number(err?.status) || 500;
  const code = String(err?.code || err?.type || 'unknown_error');
  const requestId = String(err?.requestID || err?.requestId || '');

  if (code === 'insufficient_quota' || status === 429) {
    return {
      status: 429,
      error: {
        message: 'Someone has been toking too much and needs to re-up some credits.',
        code,
        requestId,
        hint: 'OpenAI quota/rate limit reached. Check billing, usage limits, and API project settings.'
      }
    };
  }

  return {
    status: status >= 400 && status < 600 ? status : 500,
    error: {
      message: 'Could not analyze right now. Please try again in a minute.',
      code,
      requestId,
      hint: String(err?.message || 'Unknown API error')
    }
  };
}

type Emit = (event: Record<string, unknown>) => void;
type Outcome = { status: number; body: Record<string, unknown> };

// Two response shapes from one pipeline. A client that asks for NDJSON gets
// each real stage as it happens ("identified: L'Orange · CBX", "scoring") and
// then the result as the final line — so the screen shows actual progress
// instead of rotating filler copy. Anyone else gets the plain JSON as before.
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const wantsStream = (req.headers.get('accept') || '').includes('application/x-ndjson');

  if (!wantsStream) {
    const { status, body } = await runAnalyze(req, form, () => {});
    return NextResponse.json(body, { status });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send: Emit = event => {
        try { controller.enqueue(encoder.encode(JSON.stringify(event) + '\n')); } catch { /* client went away */ }
      };
      try {
        const outcome = await runAnalyze(req, form, send);
        send({ type: 'result', status: outcome.status, body: outcome.body });
      } catch (err) {
        console.error('Analyze stream failed', { err: String(err) });
        send({ type: 'result', status: 500, body: { error: { message: 'Could not analyze right now. Please try again in a minute.', code: 'stream_failed' } } });
      } finally {
        controller.close();
      }
    }
  });
  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      'x-accel-buffering': 'no'
    }
  });
}

async function runAnalyze(req: NextRequest, form: FormData, emit: Emit): Promise<Outcome> {
  const question = String(form.get('question') || '');
  const prefs = JSON.parse(String(form.get('preferences') || '{}'));
  const deviceId = String(form.get('deviceId') || '') || null;
  const file = form.get('image') as File | null;
  // "Scan it fresh": the saved read is wrong or the batch is different, so
  // ignore the cache and pay for a real look. The verdict they already gave
  // rides along so a new score doesn't wipe their own call.
  const force = String(form.get('force') || '') === '1';
  const rawPrior = String(form.get('priorReaction') || '');
  const priorReaction = (REACTION_VALUES as readonly string[]).includes(rawPrior) ? rawPrior : null;

  // Scope history and the scan cache to the same identity the rest of the API
  // resolves — a signed-in person's sessions live under their Supabase user id,
  // not the legacy device id, so keying off deviceId alone silently lost their
  // journal once they added an email.
  const userId = await resolveUserId(req, deviceId);

  // Mock mode still stores and caches when a database is configured, so the
  // scan history and verdict buttons are exercisable locally without keys.
  if (!process.env.OPENAI_API_KEY) {
    const historyDigest = await buildHistoryDigest(userId);
    const fingerprint = prefsFingerprint(prefs, historyDigest);
    const mockSubject = buildSearchSubject(question, '');
    const mockKey = /^unknown(?:\s+strain)?$/i.test(mockSubject) ? '' : cacheKeyFor(mockSubject);
    if (mockKey) emit({ type: 'stage', stage: 'identified', name: mockSubject });
    const cached = mockKey && !force ? await getCachedScan(userId, mockKey, fingerprint) : null;
    if (cached) {
      return { status: 200, body: {
        report: normalizeReport(cached.report), reportId: cached.id,
        reaction: cached.reaction || null, scannedAt: cached.created_at || null, mock: true, fromCache: true
      } };
    }
    emit({ type: 'stage', stage: 'scoring' });
    const report = mockAnalyze(question, prefs);
    const reportId = await saveScan(userId, mockKey, fingerprint, report, priorReaction);
    return { status: 200, body: { report, reportId, reaction: priorReaction, mock: true, fromCache: false } };
  }

  // Checked before any paid call is made.
  const ip = clientIp(req);
  const limit = await checkScanLimit(userId, ip);
  if (!limit.ok) {
    return { status: 429, body: { error: {
      message: `That’s a lot of scans ${limit.retryLabel === 'today' ? 'for one day' : 'in a few minutes'} — take a breather and try again ${limit.retryLabel === 'today' ? 'tomorrow' : 'shortly'}.`,
      code: 'rate_limited'
    } } };
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  let imageDataUrl: string | null = null;
  if (file && file.size > 0) {
    const bytes = Buffer.from(await file.arrayBuffer());
    imageDataUrl = `data:${file.type || 'image/jpeg'};base64,${bytes.toString('base64')}`;
  }
  const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
  if (imageDataUrl) emit({ type: 'stage', stage: 'reading' });

  // The journal lookup and reading the label don't depend on each other, so
  // they run side by side instead of one after the other.
  let historyDigest: string | null;
  let identified = '';
  try {
    [historyDigest, identified] = await Promise.all([
      buildHistoryDigest(userId),
      imageDataUrl ? identifyFromImage(client, model, imageDataUrl, question) : Promise.resolve('')
    ]);
  } catch {
    historyDigest = null;
  }
  const fingerprint = prefsFingerprint(prefs, historyDigest);

  const system = `You are 1Toke: a sharp, honest budtender friend helping an adult make a fast in-store buying decision. You hype products that genuinely fit this person and you are blunt when something is wrong for them. Never provide medical claims. Return ONLY valid JSON.

VOICE:
- quickTake and whyThisScore: casual, warm, a little playful. Talk like a knowledgeable friend, not a lab report. One or two punchy sentences each.
- dosingGuidance and watchOuts: straight, clear, zero jokes. Safety content stays serious.

PERSONALIZATION:
- Score against THIS user's preference toggles, tolerance, intensity target, and adventure mode (safe = stay close to what works, explore = adjacent new things, surprise = wildcards welcome).
- whyThisScore must tie the score to their profile in one sentence (e.g. "Limonene-forward matches your citrus + creative lean, but 31% THC is punchy for your medium tolerance.").

SCORING RUBRIC — follow this arithmetic exactly. The same product and the same
profile MUST always produce the same score. Do not score on general impression.

Start at 50, then adjust:
+8  for each effect the user wants that this product credibly delivers (cap +24)
+5  for each flavor/terpene the user likes that is actually present (cap +10)
+6  if potency suits their stated tolerance and intensity target
-12 for each item on the user's "avoid" list this product plausibly triggers (no cap — these dominate)
-8  if potency clearly overshoots their tolerance/intensity, -5 if it clearly undershoots
-10 if the product type is a poor fit for what they described wanting
Adventure mode: safe = -5 for an unfamiliar profile; explore = no adjustment;
surprise = +5 for something novel.
Session history (when provided): up to +15 when the profile closely matches a
4-5★ logged session, up to -15 when it matches a 1-2★ one.
Head/body lean: the user's preference toggles include headBodyLean, 0-100
(0 = purely head/cerebral, 100 = purely body/physical). Estimate where this
product's actual terpene profile falls on the same 0-100 scale (myrcene/
linalool-dominant reads high/body; limonene/pinene/terpinolene-dominant reads
low/head) — only when you have VERIFIED or TYPICAL terpene evidence, never
guess this from the strain name alone. +8 if your estimate is within 15
points of headBodyLean, -8 if it's 50+ points apart, otherwise no adjustment.

Then clamp to 0-100 and round to the nearest whole number.

EVIDENCE TIERS — score using the best tier available, and say which you used:
- VERIFIED (full weight): values you can read off the label photo, lab results,
  or the web search context. Terpene lists and THC/CBD numbers from these are
  facts about this product.
- TYPICAL (half weight, and you MUST label it): for strains whose profile is
  genuinely well documented, you may use the strain's characteristic terpene
  and effect profile even without this batch's lab data. Say so plainly —
  "typical for this strain, not this batch's numbers" — in quickTake or
  whyThisScore, put the terpenes in the terpenes array, and add "this batch's
  lab data" to missingInfo. Cannabinoid percentages vary far too much between
  batches to state from memory: leave cannabinoids "" unless verified.
- UNKNOWN (zero weight): a strain you do not genuinely know. Do not guess.
  Unknown attributes never move the score in either direction.

Do not report a well-known strain as entirely unknown just because the search
came back thin — fall back to the TYPICAL tier and label it.
- If you have neither VERIFIED nor TYPICAL evidence, the score must stay within
  45-55 regardless of how appealing the product sounds, and confidence is at
  most "medium". In that case whyThisScore must say plainly that the score is
  middling because nothing could be verified — not invent a reason — and
  missingInfo must list what is missing.
- Web search context, when provided, is the best available evidence. Read it
  carefully for a dominant terpene list and THC/CBD percentages before
  concluding anything is unknown.

BUY DECISION BANDS (mechanical, no judgement):
- 72-100 → "Buy"
- 45-71  → "Maybe"
- 0-44   → "Skip"
${historyDigest ? `
SESSION HISTORY (this user's real logged outcomes, newest first — weigh heavily; it beats generic strain lore):
${historyDigest}

If the product resembles something they logged (same strain, terpene profile, or potency band), say so explicitly in quickTake or whyThisScore, e.g. "Same limonene-heavy profile as L'Orange, which you rated 5/5." Low-rated history with a similar profile should drag the score down and show up in watchOuts.` : ''}

STRAIN TYPE:
- strainType: one of "Sativa", "Indica", "Hybrid — sativa-leaning", "Hybrid — indica-leaning", "Hybrid — balanced", or "" if you genuinely don't know. Use the label or well-documented lineage; do not guess from the name alone.

LABEL CHECK — Indica/Sativa/Hybrid printed on packaging is frequently marketing,
not chemistry; the terpene profile is the more honest signal.
- labelCheck: ONLY set this (as one sentence) when you have VERIFIED or TYPICAL
  terpene evidence AND that evidence meaningfully conflicts with the printed
  strainType — e.g. labeled "Indica" but limonene/pinene-forward (reads
  head/uplifting), or labeled "Sativa" but myrcene-dominant (reads body/
  sedating). Name the terpenes and say plainly it reads closer to the other
  lean than the label suggests. Otherwise omit labelCheck entirely (do not
  return an empty string) — most products won't have a meaningful mismatch,
  and inventing one defeats the point.

BRAND INTEL:
- brandNotes: 1–2 short, useful sentences about the brand ONLY if you actually recognize it — reputation (well-regarded, budget shelf, premium), how established they are, and anything genuinely notable (solventless extraction, single-farm flower, known for accurate labeling, etc.). Same honest voice as quickTake. If you don't recognize the brand, return "" — never invent a reputation.

🚫 STRICT NO-HALLUCINATION RULE:
If you do not have CONCRETE information, DO NOT INCLUDE IT. Don't guess, don't infer, don't use generic knowledge:
- If you don't know the THC/CBD %, set cannabinoids to empty string ""
- If you don't know terpenes, return empty array []
- If you don't know effects, return empty array []
- If you don't see a product name/label, set strainName to "Unknown"
- If unsure about effects, effects should be EMPTY not speculated
- If you don't recognize the brand, brandNotes must be ""
- If the sativa/indica leaning isn't on the label or well documented, strainType must be ""

CONFIDENCE LEVELS:
- HIGH: You found actual product name, real label with THC/CBD %, terpene data, verified effects. Confidence ONLY if you have concrete details.
- MEDIUM: You have product name/strain but missing one detail (terpenes, or exact THC%). Include only what you know.
- LOW: User input was vague ("good for vibes?" without strain name/label). Include NOTHING speculative. Set effects, terpenes, cannabinoids to empty/null.

When confidence is LOW, set these fields explicitly:
- cannabinoids: ""
- terpenes: []
- expectedEffects: []
- watchOuts: []
- bestFor: []
- matchScore: 50
- buyDecision: "Maybe"
- missingInfo: List exactly what data you need (e.g., "strain name", "THC percentage from label", "product label photo")

Return JSON with: strainName, brand, brandNotes, strainType, productType, cannabinoids (or ""), terpenes array, matchScore 0-100, buyDecision, quickTake, whyThisScore, expectedEffects array, watchOuts array, bestFor array, dosingGuidance, confidence, missingInfo array, labelCheck (string, omit if no meaningful mismatch).`;

  const userText = `Analyze this product/strain for a quick in-store buying decision.
Question or typed label: ${question}
User preference toggles: ${JSON.stringify(prefs)}
Return JSON with: strainName, brand, brandNotes, strainType, productType, cannabinoids, terpenes array, matchScore 0-100, buyDecision Buy|Maybe|Skip, quickTake, whyThisScore, expectedEffects array, watchOuts array, bestFor array, dosingGuidance, confidence low|medium|high, missingInfo array, labelCheck (string, omit if no meaningful mismatch).`;

  const input: any[] = [{ role: 'system', content: system }];
  input.push({
    role: 'user',
    content: imageDataUrl
      ? [{ type: 'input_text', text: userText }, { type: 'input_image', image_url: imageDataUrl }]
      : [{ type: 'input_text', text: userText }]
  });

  try {
    let searchAttempted = false;
    let searchTerm = '';
    let searchLabel = '';
    let searchFound = false;

    // The pipeline is deliberately the same shape on every run: identify →
    // search → score. Previously the search only fired when the model happened
    // to report low confidence, so identical input could take two different
    // paths and produce very different scores and terpene data.
    let searchSubject = buildSearchSubject(question, '');
    if (identified) searchSubject = identified;

    let searchContext: string | null = null;
    let searchCached = false;
    const hasSubject = Boolean(searchSubject) && !/^unknown(?:\s+strain)?$/i.test(searchSubject);
    const productKey = hasSubject ? cacheKeyFor(searchSubject) : '';
    if (hasSubject) emit({ type: 'stage', stage: 'identified', name: searchSubject });

    // Scanning the same jar again, with the same profile and the same journal
    // behind it, has exactly one right answer — the one already stored. Serve
    // it and spend no tokens: a typed re-scan costs zero model calls, and a
    // photo re-scan costs only the one vision call needed to know what it is.
    if (productKey && !force) {
      const cached = await getCachedScan(userId, productKey, fingerprint);
      if (cached) {
        return { status: 200, body: {
          report: normalizeReport(cached.report),
          reportId: cached.id,
          reaction: cached.reaction || null,
          scannedAt: cached.created_at || null,
          mock: false,
          fromCache: true,
          searchAttempted: false,
          searchTerm: '',
          searchLabel: searchSubject,
          searchFound: false,
          searchCached: false,
          usedHistory: Boolean(historyDigest)
        } };
      }
    }

    // From here on this is a fresh, paid scan — count it.
    await recordScan(userId, ip);

    if (hasSubject) {
      searchLabel = searchSubject;
      searchTerm = `${searchSubject} cannabis strain dominant terpene profile THC CBD percentage effects`;
      searchAttempted = true;

      searchContext = await getCachedFacts(productKey);
      searchCached = Boolean(searchContext);

      if (!searchContext && process.env.TAVILY_API_KEY) {
        emit({ type: 'stage', stage: 'researching' });
        searchContext = await searchWeb(searchTerm);
        if (searchContext) await putCachedFacts(productKey, searchSubject, searchContext);
      }
      searchFound = Boolean(searchContext);
    }

    emit({ type: 'stage', stage: 'scoring' });
    const raw = await analyzeWithModel(client, input, model, searchContext || undefined);
    let parsed: unknown = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { quickTake: raw };
    }
    let report = normalizeReport(parsed);
    report = scrubHallucinations(report);
    // Round to the nearest 5: the score is not meaningfully precise to a
    // single point, and showing 57 vs 60 implies a difference that isn't real.
    const rounded = Math.max(0, Math.min(100, Math.round(report.matchScore / 5) * 5));
    // Derive the verdict from the score so the two can never disagree.
    report = { ...report, matchScore: rounded, buyDecision: decisionForScore(rounded) };

    // Keep every scan, not just the bought ones: this is the person's scan
    // history and the cache a repeat scan is served from. A low-confidence
    // read is deliberately not cached — it says nothing worth replaying.
    const reportId = report.confidence === 'low'
      ? null
      : await saveScan(userId, productKey, fingerprint, report, priorReaction);

    return { status: 200, body: { report, reportId, reaction: priorReaction, mock: false, fromCache: false, searchAttempted, searchTerm, searchLabel, searchFound, searchCached, usedHistory: Boolean(historyDigest) } };
  } catch (err: any) {
    const payload = toErrorPayload(err);
    console.error('Analyze API failed', {
      status: payload.status,
      code: payload.error.code,
      requestId: payload.error.requestId,
      hint: payload.error.hint
    });
    return { status: payload.status, body: { error: payload.error } };
  }
}
