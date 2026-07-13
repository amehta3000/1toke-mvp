'use client';

import { useState } from 'react';
import { chipGroups, labels, toleranceHints, modeHints } from '@/lib/defaults';
import { Preferences } from '@/lib/types';

const steps = [
  {
    kicker: 'First things first',
    title: 'How do you like to feel?',
    blurb: 'Tap everything that sounds like a good time. This is what I score every product against.'
  },
  {
    kicker: 'Just as important',
    title: 'What kills the vibe?',
    blurb: 'Tell me what to steer you away from, and which flavors pull you in.'
  },
  {
    kicker: 'Last one',
    title: 'Dial it in',
    blurb: 'How seasoned are you, and how adventurous should I get?'
  }
];

export default function Onboarding({ prefs, setPrefs, onDone }: {
  prefs: Preferences;
  setPrefs: (fn: (p: Preferences) => Preferences) => void;
  onDone: () => void;
}) {
  const [step, setStep] = useState(0);
  const last = step === steps.length - 1;

  function toggle(key: string) {
    setPrefs(p => ({ ...p, [key]: !p[key as keyof Preferences] }));
  }

  function chipRow(keys: readonly string[]) {
    return <div className="chips">{keys.map(k =>
      <button key={k} className={`chip ${prefs[k as keyof Preferences] ? 'active' : ''}`} onClick={() => toggle(k)}>{labels[k]}</button>
    )}</div>;
  }

  return <div className="onboard">
    <div className="onboard-card card stack">
      <div className="dots">{steps.map((_, i) => <span key={i} className={`dot ${i === step ? 'on' : i < step ? 'done' : ''}`} />)}</div>
      <div className="kicker">{steps[step].kicker}</div>
      <h2>{steps[step].title}</h2>
      <p>{steps[step].blurb}</p>

      {step === 0 && chipRow(chipGroups[0].keys)}

      {step === 1 && <div className="stack">
        <h3>Steer me away from</h3>
        {chipRow(chipGroups[1].keys)}
        <h3>Flavors I love</h3>
        {chipRow(chipGroups[2].keys)}
      </div>}

      {step === 2 && <div className="stack">
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
        <h3>How high is a good session?</h3>
        <input type="range" min="0" max="100" value={prefs.intensity} onChange={e => setPrefs(p => ({ ...p, intensity: Number(e.target.value) }))} />
        <div className="slider-ends small"><span>gentle buzz</span><span>send me</span></div>
      </div>}

      <div className="row">
        {step > 0
          ? <button className="secondary" onClick={() => setStep(s => s - 1)}>Back</button>
          : <button className="secondary" onClick={onDone}>I&apos;ll wing it</button>}
        <button className="primary" onClick={() => last ? onDone() : setStep(s => s + 1)}>
          {last ? "Let's find your thing" : 'Next'}
        </button>
      </div>
    </div>
  </div>;
}
