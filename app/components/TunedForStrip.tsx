'use client';

import { useState } from 'react';
import { chipGroups, coreKeys, labels, leanReadoutText } from '@/lib/defaults';
import { Preferences } from '@/lib/types';

function stripEmoji(label: string) {
  return label.replace(/^\S+\s/, '');
}

// The per-scan tweak: starts from the saved Profile every time, but tapping a
// chip here only affects *this* scan — "Reset to my usual" is what snaps a
// mid-scan tweak back to the saved baseline. Editing Profile itself (not this
// component) is what actually changes what "usual" means going forward.
export default function TunedForStrip({ sessionPrefs, setSessionPrefs, savedPrefs }: {
  sessionPrefs: Preferences;
  setSessionPrefs: (fn: (p: Preferences) => Preferences) => void;
  savedPrefs: Preferences;
}) {
  const [open, setOpen] = useState(false);
  const [showMore, setShowMore] = useState(false);

  function toggle(key: string) {
    setSessionPrefs(p => ({ ...p, [key]: !p[key as keyof Preferences] }));
  }

  const wantKeys = chipGroups[0].keys;
  const avoidKeys = chipGroups[1].keys;
  const flavorKeys = chipGroups[2].keys;
  const allKeys: readonly string[] = [...wantKeys, ...avoidKeys, ...flavorKeys];

  const activeWantLabels = wantKeys
    .filter(k => sessionPrefs[k as keyof Preferences])
    .map(k => stripEmoji(labels[k]));
  const activeOtherCount = [...avoidKeys, ...flavorKeys].filter(k => sessionPrefs[k as keyof Preferences]).length;
  const shownWants = activeWantLabels.slice(0, 2);
  const moreCount = (activeWantLabels.length - shownWants.length) + activeOtherCount;

  function chipBtn(k: string) {
    const isAvoid = k.startsWith('avoid');
    return <button
      key={k}
      type="button"
      className={`chip tuned-chip ${isAvoid ? 'avoid' : ''} ${sessionPrefs[k as keyof Preferences] ? 'active' : ''}`}
      onClick={() => toggle(k)}
    >{labels[k]}</button>;
  }

  const core = allKeys.filter(k => coreKeys.has(k));
  const more = allKeys.filter(k => !coreKeys.has(k));

  return <div className="tuned-strip">
    <button type="button" className="tuned-row" onClick={() => setOpen(o => !o)} aria-expanded={open}>
      <span className="tuned-label">Tuned for</span>
      <span className="tuned-summary-chips">
        {shownWants.length
          ? shownWants.map(l => <span key={l} className="chip tuned-chip mini active">{l}</span>)
          : <span className="chip tuned-chip mini">Tap to set a vibe</span>}
      </span>
      {moreCount > 0 && <span className="tuned-more">+{moreCount} more</span>}
      <span className="car">{open ? '▴' : '▾'}</span>
    </button>

    {open && <div className="tuned-panel stack">
      <div className="lean-row">
        <div className="lean-labels small">
          <span>🧠 Head</span>
          <span className="readout">{leanReadoutText(sessionPrefs.headBodyLean)}</span>
          <span>Body 🛋</span>
        </div>
        <input
          type="range" min="0" max="100" value={sessionPrefs.headBodyLean}
          aria-label="Head to body lean, independent of the Indica/Sativa label"
          onChange={e => setSessionPrefs(p => ({ ...p, headBodyLean: Number(e.target.value) }))}
        />
      </div>

      <div className="chips">{core.map(chipBtn)}</div>

      {more.length > 0 && <>
        {showMore && <div className="chips">{more.map(chipBtn)}</div>}
        <button type="button" className="tuning small" onClick={() => setShowMore(s => !s)}>
          {showMore ? 'Show fewer tags ▴' : `Show ${more.length} more tags ▾`}
        </button>
      </>}

      <div className="pillline">
        <p className="small hint">Just for this scan — your saved profile doesn&apos;t change.</p>
        <button type="button" className="tuning small" onClick={() => setSessionPrefs(() => savedPrefs)}>↺ Reset to my usual</button>
      </div>
    </div>}
  </div>;
}
