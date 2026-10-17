// Physical feedback on a tap, where the platform allows it.
//
// Worth knowing: navigator.vibrate is Android/Chrome only — iOS Safari does
// not implement it at all, and there is no web API that reaches the iPhone's
// Taptic engine from a normal button. So on iOS these calls are silent no-ops
// and the press/confirm animations in globals.css are what carry the feel.
// Never gate anything on this working.
function buzz(pattern: number | number[]): void {
  try {
    const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { vibrate?: (p: number | number[]) => boolean }) : null;
    if (nav && typeof nav.vibrate === 'function') nav.vibrate(pattern);
  } catch {
    // A device can refuse or throw here; feedback is a nicety, never a failure.
  }
}

/** A light tick — picking something up, toggling a choice off. */
export function tapLight(): void {
  buzz(10);
}

/** A double beat — a choice landing, worth feeling slightly more than a tick. */
export function tapConfirm(): void {
  buzz([12, 45, 20]);
}
