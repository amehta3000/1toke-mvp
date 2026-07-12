import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { z } from 'zod';
import { mockAnalyze } from '@/lib/mock';

export const runtime = 'nodejs';

function toDisplayText(value: unknown, fallback = 'Unknown'): string {
  if (value == null) return fallback;
  if (typeof value === 'string') return value.trim() || fallback;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const parts = value
      .map(v => toDisplayText(v, ''))
      .map(s => s.trim())
      .filter(Boolean);
    return parts.length ? parts.join(', ') : fallback;
  }
  if (typeof value === 'object') {
    const parts = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => {
        const normalized = toDisplayText(v, '').trim();
        return normalized ? `${k.toUpperCase()}: ${normalized}` : '';
      })
      .filter(Boolean);
    return parts.length ? parts.join(', ') : fallback;
  }
  return fallback;
}

function toStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(v => toDisplayText(v, '')).map(s => s.trim()).filter(Boolean);
  }
  if (value == null) return [];
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => {
        const normalized = toDisplayText(v, '').trim();
        return normalized ? `${k}: ${normalized}` : k;
      })
      .filter(Boolean);
  }
  const one = toDisplayText(value, '').trim();
  return one ? [one] : [];
}

function toScore(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 50;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

const buyDecisionSchema = z.preprocess((v) => {
  if (v === 'Buy' || v === 'Maybe' || v === 'Skip') return v;
  return 'Maybe';
}, z.enum(['Buy', 'Maybe', 'Skip']));

const confidenceSchema = z.preprocess((v) => {
  if (v === 'low' || v === 'medium' || v === 'high') return v;
  return 'medium';
}, z.enum(['low', 'medium', 'high']));

const reportSchema = z.preprocess(
  (value) => (value && typeof value === 'object' ? value : {}),
  z.object({
    strainName: z.preprocess((v) => toDisplayText(v, 'Unknown strain'), z.string()),
    brand: z.preprocess((v) => toDisplayText(v, 'Unknown'), z.string()).optional(),
    productType: z.preprocess((v) => toDisplayText(v, 'Unknown'), z.string()).optional(),
    cannabinoids: z.preprocess((v) => toDisplayText(v, 'Unknown'), z.string()).optional(),
    terpenes: z.preprocess(toStringList, z.array(z.string())).default([]),
    matchScore: z.preprocess(toScore, z.number().int().min(0).max(100)),
    buyDecision: buyDecisionSchema,
    quickTake: z.preprocess((v) => toDisplayText(v, 'No quick take available.'), z.string()),
    expectedEffects: z.preprocess(toStringList, z.array(z.string())).default([]),
    watchOuts: z.preprocess(toStringList, z.array(z.string())).default([]),
    bestFor: z.preprocess(toStringList, z.array(z.string())).default([]),
    dosingGuidance: z.preprocess((v) => toDisplayText(v, 'Start low and go slow.'), z.string()),
    confidence: confidenceSchema,
    missingInfo: z.preprocess(toStringList, z.array(z.string())).optional()
  })
);

function normalizeReport(value: unknown) {
  return reportSchema.parse(value);
}

function scrubHallucinations(report: any): any {
  // If confidence is low, this means the model was uncertain or didn't have enough info.
  // Remove all fields that require specific knowledge to prevent hallucinations.
  if (report.confidence === 'low') {
    return {
      strainName: 'Unknown',
      brand: '',
      productType: '',
      cannabinoids: '', // Don't make up THC/CBD %
      terpenes: [],    // Don't make up terpene profiles
      matchScore: 50, // Neutral score when unsure
      buyDecision: 'Maybe',
      quickTake: report.missingInfo?.join(', ') || 'Insufficient info. Please provide product name, label photo, or specific cannabinoid data.',
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

  const system = `You are 1Toke, a fast buying assistant for cannabis purchases. Help adults make safer, more personalized decisions. Never provide medical claims. Return ONLY valid JSON.

🚫 STRICT NO-HALLUCINATION RULE:
If you do not have CONCRETE information, DO NOT INCLUDE IT. Don't guess, don't infer, don't use generic knowledge:
- If you don't know the THC/CBD %, set cannabinoids to empty string""
- If you don't know terpenes, return empty array []
- If you don't know effects, return empty array []
- If you don't see a product name/label, set strainName to "Unknown"
- If unsure about effects, effects should be EMPTY not speculated

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

Return JSON with: strainName, brand, productType, cannabinoids (or ""), terpenes array, matchScore 0-100, buyDecision, quickTake, expectedEffects array, watchOuts array, bestFor array, dosingGuidance, confidence, missingInfo array.`;

  const userText = `Analyze this product/strain for a quick in-store buying decision.
Question or typed label: ${question}
User preference toggles: ${JSON.stringify(prefs)}
Return JSON with: strainName, brand, productType, cannabinoids, terpenes array, matchScore 0-100, buyDecision Buy|Maybe|Skip, quickTake, expectedEffects array, watchOuts array, bestFor array, dosingGuidance, confidence low|medium|high, missingInfo array.`;

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

    return NextResponse.json({ report, mock: false, searchAttempted, searchTerm, searchLabel, searchFound });
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
