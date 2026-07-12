// Mobile-safe local storage helpers.
// Handles: SSR (no window), Safari Private Mode (setItem throws),
// and non-secure LAN contexts (http://<ip>) where crypto.randomUUID is missing.

const DEVICE_ID_KEY = '1toke:deviceId';

function hasLocalStorage(): boolean {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    const probe = '__1toke_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

export function safeGet(key: string): string | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeSet(key: string, value: string): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(key, value);
  } catch {
    // Private mode / quota: fail silently, app still works in-memory.
  }
}

function uuidv4(): string {
  // Prefer native (secure contexts: https or localhost).
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for http LAN access on phones (non-secure context).
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}

// Returns a stable per-device anonymous ID. Creates one on first use.
// If storage is unavailable, returns a session-only ID (won't persist).
export function getDeviceId(): string {
  const existing = safeGet(DEVICE_ID_KEY);
  if (existing) return existing;
  const id = uuidv4();
  if (hasLocalStorage()) safeSet(DEVICE_ID_KEY, id);
  return id;
}
