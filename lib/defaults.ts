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
  avoidAnxious: false,
  avoidFoggy: false,
  avoidCouchLock: false,
  avoidHeavyComedown: false,
  avoidMunchies: false,
  citrus: false,
  pine: false,
  berry: false,
  tropical: false,
  gas: false,
  earthy: false,
  dessert: false,
  intensity: 50,
  tolerance: 'medium',
  mode: 'safe'
};

export const chipGroups = [
  { title: 'I want to feel', keys: ['creative','social','focused','euphoric','calm','sleepy','bodyRelaxed','uplifting','energetic','happy','music','daytime'] as const },
  { title: 'Kill the vibe (avoid)', keys: ['avoidAnxious','avoidFoggy','avoidCouchLock','avoidHeavyComedown','avoidMunchies'] as const },
  { title: 'Flavors that pull me in', keys: ['citrus','pine','berry','tropical','gas','earthy','dessert'] as const }
];

export const labels: Record<string, string> = {
  creative: '🎨 Creative', social: '💬 Social', focused: '🎯 Focused', euphoric: '✨ Euphoric', calm: '😌 Calm', sleepy: '😴 Sleepy', bodyRelaxed: '🛋 Body',
  uplifting: '🌞 Uplifting', energetic: '⚡ Energetic', happy: '😄 Happy', music: '🎵 Music', daytime: '☀️ Daytime',
  avoidAnxious: '😬 Anxiety', avoidFoggy: '🌫 Fog', avoidCouchLock: '🪨 Couch-lock', avoidHeavyComedown: '⬇ Heavy comedown', avoidMunchies: '🍕 Munchies',
  citrus: '🍋 Citrus', pine: '🌲 Pine', berry: '🫐 Berry', tropical: '🥭 Tropical', gas: '⛽ Gas', earthy: '🌱 Earthy', dessert: '🍪 Dessert'
};

export const feelingOptions = ['Creative','Happy','Social','Focused','Relaxed','Sleepy','Foggy','Anxious','Munchies'] as const;

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
