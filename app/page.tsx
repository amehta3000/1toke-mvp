'use client';

import { useEffect, useMemo, useState } from 'react';
import { chipGroups, defaultPreferences, labels } from '@/lib/defaults';
import { Preferences, StrainReport } from '@/lib/types';

const storageKey = '1toke:prefs';

function toDisplayText(value: unknown, fallback = 'Unknown'): string {
  if (value == null) return fallback;
  if (typeof value === 'string') return value.trim() || fallback;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const parts = value.map(v => toDisplayText(v, '')).filter(Boolean);
    return parts.length ? parts.join(', ') : fallback;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => {
        const normalized = toDisplayText(v, '').trim();
        return normalized ? `${k.toUpperCase()}: ${normalized}` : '';
      })
      .filter(Boolean);
    return entries.length ? entries.join(', ') : fallback;
  }
  return fallback;
}

function toStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(v => toDisplayText(v, '')).map(s => s.trim()).filter(Boolean);
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

function normalizeReport(input: any): StrainReport {
  const decision = input?.buyDecision === 'Buy' || input?.buyDecision === 'Maybe' || input?.buyDecision === 'Skip'
    ? input.buyDecision
    : 'Maybe';
  const confidence = input?.confidence === 'low' || input?.confidence === 'medium' || input?.confidence === 'high'
    ? input.confidence
    : 'medium';

  return {
    strainName: toDisplayText(input?.strainName, 'Unknown strain'),
    brand: toDisplayText(input?.brand, 'Unknown'),
    productType: toDisplayText(input?.productType, 'Unknown'),
    cannabinoids: toDisplayText(input?.cannabinoids, 'Unknown'),
    terpenes: toStringList(input?.terpenes),
    matchScore: toScore(input?.matchScore),
    buyDecision: decision,
    quickTake: toDisplayText(input?.quickTake, 'No quick take available.'),
    expectedEffects: toStringList(input?.expectedEffects),
    watchOuts: toStringList(input?.watchOuts),
    bestFor: toStringList(input?.bestFor),
    dosingGuidance: toDisplayText(input?.dosingGuidance, 'Start low and go slow.'),
    confidence,
    missingInfo: toStringList(input?.missingInfo)
  };
}

