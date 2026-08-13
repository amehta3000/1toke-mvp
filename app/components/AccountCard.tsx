'use client';

import { useEffect, useState } from 'react';
import { getSupabaseBrowser } from '@/lib/supabaseBrowser';
import { safeGet, safeSet } from '@/lib/storage';
import { trackEvent } from '@/lib/analytics';

// Checking email means leaving the app, and iOS routinely evicts a backgrounded
// PWA — which wiped the in-memory "waiting for a code" state and dumped people
// back on the email box with a code they had nowhere to type. Persist the
// pending step so returning to the app resumes it.
const pendingKey = '1toke:pendingVerify';
const PENDING_TTL_MS = 60 * 60 * 1000; // matches the OTP's ~1h lifetime

type Pending = { addr: string; mode: 'link' | 'signin'; at: number };

function readPending(): Pending | null {
  try {
    const raw = safeGet(pendingKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Pending;
    if (!parsed?.addr || Date.now() - parsed.at > PENDING_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

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
  const [busy, setBusy] = useState(false);

  // Resume a code entry that was interrupted by switching to the mail app.
  useEffect(() => {
    const pending = readPending();
    if (pending) {
      setAddr(pending.addr);
      setMode(pending.mode);
      setStage('code');
    }
  }, []);

  function startPending(target: string, nextMode: 'link' | 'signin') {
    safeSet(pendingKey, JSON.stringify({ addr: target, mode: nextMode, at: Date.now() }));
    setMode(nextMode);
    setStage('code');
  }

  function clearPending() {
    safeSet(pendingKey, '');
    setStage('idle');
    setCode('');
  }

  if (!getSupabaseBrowser()) return null;

  // Supabase auth errors vary in shape; an SMTP failure in particular can come
  // back with an unhelpful body. Pull out whatever is actually there, and log
  // the raw object so the console has the full picture.
  function describeError(err: any, fallback: string): string {
    console.error('[1toke auth]', err);
    const raw = typeof err?.message === 'string' ? err.message.trim() : '';
    const message = raw && raw !== '{}' && raw !== '[object Object]' ? raw : '';
    const status = err?.status ? `HTTP ${err.status}` : '';
    const code = typeof err?.code === 'string' ? err.code : '';
    const detail = [message, code, status].filter(Boolean).join(' · ');
    if (!detail) return fallback;
    // The most common real cause: SMTP configured but the provider rejected it.
    if (/sending|smtp|mail/i.test(detail)) {
      return `Email couldn't be sent — check SMTP + sender domain. (${detail})`;
    }
    return detail;
  }

  async function sendCode() {
    const sb = getSupabaseBrowser();
    if (!sb) return;
    const target = addr.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(target)) { showToast('That email doesn’t look right 🤔'); return; }
    setBusy(true);
    try {
      const { data: { session } } = await sb.auth.getSession();

      if (!session) {
        // No anonymous session (e.g. anonymous sign-ins disabled): plain OTP sign-in/up.
        const { error } = await sb.auth.signInWithOtp({ email: target });
        if (error) { showToast(describeError(error, 'Could not send the code. Try again in a minute.')); return; }
        startPending(target, 'signin');
        showToast('Code sent 📬 Check your inbox.');
        return;
      }

      // Anonymous user: try attaching the email to this account first — that
      // keeps every row they already have, zero migration.
      const { error } = await sb.auth.updateUser({ email: target });
      if (!error) {
        startPending(target, 'link');
        showToast('Code sent 📬 Check your inbox.');
        return;
      }
      if (!/already|registered|exists/i.test(String(error.message || ''))) {
        showToast(describeError(error, 'Could not send the code. Try again in a minute.'));
        return;
      }

      // Email belongs to an existing account: sign into it instead, then merge
      // this device's anonymous data via /api/claim after verification.
      const { error: otpError } = await sb.auth.signInWithOtp({ email: target, options: { shouldCreateUser: false } });
      if (otpError) { showToast(describeError(otpError, 'Could not send the code. Try again in a minute.')); return; }
      startPending(target, 'signin');
      showToast('Welcome back 👋 Code sent — check your inbox.');
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    const sb = getSupabaseBrowser();
    if (!sb) return;
    const token = code.trim();
    if (token.length < 6) { showToast('Enter the whole code from the email'); return; }
    setBusy(true);
    try {
      // Capture the outgoing (anonymous) token here rather than at send time:
      // the app may have reloaded in between, and this survives that.
      const { data: { session: outgoing } } = await sb.auth.getSession();
      const prevToken = outgoing?.access_token || null;

      const type = mode === 'link' ? 'email_change' as const : 'email' as const;
      const { data, error } = await sb.auth.verifyOtp({ email: addr.trim().toLowerCase(), token, type });
      if (error) { showToast(describeError(error, 'That code didn’t work — double-check it or resend.')); return; }

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

      clearPending();
      setAddr('');
      await onChanged();
      showToast(mode === 'link' ? 'Journal secured 🔐 It follows you anywhere now.' : 'Signed in ✅ Your journal is synced.');
      trackEvent('account_verified', { mode });
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
      <p className="small">Right now everything lives on this device only. Add your email and your journal follows you anywhere — no password, just a code from your inbox. Already have an account? Same box.</p>
      <input className="input" type="email" inputMode="email" autoComplete="email" value={addr} onChange={e => setAddr(e.target.value)} placeholder="you@example.com" />
      <button className="primary" onClick={sendCode} disabled={busy}>{busy ? 'Sending…' : 'Email me a code'}</button>
      {/* Escape hatch: if someone has a code but the app lost its place, this
          gets them to the entry screen without emailing a second code. */}
      <button className="tuning small" onClick={() => setStage('code')}>Already have a code? Enter it →</button>
    </>}
    {stage === 'code' && <>
      <p className="small">{addr.trim()
        ? <>We sent a code to <b>{addr.trim()}</b>. Type it in — checking your email won&apos;t lose your place.</>
        : <>Enter the email you requested the code for, then the code itself.</>}</p>
      {!addr.trim() && <input className="input" type="email" inputMode="email" autoComplete="email" value={addr} onChange={e => setAddr(e.target.value)} placeholder="you@example.com" />}
      {/* Supabase's OTP length is configurable (6–10), so don't cap this at 6:
          a shorter maxLength silently truncates and every code looks wrong. */}
      <input className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={10} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="Paste your code" />
      <div className="row">
        <button className="secondary" onClick={clearPending} disabled={busy}>Back</button>
        <button className="primary" onClick={verify} disabled={busy}>{busy ? 'Checking…' : 'Verify'}</button>
      </div>
      <button className="tuning small" onClick={sendCode} disabled={busy}>Didn&apos;t get it? Send another code</button>
    </>}
  </div>;
}
