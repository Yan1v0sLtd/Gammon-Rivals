import { useShop } from '../components/shopContext';
import type { ProfileProgression } from '@shared/progression';
import type { Database } from '@shared/database';
import { CurrencyPill } from '../components/CurrencyPill';
import { LobbyProfileCard } from './LobbyProfileCard';
import { XpBoostBadge } from './XpBoostBadge';

type ProfileRow = Database['public']['Tables']['profiles']['Row'];
type UserWallet = Database['public']['Tables']['user_wallets']['Row'];

interface LobbyTopBarProps {
  readonly profile: ProfileRow | null;
  readonly wallet: UserWallet | null;
  readonly progression: ProfileProgression;
  readonly isGuest: boolean;
  /**
   * Linking Google to a guest account. The lobby top-bar no longer
   * exposes a "Save progress" button (operator decision — guests
   * can still link from /profile), but the prop is kept so future
   * surfaces can wire to it without an interface change.
   */
  onLinkGoogle(): Promise<void>;
}

// Rewards + Friends were placeholder (no-op) icons — removed per operator
// review. Settings stays.
const shortcuts = [
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
}: LobbyTopBarProps) {
  const { openShop } = useShop();
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

  return (
    <header className="lobby-topbar relative z-20 grid gap-3 py-3 md:grid-cols-[minmax(16rem,1fr)_auto] md:items-start">
      <div className="lobby-pp-shell relative flex min-w-0 flex-col gap-2">
        <LobbyProfileCard
          profile={profile}
          progression={progression}
        />
        {/* XP-boost chip sits BELOW the premium card so it doesn't
            break the card's tight visual grid. Renders nothing when
            no boost is active. The guest "Save progress" CTA that
            used to live here was removed per operator request —
            guests can still link Google from the /profile page. */}
        <div className="flex flex-wrap items-center gap-2">
          <XpBoostBadge />
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