export default function Page() {
  const [tab, setTab] = useState<'scan'|'journal'|'discover'|'profile'>('scan');
  const [prefs, setPrefs] = useState<Preferences>(defaultPreferences);
  const [question, setQuestion] = useState('');
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [report, setReport] = useState<StrainReport | null>(null);
  const [searchAttempted, setSearchAttempted] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [analyzeError, setAnalyzeError] = useState<{ message: string; details?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [journal, setJournal] = useState({ feelings: [] as string[], rating: 4, notes: '' });

  useEffect(() => {
    const saved = localStorage.getItem(storageKey);
    if (saved) setPrefs({ ...defaultPreferences, ...JSON.parse(saved) });
  }, []);
  useEffect(() => { localStorage.setItem(storageKey, JSON.stringify(prefs)); }, [prefs]);

  function toggle(key: keyof Preferences) {
    setPrefs(p => ({ ...p, [key]: !p[key] }));
  }

  function onImage(file: File | null) {
    setImage(file);
    setPreview(file ? URL.createObjectURL(file) : null);
  }

  async function analyze() {
    setBusy(true);
    setReport(null);
    setAnalyzeError(null);

    try {
      const form = new FormData();
      form.set('question', question);
      form.set('preferences', JSON.stringify(prefs));
      if (image) form.set('image', image);

      const res = await fetch('/api/analyze', { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const message = data?.error?.message || 'Analysis failed. Please try again.';
        const details = [
          data?.error?.code ? `code=${data.error.code}` : '',
          data?.error?.requestId ? `requestId=${data.error.requestId}` : '',
          data?.error?.hint ? data.error.hint : ''
        ].filter(Boolean).join(' | ');
        setAnalyzeError({ message, details });
        return;
      }

      if (!data?.report) {
        setAnalyzeError({ message: 'No report was returned. Please try again.' });
        return;
      }

      setReport(normalizeReport(data.report));
      setSearchAttempted(data.searchAttempted || false);
      setSearchTerm(data.searchLabel || data.searchTerm || '');
      setTab('scan');
    } catch {
      setAnalyzeError({ message: 'Network error while analyzing. Check your connection and try again.' });
    } finally {
      setBusy(false);
    }
  }

  async function saveReport() {
    if (!report) return;
    await fetch('/api/reports', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ report, journal }) });
    alert('Saved to journal');
  }

  const activeWants = useMemo(() => Object.entries(prefs).filter(([k,v]) => v === true && !k.startsWith('avoid')).map(([k]) => labels[k]).filter(Boolean).slice(0, 5), [prefs]);

  return <main className="app">
    <section className="hero">
      <div className="kicker">1Toke</div>
      <h1>Scan before you buy.</h1>
      <p>Upload a label or ask about a strain. Get a fast, personal match score and a plain-English buying decision.</p>
    </section>

    {tab === 'scan' && <div className="stack">
      <div className="card stack">
        <label>Photo of package, menu, or label
          <input className="input" type="file" accept="image/*" capture="environment" onChange={e => onImage(e.target.files?.[0] || null)} />
        </label>
        {preview && <img className="preview" src={preview} alt="Selected product" />}
        <label>Or ask quickly
          <textarea value={question} onChange={e => setQuestion(e.target.value)} placeholder="Example: CBX L'Orange 29% THC. Is this good for creative daytime vibes?" />
        </label>
        <button className="primary" onClick={analyze} disabled={busy}>{busy ? 'Analyzing…' : 'Get buying advice'}</button>
        {analyzeError && <div className="card stack" role="alert" aria-live="polite">
          <div className="kicker">Could not complete analysis</div>
          <p><b>{analyzeError.message}</b></p>
          {analyzeError.details && <details>
            <summary>Debug details</summary>
            <p className="small">{analyzeError.details}</p>
          </details>}
        </div>}
        <div className="small">Current tuning: {activeWants.join(' · ') || 'neutral'} · intensity {prefs.intensity}</div>
      </div>

      {report && (report.confidence === 'low' ? <LowConfidenceCard report={report} searchAttempted={searchAttempted} searchTerm={searchTerm} /> : <ReportCard report={report} onSave={saveReport} />)}
    </div>}

    {tab === 'journal' && <div className="card stack">
      <h2>Log the session</h2>
      <p>Make this take 10 seconds. The model learns from simple taps.</p>
      <div className="chips">{['Creative','Happy','Social','Focused','Relaxed','Sleepy','Foggy','Anxious','Munchies'].map(f =>
        <button key={f} className={`chip ${journal.feelings.includes(f) ? 'active' : ''}`} onClick={() => setJournal(j => ({...j, feelings: j.feelings.includes(f) ? j.feelings.filter(x => x !== f) : [...j.feelings, f]}))}>{f}</button>
      )}</div>
      <label>Rating: {journal.rating}/5
        <input type="range" min="1" max="5" value={journal.rating} onChange={e => setJournal(j => ({...j, rating: Number(e.target.value)}))} />
      </label>
      <label>Notes
        <textarea value={journal.notes} onChange={e => setJournal(j => ({...j, notes: e.target.value}))} placeholder="Comedown? duration? would buy again?" />
      </label>
      <button className="primary" onClick={saveReport} disabled={!report}>Save current report</button>
    </div>}

    {tab === 'discover' && <div className="card stack">
      <h2>Discover</h2>
      <div className="metric"><b>Safe bets</b><span>Uplifting citrus / pine profiles</span></div>
      <div className="metric"><b>Explore nearby</b><span>Creative hybrids with lighter body</span></div>
      <div className="metric"><b>Avoid for now</b><span>Heavy dessert indica / high myrcene</span></div>
      <p>This tab becomes useful once you have 5–10 logged sessions.</p>
    </div>}

    {tab === 'profile' && <div className="stack">
      <PreferencePanel prefs={prefs} setPrefs={setPrefs} toggle={toggle} />
    </div>}

    <nav className="nav">
      {(['scan','journal','discover','profile'] as const).map(t => <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>)}
    </nav>
  </main>;
}

