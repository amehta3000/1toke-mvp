'use client';

import { useEffect, useState } from 'react';
import { safeGet, safeSet } from '@/lib/storage';

const dismissedKey = '1toke:a2hs-dismissed';

function isStandalone(): boolean {
  if (typeof window === 'undefined') return true;
  return window.matchMedia?.('(display-mode: standalone)').matches || (window.navigator as any).standalone === true;
}

function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  // iPadOS 13+ reports as Mac, but has touch points.
  return /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
}

export default function InstallPrompt() {
  const [mode, setMode] = useState<'hidden' | 'native' | 'ios'>('hidden');
  const [installEvent, setInstallEvent] = useState<any>(null);

  useEffect(() => {
    if (isStandalone() || safeGet(dismissedKey)) return;

    // Android/Chrome: the browser tells us when the app is installable.
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e);
      setMode('native');
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', () => setMode('hidden'));

    // iOS Safari: no install API, so show gentle instructions instead.
    if (isIos()) setMode('ios');

    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  function dismiss() {
    safeSet(dismissedKey, '1');
    setMode('hidden');
  }

  async function install() {
    if (!installEvent) return;
    installEvent.prompt();
    const choice = await installEvent.userChoice.catch(() => null);
    if (choice?.outcome === 'accepted') setMode('hidden');
  }

  if (mode === 'hidden') return null;

  return <div className="card install stack">
    <div className="pillline">
      <div className="stack" style={{ gap: 4 }}>
        <b>📲 Keep 1Toke one tap away</b>
        {mode === 'native'
          ? <span className="small">Add it to your home screen — opens full-screen, right at the counter.</span>
          : <span className="small">Tap <b>Share</b> <span aria-hidden>⎋</span> in Safari, then <b>&ldquo;Add to Home Screen&rdquo;</b>. Opens full-screen like an app.</span>}
      </div>
      <button className="dismiss" onClick={dismiss} aria-label="Dismiss">✕</button>
    </div>
    {mode === 'native' && <button className="primary" onClick={install}>Add to home screen</button>}
  </div>;
}
