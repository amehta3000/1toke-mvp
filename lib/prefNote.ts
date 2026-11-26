import type { PreferenceKey } from './types';

// The free-text "anything else?" note. It isn't a tag: the terpene scorer
// can't score "good for hiking", and free tags would split the journal's
// patterns across "chill" / "chilled" / "chillin". So it's one short line
// that only the model reads, and when it overlaps a real tag we suggest the
// tag instead, so the scorer and the journal can use it too.

export const NOTE_MAX = 140;

// Strip anything that could make the note read like part of the prompt:
// newlines, quotes, backticks and angle brackets go, whitespace collapses,
// and the length is capped. Runs on the client before saving, on the server
// before storing, and again before the note goes into a prompt.
export function cleanNote(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\u0000-\u001f\u007f"'`<>{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NOTE_MAX);
}

// Words people type, mapped to the tag that already covers them. Matched on
// whole words, case-insensitively. Keep entries specific: a suggestion is a
// nudge, and a wrong one is worse than none.
const SYNONYMS: [RegExp, PreferenceKey][] = [
  [/\b(chill|chilled|chillin|mellow|relax(ed|ing)?)\b/, 'calm'],
  [/\b(de-?stress|decompress|wind ?down|after work)\b/, 'unwind'],
  [/\b(sleep|insomnia|bed ?time|knock me out)\b/, 'sleepy'],
  [/\b(night|evening|late)\b/, 'nighttime'],
  [/\b(morning|day ?time|wake ?(and|n) ?bake|work ?day)\b/, 'daytime'],
  [/\b(laugh|laughing|giggl\w*|funny)\b/, 'happy'],
  [/\b(party|parties|friends|social(ize|izing)?|hang ?out|date)\b/, 'social'],
  [/\b((?<!after )work|study|studying|productive|productivity|get stuff done|clear ?head(ed)?)\b/, 'focused'],
  [/\b(art|draw\w*|paint\w*|writ\w*|ideas|brainstorm\w*)\b/, 'creative'],
  [/\b(gym|workout|hike|hiking|run|running|active|outdoors|clean\w*|chores)\b/, 'energetic'],
  [/\b(music|concert|festival|playlist)\b/, 'music'],
  [/\b(movie|movies|tv|netflix|couch(?! ?lock)|cozy)\b/, 'cozy'],
  [/\b(pain|ache|aches|sore|cramps?)\b/, 'painRelief'],
  [/\b(nausea|nauseous|queasy|stomach)\b/, 'nauseaRelief'],
  [/\b(hungry|appetite|eat)\b/, 'appetite'],
  [/\b(body high|melt\w*)\b/, 'bodyRelaxed'],
  [/\b(smell|odor|odour|discreet|stealth)\b/, 'lowOdor'],
  [/\b(anxi\w*|paranoi\w*|panic\w*|jitter\w*|edgy)\b/, 'avoidAnxious'],
  [/\b(foggy|fog|spacey|groggy|forgetful)\b/, 'avoidFoggy'],
  [/\b(stuck|couch ?lock\w*|glued)\b/, 'avoidCouchLock'],
  [/\b(heart|racing|racy)\b/, 'avoidRacingHeart'],
  [/\b(comedown|hangover|crash)\b/, 'avoidHeavyComedown'],
  [/\b(munchies|snacking|overeat\w*)\b/, 'avoidMunchies'],
  [/\b(dry mouth|cotton ?mouth)\b/, 'avoidDryMouth'],
  [/\b(lemon|lime|orange|citrus\w*)\b/, 'citrus'],
  [/\b(pine|piney|woodsy)\b/, 'pine'],
  [/\b(berry|berries|grape|blueberry|strawberry)\b/, 'berry'],
  [/\b(mango|pineapple|tropical|fruity)\b/, 'tropical'],
  [/\b(gas|gassy|diesel|fuel|skunk\w*)\b/, 'gas'],
  [/\b(earthy|hash|dirt|musky)\b/, 'earthy'],
  [/\b(sweet|candy|dessert|cake|cookie|vanilla)\b/, 'dessert']
];

const NEGATION = /\b(no|not|don'?t|without|never|less|too)\s+(\w+\s+)?$/;

// Tags the note seems to mean that aren't switched on yet, in order of first
// appearance, at most `limit`.
export function suggestTags(note: string, isOn: (key: PreferenceKey) => boolean, limit = 3): PreferenceKey[] {
  const text = note.toLowerCase();
  if (text.trim().length < 3) return [];
  const hits: { key: PreferenceKey; at: number }[] = [];
  for (const [re, key] of SYNONYMS) {
    if (isOn(key) || hits.some(h => h.key === key)) continue;
    const m = re.exec(text);
    if (!m) continue;
    // "not sleepy" shouldn't suggest Sleepy. For avoid tags the negation is
    // the point ("no anxiety" -> avoid Anxiety), so only wants are skipped.
    if (!key.startsWith('avoid') && NEGATION.test(text.slice(Math.max(0, m.index - 16), m.index))) continue;
    hits.push({ key, at: m.index });
  }
  return hits.sort((a, b) => a.at - b.at).slice(0, limit).map(h => h.key);
}