function LowConfidenceCard({ report, searchAttempted, searchTerm }: { report: StrainReport; searchAttempted: boolean; searchTerm: string }) {
  return <div className="card stack">
    <div className="pillline"><div><div className="kicker">❓ NEED MORE INFO</div><h2>Can't quite help yet</h2></div></div>
    {searchAttempted && <p className="small" style={{color: 'var(--warn)'}}>🔍 Searched for "{searchTerm}" but didn't find specific product info.</p>}
    <p><b>You're being a bit too vague! I need more details to give you solid advice.</b></p>
    <div className="metric"><b>You told me:</b><span>{report.quickTake || 'just vibes, no specifics'}</span></div>
    {report.missingInfo && report.missingInfo.length > 0 && <div className="stack">
      <h3>To help you better, please provide:</h3>
      <div className="chips">{report.missingInfo.map((info, i) => <span key={i} className="chip">📸 {info}</span>)}</div>
    </div>}
    <p className="small" style={{color: 'var(--warn)'}}>💡 <b>Pro tip:</b> Upload a clear photo of the product label/packaging, or give me a specific strain name + THC/CBD %. That's when I can actually help.</p>
  </div>;
}

function ReportCard({ report, onSave }: { report: StrainReport; onSave: () => void }) {
  const color = report.buyDecision === 'Buy' ? 'var(--accent)' : report.buyDecision === 'Maybe' ? 'var(--warn)' : 'var(--bad)';
  return <div className="card stack">
    <div className="pillline"><div><div className="kicker">{report.buyDecision}</div><h2>{report.strainName}</h2></div><div className="score" style={{'--score': report.matchScore} as any}><span>{report.matchScore}</span></div></div>
    <p style={{color}}><b>{report.quickTake}</b></p>
    <div className="metric"><b>Brand / type</b><span>{report.brand || 'Unknown'} · {report.productType || 'Unknown'}</span></div>
    <div className="metric"><b>Cannabinoids</b><span>{report.cannabinoids || 'Unknown'}</span></div>
    <div className="metric"><b>Terpenes</b><span>{report.terpenes?.join(', ') || 'Unknown'}</span></div>
    <h3>Expected</h3><div className="chips">{report.expectedEffects?.map(x => <span className="chip active" key={x}>{x}</span>)}</div>
    <h3>Watch outs</h3><div className="chips">{report.watchOuts?.map(x => <span className="chip" key={x}>{x}</span>)}</div>
    <p>{report.dosingGuidance}</p>
    <button className="secondary" onClick={onSave}>Save report</button>
    <div className="small">Confidence: {report.confidence}. Missing: {report.missingInfo?.join(', ') || 'none'}</div>
  </div>;
}

function PreferencePanel({ prefs, setPrefs, toggle }: { prefs: Preferences; setPrefs: any; toggle: any }) {
  return <div className="card stack">
    <h2>Tune your next session</h2>
    {chipGroups.map(g => <div className="stack" key={g.title}>
      <h3>{g.title}</h3>
      <div className="chips">{g.keys.map(k => <button className={`chip ${prefs[k] ? 'active' : ''}`} key={k} onClick={() => toggle(k)}>{labels[k]}</button>)}</div>
    </div>)}
    <label>Intensity: {prefs.intensity}
      <input type="range" min="0" max="100" value={prefs.intensity} onChange={e => setPrefs((p: Preferences) => ({...p, intensity: Number(e.target.value)}))} />
    </label>
    <div className="row">
      {(['low','medium','high'] as const).map(t => <button key={t} className={`secondary ${prefs.tolerance === t ? 'chip active' : ''}`} onClick={() => setPrefs((p: Preferences) => ({...p, tolerance: t}))}>{t}</button>)}
    </div>
    <div className="row">
      {(['safe','explore','surprise'] as const).map(m => <button key={m} className={`secondary ${prefs.mode === m ? 'chip active' : ''}`} onClick={() => setPrefs((p: Preferences) => ({...p, mode: m}))}>{m}</button>)}
    </div>
  </div>;
}
