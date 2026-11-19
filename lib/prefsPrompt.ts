import { labels } from './defaults';

// The person's tuning written out in plain words for the model.
//
// It used to be JSON.stringify(prefs): every toggle, most of them false. The
// model read `"uplifting": false` as "doesn't want uplifting", so a person
// with nothing selected got told a citrus-forward strain "doesn't fit your
// safe, neutral vibe" — and a strain they'd rated 5★ twice scored 50. An
// unselected toggle means "no preference", never "avoid"; only the explicit
// avoid list means avoid. Listing only what's selected makes that unmissable.

const AVOID = /^avoid/;
const FLAVORS = new Set(['citrus', 'pine', 'berry', 'tropical', 'gas', 'earthy', 'dessert']);

const plain = (key: string) => (labels[key] || key).replace(/^[^\p{L}\p{N}]+/u, '').trim();

export function describePrefs(prefs: Record<string, any>): string {
  const on = Object.keys(prefs || {}).filter(k => prefs[k] === true);
  const wants = on.filter(k => !AVOID.test(k) && !FLAVORS.has(k)).map(plain);
  const avoids = on.filter(k => AVOID.test(k)).map(plain);
  const flavors = on.filter(k => FLAVORS.has(k)).map(plain);

  const lean = typeof prefs?.headBodyLean === 'number' ? Math.round(prefs.headBodyLean) : 50;
  const leanWords = lean <= 35 ? 'head-leaning' : lean >= 65 ? 'body-leaning' : 'balanced';

  const lines = [
    wants.length ? `Wants: ${wants.join(', ')}.` : 'Wants: nothing specific selected for this scan.',
    avoids.length ? `Avoid: ${avoids.join(', ')}.` : 'Avoid: nothing selected.',
    flavors.length ? `Flavors they like: ${flavors.join(', ')}.` : '',
    `Head/body lean: ${lean}/100 (${leanWords}; 0 = all head, 100 = all body).`,
    `Tolerance: ${prefs?.tolerance || 'medium'}. Intensity target: ${typeof prefs?.intensity === 'number' ? Math.round(prefs.intensity) : 50}/100. Adventure mode: ${prefs?.mode || 'safe'}.`,
    'Anything not listed is NO PREFERENCE, not a dislike. Never describe the person as not wanting an effect unless it is on the Avoid list.'
  ];
  if (!wants.length && !avoids.length && !flavors.length) {
    lines.push('With no vibe selected, score mainly from the learned taste and session history: a close match to things they rated highly should land well above 50.');
  }
  return lines.filter(Boolean).join('\n');
}
