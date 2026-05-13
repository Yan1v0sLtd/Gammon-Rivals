import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';

function safeNextPath(value: string | null): string {
  if (!value) return '/';
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  if (value.startsWith('/auth/callback')) return '/';
  return value;
}

function readCallbackParam(params: URLSearchParams, key: string): string | null {
  const fromSearch = params.get(key);
  if (fromSearch) return fromSearch;
  if (typeof window === 'undefined' || !window.location.hash) return null;
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  return hashParams.get(key);
}

function formatAuthError(message: string): string {
  if (message.toLowerCase().includes('pkce code verifier not found')) {
    return [
      'The Google sign-in started in one browser context, but the callback opened without the temporary login token.',
      'Go back to the lobby and start Google sign-in again from the same tab. If you opened the app with localhost, use 127.0.0.1 instead.',
    ].join(' ');
  }

  if (message.toLowerCase().includes('unable to exchange external code')) {
    return [
      'Google reached Supabase, but Supabase could not exchange the Google login code.',
      'Check that the Google OAuth Client ID and Client Secret saved in Supabase are from the same Web application client, and that Google Cloud allows the Supabase callback URL.',
    ].join(' ');
  }
  return message;
}

export default function AuthCallback() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { completeOAuthProfile } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current) return;
    handledRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const authError =
          readCallbackParam(params, 'error_description') ?? readCallbackParam(params, 'error');
        if (authError) throw new Error(authError);

        const code = readCallbackParam(params, 'code');
        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
        } else {
          const { data, error: sessionError } = await supabase.auth.getSession();
          if (sessionError) throw sessionError;
          if (!data.session) {
            throw new Error('Google sign-in did not return a session. Please try again.');
          }
        }
        await completeOAuthProfile();
        if (!cancelled) {
          navigate(safeNextPath(readCallbackParam(params, 'next')), { replace: true });
        }
      } catch (err) {
        if (!cancelled) setError(formatAuthError(err instanceof Error ? err.message : String(err)));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [completeOAuthProfile, navigate, params]);

  if (!error) {
    return <main className="min-h-dvh bg-[#071120]" aria-label="Completing sign-in" />;
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-[#071120] px-4 text-white">
      <section className="w-full max-w-md rounded-2xl border border-white/12 bg-[#101a2a]/88 p-6 text-center shadow-2xl">
        <div className="font-display text-xs font-black uppercase tracking-[0.42em] text-[#f6d770]">
          Gammon Rivals
        </div>
        <h1 className="mt-4 font-display text-2xl font-black text-white">
          Sign-in needs attention
        </h1>
        <p className="mt-3 text-sm text-rose-100">{error}</p>
        <Link
          to="/"
          className="mt-5 inline-block rounded-lg bg-[#f6d770] px-4 py-2 font-black text-[#101a2a]"
        >
          Back to lobby
        </Link>
      </section>
    </main>
  );
}
