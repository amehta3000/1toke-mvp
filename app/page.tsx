'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { defaultPreferences, labels } from '@/lib/defaults';
import { Preferences, SavedReport, StrainReport } from '@/lib/types';
import { normalizeReport } from '@/lib/report';
import { getDeviceId, safeGet, safeSet } from '@/lib/storage';
import Onboarding from './components/Onboarding';
import { ReportCard, LowConfidenceCard } from './components/ReportCard';
import JournalTab from './components/JournalTab';
import DiscoverTab from './components/DiscoverTab';
import ProfileTab from './components/ProfileTab';
import InstallPrompt from './components/InstallPrompt';

const storageKey = '1toke:prefs';
const onboardedKey = '1toke:onboarded';

const loadingLines = [
  'Reading the label…',
  'Sniffing the terps…',
  'Cross-checking your vibe…',
  'Consulting the budtender brain…',
  'Scoring the match…'
];

const navItems = [
  { id: 'scan', label: 'Scan', icon: '🔍' },
  { id: 'journal', label: 'Journal', icon: '📓' },
  { id: 'discover', label: 'Discover', icon: '🧭' },
  { id: 'profile', label: 'Profile', icon: '🎛' }
] as const;

const heroCopy = {
  scan: {
    title: 'Scan before you buy.',
    sub: 'Snap a label or ask about a strain. Get a personal match score and a straight Buy / Maybe / Skip.'
  },
  journal: {
    title: 'Log it while it’s fresh.',
    sub: 'Ten seconds of taps per session — this is what teaches 1Toke what actually works on you.'
  },
  discover: {
    title: 'Know your patterns.',
    sub: 'What your logged sessions say about the strains, terpenes, and feelings that suit you.'
  },
  profile: {
    title: 'Make it yours.',
    sub: 'Your vibe, your limits. Every verdict is scored against what you set here.'
  }
} as const;

