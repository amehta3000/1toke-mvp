import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { mockAnalyze } from '@/lib/mock';

export const runtime = 'nodejs';

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

  const system = `You are 1Toke, a fast buying assistant and personal preference engine. You help adults make safer, more personalized cannabis purchasing decisions. Do not provide medical claims. Prioritize low-dose guidance, uncertainty, and harm reduction. Return strict JSON only.`;

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

  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
    input,
    text: { format: { type: 'json_object' } }
  });

  const raw = response.output_text || '{}';
  const report = JSON.parse(raw);
  return NextResponse.json({ report, mock: false });
}
