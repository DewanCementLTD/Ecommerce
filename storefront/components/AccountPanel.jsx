'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAccount } from '../lib/AccountContext.jsx';
import { useToast } from '../lib/ToastContext.jsx';
import { Button } from './ui.jsx';

const inputClass =
  'mt-1 w-full rounded-md border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent';

export function AccountPanel({ hrefBase }) {
  const { customer, loading, login, register, logout } = useAccount();
  const toast = useToast();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (loading) return <p className="text-muted">Loading…</p>;

  if (customer) {
    return (
      <div className="space-y-6">
        <h1>My account</h1>
        <div className="rounded-lg border border-line p-4 text-sm">
          <p className="font-medium">{customer.name}</p>
          <p className="text-muted">{customer.email}</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button href={`${hrefBase}/account/orders`}>View my orders</Button>
          <Button
            variant="outline"
            onClick={async () => {
              await logout();
              toast('Logged out.');
            }}
          >
            Log out
          </Button>
        </div>
      </div>
    );
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      if (mode === 'login') {
        await login(form.email, form.password);
        toast('Welcome back.');
      } else {
        await register({ name: form.name, email: form.email, phone: form.phone, password: form.password });
        toast('Account created.');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1>{mode === 'login' ? 'Log in' : 'Create an account'}</h1>

      {error && (
        <p role="alert" className="rounded-md bg-sale/10 px-3 py-2 text-sm text-sale">
          {error}
        </p>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {mode === 'register' && (
          <>
            <div>
              <label htmlFor="name" className="text-sm font-medium">
                Name
              </label>
              <input
                id="name"
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="phone" className="text-sm font-medium">
                Phone
              </label>
              <input
                id="phone"
                required
                type="tel"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                className={inputClass}
              />
            </div>
          </>
        )}
        <div>
          <label htmlFor="email" className="text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            required
            type="email"
            autoComplete="username"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="password" className="text-sm font-medium">
            Password
          </label>
          <input
            id="password"
            required
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            minLength={mode === 'register' ? 8 : undefined}
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            className={inputClass}
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="inline-flex w-full items-center justify-center rounded-pill bg-primary px-6 py-3 text-sm font-semibold text-primary-ink disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}
        </button>
      </form>

      <p className="text-center text-sm text-muted">
        {mode === 'login' ? (
          <>
            New here?{' '}
            <button type="button" onClick={() => setMode('register')} className="underline hover:text-accent">
              Create an account
            </button>
          </>
        ) : (
          <>
            Already have an account?{' '}
            <button type="button" onClick={() => setMode('login')} className="underline hover:text-accent">
              Log in
            </button>
          </>
        )}
      </p>
      <p className="text-center text-xs text-muted">
        <Link href={`${hrefBase}/checkout`} className="underline hover:text-accent">
          Continue as guest
        </Link>{' '}
        instead.
      </p>
    </div>
  );
}
