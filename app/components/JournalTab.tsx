'use client';

import { useState } from 'react';
import { feelingOptions } from '@/lib/defaults';
import { SavedReport } from '@/lib/types';

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
  const feelings: string[] = Array.isArray(session.feelings) ? session.feelings : [];

  return <div className="session-card" onClick={() => rep && setOpen(o => !o)}>
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
      <span className="small expand-hint">{rep ? (open ? '▾ product details' : '▸ product details') : ''}</span>
      <button className="editlink small" onClick={e => { e.stopPropagation(); onEdit(); }}>✎ Edit</button>
    </div>
    {open && rep && <div className="stack" onClick={e => e.stopPropagation()}>
      <div className="metric"><b>Decision was</b><span>{rep.buyDecision || '—'} · score {rep.matchScore ?? '—'}</span></div>
      <div className="metric"><b>Cannabinoids</b><span>{rep.cannabinoids || 'Unknown'}</span></div>
      <div className="metric"><b>Terpenes</b><span>{Array.isArray(rep.terpenes) && rep.terpenes.length ? rep.terpenes.join(', ') : 'Unknown'}</span></div>
    </div>}
  </div>;
}

export default function JournalTab({ deviceId, sessions, needsMigration, savedReports, onLogged, showToast }: {
  deviceId: string;
  sessions: any[];
  needsMigration: boolean;
  savedReports: SavedReport[];
  onLogged: () => Promise<void>;
  showToast: (msg: string) => void;
}) {
  // null = timeline; 'new' = logging; otherwise the session being edited.
  const [editing, setEditing] = useState<'new' | any | null>(null);
  const [pickedReportId, setPickedReportId] = useState<string | 'other' | null>(null);
  const [customName, setCustomName] = useState('');
  const [feelings, setFeelings] = useState<string[]>([]);
  const [rating, setRating] = useState(0);
  const [wouldBuyAgain, setWouldBuyAgain] = useState<boolean | null>(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const recentReports = savedReports.slice(0, 8);
  const isEdit = editing !== null && editing !== 'new';

  function openNew() {
    setEditing('new');
    setPickedReportId(null);
    setCustomName('');
    setFeelings([]);
    setRating(0);
    setWouldBuyAgain(null);
    setNotes('');
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
    setConfirmDelete(false);
  }

  function close() {
    setEditing(null);
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
      const payload: any = { deviceId, strainName, rating, feelings, wouldBuyAgain, notes };
      if (isEdit) payload.id = editing.id;
      else payload.reportId = pickedReportId === 'other' ? null : pickedReportId;

      const res = await fetch('/api/sessions', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (data?.saved) {
        await onLogged();
        close();
        showToast(isEdit ? 'Updated ✍️' : 'Logged 📓 Future you says thanks.');
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
      const res = await fetch(`/api/sessions?id=${encodeURIComponent(editing.id)}&deviceId=${encodeURIComponent(deviceId)}`, { method: 'DELETE' });
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
      <div className="kicker">{isEdit ? 'Fix it up' : '10 seconds, tops'}</div>
      <h2>{isEdit ? 'Edit the session' : 'Log the session'}</h2>

      <h3>What did you have?</h3>
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

      <h3>How did it feel?</h3>
      <div className="chips">{feelingOptions.map(f =>
        <button key={f} className={`chip ${feelings.includes(f) ? 'active' : ''}`} onClick={() => setFeelings(cur => cur.includes(f) ? cur.filter(x => x !== f) : [...cur, f])}>{f}</button>
      )}</div>

      <h3>Rate it</h3>
      <Stars value={rating} onChange={setRating} />

      <h3>Buy it again?</h3>
      <div className="chips">
        <button className={`chip ${wouldBuyAgain === true ? 'active' : ''}`} onClick={() => setWouldBuyAgain(w => w === true ? null : true)}>👍 Yes</button>
        <button className={`chip ${wouldBuyAgain === false ? 'active' : ''}`} onClick={() => setWouldBuyAgain(w => w === false ? null : false)}>👎 Never</button>
      </div>

      <label>Notes (optional)
        <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Comedown? How long did it last? Anything surprising?" />
      </label>

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
      {sessions.length === 0 && !needsMigration && <p>Nothing logged yet. Flower, vape, gummy, whatever — after your next session, come back and tap it in. This is literally how I get smarter about you.</p>}
      {sessions.map(s => <SessionCard key={s.id} session={s} onEdit={() => openEdit(s)} />)}
    </div>

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
