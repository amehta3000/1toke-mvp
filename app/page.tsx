'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { defaultPreferences, labels } from '@/lib/defaults';
import { Preferences, SavedReport, StrainReport } from '@/lib/types';
import { normalizeReport } from '@/lib/report';
import { getDeviceId, safeGet, safeSet } from '@/lib/storage';
import { getSupabaseBrowser, authFetch } from '@/lib/supabaseBrowser';
import { trackEvent } from '@/lib/analytics';
import Onboarding from './components/Onboarding';
import { ReportCard, LowConfidenceCard } from './components/ReportCard';
import JournalTab from './components/JournalTab';
import ProfileTab from './components/ProfileTab';
import InstallPrompt from './components/InstallPrompt';
import AccountCard from './components/AccountCard';
import TunedForStrip from './components/TunedForStrip';

const storageKey = '1toke:prefs';
const onboardedKey = '1toke:onboarded';
const claimedKey = '1toke:claimed';

type IdentityInfo = { configured: boolean; isAnonymous: boolean; email: string | null };

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
  { id: 'profile', label: 'Profile', icon: '🎛' }
] as const;

// One line, not three: the old kicker + h1 + subhead block repeated the same
// orientation on every tab visit. Each tab now opens with a single sentence.
const heroCopy = {
  scan: 'What vibe are you going for?',
  journal: 'Log it. Future you says thanks.',
  profile: 'This is what I always start from.'
} as const;

