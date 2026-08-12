import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { mockAnalyze } from '@/lib/mock';
import { normalizeReport, toDisplayText } from '@/lib/report';
import { getSupabaseAdmin } from '@/lib/supabase';
import { resolveUserId } from '@/lib/serverAuth';
import { getPreferenceProfile } from '@/lib/preferenceStore';
import { topSignals } from '@/lib/preferenceVector';

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

// Turn the learned preference vector (see lib/preferenceVector.ts) into a
// short, deterministic digest for the prompt. Unlike the history digest above
// this isn't the LLM inferring a pattern from a pile of raw sessions — the
// weighting math already happened in code; the model just has to apply it.
async function buildLearnedSignalDigest(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const supabase = getSupabaseAdmin();
  if (!supabase) return null;

  try {
    const profile = await getPreferenceProfile(supabase, userId);
    const signals = topSignals(profile.vector);
    if (!signals.length) return null;
    return signals.map(([key, score]) => `${key}: ${score > 0 ? '+' : ''}${score.toFixed(2)}`).join(', ');
  } catch {
    return null; // Same as history: a bonus, never a blocker.
  }
}

async function searchWeb(query: string): Promise<string | null> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query: query.slice(0, 100),
        max_results: 5,
        include_answer: true
      }),
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) return null;

    const data = (await res.json()) as any;
    const answer = data.answer ? `Summary: ${data.answer}` : '';
    const results = data.results?.slice(0, 5) || [];
    const resultTexts = results
      .map((r: any) => `${r.title}: ${r.content || ''}`)
      .filter((s: string) => s.trim());

    const combined = [answer, ...resultTexts].filter(Boolean).join(' | ');
    return combined || null;
  } catch {
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

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const question = String(form.get('question') || '');
  const prefs = JSON.parse(String(form.get('preferences') || '{}'));
  const deviceId = String(form.get('deviceId') || '') || null;
  const file = form.get('image') as File | null;

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ report: mockAnalyze(question, prefs), mock: true });
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  let imageDataUrl: string | null = null;
  if (file && file.size > 0) {
    const bytes = Buffer.from(await file.arrayBuffer());
    imageDataUrl = `data:${file.type};base64,${bytes.toString('base64')}`;
  }

  // A verified session wins over the raw device id, same rule used when a
  // rating is recorded (lib/preferenceStore) — otherwise a signed-in user's
  // learned vector would be written under one id and read back under another.
  const userId = await resolveUserId(req, deviceId);
  const [historyDigest, learnedSignal] = await Promise.all([
    buildHistoryDigest(userId),
    buildLearnedSignalDigest(userId)
  ]);

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

Then clamp to 0-100 and round to the nearest whole number.

EVIDENCE DISCIPLINE — this is what keeps scores stable:
- Only award or deduct points for attributes you can actually support from the
  label, the web search context, or well-documented facts about the product.
- Do NOT award or deduct for attributes you are guessing at. An unknown
  attribute contributes 0 — it never moves the score in either direction.
- If cannabinoid and terpene data are both unknown, the score must stay within
  45-55 regardless of how appealing the product sounds, and confidence is at
  most "medium".

BUY DECISION BANDS (mechanical, no judgement):
- 72-100 → "Buy"
- 45-71  → "Maybe"
- 0-44   → "Skip"
${historyDigest ? `
SESSION HISTORY (this user's real logged outcomes, newest first — weigh heavily; it beats generic strain lore):
${historyDigest}

If the product resembles something they logged (same strain, terpene profile, or potency band), say so explicitly in quickTake or whyThisScore, e.g. "Same limonene-heavy profile as L'Orange, which you rated 5/5." Low-rated history with a similar profile should drag the score down and show up in watchOuts.` : ''}
${learnedSignal ? `
LEARNED PREFERENCE SIGNAL (computed from this user's actual rating outcomes over time, not self-reported — score from -1 to 1):
${learnedSignal}
On a normal key, positive means they consistently respond well when a product delivers it, negative means it works against them even though it's present. On an avoid* key, positive reinforces that the toggle is right and should still cost points; negative means they've tolerated it well before, so weigh that avoid-list deduction lighter than the toggle alone would suggest. Treat |score| ≥ 0.5 as at least as trustworthy as the manual preference toggles.` : ''}

STRAIN TYPE:
- strainType: one of "Sativa", "Indica", "Hybrid — sativa-leaning", "Hybrid — indica-leaning", "Hybrid — balanced", or "" if you genuinely don't know. Use the label or well-documented lineage; do not guess from the name alone.

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

Return JSON with: strainName, brand, brandNotes, strainType, productType, cannabinoids (or ""), terpenes array, matchScore 0-100, buyDecision, quickTake, whyThisScore, expectedEffects array, watchOuts array, bestFor array, dosingGuidance, confidence, missingInfo array.`;

  const userText = `Analyze this product/strain for a quick in-store buying decision.
Question or typed label: ${question}
User preference toggles: ${JSON.stringify(prefs)}
Return JSON with: strainName, brand, brandNotes, strainType, productType, cannabinoids, terpenes array, matchScore 0-100, buyDecision Buy|Maybe|Skip, quickTake, whyThisScore, expectedEffects array, watchOuts array, bestFor array, dosingGuidance, confidence low|medium|high, missingInfo array.`;

  const input: any[] = [{ role: 'system', content: system }];
  input.push({
    role: 'user',
    content: imageDataUrl
      ? [{ type: 'input_text', text: userText }, { type: 'input_image', image_url: imageDataUrl }]
      : [{ type: 'input_text', text: userText }]
  });

  try {
    const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
    let searchAttempted = false;
    let searchTerm = '';
    let searchLabel = '';
    let searchFound = false;

    // The pipeline is deliberately the same shape on every run: identify →
    // search → score. Previously the search only fired when the model happened
    // to report low confidence, so identical input could take two different
    // paths and produce very different scores and terpene data.
    let searchSubject = buildSearchSubject(question, '');
    if (imageDataUrl) {
      const identified = await identifyFromImage(client, model, imageDataUrl, question);
      if (identified) searchSubject = identified;
    }

    let searchContext: string | null = null;
    const hasSubject = Boolean(searchSubject) && !/^unknown(?:\s+strain)?$/i.test(searchSubject);
    if (hasSubject && process.env.TAVILY_API_KEY) {
      searchLabel = searchSubject;
      searchTerm = `${searchSubject} cannabis strain terpenes THC CBD effects`.slice(0, 100);
      searchAttempted = true;
      searchContext = await searchWeb(searchTerm);
      searchFound = Boolean(searchContext);
    }

    const raw = await analyzeWithModel(client, input, model, searchContext || undefined);
    let parsed: unknown = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { quickTake: raw };
    }
    let report = normalizeReport(parsed);
    report = scrubHallucinations(report);
    // Derive the verdict from the score so the two can never disagree.
    report = { ...report, buyDecision: decisionForScore(report.matchScore) };

    return NextResponse.json({ report, mock: false, searchAttempted, searchTerm, searchLabel, searchFound, usedHistory: Boolean(historyDigest), usedLearnedSignal: Boolean(learnedSignal) });
  } catch (err: any) {
    const payload = toErrorPayload(err);
    console.error('Analyze API failed', {
      status: payload.status,
      code: payload.error.code,
      requestId: payload.error.requestId,
      hint: payload.error.hint
    });
    return NextResponse.json({ error: payload.error }, { status: payload.status });
  }
}
