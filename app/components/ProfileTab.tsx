'use client';

import { useState } from 'react';
import { chipGroups, coreKeys, labels, toleranceHints, modeHints, leanReadoutText } from '@/lib/defaults';
import { Preferences } from '@/lib/types';

export default function ProfileTab({ prefs, setPrefs, onReplaySetup }: {
  prefs: Preferences;
  setPrefs: (fn: (p: Preferences) => Preferences) => void;
  onReplaySetup: () => void;
}) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  function toggle(key: string) {
    setPrefs(p => ({ ...p, [key]: !p[key as keyof Preferences] }));
  }

  function toggleGroup(id: string) {
    setExpandedGroups(s => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function chipBtn(k: string) {
    return <button className={`chip ${prefs[k as keyof Preferences] ? 'active' : ''}`} key={k} onClick={() => toggle(k)}>{labels[k]}</button>;
  }

  return <div className="card stack">
    <div className="kicker">Profile</div>
    <h2>Tune your next session</h2>
    <p className="small">Everything here feeds directly into your match scores.</p>

    {chipGroups.map(g => {
      const core = g.keys.filter(k => coreKeys.has(k));
      const more = g.keys.filter(k => !coreKeys.has(k));
      const isOpen = expandedGroups.has(g.title);
      return <div className="stack" key={g.title}>
        <h3>{g.title}</h3>
        <div className="chips">{core.map(chipBtn)}</div>
        {more.length > 0 && <>
          {isOpen && <div className="chips">{more.map(chipBtn)}</div>}
          <button className="tuning small" onClick={() => toggleGroup(g.title)}>
            {isOpen ? 'Show fewer tags ▴' : `Show ${more.length} more tags ▾`}
          </button>
        </>}
      </div>;
    })}

    <h3>Head or body?</h3>
    <input type="range" min="0" max="100" value={prefs.headBodyLean} onChange={e => setPrefs(p => ({ ...p, headBodyLean: Number(e.target.value) }))} />
    <div className="slider-ends small"><span>🧠 head</span><span>body 🛋</span></div>
    <p className="small hint">{leanReadoutText(prefs.headBodyLean)} — scored against the actual terpenes, not the Indica/Sativa label.</p>

    <h3>How high is a good session?</h3>
    <input type="range" min="0" max="100" value={prefs.intensity} onChange={e => setPrefs(p => ({ ...p, intensity: Number(e.target.value) }))} />
    <div className="slider-ends small"><span>gentle buzz</span><span>send me</span></div>

    <h3>THC tolerance</h3>
    <div className="row">
      {(['low','medium','high'] as const).map(t =>
        <button key={t} className={`secondary ${prefs.tolerance === t ? 'selected' : ''}`} onClick={() => setPrefs(p => ({ ...p, tolerance: t }))}>{t}</button>
      )}
    </div>
    <p className="small hint">{toleranceHints[prefs.tolerance]}</p>

    <h3>Adventure mode</h3>
    <div className="row">
      {(['safe','explore','surprise'] as const).map(m =>
        <button key={m} className={`secondary ${prefs.mode === m ? 'selected' : ''}`} onClick={() => setPrefs(p => ({ ...p, mode: m }))}>{m}</button>
      )}
    </div>
    <p className="small hint">{modeHints[prefs.mode]}</p>

    <button className="secondary" onClick={onReplaySetup}>↺ Replay the setup questions</button>
  </div>;
}
