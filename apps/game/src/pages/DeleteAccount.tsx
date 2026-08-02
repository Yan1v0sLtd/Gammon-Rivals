import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { deleteMyAccount } from '../lib/persistence';

// Public, ungated page (see App.tsx routing). It serves two purposes:
//  1. The in-app account-deletion flow (linked from Profile).
//  2. The publicly reachable account-deletion URL required by Google Play
//     for apps that allow account creation (works without signing in:
//     shows instructions + a support contact).
// All deletion goes through the delete_my_account RPC (self-scoped, cascades
// to every player_*/user_* table). Irreversible.

// TODO: confirm the public support address before launch.
const SUPPORT_EMAIL = 'support@gammonrivals.com';

const DELETED_ITEMS = [
  'Your account and sign-in (guest or Google)',
  'Your profile, display name, level, XP, and rating',
  'Your Coins and Gems balances and in-game transaction history',
  'Your match history, missions, bonuses, and unlocked boards',
];

export default function DeleteAccount() {
  const { user, profile, isLoading, signOut } = useAuth();
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const signedIn = !!user;
  const canDelete = confirmText.trim().toUpperCase() === 'DELETE';

  const handleDelete = async () => {
    if (!canDelete || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteMyAccount();
      // The account + its JWT are gone server-side; clear the local session
      // too (best-effort — the token may already be invalid).
      try {
        await signOut();
      } catch {
        /* session already invalid — fine */
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDeleting(false);
    }
  };

  return (
    <main className="grid min-h-screen place-items-center bg-[#061225] px-4 py-10 text-white">
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-white/[0.04] p-6 shadow-2xl shadow-black/40 sm:p-8">
        <h1 className="text-2xl font-black tracking-tight">Delete your Gammon Rivals account</h1>

        {done ? (
          <div className="mt-6 space-y-4">
            <div className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
              Your account and all associated data have been permanently deleted.
            </div>
            <p className="text-sm text-white/55">
              Thanks for playing. You can start fresh any time.
            </p>
            <Link
              to="/play"
              className="inline-block rounded-lg bg-amber-300 px-4 py-2 text-sm font-black text-[#1b1202] transition hover:brightness-105"
            >
              Back to Gammon Rivals
            </Link>
          </div>
        ) : (
          <>
            <p className="mt-3 text-sm text-white/65">
              Deleting your account is <strong className="text-white">permanent and cannot be
              undone</strong>. It immediately removes:
            </p>
            <ul className="mt-3 space-y-1.5 text-sm text-white/70">
              {DELETED_ITEMS.map((item) => (
                <li key={item} className="flex gap-2">
                  <span aria-hidden="true" className="text-rose-300/70">•</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-white/40">
              Deletion does not refund prior purchases. Purchase records held by the Apple App
              Store or Google Play are managed by those stores under their own terms.
            </p>

            {isLoading ? (
              <div className="mt-6 text-sm text-white/45">Checking your session…</div>
            ) : signedIn ? (
              <div className="mt-6 space-y-3">
                <div className="text-sm text-white/55">
                  Signed in as{' '}
                  <strong className="text-white">
                    {profile?.display_name || user?.email || 'your account'}
                  </strong>
                  .
                </div>
                <label className="block text-xs font-bold uppercase tracking-[0.14em] text-white/45">
                  Type <span className="text-rose-300">DELETE</span> to confirm
                  <input
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    autoCapitalize="characters"
                    autoComplete="off"
                    className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm normal-case tracking-normal text-white outline-none focus:border-rose-300/60"
                    placeholder="DELETE"
                  />
                </label>
                {error && (
                  <div className="rounded-lg border border-rose-300/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
                    {error}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => void handleDelete()}
                  disabled={!canDelete || deleting}
                  className="w-full rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-black text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {deleting ? 'Deleting…' : 'Permanently delete my account'}
                </button>
                <Link
                  to="/profile"
                  className="block text-center text-xs font-semibold text-white/45 transition hover:text-white/70"
                >
                  Cancel
                </Link>
              </div>
            ) : (
              <div className="mt-6 space-y-3 text-sm text-white/65">
                <p>To delete your account, choose either option:</p>
                <ol className="space-y-2">
                  <li>
                    <span className="font-bold text-white">In the app:</span> open Gammon Rivals →{' '}
                    <span className="text-white">Profile</span> →{' '}
                    <span className="text-white">Delete account</span>.
                  </li>
                  <li>
                    <span className="font-bold text-white">By email:</span> write to{' '}
                    <a className="text-amber-200 underline" href={`mailto:${SUPPORT_EMAIL}`}>
                      {SUPPORT_EMAIL}
                    </a>{' '}
                    from the email address on your account, and we will delete your account and
                    data within 30 days.
                  </li>
                </ol>
                <Link
                  to="/play"
                  className="mt-2 inline-block rounded-lg bg-amber-300 px-4 py-2 text-sm font-black text-[#1b1202] transition hover:brightness-105"
                >
                  Open the app
                </Link>
              </div>
            )}

            <p className="mt-6 border-t border-white/10 pt-4 text-xs text-white/40">
              Questions about deletion or your data? Contact{' '}
              <a className="text-amber-200/80 underline" href={`mailto:${SUPPORT_EMAIL}`}>
                {SUPPORT_EMAIL}
              </a>
              .
            </p>
          </>
        )}
      </div>
    </main>
  );
}