export default function Page() {
  const [tab, setTab] = useState<'scan'|'journal'|'discover'|'profile'>('scan');
  const [prefs, setPrefs] = useState<Preferences>(defaultPreferences);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [question, setQuestion] = useState('');
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [report, setReport] = useState<StrainReport | null>(null);
  const [searchAttempted, setSearchAttempted] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [analyzeError, setAnalyzeError] = useState<{ message: string; details?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingLine, setLoadingLine] = useState(0);
  const [saving, setSaving] = useState(false);
  const [deviceId, setDeviceId] = useState('');
  const [savedReports, setSavedReports] = useState<SavedReport[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [needsMigration, setNeedsMigration] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(msg: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }

  async function loadSavedReports(id: string) {
    if (!id) return;
    try {
      const res = await fetch(`/api/reports?deviceId=${encodeURIComponent(id)}`);
      const data = await res.json().catch(() => ({}));
      setSavedReports(Array.isArray(data.reports) ? data.reports : []);
    } catch {
      // Offline or DB unavailable: keep whatever we have.
    }
  }

  async function loadSessions(id: string) {
    if (!id) return;
    try {
      const res = await fetch(`/api/sessions?deviceId=${encodeURIComponent(id)}`);
      const data = await res.json().catch(() => ({}));
      setSessions(Array.isArray(data.sessions) ? data.sessions : []);
      setNeedsMigration(Boolean(data.needsMigration));
    } catch {
      // Offline or DB unavailable: keep whatever we have.
    }
  }

  useEffect(() => {
    const saved = safeGet(storageKey);
    const onboarded = safeGet(onboardedKey);
    if (saved) {
      try { setPrefs({ ...defaultPreferences, ...JSON.parse(saved) }); } catch { /* ignore corrupt */ }
      // Existing device with a profile: never re-show setup uninvited.
      if (!onboarded) safeSet(onboardedKey, '1');
    } else if (!onboarded) {
      setShowOnboarding(true);
    }
    const id = getDeviceId();
    setDeviceId(id);
    loadSavedReports(id);
    loadSessions(id);
  }, []);
  useEffect(() => { safeSet(storageKey, JSON.stringify(prefs)); }, [prefs]);

  useEffect(() => {
    if (!busy) { setLoadingLine(0); return; }
    const timer = setInterval(() => setLoadingLine(i => (i + 1) % loadingLines.length), 1700);
    return () => clearInterval(timer);
  }, [busy]);

  function finishOnboarding() {
    safeSet(onboardedKey, '1');
    setShowOnboarding(false);
  }

  function onImage(file: File | null) {
    if (preview) URL.revokeObjectURL(preview);
    setImage(file);
    setPreview(file ? URL.createObjectURL(file) : null);
  }

  // "Done with it": wipe the card and reset the scan inputs for the next product.
  function clearReport() {
    setReport(null);
    setAnalyzeError(null);
    setQuestion('');
    onImage(null);
  }

  async function analyze() {
    setBusy(true);
    setReport(null);
    setAnalyzeError(null);

    try {
      const form = new FormData();
      form.set('question', question);
      form.set('preferences', JSON.stringify(prefs));
      form.set('deviceId', deviceId);
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
    setSaving(true);
    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ report, deviceId })
      });
      const data = await res.json().catch(() => ({}));
      if (data?.saved) {
        await loadSavedReports(deviceId);
        showToast('Saved 🛒 Log the session in Journal after you try it.');
      } else if (data?.localOnly) {
        showToast('Saved locally — database not configured.');
      } else {
        showToast('Could not save. Please try again.');
      }
    } catch {
      showToast('Network error while saving. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  const activeWants = useMemo(() =>
    Object.entries(prefs)
      .filter(([k, v]) => v === true && !k.startsWith('avoid'))
      .map(([k]) => labels[k])
      .filter(Boolean)
      .slice(0, 5),
  [prefs]);

  if (showOnboarding) {
    return <main className="app">
      <section className="hero">
        <div className="kicker">1Toke</div>
        <h1>Your pocket budtender.</h1>
        <p>Thirty seconds of setup and every report card gets scored against <i>you</i>, not the average stoner.</p>
      </section>
      <Onboarding prefs={prefs} setPrefs={setPrefs} onDone={finishOnboarding} />
    </main>;
  }

  return <main className="app">
    <section className="hero">
      <div className="kicker">1Toke</div>
      <h1>{heroCopy[tab].title}</h1>
      <p>{heroCopy[tab].sub}</p>
    </section>

    {tab === 'scan' && <div className="stack">
      <div className="card stack">
        <div className="row">
          <label className="filebtn">📷 Snap the label
            <input type="file" accept="image/*" capture="environment" onChange={e => { onImage(e.target.files?.[0] || null); e.target.value = ''; }} />
          </label>
          <label className="filebtn">🖼 From gallery
            <input type="file" accept="image/*" onChange={e => { onImage(e.target.files?.[0] || null); e.target.value = ''; }} />
          </label>
        </div>
        {preview && <div className="preview-wrap">
          <img className="preview" src={preview} alt="Selected product" />
          <button className="clear" onClick={() => onImage(null)} aria-label="Remove image">✕</button>
        </div>}
        <label>Or just ask
          <textarea value={question} onChange={e => setQuestion(e.target.value)} placeholder="Example: CBX L'Orange 29% THC. Good for creative daytime vibes?" />
        </label>
        <button className="primary" onClick={analyze} disabled={busy || (!question.trim() && !image)}>
          {busy ? loadingLines[loadingLine] : 'Get the verdict'}
        </button>
        {analyzeError && <div className="card stack" role="alert" aria-live="polite">
          <div className="kicker">Could not complete analysis</div>
          <p><b>{analyzeError.message}</b></p>
          {analyzeError.details && <details>
            <summary>Debug details</summary>
            <p className="small">{analyzeError.details}</p>
          </details>}
        </div>}
        <button className="tuning small" onClick={() => setTab('profile')}>
          🎛 Tuned for: {activeWants.join(' · ') || 'nothing yet — tap to set your vibe'}
        </button>
      </div>

      {report && (report.confidence === 'low'
        ? <LowConfidenceCard report={report} searchAttempted={searchAttempted} searchTerm={searchTerm} onDismiss={clearReport} />
        : <ReportCard report={report} onSave={saveReport} saving={saving} onDismiss={clearReport} />)}

      {!report && <InstallPrompt />}
    </div>}

    {tab === 'journal' && <JournalTab
      deviceId={deviceId}
      sessions={sessions}
      needsMigration={needsMigration}
      savedReports={savedReports}
      onLogged={() => loadSessions(deviceId)}
      showToast={showToast}
    />}

    {tab === 'discover' && <DiscoverTab sessions={sessions} />}

    {tab === 'profile' && <ProfileTab prefs={prefs} setPrefs={setPrefs} onReplaySetup={() => setShowOnboarding(true)} />}

    {toast && <div className="toast" role="status">{toast}</div>}

    <nav className="nav">
      {navItems.map(t =>
        <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
          <span className="nav-icon">{t.icon}</span>{t.label}
        </button>
      )}
    </nav>
  </main>;
}
