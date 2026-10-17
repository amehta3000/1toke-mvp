import { Preferences } from './types';

// Neutral starting point: no assumed vibe. Onboarding (or the profile tab)
// is where a person's actual preferences get set.
export const defaultPreferences: Preferences = {
  creative: false,
  social: false,
  focused: false,
  euphoric: false,
  calm: false,
  sleepy: false,
  bodyRelaxed: false,
  uplifting: false,
  energetic: false,
  happy: false,
  music: false,
  daytime: false,
  painRelief: false,
  cozy: false,
  nighttime: false,
  unwind: false,
  appetite: false,
  nauseaRelief: false,
  confidence: false,
  lowOdor: false,
  avoidAnxious: false,
  avoidFoggy: false,
  avoidCouchLock: false,
  avoidHeavyComedown: false,
  avoidMunchies: false,
  avoidRacingHeart: false,
  avoidDryMouth: false,
  citrus: false,
  pine: false,
  berry: false,
  tropical: false,
  gas: false,
  earthy: false,
  dessert: false,
  intensity: 50,
  tolerance: 'medium',
  mode: 'safe',
  // Balanced/neutral — same "no assumed vibe" philosophy as everything else here.
  headBodyLean: 50
};

export const chipGroups = [
  { title: 'I want to feel', keys: ['creative','social','focused','euphoric','calm','sleepy','bodyRelaxed','uplifting','energetic','happy','music','daytime','painRelief','cozy','nighttime','unwind','appetite','nauseaRelief','confidence','lowOdor'] as const },
  { title: 'Kill the vibe (avoid)', keys: ['avoidAnxious','avoidFoggy','avoidCouchLock','avoidHeavyComedown','avoidMunchies','avoidRacingHeart','avoidDryMouth'] as const },
  { title: 'Flavors that pull me in', keys: ['citrus','pine','berry','tropical','gas','earthy','dessert'] as const }
];

// Shown by default in Onboarding/Profile; everything else in chipGroups sits
// behind a "show more" reveal so the default view stays scannable.
export const coreKeys = new Set<string>([
  'creative', 'social', 'euphoric', 'citrus', 'calm', 'sleepy', 'focused', 'painRelief',
  'avoidAnxious', 'avoidCouchLock'
]);

export const labels: Record<string, string> = {
  creative: '🎨 Creative', social: '💬 Social', focused: '🎯 Focused', euphoric: '✨ Euphoric', calm: '😌 Calm', sleepy: '😴 Sleepy', bodyRelaxed: '🛋 Body',
  uplifting: '🌞 Uplifting', energetic: '⚡ Energetic', happy: '😄 Happy', music: '🎵 Music boost', daytime: '☀️ Daytime',
  painRelief: '🩹 Pain relief', cozy: '📺 Cozy couch', nighttime: '🌙 Nighttime', unwind: '🧘 Unwind', appetite: '🍽 Appetite boost',
  nauseaRelief: '🤢 Nausea relief', confidence: '💪 Confidence', lowOdor: '🤫 Low-odor',
  avoidAnxious: '😬 Anxiety', avoidFoggy: '🌫 Fog', avoidCouchLock: '🪨 Couch-lock', avoidHeavyComedown: '⬇ Heavy comedown', avoidMunchies: '🍕 Munchies',
  avoidRacingHeart: '💓 Racing heart', avoidDryMouth: '🌵 Dry mouth',
  citrus: '🍋 Citrus', pine: '🌲 Pine', berry: '🫐 Berry', tropical: '🥭 Tropical', gas: '⛽ Gas', earthy: '🌱 Earthy', dessert: '🍪 Dessert'
};

export const feelingOptions = ['Creative','Happy','Social','Focused','Relaxed','Sleepy','Cozy','Pain relief','Giggly','Foggy','Anxious','Munchies'] as const;

export const toleranceHints: Record<Preferences['tolerance'], string> = {
  low: 'Lightweight — a little goes a long way',
  medium: 'Regular-ish — I know my lane',
  high: 'Seasoned — high THC doesn’t scare me'
};

export const modeHints: Record<Preferences['mode'], string> = {
  safe: 'Stick close to what works for me',
  explore: 'Nudge me toward adjacent new things',
  surprise: 'Feeling lucky — pitch me wildcards'
};

// Indica/Sativa labels are often marketing, not chemistry — this dial scores
// against the terpene-derived lean instead, independent of what's printed.
export function leanReadoutText(v: number): string {
  if (v <= 20) return 'Mostly head';
  if (v <= 40) return 'Head-leaning';
  if (v <= 60) return 'Balanced';
  if (v <= 80) return 'Body-leaning';
  return 'Mostly body';
}
