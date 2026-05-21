import { Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import Avatar from '../components/Avatar';
import type { ProfileProgression } from '../lib/progression';
import type { Database } from '../types/database';
import { RollingNumber } from './RollingNumber';
import { XpBoostBadge } from './XpBoostBadge';

type ProfileRow = Database['public']['Tables']['profiles']['Row'];
type UserWallet = Database['public']['Tables']['user_wallets']['Row'];

interface LobbyTopBarProps {
  readonly profile: ProfileRow | null;
  readonly wallet: UserWallet | null;
  readonly progression: ProfileProgression;
  readonly isGuest: boolean;
  onLinkGoogle(): Promise<void>;
}

function CurrencyPill({
  flyTarget,
  label,
  value,
  icon,
  onAdd,
}: {
  readonly flyTarget: 'coins' | 'gems';
  readonly label: string;
  readonly value: number | null | undefined;
  readonly icon: string;
  readonly onAdd: () => void;
}) {
  return (
    <div
      aria-label={`${label}: ${value ?? 0}`}
      data-fly-target={flyTarget}
      className="lobby-currency-pill relative flex h-12 min-w-[8.55rem] items-center rounded-md border border-[#28577d]/80 bg-gradient-to-b from-[#114f83]/80 to-[#073768]/88 shadow-[inset_0_1px_0_rgba(255,255,255,0.26),0_7px_14px_rgba(0,0,0,0.32)] backdrop-blur"
    >
      <span className="lobby-currency-icon -ml-4 grid h-14 w-14 shrink-0 place-items-center">
        <img
          src={icon}
          alt=""
          className="h-full w-full object-contain drop-shadow-[0_5px_5px_rgba(0,0,0,0.42)]"
          draggable={false}
        />
      </span>
      <span className="lobby-currency-value -ml-2 flex h-[2.55rem] min-w-0 flex-1 items-center justify-center rounded bg-[#071f3f]/82 px-4 text-center font-display text-xl font-black tracking-wide text-white shadow-[inset_0_1px_3px_rgba(0,0,0,0.5)] drop-shadow-[0_2px_0_rgba(0,0,0,0.35)]">
        <RollingNumber value={value} />
      </span>
      <button
        type="button"
        onClick={onAdd}
        aria-label={`Get more ${label}`}
        className="lobby-currency-add relative mr-1 grid h-10 w-10 shrink-0 place-items-center rounded bg-gradient-to-b from-[#8dff68] via-[#47d039] to-[#17831c] shadow-[inset_0_1px_0_rgba(255,255,255,0.55),0_3px_0_#0c5710] transition hover:brightness-110 active:translate-y-[1px]"
      >
        <span className="absolute left-1/2 top-1/2 h-6 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded bg-white shadow-[0_1px_0_rgba(0,0,0,0.25)]" />
        <span className="absolute left-1/2 top-1/2 h-1.5 w-6 -translate-x-1/2 -translate-y-1/2 rounded bg-white shadow-[0_1px_0_rgba(0,0,0,0.25)]" />
      </button>
    </div>
  );
}

const shortcuts = [
  { label: 'Rewards', icon: '/lobby/icons/rewards-gift.webp' },
  { label: 'Friends', icon: '/lobby/icons/friends.webp' },
  { label: 'Settings', icon: '/lobby/icons/settings-gear.webp' },
] as const;

function TopShortcut({
  label,
  icon,
}: {
  readonly label: string;
  readonly icon: string;
}) {
  return (
    <button
      type="button"
      className="relative flex min-w-16 flex-col items-center gap-1 text-[0.68rem] font-bold uppercase tracking-wide text-white/90 drop-shadow transition hover:brightness-110 active:translate-y-0.5"
    >
      <span className="grid h-11 w-11 place-items-center">
        <img
          src={icon}
          alt=""
          className="max-h-full max-w-full object-contain drop-shadow-[0_5px_5px_rgba(0,0,0,0.38)]"
          draggable={false}
        />
      </span>
      <span>{label}</span>
    </button>
  );
}

export function LobbyTopBar({
  profile,
  wallet,
  progression,
  isGuest,
  onLinkGoogle,
}: LobbyTopBarProps) {
  const navigate = useNavigate();
  const [linking, setLinking] = useState(false);
  const name = profile?.display_name ?? 'Player';
  const openShop = () => navigate('/shop');
  const currencies = [
    {
      id: 'coins',
      flyTarget: 'coins',
      label: 'Coins',
      value: wallet?.coins,
      icon: '/lobby/icons/gold-coin.webp',
    },
    {
      id: 'gems',
      flyTarget: 'gems',
      label: 'Gems',
      value: wallet?.gems,
      icon: '/lobby/icons/gem.webp',
    },
  ] as const;

  const handleLinkGoogle = async () => {
    setLinking(true);
    try {
      await onLinkGoogle();
    } finally {
      setLinking(false);
    }
  };

  return (
    <header className="lobby-topbar relative z-20 grid gap-3 py-3 md:grid-cols-[minmax(16rem,1fr)_auto] md:items-start">
      <div className="lobby-profile-card group">
        <div className="lobby-profile-avatar-wrap">
          <Link to="/profile" className="block" aria-label="Open profile">
            <div className="lobby-profile-avatar-core">
              <Avatar
                seed={profile?.avatar_seed ?? 'guest'}
                imageUrl={profile?.avatar_url}
                size={78}
                ring="none"
              />
            </div>
            <div className="lobby-profile-level-shield" data-fly-target="xp">
              {progression.level}
            </div>
          </Link>
        </div>
        <div className="lobby-profile-copy">
          <Link to="/profile" className="block min-w-0" aria-label="Open profile">
            <div className="flex min-w-0 items-center gap-2">
              <div className="truncate font-display text-[clamp(1.45rem,2.2vw,2.25rem)] font-black leading-none text-white drop-shadow-[0_3px_0_rgba(0,0,0,0.44)]">
                {name}
              </div>
              <span className="lobby-profile-edit" aria-hidden="true" />
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className="lobby-rank-badge">
                <span className="lobby-rank-star" aria-hidden="true" />
                <span>{progression.statusLabel}</span>
              </span>
              <span className="lobby-profile-progress">
                <span
                  className="lobby-profile-progress-fill"
                  style={{ width: `${progression.progressPercent}%` }}
                >
                  {/* Bubble layer — purely decorative, lives ON the
                      filled portion only because it's inside .fill.
                      CSS handles the animation loop. */}
                  <span className="lobby-profile-progress-bubbles" aria-hidden="true" />
                </span>
                {/* Percent text floats centred over the whole bar
                    (not the fill) so it reads the same regardless
                    of how full the bar is. White with a dark
                    stroke + drop-shadow for legibility on either
                    side of the fill edge. */}
                <span className="lobby-profile-progress-label">
                  {progression.progressLabel}
                </span>
              </span>
            </div>
          </Link>
          {/* XP-boost chip. Renders null when no boost is active so it
            * occupies no space — and it ticks its own countdown so the
            * rest of the top-bar doesn't re-render every second. */}
          <div className="mt-2 flex items-center">
            <XpBoostBadge />
          </div>
          {isGuest && (
            <button
              type="button"
              onClick={() => {
                void handleLinkGoogle();
              }}
              disabled={linking}
              className="mt-2 rounded-full border border-[#f6d770]/45 bg-[#071429]/75 px-3 py-1 text-[0.68rem] font-black uppercase tracking-wide text-[#f6d770] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] transition hover:bg-[#0d2142] disabled:opacity-60"
            >
              {linking ? 'Opening Google...' : 'Save progress'}
            </button>
          )}
        </div>
      </div>

      <div className="lobby-topbar-actions flex flex-wrap items-start justify-end gap-3">
        <div className="lobby-currency-strip flex flex-wrap justify-end gap-3">
          {currencies.map((currency) => (
            <CurrencyPill key={currency.id} {...currency} onAdd={openShop} />
          ))}
        </div>
        <nav aria-label="Lobby shortcuts" className="hidden gap-4 lg:flex">
          {shortcuts.map((shortcut) => (
            <TopShortcut key={shortcut.label} {...shortcut} />
          ))}
        </nav>
      </div>
    </header>
  );
}
