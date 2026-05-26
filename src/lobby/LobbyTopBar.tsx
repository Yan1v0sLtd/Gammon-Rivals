import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import type { ProfileProgression } from '../lib/progression';
import type { Database } from '../types/database';
import { LobbyProfileCard } from './LobbyProfileCard';
import { RollingNumber } from './RollingNumber';
import type { LobbyProfileStats } from './useLobbyProfileStats';
import { XpBoostBadge } from './XpBoostBadge';

type ProfileRow = Database['public']['Tables']['profiles']['Row'];
type UserWallet = Database['public']['Tables']['user_wallets']['Row'];

interface LobbyTopBarProps {
  readonly profile: ProfileRow | null;
  readonly wallet: UserWallet | null;
  readonly progression: ProfileProgression;
  readonly profileStats: LobbyProfileStats | null;
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
  // Sizes here are 80% of the previous values across the board —
  // every rem-based dimension was multiplied by 0.8 so the pill
  // visually shrinks AND its layout footprint shrinks with it
  // (vs. a CSS transform: scale which would leave dead space).
  return (
    <div
      aria-label={`${label}: ${value ?? 0}`}
      data-fly-target={flyTarget}
      className="lobby-currency-pill relative flex h-[2.4rem] min-w-[6.84rem] items-center rounded-md border border-[#28577d]/80 bg-gradient-to-b from-[#114f83]/80 to-[#073768]/88 shadow-[inset_0_1px_0_rgba(255,255,255,0.26),0_7px_14px_rgba(0,0,0,0.32)] backdrop-blur"
    >
      <span className="lobby-currency-icon -ml-[0.8rem] grid h-[2.8rem] w-[2.8rem] shrink-0 place-items-center">
        <img
          src={icon}
          alt=""
          className="h-full w-full object-contain drop-shadow-[0_5px_5px_rgba(0,0,0,0.42)]"
          draggable={false}
        />
      </span>
      <span className="lobby-currency-value -ml-[0.4rem] flex h-[2.04rem] min-w-0 flex-1 items-center justify-center rounded bg-[#071f3f]/82 px-[0.8rem] text-center font-display text-base font-black tracking-wide text-white shadow-[inset_0_1px_3px_rgba(0,0,0,0.5)] drop-shadow-[0_2px_0_rgba(0,0,0,0.35)]">
        <RollingNumber value={value} />
      </span>
      <button
        type="button"
        onClick={onAdd}
        aria-label={`Get more ${label}`}
        className="lobby-currency-add relative mr-[0.2rem] grid h-[2rem] w-[2rem] shrink-0 place-items-center rounded bg-gradient-to-b from-[#8dff68] via-[#47d039] to-[#17831c] shadow-[inset_0_1px_0_rgba(255,255,255,0.55),0_3px_0_#0c5710] transition hover:brightness-110 active:translate-y-[1px]"
      >
        <span className="absolute left-1/2 top-1/2 h-[1.2rem] w-[0.3rem] -translate-x-1/2 -translate-y-1/2 rounded bg-white shadow-[0_1px_0_rgba(0,0,0,0.25)]" />
        <span className="absolute left-1/2 top-1/2 h-[0.3rem] w-[1.2rem] -translate-x-1/2 -translate-y-1/2 rounded bg-white shadow-[0_1px_0_rgba(0,0,0,0.25)]" />
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
  profileStats,
  isGuest,
  onLinkGoogle,
}: LobbyTopBarProps) {
  const navigate = useNavigate();
  const [linking, setLinking] = useState(false);
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
    <header className="lobby-topbar relative z-20 grid gap-3 py-3 md:grid-cols-[minmax(20rem,1fr)_auto] md:items-start">
      <div className="lobby-pp-shell relative flex min-w-0 flex-col gap-2">
        <LobbyProfileCard
          profile={profile}
          progression={progression}
          stats={profileStats}
        />
        {/* XP-boost chip + guest "Save progress" CTA sit BELOW the
            premium card so they don't break its tight visual
            grid. Both surface only when needed. */}
        <div className="flex flex-wrap items-center gap-2">
          <XpBoostBadge />
          {isGuest && (
            <button
              type="button"
              onClick={() => {
                void handleLinkGoogle();
              }}
              disabled={linking}
              className="rounded-full border border-[#f6d770]/45 bg-[#071429]/75 px-3 py-1 text-[0.68rem] font-black uppercase tracking-wide text-[#f6d770] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] transition hover:bg-[#0d2142] disabled:opacity-60"
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
