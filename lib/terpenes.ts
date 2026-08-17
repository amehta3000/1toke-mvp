// One plain-English line per terpene — this is the payoff for "you don't
// always know what the terpenes actually mean." Tap a terpene chip, get one
// sentence, not a paragraph.
const glossary: Record<string, string> = {
  limonene: 'Citrusy — tends to lift mood and sharpen focus.',
  pinene: 'Piney — tends to counter the foggy, sleepy side of THC.',
  caryophyllene: 'Peppery — the terpene most linked to easing tension.',
  myrcene: 'Earthy — the terpene most tied to heavy, sedating body effects.',
  linalool: 'Floral — tends to smooth out anxious or racing feelings.',
  humulene: 'Woody, hoppy — mildly appetite-suppressing, often paired with caryophyllene.',
  terpinolene: 'Herbal, a little floral — usually reads more uplifting than sedating.',
  ocimene: 'Sweet, herbal — often shows up in uplifting, energetic profiles.',
  bisabolol: 'Chamomile-like — calming, easy on irritated skin and nerves alike.',
  nerolidol: 'Woody, floral — mildly sedating, sometimes boosts other terpenes’ absorption.',
  guaiol: 'Piney, rosy — associated with anti-inflammatory effects.',
  valencene: 'Citrusy, sweet — less common, usually rides along with limonene.',
  camphene: 'Damp, earthy — sometimes linked to supporting heart and skin health.',
  eucalyptol: 'Minty, cooling — also called cineole, tied to mental clarity.',
  cineole: 'Minty, cooling — also called eucalyptol, tied to mental clarity.'
};

export function terpeneNote(rawName: string): string | null {
  const key = rawName.trim().toLowerCase();
  return glossary[key] || null;
}
