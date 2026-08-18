'use client';

import { useState } from 'react';
import { StrainReport } from '@/lib/types';
import { terpeneNote } from '@/lib/terpenes';

const decisionMeta: Record<StrainReport['buyDecision'], { colorVar: string; pulse: boolean }> = {
  Buy: { colorVar: 'var(--accent)', pulse: true },
  Maybe: { colorVar: 'var(--warn)', pulse: false },
  Skip: { colorVar: 'var(--bad)', pulse: false }
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

// The glance view is the whole point: word + score + one line, nothing else,
// so a Buy/Maybe/Skip call is readable in a couple of seconds in a store.
// Everything else — why, brand, terpenes, dosing — is one tap away.
export function ReportCard({ report, onSave, saving, onDismiss }: { report: StrainReport; onSave: () => void; saving?: boolean; onDismiss: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [activeTerp, setActiveTerp] = useState<string | null>(null);
  const meta = decisionMeta[report.buyDecision];

  return <div className="card stack">
    <div className={`verdict-core ${meta.pulse ? 'pulse' : ''}`}>
      {report.strainName && report.strainName !== 'Unknown strain' && report.strainName !== 'Unknown' &&
        <p className="small scanned-name">{report.strainName}</p>}
      <div className="score" style={{ '--score': report.matchScore, '--ring': meta.colorVar } as any}><span>{report.matchScore}</span></div>
      <div className="verdict-word" style={{ color: meta.colorVar }}>{report.buyDecision}</div>
      <p className="verdict-quicktake"><b>{report.quickTake}</b></p>
    </div>

    <button className="expand-toggle" onClick={() => setExpanded(e => !e)} aria-expanded={expanded}>
      {expanded ? 'Hide details ▴' : 'Tap for details ▾'}
    </button>

    {expanded && <div className="stack details-body">
      <TypeBadge strainType={report.strainType} />
      {report.whyThisScore && <p className="small why">📈 {report.whyThisScore}</p>}
      <div className="metric"><b>Brand / type</b><span>{report.brand || 'Unknown'} · {report.productType || 'Unknown'}</span></div>
      {report.brandNotes && <p className="small brandnotes">🏷 {report.brandNotes}</p>}
      <div className="metric"><b>Cannabinoids</b><span>{report.cannabinoids || 'Unknown'}</span></div>

      {report.labelCheck && <div className="label-check">
        <span className="lc-icon">🔍</span>
        <p>{report.labelCheck}</p>
      </div>}

      {report.terpenes && report.terpenes.length > 0 && <div className="stack">
        <h3>Terpenes — tap one</h3>
        <div className="chips">
          {report.terpenes.map(t =>
            <button key={t} className={`chip terp ${activeTerp === t ? 'active' : ''}`} onClick={() => setActiveTerp(a => a === t ? null : t)}>{t}</button>
          )}
        </div>
        {activeTerp && <p className="terp-note">{terpeneNote(activeTerp) || `No quick note for ${activeTerp} yet.`}</p>}
      </div>}

      {report.expectedEffects.length > 0 && <><h3>Expect</h3><div className="chips">{report.expectedEffects.map(x => <span className="chip active" key={x}>{x}</span>)}</div></>}
      {report.bestFor.length > 0 && <><h3>Best for</h3><div className="chips">{report.bestFor.map(x => <span className="chip best" key={x}>{x}</span>)}</div></>}
      {report.watchOuts.length > 0 && <><h3>Watch outs</h3><div className="chips">{report.watchOuts.map(x => <span className="chip warn" key={x}>{x}</span>)}</div></>}
      <p>{report.dosingGuidance}</p>
      <div className="small">Confidence: {report.confidence}{report.missingInfo?.length ? ` · Missing: ${report.missingInfo.join(', ')}` : ''}</div>
    </div>}

    <div className="row">
      <button className="secondary ghost" onClick={onDismiss}>✕ Done with it</button>
      <button className="secondary" onClick={onSave} disabled={saving}>{saving ? 'Saving…' : '🛒 I bought it — save it'}</button>
    </div>
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
