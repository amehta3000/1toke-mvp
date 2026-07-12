'use client';

import { useMemo } from 'react';

function countTop(items: string[], limit: number): [string, number][] {
  const counts = new Map<string, number>();
  for (const raw of items) {
    const key = raw.trim().toLowerCase();
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

export default function DiscoverTab({ sessions }: { sessions: any[] }) {
  const insights = useMemo(() => {
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
      loved.flatMap(s => {
        const terps = s.reports?.report?.terpenes;
        return Array.isArray(terps) ? terps.map(String) : [];
      }),
      5
    );
    const dislikedTerpenes = countTop(
      disliked.flatMap(s => {
        const terps = s.reports?.report?.terpenes;
        return Array.isArray(terps) ? terps.map(String) : [];
      }),
      3
    );

    return { rated: rated.length, repeatWorthy, notForYou, lovedFeelings, lovedTerpenes, dislikedTerpenes };
  }, [sessions]);

  if (insights.rated < 3) {
    return <div className="card stack">
      <div className="kicker">Discover</div>
      <h2>Your patterns, once there are patterns</h2>
      <p>Log <b>{3 - insights.rated} more rated {3 - insights.rated === 1 ? 'session' : 'sessions'}</b> and this tab starts earning its keep: which strains are repeat-worthy, which terpenes actually work on you, and what to dodge.</p>
      <div className="metric"><b>🔁 Repeat-worthy</b><span>your 4★+ strains land here</span></div>
      <div className="metric"><b>🧪 Terpene wins</b><span>what your best nights have in common</span></div>
      <div className="metric"><b>🙅 Not your thing</b><span>logged so you never rebuy a dud</span></div>
    </div>;
  }

  return <div className="card stack">
    <div className="kicker">Discover</div>
    <h2>What your journal says about you</h2>
    <p className="small">Built from {insights.rated} rated sessions on this device.</p>

    {insights.repeatWorthy.length > 0 && <div className="stack">
      <h3>🔁 Repeat-worthy</h3>
      {insights.repeatWorthy.map(s => <div className="metric" key={s.name}><b>{s.name}</b><span>{'★'.repeat(s.rating)}</span></div>)}
    </div>}

    {insights.lovedFeelings.length > 0 && <div className="stack">
      <h3>💫 Feelings you chase</h3>
      <div className="chips">{insights.lovedFeelings.map(([f, n]) => <span key={f} className="chip active">{f}{n > 1 ? ` ×${n}` : ''}</span>)}</div>
    </div>}

    {insights.lovedTerpenes.length > 0 && <div className="stack">
      <h3>🧪 Terpene wins</h3>
      <p className="small">Showing up in your 4★+ sessions — look for these on labels.</p>
      <div className="chips">{insights.lovedTerpenes.map(([t, n]) => <span key={t} className="chip best">{t}{n > 1 ? ` ×${n}` : ''}</span>)}</div>
    </div>}

    {(insights.notForYou.length > 0 || insights.dislikedTerpenes.length > 0) && <div className="stack">
      <h3>🙅 Not your thing</h3>
      {insights.notForYou.map(name => <div className="metric" key={name}><b>{name}</b><span>rated 2★ or less</span></div>)}
      {insights.dislikedTerpenes.length > 0 && <div className="chips">{insights.dislikedTerpenes.map(([t]) => <span key={t} className="chip warn">{t}</span>)}</div>}
    </div>}
  </div>;
}
