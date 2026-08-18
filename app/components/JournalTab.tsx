'use client';

import { useMemo, useState } from 'react';
import { feelingOptions } from '@/lib/defaults';
import { SavedReport } from '@/lib/types';
import { authFetch } from '@/lib/supabaseBrowser';
import { trackEvent } from '@/lib/analytics';

// Folded in from the old standalone Discover tab: a permanent 4th nav item
// was dead weight for anyone under 3 rated sessions, so this now lives as a
// section of Journal instead — the payoff for logging, right where the data
// that produces it already lives.
function countTop(items: string[], limit: number): [string, number][] {
  const counts = new Map<string, number>();
  for (const raw of items) {
    const key = raw.trim().toLowerCase();
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function usePatterns(sessions: any[]) {
  return useMemo(() => {
    const rated = sessions.filter(s => typeof s.rating === 'number');
    const loved = rated.filter(s => s.rating >= 4);
    const disliked = rated.filter(s => s.rating <= 2);

    const seen = new Set<string>();
    const repeatWorthy = loved
      .map(s => ({ name: s.strain_name as string, rating: s.rating as number }))
      .filter(s => {
        const key = s.name.toLowerCase();
        if (!s.name || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 5);

    const notForYou = [...new Set(disliked.map(s => (s.strain_name as string) || '').filter(Boolean))].slice(0, 5);
    const lovedFeelings = countTop(loved.flatMap(s => Array.isArray(s.feelings) ? s.feelings : []), 5);
    const lovedTerpenes = countTop(
      loved.flatMap(s => { const t = s.reports?.report?.terpenes; return Array.isArray(t) ? t.map(String) : []; }),
      5
    );
    const dislikedTerpenes = countTop(
      disliked.flatMap(s => { const t = s.reports?.report?.terpenes; return Array.isArray(t) ? t.map(String) : []; }),
      3
    );

    return { rated: rated.length, repeatWorthy, notForYou, lovedFeelings, lovedTerpenes, dislikedTerpenes };
  }, [sessions]);
}

export function Stars({ value, onChange }: { value: number; onChange?: (v: number) => void }) {
  return <div className={`stars ${onChange ? 'tappable' : ''}`}>
    {[1, 2, 3, 4, 5].map(n =>
      onChange
        ? <button key={n} className={`star ${n <= value ? 'on' : ''}`} onClick={() => onChange(n)} aria-label={`${n} out of 5`}>★</button>
        : <span key={n} className={`star ${n <= value ? 'on' : ''}`}>★</span>
    )}
  </div>;
}

function SessionCard({ session, onEdit }: { session: any; onEdit: () => void }) {
  const [open, setOpen] = useState(false);
  const rep = session.reports?.report || null;
  const when = session.created_at ? new Date(session.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
  const whenFull = session.created_at
    ? new Date(session.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '';
  const feelings: string[] = Array.isArray(session.feelings) ? session.feelings : [];
  const hasLocation = typeof session.location_lat === 'number';

  return <div className="session-card" onClick={() => setOpen(o => !o)}>
    <div className="pillline">
      <div>
        <b>{session.strain_name || 'Unnamed session'}</b>
        <div className="small">{when}{session.would_buy_again === true ? ' · 👍 would buy again' : session.would_buy_again === false ? ' · 👎 never again' : ''}</div>
      </div>
      {session.rating ? <Stars value={session.rating} /> : null}
    </div>
    {feelings.length > 0 && <div className="chips">{feelings.map(f => <span key={f} className="chip mini">{f}</span>)}</div>}
    {session.notes && <p className="notes">“{session.notes}”</p>}
    <div className="pillline">
      <span className="small expand-hint">{open ? '▾ details' : '▸ details'}</span>
      <button className="editlink small" onClick={e => { e.stopPropagation(); onEdit(); }}>✎ Edit</button>
    </div>
    {open && <div className="stack" onClick={e => e.stopPropagation()}>
      <div className="metric"><b>Logged</b><span>{whenFull}</span></div>
      {hasLocation && <div className="metric"><b>Location</b><span>📍 Tagged</span></div>}
      {rep && <>
        <div className="metric"><b>Decision was</b><span>{rep.buyDecision || '—'} · score {rep.matchScore ?? '—'}</span></div>
        <div className="metric"><b>Cannabinoids</b><span>{rep.cannabinoids || 'Unknown'}</span></div>
        <div className="metric"><b>Terpenes</b><span>{Array.isArray(rep.terpenes) && rep.terpenes.length ? rep.terpenes.join(', ') : 'Unknown'}</span></div>
      </>}
    </div>}
  </div>;
}

export default function JournalTab({ deviceId, sessions, needsMigration, savedReports, onLogged, showToast, showAccountNudge, onAccountNudge }: {
  deviceId: string;
  sessions: any[];
  needsMigration: boolean;
  savedReports: SavedReport[];
  onLogged: () => Promise<void>;
  showToast: (msg: string) => void;
  showAccountNudge?: boolean;
  onAccountNudge?: () => void;
}) {
  // null = timeline; 'new' = logging; otherwise the session being edited.
  const [editing, setEditing] = useState<'new' | any | null>(null);
  const [pickedReportId, setPickedReportId] = useState<string | 'other' | null>(null);
  const [customName, setCustomName] = useState('');
  const [feelings, setFeelings] = useState<string[]>([]);
  const [rating, setRating] = useState(0);
  const [wouldBuyAgain, setWouldBuyAgain] = useState<boolean | null>(null);
  const [notes, setNotes] = useState('');
  const [locationOn, setLocationOn] = useState(false);
  const [locationCoords, setLocationCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const recentReports = savedReports.slice(0, 8);
  const isEdit = editing !== null && editing !== 'new';
  const patterns = usePatterns(sessions);

  function openNew() {
    setEditing('new');
    setPickedReportId(null);
    setCustomName('');
    setFeelings([]);
    setRating(0);
    setWouldBuyAgain(null);
    setNotes('');
    setLocationOn(false);
    setLocationCoords(null);
    setConfirmDelete(false);
  }

  function openEdit(session: any) {
    setEditing(session);
    setPickedReportId(null);
    setCustomName(session.strain_name || '');
    setFeelings(Array.isArray(session.feelings) ? session.feelings : []);
    setRating(session.rating || 0);
    setWouldBuyAgain(typeof session.would_buy_again === 'boolean' ? session.would_buy_again : null);
    setNotes(session.notes || '');
    const hasLocation = typeof session.location_lat === 'number' && typeof session.location_lng === 'number';
    setLocationOn(hasLocation);
    setLocationCoords(hasLocation ? { lat: session.location_lat, lng: session.location_lng } : null);
    setConfirmDelete(false);
  }

  function close() {
    setEditing(null);
  }

  // Off by default, opt-in only. Nothing is captured until this is tapped —
  // and it stays off unless the browser actually hands back a position.
  function toggleLocation() {
    if (locationOn) { setLocationOn(false); return; }
    if (locationCoords) { setLocationOn(true); return; }
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      showToast('Location isn’t available on this device.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => { setLocationCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setLocationOn(true); },
      () => showToast('Could not get your location — check permissions.'),
      { timeout: 8000 }
    );
  }

  async function save() {
    const picked = recentReports.find(r => r.id === pickedReportId);
    const strainName = isEdit || pickedReportId === 'other'
      ? customName.trim()
      : String(picked?.report?.strainName || '');
    if (!strainName) { showToast('Tell me what you had first 🙂'); return; }
    if (!rating) { showToast('Give it a star rating — that’s the part I learn from'); return; }

    setSaving(true);
    try {
      const payload: any = {
        deviceId, strainName, rating, feelings, wouldBuyAgain, notes,
        locationLat: locationOn && locationCoords ? locationCoords.lat : null,
        locationLng: locationOn && locationCoords ? locationCoords.lng : null
      };
      if (isEdit) payload.id = editing.id;
      else payload.reportId = pickedReportId === 'other' ? null : pickedReportId;

      const res = await authFetch('/api/sessions', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (data?.saved) {
        await onLogged();
        close();
        showToast(isEdit ? 'Updated ✍️' : 'Logged 📓 Future you says thanks.');
        trackEvent(isEdit ? 'session_edited' : 'session_logged', {
          rating,
          feelings: feelings.length,
          hasNotes: Boolean(notes.trim()),
          linkedToReport: !isEdit && pickedReportId !== 'other' && Boolean(pickedReportId)
        });
      } else if (data?.needsMigration) {
        showToast('One-time setup needed: run supabase-schema.sql in Supabase.');
      } else if (data?.localOnly) {
        showToast('No database configured — session not stored.');
      } else {
        showToast('Could not save that. Try again?');
      }
    } catch {
      showToast('Network hiccup — try again.');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setSaving(true);
    try {
      const res = await authFetch(`/api/sessions?id=${encodeURIComponent(editing.id)}&deviceId=${encodeURIComponent(deviceId)}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (data?.deleted) {
        await onLogged();
        close();
        showToast('Entry deleted 🗑');
      } else {
        showToast('Could not delete that. Try again?');
      }
    } catch {
      showToast('Network hiccup — try again.');
    } finally {
      setSaving(false);
    }
  }

  if (editing !== null) {
    return <div className="card stack">
      <h2>{isEdit ? 'Edit the session' : 'Log the session'}</h2>

      <div className="micro-label">What</div>
      {isEdit
        ? <input className="input" value={customName} onChange={e => setCustomName(e.target.value)} placeholder="Strain or product name" />
        : <>
          <div className="chips">
            {recentReports.map(r => {
              const name = String(r.report?.strainName || 'Saved product');
              return <button key={r.id} className={`chip ${pickedReportId === r.id ? 'active' : ''}`} onClick={() => setPickedReportId(r.id)}>{name}</button>;
            })}
            <button className={`chip ${pickedReportId === 'other' ? 'active' : ''}`} onClick={() => setPickedReportId('other')}>✍️ Something else</button>
          </div>
          {pickedReportId === 'other' && <input className="input" value={customName} onChange={e => setCustomName(e.target.value)} placeholder="Strain or product name" />}
        </>}

      <div className="micro-label">Felt like</div>
      <div className="chips">{feelingOptions.map(f =>
        <button key={f} className={`chip ${feelings.includes(f) ? 'active' : ''}`} onClick={() => setFeelings(cur => cur.includes(f) ? cur.filter(x => x !== f) : [...cur, f])}>{f}</button>
      )}</div>

      <Stars value={rating} onChange={setRating} />

      <div className="chips">
        <button className={`chip ${wouldBuyAgain === true ? 'active' : ''}`} onClick={() => setWouldBuyAgain(w => w === true ? null : true)}>👍 Again</button>
        <button className={`chip ${wouldBuyAgain === false ? 'active' : ''}`} onClick={() => setWouldBuyAgain(w => w === false ? null : false)}>👎 Never</button>
      </div>

      <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Comedown? How long did it last? Anything surprising?" />

      <div>
        <button className={`chip loc-chip ${locationOn ? 'active' : ''}`} onClick={toggleLocation}>📍 Tag this location</button>
        <p className="small">Off by default — nothing’s tracked unless you tap this.</p>
      </div>

      <div className="row">
        <button className="secondary" onClick={close}>Cancel</button>
        <button className="primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : isEdit ? 'Save changes' : 'Log it'}</button>
      </div>
      {isEdit && <button className="danger" onClick={remove} disabled={saving}>
        {confirmDelete ? 'Tap again to delete for real' : '🗑 Delete this entry'}
      </button>}
    </div>;
  }

  return <div className="stack">
    <div className="card stack">
      <div className="pillline">
        <div><div className="kicker">Journal</div><h2>Your sessions</h2></div>
        <button className="primary slim" onClick={openNew}>＋ Log a session</button>
      </div>
      {needsMigration && <p className="small banner">⚠️ One-time setup: run the updated <b>supabase-schema.sql</b> in your Supabase SQL editor to store sessions.</p>}
      {showAccountNudge && <button className="banner nudge small" onClick={onAccountNudge}>🔐 This journal lives only on this device. Tap to add your email so it follows you anywhere.</button>}
      {sessions.length === 0 && !needsMigration && <p>Nothing logged yet. Flower, vape, gummy, whatever — after your next session, come back and tap it in. This is literally how I get smarter about you.</p>}
      {sessions.map(s => <SessionCard key={s.id} session={s} onEdit={() => openEdit(s)} />)}
    </div>

    {patterns.rated < 3
      ? <div className="card stack">
          <div className="kicker">Patterns</div>
          <p className="small">Log {3 - patterns.rated} more rated session{3 - patterns.rated === 1 ? '' : 's'} and this unlocks — repeat-worthy strains, terpenes that work on you, what to skip.</p>
        </div>
      : (patterns.repeatWorthy.length > 0 || patterns.lovedFeelings.length > 0 || patterns.lovedTerpenes.length > 0 || patterns.notForYou.length > 0) && <div className="card stack">
          <div className="kicker">Patterns</div>

          {patterns.repeatWorthy.length > 0 && <div className="stack">
            <h3>🔁 Repeat-worthy</h3>
            {patterns.repeatWorthy.map(s => <div className="metric" key={s.name}><b>{s.name}</b><span>{'★'.repeat(s.rating)}</span></div>)}
          </div>}

          {patterns.lovedFeelings.length > 0 && <div className="stack">
            <h3>💫 Feelings you chase</h3>
            <div className="chips">{patterns.lovedFeelings.map(([f, n]) => <span key={f} className="chip active">{f}{n > 1 ? ` ×${n}` : ''}</span>)}</div>
          </div>}

          {patterns.lovedTerpenes.length > 0 && <div className="stack">
            <h3>🧪 Terpene wins</h3>
            <div className="chips">{patterns.lovedTerpenes.map(([t, n]) => <span key={t} className="chip best">{t}{n > 1 ? ` ×${n}` : ''}</span>)}</div>
          </div>}

          {(patterns.notForYou.length > 0 || patterns.dislikedTerpenes.length > 0) && <div className="stack">
            <h3>🙅 Not your thing</h3>
            {patterns.notForYou.map(name => <div className="metric" key={name}><b>{name}</b><span>rated 2★ or less</span></div>)}
            {patterns.dislikedTerpenes.length > 0 && <div className="chips">{patterns.dislikedTerpenes.map(([t]) => <span key={t} className="chip warn">{t}</span>)}</div>}
          </div>}
        </div>}

    {savedReports.length > 0 && <div className="card stack">
      <h3>Products you&apos;ve saved <span className="small">({savedReports.length})</span></h3>
      {savedReports.slice(0, 10).map(r => {
        const rep: any = r.report || {};
        const when = r.created_at ? new Date(r.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
        return <div key={r.id} className="metric">
          <b>{typeof rep.strainName === 'string' ? rep.strainName : 'Saved report'}</b>
          <span>{[rep.buyDecision, when].filter(Boolean).join(' · ')}</span>
        </div>;
      })}
    </div>}
  </div>;
}
