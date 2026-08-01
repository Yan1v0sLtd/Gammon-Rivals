import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminSupabase } from './lib/adminSupabase';

/**
 * OAuth callback for the BO. Mounted at /auth/callback and the legacy
 * /admin/auth/callback path. The
 * adminSupabase client was constructed with `detectSessionInUrl: true`
 * + flowType 'pkce', so once this page mounts the library picks up the
 * ?code= parameter from the URL, exchanges it via the verifier sitting
 * in localStorage under `sb-admin-auth-token-code-verifier`, and writes
 * the resulting session into adminSupabase's storage. We just wait for
 * that to settle, then bounce to the Back Office root.
 *
 * Kept separate from the game's /auth/callback so the two sessions
 * never get crossed — the game's callback wouldn't have the admin
 * verifier in scope.
 */
export default function AdminAuthCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Poll briefly: detectSessionInUrl fires once on mount, but the
      // session takes a moment to settle. We wait up to ~3s.
      for (let i = 0; i < 30; i++) {
        const { data } = await adminSupabase.auth.getSession();
        if (cancelled) return;
        if (data.session) {
          navigate('/', { replace: true });
          return;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      if (cancelled) return;
      setError(
        'Could not complete sign-in. Try again, or refresh the Back Office.'
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <div className="grid min-h-dvh place-items-center bg-[#070a14] text-white">
      <div className="text-center">
        <div className="font-display text-2xl font-black uppercase tracking-wider text-amber-200">
          Back Office sign-in
        </div>
        <div className="mt-2 text-sm text-white/60">
          {error ?? 'Finishing sign-in…'}
        </div>
        {error ? (
          <button
            type="button"
            onClick={() => navigate('/', { replace: true })}
            className="mt-4 rounded-md border border-white/15 bg-white/5 px-4 py-2 text-sm font-bold text-white/80 hover:bg-white/10"
          >
            Back to Back Office
          </button>
        ) : null}
      </div>
    </div>
  );
}
