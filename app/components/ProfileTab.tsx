'use client';

import { chipGroups, labels, toleranceHints, modeHints } from '@/lib/defaults';
import { Preferences } from '@/lib/types';

export default function ProfileTab({ prefs, setPrefs, onReplaySetup }: {
  prefs: Preferences;
  setPrefs: (fn: (p: Preferences) => Preferences) => void;
  onReplaySetup: () => void;
}) {
  function toggle(key: string) {
    setPrefs(p => ({ ...p, [key]: !p[key as keyof Preferences] }));
  }

  return <div className="card stack">
    <div className="kicker">Profile</div>
    <h2>Tune your next session</h2>
    <p className="small">Everything here feeds directly into your match scores.</p>

    {chipGroups.map(g => <div className="stack" key={g.title}>
      <h3>{g.title}</h3>
      <div className="chips">{g.keys.map(k =>
        <button className={`chip ${prefs[k] ? 'active' : ''}`} key={k} onClick={() => toggle(k)}>{labels[k]}</button>
      )}</div>
    </div>)}

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
