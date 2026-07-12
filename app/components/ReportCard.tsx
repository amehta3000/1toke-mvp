'use client';

import { StrainReport } from '@/lib/types';

const decisionMeta: Record<StrainReport['buyDecision'], { phrase: string; emoji: string; colorVar: string }> = {
  Buy: { phrase: 'Solid pick', emoji: '✅', colorVar: 'var(--accent)' },
  Maybe: { phrase: 'Could go either way', emoji: '🤔', colorVar: 'var(--warn)' },
  Skip: { phrase: 'Skip it', emoji: '🚫', colorVar: 'var(--bad)' }
};

function TypeBadge({ strainType }: { strainType?: string }) {
  if (!strainType) return null;
  const lower = strainType.toLowerCase();
  const kind = lower.includes('indica') && lower.includes('sativa') ? 'hybrid'
    : lower.includes('sativa') ? 'sativa'
    : lower.includes('indica') ? 'indica'
    : lower.includes('hybrid') ? 'hybrid'
    : null;
  if (!kind) return null;
  const icon = kind === 'sativa' ? '🌞' : kind === 'indica' ? '🌙' : '🌗';
  return <span className={`typebadge ${kind}`}>{icon} {strainType}</span>;
}

export function ReportCard({ report, onSave, saving, onDismiss }: { report: StrainReport; onSave: () => void; saving?: boolean; onDismiss: () => void }) {
  const meta = decisionMeta[report.buyDecision];
  return <div className="card stack">
    <div className="pillline">
      <div>
        <div className="kicker" style={{ color: meta.colorVar }}>{meta.emoji} {meta.phrase}</div>
        <h2>{report.strainName}</h2>
        <TypeBadge strainType={report.strainType} />
      </div>
      <div className="score" style={{ '--score': report.matchScore, '--ring': meta.colorVar } as any}><span>{report.matchScore}</span></div>
    </div>
    <p style={{ color: meta.colorVar }}><b>{report.quickTake}</b></p>
    {report.whyThisScore && <p className="small why">📈 {report.whyThisScore}</p>}
    <div className="metric"><b>Brand / type</b><span>{report.brand || 'Unknown'} · {report.productType || 'Unknown'}</span></div>
    {report.brandNotes && <p className="small brandnotes">🏷 {report.brandNotes}</p>}
    <div className="metric"><b>Cannabinoids</b><span>{report.cannabinoids || 'Unknown'}</span></div>
    <div className="metric"><b>Terpenes</b><span>{report.terpenes?.join(', ') || 'Unknown'}</span></div>
    {report.expectedEffects.length > 0 && <><h3>Expect</h3><div className="chips">{report.expectedEffects.map(x => <span className="chip active" key={x}>{x}</span>)}</div></>}
    {report.bestFor.length > 0 && <><h3>Best for</h3><div className="chips">{report.bestFor.map(x => <span className="chip best" key={x}>{x}</span>)}</div></>}
    {report.watchOuts.length > 0 && <><h3>Watch outs</h3><div className="chips">{report.watchOuts.map(x => <span className="chip warn" key={x}>{x}</span>)}</div></>}
    <p>{report.dosingGuidance}</p>
    <div className="row">
      <button className="secondary ghost" onClick={onDismiss}>✕ Done with it</button>
      <button className="secondary" onClick={onSave} disabled={saving}>{saving ? 'Saving…' : '🛒 I bought it — save it'}</button>
    </div>
    <div className="small">Confidence: {report.confidence}{report.missingInfo?.length ? ` · Missing: ${report.missingInfo.join(', ')}` : ''}</div>
  </div>;
}

export function LowConfidenceCard({ report, searchAttempted, searchTerm, onDismiss }: { report: StrainReport; searchAttempted: boolean; searchTerm: string; onDismiss: () => void }) {
  return <div className="card stack">
    <div className="pillline">
      <div><div className="kicker">🔍 Need a closer look</div><h2>I couldn&apos;t pull enough off that one</h2></div>
      <button className="dismiss" onClick={onDismiss} aria-label="Dismiss">✕</button>
    </div>
    {searchAttempted && <p className="small" style={{ color: 'var(--warn)' }}>I even searched the web for “{searchTerm}” — no solid product info came back.</p>}
    <div className="metric"><b>What I got</b><span>{report.quickTake || 'vibes, but no specifics'}</span></div>
    {report.missingInfo && report.missingInfo.length > 0 && <div className="stack">
      <h3>What would unlock a real answer</h3>
      <div className="chips">{report.missingInfo.map((info, i) => <span key={i} className="chip">📸 {info}</span>)}</div>
    </div>}
    <p className="small">💡 A clear shot of the label — or a strain name plus THC % — and I can give you a straight Buy / Skip.</p>
  </div>;
}
