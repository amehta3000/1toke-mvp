'use client';

import { useState } from 'react';
import { getSupabaseBrowser } from '@/lib/supabaseBrowser';
import { safeGet } from '@/lib/storage';

export default function AccountCard({ email, isAnonymous, onChanged, showToast }: {
  email: string | null;
  isAnonymous: boolean;
  onChanged: () => Promise<void> | void;
  showToast: (msg: string) => void;
}) {
  const [stage, setStage] = useState<'idle' | 'code'>('idle');
  const [mode, setMode] = useState<'link' | 'signin'>('link');
  const [addr, setAddr] = useState('');
  const [code, setCode] = useState('');
  const [prevToken, setPrevToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!getSupabaseBrowser()) return null;

  async function sendCode() {
    const sb = getSupabaseBrowser();
    if (!sb) return;
    const target = addr.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(target)) { showToast('That email doesn’t look right 🤔'); return; }
    setBusy(true);
    try {
      const { data: { session } } = await sb.auth.getSession();
      setPrevToken(session?.access_token || null);

      if (!session) {
        // No anonymous session (e.g. anonymous sign-ins disabled): plain OTP sign-in/up.
        const { error } = await sb.auth.signInWithOtp({ email: target });
        if (error) { showToast(error.message); return; }
        setMode('signin');
        setStage('code');
        showToast('Code sent 📬 Check your inbox.');
        return;
      }

      // Anonymous user: try attaching the email to this account first — that
      // keeps every row they already have, zero migration.
      const { error } = await sb.auth.updateUser({ email: target });
      if (!error) {
        setMode('link');
        setStage('code');
        showToast('Code sent 📬 Check your inbox.');
        return;
      }
      if (!/already|registered|exists/i.test(error.message)) { showToast(error.message); return; }

      // Email belongs to an existing account: sign into it instead, then merge
      // this device's anonymous data via /api/claim after verification.
      const { error: otpError } = await sb.auth.signInWithOtp({ email: target, options: { shouldCreateUser: false } });
      if (otpError) { showToast(otpError.message); return; }
      setMode('signin');
      setStage('code');
      showToast('Welcome back 👋 Code sent — check your inbox.');
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    const sb = getSupabaseBrowser();
    if (!sb) return;
    const token = code.trim();
    if (token.length < 6) { showToast('Enter the 6-digit code from the email'); return; }
    setBusy(true);
    try {
      const type = mode === 'link' ? 'email_change' as const : 'email' as const;
      const { data, error } = await sb.auth.verifyOtp({ email: addr.trim().toLowerCase(), token, type });
      if (error) { showToast('That code didn’t work — double-check it or resend.'); return; }

      if (mode === 'signin') {
        // Fold this device's anonymous journal into the account we just entered.
        const newToken = data.session?.access_token;
        try {
          await fetch('/api/claim', {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...(newToken ? { authorization: `Bearer ${newToken}` } : {}) },
            body: JSON.stringify({ previousToken: prevToken, legacyDeviceId: safeGet('1toke:deviceId') })
          });
        } catch { /* merge is best-effort; the account itself is signed in */ }
      }

      setStage('idle');
      setCode('');
      setAddr('');
      await onChanged();
      showToast(mode === 'link' ? 'Journal secured 🔐 It follows you anywhere now.' : 'Signed in ✅ Your journal is synced.');
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    const sb = getSupabaseBrowser();
    if (!sb) return;
    setBusy(true);
    try {
      await sb.auth.signOut();
      await sb.auth.signInAnonymously().catch(() => {});
      await onChanged();
      showToast('Signed out. This device starts a fresh journal.');
    } finally {
      setBusy(false);
    }
  }

  if (!isAnonymous && email) {
    return <div className="card stack">
      <div className="kicker">Account</div>
      <h3>🔐 {email}</h3>
      <p className="small">Your journal is tied to this email. Sign in with it on any device and everything follows.</p>
      <button className="secondary" onClick={signOut} disabled={busy}>Sign out</button>
    </div>;
  }

  return <div className="card stack">
    <div className="kicker">Account</div>
    <h3>Don&apos;t lose your journal</h3>
    {stage === 'idle' && <>
      <p className="small">Right now everything lives on this device only. Add your email and your journal follows you anywhere — no password, just a 6-digit code. Already have an account? Same box.</p>
      <input className="input" type="email" inputMode="email" autoComplete="email" value={addr} onChange={e => setAddr(e.target.value)} placeholder="you@example.com" />
      <button className="primary" onClick={sendCode} disabled={busy}>{busy ? 'Sending…' : 'Email me a code'}</button>
    </>}
    {stage === 'code' && <>
      <p className="small">We sent a 6-digit code to <b>{addr.trim()}</b>. Type it here — that&apos;s the whole thing.</p>
      <input className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} placeholder="123456" />
      <div className="row">
        <button className="secondary" onClick={() => { setStage('idle'); setCode(''); }} disabled={busy}>Back</button>
        <button className="primary" onClick={verify} disabled={busy}>{busy ? 'Checking…' : 'Verify'}</button>
      </div>
    </>}
  </div>;
}
