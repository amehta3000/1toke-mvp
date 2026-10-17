'use client';

import { useState } from 'react';
import { Reaction, StrainReport } from '@/lib/types';
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

// Two options, not three. A middle "Unsure" button was a dead end — it looks
// like an answer but records nothing you can act on later, and it collided
// with the model's own "Maybe" verdict a couple of inches above. Deliberately
// not Buy/Maybe/Skip either: that's the model's vocabulary, and reusing it
// made a tap read as "I agree" rather than the person's own call.
const REACTIONS: { key: Reaction; label: string }[] = [
  { key: 'pass', label: '👎 Pass' },
  { key: 'good', label: '👍 Want it' }
];

// 'maybe' is no longer offered but is kept here so rows already written with
// it still render their history line correctly.
const REACTION_PAST: Record<Reaction, string> = {
  pass: 'passed on it',
  maybe: 'were unsure',
  good: 'wanted it'
};

function scannedAgo(iso?: string | null): string {
  if (!iso) return '';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return ' today';
  if (days === 1) return ' yesterday';
  if (days < 30) return ` ${days} days ago`;
  return ` on ${new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

// The glance view is the whole point: word + score + one line, nothing else,
// so a Buy/Maybe/Skip call is readable in a couple of seconds in a store.
// Everything else — why, brand, terpenes, dosing — is one tap away.
export function ReportCard({ report, reaction, onReact, reacting, fromCache, scannedAt, evidence, onRescan, onDismiss }: {
  report: StrainReport;
  reaction: Reaction | null;
  onReact: (value: Reaction) => void;
  reacting?: boolean;
  fromCache?: boolean;
  scannedAt?: string | null;
  evidence?: string[];
  onRescan?: () => void;
  onDismiss: () => void;
}) {
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

    {/* An instant answer should explain itself, or it reads as "it didn't
        actually think". This says the speed is memory, not a shortcut. */}
    {fromCache && <div className="recall">
      <span className="recall-icon">↩</span>
      <div>
        <p>You scanned this{scannedAgo(scannedAt)}{reaction ? ` and ${REACTION_PAST[reaction]}` : ''}. Same profile since, so this is your saved read.</p>
        {onRescan && <button className="rescan-link" onClick={onRescan}>↻ Scan it fresh instead</button>}
      </div>
    </div>}

    <div className="stack reaction-block">
      <div className="micro-label">Would you try it?</div>
      <div className="reaction-row">
        {REACTIONS.map(r =>
          <button
            key={r.key}
            className={`reaction ${r.key} ${reaction === r.key ? 'is-set' : ''}`}
            onClick={() => onReact(r.key)}
            disabled={reacting}
            aria-pressed={reaction === r.key}
          >{r.label}</button>
        )}
      </div>
    </div>

    <button className="expand-toggle" onClick={() => setExpanded(e => !e)} aria-expanded={expanded}>
      {expanded ? 'Hide details ▴' : 'Tap for details ▾'}
    </button>

    {expanded && <div className="stack details-body">
      {/* What the number was actually built from. The work is real; without
          this it's invisible, and an instant answer looks like a guess. */}
      {evidence && evidence.length > 0 && <p className="small evidence">
        🧾 Scored against {evidence.join(' · ')}
      </p>}
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

    <button className="tuning small" onClick={onDismiss}>✕ Done with it — scan the next one</button>
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
