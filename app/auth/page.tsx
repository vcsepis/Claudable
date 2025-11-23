"use client";

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';

type AuthMode = 'login' | 'signup';

const gradientBg =
  'bg-gradient-to-br from-emerald-500 via-teal-400 to-cyan-400';

export default function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);

  const supabase = useMemo(() => {
    try {
      return getSupabaseBrowserClient();
    } catch (err) {
      setClientError(
        err instanceof Error
          ? err.message
          : 'Missing Monmi auth configuration (Supabase URL or anon key).'
      );
      return null;
    }
  }, []);

  useEffect(() => {
    if (!supabase) return;

    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user ?? null);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => {
      data?.subscription.unsubscribe();
    };
  }, [supabase]);

  const handleAuth = async () => {
    if (!supabase) return;
    setLoading(true);
    setError(null);
    setMessage(null);

    const trimmedEmail = email.trim();
    const trimmedPassword = password.trim();
    if (!trimmedEmail || !trimmedPassword) {
      setError('Please enter both email and password.');
      setLoading(false);
      return;
    }

    try {
      if (mode === 'login') {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: trimmedEmail,
          password: trimmedPassword,
        });
        if (signInError) {
          throw signInError;
        }
        setMessage('Welcome back! Redirecting...');
        setTimeout(() => router.push('/'), 800);
      } else {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: trimmedEmail,
          password: trimmedPassword,
          options: {
            data: { full_name: fullName.trim() || undefined },
          },
        });
        if (signUpError) {
          throw signUpError;
        }
        if (!data.session) {
          setMessage('Check your email to confirm your account.');
        } else {
          setMessage('Account created! Redirecting...');
          setTimeout(() => router.push('/'), 800);
        }
        setMode('login');
      }
    } catch (err) {
      const friendly =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: string }).message)
          : 'Something went wrong. Please try again.';
      setError(friendly);
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    if (!supabase) return;
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      await supabase.auth.signOut();
      setMessage('Signed out.');
    } catch (err) {
      const friendly =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: string }).message)
          : 'Could not sign out.';
      setError(friendly);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-slate-950 text-gray-100 overflow-hidden">
      <div className="pointer-events-none absolute inset-0 opacity-80">
        <div className="absolute -left-24 -top-24 h-96 w-96 rounded-full bg-emerald-500 blur-[120px]" />
        <div className="absolute right-0 top-10 h-[420px] w-[520px] rounded-full bg-cyan-400 blur-[120px]" />
        <div className="absolute inset-10 rounded-3xl border border-white/5 bg-white/5" />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-5xl flex-col items-center justify-center px-6 py-12">
        <div className="mb-8 flex items-center gap-3 rounded-full border border-white/10 bg-white/10 px-4 py-2 backdrop-blur">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-100">
            Monmi Auth
          </span>
        </div>

        <div className="grid w-full gap-8 rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur-lg shadow-2xl lg:grid-cols-2">
          <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900/80 via-slate-900/60 to-slate-800/50 p-8 shadow-inner">
            <div className="absolute -left-10 -top-16 h-48 w-48 rounded-full bg-emerald-500/30 blur-3xl" />
            <div className="absolute -bottom-20 right-0 h-64 w-64 rounded-full bg-cyan-400/20 blur-3xl" />
            <div className="relative space-y-6">
              <div className="flex items-center gap-3">
                <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${gradientBg} text-white shadow-lg shadow-emerald-500/30`}>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    className="h-6 w-6"
                  >
                    <path
                      d="M9 12a3 3 0 1 0 6 0M5 21h14a2 2 0 0 0 2-2v-7a9 9 0 1 0-18 0v7a2 2 0 0 0 2 2Z"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                  </svg>
                </div>
                <div>
                  <p className="text-sm uppercase tracking-[0.2em] text-emerald-100">Monmi</p>
                  <h1 className="text-2xl font-bold text-white sm:text-3xl">Access your workspace</h1>
                </div>
              </div>
              <p className="text-base text-emerald-50/80">
                Sign up or log in to Monmi to sync your projects, keep your previews alive, and keep deploying without losing your work.
              </p>
              <div className="grid gap-3 text-sm text-emerald-50/80 sm:grid-cols-2">
                {[
                  'Email + password with secure sessions',
                  'Persistent login across preview reloads',
                  'One-click sign out when you are done',
                  'Works with your Monmi workspace (Supabase backend)',
                ].map((item) => (
                  <div
                    key={item}
                    className="flex items-start gap-2 rounded-xl border border-white/5 bg-white/5 px-3 py-2"
                  >
                    <span className="mt-1 h-2 w-2 rounded-full bg-emerald-400" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="relative rounded-2xl border border-white/10 bg-white/5 p-8 shadow-lg">
            <div className="mb-6 flex items-center justify-between rounded-xl bg-white/5 p-1">
              {(['login', 'signup'] as AuthMode[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setMode(tab)}
                  className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition ${
                    mode === tab
                      ? `${gradientBg} text-white shadow-md`
                      : 'text-emerald-50/70 hover:bg-white/5'
                  }`}
                >
                  {tab === 'login' ? 'Sign in' : 'Sign up'}
                </button>
              ))}
            </div>

            <div className="space-y-4">
              {mode === 'signup' && (
                <div>
                  <label className="text-sm text-emerald-50/80">Full name</label>
                  <input
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Display name (optional)"
                    className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-emerald-50/50 outline-none focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/30"
                  />
                </div>
              )}

              <div>
                <label className="text-sm text-emerald-50/80">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-emerald-50/50 outline-none focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/30"
                  autoComplete="email"
                />
              </div>

              <div>
                <label className="text-sm text-emerald-50/80">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-emerald-50/50 outline-none focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/30"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                />
              </div>

              {clientError && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-100">
                  {clientError}
                </div>
              )}

              {error && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-100">
                  {error}
                </div>
              )}
              {message && (
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
                  {message}
                </div>
              )}

              <button
                onClick={handleAuth}
                disabled={loading || !supabase}
                className={`w-full rounded-xl px-4 py-3 text-sm font-semibold text-white transition ${
                  loading || !supabase
                    ? 'bg-white/10 text-emerald-50/60'
                    : `${gradientBg} shadow-lg shadow-emerald-500/30 hover:scale-[1.01] active:scale-[0.99]`
                }`}
              >
                {loading
                  ? 'Processing...'
                  : mode === 'login'
                    ? 'Sign in to Monmi'
                    : 'Create Monmi account'}
              </button>

              {user && (
                <div className="mt-4 rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-emerald-50/80">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-emerald-100">Signed in</p>
                      <p className="text-white">{user.email}</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => router.push('/')}
                        className="rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-xs font-semibold text-emerald-50 hover:border-emerald-300/40"
                      >
                        Back to dashboard
                      </button>
                      <button
                        onClick={handleSignOut}
                        className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-red-100 hover:border-red-400/40"
                        disabled={loading}
                      >
                        Sign out
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <p className="text-center text-xs text-emerald-50/60">
                Monmi keeps your session in local storage. You can adjust auth policies in your Supabase dashboard.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
