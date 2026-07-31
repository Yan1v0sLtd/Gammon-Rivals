import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { joinMatchByInvite } from '../lib/persistence';

export default function JoinMatch() {
  const { code } = useParams<{ code: string }>();
  const [params] = useSearchParams();
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();
  const boardParam = params.get('board');
  const [error, setError] = useState<string | null>(null);
  const triedRef = useRef(false);

  useEffect(() => {
    if (isLoading || !user || !code) return;
    if (triedRef.current) return;
    triedRef.current = true;
    (async () => {
      try {
        const matchId = await joinMatchByInvite(code);
        navigate(`/play/${matchId}${boardParam ? `?board=${encodeURIComponent(boardParam)}` : ''}`, {
          replace: true,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('invalid_or_expired_invite')) {
          setError('This invite link is invalid or has expired.');
        } else {
          setError(msg);
        }
      }
    })();
  }, [boardParam, isLoading, user, code, navigate]);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center text-board-felt/80 gap-4 p-6">
      {error ? (
        <>
          <div className="text-rose-400 text-center">{error}</div>
          <Link to="/play" className="text-board-accent text-sm">← Home</Link>
        </>
      ) : (
        <div className="text-board-felt/60">Joining match…</div>
      )}
    </main>
  );
}
