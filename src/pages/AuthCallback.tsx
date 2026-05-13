import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';

function safeNextPath(value: string | null): string {
  if (!value) return '/';
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}

export default function AuthCallback() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { completeOAuthProfile } = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const code = params.get('code');
        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
        }
        await completeOAuthProfile();
        if (!cancelled) navigate(safeNextPath(params.get('next')), { replace: true });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [completeOAuthProfile, navigate, params]);

  return (
    <main className="grid min-h-dvh place-items-center bg-[#071120] px-4 text-white">
      <section className="w-full max-w-md rounded-2xl border border-white/12 bg-[#101a2a]/88 p-6 text-center shadow-2xl">
        <div className="font-display text-xs font-black uppercase tracking-[0.42em] text-[#f6d770]">
          Gammon Rivals
        </div>
        {error ? (
          <>
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
          </>
        ) : (
          <>
            <h1 className="mt-4 font-display text-2xl font-black text-white">
              Signing you in…
            </h1>
            <p className="mt-3 text-sm text-white/65">Saving your profile and returning to the game.</p>
          </>
        )}
      </section>
    </main>
  );
}
