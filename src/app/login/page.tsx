'use client';

import { FormEvent, Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { sanitizeNext } from '@/lib/auth/sanitize';

function LoginForm() {
  const searchParams = useSearchParams();
  const nextPath = sanitizeNext(searchParams.get('next'));
  const [accessKey, setAccessKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: accessKey }),
      });
      if (res.ok) {
        window.location.assign(nextPath);
        return;
      }
      const body = await res.json().catch(() => null);
      setError(typeof body?.error === 'string' ? body.error : 'Login failed');
    } catch {
      setError('Network error — try again');
    }
    setSubmitting(false);
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-mc-bg text-mc-text">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm mx-4 p-8 rounded-lg border border-mc-border bg-mc-bg-secondary"
      >
        <h1 className="text-xl font-semibold mb-1">Mission Control</h1>
        <p className="text-sm text-mc-text-secondary mb-6">Enter your access key to continue.</p>
        <label className="block text-sm mb-2" htmlFor="access-key">
          Access key
        </label>
        <input
          id="access-key"
          type="password"
          autoFocus
          autoComplete="current-password"
          value={accessKey}
          onChange={(event) => setAccessKey(event.target.value)}
          className="w-full px-3 py-2 mb-4 rounded border border-mc-border bg-mc-bg text-mc-text focus:outline-none focus:border-mc-accent"
        />
        {error && <p className="text-sm text-mc-accent-red mb-4">{error}</p>}
        <button
          type="submit"
          disabled={submitting || accessKey.length === 0}
          className="w-full py-2 rounded bg-mc-accent text-mc-bg font-medium disabled:opacity-50 hover:opacity-90 transition-opacity"
        >
          {submitting ? 'Checking…' : 'Log in'}
        </button>
      </form>
    </main>
  );
}

export default function LoginPage() {
  // useSearchParams requires a Suspense boundary at build time.
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
