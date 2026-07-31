import { track } from '@vercel/analytics';

// The app is a single route with tab state, so pageviews say almost nothing.
// These few events are what actually show where someone drops off.
// Never send anything a person typed or any product they looked at — shape of
// usage only.
type EventProps = Record<string, string | number | boolean | null>;

export function trackEvent(name: string, props?: EventProps) {
  try {
    track(name, props);
  } catch {
    // Analytics must never break the app.
  }
}