export default function Page() {
  const [tab, setTab] = useState<'scan'|'journal'|'profile'>('scan');
  const [prefs, setPrefs] = useState<Preferences>(defaultPreferences);
  // What THIS scan is scored against. Starts as a copy of the saved profile
  // and stays in sync with it, but tapping a chip in the Scan tuned-for strip
  // only touches this — the saved profile doesn't move until Profile itself
  // is edited.
  const [sessionPrefs, setSessionPrefs] = useState<Preferences>(defaultPreferences);
  const [armed, setArmed] = useState(false);
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
  const [identity, setIdentity] = useState<IdentityInfo>({ configured: false, isAnonymous: true, email: null });
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
      const res = await authFetch(`/api/reports?deviceId=${encodeURIComponent(id)}`);
      const data = await res.json().catch(() => ({}));
      setSavedReports(Array.isArray(data.reports) ? data.reports : []);
    } catch {
      // Offline or DB unavailable: keep whatever we have.
    }
  }

  async function loadSessions(id: string) {
    if (!id) return;
    try {
      const res = await authFetch(`/api/sessions?deviceId=${encodeURIComponent(id)}`);
      const data = await res.json().catch(() => ({}));
      setSessions(Array.isArray(data.sessions) ? data.sessions : []);
      setNeedsMigration(Boolean(data.needsMigration));
    } catch {
      // Offline or DB unavailable: keep whatever we have.
    }
  }

  // Establish who this device is: an anonymous Supabase user when accounts are
  // configured (claiming any pre-auth journal rows once), otherwise the legacy
  // device id. Data loads after identity so requests carry the right token.
  async function initIdentity(id: string) {
    const sb = getSupabaseBrowser();
    if (!sb) {
      setIdentity({ configured: false, isAnonymous: true, email: null });
      loadSavedReports(id);
      loadSessions(id);
      return;
    }
    let session = (await sb.auth.getSession()).data.session;
    if (!session) {
      try {
        const { data, error } = await sb.auth.signInAnonymously();
        if (!error) session = data.session;
      } catch { /* fall through to legacy mode */ }
    }
    if (session && !safeGet(claimedKey)) {
      try {
        const res = await fetch('/api/claim', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ legacyDeviceId: id })
        });
        const data = await res.json().catch(() => ({}));
        if (data?.claimed) safeSet(claimedKey, '1');
      } catch { /* claim retries on next visit */ }
    }
    setIdentity({
      configured: true,
      isAnonymous: session ? session.user.is_anonymous !== false : true,
      email: session?.user?.email || null
    });
    loadSavedReports(id);
    loadSessions(id);
  }

  async function refreshIdentity() {
    const sb = getSupabaseBrowser();
    if (!sb) return;
    const session = (await sb.auth.getSession()).data.session;
    setIdentity({
      configured: true,
      isAnonymous: session ? session.user.is_anonymous !== false : true,
      email: session?.user?.email || null
    });
    await Promise.all([loadSavedReports(deviceId), loadSessions(deviceId)]);
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
    initIdentity(id);
  }, []);
  useEffect(() => { safeSet(storageKey, JSON.stringify(prefs)); }, [prefs]);
  useEffect(() => { setSessionPrefs(prefs); }, [prefs]);

  // PWA shortcut (manifest.ts) lands here with ?action=scan — can't force the
  // OS camera picker open without a user gesture, so instead the Snap tile
  // pulses briefly to prompt the one tap that opens it.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (new URLSearchParams(window.location.search).get('action') !== 'scan') return;
    setArmed(true);
    const timer = setTimeout(() => setArmed(false), 1600);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!busy) { setLoadingLine(0); return; }
    const timer = setInterval(() => setLoadingLine(i => (i + 1) % loadingLines.length), 1700);
    return () => clearInterval(timer);
  }, [busy]);

  function finishOnboarding() {
    safeSet(onboardedKey, '1');
    setShowOnboarding(false);
    trackEvent('onboarding_finished', { wants: activeWants.length });
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
      form.set('preferences', JSON.stringify(sessionPrefs));
      form.set('deviceId', deviceId);
      if (image) form.set('image', image);

      const res = await authFetch('/api/analyze', { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const message = data?.error?.message || 'Analysis failed. Please try again.';
        const details = [
          data?.error?.code ? `code=${data.error.code}` : '',
          data?.error?.requestId ? `requestId=${data.error.requestId}` : '',
          data?.error?.hint ? data.error.hint : ''
        ].filter(Boolean).join(' | ');
        setAnalyzeError({ message, details });
        trackEvent('scan_failed', { reason: String(data?.error?.code || res.status) });
        return;
      }

      if (!data?.report) {
        setAnalyzeError({ message: 'No report was returned. Please try again.' });
        trackEvent('scan_failed', { reason: 'empty_report' });
        return;
      }

      const normalized = normalizeReport(data.report);
      setReport(normalized);
      setSearchAttempted(data.searchAttempted || false);
      setSearchTerm(data.searchLabel || data.searchTerm || '');
      setTab('scan');
      trackEvent('scan_completed', {
        input: image ? 'photo' : 'text',
        decision: normalized.buyDecision,
        confidence: normalized.confidence,
        searchFound: Boolean(data.searchFound),
        usedHistory: Boolean(data.usedHistory)
      });
    } catch {
      setAnalyzeError({ message: 'Network error while analyzing. Check your connection and try again.' });
      trackEvent('scan_failed', { reason: 'network' });
    } finally {
      setBusy(false);
    }
  }

  async function saveReport() {
    if (!report) return;
    setSaving(true);
    try {
      const res = await authFetch('/api/reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ report, deviceId })
      });
      const data = await res.json().catch(() => ({}));
      if (data?.saved) {
        await loadSavedReports(deviceId);
        showToast('Saved 🛒 Log the session in Journal after you try it.');
        trackEvent('report_saved', { decision: report.buyDecision });
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
    <div className="brandbar">🌿 1Toke</div>
    <section className="hero-line">
      <h1>{heroCopy[tab]}</h1>
    </section>

    {tab === 'scan' && <div className="stack">
      <div className="card stack">
        <TunedForStrip sessionPrefs={sessionPrefs} setSessionPrefs={setSessionPrefs} savedPrefs={prefs} />

        <div className="row">
          <label className={`filebtn ${armed ? 'armed' : ''}`}>📷 Snap the label
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
      showAccountNudge={identity.configured && identity.isAnonymous && sessions.length >= 2}
      onAccountNudge={() => setTab('profile')}
    />}

    {tab === 'profile' && <div className="stack">
      <ProfileTab prefs={prefs} setPrefs={setPrefs} onReplaySetup={() => setShowOnboarding(true)} />
      <AccountCard email={identity.email} isAnonymous={identity.isAnonymous} onChanged={refreshIdentity} showToast={showToast} />
    </div>}

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
