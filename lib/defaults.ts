import { Preferences } from './types';

export const defaultPreferences: Preferences = {
  creative: true,
  social: true,
  focused: false,
  euphoric: true,
  calm: false,
  sleepy: false,
  bodyRelaxed: false,
  uplifting: true,
  energetic: false,
  happy: true,
  music: false,
  daytime: true,
  avoidAnxious: true,
  avoidFoggy: true,
  avoidCouchLock: true,
  avoidHeavyComedown: true,
  avoidMunchies: false,
  citrus: true,
  pine: true,
  berry: false,
  tropical: true,
  gas: false,
  earthy: false,
  dessert: false,
  intensity: 45,
  tolerance: 'medium',
  mode: 'safe'
};

export const chipGroups = [
  { title: 'I want to feel', keys: ['creative','social','focused','euphoric','calm','sleepy','bodyRelaxed','uplifting','energetic','happy','music','daytime'] as const },
  { title: 'Avoid', keys: ['avoidAnxious','avoidFoggy','avoidCouchLock','avoidHeavyComedown','avoidMunchies'] as const },
  { title: 'Flavor pulls me in', keys: ['citrus','pine','berry','tropical','gas','earthy','dessert'] as const }
];

export const labels: Record<string, string> = {
  creative: '🎨 Creative', social: '💬 Social', focused: '🎯 Focused', euphoric: '✨ Euphoric', calm: '😌 Calm', sleepy: '😴 Sleepy', bodyRelaxed: '🛋 Body',
  uplifting: '🌞 Uplifting', energetic: '⚡ Energetic', happy: '😄 Happy', music: '🎵 Music', daytime: '☀️ Daytime',
  avoidAnxious: '😬 Anxiety', avoidFoggy: '🌫 Foggy', avoidCouchLock: '🪨 Couch-lock', avoidHeavyComedown: '⬇ Heavy comedown', avoidMunchies: '🍕 Munchies',
  citrus: '🍋 Citrus', pine: '🌲 Pine', berry: '🫐 Berry', tropical: '🥭 Tropical', gas: '⛽ Gas', earthy: '🌱 Earthy', dessert: '🍪 Dessert'
};
