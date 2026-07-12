import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { mockAnalyze } from '@/lib/mock';
import { normalizeReport, toDisplayText } from '@/lib/report';
import { getSupabaseAdmin } from '@/lib/supabase';

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
async function buildHistoryDigest(deviceId: string | null): Promise<string | null> {
  if (!deviceId) return null;
  const supabase = getSupabaseAdmin();
  if (!supabase) return null;

  try {
    const { data, error } = await supabase
      .from('sessions')
      .select('created_at, strain_name, rating, feelings, notes, would_buy_again, reports(report)')
      .eq('user_id', deviceId)
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
        max_results: 3,
        include_answer: true
      }),
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) return null;

    const data = (await res.json()) as any;
    const answer = data.answer ? `Summary: ${data.answer}` : '';
    const results = data.results?.slice(0, 3) || [];
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
    text: { format: { type: 'json_object' } }
  });

  return response.output_text || '{}';
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

  const historyDigest = await buildHistoryDigest(deviceId);

  const system = `You are 1Toke: a sharp, honest budtender friend helping an adult make a fast in-store buying decision. You hype products that genuinely fit this person and you are blunt when something is wrong for them. Never provide medical claims. Return ONLY valid JSON.

VOICE:
- quickTake and whyThisScore: casual, warm, a little playful. Talk like a knowledgeable friend, not a lab report. One or two punchy sentences each.
- dosingGuidance and watchOuts: straight, clear, zero jokes. Safety content stays serious.

PERSONALIZATION:
- Score against THIS user's preference toggles, tolerance, intensity target, and adventure mode (safe = stay close to what works, explore = adjacent new things, surprise = wildcards welcome).
- whyThisScore must tie the score to their profile in one sentence (e.g. "Limonene-forward matches your citrus + creative lean, but 31% THC is punchy for your medium tolerance.").
${historyDigest ? `
SESSION HISTORY (this user's real logged outcomes, newest first — weigh heavily; it beats generic strain lore):
${historyDigest}

If the product resembles something they logged (same strain, terpene profile, or potency band), say so explicitly in quickTake or whyThisScore, e.g. "Same limonene-heavy profile as L'Orange, which you rated 5/5." Low-rated history with a similar profile should drag the score down and show up in watchOuts.` : ''}

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

    // First-pass analysis
    const raw = await analyzeWithModel(client, input, model);
    let parsed: unknown = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { quickTake: raw };
    }
    let report = normalizeReport(parsed);
    report = scrubHallucinations(report);

    // If confidence is low and web search is available, enhance with search
    if (report.confidence === 'low' && process.env.TAVILY_API_KEY) {
      const searchSubject = buildSearchSubject(question, report.strainName);
      searchLabel = searchSubject;
      searchTerm = `${searchSubject} cannabis strain THC CBD effects`.slice(0, 100);
      searchAttempted = true;
      const searchResults = await searchWeb(searchTerm);

      if (searchResults) {
        searchFound = true;
        // Re-analyze with search context
        const enhancedRaw = await analyzeWithModel(client, input, model, searchResults);
        let enhancedParsed: unknown = {};
        try {
          enhancedParsed = JSON.parse(enhancedRaw);
        } catch {
          enhancedParsed = { quickTake: enhancedRaw };
        }
        const enhancedReport = normalizeReport(enhancedParsed);
        // Only use enhanced if confidence improved
        if (enhancedReport.confidence !== 'low') {
          report = enhancedReport;
        }
      }
    }

    return NextResponse.json({ report, mock: false, searchAttempted, searchTerm, searchLabel, searchFound, usedHistory: Boolean(historyDigest) });
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
