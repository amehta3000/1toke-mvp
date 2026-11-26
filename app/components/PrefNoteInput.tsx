'use client';

import { labels } from '@/lib/defaults';
import { NOTE_MAX, suggestTags } from '@/lib/prefNote';
import { PreferenceKey, Preferences } from '@/lib/types';

// "Anything else?" — one short line in the person's own words. It goes to the
// model as context; when it overlaps a tag, we offer the tag so the scorer
// and journal patterns can use it too.
export default function PrefNoteInput({ prefs, setPrefs }: {
  prefs: Preferences;
  setPrefs: (fn: (p: Preferences) => Preferences) => void;
}) {
  const note = prefs.note || '';
  const suggestions = suggestTags(note, k => prefs[k] === true);
  const left = NOTE_MAX - note.length;

  function turnOn(key: PreferenceKey) {
    setPrefs(p => ({ ...p, [key]: true }));
  }

  return <div className="stack">
    <h3>Anything else?</h3>
    <input
      className="input"
      value={note}
      maxLength={NOTE_MAX}
      placeholder="e.g. good for hiking, no headaches, not too heavy"
      aria-label="Anything else about how you like to feel, in your own words"
      // Newlines and quotes are stripped when saved; only the length is
      // enforced while typing so the field doesn't fight the cursor.
      onChange={e => setPrefs(p => ({ ...p, note: e.target.value.slice(0, NOTE_MAX) }))}
    />
    {suggestions.length > 0
      ? <div className="chips">
          <span className="small hint">Sounds like:</span>
          {suggestions.map(k =>
            <button key={k} className="chip mini" onClick={() => turnOn(k)}>{k.startsWith('avoid') ? 'Avoid' : '+'} {labels[k]}</button>
          )}
        </div>
      : <p className="small hint">
          In your own words. I read it when scoring{left <= 20 ? ` · ${left} left` : ''}.
        </p>}
  </div>;
}
