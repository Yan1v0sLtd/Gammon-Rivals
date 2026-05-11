import { Link } from 'react-router-dom';
import type { Database } from '../types/database';

type ProfileRow = Database['public']['Tables']['profiles']['Row'];

interface LobbyTopBarProps {
  readonly profile: ProfileRow | null;
}

const currencies = [
  { id: 'chips', label: 'Chips', value: '63,140', icon: '/lobby/icons/poker-chip.webp' },
  { id: 'coins', label: 'Coins', value: '400', icon: '/lobby/icons/gold-coin.webp' },
  { id: 'gems', label: 'Gems', value: '50', icon: '/lobby/icons/gem.webp' },
] as const;

function CurrencyPill({
  label,
  value,
  icon,
}: {
  readonly label: string;
  readonly value: string;
  readonly icon: string;
}) {
  return (
    <div
      aria-label={`${label}: ${value}`}
      className="relative flex h-12 min-w-[8.55rem] items-center rounded-md border border-[#28577d]/80 bg-gradient-to-b from-[#114f83]/80 to-[#073768]/88 shadow-[inset_0_1px_0_rgba(255,255,255,0.26),0_7px_14px_rgba(0,0,0,0.32)] backdrop-blur"
    >
      <span className="-ml-4 grid h-14 w-14 shrink-0 place-items-center">
        <img
          src={icon}
          alt=""
          className="h-full w-full object-contain drop-shadow-[0_5px_5px_rgba(0,0,0,0.42)]"
          draggable={false}
        />
      </span>
      <span className="-ml-2 flex h-[2.55rem] min-w-0 flex-1 items-center justify-center rounded bg-[#071f3f]/82 px-4 text-center font-display text-xl font-black tracking-wide text-white shadow-[inset_0_1px_3px_rgba(0,0,0,0.5)] drop-shadow-[0_2px_0_rgba(0,0,0,0.35)]">
        {value}
      </span>
      <button
        type="button"
        aria-label={`Add ${label}`}
        className="relative mr-1 grid h-10 w-10 shrink-0 place-items-center rounded bg-gradient-to-b from-[#8dff68] via-[#47d039] to-[#17831c] shadow-[inset_0_1px_0_rgba(255,255,255,0.55),0_3px_0_#0c5710]"
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

export function LobbyTopBar({ profile }: LobbyTopBarProps) {
  const name = profile?.display_name ?? 'Amit';
  const initial = name.trim()[0]?.toUpperCase() ?? 'A';

  return (
    <header className="relative z-20 grid gap-3 py-3 md:grid-cols-[minmax(14rem,1fr)_auto] md:items-start">
      <Link to="/profile" className="group flex min-w-0 items-center gap-3">
        <div className="relative grid h-[6.1rem] w-[6.1rem] shrink-0 place-items-center">
          <div className="absolute left-[1.05rem] top-[1.05rem] grid h-[4rem] w-[4rem] place-items-center rounded-full bg-gradient-to-b from-[#fff0bd] via-[#7d4b25] to-[#201421] text-4xl font-black text-[#142339] shadow-inner">
            {initial}
          </div>
          <img
            src="/lobby/icons/avatar-frame.webp"
            alt=""
            className="absolute inset-0 h-full w-full object-contain drop-shadow-[0_7px_11px_rgba(0,0,0,0.36)]"
            draggable={false}
          />
          <div className="absolute bottom-1 right-2 grid h-7 min-w-7 place-items-center rounded-full border border-[#ffd56c] bg-[#19233a] px-1 text-sm font-black text-[#ffe9a5] shadow-[0_2px_5px_rgba(0,0,0,0.4)]">
            23
          </div>
        </div>
        <div className="min-w-0">
          <div className="truncate font-display text-2xl font-black text-white drop-shadow">{name}</div>
          <div className="mt-1 flex items-center gap-2">
            <span className="rounded-md border border-[#f0a54b] bg-[#8b552e] px-2 py-0.5 text-sm font-black text-[#ffd779]">
              Rookie
            </span>
            <span className="h-3 w-28 overflow-hidden rounded-full border border-black/50 bg-black/45 shadow-inner">
              <span className="block h-full w-[34%] rounded-full bg-gradient-to-r from-[#ff8e1d] to-[#ffe063]" />
            </span>
          </div>
          <div className="mt-2 flex w-fit items-center gap-2 rounded-full bg-[#071429]/65 px-3 py-1 font-black text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
            <span className="text-xl text-[#ffd45c]">*</span>
            <span>25%</span>
          </div>
        </div>
      </Link>

      <div className="flex flex-wrap items-start justify-end gap-3">
        <div className="flex flex-wrap justify-end gap-3">
          {currencies.map((currency) => (
            <CurrencyPill key={currency.id} {...currency} />
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
